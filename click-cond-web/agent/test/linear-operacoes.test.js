'use strict';

/**
 * agent/src/drivers/linear/operacoes.js contra o SIMULADOR do Guarita
 * (harness/guarita-simulado.js) por TCP real em 127.0.0.1. Os timeouts da
 * sessão rodam num relógio falso quando o teste precisa de silêncio.
 * Ao fim de cada teste o simulador não pode ter recebido comando proibido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarGuaritaSimulado } = require('../harness/guarita-simulado');
const { SessaoGuarita } = require('../src/drivers/linear/sessao');
const ops = require('../src/drivers/linear/operacoes');
const { criarRelogioFalso, esperarAte, logMudo } = require('./linear-auxiliares');

const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();

/** Frame de dispositivo (39 bytes) gerado aqui, sem o codec. */
function dispositivo(i, tipo = 2) {
  const d = Buffer.alloc(39, 0x20);
  d[0] = tipo << 4;
  d[1] = (i >> 16) & 0xff;
  d[2] = (i >> 8) & 0xff;
  d[3] = i & 0xff;
  d[4] = 0;
  d[5] = 0;
  d[6] = Math.floor((i % 10000) / 100);
  d[7] = i % 100;
  d[8] = 0;
  d[9] = 0;
  d[10] = 0xff;
  d[29] = 0;
  d[30] = 0x16;
  d[31] = 0;
  return d;
}
function evento(seg) {
  return Buffer.from(`000F086E0800${String(seg).padStart(2, '0')}010125210005000000`.slice(0, 32), 'hex');
}

async function cenario(opcoesSim, fn, { relogio } = {}) {
  const sim = criarGuaritaSimulado(opcoesSim);
  const { porta } = await sim.escutar();
  const sessao = new SessaoGuarita({ ip: '127.0.0.1', porta, palavra: opcoesSim.palavra, temporizador: relogio, logger: logMudo });
  try {
    await sessao.conectar();
    await fn({ sim, sessao, relogio });
  } finally {
    sessao.fechar();
    await sim.fechar();
  }
  assert.deepEqual(sim.comandosProibidosRecebidos().map(hex), [], 'o simulador recebeu comando proibido');
}

test('identificar: firmware, rótulos, totais e diferença de relógio (sem acertar o relógio)', async () => {
  const agora = Date.UTC(2026, 10, 15, 17, 30, 5);
  await cenario(
    {
      palavra: 'P4lavra',
      firmware: 'G003s',
      rotulos: ['PORTARIA', 'GARAGEM'],
      dispositivos: [dispositivo(1), dispositivo(2)],
      eventos: [evento(1), evento(2), evento(3)],
      horaDoGuarita: () => new Date(agora + 125000),
    },
    async ({ sim, sessao }) => {
      const id = await ops.identificar(sessao, { agora: () => agora });
      assert.deepEqual(id, {
        firmware: 'G003s',
        rotulos: ['PORTARIA', 'GARAGEM'],
        totalDispositivos: 2,
        totalEventos: 3,
        relogioDeltaS: 125,
      });
      assert.equal(sim.comandosRecebidos(11).length, 0, 'o relógio do Guarita nunca é escrito');
    },
  );
});

test('deltaDoRelogio: data ilegível → null', () => {
  assert.equal(ops.deltaDoRelogio(Buffer.from('151126143005', 'hex'), Date.UTC(2026, 10, 15, 17, 30, 5)), 0);
  assert.equal(ops.deltaDoRelogio(Buffer.from('1A1126143005', 'hex'), 0), null);
  assert.equal(ops.deltaDoRelogio(Buffer.from('151326143005', 'hex'), 0), null);
});

for (const n of [0, 1, 300]) {
  test(`importação de ${n} dispositivo(s): 7 + 70 progressivo + 43`, async () => {
    const lista = Array.from({ length: n }, (_, i) => dispositivo(i + 1, [1, 2, 3, 6][i % 4]));
    await cenario({ dispositivos: lista }, async ({ sim, sessao }) => {
      const lidos = await ops.lerTodosDispositivos(sessao);
      assert.equal(lidos.length, n);
      assert.deepEqual(lidos, lista.map(hex));
      assert.equal(sim.comandosRecebidos(70).length, n === 0 ? 0 : 1);
      assert.equal(sim.continuacoes.length, Math.max(0, n - 1));
      if (n > 0) {
        await esperarAte(() => sim.comandosRecebidos(43).length === 1, { rotulo: 'o 43' });
      }
    });
  });
}

