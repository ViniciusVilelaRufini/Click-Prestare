'use strict';

/**
 * agent/src/core/despacho.js — despacho de comandos (uma fila por aparelho,
 * aparelhos em paralelo) e ciclo de ping do heartbeat (paralelo, com timeout
 * próprio e sem sobreposição por aparelho). Tudo com dependências injetadas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarDespachante, criarCicloDePing } = require('../src/core/despacho');

const logMudo = { log: () => {}, error: () => {} };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Promise controlada de fora — para decidir quando um "aparelho" responde. */
function adiado() {
  let resolver;
  let rejeitar;
  const promessa = new Promise((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

test('despachar(): comandos do MESMO aparelho rodam estritamente em ordem (um por vez)', async () => {
  const eventos = [];
  let emCurso = 0;
  let maxEmCurso = 0;
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      emCurso++;
      maxEmCurso = Math.max(maxEmCurso, emCurso);
      eventos.push(`ini:${cmd.id}`);
      // O primeiro demora MAIS que os seguintes: em paralelo, a ordem de término inverteria.
      await espera(cmd.id === 'a' ? 30 : 1);
      eventos.push(`fim:${cmd.id}`);
      emCurso--;
      return { ok: true };
    },
    postarResultado: async (device, cmd) => {
      eventos.push(`post:${cmd.id}`);
    },
    log: logMudo,
  });
  await despachante.despachar([
    {
      device: { id: 1, nome: 'A' },
      commands: [
        { id: 'a', type: 'enroll' },
        { id: 'b', type: 'open_door' },
        { id: 'c', type: 'ping' },
      ],
    },
  ]);
  assert.equal(maxEmCurso, 1);
  assert.deepEqual(eventos, [
    'ini:a', 'fim:a', 'post:a',
    'ini:b', 'fim:b', 'post:b',
    'ini:c', 'fim:c', 'post:c',
  ]);
});

test('despachar(): aparelho lento NÃO atrasa o comando de outro aparelho', async () => {
  const lento = adiado();
  const postados = [];
  const despachante = criarDespachante({
    executar: (device) => (device.id === 1 ? lento.promessa : Promise.resolve({ ok: true })),
    postarResultado: async (device, cmd, result) => {
      postados.push({ id: cmd.id, ok: result.ok });
    },
    log: logMudo,
  });
  const lote = despachante.despachar([
    { device: { id: 1, nome: 'Offline' }, commands: [{ id: 'lento', type: 'open_door' }] },
    { device: { id: 2, nome: 'Vivo' }, commands: [{ id: 'rapido', type: 'open_door' }] },
  ]);
  await espera(20);
  // O aparelho 1 ainda nem respondeu e o 2 já devolveu o resultado à nuvem.
  assert.deepEqual(postados, [{ id: 'rapido', ok: true }]);
  assert.equal(despachante.ocioso(), false);
  lento.resolver({ ok: false, error: 'timeout' });
  await lote;
  assert.deepEqual(postados, [
    { id: 'rapido', ok: true },
    { id: 'lento', ok: false },
  ]);
  assert.equal(despachante.ocioso(), true);
});

test('despachar(): a ordem por aparelho vale ENTRE lotes (o poll seguinte não fura a fila)', async () => {
  const primeiro = adiado();
  const ordem = [];
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      ordem.push(`ini:${cmd.id}`);
      if (cmd.id === 'lote1') await primeiro.promessa;
      ordem.push(`fim:${cmd.id}`);
      return { ok: true };
    },
    postarResultado: async () => {},
    log: logMudo,
  });
  const device = { id: 7, nome: 'Portão' };
  const l1 = despachante.despachar([{ device, commands: [{ id: 'lote1', type: 'enroll' }] }]);
  const l2 = despachante.despachar([{ device, commands: [{ id: 'lote2', type: 'open_door' }] }]);
  await espera(15);
  assert.deepEqual(ordem, ['ini:lote1']);
  primeiro.resolver();
  await Promise.all([l1, l2]);
  assert.deepEqual(ordem, ['ini:lote1', 'fim:lote1', 'ini:lote2', 'fim:lote2']);
});

