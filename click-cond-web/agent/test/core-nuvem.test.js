'use strict';

/**
 * agent/src/core/nuvem.js — cloudRequest() sobre um servidor local,
 * configurar() (sem variável global solta) e o skew de relógio contra o
 * header Date da resposta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Cada teste recarrega o módulo do zero: `apiUrl`/skew são estado de módulo
// e não devem vazar de um teste para o outro.
function carregarNuvemLimpo() {
  delete require.cache[require.resolve('../src/core/nuvem')];
  // eslint-disable-next-line global-require
  return require('../src/core/nuvem');
}

function comServidor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('configurar()+cloudRequest(): monta a URL a partir de apiUrl e envia method/json corretos', async () => {
  const nuvem = carregarNuvemLimpo();
  let recebido;
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebido = { method: req.method, path: req.url, body: raw ? JSON.parse(raw) : undefined };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    nuvem.configurar({ apiUrl: url });
    const res = await nuvem.cloudRequest('POST', '/api/facial/agent/condo/tok/event', { a: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true });
    assert.equal(recebido.method, 'POST');
    assert.equal(recebido.path, '/api/facial/agent/condo/tok/event');
    assert.deepEqual(recebido.body, { a: 1 });
  } finally {
    await fechar();
  }
});

test('configurar(): remove barra(s) finais da apiUrl antes de montar a URL', async () => {
  const nuvem = carregarNuvemLimpo();
  let recebidoPath;
  const { url, fechar } = await comServidor((req, res) => {
    recebidoPath = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    nuvem.configurar({ apiUrl: `${url}///` });
    await nuvem.cloudRequest('GET', '/status');
    assert.equal(recebidoPath, '/status');
  } finally {
    await fechar();
  }
});

test('registrarSkewDaNuvem()+agoraDaNuvem(): corrige a hora local pela hora do header Date', () => {
  const nuvem = carregarNuvemLimpo();
  // Servidor "adiantado" 10s em relação a esta máquina.
  const dateHeaderFuturo = new Date(Date.now() + 10000).toUTCString();
  nuvem.registrarSkewDaNuvem({ headers: { date: dateHeaderFuturo } }, Date.now());
  const delta = nuvem.agoraDaNuvem().getTime() - Date.now();
  assert.ok(delta > 8000 && delta < 12000, `delta fora do esperado: ${delta}ms`);
});

test('registrarSkewDaNuvem(): sem header Date, não altera o skew', () => {
  const nuvem = carregarNuvemLimpo();
  nuvem.registrarSkewDaNuvem({ headers: {} }, Date.now());
  const delta = Math.abs(nuvem.agoraDaNuvem().getTime() - Date.now());
  assert.ok(delta < 50, `delta fora do esperado: ${delta}ms`);
});

test('registrarSkewDaNuvem(): header Date inválido é ignorado', () => {
  const nuvem = carregarNuvemLimpo();
  nuvem.registrarSkewDaNuvem({ headers: { date: 'isso não é uma data' } }, Date.now());
  const delta = Math.abs(nuvem.agoraDaNuvem().getTime() - Date.now());
  assert.ok(delta < 50, `delta fora do esperado: ${delta}ms`);
});

test('cloudRequest(): chamada real contra servidor local atualiza o skew pelo header Date', async () => {
  const nuvem = carregarNuvemLimpo();
  const dateHeaderFuturo = new Date(Date.now() + 20000).toUTCString();
  const { url, fechar } = await comServidor((req, res) => {
    res.setHeader('Date', dateHeaderFuturo);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    nuvem.configurar({ apiUrl: url });
    await nuvem.cloudRequest('GET', '/ping');
    const delta = nuvem.agoraDaNuvem().getTime() - Date.now();
    assert.ok(delta > 18000 && delta < 22000, `delta fora do esperado: ${delta}ms`);
  } finally {
    await fechar();
  }
});
