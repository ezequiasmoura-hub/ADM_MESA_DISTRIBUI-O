const fs = require('fs');
const path = require('path');

const SUCCESS_CODES = new Set([200, 201, 202, 203, 204]);

const REGION_CONFIG = {
  SAE: {
    tokenUrl: 'https://login.sae1.pure.cloud/oauth/token',
    apiUrl: 'https://api.sae1.pure.cloud',
    provider: 'genesys.equatorial.sae1.pure.cloud',
    toAddress: 'nota@equatorial.sae1.pure.cloud',
  },
  sa_east_1: {
    tokenUrl: 'https://login.sae1.pure.cloud/oauth/token',
    apiUrl: 'https://api.sae1.pure.cloud',
    provider: 'genesys.equatorial.sae1.pure.cloud',
    toAddress: 'nota@equatorial.sae1.pure.cloud',
  },
  sae1: {
    tokenUrl: 'https://login.sae1.pure.cloud/oauth/token',
    apiUrl: 'https://api.sae1.pure.cloud',
    provider: 'genesys.equatorial.sae1.pure.cloud',
    toAddress: 'nota@equatorial.sae1.pure.cloud',
  },
  USW2: {
    tokenUrl: 'https://login.usw2.pure.cloud/oauth/token',
    apiUrl: 'https://api.usw2.pure.cloud',
    provider: 'genesys.equatorial.usw2.pure.cloud',
    toAddress: 'nota@equatorial.usw2.pure.cloud',
  },
  US_EAST: {
    tokenUrl: 'https://login.mypurecloud.com/oauth/token',
    apiUrl: 'https://api.mypurecloud.com',
    provider: 'genesys.equatorial.mypurecloud.com',
    toAddress: 'nota@equatorial.mypurecloud.com',
  },
  us_east_1: {
    tokenUrl: 'https://login.mypurecloud.com/oauth/token',
    apiUrl: 'https://api.mypurecloud.com',
    provider: 'genesys.equatorial.mypurecloud.com',
    toAddress: 'nota@equatorial.mypurecloud.com',
  },
  us_west_2: {
    tokenUrl: 'https://login.usw2.pure.cloud/oauth/token',
    apiUrl: 'https://api.usw2.pure.cloud',
    provider: 'genesys.equatorial.usw2.pure.cloud',
    toAddress: 'nota@equatorial.usw2.pure.cloud',
  },
};

function envInt(name, fallback, min, max) {
  const value = Number.parseInt(String(process.env[name] ?? fallback), 10);
  let normalized = Number.isFinite(value) ? value : fallback;
  if (min !== undefined) normalized = Math.max(min, normalized);
  if (max !== undefined) normalized = Math.min(max, normalized);
  return normalized;
}

function envFloat(name, fallback, min, max) {
  const value = Number(String(process.env[name] ?? fallback).replace(',', '.'));
  let normalized = Number.isFinite(value) ? value : fallback;
  if (min !== undefined) normalized = Math.max(min, normalized);
  if (max !== undefined) normalized = Math.min(max, normalized);
  return normalized;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(headerValue, fallbackSeconds) {
  const raw = String(headerValue || '').trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const seconds = Math.ceil((date.getTime() - Date.now()) / 1000);
      if (seconds > 0) return seconds;
    }
  }
  return fallbackSeconds;
}

function parseCsv(text, delimiter = ';') {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map(header => String(header || '').replace(/^"|"$/g, '').trim());
  return rows
    .filter(cols => cols.some(col => String(col || '').trim()))
    .map(cols => {
      const item = {};
      headers.forEach((header, idx) => {
        item[header] = String(cols[idx] ?? '').trim();
      });
      return item;
    });
}

