const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell, Tray } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { validateCsvOutput } = require('../scripts/extracao/output-validation');

app.setName('Extrator Agendado de Bases');

const EXTRACTORS = {
  siteNovo: { label: 'Site Novo', script: 'site-novo.js', output: '01_Todos_Aberto.xls e 02_Todos_Pendente.xls' },
  siteAntigo: { label: 'Site Antigo / BKO All', script: 'site-antigo.js', output: 'bko_all.csv' },
  go: { label: 'GO', script: 'go.js', output: 'EQTL_GO.csv' },
  rs: { label: 'RS / CEEE', script: 'rs.js', output: 'EQTL_RS.csv' },
};
const RETRYABLE_EXTRACTORS = new Set(['siteAntigo', 'go', 'rs']);
const RETRY_DELAY_SECONDS = Math.max(1, Number(process.env.EXTRACTION_RETRY_DELAY_SECONDS) || 15);
const MAX_RETRY_ATTEMPTS = Math.max(0, Number(process.env.EXTRACTION_MAX_ATTEMPTS) || 0);

let mainWindow = null;
let tray = null;
let quitting = false;
let schedulerTimer = null;
let lastScheduleKey = '';
const running = new Map();
const cancelled = new Set();
const runtimeState = Object.fromEntries(Object.keys(EXTRACTORS).map(id => [id, {
  status: 'idle',
  startedAt: '',
  finishedAt: '',
  message: 'Aguardando',
  logPath: '',
}]));

function appRoot() {
  const packagedRoot = app.getAppPath();
  return fs.existsSync(path.join(packagedRoot, 'scripts', 'extracao'))
    ? packagedRoot
    : path.resolve(__dirname, '..');
}

function assetPath(fileName) {
  return path.join(appRoot(), 'assets', fileName);
}

function defaultConfig() {
  const base = path.join(app.getPath('documents'), 'Bases Extraidas');
  return {
    scheduleEnabled: false,
    scheduleTimes: ['10:00', '10:30'],
    startWithWindows: false,
    closeToTray: true,
    extractors: {
      siteNovo: { enabled: true, username: '', password: '', outputDir: path.join(base, 'SITE NOVO') },
      siteAntigo: { enabled: true, username: '', password: '', outputDir: path.join(base, 'SITE ANTIGO') },
      go: { enabled: true, username: '', password: '', outputDir: path.join(base, 'GO') },
      rs: { enabled: true, username: '', password: '', outputDir: path.join(base, 'RS') },
    },
  };
}

function configPath() {
  return path.join(app.getPath('userData'), 'extractor-config.json');
}

function logsDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readConfig() {
  const defaults = defaultConfig();
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      ...defaults,
      ...saved,
      scheduleTimes: normalizeTimes(saved.scheduleTimes || defaults.scheduleTimes),
      extractors: Object.fromEntries(Object.keys(EXTRACTORS).map(id => [id, {
        ...defaults.extractors[id],
        ...(saved.extractors?.[id] || {}),
      }])),
    };
  } catch (_) {
    return defaults;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

function encryptSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A criptografia segura do Windows nao esta disponivel nesta maquina.');
  }
  return safeStorage.encryptString(String(value)).toString('base64');
}

function decryptSecret(value) {
  if (!value) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch (_) {
    return '';
  }
}

function publicConfig(config = readConfig()) {
  return {
    ...config,
    extractors: Object.fromEntries(Object.keys(EXTRACTORS).map(id => [id, {
      ...config.extractors[id],
      password: '',
      passwordConfigured: !!config.extractors[id].password,
      meta: EXTRACTORS[id],
    }])),
  };
}

function normalizeTimes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))]
    .sort();
}

function formatLocalTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function scheduleInfo(config = readConfig()) {
  const now = new Date();
  const times = normalizeTimes(config.scheduleTimes);
  let nextRun = '';
  if (config.scheduleEnabled && times.length) {
    const todayMinutes = now.getHours() * 60 + now.getMinutes();
    const next = times.find(time => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m > todayMinutes;
    });
    nextRun = next || `${times[0]} (amanha)`;
  }
  return { enabled: !!config.scheduleEnabled, times, nextRun };
}

function statePayload() {
  const config = readConfig();
  return {
    config: publicConfig(config),
    runtime: runtimeState,
    schedule: scheduleInfo(config),
    runningIds: [...running.keys()],
    version: app.getVersion(),
  };
}

function sendState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extractor:state', statePayload());
  }
  updateTrayMenu();
}

function sendLog(id, line, type = 'info') {
  const entry = { id, line: String(line || ''), type, timestamp: new Date().toISOString() };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('extractor:log', entry);
}

function sanitize(text, secrets = []) {
  let output = String(text || '');
  for (const secret of secrets.filter(value => value && String(value).length >= 4)) {
    output = output.split(String(secret)).join('***');
  }
  return output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}

function scriptPath(id) {
  return path.join(appRoot(), 'scripts', 'extracao', EXTRACTORS[id].script);
}

function nodePath() {
  return path.join(appRoot(), 'node_modules');
}

