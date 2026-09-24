'use strict';

/**
 * agent/src/lib/http.js — cliente HTTP minimalista (request/lanRequest) e
 * utilitários (okFrom, parseJson, sleep) usados contra os aparelhos da LAN
 * e a nuvem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { request, lanRequest, okFrom, parseJson, sleep } = require('../src/lib/http');

/**
 * Substitui `https.request` por um espião que nunca conecta de verdade —
 * só captura as opções com que `request()`/`lanRequest()` chamariam o
 * módulo `https` real. É o jeito de provar a decisão de TLS (Critical 1 da
 * revisão da tarefa 8: TLS estrito por padrão, permissivo só onde LAN
 * precisa) sem precisar de um servidor HTTPS de verdade com certificado.
 */
function espiarHttpsRequest() {
  const original = https.request;
  let opcoes = null;
  https.request = (opts) => {
    opcoes = opts;
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.write = () => {};
    req.end = () => {};
    req.destroy = () => {};
    return req;
  };
  return {
    opcoesCapturadas: () => opcoes,
    restaurar: () => {
      https.request = original;
    },
  };
}

/** Sobe um servidor HTTP local descartável em 127.0.0.1:porta-aleatória. */
function comServidor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('request(): GET contra servidor local devolve status e body JSON parseado', async () => {
  const { url, fechar } = await comServidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ola: 'mundo' }));
  });
  try {
    const res = await request(`${url}/qualquer`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ola: 'mundo' });
  } finally {
    await fechar();
  }
});

test('request(): POST com opts.json envia Content-Type application/json e o corpo serializado', async () => {
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Recebido-Content-Type': req.headers['content-type'] || '',
        'X-Recebido-Method': req.method,
      });
      res.end(JSON.stringify({ eco: JSON.parse(raw) }));
    });
  });
  try {
    const res = await request(`${url}/echo`, { method: 'POST', json: { a: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-recebido-method'], 'POST');
    assert.match(res.headers['x-recebido-content-type'], /application\/json/);
    assert.deepEqual(res.data, { eco: { a: 1 } });
  } finally {
    await fechar();
  }
});

test('request(): timeout rejeita quando o servidor demora mais que opts.timeout', async () => {
  const { url, fechar } = await comServidor((req, res) => {
    // nunca responde dentro da janela de timeout do teste
    setTimeout(() => {
      try {
        res.writeHead(200);
        res.end('tarde demais');
      } catch {
        /* já desistimos */
      }
    }, 2000);
  });
  try {
    await assert.rejects(
      () => request(`${url}/lento`, { timeout: 100 }),
      /timeout/i,
    );
  } finally {
    await fechar();
  }
});

test('okFrom(): 2xx é ok:true; 404 é ok:false; statusCode sempre presente', () => {
  assert.deepEqual(okFrom({ status: 200 }), { ok: true, statusCode: 200 });
  assert.deepEqual(okFrom({ status: 204 }), { ok: true, statusCode: 204 });
  assert.deepEqual(okFrom({ status: 404 }), { ok: false, statusCode: 404 });
  assert.deepEqual(okFrom({ status: 500 }), { ok: false, statusCode: 500 });
});

test('parseJson(): usa res.data quando já é objeto (resposta com Content-Type json)', () => {
  assert.deepEqual(parseJson({ data: { a: 1 }, raw: 'ignorado' }), { a: 1 });
});

test('parseJson(): sem Content-Type json, faz JSON.parse do raw (caso RPC2 da Dahua)', () => {
  assert.deepEqual(parseJson({ data: '{"b":2}', raw: '{"b":2}' }), { b: 2 });
});

test('parseJson(): raw inválido devolve objeto vazio em vez de lançar', () => {
  assert.deepEqual(parseJson({ data: 'não é json', raw: 'não é json' }), {});
  assert.deepEqual(parseJson(undefined), {});
});

test('sleep(): resolve depois de ao menos o tempo pedido', async () => {
  const antes = Date.now();
  await sleep(30);
  assert.ok(Date.now() - antes >= 25);
});

test('request(): TLS estrito por padrão (rejectUnauthorized true) quando o chamador não diz nada (Critical 1)', async () => {
  const espiao = espiarHttpsRequest();
  try {
    // Não aguardamos a Promise terminar (o req fake nunca emite resposta) —
    // só precisamos que request() já tenha chamado https.request().
    request('https://exemplo.invalido.test/x', {}).catch(() => {});
    await new Promise((r) => setImmediate(r));
    assert.equal(espiao.opcoesCapturadas().rejectUnauthorized, true);
  } finally {
    espiao.restaurar();
  }
});

test('request(): rejectUnauthorized: false explícito continua permissivo (uso de LAN direto em request())', async () => {
  const espiao = espiarHttpsRequest();
  try {
    request('https://exemplo.invalido.test/x', { rejectUnauthorized: false }).catch(() => {});
    await new Promise((r) => setImmediate(r));
    assert.equal(espiao.opcoesCapturadas().rejectUnauthorized, false);
  } finally {
    espiao.restaurar();
  }
});

test('lanRequest(): continua permissivo por padrão (rejectUnauthorized false) — aparelho de LAN com certificado self-signed (Critical 1)', async () => {
  const espiao = espiarHttpsRequest();
  try {
    const device = { ip: '127.0.0.1', porta: 443, fabricante: 'hikvision' };
    lanRequest(device, 'GET', '/status').catch(() => {});
    await new Promise((r) => setImmediate(r));
    assert.equal(espiao.opcoesCapturadas().rejectUnauthorized, false);
  } finally {
    espiao.restaurar();
  }
});

test('lanRequest(): monta a URL http://ip:porta e usa o defaultTimeoutMs recebido', async () => {
  const { port, fechar } = await comServidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url }));
  });
  try {
    const device = { ip: '127.0.0.1', porta: port, fabricante: 'hikvision' };
    const res = await lanRequest(device, 'GET', '/status', {}, 5000);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { path: '/status' });
  } finally {
    await fechar();
  }
});