test('despachar(): falha ao POSTAR o resultado de um comando não descarta os demais do lote', async () => {
  const executados = [];
  const postados = [];
  const erros = [];
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      executados.push(cmd.id);
      return { ok: true };
    },
    postarResultado: async (device, cmd) => {
      if (cmd.id === 'a') throw new Error('nuvem fora do ar');
      postados.push(cmd.id);
    },
    log: { log: () => {}, error: (m) => erros.push(m) },
  });
  await despachante.despachar([
    {
      device: { id: 1, nome: 'A' },
      commands: [
        // Tipos diferentes de propósito: dois open_door seguidos colapsam em um (C1-d).
        { id: 'a', type: 'ping' },
        { id: 'b', type: 'open_door' },
      ],
    },
    { device: { id: 2, nome: 'B' }, commands: [{ id: 'c', type: 'open_door' }] },
  ]);
  assert.deepEqual(executados.sort(), ['a', 'b', 'c']);
  assert.deepEqual(postados.sort(), ['b', 'c']);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /nuvem fora do ar/);
});

test('despachar(): executar() que LANÇA vira resultado ok:false e os demais comandos seguem', async () => {
  const postados = [];
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      if (cmd.id === 'a') {
        const e = new Error('aparelho explodiu');
        e.statusCode = 500;
        throw e;
      }
      return { ok: true };
    },
    postarResultado: async (device, cmd, result) => {
      postados.push({ id: cmd.id, ...result });
    },
    log: logMudo,
  });
  await despachante.despachar([
    {
      device: { id: 1, nome: 'A' },
      commands: [
        { id: 'a', type: 'enroll' },
        { id: 'b', type: 'open_door' },
      ],
    },
  ]);
  assert.deepEqual(postados, [
    { id: 'a', ok: false, statusCode: 500, error: 'aparelho explodiu' },
    { id: 'b', ok: true },
  ]);
});

test('despachar(): entrada sem device/id ou comando nulo é ignorada sem lançar', async () => {
  const executados = [];
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      executados.push(cmd.id);
      return { ok: true };
    },
    postarResultado: async () => {},
    log: logMudo,
  });
  await despachante.despachar([
    null,
    { commands: [{ id: 'orfao', type: 'open_door' }] },
    { device: { nome: 'sem id' }, commands: [{ id: 'sem-id', type: 'open_door' }] },
    { device: { id: 3, nome: 'ok' }, commands: [null, { id: 'bom', type: 'open_door' }] },
    { device: { id: 4, nome: 'sem comandos' } },
  ]);
  assert.deepEqual(executados, ['bom']);
  assert.equal(despachante.ocioso(), true);
});

