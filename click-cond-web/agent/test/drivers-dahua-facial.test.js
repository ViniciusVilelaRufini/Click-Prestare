'use strict';

/**
 * agent/src/drivers/dahua-facial.js — contra um APARELHO FALSO (servidor HTTP
 * local em 127.0.0.1, nunca um terminal de verdade): listagem/remoção via
 * RPC2 quando a resposta vem SEM Content-Type (string), recusa de cadastro
 * sem identificador, e o laço de `escutar` (reabertura e log de queda).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dahua = require('../src/drivers/dahua-facial');

function comServidor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    const sockets = new Set();
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        fechar: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(r);
          }),
      });
    });
  });
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });
}

/** Aparelho falso que responde o RPC2 como o firmware real: JSON SEM Content-Type. */
async function aparelhoRpc2(responder) {
  const chamadas = [];
  const srv = await comServidor(async (req, res) => {
    const raw = await lerCorpo(req);
    let corpo = null;
    try {
      corpo = JSON.parse(raw);
    } catch {
      /* não-JSON */
    }
    chamadas.push({ url: req.url, method: req.method, corpo });
    const r = responder(corpo, req) || {};
    res.statusCode = r.status || 200;
    res.end(r.texto ?? ''); // sem setHeader: nenhum Content-Type
  });
  return {
    ...srv,
    chamadas,
    device: { id: 9001, nome: 'Falso Dahua', fabricante: 'intelbras', ip: '127.0.0.1', porta: srv.port },
  };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- list_users ----------

test('list_users: RPC2 responde JSON SEM Content-Type (string) — a lista vem preenchida, não vazia', async () => {
  const ap = await aparelhoRpc2((corpo) => {
    if (corpo.method === 'UserInfo.getCount') return { texto: '{"result":true,"params":{"Count":3},"id":1}' };
    if (corpo.method === 'UserInfo.getMulti') {
      return {
        texto: JSON.stringify({
          result: true,
          params: { UserList: [{ UserID: 'morador_1' }, { UserID: 'FFFFFF' }, { UserID: 'visitante_7' }] },
        }),
      };
    }
    return { status: 404 };
  });
  try {
    const r = await dahua.executar(ap.device, { type: 'list_users' });
    assert.deepEqual(r, { ok: true, userIds: ['morador_1', 'visitante_7'] });
  } finally {
    await ap.fechar();
  }
});

test('list_users: contagem não interpretável (HTML de login com HTTP 200) → ok:false, NUNCA lista vazia com ok:true', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: '<html><body>login</body></html>' }));
  try {
    const r = await dahua.executar(ap.device, { type: 'list_users' });
    assert.equal(r.ok, false);
    assert.equal(r.userIds, undefined);
    assert.match(r.error, /não interpretável/);
    assert.equal(ap.chamadas.length, 1, 'não segue para getMulti sem saber a contagem');
  } finally {
    await ap.fechar();
  }
});

test('list_users: corpo vazio ou JSON sem params.Count → ok:false', async () => {
  for (const texto of ['', '{}', '{"result":true}', '{"result":true,"params":{"Count":"muitos"}}', '[]', 'null']) {
    const ap = await aparelhoRpc2(() => ({ texto }));
    try {
      const r = await dahua.executar(ap.device, { type: 'list_users' });
      assert.equal(r.ok, false, `texto=${texto}`);
      assert.equal(r.userIds, undefined, `texto=${texto}`);
    } finally {
      await ap.fechar();
    }
  }
});

test('list_users: página não interpretável no meio → ok:false (lista parcial viraria remoção indevida de "fantasmas")', async () => {
  const ap = await aparelhoRpc2((corpo) => {
    if (corpo.method === 'UserInfo.getCount') return { texto: '{"result":true,"params":{"Count":2}}' };
    return { texto: 'Error: Bad Request' };
  });
  try {
    const r = await dahua.executar(ap.device, { type: 'list_users' });
    assert.equal(r.ok, false);
    assert.equal(r.userIds, undefined);
    assert.match(r.error, /não interpretável/);
  } finally {
    await ap.fechar();
  }
});

test('list_users: result:false do aparelho (em string) → ok:false', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: '{"result":false,"error":{"code":268632079,"message":"Invalid session"}}' }));
  try {
    const r = await dahua.executar(ap.device, { type: 'list_users' });
    assert.equal(r.ok, false);
  } finally {
    await ap.fechar();
  }
});

test('list_users: contagem ZERO legítima (interpretável) continua ok:true com lista vazia', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: '{"result":true,"params":{"Count":0}}' }));
  try {
    const r = await dahua.executar(ap.device, { type: 'list_users' });
    assert.deepEqual(r, { ok: true, userIds: [] });
  } finally {
    await ap.fechar();
  }
});

// ---------- remove_users ----------

test('remove_users: result:false em string (sem Content-Type) → ok:false, não ok:true cego', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: '{"result":false,"error":{"message":"busy"}}' }));
  try {
    const r = await dahua.executar(ap.device, { type: 'remove_users', faceIds: ['morador_1'] });
    assert.equal(r.ok, false);
  } finally {
    await ap.fechar();
  }
});

