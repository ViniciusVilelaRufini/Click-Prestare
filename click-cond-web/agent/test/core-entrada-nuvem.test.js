'use strict';

/**
 * agent/src/core/entrada-nuvem.js — saneamento do que vem da nuvem no poll:
 * intervalo de polling (nunca laço apertado) e lista de devices (nunca
 * entrada sem device/id).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { intervaloDePoll, entradasValidas, POLL_MIN_MS } = require('../src/core/entrada-nuvem');

test('intervaloDePoll(): tabela (padrão quando inválido, mínimo de 1000 ms)', () => {
  const casos = [
    [2000, 2000],
    ['3000', 3000],
    [undefined, 2000],
    [null, 2000],
    ['', 2000],
    [0, 2000],
    ['abc', 2000],
    [NaN, 2000],
    [-5, 2000],
    [{}, 2000],
    [Infinity, 2000],
    [1, 1000],
    [300, 1000],
    [999.9, 1000],
    [1000, 1000],
  ];
  for (const [valor, esperado] of casos) {
    assert.equal(intervaloDePoll(valor, 2000), esperado, `valor=${String(valor)}`);
  }
  assert.equal(POLL_MIN_MS, 1000);
});

test('intervaloDePoll(): mínimo ajustável por quem monta o agente; mínimo inválido cai no de 1000 ms', () => {
  assert.equal(intervaloDePoll(300, 2000, 300), 300);
  assert.equal(intervaloDePoll(100, 2000, 300), 300);
  assert.equal(intervaloDePoll(300, 2000, 'lixo'), 1000);
  assert.equal(intervaloDePoll(300, 2000, 0), 1000);
});

test('entradasValidas(): descarta entrada nula, sem device ou com device sem id', () => {
  const boa = { device: { id: 1, nome: 'A' }, commands: [] };
  const idZero = { device: { id: 0, nome: 'zero' } };
  assert.deepEqual(
    entradasValidas({
      devices: [null, {}, { device: null }, { device: { nome: 'sem id' } }, boa, 'lixo', idZero],
    }),
    [boa, idZero],
  );
  assert.deepEqual(entradasValidas({}), []);
  assert.deepEqual(entradasValidas(null), []);
  assert.deepEqual(entradasValidas({ devices: 'lixo' }), []);
});

// ---------- I4: resposta ruim do poll não pode virar "lista vazia" ----------

const { avaliarRespostaDoPoll } = require('../src/core/entrada-nuvem');

test('avaliarRespostaDoPoll(): 2xx com { devices: [...] } é aproveitável e devolve o corpo', () => {
  const corpo = { devices: [{ device: { id: 1 }, commands: [] }], poll_interval_ms: 2000 };
  assert.deepEqual(avaliarRespostaDoPoll({ status: 200, data: corpo }), { ok: true, body: corpo });
  // Condomínio sem nenhum aparelho ativo: lista vazia LEGÍTIMA (derruba os ouvintes de propósito).
  assert.deepEqual(avaliarRespostaDoPoll({ status: 200, data: { devices: [] } }), { ok: true, body: { devices: [] } });
  assert.equal(avaliarRespostaDoPoll({ status: 201, data: { devices: [] } }).ok, true);
});

test('avaliarRespostaDoPoll(): status fora de 2xx (5xx, 429, 3xx...) NÃO é aproveitável, mesmo com corpo JSON', () => {
  for (const status of [500, 502, 503, 504, 429, 408, 400, 403, 301, 302, 199, 0, undefined, null, '200']) {
    const r = avaliarRespostaDoPoll({ status, data: { devices: [] }, raw: '{"devices":[]}' });
    assert.equal(r.ok, false, `status ${String(status)}`);
    assert.equal(r.body, undefined);
    assert.match(r.motivo, /HTTP/);
  }
  assert.match(avaliarRespostaDoPoll({ status: 503, data: null, raw: '<html>503 Service Unavailable</html>' }).motivo, /HTTP 503.*503 Service Unavailable/);
});

test('avaliarRespostaDoPoll(): 2xx com corpo que não é o JSON esperado (HTML do balanceador, vazio, lista solta) NÃO é aproveitável', () => {
  const ruins = [
    { status: 200, data: null, raw: '<html>manutenção</html>' },
    { status: 200, data: undefined, raw: '' },
    { status: 200, data: '<html></html>' },
    { status: 200, data: 42 },
    { status: 200, data: [] },
    { status: 200, data: {} },
    { status: 200, data: { devices: null } },
    { status: 200, data: { devices: 'lixo' } },
    { status: 200, data: { devices: {} } },
    { status: 204, data: null, raw: '' },
  ];
  for (const res of ruins) {
    const r = avaliarRespostaDoPoll(res);
    assert.equal(r.ok, false, JSON.stringify(res));
    assert.match(r.motivo, /corpo inesperado/);
  }
  assert.equal(avaliarRespostaDoPoll(null).ok, false);
  assert.equal(avaliarRespostaDoPoll(undefined).ok, false);
});

test('avaliarRespostaDoPoll(): o motivo corta o corpo (não despeja uma página HTML inteira no log)', () => {
  const r = avaliarRespostaDoPoll({ status: 502, data: null, raw: 'x'.repeat(5000) });
  assert.ok(r.motivo.length < 300, `motivo com ${r.motivo.length} caracteres`);
});
