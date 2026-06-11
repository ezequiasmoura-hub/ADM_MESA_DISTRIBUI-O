const fs = require('fs');
const path = require('path');

const CSV_OUTPUTS = {
  siteAntigo: {
    fileName: 'bko_all.csv',
    requiredHeaders: ['Data de Abertura', 'Tipo de Servico', 'fixed_protocolo'],
  },
  go: {
    fileName: 'EQTL_GO.csv',
    requiredHeaders: ['data_abertura', 'protocolo', 'tipo_servico'],
  },
  rs: {
    fileName: 'EQTL_RS.csv',
    requiredHeaders: ['data_abertura', 'protocolo', 'tipo_servico'],
  },
};

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function validateCsvOutput(id, outputDir, { notBeforeMs = 0 } = {}) {
  const spec = CSV_OUTPUTS[id];
  if (!spec) return { ok: true, rows: 0, filePath: '' };

  const filePath = path.join(outputDir, spec.fileName);
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, rows: 0, filePath, message: `Arquivo nao foi gerado: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (notBeforeMs && stat.mtimeMs + 1500 < notBeforeMs) {
      return { ok: false, rows: 0, filePath, message: `Arquivo nao foi atualizado nesta tentativa: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    if (lines.length <= 1) {
      return { ok: false, rows: 0, filePath, message: `Base gerada sem registros: ${filePath}` };
    }

    const headers = lines[0].split(';').map(normalizeHeader);
    const missing = spec.requiredHeaders
      .map(normalizeHeader)
      .filter(header => !headers.includes(header));
    if (missing.length) {
      return {
        ok: false,
        rows: 0,
        filePath,
        message: `Cabecalho invalido em ${filePath}. Ausentes: ${missing.join(', ')}`,
      };
    }

    return { ok: true, rows: lines.length - 1, filePath };
  } catch (error) {
    return { ok: false, rows: 0, filePath, message: `Falha ao validar ${filePath}: ${error.message}` };
  }
}

function assertNonEmptyRows(rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label} retornou zero registros; o arquivo anterior foi preservado.`);
  }
}

module.exports = {
  CSV_OUTPUTS,
  assertNonEmptyRows,
  validateCsvOutput,
};
