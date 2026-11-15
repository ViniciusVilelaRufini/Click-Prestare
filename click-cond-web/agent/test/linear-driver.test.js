'use strict';

/**
 * agent/src/drivers/linear-guarita.js — driver do Módulo Guarita ligado ao
 * núcleo, contra o SIMULADOR (TCP real) e uma NUVEM FALSA (HTTP real local)
 * que segue o contrato das rotas do plano (a API de verdade é feita por
 * outra raia). Relógio falso para 5 s / 30 s / 60 s. Ao fim de cada cenário
 * o simulador não pode ter recebido comando proibido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { criarGuaritaSimulado } = require('../harness/guarita-simulado');
const { criarDriverGuarita, PADROES, naoCadastradoDe, partesDaImportacao } = require('../src/drivers/linear-guarita');
const nuvemCore = require('../src/core/nuvem');
const { classificarFalha } = require('../src/lib/http');
const { prazoDoComando } = require('../src/core/despacho');
const { criarRelogioFalso, esperarAte } = require('./linear-auxiliares');

const TOKEN = 'tok-condo-1';
const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();

/** Frame de dispositivo (39 bytes) gerado aqui, sem o codec. */
function dispositivo(i, tipo = 2) {
  const d = Buffer.alloc(39, 0x20);
  d[0] = tipo << 4;
  d[1] = (i >> 16) & 0xff;
  d[2] = (i >> 8) & 0xff;
  d[3] = i & 0xff;
  d.fill(0, 4, 11);
  d[6] = Math.floor((i % 10000) / 100);
  d[7] = i % 100;
  d[10] = 0xff;
  d[29] = 0;
  d[30] = 0x16;
  d[31] = 0;
  return d;
}
const E1 = Buffer.from('01A2B3C4143005151126100308011000', 'hex');
const E2 = Buffer.from('000F086E080000010125210005004000', 'hex');
function evento(n) {
  const e = Buffer.from(E2);
  e[6] = ((Math.floor(n / 10) % 6) << 4) | (n % 10);
  e[5] = Math.floor(n / 60) % 60;
  return e;
}

// ---------- nuvem falsa ----------

function criarNuvemFalsa() {
  const st = {
    ops: [],
    reentregar: false,
    foraDoAr: false,
    falharResultados: false,
    semRotas: false,
    resultados: [],
    eventos: [],
    lotesEventos: [],
    naoCadastrados: [],
    estados: [],
    pedidos: [],
  };
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const json = corpo ? JSON.parse(corpo) : undefined;
      st.pedidos.push({ metodo: req.method, url: req.url });
      const responder = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj || {}));
      };
      if (st.foraDoAr) return responder(503, { message: 'fora do ar' });
      const m = req.url.match(new RegExp(`^/api/facial/agent/condo/${TOKEN}/guarita/(\\d+)/(.+)$`));
      if (st.semRotas || !m) return responder(404, { message: `Cannot ${req.method} ${req.url}` });
      const [, deviceId, rota] = m;
      if (req.method === 'GET' && rota === 'operacoes') {
        const lista = st.ops.filter((o) => st.reentregar || !o._entregue);
        for (const o of lista) o._entregue = true;
        return responder(200, { operacoes: lista.map(({ _entregue, ...o }) => o) });
      }
      const r = rota.match(/^operacoes\/(\d+)\/resultado$/);
      if (req.method === 'POST' && r && st.falharResultados) return responder(503, {});
      if (req.method === 'POST' && r) {
        st.resultados.push({ id: Number(r[1]), ...json });
        return responder(200, {});
      }
      if (req.method === 'POST' && rota === 'eventos') {
        st.lotesEventos.push(json);
        st.eventos.push(...json.eventos);
        return responder(200, { aceitos: json.eventos.length });
      }
      if (req.method === 'POST' && rota === 'nao-cadastrado') {
        st.naoCadastrados.push(json);
        return responder(200, {});
      }
      if (req.method === 'POST' && rota === 'estado') {
        st.estados.push({ deviceId: Number(deviceId), ...json });
        return responder(200, {});
      }
      return responder(404, {});
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      st.url = `http://127.0.0.1:${servidor.address().port}`;
      st.fechar = () => new Promise((r) => servidor.close(() => r()));
      servidor.closeIdleConnections?.();
      resolve(st);
    });
  });
}

// ---------- cenário ----------

async function cenario({ sim: simOpcoes = {}, device = {}, intervalos, armazem } = {}, fn) {
  const relogio = criarRelogioFalso();
  const sim = criarGuaritaSimulado({ horaDoGuarita: () => new Date(relogio.agora() + 200000), ...simOpcoes });
  const { porta } = await sim.escutar();
  const nuvem = await criarNuvemFalsa();
  nuvemCore.configurar({ apiUrl: nuvem.url });
  const logs = [];
  const log = { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const novoDriver = () =>
    criarDriverGuarita({
      requisitarNuvem: (metodo, caminho, corpo) =>
        nuvemCore.cloudRequest(metodo, `/api/facial/agent/condo/${TOKEN}${caminho}`, corpo),
      agora: relogio.agora,
      temporizador: relogio,
      log,
      intervalos,
      armazem,
    });
  let driver = novoDriver();
  const dev = {
    id: 42,
    nome: 'Guarita teste',
    tipo: 'guarita',
    fabricante: 'linear',
    ip: '127.0.0.1',
    porta,
    api_user: null,
    api_password: simOpcoes.palavra || null,
    ...device,
  };
  let parar = null;
  const ctx = {
    sim,
    nuvem,
    relogio,
    dev,
    logs,
    get driver() {
      return driver;
    },
    servico: () => driver._servicos.get(dev.id),
    /** Simula reinício do agente: para o driver atual e cria outro (mesmo armazém). */
    reiniciarAgente() {
      if (parar) parar();
      parar = null;
      driver = novoDriver();
    },
    escutar() {
      parar = driver.escutar(dev, () => {
        throw new Error('o Guarita nunca usa aoEvento (forwardAccessEvent)');
      });
      return parar;
    },
    /** Espera a conexão + identificação + recuperação terminarem (o ciclo fica armado). */
    async pronto() {
      await esperarAte(() => ctx.servico() && ctx.servico().conectado && ctx.servico().timers.ciclo, { rotulo: 'sessão pronta' });
    },
  };
  try {
    await fn(ctx);
  } finally {
    if (parar) parar();
    await sim.fechar();
    await nuvem.fechar();
  }
  assert.deepEqual(sim.comandosProibidosRecebidos().map(hex), [], 'o simulador recebeu comando proibido');
}

// ---------- testes ----------

test('conectar: identifica, manda o estado e recupera os eventos da memória (6/17 com marca 0x02)', async () => {
  await cenario({ sim: { eventos: [E1, E2], dispositivos: [dispositivo(1), dispositivo(2), dispositivo(3)] } }, async (c) => {
    c.escutar();
    await c.pronto();
    await esperarAte(() => c.nuvem.eventos.length === 2, { rotulo: 'eventos recuperados' });
    assert.deepEqual(
      c.nuvem.eventos.map((e) => [e.frame_hex, e.origem]),
      [[hex(E1), 'recuperacao'], [hex(E2), 'recuperacao']],
    );
    assert.equal(c.nuvem.eventos[0].recebido_em, new Date(c.relogio.agora()).toISOString());
    assert.equal(c.nuvem.lotesEventos[0].relogio_delta_s, 200);
    const estado = c.nuvem.estados.find((e) => e.conectado);
    assert.deepEqual(estado, {
      deviceId: 42,
      conectado: true,
      autorizado: true,
      firmware: 'G003s',
      total_dispositivos: 3,
      total_eventos: 2,
      relogio_delta_s: 200,
    });
    assert.equal(c.sim.comandosRecebidos(11).length, 0, 'o driver não acerta o relógio do Guarita');
    assert.equal(hex(c.sim.comandosRecebidos(6)[0]), '00060208');
    assert.equal(hex(c.sim.comandosRecebidos(17)[0]), '00110213');
  });
});

test('evento ao vivo (comando 4) vai para POST eventos com origem ao_vivo; nunca passa por aoEvento', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.injetarEvento(E1);
    await esperarAte(() => c.nuvem.eventos.length === 1, { rotulo: 'evento ao vivo' });
    assert.equal(c.nuvem.eventos[0].frame_hex, hex(E1));
    assert.equal(c.nuvem.eventos[0].origem, 'ao_vivo');
    assert.equal(typeof c.nuvem.lotesEventos[0].relogio_delta_s, 'number');
  });
});

