'use strict';

const crypto = require('crypto');

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/** Monta o header Authorization: Digest a partir do desafio WWW-Authenticate. */
function buildDigestHeader(user, pass, method, uri, challenge) {
  const get = (k) => {
    const m = challenge.match(new RegExp(`${k}="?([^",]+)"?`, 'i'));
    return m ? m[1] : '';
  };
  const realm = get('realm');
  const nonce = get('nonce');
  const opaque = get('opaque');
  const algorithm = get('algorithm') || 'MD5';
  const qop = get('qop') ? get('qop').split(',')[0].trim() : '';
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=${algorithm}`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) h += `, opaque="${opaque}"`;
  return h;
}

function parseChallengeInto(wa, st) {
  const g = (k) => {
    const m = wa.match(new RegExp(`${k}="?([^",]+)"?`, 'i'));
    return m ? m[1] : '';
  };
  st.realm = g('realm');
  st.nonce = g('nonce');
  st.qop = g('qop') ? g('qop').split(',')[0].trim() : '';
}

function computeDigest(user, pass, method, uri, st) {
  const ha1 = md5(`${user}:${st.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = String(st.nc).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = st.qop
    ? md5(`${ha1}:${st.nonce}:${nc}:${cnonce}:${st.qop}:${ha2}`)
    : md5(`${ha1}:${st.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${st.realm}", nonce="${st.nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
  if (st.qop) h += `, qop=${st.qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

module.exports = { md5, buildDigestHeader, parseChallengeInto, computeDigest };
