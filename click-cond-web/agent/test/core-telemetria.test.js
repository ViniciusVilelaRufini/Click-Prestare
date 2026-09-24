'use strict';

/**
 * agent/src/core/telemetria.js — payload no formato da spec, envio (falha só
 * loga) e disparo periódico (primeiro envio imediato + a cada intervaloMs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('os');
const { AGENT_VERSION } = require('../src/versao');

// Cada teste recarrega nuvem.js do zero: `apiUrl` é estado de módulo e não
// deve vazar de um teste para o outro (mesmo cuidado de core-nuvem.test.js).
function carregarModulosLimpos() {
  delete require.cache[require.resolve('../src/core/nuvem')];
  delete require.cache[require.resolve('../src/core/telemetria')];
  // eslint-disable-next-line global-require
  const nuvem = require('../src/core/nuvem');
  // eslint-disable-next-line global-require
  const telemetria = require('../src/core/telemetria');
  return { nuvem, telemetria };
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

function supervisorFake(dispositivos) {
  return { saudeTodos: () => dispositivos };
}

test('montarPayload(): formato da spec (versão, so, iniciado_em, dispositivos, eventos_pendentes)', () => {
  const { telemetria } = carregarModulosLimpos();
  const dispositivos = [
    { id: 10, driver: 'dahua-facial', ouvinte_ativo: true, ultimo_evento_em: null, ultimo_erro: null },
  ];
  const payload = telemetria.montarPayload({
    supervisor: supervisorFake(dispositivos),
    pendentes: () => 3,
    iniciadoEm: '2026-09-23T00:00:00.000Z',
    onlineDoDispositivo: () => true,
  });
  assert.equal(payload.versao, AGENT_VERSION);
  assert.equal(payload.so, `${os.platform()} ${os.release()}`);
  assert.equal(payload.iniciado_em, '2026-09-23T00:00:00.000Z');
  assert.deepEqual(payload.dispositivos, [{ ...dispositivos[0], online: true }]);
  assert.equal(payload.eventos_pendentes, 3);
});

test('montarPayload(): `online` vem do heartbeat (getter), não do estado do ouvinte do Supervisor', () => {
  // I8 da revisão final: o ouvinte do Control iD só "conectava" depois de
  // uma falha, o de Dahua/Hikvision nunca voltava a false e device sem
  // ouvinte (LPR/catraca) ficava sempre vermelho no portal.
  const { telemetria } = carregarModulosLimpos();
  const heartbeat = new Map([[10, true], [20, false]]);
  const payload = telemetria.montarPayload({
    supervisor: supervisorFake([
      { id: 10, driver: 'controlid-facial', ouvinte_ativo: false, ultimo_evento_em: null, ultimo_erro: null },
      { id: 20, driver: 'dahua-facial', ouvinte_ativo: true, ultimo_evento_em: null, ultimo_erro: null },
      { id: 40, driver: null, ouvinte_ativo: false, ultimo_evento_em: null, ultimo_erro: null },
    ]),
    pendentes: () => 0,
    iniciadoEm: 'agora',
    onlineDoDispositivo: (id) => heartbeat.get(id),
  });
  assert.deepEqual(
    payload.dispositivos.map((d) => [d.id, d.online, d.ouvinte_ativo]),
    [
      [10, true, false],
      [20, false, true],
      [40, false, false], // sem heartbeat ainda → false (nunca undefined)
    ],
  );
});

test('enviarTelemetria(): POST no path certo, com o payload montado', async () => {
  const { nuvem, telemetria } = carregarModulosLimpos();
  let recebido;
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebido = { method: req.method, path: req.url, body: JSON.parse(raw) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    nuvem.configurar({ apiUrl: url });
    const dispositivos = [{ id: 1, driver: 'x', ouvinte_ativo: false, ultimo_evento_em: null, ultimo_erro: 'timeout' }];
    await telemetria.enviarTelemetria('token-abc', {
      supervisor: supervisorFake(dispositivos),
      pendentes: () => 0,
      iniciadoEm: 'agora',
    });
    assert.equal(recebido.method, 'POST');
    assert.equal(recebido.path, '/api/facial/agent/condo/token-abc/telemetria');
    assert.equal(recebido.body.versao, AGENT_VERSION);
    assert.deepEqual(recebido.body.dispositivos, [{ ...dispositivos[0], online: false }]);
    assert.equal(recebido.body.eventos_pendentes, 0);
  } finally {
    await fechar();
  }
});

test('enviarTelemetria(): nuvem inalcançável não lança (só loga)', async () => {
  const { nuvem, telemetria } = carregarModulosLimpos();
  // Porta sem ninguém escutando — a requisição falha na certa.
  nuvem.configurar({ apiUrl: 'http://127.0.0.1:1' });
  const logsErro = [];
  const errOriginal = console.error;
  console.error = (msg) => logsErro.push(msg);
  try {
    await assert.doesNotReject(
      telemetria.enviarTelemetria('token-x', {
        supervisor: supervisorFake([]),
        pendentes: () => 0,
        iniciadoEm: 'agora',
      }),
    );
    assert.ok(logsErro.some((m) => m.includes('falha ao enviar telemetria')), JSON.stringify(logsErro));
  } finally {
    console.error = errOriginal;
  }
});

test('iniciarTelemetria(): envia imediatamente e de novo a cada intervaloMs', async () => {
  const { nuvem, telemetria } = carregarModulosLimpos();
  const recebidos = [];
  const { url, fechar } = await comServidor((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recebidos.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    nuvem.configurar({ apiUrl: url });
    const timer = telemetria.iniciarTelemetria('token-y', {
      supervisor: supervisorFake([]),
      pendentes: () => 0,
      iniciadoEm: 'agora',
      intervaloMs: 60,
    });
    // Envio imediato: não devia precisar esperar o intervalo inteiro.
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(recebidos.length, 1, 'devia ter enviado uma vez imediatamente');
    // Depois de ~2 intervalos, pelo menos mais um envio chegou.
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(recebidos.length >= 2, `esperava >=2 envios, veio ${recebidos.length}`);
    clearInterval(timer);
  } finally {
    await fechar();
  }
});