function validateExtractor(id, config) {
  const extractor = config.extractors[id];
  if (!EXTRACTORS[id]) throw new Error('Extrator desconhecido.');
  if (!extractor?.username) throw new Error(`Informe o usuario de ${EXTRACTORS[id].label}.`);
  if (!extractor?.password) throw new Error(`Informe a senha de ${EXTRACTORS[id].label}.`);
  if (!extractor?.outputDir) throw new Error(`Informe a pasta de saida de ${EXTRACTORS[id].label}.`);
  if (!fs.existsSync(scriptPath(id))) throw new Error(`Script nao encontrado: ${scriptPath(id)}`);
}

function detectFalseSuccess(output) {
  return /Total:\s*0\s+(?:capturados|registros)|\(0 registros\)|sessao redirecionada para login/i.test(output);
}

function runExtractorAttempt(id, extractor, password, logPath, attempt) {
  return new Promise(resolve => {
    const attemptStartedAt = Date.now();
    sendLog(id, `${EXTRACTORS[id].label}: iniciando tentativa ${attempt}.`, 'info');
    const child = spawn(process.execPath, [scriptPath(id)], {
      cwd: path.dirname(scriptPath(id)),
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: nodePath(),
        EXTRACAO_USUARIO: extractor.username,
        EXTRACAO_SENHA: password,
        EXTRACAO_OUTPUT_DIR: extractor.outputDir,
      },
    });
    running.set(id, child);
    let output = '';
    let spawnError = '';
    const secrets = [extractor.username, password];

    const capture = (chunk, type) => {
      const text = sanitize(chunk.toString(), secrets);
      output = (output + text).slice(-30000);
      fs.appendFileSync(logPath, text, 'utf8');
      text.split(/\r?\n/).filter(Boolean).forEach(line => sendLog(id, line, type));
    };

    child.stdout.on('data', chunk => capture(chunk, 'info'));
    child.stderr.on('data', chunk => capture(chunk, 'error'));
    child.on('error', error => {
      spawnError = error.message;
      capture(`\n${error.message}\n`, 'error');
    });
    child.on('close', code => {
      const falseSuccess = code === 0 && detectFalseSuccess(output);
      const validation = code === 0 && !falseSuccess && RETRYABLE_EXTRACTORS.has(id)
        ? validateCsvOutput(id, extractor.outputDir, { notBeforeMs: attemptStartedAt })
        : null;
      const ok = code === 0 && !falseSuccess && (!validation || validation.ok);
      const message = ok
        ? `Tentativa ${attempt} concluida${validation ? ` com ${validation.rows} registro(s)` : ''}.`
        : (spawnError || validation?.message || (falseSuccess
          ? 'O site redirecionou para o login ou retornou zero registros.'
          : `Falhou com codigo ${code}. Consulte o log.`));
      resolve({ id, ok, code, msg: message, logPath, validation });
    });
  });
}

async function waitForRetry(id) {
  const deadline = Date.now() + RETRY_DELAY_SECONDS * 1000;
  while (Date.now() < deadline) {
    if (cancelled.has(id) || quitting) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
  }
  return !cancelled.has(id) && !quitting;
}

async function runExtractor(id, trigger = 'manual') {
  if (running.has(id)) return { id, ok: false, msg: 'Este extrator ja esta em execucao.' };
  const config = readConfig();
  try {
    validateExtractor(id, config);
  } catch (error) {
    runtimeState[id] = { ...runtimeState[id], status: 'error', message: error.message, finishedAt: new Date().toISOString() };
    sendState();
    return { id, ok: false, msg: error.message };
  }

  const extractor = config.extractors[id];
  const password = decryptSecret(extractor.password);
  if (!password) return { id, ok: false, msg: `A senha de ${EXTRACTORS[id].label} nao pode ser descriptografada. Salve-a novamente.` };

  fs.mkdirSync(extractor.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logsDir(), `${id}_${stamp}.log`);
  const startedAt = new Date().toISOString();
  cancelled.delete(id);
  runtimeState[id] = { status: 'running', startedAt, finishedAt: '', message: trigger === 'schedule' ? 'Executando pela agenda' : 'Executando agora', logPath };
  sendState();
  sendLog(id, `${EXTRACTORS[id].label}: execucao iniciada (${trigger}).`, 'info');

  let attempt = 0;
  let result = null;
  while (!cancelled.has(id) && !quitting) {
    attempt += 1;
    result = await runExtractorAttempt(id, extractor, password, logPath, attempt);
    if (result.ok || !RETRYABLE_EXTRACTORS.has(id)) break;
    if (MAX_RETRY_ATTEMPTS > 0 && attempt >= MAX_RETRY_ATTEMPTS) break;

    const message = `${result.msg} Nova tentativa em ${RETRY_DELAY_SECONDS}s.`;
    runtimeState[id] = { ...runtimeState[id], status: 'running', message, logPath };
    sendLog(id, message, 'error');
    sendState();
    running.set(id, { kill: () => cancelled.add(id) });
    if (!await waitForRetry(id)) break;
  }

  running.delete(id);
  const wasCancelled = cancelled.delete(id) || quitting;
  const ok = !wasCancelled && !!result?.ok;
  const message = wasCancelled
    ? 'Extracao cancelada.'
    : (ok ? `Concluido. Arquivos salvos em ${extractor.outputDir}` : (result?.msg || 'Extracao encerrada com erro.'));
  runtimeState[id] = { ...runtimeState[id], status: ok ? 'success' : (wasCancelled ? 'idle' : 'error'), finishedAt: new Date().toISOString(), message, logPath };
  sendLog(id, message, ok ? 'success' : 'error');
  sendState();
  return { id, ok, code: result?.code, msg: message, logPath };
}