test('evento pelo comando 40 (ponteiro) também é aceito', async () => {
  await cenario({ sim: { modoEvento: 40 } }, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.injetarEvento(E1);
    await esperarAte(() => c.nuvem.eventos.length === 1, { rotulo: 'evento 40' });
    assert.equal(c.nuvem.eventos[0].frame_hex, hex(E1));
  });
});

test('dispositivo não cadastrado (42, 46, 90) → POST nao-cadastrado no formato do contrato', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.injetarNaoCadastrado({ comando: 42, tipo: 1, serialHex: '1A2B3C4', contador: 0x1234, bateriaFraca: true });
    c.sim.injetarNaoCadastrado({ comando: 46, tipo: 1, serialHex: '1A2B3C4', contador: 0x34, num: 2 });
    c.sim.injetarNaoCadastrado({ comando: 90, serialHex: '0ABCDEF', contador: 0x0102, num: 0 });
    c.sim.injetarNaoCadastrado({ comando: 46, tipo: 3, serialHex: '0F086E', num: 1 });
    await esperarAte(() => c.nuvem.naoCadastrados.length === 4, { rotulo: 'não cadastrados' });
    const em = new Date(c.relogio.agora()).toISOString();
    const porComando = (cmd, tipo) => c.nuvem.naoCadastrados.find((n) => n.comando === cmd && n.tipo === tipo);
    assert.deepEqual(porComando(42, 1), { comando: 42, tipo: 1, serial_hex: '1A2B3C4', contador: 0x1234, receptor: null, bateria_fraca: true, recebido_em: em });
    assert.deepEqual(porComando(46, 1), { comando: 46, tipo: 1, serial_hex: '1A2B3C4', contador: null, receptor: 3, bateria_fraca: false, recebido_em: em });
    assert.deepEqual(porComando(90, 1), { comando: 90, tipo: 1, serial_hex: '0ABCDEF', contador: 0x0102, receptor: 1, bateria_fraca: false, recebido_em: em });
    assert.deepEqual(porComando(46, 3), { comando: 46, tipo: 3, serial_hex: '0F086E', contador: null, receptor: 2, bateria_fraca: false, recebido_em: em });
  });
});

test('importar: 7 + 70 + 43 e resultado em partes de até 500, fechado com fim', async () => {
  const lista = Array.from({ length: 1001 }, (_, i) => dispositivo(i + 1, [1, 2, 3, 6][i % 4]));
  await cenario({ sim: { dispositivos: lista } }, async (c) => {
    c.nuvem.ops.push({ id: 7, tipo: 'importar' });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 3, { rotulo: '3 partes', limiteMs: 10000 });
    const partes = c.nuvem.resultados;
    assert.deepEqual(partes.map((p) => [p.id, p.ok, p.parte, p.fim, p.frames_hex.length]), [
      [7, true, 1, false, 500],
      [7, true, 2, false, 500],
      [7, true, 3, true, 1],
    ]);
    assert.deepEqual(partes.flatMap((p) => p.frames_hex), lista.map(hex));
    assert.equal(c.sim.comandosRecebidos(43).length >= 1, true);
    assert.equal(c.sim.comandosRecebidos(67).length, 0, 'importar nunca grava nada');
  });
});

test('conferir: Guarita vazio → uma parte vazia com fim', async () => {
  await cenario({}, async (c) => {
    c.nuvem.ops.push({ id: 8, tipo: 'conferir' });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 1, { rotulo: 'resultado' });
    assert.deepEqual(c.nuvem.resultados[0], { id: 8, ok: true, frames_hex: [], parte: 1, fim: true });
  });
});

test('lote de 3 cadastros: resultados ok e UM 29 só, 30 s depois da última gravação (relógio falso)', async () => {
  await cenario({ sim: { tempos: { atraso29Ms: 5 } } }, async (c) => {
    for (const i of [1, 2, 3]) c.nuvem.ops.push({ id: 100 + i, tipo: 'cadastrar', frame_hex: hex(dispositivo(i, 3)) });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 3, { rotulo: '3 resultados' });
    assert.deepEqual(c.nuvem.resultados, [
      { id: 101, ok: true, codigo: 0 },
      { id: 102, ok: true, codigo: 0 },
      { id: 103, ok: true, codigo: 0 },
    ]);
    assert.equal(c.sim.memoria.dispositivos.length, 3);
    assert.equal(c.sim.comandosRecebidos(29).length, 0);
    await c.relogio.avancar(29999);
    assert.equal(c.sim.comandosRecebidos(29).length, 0, 'ainda não: 30 s depois da última');
    await c.relogio.avancar(1);
    await esperarAte(() => c.sim.comandosRecebidos(29).length === 1, { rotulo: 'o 29' });
    await c.relogio.avancar(120000);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.comandosRecebidos(29).length, 1, 'um 29 só por lote');
  });
});

test('operação atualizar_receptores junta com o 29 do lote e recebe o resultado dele', async () => {
  await cenario({ sim: { tempos: { atraso29Ms: 5 } } }, async (c) => {
    c.nuvem.ops.push({ id: 1, tipo: 'cadastrar', frame_hex: hex(dispositivo(1)) });
    c.nuvem.ops.push({ id: 2, tipo: 'atualizar_receptores' });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 1, { rotulo: 'resultado do cadastro' });
    await c.relogio.avancar(30000);
    await esperarAte(() => c.nuvem.resultados.length === 2, { rotulo: 'resultado do 29' });
    assert.deepEqual(c.nuvem.resultados[1], { id: 2, ok: true, codigo: 0 });
    assert.equal(c.sim.comandosRecebidos(29).length, 1);
  });
});

