const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPayload, parseNativePriority } = require('./mesa-upload');

test('converte a Prioridade do CSV para inteiro nativo', () => {
  assert.equal(parseNativePriority('346020'), 346020);
  assert.equal(parseNativePriority('175,9'), 175);
  assert.equal(parseNativePriority('invalida'), 0);
});

test('envia a prioridade calculada no payload Genesys', () => {
  const result = buildPayload({
    Nota: '20260611000000001',
    Fluxo: 'flow-exemplo',
    Prioridade: '346020',
  }, {
    provider: 'genesys.exemplo',
    toAddress: 'nota@exemplo.invalid',
  });

  assert.equal(result.priority, 346020);
  assert.equal(result.payload.priority, 346020);
  assert.equal(result.payload.attributes.Prioridade, '346020');
});
