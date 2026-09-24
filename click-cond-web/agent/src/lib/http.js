'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { buildDigestHeader } = require('./digest');

// Timeout default das chamadas ao aparelho quando o chamador não informa um
// LAN_TIMEOUT_MS explícito (ver 5º parâmetro de lanRequest). Mesmo valor que
// o agente usava como default de LAN_TIMEOUT_MS antes desta extração.
const DEFAULT_LAN_TIMEOUT_MS = 8000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function okFrom(res) {
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

// O RPC2 da Dahua responde JSON SEM header Content-Type, então o request()
// genérico não desserializa — parseamos o corpo cru aqui.
function parseJson(res) {
  if (res && res.data && typeof res.data === 'object') return res.data;
  try {
    return JSON.parse((res && res.raw) || '');
  } catch {
    return {};
  }
}

/**
 * Cliente HTTP minimalista sobre módulos nativos. Suporta json/xml/binary,
 * TLS self-signed (aparelhos de LAN) e timeout.
 */
function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`URL inválida: ${urlStr}`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (opts.auth && !headers.Authorization) {
      const tok = Buffer.from(`${opts.auth.user}:${opts.auth.pass}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${tok}`;
    }

    let payload;
    if (opts.json !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.json));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (opts.xml !== undefined) {
      payload = Buffer.from(opts.xml);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml';
    } else if (opts.binary !== undefined) {
      payload = opts.binary;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    }
    if (payload) headers['Content-Length'] = payload.length;

    const reqOpts = {
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      // TLS é explícito por chamada, não um flip global (revisão de
      // segurança da tarefa 8): default é validar de verdade (Node
      // default). Só quem PRECISA de permissivo (aparelhos de LAN, com
      // certificado self-signed — ver lanRequest()) passa
      // `rejectUnauthorized: false` explicitamente. cloudRequest()
      // (core/nuvem.js) e o downloader de atualização NÃO passam — ficam
      // estritos, porque validam segredos/hashes que só valem alguma coisa
      // se a conexão não puder ser interceptada.
      rejectUnauthorized: opts.rejectUnauthorized !== false,
    };

    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        // Desafio Digest (ex.: Hikvision): recalcula e repete uma vez.
        const wa = res.headers['www-authenticate'] || '';
        if (
          res.statusCode === 401 &&
          opts.auth &&
          !opts._retry &&
          /digest/i.test(wa)
        ) {
          try {
            const dh = buildDigestHeader(
              opts.auth.user,
              opts.auth.pass,
              reqOpts.method,
              reqOpts.path,
              wa,
            );
            return resolve(
              request(urlStr, {
                ...opts,
                _retry: true,
                auth: undefined,
                headers: { ...(opts.headers || {}), Authorization: dh },
              }),
            );
          } catch (e) {
            /* cai para a resposta 401 normal */
          }
        }
        const buffer = Buffer.concat(chunks);
        const raw = buffer.toString('utf8');
        let data = raw;
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json') && raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            /* mantém raw */
          }
        }
        // buffer = bytes crus (necessário p/ binário, ex.: snapshot JPEG).
        resolve({ status: res.statusCode, data, raw, buffer, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.setTimeout(opts.timeout || 10000, () => {
      req.destroy(new Error('timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * defaultTimeoutMs: LAN_TIMEOUT_MS é config carregada do .env em index.js
 * (estado de módulo), não algo que pertence a este utilitário puro — por
 * isso entra como parâmetro com o mesmo default (8000) que o agente sempre
 * usou. index.js mantém um wrapper local de mesmo nome que fecha sobre o
 * LAN_TIMEOUT_MS configurado, então as chamadas existentes não mudam.
 */
function lanRequest(device, method, pathname, opts = {}, defaultTimeoutMs = DEFAULT_LAN_TIMEOUT_MS) {
  const isHttps = device.porta === 443;
  const scheme = isHttps ? 'https' : 'http';
  const url = `${scheme}://${device.ip}:${device.porta}${pathname}`;
  // control_id usa sessão (na query), não auth por header. Para os demais,
  // request() tenta Basic e cai para Digest se o aparelho exigir (Hikvision).
  const auth =
    device.api_user && device.api_password && device.fabricante !== 'control_id'
      ? { user: device.api_user, pass: device.api_password }
      : undefined;
  return request(url, {
    method,
    timeout: defaultTimeoutMs,
    auth,
    // Explícito (ver comentário em request()): aparelhos de LAN usam
    // certificado self-signed, então este caminho fica permissivo — a rede
    // local é confiável. `...opts` depois: um chamador raro que queira
    // forçar estrito ainda pode.
    rejectUnauthorized: false,
    ...opts,
  });
}

module.exports = { request, lanRequest, okFrom, parseJson, sleep };
