const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { BASE_DIR, ensureDir, launchChromium, requireCredentials } = require('./shared');

const DOWNLOAD_DIR = process.env.EXTRACAO_OUTPUT_DIR || path.join(BASE_DIR, 'SITE NOVO');
const EXPORT_ENDPOINT = '/Backoffice/screenservices/Backoffice/MainFlow/BuscaSolicitacoes/ActionExportarListaDeSolicitacoes';
const DEFAULT_EXPORT_VERSION_INFO = {
  moduleVersion: 'XrFzPehIB7VIKKcE06g58g',
  apiVersion: '+5Xrti_YkghWxoa0qlNQ5A',
};
const RETRY_DELAY_MS = Number(process.env.EXTRACAO_SITE_NOVO_RETRY_MS) || 30000;
const MAX_TENTATIVAS = Number(process.env.EXTRACAO_SITE_NOVO_MAX_TENTATIVAS) || 3;
const MIN_EXCEL_FILE_SIZE_BYTES = 1024;
const ETAPAS = [
  { isCredenciado: 0, situacaoIdentifier: 4, nomeFinal: '01_Todos_Aberto' },
  { isCredenciado: 0, situacaoIdentifier: 3, nomeFinal: '02_Todos_Pendente' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getArquivoFinal(nomeFinal) {
  return path.join(DOWNLOAD_DIR, `${nomeFinal}.xls`);
}

function arquivoExcelValido(filePath, minMtimeMs = 0) {
  let fd;
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < MIN_EXCEL_FILE_SIZE_BYTES) return false;
    if (minMtimeMs && stats.mtimeMs < minMtimeMs) return false;

    const signature = Buffer.alloc(4);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, signature, 0, 4, 0);
    return (signature[0] === 0x50 && signature[1] === 0x4B)
      || (signature[0] === 0xD0 && signature[1] === 0xCF && signature[2] === 0x11 && signature[3] === 0xE0);
  } catch (_) {
    return false;
  } finally {
    if (fd) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function getEtapasPendentes(minMtimeMs) {
  return ETAPAS.filter(etapa => !arquivoExcelValido(getArquivoFinal(etapa.nomeFinal), minMtimeMs));
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPeriodoAtual() {
  return {
    startDate: process.env.EXTRACAO_SITE_NOVO_START_DATE || '2026-01-01',
    endDate: toDateOnly(new Date()),
  };
}

async function typeIfEmpty(page, selector, value) {
  if (!(await page.locator(selector).count())) return;
  const current = await page.inputValue(selector).catch(() => '');
  if (!current) await page.fill(selector, value);
}

async function performLogin(page) {
  const { username, password } = requireCredentials();
  console.log('Fazendo login no Site Novo...');
  if (await page.locator('#Dropdown_EstadoOperacao').count()) {
    await page.selectOption('#Dropdown_EstadoOperacao', '3').catch(() => {});
    await page.dispatchEvent('#Dropdown_EstadoOperacao', 'change').catch(() => {});
  }
  await typeIfEmpty(page, '#Input_Username', username);
  await typeIfEmpty(page, '#Input_Password', password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForSelector('#Dropdown1', { timeout: 60000 });
}

async function ensureLogged(page) {
  const URL_LOGIN = 'https://agenciavirtual.equatorialenergia.com.br/Backoffice/Login';
  const DOMINIO = 'equatorialenergia.com.br';

  if (!page.url().includes(DOMINIO)) {
    console.log('Indo para o Site Novo...');
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  let state = 'UNKNOWN';
  try {
    await Promise.race([
      page.waitForSelector('#Dropdown1', { timeout: 20000 }).then(() => { state = 'LOGGED'; }),
      page.waitForSelector('#Input_Username', { timeout: 20000 }).then(() => { state = 'LOGIN'; }),
    ]);
  } catch (_) {}

  if (state === 'LOGIN') {
    await performLogin(page);
  } else if (state !== 'LOGGED') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('#Dropdown1', { timeout: 60000 });
  }
}

async function forceRelogin(page) {
  const URL_LOGIN = 'https://agenciavirtual.equatorialenergia.com.br/Backoffice/Login';
  console.log('Sessao sem perfil BackOffice. Refazendo login...');
  await page.context().clearCookies().catch(() => {});
  await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('#Input_Username', { timeout: 60000 });
  await performLogin(page);
}

async function getExportVersionInfo(page) {
  return page.evaluate(async (fallback) => {
    let moduleVersion = fallback.moduleVersion;
    try {
      const appInfoKey = Object.keys(localStorage).find(key => key.endsWith('$ApplicationInfo'));
      const appInfo = appInfoKey ? JSON.parse(localStorage.getItem(appInfoKey)) : null;
      moduleVersion = appInfo?.manifest?.versionToken || moduleVersion;
    } catch (_) {}

    try {
      const resources = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => url.includes('/Backoffice/') && url.includes('.js'));
      for (const url of Array.from(new Set(resources))) {
        const script = await fetch(url).then(response => response.text());
        const match = script.match(/ActionExportarListaDeSolicitacoes","([^"]+)"/);
        if (match) return { moduleVersion, apiVersion: match[1] };
      }
    } catch (_) {}
    return { moduleVersion, apiVersion: fallback.apiVersion };
  }, DEFAULT_EXPORT_VERSION_INFO);
}

async function postExport(page, endpoint, payload) {
  return page.evaluate(async ({ endpoint, payload }) => {
    async function attempt(useAuthorization) {
      const tokenData = JSON.parse(localStorage.getItem('os-runtime-token') || '{}');
      const headers = { 'content-type': 'application/json; charset=UTF-8' };
      if (useAuthorization && tokenData.access_token) {
        headers.authorization = `Bearer ${tokenData.access_token}`;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    }

    let result = await attempt(true);
    if (result.status === 401) result = await attempt(false);
    if (!result.ok) throw new Error(`Exportacao falhou (${result.status}): ${result.text.slice(0, 500)}`);
    return JSON.parse(result.text);
  }, { endpoint, payload });
}

function findExcelBase64(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 1000 && (/^(UEs|0M8R)/.test(trimmed))) return trimmed;
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findExcelBase64(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/excel|file|arquivo/i.test(key)) {
        const found = findExcelBase64(item, depth + 1);
        if (found) return found;
      }
    }
    for (const item of Object.values(value)) {
      const found = findExcelBase64(item, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function describeResponseShape(value) {
  if (!value || typeof value !== 'object') return typeof value;
  const shape = Object.entries(value).slice(0, 12).map(([key, item]) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return `${key}{${Object.keys(item).slice(0, 8).join(',')}}`;
    }
    if (Array.isArray(item)) return `${key}[${item.length}]`;
    if (typeof item === 'string') return `${key}:string(${item.length})`;
    return `${key}:${typeof item}`;
  }).join(' | ');
  const exception = value.exception?.message || value.Exception?.Message || value.error?.message || '';
  return exception ? `${shape} | mensagem=${String(exception).slice(0, 300)}` : shape;
}

async function baixarEtapa(page, exportVersionInfo, periodo, etapa) {
  const { isCredenciado, situacaoIdentifier, nomeFinal } = etapa;
  console.log(`Iniciando etapa: ${nomeFinal}...`);

  const payload = {
    versionInfo: exportVersionInfo,
    viewName: 'MainFlow.BuscaSolicitacoes',
    inputParameters: {
      ProtocoloSolicitacao: '',
      ContaContrato: '',
      Email: '',
      SituacaoIdentifier: situacaoIdentifier,
      IsCredenciado: isCredenciado,
      ServicoIdentifier: '0',
      UFIdentifier: '0',
      EndDate: periodo.endDate,
      StartDate: periodo.startDate,
    },
  };

  let resultado;
  try {
    resultado = await postExport(page, EXPORT_ENDPOINT, payload);
  } catch (error) {
    if (!String(error.message).includes('(401)')) throw error;
    console.log(`${nomeFinal}: 401 recebido. Atualizando sessao e tentando novamente...`);
    await ensureLogged(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    resultado = await postExport(page, EXPORT_ENDPOINT, payload);
  }

  let excelBase64 = resultado?.data?.ExcelFile || findExcelBase64(resultado);
  const exceptionMessage = resultado?.exception?.message || '';
  if (!excelBase64 && /BackOffice role required|shouldRefreshToken/i.test(`${exceptionMessage} ${resultado?.shouldRefreshToken || ''}`)) {
    await forceRelogin(page);
    payload.versionInfo = await getExportVersionInfo(page);
    resultado = await postExport(page, EXPORT_ENDPOINT, payload);
    excelBase64 = resultado?.data?.ExcelFile || findExcelBase64(resultado);
  }
  if (!excelBase64) {
    throw new Error(`A rota de exportacao nao retornou arquivo para ${nomeFinal}. Estrutura: ${describeResponseShape(resultado)}`);
  }

  const finalPath = getArquivoFinal(nomeFinal);
  const tempPath = `${finalPath}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(excelBase64, 'base64'));
  if (!arquivoExcelValido(tempPath)) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw new Error(`Arquivo gerado invalido ou incompleto: ${finalPath}`);
  }
  fs.renameSync(tempPath, finalPath);
  console.log(`SUCESSO: ${nomeFinal}.xls`);
}

async function run() {
  ensureDir(DOWNLOAD_DIR);
  console.log(`Pasta de saida: ${DOWNLOAD_DIR}`);
  const startedAt = Date.now();
  const useCdp = process.env.EXTRACAO_SITE_NOVO_CDP === '1';
  console.log(useCdp ? 'Conectando ao navegador Site Novo na porta 9222...' : 'Abrindo navegador proprio para o Site Novo...');

  const browser = useCdp
    ? await chromium.connectOverCDP('http://localhost:9222')
    : await launchChromium(chromium);

  try {
    const context = useCdp ? (browser.contexts()[0] || await browser.newContext()) : await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront();
    await ensureLogged(page);

    const periodo = getPeriodoAtual();
    console.log(`Pasta: ${DOWNLOAD_DIR}`);
    console.log(`Periodo: ${periodo.startDate} ate ${periodo.endDate}`);

    let etapasParaRodar = ETAPAS;
    let tentativa = 1;
    while (true) {
      console.log(`Tentativa geral ${tentativa}...`);
      const exportVersionInfo = await getExportVersionInfo(page);

      for (const etapa of etapasParaRodar) {
        try {
          await baixarEtapa(page, exportVersionInfo, periodo, etapa);
        } catch (error) {
          console.error(`ERRO na etapa ${etapa.nomeFinal}: ${error.message}`);
        }
      }

      const pendentes = getEtapasPendentes(startedAt);
      if (!pendentes.length) {
        console.log(`Validacao final OK: ${ETAPAS.length} arquivos atualizados e validos.`);
        return;
      }

      console.error(`Ainda faltam ou estao invalidos: ${pendentes.map(e => `${e.nomeFinal}.xls`).join(', ')}`);
      if (tentativa >= MAX_TENTATIVAS) {
        throw new Error(`Site Novo falhou apos ${MAX_TENTATIVAS} tentativa(s): ${pendentes.map(e => `${e.nomeFinal}.xls`).join(', ')}`);
      }
      etapasParaRodar = pendentes;
      tentativa++;
      await sleep(RETRY_DELAY_MS);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch(error => {
  console.error(`Site Novo erro fatal: ${error.message}`);
  process.exit(1);
});
