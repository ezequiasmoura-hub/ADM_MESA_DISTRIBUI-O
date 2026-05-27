const path = require('path');
const cheerio = require('cheerio');
const { request } = require('playwright');
const {
  BASE_DIR,
  requireCredentials,
  writeCsv,
} = require('./shared');

const REGIOES = (process.env.EXTRACAO_ANTIGO_REGIOES || 'csa,pi,pa,ma,al,ap')
  .split(',')
  .map(region => region.trim().toLowerCase())
  .filter(Boolean);
const OUTPUT_FILE = path.join(BASE_DIR, 'bko_all.csv');
const CONCORRENCIA_HTTP = Number(process.env.EXTRACAO_ANTIGO_CONCORRENCIA) || 20;
const CONCORRENCIA_REGIOES = Number(process.env.EXTRACAO_ANTIGO_CONCORRENCIA_REGIOES) || REGIOES.length || 1;
const HTTP_TIMEOUT_MS = Number(process.env.EXTRACAO_ANTIGO_TIMEOUT_MS) || 30000;
const MAX_TENTATIVAS_HTTP = Number(process.env.EXTRACAO_ANTIGO_MAX_TENTATIVAS) || 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

function baseUrlForRegion(region) {
  return region === 'csa'
    ? 'https://backoffice.csa-equatorial.com.br'
    : `https://backoffice-${region}.equatorialenergia.com.br`;
}

function regionName(region) {
  return region === 'csa' ? `CSA ${region.toUpperCase()}` : `EQTL ${region.toUpperCase()}`;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cellText($, cell) {
  const clone = $(cell).clone();
  clone.find('script, style').remove();
  return normalizeText(clone.text());
}

function findHeaderIndex(headers, patterns) {
  return headers.findIndex(header => {
    const normalizedHeader = header.toLowerCase();
    return patterns.some(pattern => normalizedHeader.includes(pattern));
  });
}

function parseServico(servicoRaw) {
  const text = normalizeText(servicoRaw);
  const match = text.match(/^(.*?)\s*[–—-]\s*(\d{10})\s*$/) || text.match(/^(.*?)(\d{10})\s*$/);

  if (!match) {
    return { tipoServico: text, protocoloSecundario: '' };
  }

  return {
    tipoServico: normalizeText(match[1]),
    protocoloSecundario: match[2],
  };
}

function reportTimestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function hasNextPage($, pageNum) {
  return $('a[href*="/page/"]').filter((_, link) => {
    const text = normalizeText($(link).text());
    const href = $(link).attr('href') || '';
    return /pr[oó]ximas|next|>>/i.test(text) || href.includes(`/page/${pageNum + 1}/`);
  }).length > 0;
}

function parseRowsFromHtml(html, rName, timeReport, pageNum) {
  const $ = cheerio.load(html);
  const table = $('table').first();
  const rows = [];

  if (!table.length) {
    return { rows, hasTable: false, hasNext: false };
  }

  const headers = table
    .find('tr')
    .first()
    .find('th, td')
    .map((_, cell) => normalizeText($(cell).text()))
    .get();

  const dataIdx = findHeaderIndex(headers, ['data de abertura']);
  const protocoloIdx = findHeaderIndex(headers, ['protocolo']);
  const servicoIdx = findHeaderIndex(headers, ['tipo de serviço', 'tipo de servico']);
  const matriculaIdx = findHeaderIndex(headers, ['matrícula', 'matricula']);
  const contaIdx = findHeaderIndex(headers, ['conta', 'contrato']);
  const credenciadoIdx = findHeaderIndex(headers, ['credenciado']);
  const emailIdx = findHeaderIndex(headers, ['e-mail', 'email']);
  const statusIdx = findHeaderIndex(headers, ['status']);

  table.find('tr').slice(1).each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    const servicoRaw = cellText($, tds[servicoIdx !== -1 ? servicoIdx : 2]);
    if (!servicoRaw || servicoRaw.startsWith('TESTE')) return;

    const { tipoServico, protocoloSecundario } = parseServico(servicoRaw);
    const protocoloText = cellText($, tds[protocoloIdx !== -1 ? protocoloIdx : 1]);
    const protocoloOriginal = (protocoloText.match(/\d{12,}/) || [''])[0];

    rows.push({
      'Data de Abertura': cellText($, tds[dataIdx !== -1 ? dataIdx : 0]),
      'Tipo de Serviço': tipoServico,
      'Tipo de ServiÃ§o': tipoServico,
      'Conta Contrato': contaIdx !== -1 ? cellText($, tds[contaIdx]) : '',
      'Matrícula': matriculaIdx !== -1 ? cellText($, tds[matriculaIdx]) : '',
      'MatrÃ­cula': matriculaIdx !== -1 ? cellText($, tds[matriculaIdx]) : '',
      Credenciado: credenciadoIdx !== -1 ? cellText($, tds[credenciadoIdx]) : cellText($, tds[4]),
      'E-mail': emailIdx !== -1 ? cellText($, tds[emailIdx]) : '',
      mandante: rName,
      Status: statusIdx !== -1 ? cellText($, tds[statusIdx]) : '',
      fixed_protocolo: protocoloOriginal ? `'${protocoloOriginal}` : '',
      protocolo_secundario: protocoloSecundario,
      data_relatorio: timeReport,
    });
  });

  return { rows, hasTable: true, hasNext: hasNextPage($, pageNum) };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: safeLimit }, worker));
  return results;
}

