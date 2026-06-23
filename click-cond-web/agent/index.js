#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Agente Local — Click Portaria
 * =============================
 *
 * Roda numa máquina sempre-ligada DENTRO da rede do condomínio (Raspberry Pi,
 * mini PC, etc.). Faz a ponte entre a nuvem e os aparelhos da LAN:
 *
 *   - Conecta PARA FORA (nuvem) → não precisa liberar porta no roteador.
 *   - Faz polling de comandos pendentes de cada device que gerencia.
 *   - Executa o comando no aparelho da LAN (abrir porta, cadastrar rosto, ping).
 *   - Devolve o resultado para a nuvem.
 *
 * Sem dependências externas: usa só módulos nativos do Node 18+.
 *
 * Configuração (variáveis de ambiente ou arquivo .env ao lado deste arquivo):
 *   API_URL        Base da API na nuvem. Ex.: https://sua-api.up.railway.app
 *   DEVICE_TOKENS  Tokens dos devices (o webhook_token de cada um), separados
 *                  por vírgula. Copie do portal: botão "Copiar URL Webhook" —
 *                  o token é o trecho final da URL.
 *   POLL_INTERVAL_MS  (opcional) intervalo de polling. Default vem da nuvem.
 *   LAN_TIMEOUT_MS    (opcional) timeout das chamadas ao aparelho. Default 8000.
 *
 * Uso:
 *   node index.js
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

/**
 * Fabricantes que NÃO falam HTTP para comandos. Usam protocolo binário em
 * porta própria / SDK — não dá para acionar por requisição HTTP. Validado
 * contra documentação pública (jun/2026). Use botoeira/relé HTTP genérico ou
 * um bridge SDK para esses casos.
 */
const SEM_COMANDO_HTTP = {
  zkteco: 'protocolo TCP/UDP na porta 4370 (PULL/PUSH SDK)',
  topdata: 'protocolo TCP na porta 3570 (SDK Inner)',
  henry: 'protocolo proprietário (SDK Henry)',
};

// ---------- Config ----------

loadDotEnv();

