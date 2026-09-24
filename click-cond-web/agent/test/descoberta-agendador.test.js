'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarAgendador } = require('../src/descoberta/agendador');

function montar() {
  let t = 1_000_000;
  const chamadas = [];
  const enviados = [];
  const ag = criarAgendador({
    descobrir: async (o) => { chamadas.push(o.varredura); return [{ ip: 'x' }]; },
    enviar: async (a) => { enviados.push(a); },
    agora: () => t,
  });
  return { ag, chamadas, enviados, avancar: (ms) => { t += ms; } };
}
const nada = { pedidoDaNuvem: false, offlineDesde: new Map() };

test('leve no primeiro tick e a cada 5 min; envia o resultado', async () => {
  const { ag, chamadas, enviados, avancar } = montar();
  await ag.tick(nada);
  await ag.tick(nada);
  avancar(300000);
  await ag.tick(nada);
  assert.deepStrictEqual(chamadas, [false, false]);
  assert.strictEqual(enviados.length, 2);
});

test('pedido da nuvem força varredura mesmo logo após outra', async () => {
  const { ag, chamadas } = montar();
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  assert.deepStrictEqual(chamadas, [true, true]);
});

test('device offline há mais de 2 min dispara varredura, no máximo 1 a cada 10 min', async () => {
  const { ag, chamadas, avancar } = montar();
  await ag.tick(nada); // leve inicial
  const offline = new Map([[7, 1_000_000]]);
  avancar(60000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // 1 min offline: nada
  avancar(90000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // 2,5 min: varre
  avancar(60000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // limite de 10 min
  assert.deepStrictEqual(chamadas, [false, true]);
});

test('não sobrepõe duas descobertas', async () => {
  let soltar;
  const chamadas = [];
  const ag = criarAgendador({
    descobrir: (o) => { chamadas.push(o.varredura); return new Promise((ok) => { soltar = () => ok([]); }); },
    enviar: async () => {},
  });
  const p = ag.tick(nada);
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  soltar();
  await p;
  assert.strictEqual(chamadas.length, 1);
});

test('erro síncrono na decisão (agora() lança) não rejeita e não deixa emCurso travado', async () => {
  const chamadas = [];
  const origConsoleError = console.error;
  const erros = [];
  console.error = (...args) => erros.push(args.join(' ')); // mantém a saída do teste limpa
  try {
    let primeiraChamada = true;
    const ag = criarAgendador({
      descobrir: async (o) => { chamadas.push(o.varredura); return []; },
      enviar: async () => {},
      agora: () => {
        if (primeiraChamada) {
          primeiraChamada = false;
          throw new Error('relógio indisponível');
        }
        return 2_000_000;
      },
    });
    await assert.doesNotReject(ag.tick(nada));
    assert.strictEqual(chamadas.length, 0, 'não chegou a chamar descobrir() com a decisão quebrada');
    assert.ok(erros.length > 0, 'logou o erro em console.error');
    // emCurso não pode ter ficado travado em true: este tick precisa rodar
    // a descoberta normalmente.
    await ag.tick(nada);
    assert.strictEqual(chamadas.length, 1);
  } finally {
    console.error = origConsoleError;
  }
});