function parseCredentialLine(line, index) {
  const parts = String(line || '').split('|').map(part => part.trim());
  if (parts.length >= 3) {
    return { name: parts[0] || `CRED_${index + 1}`, client_id: parts[1], client_secret: parts.slice(2).join('|') };
  }
  if (parts.length === 2) {
    return { name: `CRED_${index + 1}`, client_id: parts[0], client_secret: parts[1] };
  }
  return null;
}

function parseUploadCredentials() {
  const raw = String(process.env.MESA_UPLOAD_CREDENTIALS_JSON || process.env.MESA_UPLOAD_CREDENTIALS || '').trim();
  let credentials = [];

  if (raw) {
    if (raw.startsWith('[')) {
      credentials = JSON.parse(raw);
    } else {
      credentials = raw
        .split(/\r?\n|;/)
        .map((line, index) => parseCredentialLine(line, index))
        .filter(Boolean);
    }
  }

  const fallbackClientId = process.env.MESA_UPLOAD_CLIENT_ID || process.env.CLIENT_ID || '';
  const fallbackClientSecret = process.env.MESA_UPLOAD_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
  if (!credentials.length && fallbackClientId && fallbackClientSecret) {
    credentials = [{ name: 'GENESYS', client_id: fallbackClientId, client_secret: fallbackClientSecret }];
  }

  const normalized = credentials
    .map((cred, index) => ({
      name: String(cred.name || `CRED_${index + 1}`).trim(),
      client_id: String(cred.client_id || cred.clientId || '').trim(),
      client_secret: String(cred.client_secret || cred.clientSecret || '').trim(),
    }))
    .filter(cred => cred.client_id && cred.client_secret);

  if (!normalized.length) {
    throw new Error('Nenhuma credencial de subida configurada. Configure CLIENT_ID/CLIENT_SECRET ou MESA_UPLOAD_CREDENTIALS.');
  }

  return normalized;
}

function getRegionConfig() {
  const region = String(process.env.MESA_UPLOAD_REGION || process.env.ORG_REGION || 'sa_east_1').trim();
  const config = REGION_CONFIG[region] || REGION_CONFIG[region.replace(/-/g, '_')] || REGION_CONFIG.SAE;
  return {
    ...config,
    region,
    endpoint: process.env.MESA_UPLOAD_EMAIL_ENDPOINT || `${config.apiUrl}/api/v2/conversations/emails`,
    provider: process.env.MESA_UPLOAD_PROVIDER || config.provider,
    toAddress: process.env.MESA_UPLOAD_TO_ADDRESS || config.toAddress,
  };
}

class TokenService {
  constructor(regionConfig, credential) {
    this.regionConfig = regionConfig;
    this.credential = credential;
    this.token = '';
    this.uses = 0;
    this.maxUses = envInt('MESA_TOKEN_MAX_REQUESTS', 200, 1);
  }