let API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
// Modo condomínio: UM token gerencia todos os dispositivos do condomínio.
let AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
// Modo legado (opcional): um token por dispositivo, separados por vírgula.
let DEVICE_TOKENS = (process.env.DEVICE_TOKENS || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const DEFAULT_POLL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const LAN_TIMEOUT_MS = Number(process.env.LAN_TIMEOUT_MS || 8000);

const temConfig = () => API_URL && (AGENT_TOKEN || DEVICE_TOKENS.length > 0);

main();

async function main() {
  // Sem config? Se houver console (rodando manualmente), pergunta e salva o
  // .env sozinho — o operador não precisa abrir editor de texto. Rodando como
  // serviço (sem console), apenas avisa o que falta.
  if (!temConfig() && process.stdin.isTTY) {
    await firstRunSetup();
  }
  if (!temConfig()) {
    console.error(
      'Configuração faltando. Crie um .env com API_URL e AGENT_TOKEN (veja .env.example),',
    );
    console.error('ou rode o executável uma vez por uma janela de terminal para configurar.');
    process.exit(1);
  }

  console.log(`[agente] iniciando — API: ${API_URL}`);
  if (AGENT_TOKEN) {
    console.log('[agente] modo condomínio: 1 token gerencia todos os dispositivos');
    runCondoLoop(AGENT_TOKEN).catch((err) =>
      console.error('[agente] loop do condomínio morreu:', err),
    );
  } else {
    console.log(`[agente] gerenciando ${DEVICE_TOKENS.length} device(s)`);
    for (const token of DEVICE_TOKENS) {
      runDeviceLoop(token).catch((err) =>
        console.error(`[agente] loop do token ...${token.slice(-6)} morreu:`, err),
      );
    }
  }
}

/** Pergunta a config no terminal na primeira vez e grava o .env. */
async function firstRunSetup() {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log('\n=== Configuração inicial do Agente Local ===');
  console.log('(você só faz isso uma vez; depois é automático)\n');
  const urlIn = await ask('1) URL da API na nuvem (ex.: https://sua-api.up.railway.app): ');
  console.log('\n2) No portal, em Terminais de Dispositivos, clique "Copiar URL Webhook"');
  console.log('   em QUALQUER dispositivo e cole aqui (pode colar a URL inteira):');
  const tokenIn = await ask('   Token/URL: ');
  rl.close();

  API_URL = urlIn.replace(/\/+$/, '');
  AGENT_TOKEN = extractToken(tokenIn);

  const envPath = path.join(configDir(), '.env');
  fs.writeFileSync(envPath, `API_URL=${API_URL}\nAGENT_TOKEN=${AGENT_TOKEN}\n`, 'utf8');
  console.log(`\nConfiguração salva em: ${envPath}`);
  console.log('Iniciando o agente...\n');
}

/** Aceita o token puro ou a URL inteira do webhook e extrai só o token. */
function extractToken(input) {
  const m = String(input).match(/\/webhook\/([^/?#]+)/i);
  return (m ? m[1] : String(input)).trim();
}

// ---------- Loop modo condomínio (1 token → todos os dispositivos) ----------

async function runCondoLoop(token) {
  let pollMs = DEFAULT_POLL_MS;
  let errBackoff = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await cloudRequest('GET', `/api/facial/agent/condo/${token}/poll`);
      errBackoff = 0;
      if (res.status === 401 || res.status === 404) {
        console.error(
          `[agente] token inválido/inativo (HTTP ${res.status}). Nova tentativa em 30s (confira o token no portal).`,
        );
        await sleep(30000);
        continue;
      }
      const body = res.data || {};
      if (body.poll_interval_ms) pollMs = Number(body.poll_interval_ms);

      for (const entry of body.devices || []) {
        const device = entry.device;
        for (const cmd of entry.commands || []) {
          const result = await executeOnDevice(device, cmd);
          await cloudRequest('POST', `/api/facial/agent/condo/${token}/result`, {
            commandId: cmd.id,
            ...result,
          });
          console.log(
            `[agente] ${device.nome} ◂ ${cmd.type} → ${result.ok ? 'OK' : 'FALHA'}${
              result.error ? ' (' + result.error + ')' : ''
            }`,
          );
        }
      }
    } catch (err) {
      errBackoff = Math.min(errBackoff + 1, 10);
      console.error('[agente] erro no poll do condomínio:', err.message || err);
    }
    await sleep(errBackoff > 0 ? pollMs * (1 + errBackoff) : pollMs);
  }
}

async function runDeviceLoop(token) {
  let pollMs = DEFAULT_POLL_MS;
  // backoff simples quando a nuvem está inacessível, pra não martelar
  let errBackoff = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await cloudRequest('GET', `/api/facial/agent/${token}/poll`);
      errBackoff = 0;
      if (res.status === 401 || res.status === 404) {
        // Token inválido OU device inativo no portal. NÃO encerra o loop: o
        // síndico pode reativar o device depois. Espera mais e tenta de novo,
        // assim o agente se recupera sozinho sem precisar reiniciar.
        console.error(
          `[agente] token ...${token.slice(-6)} inválido/inativo (HTTP ${res.status}). Nova tentativa em 30s (reative o device no portal para retomar).`,
        );
        await sleep(30000);
        continue;
      }
      const body = res.data || {};
      if (body.poll_interval_ms) pollMs = Number(body.poll_interval_ms);

      const device = body.device;
      const commands = body.commands || [];
      for (const cmd of commands) {
        const result = await executeOnDevice(device, cmd);
        await cloudRequest('POST', `/api/facial/agent/${token}/result`, {
          commandId: cmd.id,
          ...result,
        });
        console.log(
          `[agente] ${device.nome} ◂ ${cmd.type} → ${result.ok ? 'OK' : 'FALHA'}${
            result.error ? ' (' + result.error + ')' : ''
          }`,
        );
      }
    } catch (err) {
      errBackoff = Math.min(errBackoff + 1, 10);
      console.error(
        `[agente] erro no poll (...${token.slice(-6)}):`,
        err.message || err,
      );
    }
    await sleep(errBackoff > 0 ? pollMs * (1 + errBackoff) : pollMs);
  }
}

// ---------- Tradução comando lógico → protocolo do fabricante ----------

/**
 * Executa um comando no aparelho da LAN e devolve { ok, statusCode?, error?, faceId? }.
 *
 * ATENÇÃO: os endpoints por fabricante seguem documentação pública e podem
 * mudar entre firmwares. Valide com o manual do modelo antes do go-live.
 * Mantenha em sincronia com facial-device-client.service.ts (modo direto).
 */
