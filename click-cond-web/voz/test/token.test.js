import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinarTokenVoz, verificarTokenVoz } from '../src/token.js';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!!';
const AGORA = 1_800_000_000;
const CLAIMS = { cid: 15, papel: 'morador', uid: 42, nome: 'Maria' };

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// JWT HS256 montado à mão (independente do jsonwebtoken), como a API faria.
function jwtManual(payload, segredo = SEGREDO, header = { alg: 'HS256', typ: 'JWT' }) {
  const corpo = `${b64url(header)}.${b64url(payload)}`;
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}

test('assina e verifica', () => {
  const t = assinarTokenVoz(CLAIMS, SEGREDO, AGORA);
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA), CLAIMS);
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA + 119), CLAIMS);
});

test('token assinado é HS256 padrão com exp = agora + 120', () => {
  const [h, p, s] = assinarTokenVoz(CLAIMS, SEGREDO, AGORA).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(payload.exp, AGORA + 120);
  assert.equal(payload.iat, AGORA);
  assert.equal(s, createHmac('sha256', SEGREDO).update(`${h}.${p}`).digest('base64url'));
});

test('vetor: JWT HS256 montado à mão é aceito', () => {
  const t = jwtManual({ ...CLAIMS, papel: 'portaria', iat: AGORA, exp: AGORA + 120 });
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA + 1), { ...CLAIMS, papel: 'portaria' });
});

test('expirado → null', () => {
  const t = assinarTokenVoz(CLAIMS, SEGREDO, AGORA);
  assert.equal(verificarTokenVoz(t, SEGREDO, AGORA + 121), null);
});

test('segredo errado → null', () => {
  const t = assinarTokenVoz(CLAIMS, SEGREDO, AGORA);
  assert.equal(verificarTokenVoz(t, 'outro-segredo', AGORA), null);
  assert.equal(verificarTokenVoz(t, '', AGORA), null);
});

test('alg none, outro algoritmo, sem exp, claims inválidas → null', () => {
  const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...CLAIMS, exp: AGORA + 60 })}.`;
  assert.equal(verificarTokenVoz(none, SEGREDO, AGORA), null);
  const hs512 = jwtManual({ ...CLAIMS, exp: AGORA + 60 }, SEGREDO, { alg: 'HS512', typ: 'JWT' });
  assert.equal(verificarTokenVoz(hs512, SEGREDO, AGORA), null);
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS }), SEGREDO, AGORA), null, 'sem exp');
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS, exp: AGORA + 86400 }), SEGREDO, AGORA), null, 'validade longa demais');
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS, papel: 'admin', exp: AGORA + 60 }), SEGREDO, AGORA), null);
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS, cid: '15', exp: AGORA + 60 }), SEGREDO, AGORA), null);
  assert.equal(verificarTokenVoz('lixo', SEGREDO, AGORA), null);
  assert.equal(verificarTokenVoz(undefined, SEGREDO, AGORA), null);
});
