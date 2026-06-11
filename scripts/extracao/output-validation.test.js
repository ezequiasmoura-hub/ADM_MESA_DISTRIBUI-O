const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { validateCsvOutput } = require('./output-validation');

test('aceita CSV novo com cabecalho e registros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-output-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'EQTL_GO.csv'),
      '\uFEFFdata_abertura;protocolo;tipo_servico\n10/06/2026;123;Ligacao Nova\n',
      'utf8'
    );
    const result = validateCsvOutput('go', dir, { notBeforeMs: Date.now() - 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.rows, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejeita CSV sem registros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-output-'));
  try {
    fs.writeFileSync(path.join(dir, 'EQTL_RS.csv'), 'data_abertura;protocolo;tipo_servico\n', 'utf8');
    const result = validateCsvOutput('rs', dir);
    assert.equal(result.ok, false);
    assert.match(result.message, /sem registros/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
