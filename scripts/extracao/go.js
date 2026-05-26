const path = require('path');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { BASE_DIR, launchChromium, loginBackoffice, requestText, writeCsv } = require('./shared');

const URL_BASE = 'https://backoffice-go.equatorialenergia.com.br';
const OUTPUT_FILE = path.join(BASE_DIR, 'EQTL_GO.csv');
const CONCORRENCIA_HTTP = Number(process.env.EXTRACAO_GO_CONCORRENCIA) || 100;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const tbody = $('tbody.divide-y.divide-gray-200').first();
  if (!tbody.length) return [];

  const rows = [];
  tbody.find('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    let email = '';
    const emailEl = $(tds[4]).find('[title]').first();
    email = emailEl.length ? cleanText(emailEl.attr('title')) : cleanText($(tds[4]).text());

    rows.push({
      data_abertura: cleanText($(tds[0]).text()),
      protocolo: cleanText($(tds[1]).text()),
      tipo_servico: cleanText($(tds[2]).text()),
      conta_contrato: cleanText($(tds[3]).text()),
      email,
      status: tds.length > 5 ? cleanText($(tds[5]).text()) : '',
    });
  });
  return rows;
}

async function fetchPage(context, pageNum) {
  const url = pageNum === 1 ? `${URL_BASE}/` : `${URL_BASE}/page/${pageNum}/`;
  const html = await requestText(context, url);
  return html ? parseRows(html) : [];
}

async function run() {
  const browser = await launchChromium(chromium);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginBackoffice(page, URL_BASE, 'GO');
    await page.close();

    const allRows = [];
    let pageCursor = 1;
    let hasMore = true;
    while (hasMore) {
      console.log(`[GO] Baixando paginas ${pageCursor} a ${pageCursor + CONCORRENCIA_HTTP - 1}...`);
      const pages = Array.from({ length: CONCORRENCIA_HTTP }, (_, i) => pageCursor + i);
      const results = await Promise.all(pages.map(p => fetchPage(context, p)));
      const batchRows = results.flat();
      allRows.push(...batchRows);
      console.log(`[GO] Lote processado. Linhas no lote: ${batchRows.length}`);
      if (batchRows.length < CONCORRENCIA_HTTP * 5) hasMore = false;
      else pageCursor += CONCORRENCIA_HTTP;
    }

    writeCsv(OUTPUT_FILE, allRows, ['data_abertura', 'protocolo', 'tipo_servico', 'conta_contrato', 'email', 'status']);
    console.log(`[GO] Total: ${allRows.length} capturados. Salvo em: ${OUTPUT_FILE}`);
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(`[GO] Erro fatal: ${error.message}`);
  process.exit(1);
});