test('remove_users: resposta não interpretável → ok:false; result:true em string → ok:true', async () => {
  const ruim = await aparelhoRpc2(() => ({ texto: '<html>login</html>' }));
  try {
    const r = await dahua.executar(ruim.device, { type: 'remove_users', faceIds: ['morador_1'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /não interpretável/);
  } finally {
    await ruim.fechar();
  }
  const bom = await aparelhoRpc2(() => ({ texto: '{"result":true}' }));
  try {
    const r = await dahua.executar(bom.device, { type: 'remove_users', faceIds: ['morador_1'] });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(bom.chamadas[0].corpo.params.UserList, [{ UserID: 'morador_1' }]);
  } finally {
    await bom.fechar();
  }
});

// ---------- enroll sem identificador ----------

test('enroll: sem externalId e sem faceId é recusado SEM falar com o aparelho (não cria o usuário "undefined")', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: 'OK' }));
  try {
    for (const cmd of [
      { type: 'enroll', nome: 'Fulano' },
      { type: 'enroll', nome: 'Fulano', externalId: '', faceId: null },
      { type: 'update', nome: 'Fulano', externalId: '   ' },
    ]) {
      const r = await dahua.executar(ap.device, cmd);
      assert.equal(r.ok, false);
      assert.match(r.error, /externalId|faceId/);
    }
    assert.equal(ap.chamadas.length, 0);
  } finally {
    await ap.fechar();
  }
});

test('enroll: com externalId segue o fluxo normal (remove, insere usuário) usando o id informado', async () => {
  const ap = await aparelhoRpc2(() => ({ texto: 'OK' }));
  try {
    const r = await dahua.executar(ap.device, { type: 'enroll', nome: 'Fulano', externalId: 'morador_42' });
    assert.deepEqual(r, { ok: true, faceId: 'morador_42' });
    const insert = ap.chamadas.find((c) => /AccessUser\.cgi\?action=insertMulti/.test(c.url));
    assert.equal(insert.corpo.UserList[0].UserID, 'morador_42');
  } finally {
    await ap.fechar();
  }
});

// ---------- escutar: pausa antes de reabrir ----------

test('pausaAntesDeReabrir(): erro → 5 s; fim limpo → só o que FALTA para 5 s desde a abertura (no máximo uma abertura a cada 5 s)', () => {
  const p = dahua.pausaAntesDeReabrir;
  assert.equal(p({ erro: true, recebeuDados: false, duracaoMs: 0 }), 5000);
  assert.equal(p({ erro: true, recebeuDados: true, duracaoMs: 600000 }), 5000);
  // Stream que durou mais que a pausa (o fechamento periódico normal): reabre na hora.
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 600000 }), 0);
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 5000 }), 0);
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 5001 }), 0);
  // Firmware que aceita o attach e fecha limpo logo depois: antes a pausa era
  // 0 e o agente reabria uma vez por segundo, para sempre. Agora espera o resto.
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 1000 }), 4000);
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 1500 }), 3500);
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 4999 }), 1);
  // Fim "limpo" sem nunca ter recebido nada, ou que durou quase nada, não é
  // a reabertura periódica normal: mantém a pausa (senão vira laço apertado
  // martelando o aparelho).
  assert.equal(p({ erro: false, recebeuDados: false, duracaoMs: 600000 }), 5000);
  assert.equal(p({ erro: false, recebeuDados: true, duracaoMs: 999 }), 5000);
});

/** Aparelho falso do stream de eventos: Digest + multipart. `modo.atual`
 *  decide o que cada conexão de stream faz. */
async function aparelhoStream(modo) {
  const streams = { abertos: 0 };
  const srv = await comServidor((req, res) => {
    if (!req.url.startsWith('/cgi-bin/eventManager.cgi')) {
      res.statusCode = 200;
      return res.end('OK'); // configManager (LED) etc.
    }
    if (modo.atual === 'erro') {
      res.statusCode = 500;
      return res.end();
    }
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' });
      return res.end();
    }
    streams.abertos++;
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' });
    res.write('--myboundary\r\nContent-Type: text/plain\r\n\r\nHeartbeat\r\n');
    if (modo.atual === 'fecha-limpo') setTimeout(() => res.end(), 15);
    // 'aberto': mantém a conexão (fechada no fim do teste).
  });
  return {
    ...srv,
    streams,
    device: {
      id: 9100 + Math.floor(Math.random() * 800),
      nome: 'Falso Stream',
      fabricante: 'intelbras',
      ip: '127.0.0.1',
      porta: srv.port,
      api_user: 'admin',
      api_password: 'x',
    },
  };
}

function capturarConsole() {
  const original = { log: console.log, error: console.error };
  const linhas = { log: [], error: [] };
  console.log = (...a) => linhas.log.push(a.join(' '));
  console.error = (...a) => linhas.error.push(a.join(' '));
  return { linhas, restaurar: () => Object.assign(console, original) };
}