  async requestToken() {
    const basic = Buffer.from(`${this.credential.client_id}:${this.credential.client_secret}`, 'latin1').toString('base64');
    const response = await fetch(this.regionConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Falha ao obter token (${response.status}) para ${this.credential.name}: ${text.slice(0, 200)}`);
    }
    const payload = await response.json();
    this.token = payload.access_token || '';
    this.uses = 0;
    return this.token;
  }

  async getToken() {
    if (!this.token || this.uses >= this.maxUses) {
      return this.requestToken();
    }
    this.uses += 1;
    return this.token;
  }
}

function createJsonlLogger() {
  const logDir = process.env.MESA_UPLOAD_LOG_DIR || process.cwd();
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(logDir, `upload-mesa-${stamp}.jsonl`);
  return {
    path: logPath,
    write(entry) {
      fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    },
  };
}

function buildPayload(row, regionConfig) {
  const attr = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      attr[key] = String(value).trim();
    }
  }

  const nota = attr.Nota || attr.Protocolo || 'sem-nota';
  const flowId = String(row.Fluxo || '').trim();
  if (!flowId) return { skip: true, nota, reason: 'Fluxo vazio' };

  return {
    nota,
    payload: {
      provider: regionConfig.provider,
      skillIds: [''],
      languageId: '',
      priority: 0,
      toAddress: regionConfig.toAddress,
      fromName: '',
      attributes: attr,
      subject: nota,
      direction: 'INBOUND',
      htmlBody: nota,
      textBody: nota,
      externalContactId: '',
      flowId,
      fromAddress: `Mesa Distribuicao - ${nota}`,
    },
  };
}

function createStartLimiter(strategy, intervalSeconds) {
  let chain = Promise.resolve();
  let lastStartedAt = 0;
  return async function waitTurn() {
    if (strategy === 'batch' || intervalSeconds <= 0) return;
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.ceil(intervalSeconds * 1000 - (now - lastStartedAt));
      if (lastStartedAt && waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
    });
    chain = next.catch(() => {});
    return next;
  };
}

async function postEmail({ row, tokenService, regionConfig, logger, waitTurn, dryRun, options }) {
  const built = buildPayload(row, regionConfig);
  const credName = tokenService.credential.name;
  if (built.skip) {
    logger.write({ status: 'skip', nota: built.nota, cred: credName, reason: built.reason });
    return { status: 'skip', nota: built.nota, cred: credName };
  }

  if (dryRun) {
    logger.write({ status: 'dry_run', nota: built.nota, cred: credName });
    return { status: 'dry_run', nota: built.nota, cred: credName };
  }

  await waitTurn();

  let lastMessage = '';
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    const token = await tokenService.getToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
    try {
      const response = await fetch(regionConfig.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(built.payload),
        signal: controller.signal,
      });
      const text = await response.text().catch(() => '');
      if (SUCCESS_CODES.has(response.status)) {
        logger.write({ status: 'success', nota: built.nota, cred: credName, statusCode: response.status });
        return { status: 'success', nota: built.nota, cred: credName };
      }
      if ([400, 401, 403, 404, 409].includes(response.status)) {
        logger.write({ status: 'error', nota: built.nota, cred: credName, statusCode: response.status, response: text.slice(0, 1000) });
        return { status: 'error', nota: built.nota, cred: credName, statusCode: response.status };
      }
      if (response.status === 429) {
        const waitSeconds = parseRetryAfter(response.headers.get('retry-after'), options.rateLimitSleepSeconds);
        console.log(`[UPLOAD] Rate limit 429. Aguardando ${waitSeconds}s para continuar...`);
        await sleep(waitSeconds * 1000);
      } else {
        lastMessage = `HTTP ${response.status}: ${text.slice(0, 300)}`;
        await sleep(1000 * attempt);
      }
    } catch (error) {
      lastMessage = error.name === 'AbortError' ? 'timeout' : error.message;
      await sleep(1000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  logger.write({ status: 'exception', nota: built.nota, cred: credName, error: lastMessage });
  return { status: 'exception', nota: built.nota, cred: credName, error: lastMessage };
}

async function processWithWorkers(rows, services, regionConfig, logger, options) {
  const waitTurn = createStartLimiter(options.strategy, options.intervalSeconds);
  let cursor = 0;
  const totals = { success: 0, error: 0, skip: 0, dryRun: 0 };

  async function handleResult(result, processed, total) {
    if (result.status === 'success') totals.success += 1;
    else if (result.status === 'dry_run') totals.dryRun += 1;
    else if (result.status === 'skip') totals.skip += 1;
    else totals.error += 1;
    console.log(`[UPLOAD] ${processed}/${total} ${result.status.toUpperCase()} ${result.nota} [${result.cred}]`);
  }

  if (options.strategy === 'serial') {
    for (let i = 0; i < rows.length; i += 1) {
      const result = await postEmail({
        row: rows[i],
        tokenService: services[i % services.length],
        regionConfig,
        logger,
        waitTurn,
        dryRun: options.dryRun,
        options,
      });
      await handleResult(result, i + 1, rows.length);
    }
    return totals;
  }

  if (options.strategy === 'batch') {
    let processed = 0;
    for (let start = 0; start < rows.length; start += options.workers) {
      if (start > 0 && options.batchPauseSeconds > 0 && !options.dryRun) {
        await sleep(options.batchPauseSeconds * 1000);
      }
      const chunk = rows.slice(start, start + options.workers);
      const results = await Promise.all(chunk.map((row, idx) => postEmail({
        row,
        tokenService: services[idx % services.length],
        regionConfig,
        logger,
        waitTurn,
        dryRun: options.dryRun,
        options,
      })));
      for (const result of results) {
        processed += 1;
        await handleResult(result, processed, rows.length);
      }
    }
    return totals;
  }

  let processed = 0;
  async function worker(workerIndex) {
    const tokenService = services[workerIndex % services.length];
    while (cursor < rows.length) {
      const current = cursor;
      cursor += 1;
      const result = await postEmail({
        row: rows[current],
        tokenService,
        regionConfig,
        logger,
        waitTurn,
        dryRun: options.dryRun,
        options,
      });
      processed += 1;
      await handleResult(result, processed, rows.length);
    }
  }

  await Promise.all(Array.from({ length: options.workers }, (_, index) => worker(index)));
  return totals;
}

async function main() {
  const csvPath = path.resolve(process.argv[2] || process.env.MESA_UPLOAD_INPUT_FILE || 'mesa_distribuicao.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV nao encontrado: ${csvPath}`);
  }