test('mesma operação devolvida várias vezes pela nuvem (mesmo id) executa uma vez só', async () => {
  await cenario({}, async (c) => {
    c.nuvem.reentregar = true;
    c.nuvem.ops.push({ id: 55, tipo: 'cadastrar', frame_hex: hex(dispositivo(9)) });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length >= 1, { rotulo: '1º resultado' });
    for (let i = 0; i < 3; i++) {
      await c.relogio.avancar(5000);
      await esperarAte(() => c.nuvem.pedidos.filter((p) => p.metodo === 'GET').length >= 2 + i, { rotulo: 'novo GET' });
    }
    assert.equal(c.sim.comandosRecebidos(67).length, 1, 'o 67 saiu uma vez');
    assert.ok(c.nuvem.resultados.every((r) => r.id === 55 && r.ok === true && r.codigo === 0));
  });
});

test('operações executam na ordem devolvida, uma de cada vez', async () => {
  await cenario({}, async (c) => {
    c.nuvem.ops.push({ id: 3, tipo: 'cadastrar', frame_hex: hex(dispositivo(5)) });
    const esperado = { unidade: 5, bloco: 0 };
    c.nuvem.ops.push({ id: 4, tipo: 'editar', frame_hex: hex(dispositivo(5)), esperado });
    c.nuvem.ops.push({ id: 5, tipo: 'apagar', frame_hex: hex(dispositivo(5)), esperado });
    c.nuvem.ops.push({ id: 6, tipo: 'apagar', frame_hex: hex(dispositivo(5)), esperado });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 4, { rotulo: '4 resultados' });
    assert.deepEqual(c.nuvem.resultados.map((r) => [r.id, r.ok]), [[3, true], [4, true], [5, true], [6, true]]);
    // Apagar de novo: já não está no Guarita → objetivo atendido (I1).
    assert.deepEqual(c.nuvem.resultados[3], { id: 6, ok: true, ja_estava: true });
    // editar e apagar leem (opção 3) antes de escrever; o 2º apagar só lê.
    assert.deepEqual(c.sim.comandosRecebidos(67).map((f) => f[2]), [0, 3, 1, 3, 4, 3]);
  });
});

test('queda do Guarita no meio de um cadastrar → reconecta, confere e o resultado diz que não foi gravado', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.falhas.silencio(1);
    c.nuvem.ops.push({ id: 77, tipo: 'cadastrar', frame_hex: hex(dispositivo(2)) });
    await c.relogio.avancar(0); // 1º ciclo (o relógio não anda: o 67 fica esperando a resposta)
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
    c.sim.derrubarConexoes();
    await esperarAte(() => c.nuvem.estados.some((e) => e.conectado === false), { rotulo: 'estado desconectado' });
    assert.equal(c.nuvem.resultados.length, 0, 'não informa nada antes de conferir');
    assert.equal(c.sim.conexoesAceitas, 1);
    await c.relogio.avancar(1000); // espera inicial de 1 s
    await esperarAte(() => c.sim.conexoesAceitas === 2 && c.servico().conectado, { rotulo: 'reconexão' });
    await esperarAte(() => c.nuvem.resultados.length === 1, { rotulo: 'resultado' });
    assert.deepEqual(c.nuvem.resultados[0], { id: 77, ok: false, erro: 'O Guarita não respondeu e o dispositivo não foi gravado.' });
    assert.equal(c.sim.memoria.dispositivos.length, 0, 'nada foi gravado sem a confirmação');
  });
});

test('nuvem fora do ar: eventos ficam em fila em memória e são reenviados quando ela volta', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.nuvem.foraDoAr = true;
    for (let i = 0; i < 3; i++) c.sim.injetarEvento(evento(i));
    await esperarAte(() => c.servico().filaEventos.length === 3, { rotulo: 'fila com 3' });
    assert.equal(c.nuvem.eventos.length, 0);
    c.nuvem.foraDoAr = false;
    await c.relogio.avancar(5000);
    await esperarAte(() => c.nuvem.eventos.length === 3, { rotulo: 'reenvio' });
    assert.deepEqual(c.nuvem.eventos.map((e) => e.frame_hex), [0, 1, 2].map((i) => hex(evento(i))));
    assert.equal(c.servico().filaEventos.length, 0);
  });
});

test('fila de eventos tem teto: descarta os mais antigos com aviso (teto padrão 5.000)', async () => {
  assert.equal(PADROES.limiteFilaEventos, 5000);
  await cenario({ intervalos: { limiteFilaEventos: 10 } }, async (c) => {
    c.escutar();
    await c.pronto();
    c.nuvem.foraDoAr = true;
    for (let i = 0; i < 13; i++) c.sim.injetarEvento(evento(i));
    await esperarAte(() => c.logs.filter((l) => /descartado/.test(l)).length >= 1 && c.servico().filaEventos.length === 10, {
      rotulo: 'teto da fila',
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(
      c.servico().filaEventos.map((e) => e.frame_hex),
      Array.from({ length: 10 }, (_, i) => hex(evento(i + 3))),
    );
  });
});

test('API antiga (rotas 404): o driver não quebra, guarda os eventos e pergunta as operações de novo só depois de 60 s', async () => {
  await cenario({ sim: { eventos: [E1] } }, async (c) => {
    c.nuvem.semRotas = true;
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.pedidos.some((p) => p.metodo === 'GET'), { rotulo: '1º GET' });
    const gets = () => c.nuvem.pedidos.filter((p) => p.metodo === 'GET').length;
    for (let i = 0; i < 6; i++) await c.relogio.avancar(5000);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(gets(), 1, 'não martela a rota ausente');
    assert.equal(c.servico().conectado, true);
    assert.equal(c.servico().filaEventos.length, 1, 'evento recuperado guardado');
    assert.equal((await c.driver.testar(c.dev)).ok, true);
    assert.equal(c.logs.filter((l) => /API antiga/.test(l)).length, 1, 'avisa uma vez');
    c.nuvem.semRotas = false;
    for (let i = 0; i < 7; i++) await c.relogio.avancar(5000);
    await esperarAte(() => gets() >= 2 && c.nuvem.eventos.length === 1, { rotulo: 'volta da rota' });
  });
});

test('guarita_rele: escreve exatamente um frame do 13 (gera_evt = 1); payload inválido não escreve', async () => {
  await cenario({}, async (c) => {
    const semSessao = await c.driver.executar(c.dev, { type: 'guarita_rele', payload: { tipo_receptor: 1, num_receptor: 1, rele: 2 } });
    assert.equal(semSessao.ok, false);
    c.escutar();
    await c.pronto();
    const r = await c.driver.executar(c.dev, { id: 9, type: 'guarita_rele', payload: { tipo_receptor: 1, num_receptor: 1, rele: 2 } });
    assert.deepEqual(r, { ok: true });
    await esperarAte(() => c.sim.comandosRecebidos(13).length === 1, { rotulo: 'o 13' });
    assert.equal(hex(c.sim.comandosRecebidos(13)[0]), '000D0100020111');
    for (const payload of [{ tipo_receptor: 1, num_receptor: 1, rele: 7 }, { tipo_receptor: 9, num_receptor: 1, rele: 1 }, {}, null]) {
      const ruim = await c.driver.executar(c.dev, { type: 'guarita_rele', payload });
      assert.equal(ruim.ok, false);
    }
    const outro = await c.driver.executar(c.dev, { type: 'open_door' });
    assert.equal(outro.ok, false);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.comandosRecebidos(13).length, 1, 'um clique = um frame');
    assert.equal(c.sim.comandosRecebidos(92).length, 0);
    await esperarAte(() => c.nuvem.eventos.some((e) => e.frame_hex.startsWith('60')), { rotulo: 'evento tipo 6' });
  });
});