test('queda do Guarita no meio da importação → lança e NÃO devolve lista parcial', async () => {
  const lista = Array.from({ length: 20 }, (_, i) => dispositivo(i + 1));
  await cenario({ dispositivos: lista }, async ({ sim, sessao }) => {
    sim.falhas.cairNoMeio(1 + 5); // resposta do 7 + 5 dispositivos
    let resultado = null;
    await assert.rejects(async () => {
      resultado = await ops.lerTodosDispositivos(sessao);
    }, /caiu/);
    assert.equal(resultado, null);
  });
});

test('importação: frame que não chega em 5 s → falha (relógio falso), derruba a sessão (sem 43 no meio) e não devolve parcial', async () => {
  const relogio = criarRelogioFalso();
  const lista = Array.from({ length: 4 }, (_, i) => dispositivo(i + 1));
  await cenario(
    { dispositivos: lista },
    async ({ sim, sessao }) => {
      sim.falhas.ignorarContinuacao(1); // o Guarita "some" depois do 1º dispositivo
      let resultado = null;
      let erro = null;
      const p = ops.lerTodosDispositivos(sessao).then((r) => (resultado = r), (e) => (erro = e));
      await esperarAte(() => sim.continuacoes.length === 1, { rotulo: '1º 0x00' });
      await relogio.avancar(5000);
      await p;
      assert.match(erro && erro.message, /não respondeu/);
      assert.equal(resultado, null);
      assert.equal(sessao.conectado, false, 'sessão derrubada');
      await esperarAte(() => sim.clientesConectados() === 0, { rotulo: 'conexão fechada' });
      assert.equal(sim.comandosRecebidos(43).length, 0, 'nenhum 43 no meio do diálogo');
    },
    { relogio },
  );
});

test('lerTodosEventos: 6 (todos) + 17 (todos) progressivo + 43', async () => {
  const evts = [evento(1), evento(2), evento(3)];
  evts[1][14] |= 0x40; // um já lido
  await cenario({ eventos: evts }, async ({ sim, sessao }) => {
    const lidos = await ops.lerTodosEventos(sessao);
    assert.deepEqual(lidos, evts.map(hex));
    assert.equal(hex(sim.comandosRecebidos(6)[0]), '00060208');
    assert.equal(hex(sim.comandosRecebidos(17)[0]), '00110213');
    await esperarAte(() => sim.comandosRecebidos(43).length === 1, { rotulo: 'o 43' });
  });
});

test('gravar: cadastrar, editar e apagar reais; ok só com 0x00; apagar manda só os bytes 1-4', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    const d = dispositivo(7, 3);
    let r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(d) });
    assert.deepEqual(r, { ok: true, codigo: 0, mensagem: 'ok' });
    assert.equal(sim.memoria.dispositivos.length, 1);
    const editado = Buffer.from(d);
    Buffer.from('NOVO ROTULO'.padEnd(18, ' ')).copy(editado, 11);
    r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(editado), esperado: { unidade: 7, bloco: 0 } });
    assert.equal(r.ok, true);
    assert.equal(hex(sim.memoria.dispositivos[0]), hex(editado));
    r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(editado), esperado: { unidade: 7, bloco: 0 } });
    assert.equal(r.ok, true);
    assert.equal(sim.memoria.dispositivos.length, 0);
    const ultimo67 = sim.comandosRecebidos(67).at(-1);
    assert.equal(ultimo67[2], 0x04);
    assert.equal(hex(ultimo67.subarray(3, 7)), hex(d.subarray(0, 4)));
    assert.ok(ultimo67.subarray(7, 42).every((b) => b === 0), 'apagar leva só tipo + serial');
  });
});

test('I1: cadastrar repetido (0x02) é conferido pelo 67 opção 3 — mesma unidade/bloco → ok com ja_estava', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    const d = dispositivo(7, 3);
    assert.equal((await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(d) })).ok, true);
    const outroRotulo = Buffer.from(d);
    Buffer.from('OUTRO ROTULO'.padEnd(18, ' ')).copy(outroRotulo, 11);
    const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outroRotulo) });
    assert.deepEqual(r, {
      ok: true,
      codigo: 2,
      ja_estava: true,
      lido: { unidade: 7, bloco: 0, frame_hex: hex(d) },
      mensagem: 'Este dispositivo já estava cadastrado no Guarita.',
    });
    const leitura = sim.comandosRecebidos(67).at(-1);
    assert.equal(leitura[2], 0x03, 'conferiu com o Ler');
    assert.equal(hex(leitura.subarray(3, 7)), hex(d.subarray(0, 4)));
    assert.ok(leitura.subarray(7, 42).every((b) => b === 0), 'o Ler leva só a chave');
    assert.equal(sim.memoria.dispositivos.length, 1);
  });
});