async function createLoggedContext(baseUrl, label) {
  const { username, password } = requireCredentials();
  const context = await request.newContext({
    extraHTTPHeaders: {
      'User-Agent': USER_AGENT,
    },
  });

  try {
    console.log(`[${label}] Autenticando via HTTP...`);
    await context.get(`${baseUrl}/login`, { timeout: HTTP_TIMEOUT_MS });
    const response = await context.post(`${baseUrl}/login?action=auth`, {
      form: { login: username, password },
      timeout: HTTP_TIMEOUT_MS,
      maxRedirects: 0,
    });

    if (![200, 302, 303].includes(response.status())) {
      const body = await response.text().catch(() => '');
      throw new Error(`login retornou status ${response.status()}: ${normalizeText(body).slice(0, 160)}`);
    }

    return context;
  } catch (error) {
    await context.dispose().catch(() => {});
    throw error;
  }
}

async function fetchPage(context, baseUrl, pageNum, rName, timeReport) {
  const url = pageNum === 1 ? `${baseUrl}/` : `${baseUrl}/page/${pageNum}/`;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_TENTATIVAS_HTTP; attempt++) {
    try {
      const response = await context.get(url, {
        timeout: HTTP_TIMEOUT_MS,
        maxRedirects: 5,
      });

      if (!response.ok()) {
        return { pageNum, rows: [], hasTable: false, hasNext: false };
      }

      const html = await response.text();
      if (html.includes('id="login"')) {
        throw new Error('sessao redirecionada para login');
      }

      return { pageNum, ...parseRowsFromHtml(html, rName, timeReport, pageNum) };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_TENTATIVAS_HTTP) {
        await sleep(500 * attempt);
      }
    }
  }

  console.warn(`[${rName}] Falha na pagina ${pageNum}: ${lastError?.message || 'erro desconhecido'}`);
  return { pageNum, rows: [], hasTable: false, hasNext: false };
}

async function scrapeRegion(region) {
  const baseUrl = baseUrlForRegion(region);
  const rName = regionName(region);
  const timeReport = reportTimestamp();
  const context = await createLoggedContext(baseUrl, region.toUpperCase());
  const allRows = [];
  let pageCursor = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      console.log(`[${region.toUpperCase()}] Baixando paginas ${pageCursor} a ${pageCursor + CONCORRENCIA_HTTP - 1}...`);
      const pages = Array.from({ length: CONCORRENCIA_HTTP }, (_, i) => pageCursor + i);
      const results = (await Promise.all(
        pages.map(pageNum => fetchPage(context, baseUrl, pageNum, rName, timeReport))
      )).sort((a, b) => a.pageNum - b.pageNum);

      for (const result of results) {
        if (result.rows.length > 0) {
          allRows.push(...result.rows);
        }
      }

      const lastPageWithRows = [...results].reverse().find(result => result.rows.length > 0);
      if (lastPageWithRows?.hasNext) {
        pageCursor = lastPageWithRows.pageNum + 1;
      } else {
        hasMore = false;
      }
    }
  } finally {
    await context.dispose().catch(() => {});
  }

  console.log(`[${region.toUpperCase()}] Total: ${allRows.length} registros.`);
  return allRows;
}

async function run() {
  try {
    console.log('Iniciando extracao Site Antigo...');
    const regionConcurrency = Math.max(1, Math.min(CONCORRENCIA_REGIOES, REGIOES.length || 1));
    console.log(`[SISTEMA] Baixando ${REGIOES.length} site(s) com ${regionConcurrency} em paralelo.`);

    const regionResults = await mapWithConcurrency(REGIOES, regionConcurrency, region => scrapeRegion(region));
    const allData = regionResults.flat();

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
  } catch (error) {
    console.error(`Site Antigo erro fatal: ${error.message}`);
    process.exit(1);
  }
}

run();
