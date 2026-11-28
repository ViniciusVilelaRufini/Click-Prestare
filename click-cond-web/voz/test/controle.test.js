import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { criarControle } from '../src/controle.js';

const TOKEN = 'token-interno-de-teste';
const chamadas = [];
let ari = true;
const servico = {
  forcarPortaria: (id) => { chamadas.push(['portaria', id]); return id === 7; },
  dtmf: async (id, d) => { chamadas.push(['dtmf', id, d]); return id === 7; },
  encerrar: (id) => { chamadas.push(['encerrar', id]); return id === 7; },
};

let servidor;
let base;
before(async () => {
  servidor = http.createServer(criarControle({ vozToken: TOKEN, servico, saudeAri: () => ari, log: { warn() {}, error() {} } }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

async function pedir(metodo, caminho, { token = TOKEN, corpo } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers['x-voz-token'] = token;
  const r = await fetch(base + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
}

test('saúde responde sem token', async () => {
  assert.deepEqual(await pedir('GET', '/controle/saude', { token: null }), { status: 200, corpo: { ok: true, ari: true } });
  ari = false;
  assert.deepEqual((await pedir('GET', '/controle/saude', { token: null })).corpo, { ok: true, ari: false });
  ari = true;
});

test('sem token ou token errado → 401 sem chamar o serviço', async () => {
  chamadas.length = 0;
  assert.equal((await pedir('POST', '/controle/chamadas/7/portaria', { token: null })).status, 401);
  assert.equal((await pedir('POST', '/controle/chamadas/7/portaria', { token: 'errado' })).status, 401);
  assert.equal((await pedir('POST', '/controle/chamadas/7/encerrar', { token: TOKEN + 'x' })).status, 401);
  assert.equal(chamadas.length, 0);
});

test('portaria e encerrar: ok 200, chamada desconhecida 404', async () => {
  chamadas.length = 0;
  assert.deepEqual(await pedir('POST', '/controle/chamadas/7/portaria'), { status: 200, corpo: { ok: true } });
  assert.deepEqual(await pedir('POST', '/controle/chamadas/8/portaria'), { status: 404, corpo: { ok: false } });
  assert.deepEqual(await pedir('POST', '/controle/chamadas/7/encerrar'), { status: 200, corpo: { ok: true } });
  assert.deepEqual(chamadas, [['portaria', 7], ['portaria', 8], ['encerrar', 7]]);
});

test('dtmf valida os dígitos', async () => {
  chamadas.length = 0;
  assert.deepEqual(await pedir('POST', '/controle/chamadas/7/dtmf', { corpo: { digitos: '#1' } }), { status: 200, corpo: { ok: true } });
  assert.equal((await pedir('POST', '/controle/chamadas/7/dtmf', { corpo: { digitos: '1a' } })).status, 400);
  assert.equal((await pedir('POST', '/controle/chamadas/7/dtmf', { corpo: { digitos: '12345678901' } })).status, 400);
  assert.equal((await pedir('POST', '/controle/chamadas/7/dtmf', { corpo: {} })).status, 400);
  assert.equal((await pedir('POST', '/controle/chamadas/8/dtmf', { corpo: { digitos: '1' } })).status, 404);
  assert.deepEqual(chamadas, [['dtmf', 7, '#1'], ['dtmf', 8, '1']]);
});

test('JSON inválido → 400; rota desconhecida → 404', async () => {
  const r = await fetch(`${base}/controle/chamadas/7/dtmf`, { method: 'POST', headers: { 'x-voz-token': TOKEN }, body: '{x' });
  assert.equal(r.status, 400);
  assert.equal((await pedir('POST', '/controle/chamadas/abc/portaria')).status, 404);
  assert.equal((await pedir('POST', '/controle/chamadas/7/abrir')).status, 404);
  assert.equal((await pedir('GET', '/controle/chamadas/7/portaria')).status, 404);
  assert.equal((await pedir('GET', '/qualquer', { token: null })).status, 404);
});
