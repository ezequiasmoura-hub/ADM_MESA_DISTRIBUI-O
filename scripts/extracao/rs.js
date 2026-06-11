const path = require('path');
const cheerio = require('cheerio');
const { request } = require('playwright');
const { BASE_DIR, requireCredentials, writeCsv } = require('./shared');
const { assertNonEmptyRows } = require('./output-validation');

const URL_BASE = 'https://backoffice-rs.equatorialenergia.com.br';
const OUTPUT_FILE = path.join(process.env.EXTRACAO_OUTPUT_DIR || BASE_DIR, 'EQTL_RS.csv');
const CONCORRENCIA_HTTP = Number(process.env.EXTRACAO_RS_CONCORRENCIA) || 100;
const HTTP_TIMEOUT_MS = Number(process.env.EXTRACAO_RS_TIMEOUT_MS) || 30000;
const MAX_TENTATIVAS_HTTP = Number(process.env.EXTRACAO_RS_MAX_TENTATIVAS) || 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cellTextParts($, cell) {
  const clone = $(cell).clone();
  clone.find('script, style').remove();
  const parts = [];

  function walk(node) {
    $(node).contents().each((_, child) => {
      if (child.type === 'text') {
        const text = String(child.data || '').trim();
        if (text) parts.push(text);
      } else {
        walk(child);
      }
    });
  }

  clone.each((_, node) => walk(node));
  return parts;
}

function compactCellText($, cell) {
  return cellTextParts($, cell).join('');
}

function spacedCellText($, cell) {
  return cleanText(cellTextParts($, cell).join(' '));
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const tbody = $('tbody.divide-y.divide-gray-200').first();
  const rows = [];

  if (!tbody.length) {
    return rows;
  }

  tbody.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    const emailEl = $(tds[4]).find('[title]').first();
    const email = emailEl.length ? cleanText(emailEl.attr('title')) : compactCellText($, tds[4]);
    const td7 = $(tr).find('td.col7').first();
    const statusCol7 = td7.length ? compactCellText($, td7) : (tds.length > 6 ? compactCellText($, tds[6]) : '');
    const actions = $(tr).find('td.actions').first();
    const view = actions.find('a[title="Visualizar"]').attr('href') || '';
    const block = actions.find('a[title="Analisar"]').attr('href') || actions.find('a[href*="action=block"]').attr('href') || '';

    rows.push({
      data_abertura: spacedCellText($, tds[0]),
      protocolo: compactCellText($, tds[1]),
      tipo_servico: compactCellText($, tds[2]),
      conta_contrato: compactCellText($, tds[3]),
      email,
      link_ou_status: view || block || statusCol7,
    });
  });

  return rows;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createLoggedContext() {
  const { username, password } = requireCredentials();
  const context = await request.newContext({
    extraHTTPHeaders: {
      'User-Agent': USER_AGENT,
    },
  });

  try {
    console.log('[RS] Autenticando via HTTP...');
    await context.get(`${URL_BASE}/login`, { timeout: HTTP_TIMEOUT_MS });
    const response = await context.post(`${URL_BASE}/login?action=auth`, {
      form: { login: username, password },
      timeout: HTTP_TIMEOUT_MS,
      maxRedirects: 0,
    });

    if (![200, 302, 303].includes(response.status())) {
      const body = await response.text().catch(() => '');
      throw new Error(`login retornou status ${response.status()}: ${cleanText(body).slice(0, 160)}`);
    }

    return context;
  } catch (error) {
    await context.dispose().catch(() => {});
    throw error;
  }
}

async function fetchPage(context, pageNum) {
  const url = pageNum === 1 ? `${URL_BASE}/` : `${URL_BASE}/page/${pageNum}/`;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_TENTATIVAS_HTTP; attempt++) {
    try {
      const response = await context.get(url, {
        timeout: HTTP_TIMEOUT_MS,
        maxRedirects: 5,
      });

      if (response.status() === 404) return [];
      if (!response.ok()) throw new Error(`pagina ${pageNum} retornou HTTP ${response.status()}`);

      const html = await response.text();
      if (html.includes('id="login"')) {
        throw new Error('sessao redirecionada para login');
      }

      return parseRows(html);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_TENTATIVAS_HTTP) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(`[RS] Falha na pagina ${pageNum}: ${lastError?.message || 'erro desconhecido'}`);
}

async function run() {
  const context = await createLoggedContext();

  try {
    const allRows = [];
    let pageCursor = 1;
    let hasMore = true;

    while (hasMore) {
      console.log(`[RS] Baixando paginas ${pageCursor} a ${pageCursor + CONCORRENCIA_HTTP - 1}...`);
      const pages = Array.from({ length: CONCORRENCIA_HTTP }, (_, i) => pageCursor + i);
      const results = await Promise.all(pages.map(pageNum => fetchPage(context, pageNum)));
      const batchRows = results.flat();

      allRows.push(...batchRows);
      console.log(`[RS] Lote processado. Linhas no lote: ${batchRows.length}`);

      if (batchRows.length < CONCORRENCIA_HTTP * 5) {
        hasMore = false;
      } else {
        pageCursor += CONCORRENCIA_HTTP;
      }
    }

    assertNonEmptyRows(allRows, 'Extracao RS');
    writeCsv(OUTPUT_FILE, allRows, ['data_abertura', 'protocolo', 'tipo_servico', 'conta_contrato', 'email', 'link_ou_status']);
    console.log(`[RS] Total: ${allRows.length} capturados. Salvo em: ${OUTPUT_FILE}`);
  } finally {
    await context.dispose().catch(() => {});
  }
}

run().catch(error => {
  console.error(`[RS] Erro fatal: ${error.message}`);
  process.exit(1);
});