test('testar: responde pelo estado da sessão sem abrir conexão nova', async () => {
  await cenario({}, async (c) => {
    await assert.rejects(c.driver.testar(c.dev), (e) => classificarFalha(e) === 'sem_resposta');
    c.escutar();
    await c.pronto();
    for (let i = 0; i < 10; i++) assert.deepEqual(await c.driver.testar(c.dev), { ok: true });
    assert.deepEqual(await c.driver.executar(c.dev, { type: 'ping' }), { ok: true });
    assert.equal(c.sim.conexoesAceitas, 1);
  });
});

test('palavra recusada ("Negado"): estado autorizado:false, ping "credencial" e nova tentativa só depois de 60 s', async () => {
  await cenario({ sim: { palavra: 'certa' }, device: { api_password: 'errada' } }, async (c) => {
    c.escutar();
    await esperarAte(() => c.nuvem.estados.length >= 1, { rotulo: 'estado' });
    const estado = c.nuvem.estados.at(-1);
    assert.equal(estado.conectado, false);
    assert.equal(estado.autorizado, false);
    assert.equal(estado.erro, 'Palavra de autorização recusada pelo Guarita');
    assert.ok(!JSON.stringify(c.nuvem.estados).includes('errada'), 'a palavra nunca vai para a nuvem');
    assert.ok(!c.logs.join('\n').includes('errada'), 'a palavra nunca vai para o log');
    const ping = await c.driver.testar(c.dev);
    assert.equal(classificarFalha(ping), 'credencial');
    assert.equal(c.sim.conexoesAceitas, 1);
    await c.relogio.avancar(59999);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.conexoesAceitas, 1, 'não reconecta em laço rápido');
    await c.relogio.avancar(1);
    await esperarAte(() => c.sim.conexoesAceitas === 2, { rotulo: '2ª tentativa' });
  });
});

test('palavra certa: autoriza e opera normalmente', async () => {
  await cenario({ sim: { palavra: 'S3nh@' } }, async (c) => {
    c.escutar();
    await c.pronto();
    assert.deepEqual(c.sim.palavrasRecebidas.map((b) => b.toString('latin1')), ['S3nh@']);
    assert.equal(c.servico().autorizado, true);
  });
});

test('Guarita desligado: reconecta com espera crescente 1 s, 2 s, 4 s ...', async () => {
  await cenario({}, async (c) => {
    await c.sim.fechar(); // ninguém escutando na porta
    c.escutar();
    await esperarAte(() => c.servico().ultimoErroConexao, { rotulo: '1ª falha' });
    assert.equal(c.servico().backoffMs, 2000);
    await c.relogio.avancar(1000);
    await esperarAte(() => c.servico().backoffMs === 4000, { rotulo: '2ª falha' });
    await c.relogio.avancar(2000);
    await esperarAte(() => c.servico().backoffMs === 8000, { rotulo: '3ª falha' });
    const ping = await c.driver.testar(c.dev).catch((e) => e);
    assert.equal(classificarFalha(ping), 'recusado');
  });
});

test('estado vai a cada 60 s mesmo sem mudança', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    await esperarAte(() => c.nuvem.estados.length >= 1, { rotulo: 'estado inicial' });
    const antes = c.nuvem.estados.length;
    await c.relogio.avancar(60000);
    await esperarAte(() => c.nuvem.estados.length === antes + 1, { rotulo: 'estado periódico' });
  });
});

test('parar(): fecha o socket e não reconecta mais', async () => {
  await cenario({}, async (c) => {
    const parar = c.escutar();
    await c.pronto();
    parar();
    await esperarAte(() => c.sim.clientesConectados() === 0, { rotulo: 'socket fechado' });
    await c.relogio.avancar(120000);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.conexoesAceitas, 1);
    assert.equal(c.driver._servicos.size, 0);
  });
});

test('nuvem recusou definitivamente um lote (400): descarta e segue, sem travar a fila', async () => {
  // Contrato mínimo de _nuvem: 4xx definitivo não volta para a fila.
  const relogio = criarRelogioFalso();
  const chamadas = [];
  const driver = criarDriverGuarita({
    requisitarNuvem: async (m, caminho, corpo) => {
      chamadas.push([m, caminho, corpo]);
      return { status: 400, data: {} };
    },
    agora: relogio.agora,
    temporizador: relogio,
    log: { log() {}, error() {} },
  });
  const sim = criarGuaritaSimulado({});
  const { porta } = await sim.escutar();
  const parar = driver.escutar({ id: 1, nome: 'G', tipo: 'guarita', ip: '127.0.0.1', porta }, () => {});
  try {
    await esperarAte(() => driver._servicos.get(1).conectado && driver._servicos.get(1).timers.ciclo, { rotulo: 'pronto' });
    sim.injetarEvento(E1);
    await esperarAte(() => chamadas.some(([, c]) => c === '/guarita/1/eventos'), { rotulo: 'POST eventos' });
    await esperarAte(() => driver._servicos.get(1).filaEventos.length === 0, { rotulo: 'fila vazia' });
  } finally {
    parar();
    await sim.fechar();
  }
});

// ---------- unidades puras ----------

test('naoCadastradoDe / partesDaImportacao', () => {
  assert.equal(naoCadastradoDe(42, Buffer.alloc(3), 'x'), null);
  assert.deepEqual(partesDaImportacao(['A', 'B', 'C'], 2), [
    { ok: true, frames_hex: ['A', 'B'], parte: 1, fim: false },
    { ok: true, frames_hex: ['C'], parte: 2, fim: true },
  ]);
});

