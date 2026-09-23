'use strict';

/**
 * agent/src/lib/digest.js — Digest HTTP auth (RFC 2617).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  md5,
  buildDigestHeader,
  parseChallengeInto,
  computeDigest,
} = require('../src/lib/digest');

// Exemplo oficial da RFC 2617, seção 3.5 ("Mufasa" / testrealm@host.com).
// HA1/HA2/response abaixo foram conferidos de forma independente (MD5 puro,
// sem passar pelo digest.js) antes de virar valor esperado aqui.
const RFC2617 = {
  user: 'Mufasa',
  realm: 'testrealm@host.com',
  pass: 'Circle Of Life',
  method: 'GET',
  uri: '/dir/index.html',
  nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
  nc: '00000001',
  cnonce: '0a4f113b',
  qop: 'auth',
  ha1: '939e7578ed9e3c518a452acee763bce9',
  ha2: '39aff3a2bab6126f332b942af96d3366',
  response: '6629fae49393a05397450978507c4ef1',
};

test('md5(): HA1 do exemplo Mufasa da RFC 2617', () => {
  assert.equal(
    md5(`${RFC2617.user}:${RFC2617.realm}:${RFC2617.pass}`),
    RFC2617.ha1,
  );
});

test('md5(): HA2 do exemplo Mufasa da RFC 2617', () => {
  assert.equal(md5(`${RFC2617.method}:${RFC2617.uri}`), RFC2617.ha2);
});

test('md5(): response final do exemplo Mufasa (HA1:nonce:nc:cnonce:qop:HA2)', () => {
  const response = md5(
    `${RFC2617.ha1}:${RFC2617.nonce}:${RFC2617.nc}:${RFC2617.cnonce}:${RFC2617.qop}:${RFC2617.ha2}`,
  );
  assert.equal(response, RFC2617.response);
});

test('parseChallengeInto(): extrai realm/nonce/qop do WWW-Authenticate', () => {
  const wa = `Digest realm="${RFC2617.realm}", qop="${RFC2617.qop}", nonce="${RFC2617.nonce}", opaque="5ccc069c403ebaf9f0171e9517f40e41"`;
  const st = {};
  parseChallengeInto(wa, st);
  assert.equal(st.realm, RFC2617.realm);
  assert.equal(st.nonce, RFC2617.nonce);
  assert.equal(st.qop, RFC2617.qop);
});

test('computeDigest(): produz um response MD5 consistente com HA1/HA2/nc/cnonce usados', () => {
  const st = { realm: RFC2617.realm, nonce: RFC2617.nonce, qop: RFC2617.qop, nc: 1 };
  const header = computeDigest(RFC2617.user, RFC2617.pass, RFC2617.method, RFC2617.uri, st);

  assert.match(header, /^Digest /);
  const get = (k) => header.match(new RegExp(`${k}="?([^",]+)"?`))[1];
  const cnonce = get('cnonce');
  const nc = get('nc');
  const response = get('response');

  const expected = md5(
    `${RFC2617.ha1}:${RFC2617.nonce}:${nc}:${cnonce}:${RFC2617.qop}:${RFC2617.ha2}`,
  );
  assert.equal(response, expected);
});

test('buildDigestHeader(): monta header Digest válido a partir do challenge WWW-Authenticate', () => {
  const challenge = `Digest realm="${RFC2617.realm}", qop="${RFC2617.qop}", nonce="${RFC2617.nonce}", opaque="5ccc069c403ebaf9f0171e9517f40e41"`;
  const header = buildDigestHeader(RFC2617.user, RFC2617.pass, RFC2617.method, RFC2617.uri, challenge);

  assert.match(header, /^Digest /);
  const get = (k) => header.match(new RegExp(`${k}="?([^",]+)"?`))[1];
  assert.equal(get('username'), RFC2617.user);
  assert.equal(get('realm'), RFC2617.realm);
  assert.equal(get('nonce'), RFC2617.nonce);
  assert.equal(get('uri'), RFC2617.uri);
  assert.equal(get('opaque'), '5ccc069c403ebaf9f0171e9517f40e41');

  const cnonce = get('cnonce');
  const nc = get('nc');
  const response = get('response');
  const expected = md5(
    `${RFC2617.ha1}:${RFC2617.nonce}:${nc}:${cnonce}:${RFC2617.qop}:${RFC2617.ha2}`,
  );
  assert.equal(response, expected);
});
