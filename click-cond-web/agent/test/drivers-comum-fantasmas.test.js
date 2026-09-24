'use strict';

/**
 * agent/src/drivers/comum/fantasmas.js — NOSSO_EXTERNAL_ID (padrão de id que
 * a varredura de fantasmas reconhece como "nosso") e removerUsuariosPorLoop
 * (remoção em lote via loop individual, usada por Hikvision e Control iD).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { NOSSO_EXTERNAL_ID, removerUsuariosPorLoop } = require('../src/drivers/comum/fantasmas');

test('NOSSO_EXTERNAL_ID: reconhece morador/visitante/prestador_servico com id numérico', () => {
  assert.equal(NOSSO_EXTERNAL_ID.test('morador_42'), true);
  assert.equal(NOSSO_EXTERNAL_ID.test('visitante_9'), true);
  assert.equal(NOSSO_EXTERNAL_ID.test('prestador_servico_3'), true);
});

test('NOSSO_EXTERNAL_ID: NÃO reconhece usuário criado pelo instalador/outro padrão', () => {
  assert.equal(NOSSO_EXTERNAL_ID.test('admin'), false);
  assert.equal(NOSSO_EXTERNAL_ID.test('admin_instalador'), false);
  assert.equal(NOSSO_EXTERNAL_ID.test('morador_abc'), false); // sem id numérico
  assert.equal(NOSSO_EXTERNAL_ID.test(''), false);
});

test('removerUsuariosPorLoop(): faceIds vazio/ausente devolve ok sem chamar removerUm', async () => {
  let chamadas = 0;
  const r1 = await removerUsuariosPorLoop({ faceIds: [] }, async () => { chamadas++; return { ok: true }; });
  const r2 = await removerUsuariosPorLoop({}, async () => { chamadas++; return { ok: true }; });
  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(r2, { ok: true });
  assert.equal(chamadas, 0);
});

test('removerUsuariosPorLoop(): todos removidos com sucesso devolve ok:true', async () => {
  const chamados = [];
  const r = await removerUsuariosPorLoop({ faceIds: ['a', 'b', 'c'] }, async (faceId) => {
    chamados.push(faceId);
    return { ok: true };
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(chamados, ['a', 'b', 'c']);
});

test('removerUsuariosPorLoop(): 404 conta como sucesso (usuário já não existia)', async () => {
  const r = await removerUsuariosPorLoop({ faceIds: ['a'] }, async () => ({ ok: false, statusCode: 404 }));
  assert.deepEqual(r, { ok: true });
});

test('removerUsuariosPorLoop(): falha isolada não aborta o lote, mas reporta quem falhou', async () => {
  const r = await removerUsuariosPorLoop({ faceIds: ['a', 'b', 'c'] }, async (faceId) => {
    if (faceId === 'b') return { ok: false, statusCode: 500 };
    return { ok: true };
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /falha ao remover 1\/3 usuário\(s\): b/);
});

test('removerUsuariosPorLoop(): removerUm lançando conta como falha (não propaga a exceção)', async () => {
  const r = await removerUsuariosPorLoop({ faceIds: ['a', 'b'] }, async (faceId) => {
    if (faceId === 'a') throw new Error('rede caiu');
    return { ok: true };
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /falha ao remover 1\/2 usuário\(s\): a/);
});

test('removerUsuariosPorLoop(): mensagem de erro trunca em 10 ids', async () => {
  const alvos = Array.from({ length: 15 }, (_, i) => `id${i}`);
  const r = await removerUsuariosPorLoop({ faceIds: alvos }, async () => ({ ok: false, statusCode: 500 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /falha ao remover 15\/15/);
  assert.equal(r.error.split(', ').length, 10);
});