test('despacho: guarita_rele vale 10 s na fila, e nem o ttl da nuvem passa disso', () => {
  assert.equal(prazoDoComando({ type: 'guarita_rele' }), 10000);
  assert.equal(prazoDoComando({ type: 'guarita_rele', ttl_ms: 22000 }), 10000);
  assert.equal(prazoDoComando({ type: 'guarita_rele', ttl_ms: 4000 }), 4000);
  // os outros tipos não mudaram
  assert.equal(prazoDoComando({ type: 'open_door', ttl_ms: 22000 }), 10000);
  assert.equal(prazoDoComando({ type: 'enroll' }), 20000);
  assert.equal(prazoDoComando({ type: 'enroll', ttl_ms: 22000 }), 22000);
  assert.equal(prazoDoComando({ type: 'desconhecido' }), 10000);
});

test('registro: tipo guarita usa linear-guarita (comandos e ouvinte), mas não é ouvinte facial', () => {
  const registro = require('../src/drivers/registro');
  const guarita = require('../src/drivers/linear-guarita');
  for (const fabricante of ['linear', 'Linear', 'nice', 'Linear-HCS', undefined, 'intelbras']) {
    const d = { tipo: 'guarita', fabricante };
    assert.equal(registro.resolverDriver(d), guarita, String(fabricante));
    assert.equal(registro.resolverOuvinte(d), guarita, String(fabricante));
    assert.equal(registro.resolverDriverDeEventos(d), null, 'sem replay/marca/relógio facial');
    assert.equal(registro.replayEmTodaReconexao(d), false);
  }
  assert.equal(guarita.id, 'linear-guarita');
  for (const f of ['testar', 'executar', 'escutar', 'configurar']) assert.equal(typeof guarita[f], 'function');
  assert.equal(guarita.buscarDesde, undefined);
  assert.equal(guarita.acertarRelogio, undefined);
});

test('registro: devices de outros tipos/fabricantes escolhem EXATAMENTE os drivers de antes', () => {
  const registro = require('../src/drivers/registro');
  const dahua = require('../src/drivers/dahua-facial');
  const hik = require('../src/drivers/hikvision-facial');
  const cid = require('../src/drivers/controlid-facial');
  // Regra de antes desta mudança, escrita aqui à parte (aliases da família
  // e "comandos por família, ouvinte só facial").
  const familiaAntiga = {
    intelbras: dahua, dahua, hikvision: hik, hik, control_id: cid, controlid: cid, 'control id': cid, 'control-id': cid,
  };
  const norm = (f) => (typeof f === 'string' ? f.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ') : '');
  const antigoComando = (d) =>
    d && d.fabricante && Object.prototype.hasOwnProperty.call(familiaAntiga, norm(d.fabricante)) ? familiaAntiga[norm(d.fabricante)] : null;
  const antigoOuvinte = (d) => (d && (d.tipo || 'facial') === 'facial' ? antigoComando(d) : null);
  const tipos = ['facial', 'botoeira', 'catraca', 'tag_reader', 'qrcode_reader', 'lpr', undefined, 'Guarita', 'guarita ', 'outro'];
  const fabricantes = ['intelbras', 'Intelbras', 'dahua', 'hikvision', 'HIK', 'control_id', 'Control iD', 'zkteco', 'topdata',
    'henry', 'generico', 'linear', 'Linear', 'nice', 'NICE', 'linear-hcs', '', undefined, 'toString', '__proto__'];
  let casos = 0;
  for (const tipo of tipos) {
    for (const fabricante of fabricantes) {
      const d = { tipo, fabricante };
      assert.equal(registro.resolverDriver(d), antigoComando(d), `comando ${tipo}/${fabricante}`);
      assert.equal(registro.resolverDriverDeEventos(d), antigoOuvinte(d), `eventos ${tipo}/${fabricante}`);
      assert.equal(registro.resolverOuvinte(d), antigoOuvinte(d), `ouvinte ${tipo}/${fabricante}`);
      casos++;
    }
  }
  assert.equal(casos, tipos.length * fabricantes.length);
  assert.equal(registro.resolverDriver(null), null);
  assert.equal(registro.resolverOuvinte(null), null);
});

test('fabricante: grafias de Nice/Linear normalizam para a família linear', () => {
  const { familiaDoFabricante } = require('../src/lib/fabricante');
  for (const f of ['linear', 'Linear', ' LINEAR ', 'linear-hcs', 'Linear HCS', 'nice', 'Nice']) {
    assert.equal(familiaDoFabricante(f), 'linear', f);
  }
  assert.equal(familiaDoFabricante('intelbras'), 'dahua');
});

test('index.js: Supervisor assina por resolverOuvinte e o driver do Guarita recebe a nuvem pelo token do condomínio', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(fonte, /const linearGuarita = require\('\.\/drivers\/linear-guarita'\);/);
  assert.match(fonte, /resolverDriver: resolverOuvinte,/);
  assert.match(
    fonte,
    /linearGuarita\.configurar\(\{\s*requisitarNuvem: \(metodo, caminho, corpo\) =>\s*cloudRequest\(metodo, `\/api\/facial\/agent\/condo\/\$\{token\}\$\{caminho\}`, corpo\),\s*agora: \(\) => agoraDaNuvem\(\)\.getTime\(\),\s*\}\);/,
  );
  // O replay/relógio/marca d'água facial continuam pelo resolverDriverDeEventos.
  assert.match(fonte, /const driver = resolverDriverDeEventos\(device\);\s*if \(!driver \|\| !driver\.buscarDesde\) return;/);
});

test('testar durante a conexão espera o desfecho (o 1º ping não dá "offline" à toa)', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    const ping = await c.driver.testar(c.dev);
    assert.deepEqual(ping, { ok: true });
    assert.equal(c.sim.conexoesAceitas, 1);
  });
});

test('C1 (driver): A calado → falhou e a sessão cai; B só roda numa sessão NOVA e recebe a resposta dele (memória cheia)', async () => {
  await cenario({ sim: { capacidade: 1 } }, async (c) => {
    c.nuvem.reentregar = true;
    c.escutar();
    await c.pronto();
    c.sim.falhas.atrasarResposta(200); // A é gravado, mas a resposta demora
    c.nuvem.ops.push({ id: 1, tipo: 'cadastrar', frame_hex: hex(dispositivo(1)) });
    c.nuvem.ops.push({ id: 2, tipo: 'cadastrar', frame_hex: hex(dispositivo(2)) });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67 de A' });
    await c.relogio.avancar(5000);
    await esperarAte(() => !c.servico().conectado, { rotulo: 'A caiu' });
    await new Promise((r) => setTimeout(r, 300)); // a resposta atrasada de A não acha ninguém
    assert.equal(c.sim.comandosRecebidos(67).length, 1, 'B não saiu na sessão suspeita');
    assert.equal(c.nuvem.resultados.length, 0, 'A ainda não foi informado: falta conferir');
    await c.relogio.avancar(1000); // reconexão
    await c.pronto();
    assert.equal(c.sim.conexoesAceitas, 2);
    // A foi gravado de fato: a conferência pelo Ler na sessão nova confirma.
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 1), { rotulo: 'resultado de A' });
    assert.deepEqual(c.nuvem.resultados.find((r) => r.id === 1), {
      id: 1,
      ok: true,
      ja_estava: true,
      lido: { unidade: 1, bloco: 0, frame_hex: hex(dispositivo(1)) },
    });
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 2), { rotulo: 'resultado de B' });
    const rB = c.nuvem.resultados.filter((r) => r.id === 2);
    assert.ok(rB.every((r) => r.ok === false), JSON.stringify(rB));
    assert.equal(rB[0].codigo, 1);
    assert.equal(rB[0].erro, 'Memória do Guarita cheia.');
  });
});

