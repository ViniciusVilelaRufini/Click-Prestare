'use strict';

/**
 * agent/src/drivers/comum/queda.js — aviso de queda/recuperação do ouvinte:
 * com o aparelho offline o laço tenta reabrir a cada poucos segundos; o log
 * registra a queda UMA vez e a recuperação UMA vez, por aparelho.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAvisoDeQueda } = require('../src/drivers/comum/queda');

test('caiu(): loga só na primeira falha de uma sequência; voltou(): loga só se estava caído', () => {
  const linhas = [];
  const log = { log: (m) => linhas.push(`log:${m}`), error: (m) => linhas.push(`err:${m}`) };
  const aviso = criarAvisoDeQueda(log);

  assert.equal(aviso.voltou('voltou'), false, 'nunca caiu: recuperação não é notícia');
  assert.equal(aviso.caiu('caiu 1'), true);
  assert.equal(aviso.caiu('caiu 2'), false);
  assert.equal(aviso.caiu('caiu 3'), false);
  assert.equal(aviso.caido(), true);
  assert.equal(aviso.voltou('voltou'), true);
  assert.equal(aviso.voltou('voltou de novo'), false);
  assert.equal(aviso.caido(), false);
  assert.equal(aviso.caiu('caiu 4'), true, 'nova queda depois de recuperar volta a logar');

  assert.deepEqual(linhas, ['err:caiu 1', 'log:voltou', 'err:caiu 4']);
});

test('cada aparelho tem o seu aviso (a queda de um não cala a do outro)', () => {
  const linhas = [];
  const log = { log: (m) => linhas.push(m), error: (m) => linhas.push(m) };
  const a = criarAvisoDeQueda(log);
  const b = criarAvisoDeQueda(log);
  a.caiu('A caiu');
  a.caiu('A caiu');
  b.caiu('B caiu');
  assert.deepEqual(linhas, ['A caiu', 'B caiu']);
});