test('criarCicloDePing(): pinga em paralelo e classifica o motivo da falha', async () => {
  const iniciados = [];
  const ciclo = criarCicloDePing({
    pingar: async (device) => {
      iniciados.push(device.id);
      await espera(30);
      if (device.id === 2) return { ok: false, statusCode: 401 };
      if (device.id === 3) {
        const e = new Error('connect ECONNREFUSED 10.0.0.3:80');
        e.code = 'ECONNREFUSED';
        throw e;
      }
      return { ok: true, statusCode: 200 };
    },
    timeoutMs: 1000,
  });
  const promessa = ciclo.rodar([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await espera(5);
  assert.deepEqual(iniciados, [1, 2, 3], 'os três pings começam juntos, sem esperar o anterior');
  const res = await promessa;
  assert.deepEqual(
    res.map((r) => ({ id: r.device.id, online: r.online, motivo: r.motivo })),
    [
      { id: 1, online: true, motivo: null },
      { id: 2, online: false, motivo: 'credencial' },
      { id: 3, online: false, motivo: 'recusado' },
    ],
  );
});

test('criarCicloDePing(): timeout próprio curto — aparelho mudo vira offline/sem_resposta sem segurar o ciclo', async () => {
  const mudo = adiado();
  const ciclo = criarCicloDePing({
    pingar: (device) => (device.id === 1 ? mudo.promessa : Promise.resolve({ ok: true })),
    timeoutMs: 30,
  });
  const t0 = Date.now();
  const res = await ciclo.rodar([{ id: 1 }, { id: 2 }]);
  assert.ok(Date.now() - t0 < 500);
  assert.deepEqual(
    res.map((r) => ({ id: r.device.id, online: r.online, motivo: r.motivo })),
    [
      { id: 1, online: false, motivo: 'sem_resposta' },
      { id: 2, online: true, motivo: null },
    ],
  );
  mudo.resolver({ ok: true });
});

test('criarCicloDePing(): não sobrepõe dois pings para o MESMO aparelho (pula quem ainda está em voo)', async () => {
  const mudo = adiado();
  const chamadas = [];
  const ciclo = criarCicloDePing({
    pingar: (device) => {
      chamadas.push(device.id);
      return device.id === 1 ? mudo.promessa : Promise.resolve({ ok: true });
    },
    timeoutMs: 20,
  });
  await ciclo.rodar([{ id: 1 }, { id: 2 }]);
  // O ping real do aparelho 1 ainda não terminou (só o timeout do ciclo venceu).
  const segundo = await ciclo.rodar([{ id: 1 }, { id: 2 }]);
  assert.deepEqual(chamadas, [1, 2, 2]);
  assert.deepEqual(segundo.map((r) => r.device.id), [2], 'aparelho em voo fica fora do ciclo');
  mudo.resolver({ ok: true });
  await espera(5);
  const terceiro = await ciclo.rodar([{ id: 1 }, { id: 2 }]);
  assert.deepEqual(chamadas, [1, 2, 2, 1, 2]);
  assert.deepEqual(
    terceiro.map((r) => [r.device.id, r.online]),
    [
      [1, true],
      [2, true],
    ],
  );
});

test('criarCicloDePing(): device sem id é ignorado', async () => {
  const ciclo = criarCicloDePing({ pingar: async () => ({ ok: true }), timeoutMs: 50 });
  const res = await ciclo.rodar([null, {}, { id: 5 }]);
  assert.deepEqual(res.map((r) => r.device.id), [5]);
});

test('PING_TIMEOUT_MS: padrão de 5 s (ping com Digest são duas idas e vindas; 3 s dava falso OFFLINE)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { PING_TIMEOUT_MS } = require('../src/core/despacho');
  assert.equal(PING_TIMEOUT_MS, 5000);
  const raiz = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(raiz, '.env.example'), 'utf8'), /DEVICE_PING_TIMEOUT_MS=5000\b/);
  assert.match(fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'), /prazo de 5 s por\s+aparelho/);
});

// ---------- C1: comando velho não executa depois que a nuvem desistiu ----------

const { prazoDoComando, ERRO_EXPIRADO } = require('../src/core/despacho');

/** Despachante com relógio monotônico falso e um "aparelho" controlado. */
function bancada({ executar } = {}) {
  const relogio = { t: 0 };
  const executados = []; // { id, type, ip, em }
  const postados = []; // { id, ...result }
  const pendentes = []; // adiados de execuções em curso
  const despachante = criarDespachante({
    executar:
      executar ||
      ((device, cmd) => {
        executados.push({ id: cmd.id, type: cmd.type, ip: device.ip, em: relogio.t });
        const a = adiado();
        pendentes.push(a);
        return a.promessa;
      }),
    postarResultado: async (device, cmd, result) => {
      postados.push({ id: cmd.id, ...result });
    },
    log: logMudo,
    agora: () => relogio.t,
  });
  /** Deixa as microtarefas/filas andarem. */
  const assentar = () => espera(5);
  return { relogio, executados, postados, pendentes, despachante, assentar };
}

const PORTA = { id: 1, nome: 'Portão', ip: '10.0.0.1' };
const expirado = (id) => ({ id, ok: false, error: 'expirado na fila do agente' });