test('I1: cadastrar com 0x02 mas o Guarita tem o dispositivo em OUTRA unidade → falha com mensagem clara', async () => {
  const d = dispositivo(7, 3);
  await cenario({ dispositivos: [d] }, async ({ sessao }) => {
    const outraUnidade = Buffer.from(d);
    outraUnidade[7] = (outraUnidade[7] + 1) % 100;
    const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outraUnidade) });
    assert.deepEqual(r, {
      ok: false,
      codigo: 2,
      conflito: true,
      lido: { unidade: 7, bloco: 0, frame_hex: hex(d) },
      mensagem: 'Este dispositivo já está cadastrado no Guarita em outra unidade.',
    });
    const outroBloco = Buffer.from(d);
    outroBloco[8] = 0x05;
    assert.equal((await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outroBloco) })).ok, false);
  });
});

test('I1: apagar o que já não está no Guarita (0x03) → ok com ja_estava (o objetivo está atendido)', async () => {
  await cenario({}, async ({ sessao }) => {
    const r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(9)), esperado: { unidade: 9, bloco: 0 } });
    assert.deepEqual(r, { ok: true, codigo: null, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' });
  });
});

test('gravar: cada código do 67 vira a mensagem certa', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    const casos = [
      [0x01, 'Memória do Guarita cheia.'],
      // 0x02 no cadastrar é conferido pelo Ler (ja_estava / conflito / incerto — testes G2 e I1).
      [0x03, 'Dispositivo não encontrado no Guarita.'],
      [0xfe, 'O Guarita recusou os dados do dispositivo.'],
      [0x77, 'O Guarita respondeu um código desconhecido (0x77).'],
    ];
    for (const [codigo, mensagem] of casos) {
      sim.falhas.respostaDo67(codigo);
      const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(9)) });
      assert.deepEqual(r, { ok: false, codigo, mensagem });
    }
    assert.equal(sim.memoria.dispositivos.length, 0);
    assert.deepEqual(ops.MENSAGENS_67[0x00], 'ok');
    assert.deepEqual(ops.MENSAGENS_67[0x02], 'Este dispositivo já está cadastrado no Guarita.');
  });
});

test('gravar: silêncio no 67 → ok:false "O Guarita não respondeu." (relógio falso, 5 s)', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    {},
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1);
      const p = ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(3)) });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
      await relogio.avancar(5000);
      assert.deepEqual(await p, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.', escritoSemResposta: true });
    },
    { relogio },
  );
});

test('gravar: queda antes da resposta → ok:false, nunca "gravado"', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    sim.falhas.silencio(1);
    const p = ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(3)) });
    await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
    sim.derrubarConexoes();
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.mensagem, 'A conexão com o Guarita caiu antes da confirmação.');
  });
});

test('gravar: frame inválido ou tipo fora de RF/TA/CT/TP nem chega ao Guarita', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    assert.equal((await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: 'ABC' })).ok, false);
    assert.equal((await ops.gravar(sessao, { tipo: 'restaurar', frameHex: hex(dispositivo(1)) })).ok, false);
    const bio = dispositivo(1);
    bio[0] = 0x50; // biometria
    assert.equal((await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(bio) })).ok, false);
    assert.equal(sim.recebidos.length, 0);
  });
});

test('atualizarReceptores: 29 responde 00 → ok; FF → falha', async () => {
  await cenario({ tempos: { atraso29Ms: 20 } }, async ({ sim, sessao }) => {
    assert.deepEqual(await ops.atualizarReceptores(sessao), { ok: true, codigo: 0, mensagem: 'ok' });
    sim.falhas.respostaDo29(0xff);
    const r = await ops.atualizarReceptores(sessao);
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 0xff);
  });
});

test('atualizarReceptores: espera até 180 s pela resposta (relógio falso)', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    {},
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1);
      const p = ops.atualizarReceptores(sessao);
      await esperarAte(() => sim.comandosRecebidos(29).length === 1, { rotulo: 'o 29' });
      await relogio.avancar(179000);
      let resolvido = false;
      p.then(() => {
        resolvido = true;
      });
      await relogio.avancar(0);
      assert.equal(resolvido, false, 'ainda esperando aos 179 s');
      await relogio.avancar(1000);
      assert.deepEqual(await p, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.' });
    },
    { relogio },
  );
});

