const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(ROOT_DIR, 'inputMesa', '.env') });

const SCRIPT_ENV_KEYS = {
  'site-novo.js': 'SITE_NOVO',
  'site-antigo.js': 'SITE_ANTIGO',
  'go.js': 'GO',
  'rs.js': 'RS',
};
const scriptKey = SCRIPT_ENV_KEYS[path.basename(process.argv[1] || '')] || '';

const BASE_DIR = process.env.EXTRACAO_BASE_DIR || 'H:\\TEMOTEO - NAO ABRA\\Base';
const USERNAME = (scriptKey && process.env[`EXTRACAO_${scriptKey}_USUARIO`])
  || process.env.EXTRACAO_USUARIO
  || process.env.RPA_USUARIO
  || '';
const PASSWORD = (scriptKey && process.env[`EXTRACAO_${scriptKey}_SENHA`])
  || process.env.EXTRACAO_SENHA
  || process.env.RPA_SENHA
  || '';
const HEADLESS = process.env.EXTRACAO_HEADLESS !== '0';

function requireCredentials() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Configure EXTRACAO_USUARIO e EXTRACAO_SENHA no .env ou inputMesa/.env.');
  }
  return { username: USERNAME, password: PASSWORD };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[;\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filePath, rows, columns) {
  ensureDir(path.dirname(filePath));
  const output = [
    columns.join(';'),
    ...rows.map(row => columns.map(col => csvEscape(row[col])).join(';')),
  ].join('\n');
  fs.writeFileSync(filePath, '\uFEFF' + output, 'utf8');
}

function toReportDateTime(date = new Date()) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
}

async function launchChromium(chromium) {
  return chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
  });
}

async function loginBackoffice(page, baseUrl, label) {
  const { username, password } = requireCredentials();
  console.log(`[${label}] Autenticando...`);
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (await page.locator('#login').count()) {
    await page.fill('#login', username);
    await page.fill('#password', password);
    if (await page.locator('#loginButton').count()) {
      await page.click('#loginButton');
    } else {
      await page.locator('input[type="submit"], button[type="submit"]').first().click();
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  }

  await page.waitForSelector('table, tbody.divide-y.divide-gray-200', { timeout: 60000 });
}

async function requestText(context, url) {
  const response = await context.request.get(url, {
    timeout: 25000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok()) return '';
  return response.text();
}

module.exports = {
  ROOT_DIR,
  BASE_DIR,
  HEADLESS,
  ensureDir,
  writeCsv,
  toReportDateTime,
  launchChromium,
  loginBackoffice,
  requestText,
  requireCredentials,
};