test('C2 (driver): palavra do cadastro que formaria o comando 77 → não conecta, nenhum byte sai e o estado diz o motivo sem repetir a palavra', async () => {
  await cenario({ device: { api_password: '\u0000MU\u00AAL' } }, async (c) => {
    c.escutar();
    await esperarAte(() => c.nuvem.estados.length >= 1, { rotulo: 'estado' });
    const estado = c.nuvem.estados.at(-1);
    assert.equal(estado.conectado, false);
    assert.equal(estado.autorizado, false);
    assert.equal(estado.erro, 'Palavra de autorização inválida no cadastro');
    assert.ok(!JSON.stringify(c.nuvem.estados).includes('MU'));
    assert.equal(c.sim.conexoesAceitas, 0, 'nem abriu a conexão');
    assert.equal(c.sim.recebidos.length + c.sim.lixoRecebido.length, 0);
    assert.equal(classificarFalha(await c.driver.testar(c.dev)), 'credencial');
    await c.relogio.avancar(59999);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.sim.conexoesAceitas, 0);
  });
});

test('I1: operação já concluída não é reexecutada depois de o agente reiniciar (persistida); o resultado pendente sai na volta', async () => {
  const { criarArmazemEmMemoria } = require('../src/drivers/linear-guarita');
  const armazem = criarArmazemEmMemoria();
  await cenario({ armazem }, async (c) => {
    c.nuvem.reentregar = true;
    c.nuvem.falharResultados = true; // o resultado não chega à nuvem antes do reinício
    c.nuvem.ops.push({ id: 10, tipo: 'cadastrar', frame_hex: hex(dispositivo(4)) });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
    await esperarAte(() => (armazem.ler()['42'] || []).length === 1, { rotulo: 'persistido' });
    assert.deepEqual(armazem.ler()['42'], [{ id: 10, corpo: { ok: true, codigo: 0 }, enviado: false }]);
    c.reiniciarAgente();
    c.nuvem.falharResultados = false;
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 10), { rotulo: 'resultado depois do reinício' });
    await c.relogio.avancar(5000);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.comandosRecebidos(67).length, 1, 'não reexecutou');
    assert.ok(c.nuvem.resultados.every((r) => r.id === 10 && r.ok === true && r.codigo === 0));
    await esperarAte(() => armazem.ler()['42'][0].enviado === true, { rotulo: 'marcado como enviado' });
  });
});

test('I1: sem o registro (armazém perdido), o cadastrar repetido responde 0x02 e vira ok com ja_estava, não "falhou"', async () => {
  const d = dispositivo(4);
  await cenario({ sim: { dispositivos: [d] } }, async (c) => {
    c.nuvem.ops.push({ id: 11, tipo: 'cadastrar', frame_hex: hex(d) });
    c.nuvem.ops.push({ id: 12, tipo: 'apagar', frame_hex: hex(dispositivo(77)), esperado: { unidade: 77, bloco: 0 } });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 2, { rotulo: 'resultados' });
    assert.deepEqual(c.nuvem.resultados, [
      { id: 11, ok: true, codigo: 2, ja_estava: true, lido: { unidade: 4, bloco: 0, frame_hex: hex(d) } },
      { id: 12, ok: true, ja_estava: true },
    ]);
    assert.equal(c.sim.memoria.dispositivos.length, 1);
  });
});

test('I1: armazém em arquivo grava/relê atômico e guarda no máximo 500 operações por Guarita', async () => {
  const os = require('node:os');
  const { criarArmazemEmArquivo, criarDriverGuarita: criar } = require('../src/drivers/linear-guarita');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guarita-'));
  const arq = path.join(dir, 'guarita-operacoes.json');
  try {
    const armazem = criarArmazemEmArquivo(arq);
    assert.deepEqual(armazem.ler(), {});
    const lista = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, corpo: { ok: true, codigo: 0 }, enviado: true }));
    armazem.gravar({ 5: lista });
    assert.equal(fs.existsSync(`${arq}.tmp`), false);
    // Um serviço carrega e regrava: corta para os 500 mais recentes.
    const driver = criar({ armazem, log: { log() {}, error() {} }, requisitarNuvem: async () => ({ status: 200, data: {} }) });
    const parar = driver.escutar({ id: 5, nome: 'G', tipo: 'guarita', ip: '127.0.0.1', porta: 1 }, () => {});
    const servico = driver._servicos.get(5);
    assert.equal(servico.executadas.size, 600);
    servico._persistirConcluidas();
    parar();
    const relido = criarArmazemEmArquivo(arq).ler()['5'];
    assert.equal(relido.length, 500);
    assert.equal(relido[0].id, 101);
    fs.writeFileSync(arq, '{corrompido');
    assert.deepEqual(criarArmazemEmArquivo(arq).ler(), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('I2 (driver): guarita_rele durante importação de 2.000 dispositivos sai em < 2 s simulados; a importação termina completa', async () => {
  const lista = Array.from({ length: 2000 }, (_, i) => dispositivo(i + 1, [1, 2, 3, 6][i % 4]));
  await cenario({ sim: { dispositivos: lista } }, async (c) => {
    c.escutar();
    await c.pronto();
    c.nuvem.ops.push({ id: 30, tipo: 'importar' });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.continuacoes.length >= 50, { rotulo: 'importação andando' });
    const inicio = c.relogio.agora();
    let resultado = null;
    const rele = c.driver
      .executar(c.dev, { type: 'guarita_rele', payload: { tipo_receptor: 1, num_receptor: 1, rele: 1 } })
      .then((r) => (resultado = r));
    while (!resultado && c.relogio.agora() - inicio < 2000) {
      await c.relogio.avancar(50);
      await new Promise((r) => setTimeout(r, 2));
    }
    await rele;
    assert.deepEqual(resultado, { ok: true });
    assert.ok(c.relogio.agora() - inicio < 2000, `${c.relogio.agora() - inicio} ms simulados`);
    await esperarAte(() => c.nuvem.resultados.filter((r) => r.id === 30).length === 4, { rotulo: 'importação', limiteMs: 15000 });
    const partes = c.nuvem.resultados.filter((r) => r.id === 30);
    assert.deepEqual(partes.flatMap((p) => p.frames_hex), lista.map(hex));
    assert.equal(partes.at(-1).fim, true);
    assert.equal(c.sim.comandosRecebidos(13).length, 1);
  });
});