test('acionarRele: um frame do 13 com gera_evt = 1 (CAN 2 → byte 0x01); fora da faixa lança antes de escrever', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    for (const ruim of [
      { tipoReceptor: 2, numReceptor: 2, rele: 0 },
      { tipoReceptor: 2, numReceptor: 2, rele: 5 },
      { tipoReceptor: 2, numReceptor: 0, rele: 1 },
      { tipoReceptor: 2, numReceptor: 9, rele: 1 },
      { tipoReceptor: 4, numReceptor: 1, rele: 1 },
      { tipoReceptor: 2, numReceptor: 1, rele: '1' },
    ]) {
      await assert.rejects(ops.acionarRele(sessao, ruim), /inválido/);
    }
    assert.equal(sim.recebidos.length, 0, 'nada foi escrito');
    await ops.acionarRele(sessao, { tipoReceptor: 2, numReceptor: 2, rele: 3 });
    await esperarAte(() => sim.recebidos.length === 1, { rotulo: 'o 13' });
    assert.equal(hex(sim.recebidos[0]), '000D0201030114');
    assert.deepEqual(sim.acionamentos, [{ tipo: 2, num: 1, saida: 3, geraEvt: 1 }]);
    assert.equal(sim.comandosRecebidos(92).length, 0);
  });
});

test('importação: cadastro que muda durante a leitura (teclado do Guarita) → falha, não importa', async () => {
  const lista = Array.from({ length: 3 }, (_, i) => dispositivo(i + 1));
  // Depois que o 70 começou (a lista do diálogo já foi tirada), alguém cadastra no teclado.
  const aoReceber = (frame, memoria) => {
    if (frame[1] === 70) setImmediate(() => memoria.dispositivos.push(dispositivo(99)));
  };
  await cenario({ dispositivos: lista, aoReceber }, async ({ sessao }) => {
    await assert.rejects(ops.lerTodosDispositivos(sessao), /mudou durante a leitura .3 → 4./);
  });
});

test('C1 (cenário da revisão): cadastrar A calado → falhou; B nunca sai ok com a resposta atrasada de A', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    { capacidade: 1 },
    async ({ sim, sessao }) => {
      const quedas = [];
      sessao.on('queda', (e) => quedas.push(e));
      sim.falhas.atrasarResposta(150); // o Guarita grava A mas a resposta demora
      const pA = ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(1)) });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67 de A' });
      await relogio.avancar(5000);
      assert.deepEqual(await pA, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.', escritoSemResposta: true });
      assert.equal(quedas.length, 1, 'sessão derrubada no timeout');
      const rB = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(2)) });
      assert.equal(rB.ok, false);
      await new Promise((r) => setTimeout(r, 250)); // passa a hora da resposta atrasada de A
      assert.equal(sim.comandosRecebidos(67).length, 1, 'B não foi escrito na sessão suspeita');
      assert.equal(sim.memoria.dispositivos.length, 1, 'A foi gravado de fato');
    },
    { relogio },
  );
});

test('I2: abrir portão durante a importação de 2.000 dispositivos sai em < 2 s de relógio simulado e a importação termina completa depois', async () => {
  const relogio = criarRelogioFalso();
  const lista = Array.from({ length: 2000 }, (_, i) => dispositivo(i + 1, [1, 2, 3, 6][i % 4]));
  await cenario(
    { dispositivos: lista },
    async ({ sim, sessao }) => {
      let lidos = null;
      const importacao = ops.lerTodosDispositivos(sessao).then((l) => (lidos = l));
      await esperarAte(() => sim.continuacoes.length >= 50, { rotulo: 'importação andando' });
      const inicio = relogio.agora();
      let releOk = false;
      const rele = ops.acionarRele(sessao, { tipoReceptor: 1, numReceptor: 1, rele: 1 }, { prazoNaFilaMs: 10000 }).then(() => (releOk = true));
      while (!releOk && relogio.agora() - inicio < 2000) {
        await relogio.avancar(50);
        await new Promise((r) => setTimeout(r, 2));
      }
      await rele;
      assert.ok(relogio.agora() - inicio < 2000, `relé saiu em ${relogio.agora() - inicio} ms simulados`);
      await esperarAte(() => sim.comandosRecebidos(13).length === 1, { rotulo: 'o 13' });
      await importacao;
      assert.equal(lidos.length, 2000, 'importação completa');
      assert.deepEqual(lidos, lista.map(hex));
      assert.equal(sim.comandosRecebidos(70).length, 2, 'recomeçou do zero uma vez');
      assert.equal(sessao.conectado, true);
    },
    { relogio },
  );
});

