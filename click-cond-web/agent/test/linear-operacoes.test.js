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
    r = await ops.gravar(sessao, { tipo: 'editar', frameHex: hex(editado) });
    assert.equal(r.ok, true);
    assert.equal(hex(sim.memoria.dispositivos[0]), hex(editado));
    r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(editado) });
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
    assert.deepEqual(r, { ok: true, codigo: 2, ja_estava: true, mensagem: 'Este dispositivo já estava cadastrado no Guarita.' });
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
    assert.deepEqual(r, { ok: false, codigo: 2, mensagem: 'Este dispositivo já está cadastrado no Guarita em outra unidade.' });
    const outroBloco = Buffer.from(d);
    outroBloco[8] = 0x05;
    assert.equal((await ops.gravar(sessao, { tipo: 'cadastrar', frameHex: hex(outroBloco) })).ok, false);
  });
});

test('I1: apagar o que já não está no Guarita (0x03) → ok com ja_estava (o objetivo está atendido)', async () => {
  await cenario({}, async ({ sessao }) => {
    const r = await ops.gravar(sessao, { tipo: 'apagar', frameHex: hex(dispositivo(9)) });
    assert.deepEqual(r, { ok: true, codigo: 3, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' });
  });
});

test('gravar: cada código do 67 vira a mensagem certa', async () => {
  await cenario({}, async ({ sim, sessao }) => {
    const casos = [
      [0x01, 'Memória do Guarita cheia.'],
      [0x02, 'Este dispositivo já está cadastrado no Guarita.'],
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
      assert.deepEqual(await p, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.' });
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
      assert.deepEqual(await pA, { ok: false, codigo: null, mensagem: 'O Guarita não respondeu.' });
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
