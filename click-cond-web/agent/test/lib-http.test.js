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
const { request, lanRequest, okFrom, parseJson, sleep, classificarFalha } = require('../src/lib/http');

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

test('parseJson(): JSON válido que não é objeto (null, número, string) também devolve objeto vazio', () => {
  // `JSON.parse('null')` não lança: sem isto o chamador recebia null e
  // quebrava em `d.params`/`d.result`.
  for (const raw of ['null', '42', '"texto"', 'true']) {
    assert.deepEqual(parseJson({ data: raw, raw }), {}, raw);
  }
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

test('request(): sem Basic preventivo — aparelho Digest nunca vê a senha em Base64', async () => {
  const vistos = [];
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n1", qop="auth"' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    const res = await request(`${url}/cgi-bin/magicBox.cgi`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 200);
    assert.equal(vistos[0], '');
    assert.ok(vistos.every((h) => !/^Basic /i.test(h)), vistos.join(' | '));
  } finally {
    await fechar();
  }
});

test('request(): com permitirBasic, Basic só depois de um 401 com desafio Basic', async () => {
  const vistos = [];
  const esperado = `Basic ${Buffer.from('admin:segredo').toString('base64')}`;
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (req.headers.authorization !== esperado) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
      return res.end();
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const res = await request(`${url}/x`, {
      auth: { user: 'admin', pass: 'segredo' },
      permitirBasic: true,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(vistos, ['', esperado]);
  } finally {
    await fechar();
  }
});

test('request(): SEM permitirBasic, quem pede Basic no IP do aparelho NÃO recebe a senha em claro', async () => {
  const vistos = [];
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
    res.end();
  });
  try {
    const res = await request(`${url}/x`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 401);
    assert.deepEqual(vistos, [''], 'uma única requisição, sem Authorization');
  } finally {
    await fechar();
  }
});

test('lanRequest(): driver (sem permitirBasic) não entrega a senha a um desafio Basic; o fallback genérico (permitirBasic) entrega', async () => {
  const vistos = [];
  const esperado = `Basic ${Buffer.from('admin:segredo').toString('base64')}`;
  const { port, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (req.headers.authorization !== esperado) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
      return res.end();
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const device = { ip: '127.0.0.1', porta: port, fabricante: 'intelbras', api_user: 'admin', api_password: 'segredo' };
    const semOpcao = await lanRequest(device, 'GET', '/cgi-bin/magicBox.cgi', {}, 5000);
    assert.equal(semOpcao.status, 401);
    assert.deepEqual(vistos, ['']);
    const generico = { ...device, fabricante: 'generico' };
    const comOpcao = await lanRequest(generico, 'GET', '/status', { permitirBasic: true }, 5000);
    assert.equal(comOpcao.status, 200);
    assert.deepEqual(vistos, ['', '', esperado]);
  } finally {
    await fechar();
  }
});

test('lanRequest(): Control iD escrito de outro jeito ("Control iD", "controlid") continua sem auth por header (usa sessão)', async () => {
  for (const fabricante of ['control_id', 'Control iD', 'controlid', 'control-id']) {
    const vistos = [];
    const { port, fechar } = await comServidor((req, res) => {
      vistos.push(req.headers.authorization || '');
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n3", qop="auth"' });
      res.end();
    });
    try {
      const device = { ip: '127.0.0.1', porta: port, fabricante, api_user: 'admin', api_password: 'segredo' };
      const res = await lanRequest(device, 'POST', '/login.fcgi', { json: {} }, 5000);
      assert.equal(res.status, 401);
      assert.deepEqual(vistos, [''], fabricante);
    } finally {
      await fechar();
    }
  }
});

test('classificarFalha(): tabela — resultado de driver, resposta crua e erro de rede', () => {
  const erro = (message, extra = {}) => Object.assign(new Error(message), extra);
  const casos = [
    // ok → null
    [{ ok: true, statusCode: 200 }, null],
    [{ ok: true }, null],
    [{ status: 200 }, null],
    [{ status: 204 }, null],
    // credencial
    [{ ok: false, statusCode: 401 }, 'credencial'],
    [{ ok: false, statusCode: 403 }, 'credencial'],
    [{ status: 401 }, 'credencial'],
    [erro('Control iD: login não retornou session', { statusCode: 401 }), 'credencial'],
    [erro('Dahua: login negado', { statusCode: 403 }), 'credencial'],
    // sem_resposta
    [erro('timeout'), 'sem_resposta'],
    [erro('timeout no desafio'), 'sem_resposta'],
    [erro('connect ETIMEDOUT 10.0.0.9:80', { code: 'ETIMEDOUT' }), 'sem_resposta'],
    [erro('connect EHOSTUNREACH 10.0.0.9:80', { code: 'EHOSTUNREACH' }), 'sem_resposta'],
    [erro('connect ENETUNREACH 10.0.0.9:80', { code: 'ENETUNREACH' }), 'sem_resposta'],
    [erro('connect EHOSTUNREACH 10.0.0.9:80'), 'sem_resposta'],
    [Object.assign(new Error('varios'), { errors: [erro('x', { code: 'ETIMEDOUT' })] }), 'sem_resposta'],
    // recusado
    [erro('connect ECONNREFUSED 10.0.0.9:80', { code: 'ECONNREFUSED' }), 'recusado'],
    [erro('connect ECONNREFUSED 10.0.0.9:80'), 'recusado'],
    // protocolo_inesperado
    [{ ok: false, statusCode: 404 }, 'protocolo_inesperado'],
    [{ status: 404 }, 'protocolo_inesperado'],
    [{ ok: false, statusCode: 500 }, 'protocolo_inesperado'],
    [{ ok: false }, 'protocolo_inesperado'],
    [{ ok: false, statusCode: 200, error: 'resposta não interpretável' }, 'protocolo_inesperado'],
    [erro('Control iD: login não retornou session', { statusCode: 200 }), 'protocolo_inesperado'],
    [erro('socket hang up', { code: 'ECONNRESET' }), 'protocolo_inesperado'],
    [erro('qualquer outra coisa'), 'protocolo_inesperado'],
    [null, 'protocolo_inesperado'],
    [undefined, 'protocolo_inesperado'],
  ];
  for (const [entrada, esperado] of casos) {
    const rotulo = entrada instanceof Error ? `Error(${entrada.message}, ${entrada.code || entrada.statusCode || ''})` : JSON.stringify(entrada);
    assert.equal(classificarFalha(entrada), esperado, rotulo);
  }
});

test('request(): 401 sem desafio reconhecido não reenvia credencial', async () => {
  const vistos = [];
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    res.writeHead(401);
    res.end();
  });
  try {
    const res = await request(`${url}/x`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 401);
    assert.deepEqual(vistos, ['']);
  } finally {
    await fechar();
  }
});

test('lanRequest(): aparelho Hikvision/Dahua (Digest) não recebe Basic na LAN', async () => {
  const vistos = [];
  const { port, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n2", qop="auth"' });
      return res.end();
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const device = { ip: '127.0.0.1', porta: port, fabricante: 'hikvision', api_user: 'admin', api_password: 'segredo' };
    const res = await lanRequest(device, 'GET', '/ISAPI/System/deviceInfo', {}, 5000);
    assert.equal(res.status, 200);
    assert.ok(vistos.every((h) => !/^Basic /i.test(h)), vistos.join(' | '));
  } finally {
    await fechar();
  }
});
