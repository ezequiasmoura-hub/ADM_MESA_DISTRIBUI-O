const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}

// ── Carrega .env da pasta do projeto e do inputMesa como fallback ─────────────
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, 'inputMesa', '.env') });
require('dotenv').config({ path: path.join(app.getPath('userData'), '.env') });
require('dotenv').config({ path: path.join(app.getPath('userData'), 'inputMesa', '.env') });

let mainWindow;
let autoTimer = null;
const runningExtractions = new Set();
const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
let updateCheckInProgress = false;
const updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: '',
  percent: 0,
  msg: 'Atualizacoes automaticas aguardando.',
};

// ── Genesys: conecta usando EXATAMENTE o mesmo método do index.js funcional ──
// platformClient.PureCloudRegionHosts[ORG_REGION] é o enum correto do SDK
async function genesysLogin(platformClient) {
  const client = platformClient.ApiClient.instance;
  const region = CONFIG.ORG_REGION || process.env.ORG_REGION;
  // Usa o enum do SDK — mesma forma do index.js que funciona
  client.setEnvironment(platformClient.PureCloudRegionHosts[region]);
  await client.loginClientCredentialsGrant(CONFIG.CLIENT_ID, CONFIG.CLIENT_SECRET);
  return { client, region };
}

// ─── CONFIG: padrão lido do .env, sobrescrito pela UI ────────────────────────
const DEFAULT_SITE_NOVO_XLS_PATHS = [
  "H:\\TEMOTEO - NAO ABRA\\Base\\SITE NOVO\\01_Todos_Aberto.xls",
  "H:\\TEMOTEO - NAO ABRA\\Base\\SITE NOVO\\02_Todos_Pendente.xls",
];

const LEGACY_MESA_QUEUE_IDS = [
  '16670797-0795-4ddb-b93d-b307e8efa5fa', // AL
  '6e005f7c-56a9-4bbf-8c3e-7d2dcd5ffbc3', // MA
  '6fd1d9e1-241b-4e27-94f7-c20e736c65d0', // PA
  '291d0f7e-8d2d-4b0c-a126-fbfaefc7c677', // PI
  '9708283f-1ced-45de-9639-60fbcf6fbb24', // CEA
  '122915bd-9047-4730-890a-908a42cfd5f1', // CEEE
  'e9bf42cd-e23f-4d70-ac0d-2ad60602ba9f', // CSA
  '4f25f041-e80d-4554-9a79-a358ad85d686', // GO
];

const EXTRACTION_IDS = ['siteNovo', 'siteAntigo', 'go', 'rs'];
const EXTRACTION_ENV_KEYS = {
  siteNovo: 'SITE_NOVO',
  siteAntigo: 'SITE_ANTIGO',
  go: 'GO',
  rs: 'RS',
};

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : fallback;
}

function defaultExtractionCredential(id) {
  const key = EXTRACTION_ENV_KEYS[id];
  return {
    username: envFirst(`EXTRACAO_${key}_USUARIO`, 'EXTRACAO_USUARIO', 'RPA_USUARIO'),
    password: envFirst(`EXTRACAO_${key}_SENHA`, 'EXTRACAO_SENHA', 'RPA_SENHA'),
  };
}

function defaultExtractionScript(id, label, fileName) {
  const key = EXTRACTION_ENV_KEYS[id];
  const configuredPath = envFirst(`EXTRACAO_${key}_SCRIPT`, `EXTRACAO_${key}_SCRIPT_PATH`);
  const scriptPath = configuredPath || path.join(__dirname, 'scripts', 'extracao', fileName);
  return {
    label,
    runtime: 'node',
    path: scriptPath,
    cwd: envFirst(`EXTRACAO_${key}_CWD`) || path.dirname(scriptPath),
  };
}

let CONFIG = {
  PATH_PRIORIZACAO : "H:\\TEMOTEO - NAO ABRA\\Base\\PRIORIZAÇÃO_MESA_BKO.xlsx",
  PATH_EQTL_RS     : "H:\\TEMOTEO - NAO ABRA\\Base\\EQTL_RS.csv",
  PATH_EQTL_GO     : "H:\\TEMOTEO - NAO ABRA\\Base\\EQTL_GO.csv",
  PATH_BKO_ALL     : "H:\\TEMOTEO - NAO ABRA\\Base\\bko_all.csv",
  PATHS_XLS        : [...DEFAULT_SITE_NOVO_XLS_PATHS],
  INPUT_MESA_DIR   : process.env.INPUT_MESA_DIR || '',
  LOG_DIR          : process.env.LOG_DIR || '',
  // Lê do .env — mesmas variáveis do index.js funcional
  ORG_REGION       : process.env.ORG_REGION     || 'sa_east_1',
  CLIENT_ID        : process.env.CLIENT_ID       || '',
  CLIENT_SECRET    : process.env.CLIENT_SECRET   || '',
  // QUEUE_IDs: suporta QUEUE_ID (singular) ou QUEUE_IDS (plural, separado por vírgula)
  QUEUE_IDS        : process.env.QUEUE_IDS
    ? process.env.QUEUE_IDS.split(',').map(s => s.trim())
    : process.env.QUEUE_ID
      ? [process.env.QUEUE_ID]
      : [
          "16670797-0795-4ddb-b93d-b307e8efa5fa",
          "4f25f041-e80d-4554-9a79-a358ad85d686",
          "6e005f7c-56a9-4bbf-8c3e-7d2dcd5ffbc3",
          "6fd1d9e1-241b-4e27-94f7-c20e736c65d0",
          "291d0f7e-8d2d-4b0c-a126-fbfaefc7c677",
          "9708283f-1ced-45de-9639-60fbcf6fbb24",
          "122915bd-9047-4730-890a-908a42cfd5f1",
          "e9bf42cd-e23f-4d70-ac0d-2ad60602ba9f"
        ],
  EXTRACTION_SCRIPTS: {
    siteNovo: defaultExtractionScript('siteNovo', 'Site Novo', 'site-novo.js'),
    siteAntigo: defaultExtractionScript('siteAntigo', 'Site Antigo - BKO All', 'site-antigo.js'),
    go: defaultExtractionScript('go', 'GO', 'go.js'),
    rs: defaultExtractionScript('rs', 'RS / CEEE', 'rs.js'),
  },
  EXTRACTION_CREDENTIALS: {
    siteNovo: defaultExtractionCredential('siteNovo'),
    siteAntigo: defaultExtractionCredential('siteAntigo'),
    go: defaultExtractionCredential('go'),
    rs: defaultExtractionCredential('rs'),
  },
  NODE_BIN         : process.env.NODE_BIN || 'node',
  MESA_DETAIL_RETRIES: process.env.MESA_DETAIL_RETRIES === '0' ? 0 : (Number(process.env.MESA_DETAIL_RETRIES) || 30),
  MESA_DETAIL_RETRY_DELAY_MS: Number(process.env.MESA_DETAIL_RETRY_DELAY_MS) || 1500,
  MESA_PROTOCOL_CONCURRENCY: Number(process.env.MESA_PROTOCOL_CONCURRENCY) || 12,
  MESA_PROTOCOL_INTERVAL_DAYS: Number(process.env.MESA_PROTOCOL_INTERVAL_DAYS) || 30,
  MESA_UPLOAD_STRATEGY: process.env.MESA_UPLOAD_STRATEGY || 'paced',
  MESA_UPLOAD_CREDENTIALS: process.env.MESA_UPLOAD_CREDENTIALS_JSON || process.env.MESA_UPLOAD_CREDENTIALS || '',
  MESA_UPLOAD_WORKERS: Math.max(1, envNumber('MESA_UPLOAD_WORKERS', 5)),
  MESA_UPLOAD_INTERVAL_SECONDS: Math.max(0, envNumber('MESA_UPLOAD_INTERVAL_SECONDS', 2)),
  MESA_UPLOAD_BATCH_PAUSE_SECONDS: Math.max(0, envNumber('MESA_UPLOAD_BATCH_PAUSE_SECONDS', 2)),
  MESA_UPLOAD_TIMEOUT_MINUTES: Math.max(0, envNumber('MESA_UPLOAD_TIMEOUT_MINUTES', 0)),
  CLEANUP_CONCURRENCY: Math.max(1, envNumber('CLEANUP_CONCURRENCY', 10)),
  CLEANUP_RATE_LIMIT_PER_MINUTE: Math.max(1, envNumber('CLEANUP_RATE_LIMIT_PER_MINUTE', 280)),
  CLEANUP_RATE_LIMIT_FALLBACK_SECONDS: Math.max(1, envNumber('CLEANUP_RATE_LIMIT_FALLBACK_SECONDS', 30)),
  CLEANUP_START_INTERVAL_MS: Math.max(0, envNumber('CLEANUP_START_INTERVAL_MS', 0)),
  CLEANUP_QUEUE_IDS: process.env.CLEANUP_QUEUE_IDS
    ? process.env.CLEANUP_QUEUE_IDS.split(',').map(s => s.trim()).filter(Boolean)
    : [...LEGACY_MESA_QUEUE_IDS],
  AUTO_INTERVAL_MIN: 30,
  UI_THEME: process.env.UI_THEME || 'dark',
};

const CONFIG_PATH = path.join(app.getPath('userData'), 'mesa_config.json');
const DEFAULT_EXTRACTION_SCRIPTS = JSON.parse(JSON.stringify(CONFIG.EXTRACTION_SCRIPTS));
const DEFAULT_EXTRACTION_CREDENTIALS = JSON.parse(JSON.stringify(CONFIG.EXTRACTION_CREDENTIALS));

const ALLOWED_CONFIG_KEYS = new Set([
  'PATH_PRIORIZACAO',
  'PATH_EQTL_RS',
  'PATH_EQTL_GO',
  'PATH_BKO_ALL',
  'PATHS_XLS',
  'INPUT_MESA_DIR',
  'LOG_DIR',
  'ORG_REGION',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'QUEUE_IDS',
  'EXTRACTION_SCRIPTS',
  'EXTRACTION_CREDENTIALS',
  'NODE_BIN',
  'MESA_DETAIL_RETRIES',
  'MESA_DETAIL_RETRY_DELAY_MS',
  'MESA_PROTOCOL_CONCURRENCY',
  'MESA_PROTOCOL_INTERVAL_DAYS',
  'MESA_UPLOAD_STRATEGY',
  'MESA_UPLOAD_CREDENTIALS',
  'MESA_UPLOAD_WORKERS',
  'MESA_UPLOAD_INTERVAL_SECONDS',
  'MESA_UPLOAD_BATCH_PAUSE_SECONDS',
  'MESA_UPLOAD_TIMEOUT_MINUTES',
  'CLEANUP_CONCURRENCY',
  'CLEANUP_RATE_LIMIT_PER_MINUTE',
  'CLEANUP_RATE_LIMIT_FALLBACK_SECONDS',
  'CLEANUP_START_INTERVAL_MS',
  'CLEANUP_QUEUE_IDS',
  'AUTO_INTERVAL_MIN',
  'UI_THEME',
]);

const CSV_HEADER_MESA = [
  'Regiao', 'Nota', 'Conclusao_desejada', 'Mandante', 'Protocolo', 'Tipo_de_servico',
  'Coluna', 'Dados', 'Skill', 'Fluxo', 'Prioridade', 'STATUS_PRAZO_MESA'
];

const BI_MESA_EXCLUDED_SERVICES = [
  'Cadastro baixa renda',
  'Cadastro de Comunicadores',
  'Problemas com Login',
  'Agencia Web',
  'Agência Web',
];

const DEFAULT_QUEUE_META = {
  '16670797-0795-4ddb-b93d-b307e8efa5fa': { empresa: 'AL', nome: 'Mesa Distribuicao - Backoffice Varejo AL' },
  '4f25f041-e80d-4554-9a79-a358ad85d686': { empresa: 'GO', nome: 'Mesa Distribuicao - Backoffice Varejo GO' },
  '6e005f7c-56a9-4bbf-8c3e-7d2dcd5ffbc3': { empresa: 'MA', nome: 'Mesa Distribuicao - Backoffice Varejo MA' },
  '6fd1d9e1-241b-4e27-94f7-c20e736c65d0': { empresa: 'PA', nome: 'Mesa Distribuicao - Backoffice Varejo PA' },
  '291d0f7e-8d2d-4b0c-a126-fbfaefc7c677': { empresa: 'PI', nome: 'Mesa Distribuicao - Backoffice Varejo PI' },
  '9708283f-1ced-45de-9639-60fbcf6fbb24': { empresa: 'CEA', nome: 'Mesa Distribuicao - Backoffice Varejo CEA' },
  '122915bd-9047-4730-890a-908a42cfd5f1': { empresa: 'CEEE', nome: 'Mesa Distribuicao - Backoffice Varejo CEEE' },
  'e9bf42cd-e23f-4d70-ac0d-2ad60602ba9f': { empresa: 'CSA', nome: 'Mesa Distribuicao - Backoffice Varejo CSA' },
};
const DEFAULT_CLEANUP_QUEUE_IDS = [...LEGACY_MESA_QUEUE_IDS];

function queueConfigLines(raw) {
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return values
    .flatMap(value => String(value || '').split(/[\n,;]/))
    .map(value => value.trim())
    .filter(Boolean);
}

function parseQueueConfigLine(line) {
  const parts = String(line || '').split('|').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return { id: parts[0], empresa: '', nome: '' };
  return {
    empresa: parts[0].toUpperCase(),
    nome: parts.length > 2 ? parts.slice(1, -1).join(' | ') : '',
    id: parts[parts.length - 1],
  };
}

