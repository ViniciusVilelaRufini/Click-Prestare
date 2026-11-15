'use strict';

/**
 * agent/harness/guarita-simulado.js — o simulador do Módulo Guarita é o
 * único oráculo do driver, então é testado SEM o codec nem a sessão do
 * agente: cliente `net` cru e bytes escritos à mão a partir da referência
 * do protocolo (checksum dos frames longos somado por um auxiliar local).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { criarGuaritaSimulado } = require('../harness/guarita-simulado');

const h = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();
function comCs(hexSemCs) {
  const b = h(hexSemCs);
  let s = 0;
  for (const x of b) s = (s + x) % 256;
  return Buffer.concat([b, Buffer.from([s])]);
}

// Frames de dispositivo (39 bytes) escritos à mão.
const ROT = (t) => Buffer.from(t.padEnd(18, ' '), 'latin1').toString('hex');
const PLACA = (t) => Buffer.from(t.padEnd(7, ' '), 'latin1').toString('hex');
const D_RF = `11A2B3C4 1234 0308 01 00 FF ${ROT('MARIA')} 00 06 0A ${PLACA('ABC1D23')}`;
const D_CT = `300F086E 0000 0C55 1A 00 FF ${ROT('JOAO')} 00 16 00 ${PLACA('')}`;
// Eventos (16 bytes): acionado RF não lido / passagem TA lida.
const E1 = '01A2B3C4 143005 151126 10 0308 01 10 00';
const E2 = '000F086E 080000 010125 21 0005 00 40 00';
const E3 = '000F086E 080001 010125 21 0005 00 00 00';

async function conectarCru(porta) {
  const sock = net.connect({ host: '127.0.0.1', port: porta });
  sock.setNoDelay(true);
  const cli = { sock, recebido: Buffer.alloc(0), fechou: false };
  sock.on('data', (d) => {
    cli.recebido = Buffer.concat([cli.recebido, d]);
  });
  sock.on('close', () => {
    cli.fechou = true;
  });
  sock.on('error', () => {});
  await new Promise((r, j) => {
    sock.once('connect', r);
    sock.once('error', j);
  });
  cli.enviar = (x) => sock.write(Buffer.isBuffer(x) ? x : h(x));
  cli.esperarBytes = async (n, limiteMs = 2000) => {
    const inicio = Date.now();
    while (cli.recebido.length < n) {
      if (Date.now() - inicio > limiteMs) throw new Error(`esperava ${n} bytes, chegaram ${cli.recebido.length}: ${hex(cli.recebido)}`);
      await new Promise((r) => setTimeout(r, 3));
    }
    const out = cli.recebido.subarray(0, n);
    cli.recebido = cli.recebido.subarray(n);
    return Buffer.from(out);
  };
  cli.nadaEm = async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return cli.recebido.length === 0;
  };
  cli.esperarFechar = async (limiteMs = 2000) => {
    const inicio = Date.now();
    while (!cli.fechou) {
      if (Date.now() - inicio > limiteMs) throw new Error('conexão não fechou');
      await new Promise((r) => setTimeout(r, 3));
    }
  };
  return cli;
}

async function comSimulador(opcoes, fn) {
  const sim = criarGuaritaSimulado(opcoes);
  const { porta } = await sim.escutar();
  try {
    await fn(sim, porta);
  } finally {
    await sim.fechar();
  }
}

test('vetores locais: frames de dispositivo têm 39 bytes e de evento 16', () => {
  assert.equal(h(D_RF).length, 39);
  assert.equal(h(D_CT).length, 39);
  assert.equal(h(E1).length, 16);
  assert.equal(h(E2).length, 16);
});

test('sem palavra: 7 responde a quantidade (vazio e com 2 dispositivos)', async () => {
  await comSimulador({}, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '0007000007');
    sim.memoria.dispositivos.push(h(D_RF), h(D_CT));
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '0007000209');
    c.sock.destroy();
  });
});

test('autorização: palavra certa → "Autorizado\\0"; errada → "Negado\\0" e fecha; nada → "Timeout\\0" e fecha', async () => {
  await comSimulador({ palavra: 'ABC123', tempos: { autorizacaoMs: 60 } }, async (sim, porta) => {
    const ok = await conectarCru(porta);
    ok.enviar(Buffer.from('ABC123', 'latin1'));
    assert.equal((await ok.esperarBytes(11)).toString('latin1'), 'Autorizado\0');
    ok.enviar('00 07 07');
    assert.equal(hex(await ok.esperarBytes(5)), '0007000007');
    ok.sock.destroy();

    const ruim = await conectarCru(porta);
    ruim.enviar(Buffer.from('ABD', 'latin1'));
    assert.equal((await ruim.esperarBytes(7)).toString('latin1'), 'Negado\0');
    await ruim.esperarFechar();

    const mudo = await conectarCru(porta);
    assert.equal((await mudo.esperarBytes(8)).toString('latin1'), 'Timeout\0');
    await mudo.esperarFechar();
    assert.equal(sim.comandosProibidosRecebidos().length, 0);
  });
});

test('autorização: palavra fragmentada e frame colado logo depois', async () => {
  await comSimulador({ palavra: 'XYZ' }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar(Buffer.from('X', 'latin1'));
    await new Promise((r) => setTimeout(r, 10));
    c.enviar(Buffer.concat([Buffer.from('YZ', 'latin1'), h('00 07 07')]));
    assert.equal((await c.esperarBytes(11)).toString('latin1'), 'Autorizado\0');
    assert.equal(hex(await c.esperarBytes(5)), '0007000007');
    c.sock.destroy();
  });
});

test('3 (rótulos), 12 (relógio BCD dia-mês-ano-hora-min-seg), 38 (firmware) e 61 (versão do receptor)', async () => {
  const hora = new Date(Date.UTC(2026, 10, 15, 17, 30, 5)); // 14:30:05 em Brasília
  await comSimulador({ horaDoGuarita: () => hora, rotulos: ['ROTULO UM', 'ROTULO DOIS'] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 03 03');
    const r3 = await c.esperarBytes(43);
    assert.equal(hex(r3.subarray(0, 2)), '0003');
    assert.equal(r3.subarray(2, 22).toString('latin1'), 'ROTULO UM'.padEnd(20, ' '));
    assert.equal(r3.subarray(22, 42).toString('latin1'), 'ROTULO DOIS'.padEnd(20, ' '));
    assert.equal(hex(r3), hex(comCs(hex(r3.subarray(0, 42)))));
    c.enviar('00 0C 0C');
    assert.equal(hex(await c.esperarBytes(9)), '000C151126143005A1');
    c.enviar('00 26 26');
    assert.equal(hex(await c.esperarBytes(8)), '0026473030337373'); // "G003s"
    c.enviar('00 3D 01 00 3E');
    assert.equal(hex(await c.esperarBytes(10)), '003D01003330303071' + '72'); // "3000q"
    c.sock.destroy();
  });
});

test('6 conta eventos por marca (0 não lidos, 1 lidos, 2 todos)', async () => {
  await comSimulador({ eventos: [h(E1), h(E2), h(E3)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 06 02 08');
    assert.equal(hex(await c.esperarBytes(6)), '00060200030B');
    c.enviar('00 06 00 06');
    assert.equal(hex(await c.esperarBytes(6)), '000600000208');
    c.enviar('00 06 01 07');
    assert.equal(hex(await c.esperarBytes(6)), '000601000108');
    c.sock.destroy();
  });
});

test('70 progressivo: um frame por 0x00, 0xFF repete o atual, 43 encerra', async () => {
  await comSimulador({ dispositivos: [h(D_RF), h(D_CT)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 46 46');
    const f1 = await c.esperarBytes(42);
    assert.equal(hex(f1), hex(comCs(`00 46 ${D_RF}`)));
    c.enviar('FF');
    assert.equal(hex(await c.esperarBytes(42)), hex(f1));
    c.enviar('00');
    assert.equal(hex(await c.esperarBytes(42)), hex(comCs(`00 46 ${D_CT}`)));
    c.enviar('00 2B 2B');
    assert.equal(await c.nadaEm(40), true);
    // Depois do 43, comandos normais seguem.
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '0007000209');
    assert.deepEqual(sim.continuacoes, [0xff, 0x00]);
    assert.equal(sim.comandosProibidosRecebidos().length, 0);
    c.sock.destroy();
  });
});

test('70 progressivo: sem pergunta no prazo o diálogo é abandonado (0x00 atrasado não traz nada)', async () => {
  await comSimulador({ dispositivos: [h(D_RF), h(D_CT)], tempos: { progressivoMs: 30 } }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 46 46');
    await c.esperarBytes(42);
    await new Promise((r) => setTimeout(r, 60));
    c.enviar('00');
    assert.equal(await c.nadaEm(40), true);
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '0007000209');
    assert.equal(sim.comandosProibidosRecebidos().length, 0);
    c.sock.destroy();
  });
});

test('17 progressivo com marca: entrega 00 11 <marca> <evento> cs', async () => {
  await comSimulador({ eventos: [h(E1), h(E2), h(E3)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 11 00 11'); // não lidos: E1 e E3
    assert.equal(hex(await c.esperarBytes(20)), hex(comCs(`00 11 00 ${E1}`)));
    c.enviar('00');
    assert.equal(hex(await c.esperarBytes(20)), hex(comCs(`00 11 00 ${E3}`)));
    c.enviar('00 2B 2B');
    assert.equal(await c.nadaEm(30), true);
    c.sock.destroy();
  });
});

test('13: sem resposta; com gera_evt = 1 manda evento tipo 6 pelo envio automático (comando 4)', async () => {
  const hora = new Date(Date.UTC(2026, 10, 15, 17, 30, 5));
  await comSimulador({ horaDoGuarita: () => hora }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 0D 03 00 02 01 13');
    const f = await c.esperarBytes(20);
    assert.equal(hex(f.subarray(0, 2)), '0004');
    const evt = f.subarray(3, 19);
    assert.equal(evt[0], 0x60); // tipo 6
    assert.equal(hex(evt.subarray(4, 10)), '143005151126');
    assert.equal(evt[10], 0x30); // CT, CAN 1
    assert.equal(evt[14], 0x10); // saída 2 (bits 5..4 = 1)
    assert.equal(hex(f), hex(comCs(hex(f.subarray(0, 19)))));
    assert.equal(sim.memoria.eventos.length, 1);
    assert.deepEqual(sim.acionamentos, [{ tipo: 3, num: 0, saida: 2, geraEvt: 1 }]);
    c.sock.destroy();
  });
});

test('29: responde 00 1D 00 1D depois do atraso; respostaDo29(0xFF) → erro', async () => {
  await comSimulador({ tempos: { atraso29Ms: 40 } }, async (sim, porta) => {
    const c = await conectarCru(porta);
    const inicio = Date.now();
    c.enviar('00 1D 1D');
    assert.equal(hex(await c.esperarBytes(4)), '001D001D');
    assert.ok(Date.now() - inicio >= 35);
    sim.falhas.respostaDo29(0xff);
    c.enviar('00 1D 1D');
    assert.equal(hex(await c.esperarBytes(4)), '001DFF1C');
    c.sock.destroy();
  });
});

test('67: cadastra (00), já existe (02), edita (00 / 03), lê (44 bytes), apaga (00 / 03), frame inválido (FE)', async () => {
  await comSimulador({}, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar(comCs(`00 43 00 ${D_RF}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043000043');
    assert.equal(sim.memoria.dispositivos.length, 1);
    c.enviar(comCs(`00 43 00 ${D_RF}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043000245');
    const editado = D_RF.replace(ROT('MARIA'), ROT('MARIA SOUZA'));
    c.enviar(comCs(`00 43 01 ${editado}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043010044');
    c.enviar(comCs(`00 43 01 ${D_CT}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043010347');
    c.enviar(comCs(`00 43 03 ${'11A2B3C4' + '00'.repeat(35)}`));
    const lido = await c.esperarBytes(44);
    assert.equal(hex(lido), hex(comCs(`00 43 03 00 ${editado}`)));
    c.enviar(comCs(`00 43 04 ${'11A2B3C4' + '00'.repeat(35)}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043040047');
    c.enviar(comCs(`00 43 04 ${'11A2B3C4' + '00'.repeat(35)}`));
    assert.equal(hex(await c.esperarBytes(5)), '004304034A');
    const rotuloRuim = D_CT.replace(ROT('JOAO'), Buffer.from('joão'.padEnd(18, ' '), 'latin1').toString('hex'));
    c.enviar(comCs(`00 43 00 ${rotuloRuim}`));
    assert.equal(hex(await c.esperarBytes(5)), '004300FE41');
    assert.equal(sim.memoria.dispositivos.length, 0);
    assert.equal(sim.comandosProibidosRecebidos().length, 0);
    c.sock.destroy();
  });
});

test('67: memória cheia (12.000 dispositivos) → 01', async () => {
  const cheia = [];
  for (let i = 1; i <= 12000; i++) {
    const d = Buffer.alloc(39, 0x20);
    d[0] = 0x20; d[1] = (i >> 16) & 0xff; d[2] = (i >> 8) & 0xff; d[3] = i & 0xff;
    d.fill(0, 4, 11); d[10] = 0xff; d[29] = 0; d[30] = 0x16; d[31] = 0;
    cheia.push(d);
  }
  await comSimulador({ dispositivos: cheia }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '00072EE015'); // 12000 = 0x2EE0; 07+2E+E0 = 0x115
    c.enviar(comCs(`00 43 00 ${D_RF}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043000144');
    assert.equal(sim.memoria.dispositivos.length, 12000);
    c.sock.destroy();
  });
});

test('comando proibido fica registrado e aparece em comandosProibidosRecebidos (77, 8, 92, 67 opção 2)', async () => {
  await comSimulador({ dispositivos: [h(D_RF)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 4D 55 AA 4C'); // formatar
    c.enviar('00 08 08'); // apagar eventos
    c.enviar(comCs('00 5C 01 00 01 01 05')); // relé avançado
    c.enviar(comCs(`00 43 02 ${D_RF}`)); // restaurar
    await c.esperarBytes(5); // o 67 opção 2 responde FE
    await new Promise((r) => setTimeout(r, 20));
    const proibidos = sim.comandosProibidosRecebidos().map((f) => f[1]);
    assert.deepEqual(proibidos, [0x4d, 0x08, 0x5c, 0x43]);
    assert.equal(sim.memoria.dispositivos.length, 1, 'nada foi apagado nem formatado');
    c.sock.destroy();
  });
});

test('falhas: silêncio, checksum errado e queda no meio de uma leitura progressiva', async () => {
  await comSimulador({ dispositivos: [h(D_RF), h(D_CT)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    sim.falhas.silencio(1);
    c.enviar('00 07 07');
    assert.equal(await c.nadaEm(40), true);
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '0007000209');
    sim.falhas.checksumErrado(1);
    c.enviar('00 07 07');
    assert.equal(hex(await c.esperarBytes(5)), '000700020A');
    sim.falhas.cairNoMeio(1);
    c.enviar('00 46 46');
    await c.esperarBytes(42);
    await c.esperarFechar();
    assert.equal(sim.recebidosInvalidos.length, 0);
  });
});

test('frame com checksum errado recebido pelo Guarita: sem resposta', async () => {
  await comSimulador({}, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar('00 07 08');
    assert.equal(await c.nadaEm(40), true);
    assert.equal(sim.recebidosInvalidos.length, 1);
    c.sock.destroy();
  });
});

test('dispositivo não cadastrado: 42, 46 e 90 com os bytes da referência', async () => {
  await comSimulador({}, async (sim, porta) => {
    const c = await conectarCru(porta);
    await new Promise((r) => setTimeout(r, 10));
    sim.injetarNaoCadastrado({ comando: 42, tipo: 1, serialHex: '1A2B3C4', contador: 0x1234, bateriaFraca: true });
    assert.equal(hex(await c.esperarBytes(11)), '002A0101A2B3C412340F9A');
    sim.injetarNaoCadastrado({ comando: 46, tipo: 3, serialHex: '0F086E', num: 1, leitora: 2 });
    assert.equal(hex(await c.esperarBytes(10)), hex(comCs('00 2E 03 01 00 0F 08 6E 02')));
    sim.injetarNaoCadastrado({ comando: 90, serialHex: '1A2B3C4', contador: 0x0102, num: 2, botao: 1 });
    assert.equal(hex(await c.esperarBytes(13)), '005A010201A2B3C4010201007B');
    c.sock.destroy();
  });
});

test('evento automático pelo comando 40 (ponteiro) quando configurado', async () => {
  await comSimulador({ modoEvento: 40, eventos: [h(E2)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    await new Promise((r) => setTimeout(r, 10));
    sim.injetarEvento(h(E1));
    const f = await c.esperarBytes(22);
    assert.equal(hex(f.subarray(0, 4)), '00280001'); // ponteiro 1
    assert.equal(hex(f.subarray(5, 21)), hex(h(E1)));
    assert.equal(hex(f), hex(comCs(hex(f.subarray(0, 21)))));
    c.sock.destroy();
  });
});

test('item 2: CT com disp_dest = 4 é aceito, e 0x34… e 0x30… com o mesmo serial são dispositivos diferentes', async () => {
  const CT4 = `340F086E 0000 0001 00 00 FF ${ROT('CATRACA')} 00 16 00 ${PLACA('')}`;
  const CT0 = `300F086E 0000 0001 00 00 FF ${ROT('GUARITA')} 00 16 00 ${PLACA('')}`;
  await comSimulador({}, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar(comCs(`00 43 00 ${CT4}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043000043');
    c.enviar(comCs(`00 43 00 ${CT0}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043000043');
    assert.equal(sim.memoria.dispositivos.length, 2);
    c.enviar(comCs(`00 43 04 ${'340F086E' + '00'.repeat(35)}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043040047');
    assert.equal(sim.memoria.dispositivos.length, 1);
    assert.equal(sim.memoria.dispositivos[0][0], 0x30, 'só o de destino 4 saiu');
    // TA/TP com nibble diferente de 0 continua inválido
    c.enviar(comCs(`00 43 00 ${CT0.replace(/^30/, '25')}`));
    assert.equal(hex(await c.esperarBytes(5)), '004300FE41');
    c.sock.destroy();
  });
});

test('item 4: 67 opção 3 (Ler) de dispositivo que não existe responde 00 43 03 03 cs (5 bytes); existente responde os 44 bytes', async () => {
  await comSimulador({ dispositivos: [h(D_CT)] }, async (sim, porta) => {
    const c = await conectarCru(porta);
    c.enviar(comCs(`00 43 03 ${'20000001' + '00'.repeat(35)}`));
    assert.equal(hex(await c.esperarBytes(5)), '0043030349'); // 43+03+03 = 0x49
    c.enviar(comCs(`00 43 03 ${'300F086E' + '00'.repeat(35)}`));
    assert.equal(hex(await c.esperarBytes(44)), hex(comCs(`00 43 03 00 ${D_CT}`)));
    assert.equal(await c.nadaEm(30), true);
    c.sock.destroy();
  });
});
