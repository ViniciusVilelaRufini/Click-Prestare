'use strict';

/**
 * agent/src/drivers/linear/sessao.js — sessão TCP com o Guarita sobre um
 * socket FALSO e relógio falso (nada de dormir 5 s de verdade).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessaoGuarita, MSG_NEGADO } = require('../src/drivers/linear/sessao');
const { criarRelogioFalso, SocketFalso, girar, logMudo } = require('./linear-auxiliares');

const h = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
function comCs(hexSemCs) {
  const b = h(hexSemCs);
  let s = 0;
  for (const x of b) s = (s + x) % 256;
  return Buffer.concat([b, Buffer.from([s])]);
}
const EVT = '01A2B3C4 143005 151126 10 0308 01 10 00';
const F4 = comCs(`00 04 07 ${EVT}`);
const DISP = '11A2B3C4 1234 0308 01 00 FF' + '4D41524941' + '20'.repeat(13) + '00 06 0A' + '41424331443233';
const F70 = comCs(`00 46 ${DISP}`);

function montarSessao({ palavra } = {}) {
  const relogio = criarRelogioFalso();
  const sock = new SocketFalso();
  const sessao = new SessaoGuarita({
    ip: '10.0.0.5',
    porta: 9000,
    palavra,
    abrirSocket: () => sock,
    temporizador: relogio,
    logger: logMudo,
  });
  return { relogio, sock, sessao };
}

async function conectada(opts) {
  const ctx = montarSessao(opts);
  const p = ctx.sessao.conectar();
  ctx.sock.emit('connect');
  await girar();
  if (opts && opts.palavra) ctx.sock.receber(Buffer.from('Autorizado\0', 'latin1'));
  await p;
  ctx.sock.escritos.length = 0;
  return ctx;
}

test('autorização: envia a palavra sem terminador e aceita "Autorizado\\0" (fragmentado), sobra vira frame', async () => {
  const { sock, sessao } = montarSessao({ palavra: 'Senha123' });
  const espontaneos = [];
  sessao.on('espontaneo', (e) => espontaneos.push(e));
  const p = sessao.conectar();
  sock.emit('connect');
  await girar();
  assert.deepEqual(sock.escritosHex(), [Buffer.from('Senha123', 'latin1').toString('hex').toUpperCase()]);
  sock.receber(Buffer.from('Autor', 'latin1'));
  sock.receber(Buffer.concat([Buffer.from('izado\0', 'latin1'), F4.subarray(0, 5)]));
  await p;
  assert.equal(sessao.conectado, true);
  sock.receber(F4.subarray(5));
  assert.equal(espontaneos.length, 1);
  assert.equal(espontaneos[0].comando, 0x04);
});

test('autorização: "Negado\\0" rejeita com mensagem clara e marca espera mínima de 60 s', async () => {
  const { sock, sessao, relogio } = montarSessao({ palavra: 'errada' });
  const p = sessao.conectar();
  sock.emit('connect');
  await girar();
  sock.receber(Buffer.from('Negado\0', 'latin1'));
  await assert.rejects(p, (e) => {
    assert.equal(e.message, MSG_NEGADO);
    assert.equal(e.message, 'Palavra de autorização recusada pelo Guarita');
    assert.equal(e.codigo, 'negado');
    assert.equal(e.esperaMinimaMs, 60000);
    return true;
  });
  assert.equal(sessao.esperaMinimaAte, relogio.agora() + 60000);
  assert.equal(sessao.conectado, false);
});

test('autorização: sem resposta em 5 s → erro de timeout', async () => {
  const { sock, sessao, relogio } = montarSessao({ palavra: 'x' });
  const p = sessao.conectar();
  sock.emit('connect');
  await girar();
  const erro = assert.rejects(p, /não respondeu à palavra/);
  await relogio.avancar(5000);
  await erro;
});

test('sem palavra: conecta sem enviar nada', async () => {
  const { sock, sessao } = montarSessao();
  const p = sessao.conectar();
  sock.emit('connect');
  await p;
  await girar();
  assert.equal(sock.escritos.length, 0);
  assert.equal(sessao.conectado, true);
});

test('conectar: sem "connect" em 5 s → ETIMEDOUT', async () => {
  const { sessao, relogio } = montarSessao();
  const p = sessao.conectar();
  const erro = assert.rejects(p, (e) => e.code === 'ETIMEDOUT');
  await relogio.avancar(5000);
  await erro;
});

test('comando: devolve os dados da resposta; espontâneo no meio é entregue à parte', async () => {
  const { sock, sessao } = await conectada();
  const espontaneos = [];
  sessao.on('espontaneo', (e) => espontaneos.push(e));
  const p = sessao.comando(7);
  await girar();
  assert.deepEqual(sock.escritosHex(), ['000707']);
  sock.receber(Buffer.concat([F4, h('00 07 00 02 09')]));
  const dados = await p;
  assert.equal(dados.toString('hex'), '0002');
  assert.equal(espontaneos.length, 1);
});

test('comando: checksum errado na resposta → descartado, timeout de 5 s e a sessão é derrubada', async () => {
  const { sock, sessao, relogio } = await conectada();
  const lixos = [];
  const quedas = [];
  sessao.on('lixo', (l) => lixos.push(l));
  sessao.on('queda', (e) => quedas.push(e));
  const p = sessao.comando(7);
  await girar();
  sock.receber(h('00 07 00 02 0A'));
  const erro = assert.rejects(p, /O Guarita não respondeu\./);
  await relogio.avancar(4999);
  assert.equal(lixos.length, 1);
  await relogio.avancar(1);
  await erro;
  assert.equal(quedas.length, 1);
  assert.equal(sock.destroyed, true);
});

test('dois comando() simultâneos saem em ordem, um só depois da resposta do outro', async () => {
  const { sock, sessao } = await conectada();
  const p1 = sessao.comando(7);
  const p2 = sessao.comando(12);
  await girar();
  assert.deepEqual(sock.escritosHex(), ['000707']);
  sock.receber(h('00 07 00 02 09'));
  await p1;
  await girar();
  assert.deepEqual(sock.escritosHex(), ['000707', '000C0C']);
  sock.receber(h('00 0C 15 11 26 14 30 05 A1'));
  assert.equal((await p2).toString('hex'), '151126143005');
});

test('semResposta (13): resolve logo após a escrita, com o frame exato', async () => {
  const { sock, sessao } = await conectada();
  const dados = await sessao.comando(13, [0x03, 0x00, 0x02, 0x01], { semResposta: true });
  assert.equal(dados.length, 0);
  assert.deepEqual(sock.escritosHex(), ['000D0300020113']);
});

test('lerProgressivo: manda exatamente N-1 bytes 00 e depois 00 2B 2B; evento no meio não atrapalha', async () => {
  const { sock, sessao } = await conectada();
  const espontaneos = [];
  sessao.on('espontaneo', (e) => espontaneos.push(e));
  const lidos = [];
  const leitura = (async () => {
    for await (const dados of sessao.lerProgressivo(70, [], 3)) lidos.push(dados);
  })();
  await girar();
  assert.deepEqual(sock.escritosHex(), ['004646']);
  sock.receber(F70);
  await girar();
  sock.receber(Buffer.concat([F4, F70.subarray(0, 10)]));
  await girar();
  sock.receber(F70.subarray(10));
  await girar();
  sock.receber(F70);
  await leitura;
  assert.equal(lidos.length, 3);
  assert.equal(espontaneos.length, 1);
  assert.deepEqual(sock.escritosHex(), ['004646', '00', '00', '002B2B']);
});

test('lerProgressivo: frame que não chega em 5 s → erro e a sessão é derrubada (sem 43 no meio do diálogo)', async () => {
  const { sock, sessao, relogio } = await conectada();
  const lidos = [];
  const leitura = (async () => {
    for await (const dados of sessao.lerProgressivo(17, [0x02], 2)) lidos.push(dados);
  })();
  const erro = assert.rejects(leitura, /O Guarita não respondeu\./);
  await girar();
  sock.receber(comCs(`00 11 02 ${EVT}`));
  await relogio.avancar(5000);
  await erro;
  await girar();
  assert.equal(lidos.length, 1);
  assert.deepEqual(sock.escritosHex(), ['00110213', '00']);
  assert.equal(sock.destroyed, true);
  assert.equal(sessao.conectado, false);
});

test('lerProgressivo: quem consome para antes → sessão derrubada, sem 43 no meio do diálogo (Menor 1)', async () => {
  const { sock, sessao } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  const leitura = (async () => {
    for await (const dados of sessao.lerProgressivo(70, [], 5)) {
      void dados;
      break;
    }
  })();
  await girar();
  sock.receber(F70);
  await leitura;
  await girar();
  assert.deepEqual(sock.escritosHex(), ['004646', '00']);
  assert.equal(quedas.length, 1);
  await assert.rejects(sessao.comando(7), /não conectado|descartada/);
  assert.deepEqual(sock.escritosHex(), ['004646', '00'], 'nada mais é escrito nessa sessão');
});

test('C1: resposta atrasada depois do timeout não confirma ninguém — a sessão cai no timeout e o próximo comando nem é escrito', async () => {
  const { sock, sessao, relogio } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  const disp = Buffer.alloc(39, 0x20);
  disp[0] = 0x20; disp[3] = 0x01; disp.fill(0, 4, 11); disp[29] = 0; disp[30] = 0x16; disp[31] = 0;
  const pA = sessao.comando(67, Buffer.concat([Buffer.from([0]), disp]));
  const erroA = assert.rejects(pA, /O Guarita não respondeu./);
  await relogio.avancar(5000);
  await erroA;
  assert.equal(quedas.length, 1, 'a sessão foi derrubada no timeout');
  assert.equal(sessao.conectado, false);
  // B na mesma sessão: recusado sem escrever nada.
  disp[3] = 0x02;
  await assert.rejects(sessao.comando(67, Buffer.concat([Buffer.from([0]), disp])), /não conectado|descartada/);
  sock.receber(h('00 43 00 00 43')); // a resposta atrasada de A
  await girar();
  assert.equal(sock.escritos.length, 1, 'só o 67 de A foi escrito');
});

test('C1: resposta que chega sem pergunta pendente derruba a sessão', async () => {
  const { sock, sessao } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  sock.receber(h('00 07 00 02 09'));
  await girar();
  assert.equal(quedas.length, 1);
  assert.equal(sessao.conectado, false);
  assert.equal(sock.destroyed, true);
});

test('C1: frame a mais numa leitura progressiva (antes de pedir com 0x00) derruba a sessão', async () => {
  const { sock, sessao } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  const leitura = (async () => {
    for await (const dados of sessao.lerProgressivo(70, [], 3)) void dados;
  })();
  const erro = assert.rejects(leitura);
  await girar();
  sock.receber(Buffer.concat([F70, F70])); // o 2º chegou sem o 0x00 ter sido mandado
  await erro;
  assert.equal(quedas.length, 1);
  assert.equal(sessao.conectado, false);
});

test('queda no meio do comando: rejeita e emite "queda"', async () => {
  const { sock, sessao } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  const p = sessao.comando(29, [], { timeoutMs: 180000 });
  await girar();
  sock.emit('close');
  await assert.rejects(p, (e) => e.codigo === 'queda');
  assert.equal(quedas.length, 1);
  assert.equal(sessao.conectado, false);
  await assert.rejects(sessao.comando(7), /não conectado/);
});

test('lista branca na sessão: comando proibido lança sem escrever; escrita crua fora da lista é bloqueada', async () => {
  const { sock, sessao } = await conectada();
  for (const c of [5, 8, 11, 16, 18, 19, 23, 24, 35, 39, 50, 51, 60, 77, 83, 92, 106]) {
    await assert.rejects(sessao.comando(c), /não permitido/);
  }
  await assert.rejects(sessao._escrever(h('004D55AA4C')), /bloqueada/);
  await assert.rejects(sessao._escrever(h('00')), /bloqueada/); // 0x00 solto só dentro de leitura progressiva
  assert.equal(sock.escritos.length, 0);
});

test('prazoNaFilaMs: com o Guarita ocupado (29 esperando 180 s), o relé desiste sem escrever', async () => {
  const { sock, sessao, relogio } = await conectada();
  const p29 = sessao.comando(29, [], { timeoutMs: 180000 });
  await girar();
  const pRele = sessao.comando(13, [0x01, 0x00, 0x01, 0x01], { semResposta: true, prazoNaFilaMs: 5000 });
  const erro = assert.rejects(pRele, (e) => e.codigo === 'ocupado');
  await relogio.avancar(5000);
  await erro;
  sock.receber(h('00 1D 00 1D'));
  assert.equal((await p29).toString('hex'), '00');
  await girar();
  assert.deepEqual(sock.escritosHex(), ['001D1D']);
});

test('fechar(): não emite queda e rejeita o que estava esperando', async () => {
  const { sessao } = await conectada();
  const quedas = [];
  sessao.on('queda', (e) => quedas.push(e));
  const p = sessao.comando(7);
  await girar();
  sessao.fechar();
  await assert.rejects(p, /encerrada/);
  await girar();
  assert.equal(quedas.length, 0);
});