  const credentials = parseUploadCredentials();
  const regionConfig = getRegionConfig();
  const logger = createJsonlLogger();
  const maxWorkers = envInt('MESA_UPLOAD_WORKERS', 5, 1, 5);
  let strategy = String(process.env.MESA_UPLOAD_STRATEGY || 'paced').trim().toLowerCase();
  if (!['paced', 'batch', 'serial'].includes(strategy)) strategy = 'paced';
  if (maxWorkers === 1) strategy = 'serial';

  const options = {
    strategy,
    workers: maxWorkers,
    intervalSeconds: envFloat('MESA_UPLOAD_INTERVAL_SECONDS', 2, 0),
    batchPauseSeconds: envFloat('MESA_UPLOAD_BATCH_PAUSE_SECONDS', envFloat('MESA_UPLOAD_INTERVAL_SECONDS', 2, 0), 0),
    retries: envInt('MESA_REQUEST_RETRIES', 8, 1),
    timeoutSeconds: envFloat('MESA_REQUEST_TIMEOUT_SECONDS', 25, 1),
    rateLimitSleepSeconds: envFloat('MESA_RATE_LIMIT_SLEEP_SECONDS', 30, 1),
    dryRun: process.env.MESA_DRY_RUN === '1' || process.argv.includes('--dry-run'),
  };

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const services = credentials.map(credential => new TokenService(regionConfig, credential));

  console.log(`[UPLOAD] CSV: ${csvPath}`);
  console.log(`[UPLOAD] Total: ${rows.length}`);
  console.log(`[UPLOAD] Credenciais: ${services.length}`);
  console.log(`[UPLOAD] Estrategia: ${options.strategy} | workers: ${options.workers} | intervalo: ${options.intervalSeconds}s`);
  console.log(`[UPLOAD] Log: ${logger.path}`);

  const totals = await processWithWorkers(rows, services, regionConfig, logger, options);
  console.log(`[UPLOAD] Sucesso: ${totals.success}`);
  if (options.dryRun) console.log(`[UPLOAD] Dry-run: ${totals.dryRun}`);
  console.log(`[UPLOAD] Ignorados: ${totals.skip}`);
  console.log(`[UPLOAD] Erros: ${totals.error}`);
  console.log(`[UPLOAD] Total: ${rows.length}`);

  if (totals.error > 0) {
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(`[UPLOAD] Erro fatal: ${error.message}`);
  process.exit(1);
});
