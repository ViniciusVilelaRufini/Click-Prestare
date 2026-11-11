'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { buildDigestHeader } = require('./digest');
const { familiaDoFabricante } = require('./fabricante');

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
    const lido = JSON.parse((res && res.raw) || '');
    // `null`, número ou string são JSON válido mas não são a resposta que o
    // chamador vai ler campo a campo (`d.params`, `d.result`) — sempre objeto.
    return lido && typeof lido === 'object' ? lido : {};
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
    // Credencial NUNCA vai na primeira requisição: Basic preventivo mandava a
    // senha de admin do terminal em Base64 (texto claro) pela LAN, mesmo para
    // aparelhos que só aceitam Digest. Ela só sai depois do 401 (ver abaixo).
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };

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
        // 401 com desafio: Digest (Hikvision/Dahua) se oferecido. Basic só se
        // o aparelho pedir Basic E o chamador tiver autorizado com
        // `permitirBasic`: Basic é a senha em Base64 (texto claro) — qualquer
        // coisa que responda naquele IP pedindo Basic levaria a senha de
        // admin do terminal. Os três drivers usam Digest ou sessão; só o
        // fallback REST genérico (index.js) liga a opção. Repete uma vez com
        // a credencial.
        const wa = res.headers['www-authenticate'] || '';
        if (res.statusCode === 401 && opts.auth && !opts._retry) {
          let authorization = null;
          if (/digest/i.test(wa)) {
            try {
              authorization = buildDigestHeader(
                opts.auth.user,
                opts.auth.pass,
                reqOpts.method,
                reqOpts.path,
                wa,
              );
            } catch (e) {
              /* cai para a resposta 401 normal */
            }
          } else if (opts.permitirBasic === true && /^\s*basic\b/i.test(wa)) {
            authorization = `Basic ${Buffer.from(`${opts.auth.user}:${opts.auth.pass}`).toString('base64')}`;
          }
          if (authorization) {
            return resolve(
              request(urlStr, {
                ...opts,
                _retry: true,
                auth: undefined,
                headers: { ...(opts.headers || {}), Authorization: authorization },
              }),
            );
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
  // control_id usa sessão (na query), não auth por header (família
  // normalizada: "Control iD"/"controlid" também — ver lib/fabricante.js).
  // Para os demais, request() manda a credencial só depois do 401: Digest se
  // o aparelho oferecer; Basic só com `permitirBasic` em opts.
  const auth =
    device.api_user && device.api_password && familiaDoFabricante(device.fabricante) !== 'control_id'
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

// ---------- Motivo da falha de conexão ----------

const CODIGOS_SEM_RESPOSTA = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENETDOWN',
]);

function motivoPorStatus(status) {
  if (status === 401 || status === 403) return 'credencial';
  return 'protocolo_inesperado';
}

/**
 * Por que o aparelho não respondeu "ok"? Aceita o que os drivers devolvem
 * (`{ ok, statusCode }`), uma resposta crua (`{ status }`) ou o erro lançado
 * (rede: `err.code`; driver: `err.statusCode`). Devolve:
 *
 *   null                    deu certo
 *   'credencial'            HTTP 401/403 — usuário/senha do aparelho
 *   'sem_resposta'          timeout / sem rota até o IP (aparelho desligado,
 *                           IP errado, cabo)
 *   'recusado'              ECONNREFUSED — há uma máquina no IP, mas nada
 *                           escutando na porta (porta errada, serviço parado)
 *   'protocolo_inesperado'  respondeu, mas não como o driver espera (404,
 *                           outro status, corpo irreconhecível) — marca/modelo
 *                           errado no cadastro, ou outro equipamento no IP
 */
function classificarFalha(resOuErr) {
  if (resOuErr instanceof Error) {
    const err = resOuErr;
    // AggregateError (tentativas em mais de um endereço): vale a 1ª causa.
    const causa = Array.isArray(err.errors) && err.errors.length > 0 ? err.errors[0] : err;
    const code = String((causa && causa.code) || err.code || '');
    const msg = String((causa && causa.message) || err.message || '');
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'recusado';
    if (CODIGOS_SEM_RESPOSTA.has(code)) return 'sem_resposta';
    if (/\btimeout\b|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'sem_resposta';
    if (typeof err.statusCode === 'number') return motivoPorStatus(err.statusCode);
    return 'protocolo_inesperado';
  }
  if (!resOuErr || typeof resOuErr !== 'object') return 'protocolo_inesperado';
  const status =
    typeof resOuErr.statusCode === 'number'
      ? resOuErr.statusCode
      : typeof resOuErr.status === 'number'
        ? resOuErr.status
        : undefined;
  // Resultado de driver: `ok` manda. Resposta crua (sem `ok`): 2xx é ok.
  const ok =
    typeof resOuErr.ok === 'boolean'
      ? resOuErr.ok
      : status !== undefined && status >= 200 && status < 300;
  if (ok) return null;
  return status === undefined ? 'protocolo_inesperado' : motivoPorStatus(status);
}

module.exports = { request, lanRequest, okFrom, parseJson, sleep, classificarFalha };