test('I2: leitura interrompida mais de 5 vezes falha com erro claro (nunca devolve parcial)', async () => {
  let tentativas = 0;
  const sessaoFalsa = {
    comando: async (n) => (n === 7 ? Buffer.from([0x00, 0x03]) : Buffer.from([0x02, 0x00, 0x03])),
    lerProgressivo: async function* () {
      tentativas++;
      const e = new Error('Leitura interrompida para abrir o portão.');
      e.codigo = 'interrompida';
      throw e;
    },
  };
  await assert.rejects(ops.lerTodosDispositivos(sessaoFalsa), /interrompida 6 vezes para abrir o portão/);
  assert.equal(tentativas, 6);
  tentativas = 0;
  await assert.rejects(ops.lerTodosEventos(sessaoFalsa), /eventos do Guarita interrompida 6 vezes/);
  assert.equal(tentativas, 6);
});

test('Menor 6: apagar TA/TP zera o nibble baixo do byte 1 (um 6F… da nuvem ainda apaga o TAG); CT mantém o disp_dest', async () => {
  const tp = dispositivo(5, 6);
  const ct = dispositivo(6, 3);
  await cenario({ dispositivos: [tp] }, async ({ sim, sessao }) => {
    const sujo = Buffer.from(tp);
    sujo[0] = 0x6f;
    const r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(sujo), esperado: { unidade: 5, bloco: 0 } });
    assert.equal(r.ok, true);
    assert.equal(r.ja_estava, undefined, 'apagou de verdade');
    assert.equal(sim.memoria.dispositivos.length, 0);
    assert.equal(sim.comandosRecebidos(67).at(-1)[3], 0x60);
    const ctDestino = Buffer.from(ct);
    ctDestino[0] = 0x34; // CT para a Catraca 2010
    await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(ctDestino), esperado: { unidade: 6, bloco: 0 } });
    assert.equal(sim.comandosRecebidos(67).at(-1)[3], 0x34);
  });
});

test('item 2: CT com disp_dest = 4 — o Ler e o apagar usam o byte 1 inteiro; o CT de destino 0 com o mesmo serial não é tocado', async () => {
  const ct4 = dispositivo(8, 3);
  ct4[0] = 0x34;
  const ct0 = dispositivo(8, 3); // mesmo serial, destino 0
  await cenario({ dispositivos: [ct4, ct0] }, async ({ sim, sessao }) => {
    const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(ct4) });
    assert.equal(r.ja_estava, true, 'achou pelo byte 1 inteiro (0x34)');
    assert.equal(sim.comandosRecebidos(67).at(-1)[3], 0x34, 'o Ler levou 0x34');
    const sujo = Buffer.from(dispositivo(9, 2));
    sujo[0] = 0x2f; // TA com nibble sujo: o Ler/apagar zera
    await ops.lerDispositivo(sessao, sujo);
    assert.equal(sim.comandosRecebidos(67).at(-1)[3], 0x20);
    assert.equal(sim.memoria.dispositivos.length, 2);
  });
});

test('item 1: editar/apagar sem `esperado` (API antiga) ou com esperado inválido → recusa sem escrever nada', async () => {
  await cenario({ dispositivos: [dispositivo(5)] }, async ({ sim, sessao }) => {
    for (const tipo of ['editar', 'apagar']) {
      for (const esperado of [undefined, null, {}, { unidade: 5 }, { unidade: '5', bloco: 0 }, { unidade: 5, bloco: 300 }, { unidade: 10000, bloco: 0 }]) {
        const r = await ops.gravar(sessao, { tipo, frameHex: hex(dispositivo(5)), esperado });
        assert.deepEqual(r, { ok: false, codigo: null, mensagem: 'Operação sem unidade esperada.' }, `${tipo} ${JSON.stringify(esperado)}`);
      }
    }
    assert.equal(sim.recebidos.length, 0, 'nada foi escrito');
  });
});

test('item 1: apagar — não existe (só lê, ja_estava), outra unidade (conflito, não escreve), bate (apaga)', async () => {
  const meu = dispositivo(5);
  const outro = dispositivo(6); // unidade 6
  await cenario({ dispositivos: [meu, outro] }, async ({ sim, sessao }) => {
    let r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(99)), esperado: { unidade: 99, bloco: 0 } });
    assert.deepEqual(r, { ok: true, codigo: null, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' });
    assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3], 'só leu');
    r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(outro), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r, {
      ok: false,
      codigo: null,
      conflito: true,
      lido: { unidade: 6, bloco: 0, frame_hex: hex(outro) },
      mensagem: 'Este dispositivo está cadastrado no Guarita em outra unidade.',
    });
    assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3, 3], 'conflito: não escreveu');
    assert.equal(sim.memoria.dispositivos.length, 2);
    r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(meu), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r, { ok: true, codigo: 0, lido: { unidade: 5, bloco: 0, frame_hex: hex(meu) }, mensagem: 'ok' });
    assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3, 3, 3, 4]);
    assert.equal(sim.memoria.dispositivos.length, 1);
    assert.equal(hex(sim.memoria.dispositivos[0]), hex(outro), 'o da outra unidade continua lá');
  });
});