function queueEntriesFrom(raw) {
  const seen = new Set();
  const entries = [];
  for (const line of queueConfigLines(raw)) {
    const entry = parseQueueConfigLine(line);
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function normalizeQueueIdList(raw) {
  return queueEntriesFrom(raw).map(entry => entry.id);
}

function sameQueueSet(a, b) {
  const left = [...new Set(normalizeQueueIdList(a))].sort();
  const right = [...new Set(normalizeQueueIdList(b))].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function isDefaultCleanupQueueList(raw) {
  return sameQueueSet(raw, DEFAULT_CLEANUP_QUEUE_IDS);
}

function getQueueIds() {
  const configured = normalizeQueueIdList(CONFIG.QUEUE_IDS);
  return configured.length ? configured : Object.keys(DEFAULT_QUEUE_META);
}

function getCleanupQueueIds() {
  const cleanup = normalizeQueueIdList(CONFIG.CLEANUP_QUEUE_IDS);
  const primary = normalizeQueueIdList(CONFIG.QUEUE_IDS);
  if (cleanup.length && !isDefaultCleanupQueueList(cleanup)) return cleanup;
  if (primary.length && !isDefaultCleanupQueueList(primary)) return primary;
  if (cleanup.length) return cleanup;
  return primary.length ? primary : [...DEFAULT_CLEANUP_QUEUE_IDS];
}

function queueConfigDisplayLines(raw, effectiveIds) {
  const lines = queueConfigLines(raw);
  if (lines.length && !isDefaultCleanupQueueList(lines)) return lines;
  return effectiveIds || [];
}

function getQueueMeta(queueId) {
  const configuredEntries = [
    ...queueEntriesFrom(CONFIG.QUEUE_IDS),
    ...queueEntriesFrom(CONFIG.CLEANUP_QUEUE_IDS),
  ];
  const configured = configuredEntries.reverse().find(entry => entry.id === queueId);
  const fallback = DEFAULT_QUEUE_META[queueId] || {};
  return {
    empresa: configured?.empresa || fallback.empresa || '',
    nome: configured?.nome || fallback.nome || '',
  };
}

function isConfiguredQueueId(queueId) {
  if (!queueId) return false;
  const ids = new Set([...getQueueIds(), ...getCleanupQueueIds(), ...Object.keys(DEFAULT_QUEUE_META)]);
  return ids.has(queueId);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInputMesaDir() {
  const configured = String(CONFIG.INPUT_MESA_DIR || process.env.INPUT_MESA_DIR || '').trim();
  if (configured) return configured;
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'inputMesa')
    : path.join(__dirname, 'inputMesa');
}

function getLogDir(...parts) {
  const configured = String(CONFIG.LOG_DIR || process.env.LOG_DIR || '').trim();
  const root = configured || path.join(app.getPath('userData'), 'logs');
  return path.join(root, ...parts);
}

function countMesaUploadCredentials(raw) {
  const text = String(raw || '').trim();
  if (!text) return CONFIG.CLIENT_ID && CONFIG.CLIENT_SECRET ? 1 : 0;
  try {
    if (text.startsWith('[')) {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.length : 0;
    }
  } catch (_) {
    return 0;
  }
  return text.split(/\r?\n|;/).map(line => line.trim()).filter(Boolean).length;
}

function createPublicConfig() {
  const extractionCredentials = {};
  for (const id of EXTRACTION_IDS) {
    const current = CONFIG.EXTRACTION_CREDENTIALS?.[id] || {};
    extractionCredentials[id] = {
      username: current.username || '',
      password: '',
      passwordConfigured: !!current.password,
    };
  }

  return {
    ...CONFIG,
    CLIENT_SECRET: '',
    CLIENT_SECRET_CONFIGURED: !!CONFIG.CLIENT_SECRET,
    MESA_UPLOAD_CREDENTIALS: '',
    MESA_UPLOAD_CREDENTIALS_CONFIGURED: countMesaUploadCredentials(CONFIG.MESA_UPLOAD_CREDENTIALS),
    EXTRACTION_CREDENTIALS: extractionCredentials,
    QUEUE_IDS: queueConfigDisplayLines(CONFIG.QUEUE_IDS, getQueueIds()),
    CLEANUP_QUEUE_IDS: queueConfigDisplayLines(CONFIG.CLEANUP_QUEUE_IDS, getCleanupQueueIds()),
    INPUT_MESA_DIR_EFFECTIVE: getInputMesaDir(),
    LOG_DIR_EFFECTIVE: getLogDir(),
  };
}

function getNodeExecution() {
  const configured = String(CONFIG.NODE_BIN || '').trim();
  if (configured && configured !== 'node') {
    return { command: configured, env: {} };
  }
  if (app.isPackaged) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: configured || 'node', env: {} };
}

function getBundledNodeModulesDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'node_modules')
    : path.join(__dirname, 'node_modules');
}

