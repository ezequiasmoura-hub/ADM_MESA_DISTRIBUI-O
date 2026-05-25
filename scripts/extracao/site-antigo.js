const path = require('path');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const {
  BASE_DIR,
  launchChromium,
  loginBackoffice,
  requestText,
  toReportDateTime,
  writeCsv,
} = require('./shared');

const REGIOES = ['csa', 'pi', 'pa', 'ma', 'al', 'ap'];
const OUTPUT_FILE = path.join(BASE_DIR, 'bko_all.csv');
const CONCORRENCIA_HTTP = Number(process.env.EXTRACAO_ANTIGO_CONCORRENCIA) || 50;

function baseUrlForRegion(region) {
  return region === 'csa'
    ? 'https://backoffice.csa-equatorial.com.br'
    : `https://backoffice-${region}.equatorialenergia.com.br`;
}

function regionName(region) {
  return region === 'csa' ? `CSA ${region.toUpperCase()}` : `EQTL ${region.toUpperCase()}`;
}

function parseRowsFromHtml(html, rName, timeReport) {
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (!table.length) return [];

  const headers = table.find('tr').first().find('th, td').map((_, cell) => $(cell).text().trim()).get();
  const emailIdx = headers.findIndex(h => h.toLowerCase().includes('e-mail'));
  const statusIdx = headers.findIndex(h => h.toLowerCase().includes('status'));
  const rows = [];

  table.find('tr').slice(1).each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    const servicoRaw = $(tds[2]).text().trim();
    if (!servicoRaw || servicoRaw.startsWith('TESTE')) return;

    const cleanServico = servicoRaw.replace(/[–:]/g, '').replace(/\s\s+/g, ' ');
    const protocoloSecundario = cleanServico.slice(-10);
    const tipoServico = cleanServico.slice(0, -10).trim();
    const protocoloOriginal = $(tds[1]).text().trim().split(' ')[0];
    const identifier = $(tds[3]).text().trim();

    let matricula = '';
    let contaContrato = '';
    const headerCol3 = headers[3] || '';
    if (headerCol3.includes('Conta') || headerCol3.includes('Contrato')) contaContrato = identifier;
    else matricula = identifier;

    rows.push({
      'Data de Abertura': $(tds[0]).text().trim(),
      'Tipo de Serviço': tipoServico,
      'Conta Contrato': contaContrato,
      Credenciado: $(tds[4]).text().trim() || '',
      'E-mail': emailIdx >= 0 ? $(tds[emailIdx]).text().trim() : '',
      mandante: rName,
      Status: statusIdx >= 0 ? $(tds[statusIdx]).text().trim() : '',
      fixed_protocolo: `'${protocoloOriginal}`,
      protocolo_secundario: protocoloSecundario,
      data_relatorio: timeReport,
      Matrícula: matricula,
    });
  });

  return rows;
}

async function fetchPage(context, baseUrl, pageNum, rName, timeReport) {
  const url = pageNum === 1 ? `${baseUrl}/` : `${baseUrl}/page/${pageNum}/`;
  const html = await requestText(context, url);
  return html ? parseRowsFromHtml(html, rName, timeReport) : [];
}

async function scrapeRegionWithRequests(context, region) {
  const baseUrl = baseUrlForRegion(region);
  const rName = regionName(region);
  const page = await context.newPage();
  const timeReport = toReportDateTime();

  try {
    await loginBackoffice(page, baseUrl, region.toUpperCase());
  } finally {
    await page.close().catch(() => {});
  }

  const allRows = [];
  let pageCursor = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`[${region.toUpperCase()}] Baixando paginas ${pageCursor} a ${pageCursor + CONCORRENCIA_HTTP - 1}...`);
    const pages = Array.from({ length: CONCORRENCIA_HTTP }, (_, i) => pageCursor + i);
    const results = await Promise.all(pages.map(pageNum => fetchPage(context, baseUrl, pageNum, rName, timeReport)));
    const batchRows = results.flat();
    allRows.push(...batchRows);
    if (batchRows.length < CONCORRENCIA_HTTP * 2) hasMore = false;
    else pageCursor += CONCORRENCIA_HTTP;
  }

  console.log(`[${region.toUpperCase()}] Total: ${allRows.length} registros.`);
  return allRows;
}

async function run() {
  const browser = await launchChromium(chromium);
  const context = await browser.newContext();

  try {
    console.log('Iniciando extracao Site Antigo...');
    const allData = [];
    for (const region of REGIOES) {
      const rows = await scrapeRegionWithRequests(context, region);
      allData.push(...rows);
    }

    const columns = [
      'Data de Abertura',
      'Tipo de Serviço',
      'Conta Contrato',
      'Credenciado',
      'E-mail',
      'mandante',
      'Status',
      'fixed_protocolo',
      'protocolo_secundario',
      'data_relatorio',
    ];
    writeCsv(OUTPUT_FILE, allData, columns);
    console.log(`Site Antigo salvo: ${OUTPUT_FILE} (${allData.length} registros)`);
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(`Site Antigo erro fatal: ${error.message}`);
  process.exit(1);
});