test('prazoDoComando(): padrão por tipo ABAIXO do da nuvem; ttl_ms da nuvem manda; open_door tem teto rígido de 10 s', () => {
  assert.equal(ERRO_EXPIRADO, 'expirado na fila do agente');
  for (const type of ['open_door', 'ping', 'snapshot', 'remove']) assert.equal(prazoDoComando({ type }), 10000, type);
  for (const type of ['enroll', 'update', 'list_users', 'remove_users']) assert.equal(prazoDoComando({ type }), 20000, type);
  assert.equal(prazoDoComando({ type: 'novidade' }), 10000);
  assert.equal(prazoDoComando({ type: 'toString' }), 10000, 'nome herdado de Object não vira prazo');
  // ttl_ms vindo da nuvem: vale para mais e para menos...
  assert.equal(prazoDoComando({ type: 'enroll', ttl_ms: 4000 }), 4000);
  assert.equal(prazoDoComando({ type: 'ping', ttl_ms: 12000 }), 12000);
  assert.equal(prazoDoComando({ type: 'open_door', ttl_ms: 3000 }), 3000);
  assert.equal(prazoDoComando({ type: 'open_door', ttl_ms: 0 }), 0);
  // ...menos para abrir porta: nunca acima de 10 s.
  assert.equal(prazoDoComando({ type: 'open_door', ttl_ms: 60000 }), 10000);
  // ttl_ms torto (o agente não confia): cai no padrão.
  for (const ttl of ['5000', NaN, -1, null, {}, Infinity]) {
    assert.equal(prazoDoComando({ type: 'enroll', ttl_ms: ttl }), 20000, String(ttl));
  }
});

test('C1: aparelho mudo + 5 open_door entregues em polls seguidos → no máximo UMA abertura, e nunca depois do prazo', async () => {
  const b = bancada();
  // Um cadastro segura a fila do aparelho (aparelho mudo/lento).
  b.despachante.despachar([{ device: PORTA, commands: [{ id: 'cadastro', type: 'enroll' }] }]);
  await b.assentar();
  // O operador clica "abrir" 5 vezes; cada poll entrega um (a nuvem os marca como entregues).
  for (let i = 1; i <= 5; i++) {
    b.relogio.t = i * 500;
    b.despachante.despachar([{ device: PORTA, commands: [{ id: `od${i}`, type: 'open_door' }] }]);
  }
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['cadastro'], 'nada fura a fila');
  // O aparelho volta em t=11,2 s: od1 (10,7 s) e od2 (10,2 s) já passaram do prazo.
  b.relogio.t = 11200;
  b.pendentes[0].resolver({ ok: false, error: 'timeout' });
  await b.assentar();
  const aberturas = b.executados.filter((e) => e.type === 'open_door');
  assert.equal(aberturas.length, 1, 'uma única abertura física');
  assert.equal(aberturas[0].id, 'od3');
  assert.ok(aberturas[0].em - 1500 <= 10000, 'o que executou esperou menos que o prazo');
  b.pendentes[1].resolver({ ok: true, statusCode: 200 });
  await b.assentar();
  assert.deepEqual(b.postados, [
    { id: 'cadastro', ok: false, error: 'timeout' },
    expirado('od1'),
    expirado('od2'),
    { id: 'od3', ok: true, statusCode: 200 },
    { id: 'od4', ok: true, statusCode: 200 },
    { id: 'od5', ok: true, statusCode: 200 },
  ]);
  assert.equal(b.despachante.ocioso(), true);
});

test('C1: aparelho volta DEPOIS do prazo de todos os open_door → a porta não abre nenhuma vez', async () => {
  const b = bancada();
  b.despachante.despachar([{ device: PORTA, commands: [{ id: 'cadastro', type: 'enroll' }] }]);
  await b.assentar();
  for (let i = 1; i <= 5; i++) {
    b.relogio.t = i * 500;
    b.despachante.despachar([{ device: PORTA, commands: [{ id: `od${i}`, type: 'open_door' }] }]);
  }
  b.relogio.t = 13000;
  b.pendentes[0].resolver({ ok: false, error: 'timeout' });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['cadastro'], 'nenhum open_door tocou o aparelho');
  assert.deepEqual(b.postados.slice(1), ['od1', 'od2', 'od3', 'od4', 'od5'].map(expirado));
  assert.equal(b.despachante.ocioso(), true);
});