function mergeNodePath(...dirs) {
  return [...dirs, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
}

function getExtractionNodeArgs() {
  const preload = path.join(__dirname, 'scripts', 'extracao', 'playwright-fallback.js');
  return fs.existsSync(preload) ? ['--require', preload] : [];
}

function normalizePathCompare(p) {
  return String(p || '').replace(/\//g, '\\').toLowerCase();
}

function isLegacySiteNovoXlsPath(p) {
  const normalized = normalizePathCompare(p);
  return normalized.includes('\\base\\bases divididas\\')
    || /\\0[1-4]_(sim|nao)_(aberto|pendente)\.xls$/.test(normalized);
}

function normalizeConfigAfterLoad() {
  CONFIG.INPUT_MESA_DIR = String(CONFIG.INPUT_MESA_DIR || '').trim();
  CONFIG.LOG_DIR = String(CONFIG.LOG_DIR || '').trim();
  if (!Array.isArray(CONFIG.PATHS_XLS) || !CONFIG.PATHS_XLS.length || CONFIG.PATHS_XLS.some(isLegacySiteNovoXlsPath)) {
    CONFIG.PATHS_XLS = [...DEFAULT_SITE_NOVO_XLS_PATHS];
  }
  CONFIG.EXTRACTION_SCRIPTS = {
    ...DEFAULT_EXTRACTION_SCRIPTS,
    ...(CONFIG.EXTRACTION_SCRIPTS || {}),
  };
  for (const id of Object.keys(DEFAULT_EXTRACTION_SCRIPTS)) {
    const current = CONFIG.EXTRACTION_SCRIPTS[id] || {};
    const fallback = DEFAULT_EXTRACTION_SCRIPTS[id];
    const scriptPath = String(current.path || '').trim() || fallback.path;
    CONFIG.EXTRACTION_SCRIPTS[id] = {
      ...fallback,
      ...current,
      runtime: 'node',
      path: scriptPath,
      cwd: String(current.cwd || '').trim() || path.dirname(scriptPath),
    };
  }
  CONFIG.EXTRACTION_CREDENTIALS = {
    ...DEFAULT_EXTRACTION_CREDENTIALS,
    ...(CONFIG.EXTRACTION_CREDENTIALS || {}),
  };
  for (const id of EXTRACTION_IDS) {
    const defaults = DEFAULT_EXTRACTION_CREDENTIALS[id] || {};
    const current = CONFIG.EXTRACTION_CREDENTIALS[id] || {};
    CONFIG.EXTRACTION_CREDENTIALS[id] = {
      username: current.username || defaults.username || '',
      password: current.password || defaults.password || '',
    };
  }
  CONFIG.QUEUE_IDS = queueConfigLines(CONFIG.QUEUE_IDS);
  if (!Array.isArray(CONFIG.CLEANUP_QUEUE_IDS)) CONFIG.CLEANUP_QUEUE_IDS = [...DEFAULT_CLEANUP_QUEUE_IDS];
  CONFIG.CLEANUP_QUEUE_IDS = queueConfigLines(CONFIG.CLEANUP_QUEUE_IDS);
  CONFIG.MESA_UPLOAD_STRATEGY = ['paced', 'batch', 'serial'].includes(CONFIG.MESA_UPLOAD_STRATEGY)
    ? CONFIG.MESA_UPLOAD_STRATEGY
    : 'paced';
  CONFIG.MESA_UPLOAD_CREDENTIALS = String(CONFIG.MESA_UPLOAD_CREDENTIALS || process.env.MESA_UPLOAD_CREDENTIALS_JSON || process.env.MESA_UPLOAD_CREDENTIALS || '').trim();
  CONFIG.MESA_UPLOAD_WORKERS = Math.max(1, Math.min(5, Number(String(CONFIG.MESA_UPLOAD_WORKERS).replace(',', '.')) || 5));
  CONFIG.MESA_UPLOAD_INTERVAL_SECONDS = Math.max(0, Number(String(CONFIG.MESA_UPLOAD_INTERVAL_SECONDS).replace(',', '.')) || 2);
  CONFIG.MESA_UPLOAD_BATCH_PAUSE_SECONDS = Math.max(0, Number(String(CONFIG.MESA_UPLOAD_BATCH_PAUSE_SECONDS).replace(',', '.')) || CONFIG.MESA_UPLOAD_INTERVAL_SECONDS || 2);
  CONFIG.MESA_UPLOAD_TIMEOUT_MINUTES = Math.max(0, Number(String(CONFIG.MESA_UPLOAD_TIMEOUT_MINUTES).replace(',', '.')) || 0);
  CONFIG.CLEANUP_CONCURRENCY = Math.max(1, Math.min(50, Number(String(CONFIG.CLEANUP_CONCURRENCY).replace(',', '.')) || 10));
  CONFIG.CLEANUP_RATE_LIMIT_PER_MINUTE = Math.max(1, Math.min(300, Number(String(CONFIG.CLEANUP_RATE_LIMIT_PER_MINUTE).replace(',', '.')) || 280));
  CONFIG.CLEANUP_RATE_LIMIT_FALLBACK_SECONDS = Math.max(1, Number(String(CONFIG.CLEANUP_RATE_LIMIT_FALLBACK_SECONDS).replace(',', '.')) || 30);
  CONFIG.CLEANUP_START_INTERVAL_MS = Math.max(0, Number(String(CONFIG.CLEANUP_START_INTERVAL_MS).replace(',', '.')) || 0);
}

function buildMesaActivityQuery(queueIds = getQueueIds()) {
  if (!queueIds.length) throw new Error('Nenhum QUEUE_ID configurado para consultar a mesa.');
  return {
    order: 'asc',
    filter: {
      type: 'and',
      clauses: [
        { type: 'or', predicates: queueIds.map(id => ({ dimension: 'queueId', value: id })) },
        { type: 'or', predicates: [{ dimension: 'mediaType', value: 'email' }] }
      ]
    },
    metrics: [{ metric: 'oWaiting' }],
    groupBy: ['conversationId', 'queueId']
  };
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
}

function isCleanupByQueueAllowed(filtros = {}) {
  const busca = String(filtros.busca || '').trim();
  const prazo = asArray(filtros.prazo);
  const status = asArray(filtros.status);
  const tipoServico = asArray(filtros.tipoServico);
  return !busca && prazo.length === 0 && status.length === 0 && tipoServico.length === 0;
}

function resolveCleanupQueueIds(filtros = {}) {
  const states = asArray(filtros.empresa).map(s => String(s).trim()).filter(Boolean);
  const allowedQueueIds = getCleanupQueueIds();
  if (!states.length) return allowedQueueIds;
  const wanted = new Set(states);
  return allowedQueueIds.filter(id => wanted.has(getQueueMeta(id).empresa || ''));
}

function normalizeKeyName(k) {
  return k ? k.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '') : '';
}

function escapeCsvValue(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDateTimeBR(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function collectConversationAttributes(conv) {
  const attrs = {};
  for (const p of conv?.participants || []) {
    if (p?.attributes && typeof p.attributes === 'object') Object.assign(attrs, p.attributes);
  }
  return attrs;
}

function getAttr(attrs, possibleKeys) {
  const wanted = possibleKeys.map(normalizeKeyName);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (wanted.includes(normalizeKeyName(k))) return v || '';
  }
  return '';
}

function collectSearchText(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return ` ${value}`;
  if (Array.isArray(value)) return value.map(v => collectSearchText(v, depth + 1)).join(' ');
  if (typeof value === 'object') return Object.values(value).map(v => collectSearchText(v, depth + 1)).join(' ');
  return '';
}

function extractProtocolFromConversation(conv) {
  const attrs = collectConversationAttributes(conv);
  const explicit = getAttr(attrs, ['protocolo', 'fixedprotocolo', 'nota', 'numero_protocolo', 'numeroProtocolo'])
    || conv?.externalTag
    || conv?.externalContactId;
  const explicitNorm = normProtocolo(explicit);
  if (explicitNorm) return explicitNorm;

  const text = collectSearchText(conv);
  const match = text.match(/\d{15,}/);
  return match ? normProtocolo(match[0]) : '';
}

function extractQueueIdFromConversation(conv, fallbackQueueId = '') {
  const direct = fallbackQueueId || '';
  if (direct) return direct;
  for (const participant of conv?.participants || []) {
    if (participant.queueId && isConfiguredQueueId(participant.queueId)) return participant.queueId;
    for (const session of participant.sessions || []) {
      if (session.queueId && isConfiguredQueueId(session.queueId)) return session.queueId;
      for (const segment of session.segments || []) {
        if (segment.queueId && isConfiguredQueueId(segment.queueId)) return segment.queueId;
      }
    }
  }
  const text = collectSearchText(conv?.participants || []);
  const queueIds = getQueueIds();
  return queueIds.find(id => text.includes(id)) || '';
}

function mapMesaRecord(conv, conversationId, fallbackQueueId = '') {
  const attrs = collectConversationAttributes(conv);
  const queueId = extractQueueIdFromConversation(conv, fallbackQueueId);
  const meta = getQueueMeta(queueId);
  const protocolo = extractProtocolFromConversation(conv);
  const tipoServico = getAttr(attrs, ['tipo_de_servico', 'tipoServico', 'tipo de servico', 'servico', 'descricao']);
  const status = getAttr(attrs, ['status', 'situacao', 'coluna']);
  const prazo = getAttr(attrs, ['conclusao_desejada', 'conclusaoDesejada', 'prazo', 'dataPrazo']);
  const data = getAttr(attrs, ['data', 'dataabertura', 'data de abertura', 'criadoem', 'createdat']);
  const origem = getAttr(attrs, ['dados', 'origem', 'fonte', 'site']);
  const skill = getAttr(attrs, ['skill']);
  const fluxo = getAttr(attrs, ['fluxo']);
  const prioridade = getAttr(attrs, ['prioridade']);
  const queueName = meta.nome || getAttr(attrs, ['queueName', 'fila']) || queueId;

  return {
    conversationId,
    protocolo,
    tipoServico: tipoServico || '',
    empresa: meta.empresa || getAttr(attrs, ['mandante', 'empresa', 'regiao']) || '',
    prazo: prazo || '',
    status: status || '',
    data: data || formatDateTimeBR(conv?.startTime || conv?.conversationStart),
    origem: origem || '',
    skill: skill || '',
    fluxo: fluxo || '',
    prioridade: prioridade || '',
    queueId,
    queueName,
  };
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function buildMesaDetailErrorRecord(conversationId, queueId, msg) {
  const meta = getQueueMeta(queueId);
  return {
    conversationId,
    protocolo: '',
    tipoServico: '',
    empresa: meta.empresa || '',
    prazo: '',
    status: 'ERRO_CONSULTA',
    data: '',
    origem: '',
    skill: '',
    fluxo: '',
    prioridade: '',
    queueId,
    queueName: meta.nome || queueId,
    error: msg,
  };
}

async function getMesaRecordWithRetry(conversationsApi, conversationId, queueId, onProgress = null) {
  const configuredAttempts = Number(CONFIG.MESA_DETAIL_RETRIES);
  const unlimited = configuredAttempts === 0;
  const maxAttempts = unlimited ? Number.MAX_SAFE_INTEGER : Math.max(1, configuredAttempts || 30);
  const retryDelay = Math.max(250, Number(CONFIG.MESA_DETAIL_RETRY_DELAY_MS) || 1500);
  let lastError = '';
  let lastRecord = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conv = await conversationsApi.getConversation(conversationId);
      const record = mapMesaRecord(conv, conversationId, queueId);
      lastRecord = record;
      if (record.protocolo) return record;
      lastError = 'Protocolo nao identificado nos detalhes da conversa.';
    } catch (e) {
      lastError = e.message || String(e);
    }

    if (attempt < maxAttempts) {
      if (onProgress && (attempt === 1 || attempt % 3 === 0)) {
        const label = unlimited ? `${attempt + 1}/sem limite` : `${attempt + 1}/${maxAttempts}`;
        onProgress(`Tentando ler detalhes pendentes (${label})...`);
      }
      await delay(retryDelay);
    }
  }

  if (lastRecord) {
    return { ...lastRecord, status: lastRecord.status || 'PROTOCOLO_NAO_IDENTIFICADO', error: lastError };
  }
  return buildMesaDetailErrorRecord(conversationId, queueId, lastError);
}

async function getMesaProtocolRecordFast(analyticsApi, conversationId, queueId) {
  const meta = getQueueMeta(queueId);
  try {
    const conv = await analyticsApi.getAnalyticsConversationDetails(conversationId);
    return {
      conversationId,
      queueId,
      empresa: meta.empresa || '',
      protocolo: extractProtocolFromConversation(conv),
    };
  } catch (e) {
    return {
      conversationId,
      queueId,
      empresa: meta.empresa || '',
      protocolo: '',
      error: e.message || String(e),
    };
  }
}

async function getMesaProtocolRecordsBulk(analyticsApi, conversations, onProgress = null) {
  const recordsById = new Map(conversations.map(c => [c.conversationId, {
    conversationId: c.conversationId,
    queueId: c.queueId,
    empresa: getQueueMeta(c.queueId).empresa || '',
    protocolo: '',
  }]));

  const days = Math.max(1, Math.min(31, Number(CONFIG.MESA_PROTOCOL_INTERVAL_DAYS) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const interval = `${start.toISOString()}/${end.toISOString()}`;
  const chunks = chunkArray(conversations, 100);

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    if (onProgress) onProgress(`Lendo protocolos da mesa em lote: ${i + 1}/${chunks.length}`);
    try {
      const response = await analyticsApi.postAnalyticsConversationsDetailsQuery({
        interval,
        order: 'asc',
        orderBy: 'conversationStart',
        paging: { pageSize: 100, pageNumber: 1 },
        conversationFilters: [{
          type: 'or',
          predicates: part.map(c => ({ dimension: 'conversationId', value: c.conversationId })),
        }],
      });

      for (const conv of response.conversations || []) {
        const record = recordsById.get(conv.conversationId);
        if (record) record.protocolo = extractProtocolFromConversation(conv);
      }
    } catch (e) {
      for (const c of part) {
        const record = recordsById.get(c.conversationId);
        if (record) record.error = e.message || String(e);
      }
    }
  }

  const missing = [...recordsById.values()].filter(r => !r.protocolo);
  if (missing.length) {
    const concurrency = Math.max(1, Math.min(8, Number(CONFIG.MESA_PROTOCOL_CONCURRENCY) || 4));
    if (onProgress) onProgress(`${missing.length} protocolo(s) nao vieram no lote. Tentando fallback analitico individual...`);
    const fallback = await mapLimit(missing, concurrency, ({ conversationId, queueId }) =>
      getMesaProtocolRecordFast(analyticsApi, conversationId, queueId)
    );
    for (const record of fallback) recordsById.set(record.conversationId, record);
  }

  return [...recordsById.values()];
}

async function getMesaAnalyticsRecordsBulk(analyticsApi, conversations, onProgress = null) {
  const recordsById = new Map(conversations.map(c => {
    const meta = getQueueMeta(c.queueId);
    return [c.conversationId, {
      conversationId: c.conversationId,
      protocolo: '',
      tipoServico: '',
      empresa: meta.empresa || '',
      prazo: '',
      status: '',
      data: '',
      origem: '',
      skill: '',
      fluxo: '',
      prioridade: '',
      queueId: c.queueId,
      queueName: meta.nome || c.queueId,
    }];
  }));

  const days = Math.max(1, Math.min(31, Number(CONFIG.MESA_PROTOCOL_INTERVAL_DAYS) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const interval = `${start.toISOString()}/${end.toISOString()}`;
  const chunks = chunkArray(conversations, 100);

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    if (onProgress) onProgress(`Lendo dados da mesa em lote: ${i + 1}/${chunks.length}`);
    try {
      const response = await analyticsApi.postAnalyticsConversationsDetailsQuery({
        interval,
        order: 'asc',
        orderBy: 'conversationStart',
        paging: { pageSize: 100, pageNumber: 1 },
        conversationFilters: [{
          type: 'or',
          predicates: part.map(c => ({ dimension: 'conversationId', value: c.conversationId })),
        }],
      });

      for (const conv of response.conversations || []) {
        const fallbackQueueId = recordsById.get(conv.conversationId)?.queueId || '';
        recordsById.set(conv.conversationId, mapMesaRecord(conv, conv.conversationId, fallbackQueueId));
      }
    } catch (e) {
      for (const c of part) {
        const record = recordsById.get(c.conversationId);
        if (record) record.error = e.message || String(e);
      }
    }
  }

  return [...recordsById.values()].map(r => ({
    ...r,
    status: r.status || 'Na mesa',
  }));
}

function mergeMesaRecords(base, detail) {
  const merged = { ...base };
  for (const key of ['protocolo', 'tipoServico', 'empresa', 'prazo', 'status', 'data', 'origem', 'skill', 'fluxo', 'prioridade', 'queueId', 'queueName']) {
    if (detail?.[key]) merged[key] = detail[key];
  }
  if (detail?.error) merged.error = detail.error;
  if (!merged.status) merged.status = 'Na mesa';
  return merged;
}

async function consultarMesaGenesys({ includeDetails = true, protocolOnly = false, onProgress = null } = {}) {
  const platformClient = require('purecloud-platform-client-v2');
  if (!CONFIG.CLIENT_ID || !CONFIG.CLIENT_SECRET) throw new Error('Credenciais Genesys nao configuradas.');

  const { region } = await genesysLogin(platformClient);
  const analyticsApi = new platformClient.AnalyticsApi();
  const conversationsApi = new platformClient.ConversationsApi();
  const body = buildMesaActivityQuery();

  if (onProgress) onProgress(`Autenticado na regiao ${region}. Consultando filas...`);
  const activityResponse = await analyticsApi.postAnalyticsConversationsActivityQuery(body);
  const seen = new Set();
  const conversations = [];

  for (const result of activityResponse.results || []) {
    const conversationId = result.group?.conversationId;
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    conversations.push({ conversationId, queueId: result.group?.queueId || '' });
  }

  if (protocolOnly) {
    if (onProgress) onProgress(`${conversations.length} conversa(s) na mesa. Lendo apenas protocolos via consulta analitica em lote...`);
    const records = await getMesaProtocolRecordsBulk(analyticsApi, conversations, onProgress);
    return { ok: true, region, total: records.length, records, protocolOnly: true };
  }

  if (!includeDetails) {
    return {
      ok: true,
      region,
      total: conversations.length,
      records: conversations.map(c => ({ conversationId: c.conversationId, queueId: c.queueId })),
    };
  }

  if (onProgress) onProgress(`${conversations.length} conversa(s) na mesa. Lendo dados analiticos em lote...`);
  const baseRecords = await getMesaAnalyticsRecordsBulk(analyticsApi, conversations, onProgress);

  if (onProgress) onProgress('Enriquecendo dados da mesa com uma leitura em tempo real, sem retry longo...');
  let records = await mapLimit(baseRecords, 12, async (base, index) => {
    if (onProgress && (index === 0 || (index + 1) % 100 === 0)) {
      onProgress(`Enriquecendo detalhes: ${index + 1}/${baseRecords.length}`);
    }
    try {
      const conv = await conversationsApi.getConversation(base.conversationId);
      const detail = mapMesaRecord(conv, base.conversationId, base.queueId);
      return mergeMesaRecords(base, detail);
    } catch (e) {
      return { ...base, error: e.message || String(e) };
    }
  });

  const sourceEnrichment = enrichMesaRecordsWithSourceData(records, onProgress);
  records = sourceEnrichment.records;
  if (onProgress) {
    onProgress(`Detalhes preenchidos pela base de origem: ${sourceEnrichment.matched}/${records.length}`);
    if (sourceEnrichment.errors.length) onProgress(`Avisos ao ler bases: ${sourceEnrichment.errors.slice(0, 3).join(' | ')}`);
  }

  return {
    ok: true,
    region,
    total: records.length,
    records,
    totalEnriquecidosOrigem: sourceEnrichment.matched,
    totalBaseOrigem: sourceEnrichment.totalBase,
    enrichmentErrors: sourceEnrichment.errors,
  };
}

async function consultarMesaPorQueueIds(queueIds) {
  const platformClient = require('purecloud-platform-client-v2');
  if (!CONFIG.CLIENT_ID || !CONFIG.CLIENT_SECRET) throw new Error('Credenciais Genesys nao configuradas.');

  const uniqueQueueIds = [...new Set((queueIds || []).map(id => id && id.toString().trim()).filter(Boolean))];
  if (!uniqueQueueIds.length) throw new Error('Nenhum ID de fila configurado para limpeza por ID da mesa.');

  const { region } = await genesysLogin(platformClient);
  const analyticsApi = new platformClient.AnalyticsApi();
  const activityResponse = await analyticsApi.postAnalyticsConversationsActivityQuery(buildMesaActivityQuery(uniqueQueueIds));
  const seen = new Set();
  const records = [];

  for (const result of activityResponse.results || []) {
    const conversationId = result.group?.conversationId;
    const queueId = result.group?.queueId || '';
    const meta = getQueueMeta(queueId);
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    records.push({
      conversationId,
      queueId,
      empresa: meta.empresa || '',
      queueName: meta.nome || queueId,
    });
  }

  return { ok: true, region, total: records.length, records, queueIds: uniqueQueueIds };
}

function appendCleanupLog(entry) {
  const logDir = ensureDir(getLogDir());
  const day = new Date().toISOString().slice(0, 10);
  const logPath = path.join(logDir, `limpeza-mesa-${day}.jsonl`);
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  return logPath;
}

function isBiMesaExcludedService(servico) {
  const key = normalizeKeyName(servico);
  return !!key && BI_MESA_EXCLUDED_SERVICES.some(ex => normalizeKeyName(ex) === key);
}

function appendAppLog(level, msg, details = {}) {
  try {
    const logDir = ensureDir(getLogDir());
    const day = new Date().toISOString().slice(0, 10);
    const logPath = path.join(logDir, `app-${day}.log`);
    const entry = sanitizeProcessOutput(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      msg,
      details,
    }));
    fs.appendFileSync(logPath, entry + '\n', 'utf8');
    return logPath;
  } catch (_) {
    return null;
  }
}

function getExtractionConfig(id) {
  const defaults = DEFAULT_EXTRACTION_SCRIPTS[id];
  const saved = CONFIG.EXTRACTION_SCRIPTS?.[id] || {};
  if (!defaults) return null;
  return { ...defaults, ...saved };
}

function getExtractionCredentials(id) {
  const defaults = DEFAULT_EXTRACTION_CREDENTIALS[id] || {};
  const saved = CONFIG.EXTRACTION_CREDENTIALS?.[id] || {};
  return {
    username: saved.username || defaults.username || '',
    password: saved.password || defaults.password || '',
  };
}

function getExtractionEnv(id) {
  const key = EXTRACTION_ENV_KEYS[id];
  const creds = getExtractionCredentials(id);
  const env = {};
  if (creds.username) {
    env.EXTRACAO_USUARIO = creds.username;
    env.RPA_USUARIO = creds.username;
    if (key) env[`EXTRACAO_${key}_USUARIO`] = creds.username;
  }
  if (creds.password) {
    env.EXTRACAO_SENHA = creds.password;
    env.RPA_SENHA = creds.password;
    if (key) env[`EXTRACAO_${key}_SENHA`] = creds.password;
  }
  return env;
}

function sanitizeProcessOutput(text) {
  let out = text ? String(text) : '';
  const extractionSecrets = Object.values(CONFIG.EXTRACTION_CREDENTIALS || {})
    .flatMap(c => [c?.password, c?.username])
    .filter(Boolean);
  const secrets = [CONFIG.CLIENT_SECRET, CONFIG.CLIENT_ID, CONFIG.MESA_UPLOAD_CREDENTIALS, ...extractionSecrets]
    .filter(s => s && String(s).length >= 4);
  for (const secret of secrets) out = out.split(secret).join('***');
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer ***');
  out = out.replace(/access_token["']?\s*[:=]\s*["'][^"']+["']/gi, 'access_token:"***"');
  return out;
}

function emitExtractionLog(id, line, type = 'info') {
  if (mainWindow && line) {
    mainWindow.webContents.send('extraction-log', { id, line, type });
  }
}

function emitCleanupProgress(payload) {
  if (mainWindow) {
    mainWindow.webContents.send('cleanup-progress', payload);
  }
}

function appendExtractionLogFile(logPath, text) {
  fs.appendFileSync(logPath, sanitizeProcessOutput(text), 'utf8');
}

function runExtractionScript(id) {
  const script = getExtractionConfig(id);
  if (!script) return Promise.resolve({ id, ok: false, msg: `Script desconhecido: ${id}` });

  const scriptPath = script.path || '';
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return Promise.resolve({
      id,
      ok: false,
      label: script.label,
      msg: `Script nao encontrado: ${scriptPath || '(caminho vazio)'}`,
    });
  }

  const nodeExecution = getNodeExecution();
  const runtime = nodeExecution.command;
  const cwd = script.cwd && fs.existsSync(script.cwd) ? script.cwd : path.dirname(scriptPath);
  const logDir = ensureDir(getLogDir('extracoes'));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(logDir, `${id}_${ts}.log`);

  return new Promise(resolve => {
    emitExtractionLog(id, `Iniciando ${script.label}...`, 'info');
    appendExtractionLogFile(logPath, `[${new Date().toISOString()}] ${script.label}\n`);
    appendExtractionLogFile(logPath, `runtime=${runtime}\nscript=${scriptPath}\ncwd=${cwd}\n\n`);

    const child = spawn(runtime, [...getExtractionNodeArgs(), scriptPath], {
      cwd,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        ...nodeExecution.env,
        ...getExtractionEnv(id),
        NODE_PATH: mergeNodePath(getBundledNodeModulesDir()),
      },
    });

    let outputTail = '';
    const handleChunk = (chunk, type) => {
      const text = sanitizeProcessOutput(chunk.toString());
      outputTail = (outputTail + text).slice(-6000);
      appendExtractionLogFile(logPath, text);
      text.split(/\r?\n/).filter(Boolean).slice(-20).forEach(line => emitExtractionLog(id, line, type));
    };

    child.stdout.on('data', chunk => handleChunk(chunk, 'out'));
    child.stderr.on('data', chunk => handleChunk(chunk, 'err'));

    child.on('error', error => {
      const msg = sanitizeProcessOutput(error.message);
      appendExtractionLogFile(logPath, `\n[ERRO] ${msg}\n`);
      emitExtractionLog(id, msg, 'err');
      resolve({ id, ok: false, label: script.label, msg, logPath, outputTail });
    });

    child.on('close', code => {
      const ok = code === 0;
      const msg = ok ? `${script.label} concluido.` : `${script.label} terminou com codigo ${code}.`;
      appendExtractionLogFile(logPath, `\n[${new Date().toISOString()}] ${msg}\n`);
      emitExtractionLog(id, msg, ok ? 'ok' : 'err');
      resolve({ id, ok, label: script.label, code, msg, logPath, outputTail });
    });
  });
}

async function runExtractionScriptTracked(id) {
  if (runningExtractions.has(id)) {
    return { id, ok: false, msg: 'Extracao ja esta em andamento.' };
  }
  runningExtractions.add(id);
  try {
    return await runExtractionScript(id);
  } finally {
    runningExtractions.delete(id);
  }
}

function parseRetryAfterSeconds(error, fallbackSeconds) {
  const headers = error?.response?.headers || error?.headers || {};
  const raw = headers['retry-after']
    || headers['Retry-After']
    || (typeof headers.get === 'function' ? headers.get('retry-after') : '');
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  if (raw) {
    const retryDate = new Date(raw);
    if (!isNaN(retryDate.getTime())) {
      const seconds = Math.ceil((retryDate.getTime() - Date.now()) / 1000);
      if (seconds > 0) return seconds;
    }
  }
  return fallbackSeconds;
}

function createCleanupRateLimiter({ requestsPerMinute, fallbackSeconds, onRateLimit }) {
  const rpm = Math.max(1, Math.min(300, Number(requestsPerMinute) || 280));
  const intervalMs = Math.ceil(60000 / rpm);
  let nextAllowedAt = 0;
  let turnChain = Promise.resolve();
  let pauseUntil = 0;
  let lastCountdown = null;

  async function waitIfPaused() {
    while (Date.now() < pauseUntil) {
      const remaining = Math.max(1, Math.ceil((pauseUntil - Date.now()) / 1000));
      if (remaining !== lastCountdown) {
        lastCountdown = remaining;
        if (onRateLimit) onRateLimit(remaining);
      }
      await delay(Math.min(1000, Math.max(50, pauseUntil - Date.now())));
    }
    lastCountdown = null;
  }

  async function waitTurn() {
    const run = turnChain.then(async () => {
      await waitIfPaused();
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);
      if (waitMs > 0) await delay(waitMs);
      await waitIfPaused();
      const start = Date.now();
      nextAllowedAt = Math.max(nextAllowedAt, start) + intervalMs;
    });
    turnChain = run.catch(() => {});
    return run;
  }

  async function pauseFrom429(error) {
    const seconds = parseRetryAfterSeconds(error, fallbackSeconds);
    pauseUntil = Math.max(pauseUntil, Date.now() + (seconds * 1000));
    await waitIfPaused();
    return seconds;
  }

  return { waitTurn, pauseFrom429, intervalMs, rpm };
}

