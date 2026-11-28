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

test('expirado (passou da tolerância de relógio) → null', () => {
  const t = assinarTokenVoz(CLAIMS, SEGREDO, AGORA);
  assert.equal(verificarTokenVoz(t, SEGREDO, AGORA + 120 + 61), null);
});

test('tolerância de relógio de 60 s: EC2 atrás ou à frente do EB', () => {
  const t = assinarTokenVoz(CLAIMS, SEGREDO, AGORA);
  // Relógio do serviço 50 s atrás de quem assinou: o token "ainda nem nasceu" aqui.
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA - 50), CLAIMS);
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA - 60), CLAIMS);
  assert.equal(verificarTokenVoz(t, SEGREDO, AGORA - 61), null);
  // Relógio do serviço à frente: vale até antes de exp + 60 (exp é exclusivo, como no JWT).
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA + 120 + 59), CLAIMS);
  assert.equal(verificarTokenVoz(t, SEGREDO, AGORA + 120 + 60), null);
});

test('iat no futuro além da tolerância → null; validade emitida continua 120 s', () => {
  const t = jwtManual({ ...CLAIMS, iat: AGORA + 61, exp: AGORA + 120 });
  assert.equal(verificarTokenVoz(t, SEGREDO, AGORA), null);
  const ok = jwtManual({ ...CLAIMS, iat: AGORA + 30, exp: AGORA + 150 });
  assert.deepEqual(verificarTokenVoz(ok, SEGREDO, AGORA), CLAIMS);
  // exp longe demais (validade > 120 s + tolerância) continua recusado.
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS, exp: AGORA + 120 + 61 }), SEGREDO, AGORA), null);
  const [, p] = assinarTokenVoz(CLAIMS, SEGREDO, AGORA).split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(payload.exp - payload.iat, 120);
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

test('token com papel central é aceito', () => {
  const claims = { ...CLAIMS, papel: 'central' };
  const t = assinarTokenVoz(claims, SEGREDO, AGORA);
  assert.deepEqual(verificarTokenVoz(t, SEGREDO, AGORA), claims);
});

test('papel desconhecido continua recusado', () => {
  assert.equal(verificarTokenVoz(jwtManual({ ...CLAIMS, papel: 'centralx', exp: AGORA + 60 }), SEGREDO, AGORA), null);
});