test('C1: enroll atrás de aparelho lento expira (20 s) sem tocar o aparelho', async () => {
  const b = bancada();
  b.despachante.despachar([
    { device: PORTA, commands: [{ id: 'lento', type: 'list_users' }, { id: 'rosto', type: 'enroll' }, { id: 'ok', type: 'ping' }] },
  ]);
  await b.assentar();
  b.relogio.t = 20001;
  // Este ping chega agora (poll seguinte): é novo, não expira junto.
  b.despachante.despachar([{ device: PORTA, commands: [{ id: 'novo', type: 'ping' }] }]);
  b.pendentes[0].resolver({ ok: true });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['lento', 'novo']);
  assert.deepEqual(b.postados.slice(0, 3), [{ id: 'lento', ok: true }, expirado('rosto'), expirado('ok')]);
  b.pendentes[1].resolver({ ok: true });
  await b.assentar();
});

test('C1: no limite exato do prazo ainda executa; 1 ms depois, não', async () => {
  for (const [idade, executa] of [[10000, true], [10001, false]]) {
    const b = bancada();
    b.despachante.despachar([{ device: PORTA, commands: [{ id: 'a', type: 'ping' }, { id: 'b', type: 'remove' }] }]);
    await b.assentar();
    b.relogio.t = idade;
    b.pendentes[0].resolver({ ok: true });
    await b.assentar();
    assert.deepEqual(b.executados.map((e) => e.id), executa ? ['a', 'b'] : ['a'], `idade ${idade}`);
    b.pendentes[1]?.resolver({ ok: true });
    await b.assentar();
  }
});

test('C1: ttl_ms da nuvem é respeitado (menor e maior que o padrão do tipo)', async () => {
  const b = bancada();
  b.despachante.despachar([
    {
      device: PORTA,
      commands: [
        { id: 'trava', type: 'ping' },
        { id: 'curto', type: 'enroll', ttl_ms: 3000 }, // padrão seria 20 s
        { id: 'longo', type: 'remove', ttl_ms: 12000 }, // padrão seria 10 s
      ],
    },
  ]);
  await b.assentar();
  b.relogio.t = 11000;
  b.pendentes[0].resolver({ ok: true });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['trava', 'longo']);
  assert.deepEqual(b.postados, [{ id: 'trava', ok: true }, expirado('curto')]);
  b.pendentes[1].resolver({ ok: true });
  await b.assentar();
});

test('C1: ttl_ms 0 (a nuvem já está desistindo) nunca executa, mesmo com a fila livre', async () => {
  const b = bancada();
  await b.despachante.despachar([{ device: PORTA, commands: [{ id: 'tarde', type: 'open_door', ttl_ms: 0 }] }]);
  assert.deepEqual(b.executados, []);
  assert.deepEqual(b.postados, [expirado('tarde')]);
});

test('C1: teto rígido do open_door — ttl_ms de 60 s da nuvem não deixa abrir a porta depois de 10 s', async () => {
  const b = bancada();
  b.despachante.despachar([
    { device: PORTA, commands: [{ id: 'trava', type: 'ping' }, { id: 'porta', type: 'open_door', ttl_ms: 60000 }] },
  ]);
  await b.assentar();
  b.relogio.t = 10001;
  b.pendentes[0].resolver({ ok: true });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['trava']);
  assert.deepEqual(b.postados[1], expirado('porta'));
});

test('C1: o relógio padrão é monotônico (performance.now), não Date.now', async () => {
  // Acertar o relógio do Windows não pode envelhecer nem rejuvenescer a
  // fila: um Date.now que pula 1 h no meio não expira nada.
  const dateNow = Date.now;
  const executados = [];
  const despachante = criarDespachante({
    executar: async (device, cmd) => {
      executados.push(cmd.id);
      Date.now = () => dateNow() + 3600 * 1000;
      return { ok: true };
    },
    postarResultado: async () => {},
    log: logMudo,
  });
  try {
    await despachante.despachar([{ device: PORTA, commands: [{ id: 'a', type: 'ping' }, { id: 'b', type: 'remove' }] }]);
  } finally {
    Date.now = dateNow;
  }
  assert.deepEqual(executados, ['a', 'b']);
});