test('I2 (driver): guarita_rele durante o 29 espera 10 s e devolve "O Guarita está atualizando os receptores. Tente de novo em instantes."', async () => {
  await cenario({ sim: { tempos: { atraso29Ms: 5 } } }, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.falhas.silencio(1); // o 29 fica respondendo "nunca" (até 180 s)
    c.nuvem.ops.push({ id: 40, tipo: 'atualizar_receptores' });
    await c.relogio.avancar(0);
    await esperarAte(() => c.servico().ops29.length === 1 || c.sim.comandosRecebidos(29).length === 1, { rotulo: 'operação recebida' });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(29).length === 1, { rotulo: 'o 29' });
    const p = c.driver.executar(c.dev, { type: 'guarita_rele', payload: { tipo_receptor: 1, num_receptor: 1, rele: 1 } });
    await c.relogio.avancar(10000);
    assert.deepEqual(await p, { ok: false, error: 'O Guarita está atualizando os receptores. Tente de novo em instantes.' });
    assert.equal(c.sim.comandosRecebidos(13).length, 0, 'o 13 nunca sai no meio do 29');
  });
});

test('I2 (driver): memória de eventos relida só na 1ª conexão e depois de queda > 60 s; queda curta só registra o tempo fora', async () => {
  await cenario({ sim: { eventos: [E1, E2] } }, async (c) => {
    c.escutar();
    await c.pronto();
    assert.equal(c.sim.comandosRecebidos(17).length, 1, '1ª conexão: relê');
    // queda curta
    c.sim.derrubarConexoes();
    await esperarAte(() => !c.servico().conectado, { rotulo: 'caiu' });
    await c.relogio.avancar(1000);
    await c.pronto();
    assert.equal(c.sim.comandosRecebidos(17).length, 1, 'queda curta: não relê');
    assert.ok(c.logs.some((l) => /ficou 1 s sem conexão/.test(l)), c.logs.join('\n'));
    // queda longa (o relógio "andou" 61 s fora do ar)
    c.sim.derrubarConexoes();
    await esperarAte(() => !c.servico().conectado, { rotulo: 'caiu de novo' });
    c.driver._servicos.get(42).cfg.memoriaProcesso.get(42).foraDesde -= 61000;
    await c.relogio.avancar(1000);
    await c.pronto();
    assert.equal(c.sim.comandosRecebidos(17).length, 2, 'queda longa: relê');
  });
});

test('I2 (driver): recriar o ouvinte no mesmo processo não relê a memória (não é a 1ª conexão)', async () => {
  await cenario({ sim: { eventos: [E1] } }, async (c) => {
    const parar = c.escutar();
    await c.pronto();
    parar();
    c.escutar();
    await c.pronto();
    assert.equal(c.sim.comandosRecebidos(17).length, 1);
  });
});

test('Menor 2: Guarita pede palavra e o cadastro não tem nenhuma → autorizado:false e nova tentativa só em 60 s', async () => {
  await cenario({ sim: { palavra: 'exigida', tempos: { autorizacaoMs: 30 } }, device: { api_password: null } }, async (c) => {
    c.escutar();
    await esperarAte(() => c.nuvem.estados.some((e) => e.conectado === false && e.autorizado === false), { rotulo: 'estado negado', limiteMs: 4000 });
    assert.match(c.nuvem.estados.at(-1).erro, /pede palavra de autorização/);
    const tentativas = c.sim.conexoesAceitas;
    await c.relogio.avancar(59000);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(c.sim.conexoesAceitas, tentativas, 'sem reconexão em laço rápido');
  });
});

test('Menor 4: o relé só espera a vez pelo que sobra da validade do comando (_restanteMs do despacho)', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.falhas.silencio(1);
    c.nuvem.ops.push({ id: 41, tipo: 'atualizar_receptores' });
    await c.relogio.avancar(0);
    await esperarAte(() => c.servico().ops29.length === 1 || c.sim.comandosRecebidos(29).length === 1, { rotulo: 'op' });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(29).length === 1, { rotulo: 'o 29' });
    let r = null;
    const p = c.driver
      .executar(c.dev, { type: 'guarita_rele', _restanteMs: 1500, payload: { tipo_receptor: 1, num_receptor: 1, rele: 1 } })
      .then((x) => (r = x));
    await c.relogio.avancar(1500);
    await p;
    assert.equal(r.ok, false);
    assert.match(r.error, /atualizando os receptores/);
  });
});

test('Menor 4 (despacho): o comando de relé chega ao driver com o que sobra da validade', async () => {
  const { criarDespachante } = require('../src/core/despacho');
  let agora = 0;
  const vistos = [];
  const d = criarDespachante({
    executar: async (device, cmd) => {
      vistos.push(cmd._restanteMs);
      agora += 3000; // cada execução leva 3 s
      return { ok: true };
    },
    postarResultado: async () => {},
    log: { log() {}, error() {} },
    agora: () => agora,
  });
  await d.despachar([{ device: { id: 1, nome: 'G' }, commands: [{ id: 'a', type: 'guarita_rele' }, { id: 'b', type: 'guarita_rele' }, { id: 'c', type: 'open_door' }] }]);
  assert.deepEqual(vistos, [10000, 7000, undefined]);
});

test('Menor 5: depois de entregue, a importação não fica guardada em memória (reentrega relê, é só leitura)', async () => {
  await cenario({ sim: { dispositivos: [dispositivo(1), dispositivo(2)] } }, async (c) => {
    c.nuvem.ops.push({ id: 50, tipo: 'importar' });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 50 && r.fim), { rotulo: 'importação' });
    await esperarAte(() => !c.servico().executadas.has(50), { rotulo: 'liberada' });
  });
});

test('item 7: o agente declara a capacidade guarita no poll (query capacidades=guarita) e na telemetria', () => {
  const { CAPACIDADES, QUERY_CAPACIDADES, urlComCapacidades } = require('../src/core/capacidades');
  assert.deepEqual([...CAPACIDADES], ['guarita']);
  assert.equal(QUERY_CAPACIDADES, 'capacidades=guarita');
  assert.equal(urlComCapacidades('/api/facial/agent/condo/T/poll'), '/api/facial/agent/condo/T/poll?capacidades=guarita');
  assert.equal(urlComCapacidades('/x?a=1'), '/x?a=1&capacidades=guarita');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(fonte, /cloudRequest\('GET', urlComCapacidades\(`\/api\/facial\/agent\/condo\/\$\{token\}\/poll`\)\)/);
  assert.ok(!/cloudRequest\('GET', `\/api\/facial\/agent\/condo\/\$\{token\}\/poll`\)/.test(fonte), 'sobrou poll sem capacidades');
  const telemetria = require('../src/core/telemetria');
  const payload = telemetria.montarPayload({
    supervisor: { saudeTodos: () => [] },
    pendentes: () => 0,
    iniciadoEm: 'x',
  });
  assert.deepEqual(payload.capacidades, ['guarita']);
});