async function disconnectConversationSafe(conversationsApi, conversationId, options = {}) {
  const retries = Math.max(1, Number(options.retries) || 3);
  const limiter = options.limiter;
  let attempt = 0;

  while (true) {
    try {
      if (limiter) await limiter.waitTurn();
      await conversationsApi.postConversationDisconnect(conversationId);
      return { ok: true, conversationId };
    } catch (error) {
      const status = error.response?.status || error.status;
      if (status === 429 && limiter) {
        await limiter.pauseFrom429(error);
        if (options.onRateLimitResume) options.onRateLimitResume();
        continue;
      }

      attempt += 1;
      const retryable = [408, 500, 502, 503, 504].includes(Number(status));
      if (retryable && attempt < retries) {
        await delay(Math.min(5000, 1000 * attempt));
        continue;
      }

      return { ok: false, conversationId, msg: error.message || String(error), status };
    }
  }
}

async function disconnectConversationsControlled(conversationsApi, conversationIds) {
  const concurrency = Math.max(1, Math.min(50, Number(CONFIG.CLEANUP_CONCURRENCY) || 10));
  const rateLimitPerMinute = Math.max(1, Math.min(300, Number(CONFIG.CLEANUP_RATE_LIMIT_PER_MINUTE) || 280));
  const fallbackSeconds = Math.max(1, Number(CONFIG.CLEANUP_RATE_LIMIT_FALLBACK_SECONDS) || 30);
  const total = conversationIds.length;
  const state = { total, processed: 0, success: 0, error: 0 };

  function emitProgress(extra = {}) {
    emitCleanupProgress({
      ...state,
      pending: Math.max(0, total - state.processed),
      concurrency,
      rateLimitPerMinute,
      ...extra,
    });
  }

  const limiter = createCleanupRateLimiter({
    requestsPerMinute: rateLimitPerMinute,
    fallbackSeconds,
    onRateLimit: seconds => emitProgress({
      status: 'rate_limited',
      rateLimited: true,
      retryAfterSeconds: seconds,
      msg: `Rate limit atingido. Aguardando ${seconds} segundos para continuar...`,
    }),
  });

  emitProgress({
    status: 'running',
    rateLimited: false,
    msg: `Iniciando limpeza com paralelo ${concurrency} e limite ${limiter.rpm} req/min.`,
  });

  const results = await mapLimit(conversationIds, concurrency, async conversationId => {
    const result = await disconnectConversationSafe(conversationsApi, conversationId, {
      limiter,
      retries: 3,
      onRateLimitResume: () => emitProgress({
        status: 'running',
        rateLimited: false,
        retryAfterSeconds: 0,
        msg: 'Rate limit liberado. Continuando limpeza...',
      }),
    });
    state.processed += 1;
    if (result.ok) state.success += 1;
    else state.error += 1;
    emitProgress({
      status: 'running',
      rateLimited: false,
      retryAfterSeconds: 0,
      msg: `Processadas ${state.processed}/${total}.`,
    });
    return result;
  });

  emitProgress({
    status: 'done',
    rateLimited: false,
    retryAfterSeconds: 0,
    msg: `Limpeza finalizada: ${state.success} sucesso(s), ${state.error} erro(s).`,
  });

  return results;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Não sobrescreve credenciais com string vazia (prioriza .env)
      if (!saved.CLIENT_ID)     delete saved.CLIENT_ID;
      if (!saved.CLIENT_SECRET) delete saved.CLIENT_SECRET;
      if (!saved.ORG_REGION)    delete saved.ORG_REGION;
      Object.assign(CONFIG, saved);
      CONFIG.EXTRACTION_SCRIPTS = {
        ...DEFAULT_EXTRACTION_SCRIPTS,
        ...(saved.EXTRACTION_SCRIPTS || {}),
      };
      if (Number(CONFIG.MESA_DETAIL_RETRIES) !== 0) {
        CONFIG.MESA_DETAIL_RETRIES = Math.max(30, Number(CONFIG.MESA_DETAIL_RETRIES) || 30);
      }
    }
    normalizeConfigAfterLoad();
  } catch(e) { console.error('loadConfig error:', e.message); }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2), 'utf8');
}

function mergeExtractionCredentials(incoming) {
  const merged = { ...(CONFIG.EXTRACTION_CREDENTIALS || {}) };
  for (const id of EXTRACTION_IDS) {
    const current = merged[id] || {};
    const next = incoming?.[id] || {};
    merged[id] = {
      username: Object.prototype.hasOwnProperty.call(next, 'username')
        ? String(next.username || '').trim()
        : (current.username || ''),
      password: next.password
        ? String(next.password)
        : (current.password || ''),
    };
  }
  return merged;
}

function applyConfigPatch(newCfg = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(newCfg || {})) {
    if (ALLOWED_CONFIG_KEYS.has(key)) patch[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'CLIENT_SECRET') && !String(patch.CLIENT_SECRET || '').trim()) {
    delete patch.CLIENT_SECRET;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'MESA_UPLOAD_CREDENTIALS') && !String(patch.MESA_UPLOAD_CREDENTIALS || '').trim()) {
    delete patch.MESA_UPLOAD_CREDENTIALS;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'EXTRACTION_CREDENTIALS')) {
    patch.EXTRACTION_CREDENTIALS = mergeExtractionCredentials(patch.EXTRACTION_CREDENTIALS);
  }
  Object.assign(CONFIG, patch);
  normalizeConfigAfterLoad();
  saveConfig();
}

function publicUpdateState(extra = {}) {
  return {
    ...updateState,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    ...extra,
  };
}

function emitUpdateStatus(payload = {}) {
  Object.assign(updateState, payload, { currentVersion: app.getVersion() });
  appendAppLog('info', 'Status de atualizacao', updateState);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', publicUpdateState());
  }
  return publicUpdateState();
}

function updaterErrorMessage(error) {
  const msg = error?.message || String(error || 'Erro desconhecido');
  if (/404|not found/i.test(msg)) return 'Nenhuma release de atualizacao foi encontrada no GitHub.';
  if (/private|authentication|401|403|token/i.test(msg)) {
    return 'Nao foi possivel acessar a release. Se o repositorio for privado, publique em um canal acessivel ou configure uma estrategia segura de distribuicao.';
  }
  return msg;
}

function setupAutoUpdater() {
  if (!autoUpdater) {
    emitUpdateStatus({ status: 'unavailable', msg: 'electron-updater nao esta disponivel neste pacote.' });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ status: 'checking', percent: 0, msg: 'Verificando atualizacoes...' });
  });

  autoUpdater.on('update-available', info => {
    emitUpdateStatus({
      status: 'available',
      latestVersion: info?.version || '',
      percent: 0,
      msg: `Atualizacao ${info?.version || ''} disponivel.`,
    });
  });

  autoUpdater.on('update-not-available', info => {
    emitUpdateStatus({
      status: 'not-available',
      latestVersion: info?.version || app.getVersion(),
      percent: 0,
      msg: 'Voce ja esta na versao mais recente.',
    });
  });

  autoUpdater.on('download-progress', progress => {
    const percent = Math.round(Number(progress?.percent || 0));
    emitUpdateStatus({ status: 'downloading', percent, msg: `Baixando atualizacao: ${percent}%` });
  });

  autoUpdater.on('update-downloaded', info => {
    emitUpdateStatus({
      status: 'downloaded',
      latestVersion: info?.version || updateState.latestVersion || '',
      percent: 100,
      msg: 'Atualizacao baixada. Reinicie para instalar.',
    });
  });

  autoUpdater.on('error', error => {
    emitUpdateStatus({ status: 'error', msg: updaterErrorMessage(error) });
  });
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    return emitUpdateStatus({ status: 'dev', msg: 'Atualizacao automatica funciona apenas no app instalado.' });
  }
  if (!autoUpdater) {
    return emitUpdateStatus({ status: 'unavailable', msg: 'Atualizador nao disponivel neste pacote.' });
  }
  if (updateCheckInProgress) {
    return publicUpdateState({ msg: 'Verificacao de atualizacao ja esta em andamento.' });
  }

  updateCheckInProgress = true;
  try {
    emitUpdateStatus({ status: 'checking', msg: manual ? 'Verificando atualizacao...' : 'Verificacao automatica iniciada...' });
    await autoUpdater.checkForUpdates();
    return publicUpdateState();
  } catch (error) {
    return emitUpdateStatus({ status: 'error', msg: updaterErrorMessage(error) });
  } finally {
    updateCheckInProgress = false;
  }
}