test('item 1: editar — não existe (falha 0x03, não escreve), outra unidade (conflito), bate (edita)', async () => {
  const meu = dispositivo(5);
  const bloco7 = dispositivo(8);
  bloco7[8] = 0x07; // unidade 8, bloco H
  await cenario({ dispositivos: [meu, bloco7] }, async ({ sim, sessao }) => {
    let r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(dispositivo(99)), esperado: { unidade: 99, bloco: 0 } });
    assert.deepEqual(r, { ok: false, codigo: 3, mensagem: 'Dispositivo não encontrado no Guarita.' });
    const editado8 = Buffer.from(bloco7);
    editado8[8] = 0x00;
    r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(editado8), esperado: { unidade: 8, bloco: 0 } });
    assert.equal(r.conflito, true);
    assert.deepEqual(r.lido, { unidade: 8, bloco: 7, frame_hex: hex(bloco7) });
    assert.equal(r.ok, false);
    assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3, 3], 'nenhuma edição saiu');
    const novo = Buffer.from(meu);
    Buffer.from('NOVO NOME'.padEnd(18, ' ')).copy(novo, 11);
    r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(novo), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r, { ok: true, codigo: 0, lido: { unidade: 5, bloco: 0, frame_hex: hex(meu) }, mensagem: 'ok' });
    assert.equal(hex(sim.memoria.dispositivos[0]), hex(novo));
  });
});

test('item 1: ler e escrever saem sem outro comando no meio (nem o relé prioritário, nem um comando já na fila)', async () => {
  const meu = dispositivo(5);
  await cenario({ dispositivos: [meu] }, async ({ sim, sessao }) => {
    const novo = Buffer.from(meu);
    Buffer.from('OUTRO NOME'.padEnd(18, ' ')).copy(novo, 11);
    const pEditar = ops.gravar(sessao, { tipo: 'editar', frameHex: hex(novo), esperado: { unidade: 5, bloco: 0 } });
    const p7 = sessao.comando(7);
    const pRele = ops.acionarRele(sessao, { tipoReceptor: 1, numReceptor: 1, rele: 1 }, { prazoNaFilaMs: 10000 });
    assert.equal((await pEditar).ok, true);
    await pRele;
    await p7;
    await esperarAte(() => sim.recebidos.length === 4, { rotulo: '4 frames' });
    assert.deepEqual(
      sim.recebidos.map((f) => (f[1] === 67 ? `67/${f[2]}` : String(f[1]))),
      ['67/3', '67/1', '13', '7'],
    );
  });
});

test('item 1: Ler sem resposta → a sessão cai e NADA é escrito', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    { dispositivos: [dispositivo(5)] },
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1);
      const p = ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(5)), esperado: { unidade: 5, bloco: 0 } });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o Ler' });
      await relogio.avancar(5000);
      assert.deepEqual(await p, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.' });
      assert.equal(sessao.conectado, false);
      await new Promise((r) => setTimeout(r, 30));
      assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3], 'o apagar não saiu');
      assert.equal(sim.memoria.dispositivos.length, 1);
    },
    { relogio },
  );
});

test('G2: cadastrar RF com 0x02 na mesma unidade é ja_estava mesmo com o contador andado (o contador não é conflito)', async () => {
  const rf = dispositivo(12, 1);
  rf[0] = 0x11; // serial de 7 dígitos
  rf[4] = 0x12;
  rf[5] = 0x34;
  await cenario({ dispositivos: [rf] }, async ({ sessao }) => {
    const mesmo = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(rf) });
    assert.equal(mesmo.ok, true);
    assert.equal(mesmo.ja_estava, true);
    assert.deepEqual(mesmo.lido, { unidade: 12, bloco: 0, frame_hex: hex(rf) });
    const outroContador = Buffer.from(rf);
    outroContador[5] = 0x35;
    const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outroContador) });
    assert.equal(r.ok, true);
    assert.equal(r.ja_estava, true);
    assert.equal(r.conflito, undefined);
    assert.deepEqual(r.lido, { unidade: 12, bloco: 0, frame_hex: hex(rf) });
    // Outra unidade continua conflito.
    const outraUnidade = Buffer.from(rf);
    outraUnidade[7] = 13;
    const c = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outraUnidade) });
    assert.equal(c.conflito, true);
    // Conferência depois da queda: mesma regra.
    const conferido = await ops.conferirGravacao(sessao, { tipo: 'cadastrar', frameHex: hex(outroContador) });
    assert.equal(conferido.ok, true);
    assert.equal(conferido.ja_estava, true);
  });
});