async function runMany(ids, trigger = 'manual') {
  const selected = [...new Set((ids || []).filter(id => EXTRACTORS[id]))];
  if (!selected.length) return { ok: false, msg: 'Selecione pelo menos um extrator.' };
  const results = await Promise.all(selected.map(id => runExtractor(id, trigger)));
  const successes = results.filter(result => result.ok).length;
  if (Notification.isSupported()) {
    new Notification({
      title: 'Extracao finalizada',
      body: `${successes}/${results.length} extrator(es) concluidos com sucesso.`,
    }).show();
  }
  return { ok: successes === results.length, successes, total: results.length, results };
}

function schedulerTick() {
  const config = readConfig();
  if (!config.scheduleEnabled || running.size) return;
  const now = new Date();
  const currentTime = formatLocalTime(now);
  if (!normalizeTimes(config.scheduleTimes).includes(currentTime)) return;
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${currentTime}`;
  if (lastScheduleKey === key) return;
  lastScheduleKey = key;
  const ids = Object.keys(EXTRACTORS).filter(id => config.extractors[id]?.enabled);
  sendLog('system', `Agenda acionada as ${currentTime}.`, 'info');
  runMany(ids, 'schedule').catch(error => sendLog('system', error.message, 'error'));
}

function startScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(schedulerTick, 10000);
  schedulerTick();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#0a0d12',
    icon: assetPath('icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    const config = readConfig();
    if (!quitting && config.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    } else if (!quitting) {
      quitting = true;
      app.quit();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const isRunning = running.size > 0;
  tray.setToolTip(isRunning ? `Extrator Agendado - ${running.size} em execucao` : 'Extrator Agendado de Bases');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Rodar habilitados agora', enabled: !isRunning, click: () => {
      const config = readConfig();
      runMany(Object.keys(EXTRACTORS).filter(id => config.extractors[id]?.enabled));
    } },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(assetPath('icon.ico'));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  updateTrayMenu();
}

ipcMain.handle('extractor:get-state', () => statePayload());
ipcMain.handle('extractor:choose-folder', async (_, currentPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha a pasta de saida',
    defaultPath: currentPath || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});
ipcMain.handle('extractor:open-folder', async (_, folderPath) => {
  if (!folderPath) return { ok: false };
  fs.mkdirSync(folderPath, { recursive: true });
  const error = await shell.openPath(folderPath);
  return { ok: !error, msg: error };
});
ipcMain.handle('extractor:save-config', (_, incoming = {}) => {
  const current = readConfig();
  const next = {
    ...current,
    scheduleEnabled: incoming.scheduleEnabled === true,
    scheduleTimes: normalizeTimes(incoming.scheduleTimes),
    startWithWindows: incoming.startWithWindows === true,
    closeToTray: incoming.closeToTray !== false,
    extractors: { ...current.extractors },
  };
  for (const id of Object.keys(EXTRACTORS)) {
    const source = incoming.extractors?.[id] || {};
    const existing = current.extractors[id];
    next.extractors[id] = {
      enabled: source.enabled !== false,
      username: String(source.username || '').trim(),
      password: source.password ? encryptSecret(source.password) : existing.password,
      outputDir: path.resolve(String(source.outputDir || existing.outputDir)),
    };
  }
  writeConfig(next);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: next.startWithWindows, openAsHidden: true });
  sendState();
  return { ok: true, state: statePayload() };
});
ipcMain.handle('extractor:run', (_, ids) => runMany(ids, 'manual'));
ipcMain.handle('extractor:cancel', (_, id) => {
  const child = running.get(id);
  if (!child) return { ok: false, msg: 'Extrator nao esta em execucao.' };
  cancelled.add(id);
  child.kill();
  return { ok: true };
});
ipcMain.handle('extractor:quit', () => { quitting = true; app.quit(); return true; });

app.whenReady().then(() => {
  createWindow();
  createTray();
  startScheduler();
  if (process.argv.includes('--smoke-test') || process.env.EXTRACTOR_SMOKE_TEST === '1') {
    setTimeout(() => {
      quitting = true;
      if (schedulerTimer) clearInterval(schedulerTimer);
      if (tray) tray.destroy();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.exit(0);
    }, 2500);
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on('window-all-closed', event => event?.preventDefault?.());
app.on('before-quit', () => {
  quitting = true;
  for (const child of running.values()) child.kill();
});