async function downloadUpdate() {
  if (!app.isPackaged || !autoUpdater) {
    return emitUpdateStatus({ status: 'unavailable', msg: 'Download de atualizacao disponivel apenas no app instalado.' });
  }
  if (updateState.status !== 'available') {
    return publicUpdateState({ msg: 'Nenhuma atualizacao disponivel para baixar.' });
  }
  try {
    emitUpdateStatus({ status: 'downloading', percent: 0, msg: 'Iniciando download da atualizacao...' });
    await autoUpdater.downloadUpdate();
    return publicUpdateState();
  } catch (error) {
    return emitUpdateStatus({ status: 'error', msg: updaterErrorMessage(error) });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    backgroundColor: '#0a0c12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  loadConfig();
  appendAppLog('info', 'Aplicacao iniciada', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    inputMesaDir: getInputMesaDir(),
    logDir: getLogDir(),
  });
  createWindow();
  setupAutoUpdater();
  if (IS_SMOKE_TEST) {
    setTimeout(() => {
      appendAppLog('info', 'Smoke test finalizado');
      app.quit();
    }, 1500);
  } else if (app.isPackaged) {
    setTimeout(() => checkForUpdates(false), 5000);
  }
});

app.on('window-all-closed', () => {
  if (autoTimer) clearInterval(autoTimer);
  app.quit();
});

// ─── IPC: janela ─────────────────────────────────────────────────────────────
ipcMain.on('win-close',    () => mainWindow.close());
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());

// ─── IPC: config ─────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => createPublicConfig());
ipcMain.handle('set-config', (_, newCfg) => { applyConfigPatch(newCfg); return true; });
ipcMain.handle('get-update-state', () => publicUpdateState());
ipcMain.handle('check-for-updates', (_, manual = true) => checkForUpdates(manual));
ipcMain.handle('download-update', () => downloadUpdate());
ipcMain.handle('install-update', () => {
  if (updateState.status !== 'downloaded' || !autoUpdater) {
    return publicUpdateState({ msg: 'Nenhuma atualizacao baixada para instalar.' });
  }
  appendAppLog('info', 'Instalando atualizacao baixada');
  autoUpdater.quitAndInstall(false, true);
  return publicUpdateState({ msg: 'Reiniciando para instalar atualizacao...' });
});

ipcMain.handle('pick-file', async (_, filters) => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});

// ─── IPC: testar Genesys ──────────────────────────────────────────────────────
ipcMain.handle('test-genesys', async () => {
  const platformClient = require('purecloud-platform-client-v2');
  try {
    // Idêntico ao index.js funcional
    const { region } = await genesysLogin(platformClient);

    const analyticsApi = new platformClient.AnalyticsApi();
    const queueIds = getQueueIds();

    const body = {
      order: "asc",
      filter: {
        type: "and",
        clauses: [
          { type: "or", predicates: queueIds.map(id => ({ dimension: "queueId", value: id })) },
          { type: "or", predicates: [{ dimension: "mediaType", value: "email" }] }
        ]
      },
      metrics: [{ metric: "oWaiting" }],
      groupBy: ["conversationId", "queueId"]
    };

    const activityResponse = await analyticsApi.postAnalyticsConversationsActivityQuery(body);
    const results = activityResponse.results || [];
    const total   = results.filter(r => r.group?.conversationId).length;

    return { ok: true, region, total, msg: `Conectado! ${total} e-mail(s) aguardando nas filas.` };
  } catch(e) {
    appendAppLog('error', 'Falha ao testar Genesys', { error: e.message, region: CONFIG.ORG_REGION });
    return { ok: false, msg: e.message, region: CONFIG.ORG_REGION };
  }
});

ipcMain.handle('pick-files', async (_, filters) => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ─── IPC: auto modo ──────────────────────────────────────────────────────────
ipcMain.handle('start-auto', (_, intervalMin) => {
  if (autoTimer) clearInterval(autoTimer);
  const ms = (intervalMin || CONFIG.AUTO_INTERVAL_MIN) * 60 * 1000;
  autoTimer = setInterval(() => {
    mainWindow.webContents.send('auto-trigger');
  }, ms);
  return true;
});

ipcMain.handle('stop-auto', () => {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  return true;
});

// ─── IPC: subida JS integrada da mesa ────────────────────────────────────────
ipcMain.handle('executar-mesa', async (_, csvPath) => {
  const inputDir = ensureDir(getInputMesaDir());
  const uploadScript = path.join(__dirname, 'scripts', 'mesa-upload.js');

  if (!fs.existsSync(uploadScript)) {
    return { ok: false, msg: `Script de subida JS nao encontrado: ${uploadScript}` };
  }

  const destCsv = path.join(inputDir, path.basename(csvPath));
  if (path.resolve(csvPath) !== path.resolve(destCsv)) {
    fs.copyFileSync(csvPath, destCsv);
  }

  return new Promise(resolve => {
    const nodeExecution = getNodeExecution();
    const command = nodeExecution.command;
    const args = [uploadScript, destCsv];
    const timeoutMinutes = Number(CONFIG.MESA_UPLOAD_TIMEOUT_MINUTES) || 0;
    const child = spawn(command, args, {
      cwd: inputDir,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        ...nodeExecution.env,
        CLIENT_ID: String(CONFIG.CLIENT_ID || ''),
        CLIENT_SECRET: String(CONFIG.CLIENT_SECRET || ''),
        ORG_REGION: String(CONFIG.ORG_REGION || 'sa_east_1'),
        MESA_UPLOAD_CREDENTIALS: String(CONFIG.MESA_UPLOAD_CREDENTIALS || ''),
        MESA_UPLOAD_LOG_DIR: getLogDir('upload'),
        MESA_UPLOAD_STRATEGY: String(CONFIG.MESA_UPLOAD_STRATEGY || 'paced'),
        MESA_UPLOAD_WORKERS: String(CONFIG.MESA_UPLOAD_WORKERS || 5),
        MESA_UPLOAD_INTERVAL_SECONDS: String(CONFIG.MESA_UPLOAD_INTERVAL_SECONDS ?? 2),
        MESA_UPLOAD_BATCH_PAUSE_SECONDS: String(CONFIG.MESA_UPLOAD_BATCH_PAUSE_SECONDS ?? CONFIG.MESA_UPLOAD_INTERVAL_SECONDS ?? 2),
        MESA_REQUEST_RETRIES: String(process.env.MESA_REQUEST_RETRIES || 8),
        MESA_REQUEST_TIMEOUT_SECONDS: String(process.env.MESA_REQUEST_TIMEOUT_SECONDS || 25),
        MESA_RATE_LIMIT_SLEEP_SECONDS: String(process.env.MESA_RATE_LIMIT_SLEEP_SECONDS || 30),
        MESA_DRY_RUN: String(process.env.MESA_DRY_RUN || '0'),
      },
    });

    let stdout = '';
    let stderr = '';
    let done = false;
    let timeoutHandle = null;

    if (timeoutMinutes > 0) {
      timeoutHandle = setTimeout(() => {
        done = true;
        child.kill();
        appendAppLog('error', 'Timeout na subida JS da mesa', { inputDir, timeoutMinutes });
        resolve({ ok: false, msg: `Subida da mesa excedeu o timeout de ${timeoutMinutes} minuto(s).` });
      }, timeoutMinutes * 60 * 1000);
    }

    const capture = (chunk, type) => {
      const text = sanitizeProcessOutput(chunk.toString());
      if (type === 'err') stderr += text;
      else stdout += text;
      text.split(/\r?\n/).filter(Boolean).slice(-20).forEach(line => emitExtractionLog('uploadMesa', line, type));
    };

    child.stdout.on('data', chunk => capture(chunk, 'out'));
    child.stderr.on('data', chunk => capture(chunk, 'err'));

    child.on('error', error => {
      if (done) return;
      done = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const msg = sanitizeProcessOutput(error.message);
      appendAppLog('error', 'Falha ao iniciar subida JS da mesa', { error: msg, inputDir });
      resolve({ ok: false, msg });
    });

    child.on('close', code => {
      if (done) return;
      done = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const out = sanitizeProcessOutput(stdout || '');
      const errOut = sanitizeProcessOutput(stderr || '');
      if (code === 0) {
        appendAppLog('info', 'Subida JS da mesa concluida', { inputDir, runner: path.basename(uploadScript) });
        resolve({ ok: true, msg: out || 'Subida JS concluida.' });
      } else {
        const parts = [errOut, out].filter(Boolean);
        appendAppLog('error', 'Falha na subida JS da mesa', { code, inputDir });
        resolve({ ok: false, msg: parts.join('\n').trim() || `Subida JS terminou com codigo ${code}.` });
      }
    });
  });
});

// ─── IPC: abrir pasta output ──────────────────────────────────────────────────
ipcMain.handle('open-output', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  shell.showItemInFileExplorer(filePath);
  return true;
});

// ─── PROCESSAMENTO PRINCIPAL ─────────────────────────────────────────────────
// (importado do worker para não bloquear a UI)
ipcMain.handle('gerar-base', async (_, { filtros }) => {
  try {
    const resultado = await gerarBaseCompleta(filtros);
    appendAppLog('info', 'Base CSV gerada', { outputPath: resultado.outputPath, total: resultado.total });
    return resultado;
  } catch(e) {
    appendAppLog('error', 'Falha ao gerar base', { error: e.message });
    return { ok: false, msg: e.message, stack: e.stack };
  }
});

// ─── Lógica de negócio (movida do script original) ───────────────────────────

// Normalização de protocolo — usada nos dois lados (Genesys e bases)
// Garante que "123456789012345", "'123456789012345", 1.23456789012345e+14
// sejam todos comparados como a mesma string: "123456789012345"
ipcMain.handle('listar-mesa', async () => {
  try {
    const resultado = await consultarMesaGenesys({ includeDetails: true });
    const protocolos = new Set(resultado.records.map(r => r.protocolo).filter(Boolean));
    return { ...resultado, totalProtocolos: protocolos.size };
  } catch(e) {
    appendAppLog('error', 'Falha ao listar mesa', { error: e.message });
    return { ok: false, msg: e.message };
  }
});

ipcMain.handle('preview-tratados-fora', async () => {
  try {
    const progresso = [];
    const mesa = await consultarMesaGenesys({
      includeDetails: true,
      onProgress: msg => progresso.push(msg),
    });
    const errors = mesa.enrichmentErrors || [];
    const totalBase = Number(mesa.totalBaseOrigem || 0);
    const candidatos = [];
    let semProtocolo = 0;
    let aindaNaBase = 0;

    for (const record of mesa.records || []) {
      const protocolo = normProtocolo(record.protocolo);
      if (!protocolo) {
        semProtocolo++;
        continue;
      }
      const sourceEligible = record.sourceMatched && !isBiMesaExcludedService(record.tipoServico);
      if (sourceEligible) {
        aindaNaBase++;
        continue;
      }
      candidatos.push({
        ...record,
        protocolo,
        motivoTratadoFora: record.sourceMatched
          ? 'Tipo de servico excluido da base de distribuicao'
          : 'Protocolo nao encontrado nas bases de origem configuradas',
      });
    }

    appendAppLog('info', 'Preview tratados fora concluido', {
      totalMesa: mesa.records?.length || 0,
      totalBase,
      candidatos: candidatos.length,
      semProtocolo,
      aindaNaBase,
      errors,
    });

    return {
      ok: true,
      totalMesa: mesa.records?.length || 0,
      totalBase,
      totalTratadosFora: candidatos.length,
      semProtocolo,
      aindaNaBase,
      records: mesa.records || [],
      candidatos,
      errors,
      progresso,
      msg: `${candidatos.length} conversa(s) na mesa nao aparecem nas bases atuais.`,
    };
  } catch (e) {
    appendAppLog('error', 'Falha no preview de tratados fora', { error: e.message });
    return { ok: false, msg: e.message };
  }
});

ipcMain.handle('limpar-mesa', async (_, payload = {}) => {
  const dryRun = payload.dryRun === true;
  const filtros = payload.filtros || {};
  const cleanupMode = payload.cleanupMode === 'queueIds' ? 'queueIds' : 'selected';
  let ids = [...new Set((payload.conversationIds || []).map(id => id && id.toString().trim()).filter(Boolean))];
  let records = Array.isArray(payload.records) ? payload.records : [];
  let queueIds = [];
  let queueModeInfo = null;

  if (cleanupMode === 'queueIds') {
    if (!isCleanupByQueueAllowed(filtros)) {
      return { ok: false, msg: 'Limpeza por ID da mesa so e permitida sem filtros ou apenas com filtro de estado.' };
    }
    queueIds = resolveCleanupQueueIds(filtros);
    if (!queueIds.length) {
      const states = asArray(filtros.empresa).map(s => String(s).trim()).filter(Boolean);
      const msg = states.length
        ? 'Nenhum ID de fila configurado para os estados selecionados. Para filas fora do padrao, cadastre os IDs de limpeza como ESTADO|id-da-fila, por exemplo GO|00000000-0000-0000-0000-000000000000.'
        : 'Nenhum ID de fila configurado para limpeza por ID da mesa.';
      return { ok: false, msg };
    }
    const mesaPorFila = await consultarMesaPorQueueIds(queueIds);
    records = mesaPorFila.records || [];
    ids = records.map(r => r.conversationId);
    queueModeInfo = {
      queueIds,
      estados: [...new Set(queueIds.map(id => getQueueMeta(id).empresa || '').filter(Boolean))],
      totalFilas: queueIds.length,
      totalEncontrado: ids.length,
    };
  }
  const protocolos = records
    .filter(r => ids.includes(r.conversationId))
    .map(r => r.protocolo)
    .filter(Boolean);

  if (!ids.length) {
    const emptyMsg = cleanupMode === 'queueIds'
      ? 'Nenhuma conversa encontrada nos IDs de fila configurados.'
      : 'Nenhuma conversa selecionada para limpeza.';
    return { ok: false, msg: emptyMsg, queueModeInfo };
  }

  const baseLog = {
    timestamp: new Date().toISOString(),
    action: dryRun ? 'DRY_RUN' : 'CLEAN',
    cleanupMode,
    filtros,
    queueModeInfo,
    totalSelecionado: ids.length,
    conversationIds: ids,
    protocolos,
  };

  if (dryRun) {
    const logPath = appendCleanupLog({ ...baseLog, sucesso: true, removidos: 0, falhas: [] });
    return {
      ok: true,
      dryRun: true,
      selecionados: ids.length,
      protocolos,
      queueModeInfo,
      logPath,
      msg: cleanupMode === 'queueIds'
        ? `${ids.length} conversa(s) encontradas por ID da mesa. Nenhuma limpeza real foi executada.`
        : `${ids.length} conversa(s) seriam removidas. Nenhuma limpeza real foi executada.`
    };
  }

  if (payload.confirmText !== 'LIMPAR') {
    const logPath = appendCleanupLog({ ...baseLog, sucesso: false, removidos: 0, falhas: [{ msg: 'Confirmacao invalida' }] });
    return { ok: false, msg: 'Confirmacao invalida. Digite LIMPAR para executar a limpeza real.', logPath };
  }

  try {
    emitCleanupProgress({
      total: ids.length,
      processed: 0,
      success: 0,
      error: 0,
      pending: ids.length,
      status: 'validating',
      rateLimited: false,
      retryAfterSeconds: 0,
      msg: cleanupMode === 'queueIds' ? 'Preparando limpeza por ID da mesa...' : 'Validando conversas selecionadas...',
    });

    let idsValidados = ids;
    let ignorados = [];

    if (cleanupMode !== 'queueIds') {
      const mesaAtual = await consultarMesaGenesys({ includeDetails: false });
      const idsAindaNaMesa = new Set(mesaAtual.records.map(r => r.conversationId));
      idsValidados = ids.filter(id => idsAindaNaMesa.has(id));
      ignorados = ids.filter(id => !idsAindaNaMesa.has(id));
    }

    if (!idsValidados.length) {
      const logPath = appendCleanupLog({ ...baseLog, sucesso: true, removidos: 0, ignorados, falhas: [] });
      emitCleanupProgress({
        total: ids.length,
        processed: 0,
        success: 0,
        error: 0,
        pending: 0,
        status: 'done',
        rateLimited: false,
        retryAfterSeconds: 0,
        msg: 'Nenhuma conversa selecionada continua na mesa.',
      });
      return { ok: true, removed: 0, ignored: ignorados.length, failures: [], logPath, msg: 'Nenhuma conversa selecionada continua na mesa.' };
    }

    const platformClient = require('purecloud-platform-client-v2');
    await genesysLogin(platformClient);
    const conversationsApi = new platformClient.ConversationsApi();
    const results = await disconnectConversationsControlled(conversationsApi, idsValidados);

    const removidos = results.filter(r => r.ok).length;
    const falhas = results.filter(r => !r.ok);
    const logPath = appendCleanupLog({
      ...baseLog,
      sucesso: falhas.length === 0,
      removidos,
      ignorados,
      falhas,
    });

    return {
      ok: true,
      dryRun: false,
      removed: removidos,
      ignored: ignorados.length,
      failures: falhas,
      logPath,
      msg: `${removidos} conversa(s) removida(s). ${falhas.length} falha(s).`
    };
  } catch(e) {
    const logPath = appendCleanupLog({ ...baseLog, sucesso: false, removidos: 0, falhas: [{ msg: e.message }] });
    emitCleanupProgress({
      total: ids.length,
      processed: 0,
      success: 0,
      error: 1,
      pending: ids.length,
      status: 'error',
      rateLimited: false,
      retryAfterSeconds: 0,
      msg: e.message,
    });
    return { ok: false, msg: e.message, logPath };
  }
});

