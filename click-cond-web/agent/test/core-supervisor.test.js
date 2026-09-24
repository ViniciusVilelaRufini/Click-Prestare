'use strict';

/**
 * agent/src/core/supervisor.js — ciclo de vida do ouvinte por device, com
 * driver FALSO (sem rede real): não assina nada sem driver conhecido,
 * reconecta com espera crescente quando `escutar` falha, para quando o
 * device sai da lista, e `saude()` reflete último evento/erro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Supervisor, BACKOFF_INICIAL_MS, BACKOFF_MAX_MS, CLOCK_SYNC_INTERVAL_MS } = require('../src/core/supervisor');

const logMudo = { log: () => {}, error: () => {} };

function deviceLpr() {
  return { id: 99, nome: 'Câmera LPR', tipo: 'lpr', fabricante: 'intelbras' };
}

function deviceFacial(id = 1) {
  return { id, nome: `Facial ${id}`, tipo: 'facial', fabricante: 'fake' };
}

test('sem driver conhecido: não assina nada e loga uma vez só', () => {
  const logs = [];
  const log = { log: (m) => logs.push(m), error: () => {} };
  const resolverDriver = () => null;
  const supervisor = new Supervisor({ resolverDriver, log });

  const device = deviceLpr();
  supervisor.atualizar([device]);
  supervisor.atualizar([device]); // segundo poll: não deve logar de novo
  supervisor.atualizar([device]);

  assert.deepEqual(
    logs.filter((m) => m.includes('sem driver')),
    [`[agente] ${device.nome}: sem driver para lpr/intelbras`],
  );
  assert.equal(supervisor.saude(device.id).driver, null);
  assert.equal(supervisor.saude(device.id).online, false);
});

test('com driver: assina escutar() uma única vez mesmo em vários atualizar()', () => {
  let chamadas = 0;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      chamadas++;
      aoConectar();
      return () => {};
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  const device = deviceFacial();
  supervisor.atualizar([device]);
  supervisor.atualizar([device]);
  supervisor.atualizar([device]);
  assert.equal(chamadas, 1);
  assert.equal(supervisor.saude(device.id).online, true);
  assert.equal(supervisor.saude(device.id).driver, 'fake-facial');
});

test('reconecta com espera crescente (1s, 2s, 4s...) quando escutar() falha, e reseta ao reconectar', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let tentativas = 0;
  const tentativasEm = [];
  const driver = {
    id: 'fake-flaky',
    escutar(device, aoEvento, { aoConectar }) {
      tentativas++;
      tentativasEm.push(Date.now());
      if (tentativas <= 3) {
        throw new Error(`queda simulada #${tentativas}`);
      }
      aoConectar();
      return () => {};
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  const device = deviceFacial(2);
  supervisor.atualizar([device]);

  // 1ª tentativa falhou na hora (síncrono) — saude reflete o erro e offline.
  assert.equal(tentativas, 1);
  assert.equal(supervisor.saude(device.id).online, false);
  assert.match(supervisor.saude(device.id).ultimo_erro, /queda simulada #1/);

  // Espera 1: BACKOFF_INICIAL_MS (1000ms) antes da 2ª tentativa.
  t.mock.timers.tick(BACKOFF_INICIAL_MS - 1);
  assert.equal(tentativas, 1, 'não deve tentar antes de 1s');
  t.mock.timers.tick(1);
  assert.equal(tentativas, 2);

  // Espera 2: dobra para 2000ms antes da 3ª tentativa.
  t.mock.timers.tick(BACKOFF_INICIAL_MS * 2 - 1);
  assert.equal(tentativas, 2, 'não deve tentar antes de 2s');
  t.mock.timers.tick(1);
  assert.equal(tentativas, 3);

  // Espera 3: dobra para 4000ms antes da 4ª tentativa, que finalmente conecta.
  t.mock.timers.tick(BACKOFF_INICIAL_MS * 4);
  assert.equal(tentativas, 4);
  assert.equal(supervisor.saude(device.id).online, true, 'reconectou');
});

test('espera de reconexão tem teto de 60s (não cresce pra sempre)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let tentativas = 0;
  const driver = {
    id: 'fake-sempre-cai',
    escutar() {
      tentativas++;
      throw new Error('sempre cai');
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  supervisor.atualizar([deviceFacial(3)]);

  // Esperas: 1s, 2s, 4s, 8s, 16s, 32s, e a partir daqui trava em 60s.
  const esperas = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
  let esperado = 1;
  for (const espera of esperas) {
    t.mock.timers.tick(espera);
    esperado++;
    assert.equal(tentativas, esperado, `depois de +${espera}ms`);
  }
  assert.ok(BACKOFF_MAX_MS === 60000);
});

test('parar(): device removido da lista chama a função devolvida por escutar()', () => {
  let parouChamado = 0;
  const driver = {
    id: 'fake-facial',
    escutar() {
      return () => {
        parouChamado++;
      };
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  const device = deviceFacial(4);
  supervisor.atualizar([device]);
  assert.equal(parouChamado, 0);

  supervisor.atualizar([]); // device saiu da lista
  assert.equal(parouChamado, 1);
  assert.equal(supervisor.saude(device.id), null, 'não é mais rastreado');
});

test('saude(): reflete o timestamp do último evento recebido', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let aoEventoDoDriver;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento) {
      aoEventoDoDriver = aoEvento;
      return () => {};
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  const device = deviceFacial(5);
  supervisor.atualizar([device]);

  assert.equal(supervisor.saude(device.id).ultimo_evento_em, null);
  aoEventoDoDriver({ UserID: 'morador_1' });
  assert.ok(supervisor.saude(device.id).ultimo_evento_em instanceof Date);
});

test('saude(): repassa o evento cru para o callback aoEvento injetado', () => {
  let aoEventoDoDriver;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento) {
      aoEventoDoDriver = aoEvento;
      return () => {};
    },
  };
  const recebidos = [];
  const supervisor = new Supervisor({
    resolverDriver: () => driver,
    aoEvento: (device, dado) => recebidos.push({ deviceId: device.id, dado }),
    log: logMudo,
  });
  const device = deviceFacial(6);
  supervisor.atualizar([device]);
  aoEventoDoDriver({ UserID: 'x' });
  assert.deepEqual(recebidos, [{ deviceId: device.id, dado: { UserID: 'x' } }]);
});

test('aoConectar: chama acertarRelogio(force=true) e aoRecuperarOffline ao (re)conectar', async () => {
  const chamadasRelogio = [];
  const recuperados = [];
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
    acertarRelogio(device, force) {
      chamadasRelogio.push({ deviceId: device.id, force: !!force });
      return Promise.resolve();
    },
  };
  const supervisor = new Supervisor({
    resolverDriver: () => driver,
    aoRecuperarOffline: (device) => {
      recuperados.push(device.id);
      return Promise.resolve();
    },
    log: logMudo,
  });
  const device = deviceFacial(7);
  supervisor.atualizar([device]);

  // aoConectar dispara os dois síncronamente (as promises internas resolvem
  // no próximo microtask) — aguarda um tick pra garantir.
  await Promise.resolve();
  assert.deepEqual(chamadasRelogio, [{ deviceId: device.id, force: true }]);
  assert.deepEqual(recuperados, [device.id]);
});

test('acertarRelogio periódico: agenda a cada 1h enquanto o ouvinte está de pé', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let chamadas = 0;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
    acertarRelogio() {
      chamadas++;
      return Promise.resolve();
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  supervisor.atualizar([deviceFacial(8)]);
  assert.equal(chamadas, 1, 'acerto imediato ao conectar (force)');

  t.mock.timers.tick(CLOCK_SYNC_INTERVAL_MS - 1);
  assert.equal(chamadas, 1, 'ainda não passou 1h');
  t.mock.timers.tick(1);
  assert.equal(chamadas, 2, 'passou 1h: novo acerto periódico');

  t.mock.timers.tick(CLOCK_SYNC_INTERVAL_MS);
  assert.equal(chamadas, 3);
});

test('drivers sem acertarRelogio (ex.: Hikvision) não geram agendamento nem erro', () => {
  const driver = {
    id: 'fake-sem-relogio',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
    // sem acertarRelogio — como hikvision-facial.js/controlid-facial.js
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  assert.doesNotThrow(() => supervisor.atualizar([deviceFacial(9)]));
  assert.equal(supervisor.saude(9).online, true);
});

test('Supervisor exige resolverDriver()', () => {
  assert.throws(() => new Supervisor({}), /resolverDriver/);
});

test('Supervisor rejeita chave de opção desconhecida (ex.: "aoConectar" em vez de "aoRecuperarOffline")', () => {
  // Regressão: index.js passava `aoConectar` (nome do parâmetro do contrato
  // de driver, não da opção do Supervisor) — o construtor aceitava calado,
  // o fast-path de recuperação ficava morto porque `aoRecuperarOffline`
  // continuava no default no-op. Este teste falha na hora se o erro
  // voltar, em vez de só silenciosamente não fazer nada.
  assert.throws(
    () => new Supervisor({ resolverDriver: () => null, aoConectar: () => {} }),
    /opção desconhecida "aoConectar"/,
  );
});

test('aoRecuperarOffline falhando: registra o erro em saude().ultimo_erro (não some calado)', async () => {
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
  };
  const supervisor = new Supervisor({
    resolverDriver: () => driver,
    aoRecuperarOffline: () => Promise.reject(new Error('nuvem fora do ar')),
    log: logMudo,
  });
  const device = deviceFacial(12);
  supervisor.atualizar([device]);
  await Promise.resolve();
  await Promise.resolve();
  assert.match(supervisor.saude(device.id).ultimo_erro, /nuvem fora do ar/);
});

test('acertarRelogio falhando (ao conectar OU no acerto periódico): loga e registra em saude().ultimo_erro, não some calado', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const erros = [];
  const log = { log: () => {}, error: (m) => erros.push(m) };
  let chamadas = 0;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
    acertarRelogio() {
      chamadas++;
      return Promise.reject(new Error(`falha relogio #${chamadas}`));
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log });
  const device = deviceFacial(13);
  supervisor.atualizar([device]);

  await Promise.resolve();
  await Promise.resolve();
  assert.match(supervisor.saude(device.id).ultimo_erro, /falha relogio #1/, 'erro do acerto ao conectar (force)');
  assert.ok(erros.some((m) => m.includes('falha ao acertar relógio')), 'logou o erro ao conectar');

  erros.length = 0;
  t.mock.timers.tick(CLOCK_SYNC_INTERVAL_MS);
  await Promise.resolve();
  await Promise.resolve();
  assert.match(supervisor.saude(device.id).ultimo_erro, /falha relogio #2/, 'erro do acerto periódico');
  assert.ok(erros.some((m) => m.includes('falha ao acertar relógio')), 'logou o erro periódico');
});

test('parar(): cancela o acerto de relógio periódico (não continua batendo depois de parado)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let chamadas = 0;
  const driver = {
    id: 'fake-facial',
    escutar(device, aoEvento, { aoConectar }) {
      aoConectar();
      return () => {};
    },
    acertarRelogio() {
      chamadas++;
      return Promise.resolve();
    },
  };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  const device = deviceFacial(14);
  supervisor.atualizar([device]);
  assert.equal(chamadas, 1, 'acerto imediato ao conectar');

  supervisor.atualizar([]); // device removido da lista -> parar()

  t.mock.timers.tick(CLOCK_SYNC_INTERVAL_MS * 3);
  assert.equal(chamadas, 1, 'nenhum acerto periódico depois de parar()');
});

test('saudeTodos(): lista a saúde de todos os devices rastreados', () => {
  const driver = { id: 'fake-facial', escutar: () => () => {} };
  const supervisor = new Supervisor({ resolverDriver: () => driver, log: logMudo });
  supervisor.atualizar([deviceFacial(10), deviceFacial(11)]);
  const ids = supervisor.saudeTodos().map((s) => s.id).sort();
  assert.deepEqual(ids, [10, 11]);
});