test('G2: cadastrar com 0x02 e o Ler de conferência sem o dispositivo → incerto, nunca conflito', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    sim.falhas.respostaDo67(0x02); // 0x02 sem gravar; o Ler seguinte não acha nada
    const r = await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(8, 3)) });
    assert.deepEqual(r, { ok: false, codigo: 2, incerto: true, mensagem: ops.MSG_INCERTO });
  });
});

// ---------- revisão final, I2: gravação escrita sem resposta ----------

test('final I2: gravar marca escritoSemResposta só quando o 67 de escrita saiu e a resposta não veio', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    { dispositivos: [dispositivo(5)] },
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1);
      const p = ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(6)) });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o 67' });
      await relogio.avancar(5000);
      const r = await p;
      assert.equal(r.ok, false);
      assert.equal(r.escritoSemResposta, true);
    },
    { relogio },
  );
  const relogio2 = criarRelogioFalso();
  await cenario(
    { dispositivos: [dispositivo(5)] },
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1); // o LER fica sem resposta: nada foi escrito
      const p = ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(5)), esperado: { unidade: 5, bloco: 0 } });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o Ler' });
      await relogio2.avancar(5000);
      const r = await p;
      assert.equal(r.ok, false);
      assert.equal(r.escritoSemResposta, undefined);
    },
    { relogio: relogio2 },
  );
});

test('final I2: conferirGravacao — cadastrar presente/outra unidade/ausente', async () => {
  const d = dispositivo(5);
  const emOutra = dispositivo(6);
  await cenario({ dispositivos: [d, emOutra] }, async ({ sessao }) => {
    assert.deepEqual(await ops.conferirGravacao(sessao, { tipo: 'cadastrar', frameHex: hex(d) }), {
      ok: true,
      codigo: null,
      ja_estava: true,
      lido: { unidade: 5, bloco: 0, frame_hex: hex(d) },
      mensagem: 'Confirmado no Guarita depois da reconexão.',
    });
    const pedidoOutra = Buffer.from(emOutra);
    pedidoOutra[7] = 9;
    const c = await ops.conferirGravacao(sessao, { tipo: 'cadastrar', frameHex: hex(pedidoOutra) });
    assert.equal(c.ok, false);
    assert.equal(c.conflito, true);
    assert.deepEqual(c.lido, { unidade: 6, bloco: 0, frame_hex: hex(emOutra) });
    assert.deepEqual(await ops.conferirGravacao(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(77)) }), {
      ok: false,
      codigo: null,
      mensagem: 'O Guarita não respondeu e o dispositivo não foi gravado.',
    });
  });
});

test('final I2: conferirGravacao — editar igual ao pedido (ignorando bateria/último acionamento do byte 30) ou não; apagar ausente/presente', async () => {
  const d = dispositivo(5);
  d[29] = 0x3a; // último acionamento 3, bateria A: só leitura
  await cenario({ dispositivos: [d] }, async ({ sessao }) => {
    const pedido = Buffer.from(d);
    pedido[29] = 0x00;
    const ok = await ops.conferirGravacao(sessao, { tipo: 'editar', frameHex: hex(pedido), esperado: { unidade: 5, bloco: 0 } });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.lido, { unidade: 5, bloco: 0, frame_hex: hex(d) });
    const outroNome = Buffer.from(pedido);
    Buffer.from('OUTRO'.padEnd(18, ' ')).copy(outroNome, 11);
    const nao = await ops.conferirGravacao(sessao, { tipo: 'editar', frameHex: hex(outroNome), esperado: { unidade: 5, bloco: 0 } });
    assert.equal(nao.ok, false);
    assert.equal(nao.mensagem, 'O Guarita não respondeu e o dispositivo não foi gravado.');
    const portaria = Buffer.from(pedido);
    portaria[29] = 0x80; // bit 7 (portaria) é gravável: conta
    assert.equal((await ops.conferirGravacao(sessao, { tipo: 'editar', frameHex: hex(portaria), esperado: { unidade: 5, bloco: 0 } })).ok, false);
    const aindaLa = await ops.conferirGravacao(sessao, { tipo: 'apagar', frameHex: hex(d), esperado: { unidade: 5, bloco: 0 } });
    assert.equal(aindaLa.ok, false);
    assert.equal(aindaLa.mensagem, 'O Guarita não respondeu e o dispositivo não foi apagado.');
    assert.deepEqual(await ops.conferirGravacao(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(77)), esperado: { unidade: 77, bloco: 0 } }), {
      ok: true,
      codigo: null,
      ja_estava: true,
      mensagem: 'Confirmado no Guarita depois da reconexão.',
    });
  });
});