ipcMain.handle('run-extraction', async (_, payload = {}) => {
  const requested = Array.isArray(payload.ids) && payload.ids.length
    ? payload.ids
    : Object.keys(DEFAULT_EXTRACTION_SCRIPTS);
  const ids = [...new Set(requested.filter(id => DEFAULT_EXTRACTION_SCRIPTS[id]))].slice(0, 4);

  if (!ids.length) return { ok: false, msg: 'Nenhum script de extracao selecionado.' };

  const results = await Promise.all(ids.map(id => runExtractionScriptTracked(id)));
  const concluidas = results.filter(r => r.ok).length;
  return {
    ok: results.every(r => r.ok),
    results,
    msg: `${concluidas}/${results.length} extracao(oes) concluida(s) com sucesso.`,
  };
});

function normProtocolo(val) {
  if (val === null || val === undefined || val === '') return '';
  let s = val.toString().trim();
  if (s.startsWith("'")) s = s.substring(1).trim();
  // Notação científica do Excel (raw:true retorna number → toString vira "1.23e+14")
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!isNaN(n)) s = n.toFixed(0);
  }
  // Remove pontos, vírgulas e espaços (separadores de milhar)
  s = s.replace(/[.,\s]/g, '');
  // Mantém só dígitos
  s = s.replace(/\D/g, '');
  return s;
}

const MAP_EMP_MESA = {
  "EQTL MA": "MA",
  "EQTL PA": "PA",
  "EQTL PI": "PI",
  "EQTL AL": "AL",
  "EQTL GO": "GO",
  "EQTL AP": "CEA",
  "EQTL RS": "CEEE",
};

function safeExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function rowValue(row, possibleKeys) {
  const wanted = possibleKeys.map(normalizeKeyName);
  for (const [k, v] of Object.entries(row || {})) {
    if (wanted.includes(normalizeKeyName(k))) return v ?? '';
  }
  return '';
}

function formatDateOnlyBR(d) {
  if (!d || isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseBaseDateMinus3h(val) {
  if (!val) return new Date();
  let d;
  if (typeof val === 'number' || (!isNaN(val) && Number(val) > 10000)) {
    d = new Date(Math.round((Number(val) - 25569) * 86400 * 1000));
  } else if (val instanceof Date) {
    d = new Date(val);
  } else {
    const s = val.toString().trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      d = new Date(s);
    } else {
      const p = s.split(/[\s/:-]+/);
      if (p.length >= 3) {
        const p0 = parseInt(p[0], 10);
        const p1 = parseInt(p[1], 10) - 1;
        const p2 = parseInt(p[2], 10);
        const h = p[3] ? parseInt(p[3], 10) : 0;
        const min = p[4] ? parseInt(p[4], 10) : 0;
        const sec = p[5] ? parseInt(p[5], 10) : 0;
        if (p2 >= 1000) d = new Date(p2, p1, p0, h, min, sec);
        else if (p0 >= 1000) d = new Date(p0, p1, p2, h, min, sec);
        else d = new Date(p2 < 100 ? p2 + 2000 : p2, p1, p0, h, min, sec);
      } else {
        d = new Date(s);
      }
    }
  }
  if (isNaN(d.getTime())) d = new Date();
  d.setHours(d.getHours() - 3);
  return d;
}

function isBaseHolidayOrWeekend(d) {
  if (d.getDay() === 0 || d.getDay() === 6) return true;
  const iso = d.toISOString().split('T')[0];
  return ['2025-12-25', '2026-01-01', '2026-04-21', '2026-05-01',
          '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15'].includes(iso);
}

function calcularPrazoBase(dataSolicitacao) {
  const d = new Date(dataSolicitacao.getTime());
  d.setHours(0, 0, 0, 0);
  let dias = 0;
  while (dias < 1) {
    d.setDate(d.getDate() + 1);
    if (!isBaseHolidayOrWeekend(d)) dias++;
  }
  return d;
}

function getDiffPrazoDias(dataPrazo) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.floor((dataPrazo - hoje) / 86400000);
}

function classificarStatusPrazoBaseLabel(diff) {
  if (diff < 0) return '0-PASSIVO';
  if (diff === 0) return '1-VENCE HOJE';
  return `2-VENCE D+${diff}`;
}

function classificarStatusPrazoMesaLabel(diff) {
  if (diff < 0) {
    const atraso = Math.abs(diff);
    return `0-PASSIVO D-${atraso >= 15 ? '15+' : atraso}`;
  }
  if (diff === 0) return '1-VENCE HOJE';
  return `2-VENCE D+${diff}`;
}

function getServicoAuxiliarBase(s) {
  if (!s) return null;
  const raw = s.toString().trim();
  const map = {
    atualizacaocadastral: 'Altera\u00e7\u00e3o dos dados do titular',
    atualizacaodedadosdotitular: 'Altera\u00e7\u00e3o dos dados do titular',
    atualizardadosdotitular: 'Altera\u00e7\u00e3o dos dados do titular',
    atualizardadostitular: 'Altera\u00e7\u00e3o dos dados do titular',
    atualizardadosdainstalacao: 'Altera\u00e7\u00e3o dos dados do titular',
    atualizardadosparaacesso: 'Altera\u00e7\u00e3o dos dados do titular',
    dadosdotitulardacontacontrato: 'Altera\u00e7\u00e3o dos dados do titular',
    alterarlocaldomedidor: 'Alterar medidor de local',
    mudancademedidorlocal: 'Alterar medidor de local',
    aparelhoparamanutencaodavida: 'Cadastro de equipamento vital',
    cadastraraparelhovital: 'Cadastro de equipamento vital',
    cadastraremail: 'Cadastro de e-mail',
    cadastrobaixarenda: 'Cadastro baixa renda',
    cadastrodecomunicadores: 'Cadastro de Comunicadores',
    danoseletricos: 'Reclama\u00e7\u00e3o Danos El\u00e9tricos',
    reclamacaodanoseletricos: 'Reclama\u00e7\u00e3o Danos El\u00e9tricos',
    reclamacaosobredanoseletricos: 'Reclama\u00e7\u00e3o Danos El\u00e9tricos',
    solicitacaoderessarcimentodedanoseletricos: 'Reclama\u00e7\u00e3o Danos El\u00e9tricos',
    declaracaodequitacaoanualdedebito: 'Declara\u00e7\u00e3o de quita\u00e7\u00e3o de d\u00e9bito',
    denunciarumafraude: 'Den\u00fancia de Fraude',
    querodenunciarumafraude: 'Den\u00fancia de Fraude',
    solicitardesligamento: 'Desligamento',
    privadosolicitardesligamento: 'Desligamento',
    desligamentodefinitivogrupoa: 'Desligamento',
    enviarautoleitura: 'Auto leitura',
    enviarminhaautoleitura: 'Auto leitura',
    financiamento: 'Financiamento',
    formulariodesolicitacaodeinformacao: 'Formul\u00e1rio de Solicita\u00e7\u00e3o de informa\u00e7\u00e3o',
    geracaodistribuidaorcamentodeconexaogd: 'Or\u00e7amento de conex\u00e3o GD',
    orcamentodeconexao: 'Or\u00e7amento de conex\u00e3o GD',
    parecerdeacesso: 'Or\u00e7amento de conex\u00e3o GD',
    orcamentodeconexaogrupoa: 'Or\u00e7amento de conex\u00e3o GD',
    geracaodistribuidavistoriagd: 'Vistoria de Conex\u00e3o GD',
    vistoriaconexaogd: 'Vistoria de Conex\u00e3o GD',
    passarcontaparaoseunome: 'Troca de titularidade',
    trocadetitularidade: 'Troca de titularidade',
    trocardetitularidade: 'Troca de titularidade',
    trocadetitularidadegrupoa: 'Troca de titularidade',
    problemascomologin: 'Problemas com Login',
    reativacao: 'Reativa\u00e7\u00e3o',
    reativarenergia: 'Reativa\u00e7\u00e3o',
    reativarenergiaform: 'Reativa\u00e7\u00e3o',
    solicitacaodegravacaotelefonica: 'Solicitar grava\u00e7\u00e3o telef\u00f4nica',
    solicitargravacaodeatendimento: 'Solicitar grava\u00e7\u00e3o telef\u00f4nica',
    solicitarfaturaporemail: 'Fatura por e-mail',
    solicitarligacaonova: 'Liga\u00e7\u00e3o Nova',
    trocadepadrao: 'Troca de padr\u00e3o',
  };
  const key = normalizeKeyName(raw);
  if (map[key]) return map[key];
  if (key.startsWith('reclamacao')) return 'Reclama\u00e7\u00e3o';
  return raw;
}

function parseCsvLineSafe(line, sep = ';') {
  const cols = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === sep && !quoted) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function splitCsvRecordsSafe(text) {
  const records = [];
  let current = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      current += ch;
      if (quoted && source[i + 1] === '"') {
        current += source[i + 1];
        i++;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      if (current.trim() !== '') records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim() !== '') records.push(current);
  return records;
}

function parseCsvRowsFromTextSafe(text, sep = ';') {
  const records = splitCsvRecordsSafe(text);
  if (records.length < 2) return [];
  const headers = parseCsvLineSafe(records[0], sep).map(h => h.replace(/^\uFEFF/, '').trim());
  return records.slice(1).map(record => {
    const cols = parseCsvLineSafe(record, sep);
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) obj[headers[i]] = cols[i] ? cols[i].trim() : '';
    }
    return obj;
  });
}

function readTextFileSmartSafe(p) {
  const buf = fs.readFileSync(p);
  const utf = buf.toString('utf8');
  const replacementChars = (utf.match(/\uFFFD/g) || []).length;
  return replacementChars > 0 ? buf.toString('latin1') : utf;
}

function readCsvRowsSafe(p) {
  if (!safeExists(p)) return [];
  return parseCsvRowsFromTextSafe(readTextFileSmartSafe(p));
}

function toRegiaoMesa(empresa) {
  let regiao = MAP_EMP_MESA[String(empresa || '').trim()] || String(empresa || '').trim();
  if (regiao === 'CSA CSA' || regiao.startsWith('CSA')) regiao = 'CSA';
  return regiao;
}

function sourceRecordScore(record) {
  return ['tipoServico', 'prazo', 'status', 'data', 'origem', 'skill']
    .reduce((score, key) => score + (record?.[key] ? 1 : 0), 0);
}

function addBaseRowToSourceIndex(index, empresa, protocolo, dataReqStr, servicoRaw, statusFinal, fonte, rowData = {}) {
  const protNorm = normProtocolo(protocolo);
  if (!protNorm) return;
  const hasDate = !!dataReqStr;
  const dSolicitacao = hasDate ? parseBaseDateMinus3h(dataReqStr) : null;
  const conclusao = dSolicitacao ? calcularPrazoBase(dSolicitacao) : null;
  const diff = conclusao ? getDiffPrazoDias(conclusao) : null;
  const tipoServico = getServicoAuxiliarBase(servicoRaw);
  const regiao = toRegiaoMesa(empresa);
  const record = {
    protocolo: protNorm,
    tipoServico: tipoServico || String(servicoRaw || '').trim(),
    empresa: regiao,
    prazo: diff === null ? '' : classificarStatusPrazoMesaLabel(diff),
    status: statusFinal || '',
    data: dSolicitacao ? formatDateOnlyBR(dSolicitacao) : '',
    conclusaoDesejada: conclusao ? formatDateOnlyBR(conclusao) : '',
    origem: fonte || '',
    skill: '',
    fluxo: '',
    prioridade: '',
    rawEmpresa: empresa || '',
    rawServico: servicoRaw || '',
  };
  const existing = index.get(protNorm);
  if (!existing || sourceRecordScore(record) >= sourceRecordScore(existing)) index.set(protNorm, record);
}

