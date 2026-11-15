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

test('I2: relé durante o 29 espera a validade (10 s) e desiste com a mensagem do 29; o 13 nunca sai no meio do 29', async () => {
  const { sock, sessao, relogio } = await conectada();
  const p29 = sessao.comando(29, [], { timeoutMs: 180000 });
  await girar();
  const pRele = sessao.comando(13, [0x01, 0x00, 0x01, 0x01], { semResposta: true, prazoNaFilaMs: 10000, prioritario: true });
  const erro = assert.rejects(pRele, (e) => {
    assert.equal(e.codigo, 'ocupado_29');
    assert.equal(e.message, 'O Guarita está atualizando os receptores. Tente de novo em instantes.');
    return true;
  });
  await relogio.avancar(9999);
  assert.deepEqual(sock.escritosHex(), ['001D1D']);
  await relogio.avancar(1);
  await erro;
  sock.receber(h('00 1D 00 1D'));
  assert.equal((await p29).toString('hex'), '00');
  await girar();
  assert.deepEqual(sock.escritosHex(), ['001D1D']);
});

test('I2: relé esperando interrompe a leitura progressiva entre dois frames (43 + quarentena) e sai antes de quem já esperava', async () => {
  const { sock, sessao, relogio } = await conectada();
  let erroLeitura = null;
  const lidos = [];
  const leitura = (async () => {
    for await (const d of sessao.lerProgressivo(70, [], 5)) lidos.push(d);
  })().catch((e) => (erroLeitura = e));
  await girar();
  const pComum = sessao.comando(7); // não prioritário, já na fila
  const pRele = sessao.comando(13, [0x01, 0x00, 0x02, 0x01], { semResposta: true, prazoNaFilaMs: 10000, prioritario: true });
  await girar();
  sock.receber(F70);
  await girar();
  assert.deepEqual(sock.escritosHex(), ['004646', '002B2B'], 'no lugar do 0x00, o 43');
  await relogio.avancar(249);
  assert.deepEqual(sock.escritosHex(), ['004646', '002B2B'], 'quarentena');
  await relogio.avancar(1);
  await pRele;
  await leitura;
  assert.equal(erroLeitura.codigo, 'interrompida');
  assert.equal(lidos.length, 0, 'nada parcial entregue');
  await girar();
  assert.deepEqual(sock.escritosHex(), ['004646', '002B2B', '000D0100020111', '000707'], 'o relé passou na frente do 7');
  sock.receber(h('00 07 00 02 09'));
  await pComum;
  assert.equal(sessao.conectado, true);
});

test('I2: se o frame seguinte chegar mesmo depois do 43 (o Guarita leu o 0x00 como continuação), a sessão cai e o relé não sai nela', async () => {
  const { sock, sessao, relogio } = await conectada();
  const leitura = (async () => {
    for await (const d of sessao.lerProgressivo(70, [], 5)) void d;
  })().catch((e) => e);
  await girar();
  const pRele = sessao.comando(13, [0x01, 0x00, 0x02, 0x01], { semResposta: true, prazoNaFilaMs: 10000, prioritario: true });
  await girar();
  sock.receber(F70);
  await girar();
  const resultadoRele = pRele.then(() => null, (e) => e);
  sock.receber(F70); // atrasado, na quarentena
  await relogio.avancar(250);
  assert.match((await resultadoRele).message, /não conectado/);
  await leitura;
  assert.equal(sessao.conectado, false);
  assert.ok(!sock.escritosHex().includes('000D0100020111'));
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

test('C2: palavra que forma frame (77, 19, 8, 18, 24) ou fora de 1..15 imprimíveis → não conecta e nenhum byte é escrito', async () => {
  const ruins = [
    '\x00MU\xAAL', // 00 4D 55 AA 4C = comando 77 (formatar)
    '\x00\x13\x00\x01\x00\x02\x16', // 19: apagar todos da unidade
    '\x00\x08\x08', // 8: apagar eventos
    '\x00\x12\x12', // 18: reiniciar
    '\x00\x18\x18', // 24: reset
    'abc\x7Fdef', // DEL
    'senha~', // 0x7E: fora da faixa do documento (p10 vai até 0x7D)
    'tab\there',
    'acentuação',
    'x'.repeat(16),
    42,
  ];
  for (const palavra of ruins) {
    const relogio = criarRelogioFalso();
    let aberto = 0;
    const sessao = new SessaoGuarita({
      ip: '10.0.0.5',
      palavra,
      abrirSocket: () => {
        aberto++;
        return new SocketFalso();
      },
      temporizador: relogio,
      logger: logMudo,
    });
    await assert.rejects(sessao.conectar(), (e) => {
      assert.equal(e.message, 'Palavra de autorização inválida no cadastro');
      assert.equal(e.codigo, 'palavra_invalida');
      assert.ok(typeof palavra !== 'string' || !e.message.includes(palavra));
      return true;
    }, JSON.stringify(palavra));
    assert.equal(aberto, 0, `não abre o socket: ${JSON.stringify(palavra)}`);
  }
});

test('C2: palavras válidas (1 a 15 caracteres 0x20..0x7D) continuam aceitas', async () => {
  for (const palavra of ['a', 'Senha 123}', 'x'.repeat(15), ' !"#$%&()*+,-./', '{|}']) {
    const { sock, sessao } = montarSessao({ palavra });
    const p = sessao.conectar();
    sock.emit('connect');
    await girar();
    assert.deepEqual(sock.escritos.map((b) => b.toString('latin1')), [palavra]);
    sock.receber(Buffer.from('Autorizado\0', 'latin1'));
    await p;
  }
});

test('C2: varredura — o único ponto que escreve no socket é _enviarAoSocket, e ele só deixa passar frame da lista branca, o 0x00 de continuação ou a palavra validada', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src', 'drivers');
  const arquivos = [
    ...fs.readdirSync(path.join(dir, 'linear')).map((f) => path.join(dir, 'linear', f)),
    path.join(dir, 'linear-guarita.js'),
  ];
  const escritas = [];
  for (const arq of arquivos) {
    const fonte = fs.readFileSync(arq, 'utf8');
    for (const m of fonte.matchAll(/\.write\(/g)) escritas.push(`${path.basename(arq)}@${m.index}`);
  }
  assert.equal(escritas.length, 1, escritas.join(', '));
  const fonte = fs.readFileSync(path.join(dir, 'linear', 'sessao.js'), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('  _enviarAoSocket('), fonte.indexOf('\n  }\n', fonte.indexOf('  _enviarAoSocket(')));
  assert.match(corpo, /s\.write\(/);
  assert.match(corpo, /ehFramePermitido\(buf\)/);
  assert.match(corpo, /palavraValida\(/);
  assert.ok(!/_escreverBruto/.test(fonte), 'sobrou caminho de escrita crua');
});

test('C2: escrita de palavra fora da fase de autorização é bloqueada', async () => {
  const { sock, sessao } = await conectada();
  await assert.rejects(sessao._enviarAoSocket(Buffer.from('abc', 'latin1'), 'palavra'), /bloqueada/);
  await assert.rejects(sessao._enviarAoSocket(Buffer.from('000C0C', 'hex'), 'outra'), /bloqueada/);
  assert.equal(sock.escritos.length, 0);
});