test('item 7: device tipo guarita nunca cai no REST genérico/ping HTTP — qualquer fabricante; modo legado o ignora com aviso', () => {
  const registro = require('../src/drivers/registro');
  const guarita = require('../src/drivers/linear-guarita');
  for (const fabricante of [undefined, null, '', 'zkteco', 'topdata', 'henry', 'generico', 'hikvision', 'control_id', 'toString', 42]) {
    assert.equal(registro.resolverDriver({ tipo: 'guarita', fabricante }), guarita, String(fabricante));
  }
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  // executeOnDevice: o Guarita é resolvido ANTES da lista SEM_COMANDO_HTTP e do REST genérico.
  const exec = fonte.slice(fonte.indexOf('async function executeOnDevice'), fonte.indexOf('function falhaDeComando'));
  assert.ok(exec.indexOf("device.tipo === TIPO_GUARITA") > 0 && exec.indexOf("device.tipo === TIPO_GUARITA") < exec.indexOf('SEM_COMANDO_HTTP'));
  const ping = fonte.slice(fonte.indexOf('async function doPing'), fonte.indexOf('async function doOpenDoor'));
  assert.ok(ping.indexOf('TIPO_GUARITA') > 0 && ping.indexOf('TIPO_GUARITA') < ping.indexOf("lanRequest(device, 'GET', '/status')"));
  // Modo legado (token por aparelho, sem Supervisor): ignora o Guarita com aviso.
  const legado = fonte.slice(fonte.indexOf('async function runDeviceLoop'), fonte.indexOf('// ---------- Tradução comando lógico'));
  assert.match(legado, /body\.device && body\.device\.tipo === TIPO_GUARITA/);
  assert.match(legado, /não é suportado no modo legado/);
  const iGuarita = legado.indexOf('body.device.tipo === TIPO_GUARITA');
  assert.ok(iGuarita < legado.indexOf('despachante.despachar('), 'o aviso vem antes de despachar');
});

test('item 1 (driver): resultado de conflito e de operação sem esperado no formato do contrato', async () => {
  const outro = dispositivo(6);
  await cenario({ sim: { dispositivos: [outro] } }, async (c) => {
    c.nuvem.ops.push({ id: 60, tipo: 'apagar', frame_hex: hex(outro), esperado: { unidade: 5, bloco: 0 } });
    c.nuvem.ops.push({ id: 61, tipo: 'editar', frame_hex: hex(outro) });
    c.escutar();
    await c.pronto();
    await c.relogio.avancar(0);
    await esperarAte(() => c.nuvem.resultados.length === 2, { rotulo: 'resultados' });
    assert.deepEqual(c.nuvem.resultados, [
      { id: 60, ok: false, erro: 'Este dispositivo está cadastrado no Guarita em outra unidade.', conflito: true, lido: { unidade: 6, bloco: 0, frame_hex: hex(outro) } },
      { id: 61, ok: false, erro: 'Operação sem unidade esperada.' },
    ]);
    assert.equal(c.sim.memoria.dispositivos.length, 1);
    assert.deepEqual(c.sim.comandosRecebidos(67).map((f) => f[2]), [3], 'só o Ler do 60');
  });
});

// ---------- revisão final, I2 ----------

test('final I2 (driver): cadastrar gravado mas resposta perdida → reconecta, confere pelo Ler e devolve ok + ja_estava + lido', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.falhas.atrasarResposta(300); // grava, mas a resposta passa dos 5 s
    c.nuvem.ops.push({ id: 70, tipo: 'cadastrar', frame_hex: hex(dispositivo(3)) });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
    await c.relogio.avancar(5000); // sem resposta: a sessão cai
    await esperarAte(() => !c.servico().conectado, { rotulo: 'caiu' });
    await new Promise((r) => setTimeout(r, 350)); // a resposta atrasada morre com a conexão velha
    await c.relogio.avancar(1000); // reconexão
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 70), { rotulo: 'resultado' });
    assert.deepEqual(c.nuvem.resultados.find((r) => r.id === 70), {
      id: 70,
      ok: true,
      ja_estava: true,
      lido: { unidade: 3, bloco: 0, frame_hex: hex(dispositivo(3)) },
    });
    assert.deepEqual(c.sim.comandosRecebidos(67).map((f) => f[2]), [0, 3], 'escrita, depois o Ler na sessão nova');
  });
});

test('final I2 (driver): cadastrar que o Guarita nem viu → reconecta, confere e devolve "não foi gravado"', async () => {
  await cenario({}, async (c) => {
    c.escutar();
    await c.pronto();
    c.sim.falhas.silencio(1);
    c.nuvem.ops.push({ id: 71, tipo: 'cadastrar', frame_hex: hex(dispositivo(3)) });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
    await c.relogio.avancar(5000);
    await esperarAte(() => !c.servico().conectado, { rotulo: 'caiu' });
    await c.relogio.avancar(1000);
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 71), { rotulo: 'resultado' });
    assert.deepEqual(c.nuvem.resultados.find((r) => r.id === 71), {
      id: 71,
      ok: false,
      erro: 'O Guarita não respondeu e o dispositivo não foi gravado.',
    });
  });
});

test('final I2 (driver): apagar escrito sem resposta e o Guarita some → em 30 s sem reconectar: incerto', async () => {
  await cenario({ sim: { dispositivos: [dispositivo(3)] } }, async (c) => {
    c.escutar();
    await c.pronto();
    // O Ler responde; o apagar (67 opção 4) fica sem resposta.
    let n67 = 0;
    c.nuvem.ops.push({ id: 72, tipo: 'apagar', frame_hex: hex(dispositivo(3)), esperado: { unidade: 3, bloco: 0 } });
    c.sim.falhas.silencioEm({ comando: 67, opcao: 4 });
    await c.relogio.avancar(0);
    await esperarAte(() => c.sim.comandosRecebidos(67).length === 2, { rotulo: 'Ler + apagar' });
    n67 = c.sim.comandosRecebidos(67).length;
    await c.sim.fechar(); // e o Guarita some da rede
    await c.relogio.avancar(5000);
    await esperarAte(() => !c.servico().conectado, { rotulo: 'caiu' });
    for (let i = 0; i < 8 && !c.nuvem.resultados.some((r) => r.id === 72); i++) {
      await c.relogio.avancar(5000);
      await new Promise((r) => setTimeout(r, 20));
    }
    await esperarAte(() => c.nuvem.resultados.some((r) => r.id === 72), { rotulo: 'resultado' });
    assert.equal(n67, 2);
    assert.deepEqual(c.nuvem.resultados.find((r) => r.id === 72), {
      id: 72,
      ok: false,
      incerto: true,
      erro: 'Não foi possível confirmar no Guarita.',
    });
  });
});