test('escutar(): stream que termina LIMPO depois de durar mais que a pausa reabre imediatamente e avisa aoConectar a cada reabertura', async () => {
  const modo = { atual: 'fecha-limpo' };
  const ap = await aparelhoStream(modo);
  const cap = capturarConsole();
  // O stream falso dura ~15 ms: com a pausa em 10 ms ele "durou mais que a
  // pausa" (em produção: durou mais de 5 s) e reabre na hora.
  dahua.configurar({ duracaoMinimaStreamMs: 0, pausaAposErroMs: 10 });
  let conexoes = 0;
  const parar = dahua.escutar(ap.device, () => {}, { aoConectar: () => conexoes++ });
  try {
    await espera(400);
    assert.ok(ap.streams.abertos >= 3, `esperava várias reaberturas em 400 ms, teve ${ap.streams.abertos}`);
    assert.ok(conexoes >= 3, `aoConectar a cada reabertura, teve ${conexoes}`);
    assert.deepEqual(cap.linhas.error.filter((l) => /stream de eventos caiu/.test(l)), []);
  } finally {
    parar();
    cap.restaurar();
    dahua.configurar({ duracaoMinimaStreamMs: 1000, pausaAposErroMs: 5000 });
    await ap.fechar();
  }
});

test('escutar() (I5): firmware que aceita o attach e fecha limpo LOGO DEPOIS não vira laço de reconexão — uma abertura por pausa', async () => {
  const modo = { atual: 'fecha-limpo' }; // fecha ~15 ms depois de abrir
  const ap = await aparelhoStream(modo);
  const cap = capturarConsole();
  dahua.configurar({ duracaoMinimaStreamMs: 0, pausaAposErroMs: 200 });
  const parar = dahua.escutar(ap.device, () => {}, {});
  try {
    await espera(500);
    // Sem limite seriam ~20 aberturas em 500 ms; com uma a cada 200 ms, no máximo 3.
    assert.ok(ap.streams.abertos >= 2, `tem de continuar reabrindo, teve ${ap.streams.abertos}`);
    assert.ok(ap.streams.abertos <= 3, `esperava no máximo 3 aberturas em 500 ms, teve ${ap.streams.abertos}`);
    assert.deepEqual(cap.linhas.error.filter((l) => /stream de eventos caiu/.test(l)), [], 'fim limpo não é queda');
  } finally {
    parar();
    cap.restaurar();
    dahua.configurar({ duracaoMinimaStreamMs: 1000, pausaAposErroMs: 5000 });
    await ap.fechar();
  }
});

test('escutar(): aparelho fora do ar — loga a queda UMA vez (não a cada tentativa) e a recuperação UMA vez', async () => {
  const modo = { atual: 'erro' };
  const ap = await aparelhoStream(modo);
  const cap = capturarConsole();
  dahua.configurar({ pausaAposErroMs: 20 });
  let conexoes = 0;
  const parar = dahua.escutar(ap.device, () => {}, { aoConectar: () => conexoes++ });
  const quedas = () => cap.linhas.error.filter((l) => /stream de eventos caiu/.test(l));
  const voltas = () => cap.linhas.log.filter((l) => /stream de eventos restabelecido/.test(l));
  try {
    await espera(250); // ~10 tentativas falhando
    assert.equal(quedas().length, 1, quedas().join('\n'));
    assert.match(quedas()[0], /Falso Stream/);
    assert.equal(voltas().length, 0);

    modo.atual = 'aberto';
    await espera(150);
    assert.equal(conexoes, 1);
    assert.equal(voltas().length, 1);
    assert.equal(quedas().length, 1);
  } finally {
    parar();
    cap.restaurar();
    dahua.configurar({ pausaAposErroMs: 5000 });
    await ap.fechar();
  }
});

test('escutar(): parar() FECHA a conexão do stream aberto e não reabre (trocar a senha no portal não deixa dois streams no aparelho)', async () => {
  let streamsAbertos = 0;
  let streamsFechados = 0;
  const srv = await comServidor((req, res) => {
    if (!req.url.startsWith('/cgi-bin/eventManager.cgi')) return res.end('OK');
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n", qop="auth"' });
      return res.end();
    }
    streamsAbertos++;
    res.on('close', () => streamsFechados++);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary' });
    res.write('--myboundary\r\n');
  });
  const device = { id: 9990, nome: 'Falso Stream', fabricante: 'intelbras', ip: '127.0.0.1', porta: srv.port, api_user: 'admin', api_password: 'x' };
  const cap = capturarConsole();
  let conexoes = 0;
  const parar = dahua.escutar(device, () => {}, { aoConectar: () => conexoes++ });
  try {
    await espera(150);
    assert.equal(streamsAbertos, 1);
    assert.equal(conexoes, 1);
    assert.equal(streamsFechados, 0);
    parar();
    await espera(150);
    assert.equal(streamsFechados, 1, 'o stream antigo foi encerrado pelo agente');
    assert.equal(streamsAbertos, 1, 'e não reabriu depois de parado');
    assert.deepEqual(cap.linhas.error.filter((l) => /stream de eventos caiu/.test(l)), [], 'parar não é queda');
  } finally {
    parar();
    cap.restaurar();
    await srv.fechar();
  }
});