function buildMesaSourceEnrichmentIndex(onProgress = null) {
  const xlsx = require('xlsx');
  const index = new Map();
  const errors = [];
  const progress = msg => { if (onProgress) onProgress(msg); };

  const mapEstados = {
    'Amapa': 'EQTL AP',
    'Amap\u00e1': 'EQTL AP',
    'Alagoas': 'EQTL AL',
    'Maranhao': 'EQTL MA',
    'Maranh\u00e3o': 'EQTL MA',
    'Para': 'EQTL PA',
    'Par\u00e1': 'EQTL PA',
    'Piaui': 'EQTL PI',
    'Piau\u00ed': 'EQTL PI',
  };

  for (const p of CONFIG.PATHS_XLS || []) {
    try {
      if (!safeExists(p)) {
        errors.push(`Nao encontrado ou sem acesso: ${path.basename(p || '')}`);
        continue;
      }
      const wb = xlsx.readFile(p);
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true });
      progress(`Indexando ${path.basename(p)} para detalhes da limpeza: ${rows.length} linhas`);
      for (const row of rows) {
        const estado = rowValue(row, ['estado']);
        const emp = mapEstados[estado] || estado;
        addBaseRowToSourceIndex(
          index,
          emp,
          rowValue(row, ['protocolo']),
          rowValue(row, ['criadoem', 'data', 'datadecriacao']),
          rowValue(row, ['descricao']),
          rowValue(row, ['situacao']),
          'SITE NOVO',
          row
        );
      }
    } catch (e) {
      errors.push(`${path.basename(p || '')}: ${e.message}`);
    }
  }

  const csvSources = [
    { path: CONFIG.PATH_EQTL_RS, empresa: 'EQTL RS' },
    { path: CONFIG.PATH_EQTL_GO, empresa: 'EQTL GO' },
  ];
  for (const src of csvSources) {
    try {
      const rows = readCsvRowsSafe(src.path);
      progress(`Indexando ${src.empresa} para detalhes da limpeza: ${rows.length} linhas`);
      for (const row of rows) {
        const st = rowValue(row, ['linkoustatus', 'status']).toString().toLowerCase();
        addBaseRowToSourceIndex(
          index,
          src.empresa,
          rowValue(row, ['protocolo']),
          rowValue(row, ['dataabertura', 'datadeabertura']),
          rowValue(row, ['tiposervico', 'tipodeservico']),
          st.includes('pend') ? 'Pendente' : 'Aberto',
          'SITE ANTIGO',
          row
        );
      }
    } catch (e) {
      errors.push(`${src.empresa}: ${e.message}`);
    }
  }

  try {
    const rows = readCsvRowsSafe(CONFIG.PATH_BKO_ALL);
    progress(`Indexando BKO All para detalhes da limpeza: ${rows.length} linhas`);
    for (const row of rows) {
      const st = rowValue(row, ['status']).toString().toLowerCase();
      addBaseRowToSourceIndex(
        index,
        rowValue(row, ['mandante']),
        rowValue(row, ['fixedprotocolo', 'protocolo']),
        rowValue(row, ['datadeabertura', 'dataabertura']),
        rowValue(row, ['tipodeservico', 'tiposervico']),
        st.includes('pend') ? 'Pendente' : 'Aberto',
        'SITE_ANTIGO',
        row
      );
    }
  } catch (e) {
    errors.push(`BKO All: ${e.message}`);
  }

  return { index, errors };
}

function mergeMesaRecordFromSource(record, source) {
  if (!source) return record;
  const currentStatus = record.status || '';
  const merged = {
    ...record,
    tipoServico: source.tipoServico || record.tipoServico || '',
    empresa: record.empresa || source.empresa || '',
    prazo: source.prazo || record.prazo || '',
    status: currentStatus && currentStatus !== 'Na mesa' ? currentStatus : (source.status || currentStatus || 'Na mesa'),
    data: source.data || record.data || '',
    origem: source.origem || record.origem || '',
    skill: source.skill || record.skill || '',
    fluxo: source.fluxo || record.fluxo || '',
    prioridade: source.prioridade || record.prioridade || '',
    conclusaoDesejada: source.conclusaoDesejada || record.conclusaoDesejada || '',
    sourceMatched: true,
  };
  if (merged.error && merged.tipoServico && merged.prazo) {
    merged.detailError = merged.error;
    delete merged.error;
  }
  return merged;
}

function enrichMesaRecordsWithSourceData(records, onProgress = null) {
  if (!records.length) return { records, matched: 0, errors: [], totalBase: 0 };
  if (onProgress) onProgress('Cruzando protocolos da mesa com as bases de origem para preencher tipo e prazo...');
  const { index, errors } = buildMesaSourceEnrichmentIndex(onProgress);
  let matched = 0;
  const enriched = records.map(record => {
    const source = index.get(normProtocolo(record.protocolo));
    if (!source) return record;
    matched++;
    return mergeMesaRecordFromSource(record, source);
  });
  return { records: enriched, matched, errors, totalBase: index.size };
}