async function executeOnDevice(device, cmd) {
  if (SEM_COMANDO_HTTP[device.fabricante]) {
    return {
      ok: false,
      error: `${device.fabricante} usa ${SEM_COMANDO_HTTP[device.fabricante]} — não aceita comando via HTTP. Use uma botoeira/relé HTTP genérico ou um bridge SDK.`,
    };
  }
  try {
    switch (cmd.type) {
      case 'ping':
        return await doPing(device);
      case 'open_door':
        return await doOpenDoor(device);
      case 'enroll':
      case 'update':
        return await doEnroll(device, cmd);
      case 'remove':
        return await doRemove(device, cmd);
      default:
        return { ok: false, error: `comando desconhecido: ${cmd.type}` };
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: err.statusCode,
      error: err.message || String(err),
    };
  }
}

async function doPing(device) {
  if (device.fabricante === 'control_id') {
    await controlIdLogin(device); // login OK prova conectividade
    return { ok: true };
  }
  const res = await lanRequest(device, 'GET', '/status');
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

async function doOpenDoor(device) {
  // VALIDADO: Control iD usa /execute_actions.fcgi com action "door".
  if (device.fabricante === 'control_id') {
    const session = await controlIdLogin(device);
    const res = await lanRequest(
      device,
      'POST',
      `/execute_actions.fcgi?session=${session}`,
      {
        json: { actions: [{ action: 'door', parameters: 'door=1' }] },
      },
    );
    return okFrom(res);
  }
  const map = {
    // NÃO VALIDADO: CGI de comando da Intelbras fica atrás do suporte técnico.
    intelbras: { method: 'POST', path: '/api/v1/door/open' },
    // VALIDADO (ISAPI). Requer Digest auth — tratado automaticamente em request().
    hikvision: {
      method: 'PUT',
      path: '/ISAPI/AccessControl/RemoteControl/door/1',
      xml: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
    },
    genérico: { method: 'POST', path: '/open_door' },
  };
  const ep = map[device.fabricante] || map['genérico'];
  const opts = ep.xml ? { xml: ep.xml } : { json: {} };
  const res = await lanRequest(device, ep.method, ep.path, opts);
  return okFrom(res);
}

async function doEnroll(device, cmd) {
  if (device.fabricante === 'control_id') {
    return cmd.type === 'update'
      ? controlIdUpdate(device, cmd)
      : controlIdCreate(device, cmd);
  }
  // Genérico: POST /persons (cadastro) ou PUT /persons/:id (update)
  if (cmd.type === 'update' && cmd.faceId) {
    const body = {};
    if (cmd.nome !== undefined) body.name = cmd.nome;
    if (cmd.fotoBase64 !== undefined) body.image_base64 = cmd.fotoBase64;
    const res = await lanRequest(device, 'PUT', `/persons/${cmd.faceId}`, {
      json: body,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      faceId: cmd.faceId,
    };
  }
  const res = await lanRequest(device, 'POST', '/persons', {
    json: {
      external_id: cmd.externalId,
      name: cmd.nome,
      image_base64: cmd.fotoBase64,
    },
  });
  const faceId =
    (res.data && (res.data.id || res.data.face_id)) || cmd.externalId;
  return {
    ok: res.status >= 200 && res.status < 300,
    statusCode: res.status,
    faceId: String(faceId),
  };
}

async function doRemove(device, cmd) {
  if (device.fabricante === 'control_id') {
    const session = await controlIdLogin(device);
    const res = await lanRequest(
      device,
      'POST',
      `/destroy_objects.fcgi?session=${session}`,
      {
        json: { object: 'users', where: { users: { id: Number(cmd.faceId) } } },
      },
    );
    return okFrom(res);
  }
  const res = await lanRequest(device, 'DELETE', `/persons/${cmd.faceId}`);
  if (res.status === 404) return { ok: true }; // já não existia
  return okFrom(res);
}

/**
 * Control iD — cadastro de pessoa nova. Devolve o user_id INTERNO do aparelho
 * como faceId: é por ele que o webhook resolve a pessoa (o push só manda
 * user_id). VALIDADO contra a doc oficial da API Linha de Acesso.
 */
async function controlIdCreate(device, cmd) {
  const session = await controlIdLogin(device);
  const registration = String(cmd.externalId || cmd.faceId);
  const created = await lanRequest(
    device,
    'POST',
    `/create_objects.fcgi?session=${session}`,
    {
      json: {
        object: 'users',
        values: [{ name: cmd.nome || registration, registration }],
      },
    },
  );
  const userId = created.data && created.data.ids && created.data.ids[0];
  if (userId == null)
    return { ok: false, error: 'Control iD: create_objects não retornou id' };
  if (cmd.fotoBase64) {
    await lanRequest(
      device,
      'POST',
      `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
      { binary: Buffer.from(cmd.fotoBase64, 'base64') },
    );
  }
  return { ok: true, faceId: String(userId) };
}

/** Control iD — atualiza nome/foto pelo user_id interno (= faceId salvo). */
async function controlIdUpdate(device, cmd) {
  const session = await controlIdLogin(device);
  const userId = Number(cmd.faceId);
  if (cmd.nome) {
    await lanRequest(
      device,
      'POST',
      `/modify_objects.fcgi?session=${session}`,
      {
        json: {
          object: 'users',
          values: { name: cmd.nome },
          where: { users: { id: userId } },
        },
      },
    );
  }
  if (cmd.fotoBase64) {
    await lanRequest(
      device,
      'POST',
      `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
      { binary: Buffer.from(cmd.fotoBase64, 'base64') },
    );
  }
  return { ok: true, faceId: String(userId) };
}

async function controlIdLogin(device) {
  const res = await lanRequest(device, 'POST', '/login.fcgi', {
    json: {
      login: device.api_user || 'admin',
      password: device.api_password || 'admin',
    },
  });
  const session = res.data && res.data.session;
  if (!session) {
    const e = new Error('Control iD: login não retornou session');
    e.statusCode = res.status;
    throw e;
  }
  return String(session);
}

function okFrom(res) {
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

// ---------- HTTP helpers ----------

function cloudRequest(method, pathname, jsonBody) {
  return request(API_URL + pathname, {
    method,
    json: jsonBody,
    timeout: 15000,
  });
}

function lanRequest(device, method, pathname, opts = {}) {
  const isHttps = device.porta === 443;
  const scheme = isHttps ? 'https' : 'http';
  const url = `${scheme}://${device.ip}:${device.porta}${pathname}`;
  // control_id usa sessão (na query), não auth por header. Para os demais,
  // request() tenta Basic e cai para Digest se o aparelho exigir (Hikvision).
  const auth =
    device.api_user && device.api_password && device.fabricante !== 'control_id'
      ? { user: device.api_user, pass: device.api_password }
      : undefined;
  return request(url, { method, timeout: LAN_TIMEOUT_MS, auth, ...opts });
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
      headers['Content-Type'] = 'application/json';
    } else if (opts.xml !== undefined) {
      payload = Buffer.from(opts.xml);
      headers['Content-Type'] = 'application/xml';
    } else if (opts.binary !== undefined) {
      payload = opts.binary;
      headers['Content-Type'] = 'application/octet-stream';
    }
    if (payload) headers['Content-Length'] = payload.length;

    const reqOpts = {
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      // Aparelhos de LAN usam certificado self-signed; a rede local é confiável.
      rejectUnauthorized: false,
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
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json') && raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            /* mantém raw */
          }
        }
        resolve({ status: res.statusCode, data, raw });
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

// ---------- Utils ----------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

/**
 * Diretório onde procurar o .env. Quando empacotado como executável (Node SEA),
 * __dirname aponta para um caminho virtual interno — então usamos a pasta do
 * próprio .exe (process.execPath). Rodando via `node index.js`, usa __dirname.
 */
function configDir() {
  try {
    // eslint-disable-next-line global-require
    const sea = require('node:sea');
    if (typeof sea.isSea === 'function' && sea.isSea()) {
      return path.dirname(process.execPath);
    }
  } catch {
    /* node:sea não existe em Node antigo — segue com __dirname */
  }
  return __dirname;
}

/** .env minimalista: KEY=VALUE por linha, ignora # e linhas vazias. */
function loadDotEnv() {
  const file = path.join(configDir(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

process.on('SIGINT', () => {
  console.log('\n[agente] encerrando.');
  process.exit(0);
});