test('final I2: conferirGravacao sem resposta → incerto', async () => {
  const relogio = criarRelogioFalso();
  await cenario(
    {},
    async ({ sim, sessao }) => {
      sim.falhas.silencio(1);
      const p = ops.conferirGravacao(sessao, { tipo: 'cadastrar', frameHex: hex(dispositivo(5)) });
      await esperarAte(() => sim.comandosRecebidos(67).length === 1, { rotulo: 'o Ler' });
      await relogio.avancar(5000);
      assert.deepEqual(await p, { ok: false, codigo: null, incerto: true, mensagem: 'Não foi possível confirmar no Guarita.' });
    },
    { relogio },
  );
});


test('final Menor 7: Ler que responde 0x00 com OUTRA chave não vira a mensagem "ok"', async () => {
  const outro = dispositivo(9);
  const sessaoFalsa = {
    comando: async () => Buffer.concat([Buffer.from([0x03, 0x00]), outro]),
    sequencia: async (fn) => fn({ comando: async () => Buffer.concat([Buffer.from([0x03, 0x00]), outro]) }),
  };
  const r = await ops.gravar(sessaoFalsa, { tipo: 'editar', frameHex: hex(dispositivo(5)), esperado: { unidade: 5, bloco: 0 } });
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, 'O Guarita devolveu outro dispositivo na leitura.');
  const c = await ops.conferirGravacao(sessaoFalsa, { tipo: 'cadastrar', frameHex: hex(dispositivo(5)) });
  assert.equal(c.incerto, true);
});


test('re-revisão R3: editar cujo pedido JÁ está no Guarita (ex.: a 1ª tentativa valeu e mudou a unidade) → ok + ja_estava + lido, sem escrever e sem conflito falso', async () => {
  const depois = dispositivo(5);
  depois[7] = 6; // unidade 6: o editar anterior já valeu
  depois[29] = 0x25; // só leitura (último acionamento/bateria) não conta
  await cenario({ dispositivos: [depois] }, async ({ sim, sessao }) => {
    const pedido = Buffer.from(depois);
    pedido[29] = 0x00;
    const r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(pedido), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r, {
      ok: true,
      codigo: null,
      ja_estava: true,
      lido: { unidade: 6, bloco: 0, frame_hex: hex(depois) },
      mensagem: 'O Guarita já tinha estes dados.',
    });
    assert.deepEqual(sim.comandosRecebidos(67).map((f) => f[2]), [3], 'só leu');
    // dados diferentes em outra unidade: continua conflito, com lido
    const outro = Buffer.from(pedido);
    Buffer.from('OUTRO NOME'.padEnd(18, ' ')).copy(outro, 11);
    const c = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(outro), esperado: { unidade: 5, bloco: 0 } });
    assert.equal(c.conflito, true);
    assert.equal(c.lido.frame_hex, hex(depois));
  });
});

test('re-revisão: todo resultado de editar/apagar que LEU o dispositivo traz lido.frame_hex (ok, falha do 67 na escrita, conflito)', async () => {
  const d = dispositivo(5);
  let simRef = null;
  // A escrita (67 opção 1 ou 4) responde FE; o Ler responde normal.
  const aoReceber = (frame) => {
    if (frame[1] === 67 && (frame[2] === 1 || frame[2] === 4) && simRef.falharEscrita) simRef.falhas.respostaDo67(0xfe);
  };
  await cenario({ dispositivos: [d], aoReceber }, async ({ sim, sessao }) => {
    simRef = sim;
    const lido = { unidade: 5, bloco: 0, frame_hex: hex(d) };
    const editado = Buffer.from(d);
    Buffer.from('X'.padEnd(18, ' ')).copy(editado, 11);
    sim.falharEscrita = true;
    const r1 = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(editado), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r1, { ok: false, codigo: 0xfe, lido, mensagem: 'O Guarita recusou os dados do dispositivo.' });
    const r2 = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(d), esperado: { unidade: 5, bloco: 0 } });
    assert.deepEqual(r2, { ok: false, codigo: 0xfe, lido, mensagem: 'O Guarita recusou os dados do dispositivo.' });
    sim.falharEscrita = false;
    const r3 = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(d), esperado: { unidade: 9, bloco: 0 } });
    assert.equal(r3.conflito, true);
    assert.deepEqual(r3.lido, lido);
  });
});