test('C1: executa com o device do ÚLTIMO poll (IP/credencial atuais), não o capturado quando o comando chegou', async () => {
  const b = bancada();
  b.despachante.despachar([{ device: PORTA, commands: [{ id: 'trava', type: 'ping' }, { id: 'porta', type: 'open_door' }] }]);
  await b.assentar();
  // Poll seguinte: o DHCP trocou o IP (correção automática da etapa 3). Sem comandos novos.
  b.relogio.t = 2000;
  b.despachante.despachar([{ device: { ...PORTA, ip: '10.0.0.77' }, commands: [] }]);
  b.pendentes[0].resolver({ ok: true });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => [e.id, e.ip]), [['trava', '10.0.0.1'], ['porta', '10.0.0.77']]);
  b.pendentes[1].resolver({ ok: true });
  await b.assentar();
});

test('C1: aparelho que saiu da lista do último poll → comando descartado com ok:false, sem tocar o aparelho', async () => {
  const b = bancada();
  const outro = { id: 2, nome: 'Outro', ip: '10.0.0.2' };
  b.despachante.despachar([
    { device: PORTA, commands: [{ id: 'trava', type: 'ping' }, { id: 'porta', type: 'open_door' }] },
    { device: outro, commands: [] },
  ]);
  await b.assentar();
  b.relogio.t = 2000;
  b.despachante.despachar([{ device: outro, commands: [] }]); // Portão removido/desativado no portal
  b.pendentes[0].resolver({ ok: true });
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['trava']);
  assert.equal(b.postados[1].id, 'porta');
  assert.equal(b.postados[1].ok, false);
  assert.match(b.postados[1].error, /não está mais na lista/);
  assert.equal(b.despachante.ocioso(), true);
});

test('C1: colapso — N open_door consecutivos na fila viram UMA abertura e todos recebem o mesmo resultado', async () => {
  const b = bancada();
  b.despachante.despachar([
    {
      device: PORTA,
      commands: [
        { id: 'od1', type: 'open_door' },
        { id: 'od2', type: 'open_door' },
        { id: 'od3', type: 'open_door' },
        { id: 'ping', type: 'ping' },
        { id: 'od4', type: 'open_door' },
      ],
    },
  ]);
  await b.assentar();
  assert.deepEqual(b.executados.map((e) => e.id), ['od1']);
  b.pendentes[0].resolver({ ok: true, statusCode: 200 });
  await b.assentar();
  b.pendentes[1].resolver({ ok: true });
  await b.assentar();
  b.pendentes[2].resolver({ ok: false, error: 'porta travada' });
  await b.assentar();
  // od4 NÃO colapsa com os anteriores: há um ping no meio (não é consecutivo).
  assert.deepEqual(b.executados.map((e) => e.id), ['od1', 'ping', 'od4']);
  assert.deepEqual(b.postados, [
    { id: 'od1', ok: true, statusCode: 200 },
    { id: 'od2', ok: true, statusCode: 200 },
    { id: 'od3', ok: true, statusCode: 200 },
    { id: 'ping', ok: true },
    { id: 'od4', ok: false, error: 'porta travada' },
  ]);
  assert.equal(b.despachante.ocioso(), true);
});

test('C1: colapso não mistura aparelhos nem outros tipos (dois enroll seguidos executam os dois)', async () => {
  const executados = [];
  const b = bancada({
    executar: async (device, cmd) => {
      executados.push(`${device.id}:${cmd.id}`);
      return { ok: true };
    },
  });
  await b.despachante.despachar([
    { device: PORTA, commands: [{ id: 'e1', type: 'enroll' }, { id: 'e2', type: 'enroll' }, { id: 'p1', type: 'open_door' }] },
    { device: { id: 2, nome: 'B' }, commands: [{ id: 'p2', type: 'open_door' }] },
  ]);
  assert.deepEqual(executados.sort(), ['1:e1', '1:e2', '1:p1', '2:p2']);
});
