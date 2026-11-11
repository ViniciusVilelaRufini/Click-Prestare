'use strict';

/**
 * agent/src/core/exclusivo.js — roda uma tarefa por chave sem concorrência:
 * um pedido que chega com a tarefa em curso não roda em paralelo, e sim UMA
 * vez a mais quando a atual terminar (o replay do log offline não pode
 * correr duas vezes ao mesmo tempo no mesmo aparelho, mas a reconexão que
 * chegou no meio também não pode ficar sem replay).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarExclusivoPorChave } = require('../src/core/exclusivo');

function adiado() {
  let resolver;
  const promessa = new Promise((res) => {
    resolver = res;
  });
  return { promessa, resolver };
}

test('rodar(): nunca duas execuções simultâneas para a mesma chave; pedidos no meio viram UMA execução extra', async () => {
  const exclusivo = criarExclusivoPorChave();
  const portas = [adiado(), adiado(), adiado()];
  let emCurso = 0;
  let maxEmCurso = 0;
  let execucoes = 0;
  const tarefa = async () => {
    const porta = portas[execucoes++];
    emCurso++;
    maxEmCurso = Math.max(maxEmCurso, emCurso);
    await porta.promessa;
    emCurso--;
  };
  const p1 = exclusivo.rodar(1, tarefa);
  const p2 = exclusivo.rodar(1, tarefa); // chega no meio
  const p3 = exclusivo.rodar(1, tarefa); // chega no meio também: junta com p2
  await Promise.resolve();
  assert.equal(execucoes, 1);
  portas[0].resolver();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(execucoes, 2, 'rodou de novo por causa do pedido que chegou no meio');
  portas[1].resolver();
  await Promise.all([p1, p2, p3]);
  assert.equal(execucoes, 2, 'dois pedidos no meio = uma execução extra só');
  assert.equal(maxEmCurso, 1);
  assert.equal(exclusivo.ocupado(1), false);
});

test('rodar(): chaves diferentes rodam em paralelo', async () => {
  const exclusivo = criarExclusivoPorChave();
  const a = adiado();
  const iniciadas = [];
  const pa = exclusivo.rodar('a', async () => {
    iniciadas.push('a');
    await a.promessa;
  });
  const pb = exclusivo.rodar('b', async () => {
    iniciadas.push('b');
  });
  await pb;
  assert.deepEqual(iniciadas, ['a', 'b']);
  assert.equal(exclusivo.ocupado('a'), true);
  a.resolver();
  await pa;
});

test('rodar(): tarefa que rejeita libera a chave (a próxima reconexão roda de novo) e propaga o erro', async () => {
  const exclusivo = criarExclusivoPorChave();
  await assert.rejects(
    exclusivo.rodar(1, async () => {
      throw new Error('falhou');
    }),
    /falhou/,
  );
  assert.equal(exclusivo.ocupado(1), false);
  let rodou = false;
  await exclusivo.rodar(1, async () => {
    rodou = true;
  });
  assert.equal(rodou, true);
});