async function gerarBaseCompleta(filtros = {}) {
  const xlsx = require('xlsx');

  // Emite progresso para a UI
  function progress(step, msg) {
    mainWindow.webContents.send('progress', { step, msg });
  }

  // ── 1. Buscar protocolos na mesa (Genesys) ────────────────────────────────
  progress(1, 'Conectando ao Genesys Cloud…');
  let protocolosNaMesa = new Set();

  if (CONFIG.CLIENT_ID && CONFIG.CLIENT_SECRET) {
    try {
      const mesa = await consultarMesaGenesys({
        protocolOnly: true,
        onProgress: msg => progress(1, msg)
      });

      for (const record of mesa.records || []) {
        const prot = normProtocolo(record.protocolo);
        if (prot) protocolosNaMesa.add(prot);
      }

      const pendentes = (mesa.records || []).filter(r => !normProtocolo(r.protocolo)).length;

      // Log de diagnóstico: mostra primeiros 5 protocolos da mesa
      const amostraMesa = [...protocolosNaMesa].slice(0, 5);
      progress(1, `Amostra mesa (${protocolosNaMesa.size} total): [${amostraMesa.join(' | ')}]`);
      if (pendentes) {
        progress(1, `Aviso: ${pendentes} conversa(s) seguem sem protocolo identificado apos retry.`);
      }

      // Notifica UI
      mainWindow.webContents.send('genesys-status', {
        ok: true,
        total: mesa.total,
        protocolos: protocolosNaMesa.size,
        region: mesa.region,
      });

      progress(1, `${protocolosNaMesa.size} protocolo(s) ja na mesa; serao removidos da base.`);

    } catch(e) {
      mainWindow.webContents.send('genesys-status', { ok: false, msg: e.message });
      progress(1, `Aviso Genesys: ${e.message}. Continuando sem filtro de duplicidade.`);
    }
  } else {
    mainWindow.webContents.send('genesys-status', { ok: false, msg: 'Credenciais não configuradas' });
    progress(1, 'Credenciais Genesys nao configuradas. Pulando verificacao de duplicidade.');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getEasterDate(y) {
    const a=y%19,b=Math.floor(y/100),c=y%100,d1=Math.floor(b/4),e=b%4;
    const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d1-g+15)%30;
    const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7;
    const m=Math.floor((a+11*h+22*l)/451);
    return new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);
  }

  function isBusinessDay(d) {
    const dow=d.getDay(); if(dow===0||dow===6) return false;
    const y=d.getFullYear(),m=d.getMonth()+1,day=d.getDate();
    const str=`${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
    if(["01/01","21/04","01/05","07/09","12/10","02/11","15/11","25/12"].includes(str)) return false;
    const easter=getEasterDate(y); const sf=new Date(easter); sf.setDate(sf.getDate()-2);
    return !(m===(sf.getMonth()+1)&&day===sf.getDate());
  }

  function getNextBusinessDay(date) {
    let d=new Date(date); d.setDate(d.getDate()+1);
    while(!isBusinessDay(d)) d.setDate(d.getDate()+1); return d;
  }

  function parseDateTimeMinus3h(val) {
    if(!val) return new Date(); let d;
    if(typeof val==='number'||(!isNaN(val)&&Number(val)>10000)) {
      d=new Date(Math.round((Number(val)-25569)*86400*1000));
    } else if(val instanceof Date) { d=new Date(val);
    } else {
      let s=val.toString().trim();
      if(s.match(/^\d{4}-\d{2}-\d{2}/)) { d=new Date(s); } else {
        let p=s.split(/[\s/:-]+/);
        if(p.length>=3) {
          let p0=parseInt(p[0]),p1=parseInt(p[1])-1,p2=parseInt(p[2]);
          let h=p[3]?parseInt(p[3]):0,min=p[4]?parseInt(p[4]):0,sec=p[5]?parseInt(p[5]):0;
          if(p2>=1000) d=new Date(p2,p1,p0,h,min,sec);
          else if(p0>=1000) d=new Date(p0,p1,p2,h,min,sec);
          else { let y=p2<100?p2+2000:p2; d=new Date(y,p1,p0,h,min,sec); }
        } else d=new Date(s);
      }
    }
    if(isNaN(d.getTime())) d=new Date();
    d.setHours(d.getHours()-3); return d;
  }

  function getServicoAuxiliar(s) {
    if(!s) return null; s=s.toString().trim();
    const map={
      "atualização cadastral":"Alteração dos dados do titular","atualização de dados do titular":"Alteração dos dados do titular",
      "atualizar dados do titular":"Alteração dos dados do titular","atualizar dados titular":"Altera\u00e7\u00e3o dos dados do titular","atualizar dados da instalação":"Alteração dos dados do titular",
      "atualizar dados para acesso":"Alteração dos dados do titular","dados do titular da conta contrato":"Alteração dos dados do titular",
      "alterar local do medidor":"Alterar medidor de local","mudança de medidor local":"Alterar medidor de local",
      "aparelho para manutenção da vida":"Cadastro de equipamento vital","cadastrar aparelho vital":"Cadastro de equipamento vital",
      "cadastrar email":"Cadastro de e-mail","cadastro baixa renda":"Cadastro baixa renda","cadastro de comunicadores":"Cadastro de Comunicadores",
      "danos elétricos":"Reclamação Danos Elétricos","reclamação danos elétricos":"Reclamação Danos Elétricos","reclamação sobre danos elétricos":"Reclamação Danos Elétricos",
      "solicitação de ressarcimento de danos elétricos":"Reclamação Danos Elétricos","declaração de quitação anual de débito":"Declaração de quitação de débito",
      "denunciar uma fraude":"Denúncia de Fraude","quero denunciar uma fraude":"Denúncia de Fraude","solicitar desligamento":"Desligamento",
      "privadosolicitar desligamento":"Desligamento","desligamento definitivo grupo a":"Desligamento","enviar autoleitura":"Auto leitura",
      "enviar minha autoleitura":"Auto leitura","financiamento":"Financiamento","formulário de solicitação de informação":"Formulário de Solicitação de informação",
      "geração distribuída orçamento de conexão gd":"Orçamento de conexão GD","orçamento de conexão":"Orçamento de conexão GD","parecer de acesso":"Or\u00e7amento de conex\u00e3o GD",
      "orçamento de conexão grupo a":"Orçamento de conexão GD","geração distribuída vistoria gd":"Vistoria de Conexão GD",
      "vistoria / conexão gd":"Vistoria de Conexão GD","passar conta para o seu nome":"Troca de titularidade","troca de titularidade":"Troca de titularidade",
      "trocar de titularidade":"Troca de titularidade","troca de titularidade grupo a":"Troca de titularidade","problemas com o login":"Problemas com Login",
      "reativação":"Reativação","reativar energia":"Reativação","reativar energia form":"Reativação","solicitação de gravação telefônica":"Solicitar gravação telefônica",
      "solicitar gravação de atendimento":"Solicitar gravação telefônica","solicitar fatura por email":"Fatura por e-mail",
      "solicitar ligação nova":"Ligação Nova","troca de padrão":"Troca de padrão"
    };
    const sL=s.toLowerCase();
    if(map[sL]) return map[sL];
    if(sL.startsWith("reclamação")) return "Reclamação";
    return s;
  }

  function formatD(d) {
    if(!d||isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function normalizarChave(k) {
    return k?k.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,""):"";
  }

  function getVal(row,possibleKeys) {
    const nk=possibleKeys.map(normalizarChave);
    for(let k in row) if(nk.includes(normalizarChave(k))) return row[k]||'';
    return '';
  }

  function parseCsvLine(line, sep = ';') {
    const cols = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === sep && !quoted) {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols;
  }

  function readTextFileSmart(p) {
    const buf = fs.readFileSync(p);
    const utf = buf.toString('utf8');
    const replacementChars = (utf.match(/\uFFFD/g) || []).length;
    return replacementChars > 0 ? buf.toString('latin1') : utf;
  }

  function lerCSV(p) {
    if(!fs.existsSync(p)) return [];
    return parseCsvRowsFromTextSafe(readTextFileSmart(p));
  }

  // ── 2. Carregar priorização ───────────────────────────────────────────────
  progress(2, 'Carregando tabela de priorização…');
  const mapPrio = {};
  if (fs.existsSync(CONFIG.PATH_PRIORIZACAO)) {
    const wbPrio = xlsx.readFile(CONFIG.PATH_PRIORIZACAO);
    const wsC = wbPrio.Sheets["CONSOLIDADO"];
    if (wsC) {
      const dp = xlsx.utils.sheet_to_json(wsC, { raw: false });
      for (let row of dp) {
        const emp = getVal(row,['emppresa','empresa','mandante']).toString().trim().toUpperCase();
        const serv = getVal(row,['servico','tipodeservico']).toString().trim().toUpperCase();
        mapPrio[`${emp}|${serv}`] = {
          skill: getVal(row,['skill'])||'',
          empPrio: Number(getVal(row,['prioridadeempresa']))||0,
          demPrio: Number(getVal(row,['priorizacaodem','priorizacaodemanda']))||0
        };
      }
    }
  }

  // ── 3. Processar linhas ───────────────────────────────────────────────────
  progress(3, 'Processando bases…');
  const rowsData = [];
  let totalBaseOriginal = 0;
  let duplicatasRemovidas = 0;
  const protocolosRemovidos = new Set();
  const uniqueSkillsDisponiveis = new Set();
  const uniqueTiposDisponiveis = new Set();
  const MAP_EMP = {"EQTL MA":"MA","EQTL PA":"PA","EQTL PI":"PI","EQTL AL":"AL","EQTL GO":"GO","EQTL AP":"CEA","EQTL RS":"CEEE"};
  const excluirTiposBI = [...new Set([...(BI_MESA_EXCLUDED_SERVICES || []), ...((filtros || {}).excluirTiposServico || [])])];
  const isServicoExcluidoBI = (servico) => {
    const key = normalizarChave(servico);
    return key && excluirTiposBI.some(ex => normalizarChave(ex) === key);
  };

  function processarLinha(empresa, protocolo, dataReqStr, servicoRaw, statusFinal, fonte, email, rowData) {
    if(!dataReqStr) return;

    // Normaliza o protocolo da base com a mesma função do escopo do módulo
    const protNorm = normProtocolo(protocolo);
    if (!protNorm) return;

    // Compara com o Set da mesa (ambos normalizados pela mesma função)
    const dSolicitacao = parseDateTimeMinus3h(dataReqStr);
    const servAux = getServicoAuxiliar(servicoRaw);
    if(!servAux) return;
    if(isServicoExcluidoBI(servAux) || isServicoExcluidoBI(servicoRaw)) return;

    // ── Responsável — mesma lógica do painel de referência ──────────────────
    let responsavel;
    if (/grupo\s*a/i.test(servAux)) {
      responsavel = "Grandes Clientes";
    } else if (["Orçamento de conexão GD","Vistoria de Conexão GD","Geração distribuída orçamento de conexão GD",
                 "Geração distribuída vistoria GD","Orçamento de Conexão","Vistoria / Conexão GD",
                 "Vistoria / conexão GD"].includes(servAux)
               || servAux.toLowerCase().includes('geração distribuída')) {
      responsavel = "BackOffice GD";
    } else {
      responsavel = "BackOffice Varejo";
    }

    let isGD = responsavel === "BackOffice GD";
    let fluxo = isGD ? "9c3d6b66-015a-4891-b371-a9d533bb5247" : "27c5c2f1-755b-4f73-866a-138104443d1c";

    // ── Prazo: D+1 útil a partir da data de abertura (padrão do painel) ─────
    function isFeriadoOuFimDeSemana(d) {
      if (d.getDay() === 0 || d.getDay() === 6) return true;
      const iso = d.toISOString().split('T')[0];
      return ['2025-12-25','2026-01-01','2026-04-21','2026-05-01',
              '2026-09-07','2026-10-12','2026-11-02','2026-11-15'].includes(iso);
    }

    function calcularPrazo(dataSolicitacao) {
      let d = new Date(dataSolicitacao.getTime());
      d.setHours(0, 0, 0, 0);
      let dias = 0;
      while (dias < 1) {
        d.setDate(d.getDate() + 1);
        if (!isFeriadoOuFimDeSemana(d)) dias++;
      }
      return d;
    }

    // ── Status do prazo — categorias do painel de referência ─────────────────
    function getDiffPrazoDias(dataPrazo) {
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      return Math.floor((dataPrazo - hoje) / 86400000);
    }

    function classificarStatusPrazo(diff) {
      if (diff < 0) return '0-PASSIVO';
      if (diff === 0) return '1-VENCE HOJE';
      return `2-VENCE D+${diff}`;
    }

    function classificarStatusPrazoMesa(diff) {
      if (diff < 0) {
        const atraso = Math.abs(diff);
        return `0-PASSIVO D-${atraso >= 15 ? '15+' : atraso}`;
      }
      if (diff === 0) return '1-VENCE HOJE';
      return `2-VENCE D+${diff}`;
    }

    function prioridadePorPrazo(diff) {
      if (diff < 0) {
        const atraso = Math.min(Math.abs(diff), 15);
        return 326000 + (atraso * 10000);
      }
      if (diff === 0) return 326000;
      return 8000;
    }

    const conclusao       = calcularPrazo(dSolicitacao);
    const diffPrazoDias   = getDiffPrazoDias(conclusao);
    const statusPrazoBase = classificarStatusPrazo(diffPrazoDias);
    const statusPrazoMesa = classificarStatusPrazoMesa(diffPrazoDias);

    // ── Prioridade numérica para ordenação ────────────────────────────────────
    let prioRaw=mapPrio[`${empresa.toUpperCase()}|${servicoRaw.toUpperCase()}`];
    let prioAux=mapPrio[`${empresa.toUpperCase()}|${servAux.toUpperCase()}`];
    let infoPrio=prioRaw||prioAux||{skill:"",empPrio:0,demPrio:0};

    let skillFinal=infoPrio.skill;
    if(servicoRaw.trim().toLowerCase()==="reativar energia form") skillFinal="Reativacao_BKO";
    if(fonte==="SITE NOVO"&&skillFinal&&!skillFinal.includes("- NS")) skillFinal+=" - NS";

    // Prioridade por status de prazo no mesmo patamar usado pela base do BI.
    let prioridadePrazo = prioridadePorPrazo(diffPrazoDias);

    let credenciado=getVal(rowData,['credenciadonome','credenciado','credenciadovalida']).toString().trim().toLowerCase();
    let isCredenciado=credenciado.startsWith('sim')||(fonte==="SITE NOVO"&&credenciado!=="");
    let prioridadeCred=isCredenciado?175:0;
    let prioridadeFonte=fonte==="SITE NOVO"?20:10;
    let prioridade=infoPrio.empPrio+infoPrio.demPrio+prioridadePrazo+prioridadeFonte+prioridadeCred;

    let regiao=MAP_EMP[empresa]||empresa;
    if(regiao==="CSA CSA"||regiao.startsWith("CSA")) regiao="CSA";

    if (servAux) uniqueTiposDisponiveis.add(servAux);
    if (skillFinal) uniqueSkillsDisponiveis.add(skillFinal);

    // ── Aplicar filtros da interface ────────────────────────────────────────
    const f = filtros || {};
    if(f.estados?.length && !f.estados.includes(regiao)) return;

    // SLA filter — categorias do painel de referência
    if(f.sla?.length) {
      const matched = f.sla.some(s => {
        if(s==="passivo") return statusPrazoBase === '0-PASSIVO';
        if(s==="hoje")    return statusPrazoBase === '1-VENCE HOJE';
        if(s==="amanha")  return statusPrazoBase.startsWith('2-VENCE');
        return false;
      });
      if(!matched) return;
    }

    if(f.skills?.length && !f.skills.includes(skillFinal)) return;
    if(f.responsavel?.length && !f.responsavel.includes(responsavel)) return;
    if(f.tiposServico?.length && !f.tiposServico.includes(servAux)) return;
    if(f.sites?.length) {
      const fonteNorm = fonte==="SITE NOVO"?"novo":"antigo";
      if(!f.sites.includes(fonteNorm)) return;
    }
    if(f.emails?.length) {
      const emailLower = email.toString().toLowerCase();
      if(!f.emails.some(e => emailLower.includes(e.toLowerCase()))) return;
    }

    totalBaseOriginal++;
    if (protocolosNaMesa.has(protNorm)) {
      duplicatasRemovidas++;
      protocolosRemovidos.add(protNorm);
      return;
    }

    rowsData.push({
      regiao, protocolo: protNorm, conclusao: formatD(conclusao), servAux,
      statusFinal, fonte, skillFinal, fluxo, prioridade,
      statusPrazoMesa, responsavel, email,
      str: `${regiao};${protNorm};${formatD(conclusao)};${regiao};${protNorm};${servAux};${statusFinal};${fonte};${skillFinal||''};${fluxo};${prioridade};${statusPrazoMesa}`
    });
  }

  // ── Processar XLS (Site Novo) ─────────────────────────────────────────────
  let totalXls = 0;
  for(let p of CONFIG.PATHS_XLS) {
    if(!fs.existsSync(p)) { progress(3,`Nao encontrado: ${path.basename(p)}`); continue; }
    const wb = xlsx.readFile(p);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true });
    totalXls += data.length;

    // Log de amostra: mostra como o protocolo vem do XLS (diagnóstico)
    if (data.length > 0) {
      const amostraXls = data.slice(0, 2).map(r => {
        const raw = getVal(r, ['protocolo']);
        return `tipo:${typeof raw} val:"${raw}" norm:"${normProtocolo(raw)}"`;
      });
      progress(3, `XLS amostra protocolo → ${amostraXls[0]}`);
    }

    const mapEstados={"Amapá":"EQTL AP","Alagoas":"EQTL AL","Maranhão":"EQTL MA","Pará":"EQTL PA","Piauí":"EQTL PI"};
    for(let row of data) {
      let e=getVal(row,['estado']);
      let emp=mapEstados[e]||e;
      processarLinha(emp,getVal(row,['protocolo']),getVal(row,['criadoem','data','datadecriacao']),getVal(row,['descricao']),getVal(row,['situacao']),"SITE NOVO",getVal(row,['email']),row);
    }
  }
  progress(3,`Site Novo: ${totalXls} linhas lidas.`);

  // ── Processar CSVs (Site Antigo) ──────────────────────────────────────────
  const csvSources = [
    { path: CONFIG.PATH_EQTL_RS, empresa: "EQTL RS" },
    { path: CONFIG.PATH_EQTL_GO, empresa: "EQTL GO" },
  ];
  for(let src of csvSources) {
    const rows = lerCSV(src.path);
    progress(3,`${src.empresa}: ${rows.length} linhas.`);
    // Log de amostra do CSV
    if (rows.length > 0) {
      const rawProt = getVal(rows[0], ['protocolo']);
      progress(3, `${src.empresa} amostra → tipo:${typeof rawProt} val:"${rawProt}" norm:"${normProtocolo(rawProt)}"`);
    }
    for(let row of rows) {
      let st=getVal(row,['linkoustatus','status']).toLowerCase();
      processarLinha(src.empresa,getVal(row,['protocolo']),getVal(row,['dataabertura','datadeabertura']),getVal(row,['tiposervico','tipodeservico']),st.includes("pend")?"Pendente":"Aberto","SITE ANTIGO",getVal(row,['email']),row);
    }
  }

  const rowsBkoAll = lerCSV(CONFIG.PATH_BKO_ALL);
  progress(3,`BKO All: ${rowsBkoAll.length} linhas.`);
  // Log de amostra do BKO All
  if (rowsBkoAll.length > 0) {
    const rawProt = getVal(rowsBkoAll[0], ['fixedprotocolo','protocolo']);
    progress(3, `BKO All amostra → tipo:${typeof rawProt} val:"${rawProt}" norm:"${normProtocolo(rawProt)}"`);
  }
  for(let row of rowsBkoAll) {
    let st=getVal(row,['status']).toLowerCase();
    processarLinha(getVal(row,['mandante']),getVal(row,['fixedprotocolo','protocolo']),getVal(row,['datadeabertura','dataabertura']),getVal(row,['tipodeservico','tiposervico']),st.includes("pend")?"Pendente":"Aberto","SITE_ANTIGO",getVal(row,['email']),row);
  }

  // Cruzamento final: log mostra quantos foram filtrados por estar na mesa
  const protocolosNaMesaArr = [...protocolosNaMesa];
  const protocolosNaBase    = rowsData.map(r => r.protocolo);
  const intersecao = protocolosNaMesaArr.filter(p => protocolosNaBase.includes(p)).length;
  progress(4, `Cruzamento: ${protocolosNaMesa.size} na mesa × ${rowsData.length} na base → ${intersecao} coincidências restantes (deveria ser 0)`);

  // ── 4. Ordenar e gerar CSV ────────────────────────────────────────────────
  progress(4, 'Ordenando e gerando CSV…');
  rowsData.sort((a,b) => b.prioridade - a.prioridade);

  const outputDir = ensureDir(getInputMesaDir());
  const outputPath = path.join(outputDir, 'mesa_distribuicao.csv');

  const outputRows = [
    CSV_HEADER_MESA.join(';'),
    ...rowsData.map(r => r.str)
  ];
  fs.writeFileSync(outputPath, '\uFEFF' + outputRows.join('\n'), 'utf8');

  // Estatísticas para a UI
  const stats = {
    total: rowsData.length,
    porEstado: {},
    porSLA: {},
    porResponsavel: {},
  };
  for(let r of rowsData) {
    stats.porEstado[r.regiao] = (stats.porEstado[r.regiao]||0)+1;
    const slaKey = r.statusPrazoMesa.startsWith("0-PASSIVO") ? "Passivo" : r.statusPrazoMesa === "1-VENCE HOJE" ? "Hoje" : "No prazo";
    stats.porSLA[slaKey] = (stats.porSLA[slaKey]||0)+1;
    stats.porResponsavel[r.responsavel] = (stats.porResponsavel[r.responsavel]||0)+1;
  }

  // Coletar valores únicos para filtros dinâmicos
  const uniqueSkills = [...uniqueSkillsDisponiveis].filter(Boolean).sort();
  const uniqueTipos  = [...uniqueTiposDisponiveis].filter(Boolean).sort();

  return {
    ok: true,
    outputPath,
    total: rowsData.length,
    totalOriginal: totalBaseOriginal,
    protocolosJaNaMesa: protocolosNaMesa.size,
    duplicatasRemovidas,
    protocolosRemovidos: [...protocolosRemovidos],
    filtrosAplicados: filtros || {},
    summary: {
      totalOriginal: totalBaseOriginal,
      totalProtocolosMesa: protocolosNaMesa.size,
      duplicatasRemovidas,
      totalFinal: rowsData.length,
      filtrosAplicados: filtros || {}
    },
    stats,
    uniqueSkills,
    uniqueTipos,
    msg: `Base gerada: ${rowsData.length} registros → ${path.basename(outputPath)}`
  };
}
