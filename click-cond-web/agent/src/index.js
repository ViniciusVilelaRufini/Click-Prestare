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
 *   API_URL        Base da API na nuvem. Ex.: https://api.clickprestarecondominios.com.br
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
const fs = require('fs');
const path = require('path');
const { AGENT_VERSION } = require('./versao');
const { buildDigestHeader } = require('./lib/digest');
const { hikIsoComOffset } = require('./lib/dahua-formato');
const { buildMultipart } = require('./lib/multipart');
const {
  lanRequest: lanRequestComTimeout,
  okFrom,
  sleep,
} = require('./lib/http');
const {
  configDir,
  deviceBaselines,
  loadBaselines,
  setBaseline,
} = require('./core/estado');
const { enqueueOfflineEvent, flushOfflineEvents } = require('./core/fila-offline');
const {
  configurar: configurarNuvem,
  cloudRequest,
  agoraDaNuvem,
} = require('./core/nuvem');
const { resolverDriver } = require('./drivers/registro');
const dahuaFacial = require('./drivers/dahua-facial');

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
// core/nuvem.js não lê API_URL global — recebe a config explicitamente.
configurarNuvem({ apiUrl: API_URL });
// Modo condomínio: UM token gerencia todos os dispositivos do condomínio.
let AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
// Modo legado (opcional): um token por dispositivo, separados por vírgula.
let DEVICE_TOKENS = (process.env.DEVICE_TOKENS || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const DEFAULT_POLL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const LAN_TIMEOUT_MS = Number(process.env.LAN_TIMEOUT_MS || 8000);
// lib/http.js não conhece LAN_TIMEOUT_MS (é config de módulo, carregada do
// .env aqui). Este wrapper fecha sobre o valor configurado e mantém todas as
// chamadas a lanRequest(...) espalhadas pelo arquivo inalteradas.
function lanRequest(device, method, pathname, opts) {
  return lanRequestComTimeout(device, method, pathname, opts, LAN_TIMEOUT_MS);
}
// O driver Dahua/Intelbras também fala LAN e não lê `process.env` (fica
// testável isolado) — recebe o mesmo timeout por configurar(), assim como
// core/nuvem.js recebe apiUrl.
dahuaFacial.configurar({ lanTimeoutMs: LAN_TIMEOUT_MS });
// Intervalo do heartbeat de status do aparelho (online/offline no portal).
const DEVICE_STATUS_INTERVAL_MS = Number(
  process.env.DEVICE_STATUS_INTERVAL_MS || 5000,
);
// deviceId → último status online reportado (loga só na mudança).
const lastDeviceOnline = new Map();
// deviceIds já com o `escutar` de algum driver ativo (evita assinar de novo
// a cada poll — mesmo papel do antigo `dahuaListeners`, agora genérico por
// driver; o Supervisor da tarefa 6 assume esse controle).
const driverListenersAtivos = new Set();
// deviceId → maior RecNo/serialNo/ID de log de acesso já processado no
// dispositivo (Map + funções de leitura/gravação em core/estado.js).
loadBaselines();

// Devices do último poll (p/ o servidor de live view achar IP/credencial).
let lastDevices = [];
// Porta local do preview ao vivo (só localhost; o navegador da portaria acessa).
const LIVEVIEW_PORT = Number(process.env.LIVEVIEW_PORT || 8788);

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

  console.log(`[agente] iniciando — versão ${AGENT_VERSION} — API: ${API_URL}`);
  startLiveViewServer(); // preview ao vivo da câmera (localhost) p/ o cadastro
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
  const urlIn = await ask('1) URL da API na nuvem (ex.: https://api.clickprestarecondominios.com.br): ');
  console.log('\n2) No portal, em Terminais de Dispositivos, clique "Copiar URL Webhook"');
  console.log('   em QUALQUER dispositivo e cole aqui (pode colar a URL inteira):');
  const tokenIn = await ask('   Token/URL: ');
  rl.close();

  API_URL = urlIn.replace(/\/+$/, '');
  AGENT_TOKEN = extractToken(tokenIn);
  configurarNuvem({ apiUrl: API_URL });

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
  let lastStatusAt = 0; // throttle do heartbeat de status do aparelho

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
      // Cache p/ o servidor de live view (localhost) saber IP/credenciais.
      lastDevices = (body.devices || []).map((e) => e.device).filter(Boolean);

      // Poll respondeu = nuvem alcançável → reenvia eventos guardados durante
      // a queda de internet (store-and-forward). Roda em background.
      void flushOfflineEvents(token);

      for (const entry of body.devices || []) {
        const device = entry.device;
        // Aparelhos Dahua/Intelbras: abre (uma vez) o stream de eventos de
        // acesso do driver e repassa cada reconhecimento para a nuvem. A
        // Supervisor da tarefa 6 assume esse "uma vez por device"; por ora
        // é este Set aqui mesmo (mesmo papel do antigo `dahuaListeners`).
        const driverDoDevice = resolverDriver(device);
        if (driverDoDevice && driverDoDevice.escutar && !driverListenersAtivos.has(device.id)) {
          driverListenersAtivos.add(device.id);
          console.log(`[agente] ${device.nome}: assinando eventos de acesso (${driverDoDevice.id})`);
          driverDoDevice.escutar(device, (data) => forwardAccessEvent(token, device, data));
        }
        if (device.fabricante === 'hikvision') {
          startHikvisionEventListener(token, device);
        }
        if (device.fabricante === 'control_id') {
          startControlIdEventListener(token, device);
        }
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

      // Heartbeat de status do aparelho (throttled ~20s): pinga cada device na
      // LAN e reporta, para o portal mostrar online/offline automaticamente.
      if (Date.now() - lastStatusAt >= DEVICE_STATUS_INTERVAL_MS) {
        lastStatusAt = Date.now();
        const statuses = [];
        for (const entry of body.devices || []) {
          const device = entry.device;
          let online = false;
          try {
            const r = await doPing(device);
            online = !!r.ok;
          } catch {
            online = false;
          }
          statuses.push({ deviceId: device.id, online });
          // Loga só na MUDANÇA de estado (evita spam a cada 20s).
          if (lastDeviceOnline.get(device.id) !== online) {
            lastDeviceOnline.set(device.id, online);
            console.log(
              `[agente] ${device.nome}: aparelho ${online ? 'ONLINE' : 'OFFLINE'}`,
            );
            if (online) {
              // Transição offline→online: recupera a janela que a stream perdeu
              // e acerta o relógio (ele deriva; ver dahuaFacial.acertarRelogio).
              syncDeviceOfflineLogs(token, device).catch((e) =>
                console.error(`[agente] ${device.nome}: erro ao sincronizar acessos offline:`, e.message || e)
              );
              resolverDriver(device)?.acertarRelogio?.(device, true)?.catch(() => {});
            }
          } else if (online) {
            // Online estável: só mantém a marca d'água atual (a stream já cobre
            // os eventos); assim o próximo reconnect só reprocessa a janela real.
            const driverDoDevice = resolverDriver(device);
            driverDoDevice?.advanceBaselineWhileOnline?.(device)?.catch(() => {});
            driverDoDevice?.acertarRelogio?.(device)?.catch(() => {});
          }
        }
        if (statuses.length > 0) {
          await cloudRequest(
            'POST',
            `/api/facial/agent/condo/${token}/device-status`,
            { statuses },
          ).catch(() => {});
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
  // Dahua/Intelbras já fala pelo contrato de driver (src/drivers). Hikvision
  // e Control iD ainda ficam no switch abaixo — migram na tarefa 5.
  const driver = resolverDriver(device);
  if (driver) {
    try {
      return await driver.executar(device, cmd);
    } catch (err) {
      return {
        ok: false,
        statusCode: err.statusCode,
        error: err.message || String(err),
      };
    }
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
      case 'snapshot':
        return await doSnapshot(device);
      case 'list_users':
        return await doListUsers(device);
      case 'remove_users':
        return await doRemoveUsers(device, cmd);
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

/** Captura um quadro (JPEG) da câmera do facial e devolve em base64. */
async function doSnapshot(device) {
  // Hikvision: ISAPI entrega o quadro direto, sem controle de iluminação
  // (o terminal já expõe o canal 101 como stream principal).
  if (device.fabricante === 'hikvision') {
    const res = await lanRequest(
      device,
      'GET',
      '/ISAPI/Streaming/channels/101/picture',
    );
    if (
      !(res.status >= 200 && res.status < 300) ||
      !res.buffer ||
      res.buffer.length < 100
    ) {
      return {
        ok: false,
        statusCode: res.status,
        error: 'o aparelho não retornou imagem',
      };
    }
    return { ok: true, imageBase64: res.buffer.toString('base64') };
  }
  // Dahua/Intelbras usa o driver (src/drivers/dahua-facial.js) via
  // executeOnDevice; chegar aqui com esse fabricante não deveria acontecer.
  return {
    ok: false,
    error: `Captura por câmera não suportada para ${device.fabricante}.`,
  };
}

// ---------- Preview ao vivo (servidor local MJPEG por snapshots) ----------
//
// O aparelho NÃO expõe MJPEG (só RTSP H.264, que o browser não toca nativo).
// Então montamos um multipart/x-mixed-replace a partir de snapshots rápidos.
// Roda só em localhost: o navegador do PC da portaria (mesma rede da câmera)
// consome direto — sem a latência da nuvem. ~3 fps (teto do snapshot).
//
// O protocolo por trás (iluminação, snapshot com Digest) é só Dahua/Intelbras
// e mora no driver (`dahuaFacial.setDeviceLightingMode`/`snapshotComDigest`)
// — aqui só orquestramos o servidor HTTP local e o loop de quadros.

function startLiveViewServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const reqPath = (req.url || '').split('?')[0];
    if (reqPath !== '/liveview' && reqPath !== '/snapshot') {
      res.writeHead(404);
      return res.end('not found');
    }
    const device = lastDevices.find((d) => resolverDriver(d) === dahuaFacial);
    if (!device) {
      res.writeHead(503);
      return res.end('nenhum terminal facial conectado');
    }
    if (reqPath === '/snapshot') {
      dahuaFacial
        .snapshotComDigest(device, {})
        .then((jpeg) => {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-store',
          });
          res.end(jpeg);
        })
        .catch(() => {
          res.writeHead(502);
          res.end('falha ao capturar');
        });
      return;
    }
    streamLiveView(device, res);
  });
  server.on('error', (e) =>
    console.error(
      `[agente] preview ao vivo não subiu (porta ${LIVEVIEW_PORT}): ${e.message}`,
    ),
  );
  server.listen(LIVEVIEW_PORT, '127.0.0.1', () =>
    console.log(
      `[agente] preview ao vivo em http://localhost:${LIVEVIEW_PORT}/liveview`,
    ),
  );
}

async function streamLiveView(device, res) {
  const boundary = 'liveviewframe';
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
    Connection: 'close',
  });
  let alive = true;
  res.on('close', () => {
    alive = false;
  });

  // Liga o flash automaticamente antes do preview
  await dahuaFacial.setDeviceLightingMode(device, 'Manual').catch(() => {});

  const st = {}; // estado do Digest (reusa o nonce entre quadros = mais fps)
  let lastLightOnAt = 0;
  while (alive) {
    let jpeg = null;
    try {
      // Reforça o comando de acendimento do LED a cada 800ms em segundo plano para evitar que o firmware o desligue por inatividade
      if (Date.now() - lastLightOnAt > 800) {
        lastLightOnAt = Date.now();
        void dahuaFacial.setDeviceLightingMode(device, 'Manual').catch(() => {});
      }
      jpeg = await dahuaFacial.snapshotComDigest(device, st);
    } catch {
      /* tenta no próximo ciclo */
    }
    if (!alive) break;
    if (jpeg && jpeg.length > 500) {
      try {
        res.write(
          `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
        );
        res.write(jpeg);
        res.write('\r\n');
      } catch {
        break;
      }
    } else {
      await sleep(150);
    }
  }

  // Restaura para automático após o fim do preview
  await dahuaFacial.setDeviceLightingMode(device, 'Auto').catch(() => {});

  try {
    res.end();
  } catch {
    /* já fechou */
  }
}

async function doPing(device) {
  if (device.fabricante === 'control_id') {
    await controlIdLogin(device); // login OK prova conectividade
    return { ok: true };
  }
  const driver = resolverDriver(device);
  if (driver) {
    // Dahua/Intelbras: ver `testar` no driver (não usa login RPC2 — estouraria
    // o limite de sessões do aparelho com o heartbeat repetindo a cada 20s).
    return driver.testar(device);
  }
  if (device.fabricante === 'hikvision') {
    // ISAPI: deviceInfo prova rede + credencial (Digest tratado em request()).
    const res = await lanRequest(device, 'GET', '/ISAPI/System/deviceInfo');
    return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
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
  // Dahua/Intelbras: abre pelo driver (executeOnDevice já delegou antes de
  // chegar aqui; este ponto só existe para fabricantes sem driver ainda).
  const map = {
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
  if (device.fabricante === 'hikvision') {
    return hikvisionEnroll(device, cmd);
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
  if (device.fabricante === 'hikvision') {
    const employeeNo = String(cmd.faceId);
    // Remove o rosto da FDLib.
    await lanRequest(
      device,
      'PUT',
      '/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD',
      { json: { FPID: [{ value: employeeNo }] } },
    ).catch(() => undefined);
    // Remove o usuário.
    const res = await lanRequest(
      device,
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Delete?format=json',
      { json: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } } },
    );
    return okFrom(res);
  }
  const res = await lanRequest(device, 'DELETE', `/persons/${cmd.faceId}`);
  if (res.status === 404) return { ok: true }; // já não existia
  return okFrom(res);
}

/**
 * Identificador que NÓS gravamos no aparelho ("morador_42", "visitante_9",
 * "prestador_servico_3").
 *
 * A varredura de fantasmas apaga tudo que está no aparelho e não está no nosso
 * banco. Num terminal Hikvision ou Control iD, "tudo" inclui o usuário admin
 * que o instalador criou no próprio aparelho — apagá-lo trancaria o instalador
 * para fora. Restringir a listagem ao nosso padrão mantém a varredura fazendo
 * o trabalho dela (o fantasma que buscamos SEMPRE tem esse formato, porque fomos
 * nós que o cadastramos) sem tocar em quem não é nosso.
 *
 * Não vale para Intelbras: lá o UserID é livre e o comportamento atual (varrer
 * tudo) já roda em produção — mudá-lo deixaria lixo antigo sem limpeza.
 */
const NOSSO_EXTERNAL_ID = /^(morador|visitante|prestador_servico)_\d+$/;

async function doListUsers(device) {
  // Hikvision: ISAPI pagina por searchResultPosition; o employeeNo é o nosso
  // external_id (= face_id gravado no enrollment).
  if (device.fabricante === 'hikvision') {
    const ids = [];
    const PAGE = 50;
    let pos = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await lanRequest(
        device,
        'POST',
        '/ISAPI/AccessControl/UserInfo/Search?format=json',
        {
          json: {
            UserInfoSearchCond: {
              searchID: 'click-list-users',
              searchResultPosition: pos,
              maxResults: PAGE,
            },
          },
        },
      );
      if (!(resp.status >= 200 && resp.status < 300)) {
        return { ok: false, error: `Falha ao listar usuários (HTTP ${resp.status})` };
      }
      const search = (resp.data && resp.data.UserInfoSearch) || {};
      const list = search.UserInfo || [];
      for (const u of list) {
        if (u.employeeNo && NOSSO_EXTERNAL_ID.test(String(u.employeeNo))) {
          ids.push(String(u.employeeNo));
        }
      }
      // Pagina sobre TODOS os usuários (inclusive os que filtramos), senão a
      // varredura pararia cedo e deixaria fantasmas nas páginas seguintes.
      pos += list.length;
      // "MORE" indica que ainda há páginas; qualquer outro status encerra.
      if (list.length === 0 || search.responseStatusStrg !== 'MORE') break;
    }
    return { ok: true, userIds: ids };
  }

  // Control iD: o face_id gravado é o id INTERNO do usuário (ver controlIdCreate).
  if (device.fabricante === 'control_id') {
    const session = await controlIdLogin(device);
    const resp = await lanRequest(
      device,
      'POST',
      `/load_objects.fcgi?session=${session}`,
      { json: { object: 'users' } },
    );
    if (!(resp.status >= 200 && resp.status < 300)) {
      return { ok: false, error: `Falha ao listar usuários (HTTP ${resp.status})` };
    }
    // O face_id do Control iD é o id INTERNO, indistinguível de um usuário
    // criado no próprio aparelho — quem identifica os nossos é o campo
    // `registration`, onde gravamos o external_id no enrollment.
    const users = (resp.data && resp.data.users) || [];
    return {
      ok: true,
      userIds: users
        .filter((u) => u.id != null && NOSSO_EXTERNAL_ID.test(String(u.registration ?? '')))
        .map((u) => String(u.id)),
    };
  }

  // Dahua/Intelbras já saiu por `executeOnDevice` antes de chegar aqui.
  return { ok: false, error: `list_users não suportado para ${device.fabricante}` };
}

async function doRemoveUsers(device, cmd) {
  // Hikvision e Control iD não têm remoção em lote equivalente ao RPC2: cai
  // para remoção individual, reusando o caminho já validado do doRemove. Uma
  // falha isolada não aborta o lote — a varredura de fantasmas roda de hora em
  // hora e tenta de novo o que sobrou.
  if (device.fabricante === 'hikvision' || device.fabricante === 'control_id') {
    const alvos = cmd.faceIds || [];
    if (alvos.length === 0) return { ok: true };
    const falhas = [];
    for (const faceId of alvos) {
      try {
        const r = await doRemove(device, { faceId });
        if (!r.ok && r.statusCode !== 404) falhas.push(faceId);
      } catch {
        falhas.push(faceId);
      }
    }
    if (falhas.length > 0) {
      return {
        ok: false,
        error: `falha ao remover ${falhas.length}/${alvos.length} usuário(s): ${falhas.slice(0, 10).join(', ')}`,
      };
    }
    return { ok: true };
  }

  // Dahua/Intelbras já saiu por `executeOnDevice` antes de chegar aqui.
  return { ok: false, error: `remove_users não suportado para ${device.fabricante}` };
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

// Login e enroll Dahua/Intelbras (RPC2, AccessUser/AccessFace) moveram para src/drivers/dahua-facial.js.

// ---------- Hikvision ISAPI: enroll/remove ----------

/** Hikvision ISAPI: cria/atualiza o usuário e sobe o rosto. employeeNo = externalId. */
async function hikvisionEnroll(device, cmd) {
  const employeeNo = String(cmd.externalId || cmd.faceId);
  const nome = cmd.nome || employeeNo;
  // Hikvision quer ISO 8601 local; default permanente. Converte "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS".
  const toIso = (s, fb) => (s ? s.replace(' ', 'T') : fb);
  const beginTime = toIso(cmd.validFrom, '2000-01-01T00:00:00');
  const endTime = toIso(cmd.validTo, '2037-12-31T23:59:59');

  const userBody = {
    UserInfo: [
      {
        employeeNo,
        name: nome,
        userType: 'normal',
        Valid: { enable: true, beginTime, endTime, timeType: 'local' },
        doorRight: '1',
        RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
      },
    ],
  };
  // Cria; se já existir, o aparelho devolve erro → cai para Modify.
  let u = await lanRequest(
    device,
    'POST',
    '/ISAPI/AccessControl/UserInfo/Record?format=json',
    { json: userBody },
  );
  if (!(u.status >= 200 && u.status < 300) || /error|fail/i.test(String(u.raw || ''))) {
    u = await lanRequest(
      device,
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Modify?format=json',
      { json: userBody },
    );
  }
  if (!(u.status >= 200 && u.status < 300)) {
    return { ok: false, statusCode: u.status, error: `usuário: ${String(u.raw || '').slice(0, 120)}` };
  }

  if (cmd.fotoBase64) {
    const jpeg = Buffer.from(cmd.fotoBase64, 'base64');
    const mp = buildMultipart([
      { name: 'FaceDataRecord', json: { faceLibType: 'blackFD', FDID: '1', FPID: employeeNo } },
      { name: 'img', jpeg, filename: 'face.jpg' },
    ]);
    const f = await lanRequest(
      device,
      'POST',
      '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
      { binary: mp.body, headers: { 'Content-Type': mp.contentType } },
    );
    if (!(f.status >= 200 && f.status < 300) || /error|fail/i.test(String(f.raw || ''))) {
      return { ok: false, statusCode: f.status, error: `rosto recusado: ${String(f.raw || '').slice(0, 120)}`, faceId: employeeNo };
    }
  }
  return { ok: true, faceId: employeeNo };
}

// ---------- Dahua: stream de eventos de acesso -> nuvem ----------
//
// O protocolo (attach multipart, parse de _DoorFace_) mora no driver
// (dahuaFacial.escutar) -- ver o dispatch em runCondoLoop, que chama
// escutar(device, (data) => forwardAccessEvent(token, device, data)).

// Debounce na ORIGEM: o aparelho dispara vários _DoorFace_ por aproximação
// (múltiplos frames). Sem isso, vários POSTs concorrentes chegariam à nuvem e
// poderiam embaralhar a alternância entrada/saída. Guardamos o último envio por
// (device, UserID) e ignoramos repetições dentro da janela. O check+set é
// síncrono (antes de qualquer await), então é seguro contra a rajada.
const AGENT_EVENT_DEBOUNCE_MS = 8000;
const lastAccessForwardedAt = new Map(); // "deviceId:userId" -> epoch ms

// ---------- Store-and-forward: fila em disco para eventos offline ----------
// `enqueueOfflineEvent`/`flushOfflineEvents` moveram para core/fila-offline.js.

/**
 * Repassa um reconhecimento facial para a nuvem (ignora não-reconhecidos).
 * opts.backlog = replay de evento antigo (log do aparelho / fila offline):
 * vai marcado para a nuvem só auditar (sem acionar abertura/push) e NÃO
 * passa pelo debounce — registros históricos do mesmo usuário chegam em
 * rajada e são todos legítimos.
 */
async function forwardAccessEvent(token, device, data, opts = {}) {
  const userId = data && data.UserID;
  // FFFFFF = rosto não reconhecido; não vira evento de pessoa.
  if (!userId || userId === 'FFFFFF') return;
  // Reconhecimento NEGADO pelo próprio aparelho (ex.: sem saldo de usos,
  // fora da validade): o rosto foi identificado mas a porta NÃO abriu.
  // Encaminhar isso como acesso viraria entrada/saída falsa na auditoria.
  if (data.ErrorCode != null && String(data.ErrorCode).trim() !== '0') {
    console.log(
      `[agente] ${device.nome}: reconhecimento NEGADO no aparelho ignorado (${userId}, ErrorCode ${data.ErrorCode})`,
    );
    return;
  }

  // Debounce por (device, UserID): colapsa a rajada de frames de uma aproximação
  // num único evento. Síncrono antes do await → imune à corrida da rajada.
  if (!opts.backlog) {
    const key = `${device.id}:${userId}`;
    const agora = Date.now();
    const ultimo = lastAccessForwardedAt.get(key) || 0;
    if (agora - ultimo < AGENT_EVENT_DEBOUNCE_MS) return;
    lastAccessForwardedAt.set(key, agora);
  }

  // Sem timestamp do aparelho, carimba com a hora da NUVEM — não a desta
  // máquina, que pode estar minutos fora (ver `agoraDaNuvem`).
  const eventTimestamp = data.timestamp
    ? new Date(data.timestamp).toISOString()
    : agoraDaNuvem().toISOString();

  const body = {
    deviceId: device.id,
    external_id: String(userId),
    person_id: String(userId),
    event: 'recognized',
    // Similarity vem 0-100; a nuvem guarda a confiança como fração 0-1 (a tela
    // multiplica por 100 na exibição). Sem dividir, 86 vira "8600%".
    confidence:
      typeof data.Similarity === 'number' ? data.Similarity / 100 : undefined,
    timestamp: eventTimestamp,
    ...(opts.backlog ? { backlog: true } : {}),
  };

  try {
    const res = await cloudRequest('POST', `/api/facial/agent/condo/${token}/event`, body);
    const ok = res.status >= 200 && res.status < 300;
    console.log(
      `[agente] ${device.nome} ◂ acesso ${userId} (${data.Similarity ?? '?'}%) [${eventTimestamp}] → ${
        ok
          ? 'OK'
          : // Sem o CORPO da resposta, "HTTP 400" não diz qual validação falhou e
            // o diagnóstico vira adivinhação. Alguém passou pela porta: se a
            // nuvem recusou, o motivo precisa estar no log.
            `nuvem recusou HTTP ${res.status}: ${String(res.raw || '').slice(0, 200)}`
      }`,
    );
    // 5xx = nuvem fora do ar. 401/404 = token piscando (device reativando no
    // portal). 408/429 = timeout e throttle. Todos transitórios: guarda para
    // reenvio. Só o 4xx de validação (400/403/422) é definitivo — reenviar daria
    // o mesmo erro para sempre, e o log acima já registra o motivo.
    const valeReenviar =
      res.status >= 500 || [401, 404, 408, 429].includes(res.status);
    if (valeReenviar) enqueueOfflineEvent(body, device.nome);
    // Evento AO VIVO (não backlog): avança a marca d'água para incluir o RecNo
    // deste acesso ANTES de um eventual offline. Assim a recuperação reenviará
    // só os eventos realmente perdidos, sem sobrepor os que a stream já pegou.
    //
    // Só avança se a nuvem ACEITOU. Avançar após uma recusa apagava o evento
    // duas vezes: ele não entrou na nuvem e a marca d'água passava por cima
    // dele, então o replay do próximo reconnect também não o veria.
    if (!opts.backlog && ok) {
      resolverDriver(device)?.advanceBaselineWhileOnline?.(device, true)?.catch(() => {});
    }
    return ok;
  } catch (err) {
    console.error(
      `[agente] ${device.nome}: falha ao enviar acesso ${userId}: ${err.message || err}`,
    );
    // Sem internet: guarda em disco e reenvia quando a nuvem voltar.
    enqueueOfflineEvent(body, device.nome);
    return false;
  }
}

// ---------- Hikvision: stream de eventos de acesso → nuvem ----------

const hikListeners = new Set();

function startHikvisionEventListener(token, device) {
  if (hikListeners.has(device.id)) return;
  hikListeners.add(device.id);
  console.log(`[agente] ${device.nome}: assinando eventos de acesso (Hikvision)`);
  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await hikvisionAlertOnce(token, device);
      } catch (err) {
        console.error(
          `[agente] ${device.nome}: stream Hikvision caiu (${err.message || err}); reabrindo em 5s`,
        );
      }
      await sleep(5000);
    }
  })();
}

/** Abre UMA conexão alertStream (Digest) e processa enquanto o aparelho mantém. */
function hikvisionAlertOnce(token, device) {
  return new Promise((resolve, reject) => {
    const user = device.api_user || 'admin';
    const pass = device.api_password || 'admin';
    const path = '/ISAPI/Event/notification/alertStream';
    const challenge = http.request(
      { host: device.ip, port: device.porta, path, method: 'GET' },
      (cres) => {
        cres.resume();
        if (cres.statusCode !== 401) return reject(new Error(`desafio inesperado: HTTP ${cres.statusCode}`));
        const wa = cres.headers['www-authenticate'] || '';
        if (!/digest/i.test(wa)) return reject(new Error('aparelho não pediu Digest'));
        const auth = buildDigestHeader(user, pass, 'GET', path, wa);
        const stream = http.request(
          { host: device.ip, port: device.porta, path, method: 'GET', headers: { Authorization: auth } },
          (sres) => {
            if (sres.statusCode !== 200) { sres.resume(); return reject(new Error(`alertStream HTTP ${sres.statusCode}`)); }
            let buf = '';
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              buf += chunk;
              buf = consumeHikvisionEvents(buf, (data) => forwardAccessEvent(token, device, data));
              if (buf.length > 1_000_000) buf = buf.slice(-100_000);
            });
            sres.on('end', resolve);
            sres.on('error', reject);
          },
        );
        stream.on('error', reject);
        stream.setTimeout(0);
        stream.end();
      },
    );
    challenge.on('error', reject);
    challenge.setTimeout(LAN_TIMEOUT_MS, () => challenge.destroy(new Error('timeout no desafio')));
    challenge.end();
  });
}

/**
 * Extrai eventos AccessControllerEvent completos do buffer e os normaliza para o
 * formato que forwardAccessEvent espera ({ UserID, Similarity }). Hikvision usa
 * employeeNoString (= nosso external_id) e currentVerifyMode/faceRect.
 *
 * Emite assim que o evento está COMPLETO, sem esperar o boundary que fecha a
 * parte — esse boundary só chega junto com o evento SEGUINTE, então quem
 * esperasse por ele só encaminharia o acesso quando a próxima pessoa passasse
 * (e ainda o carimbaria com a hora errada). Mesmo cuidado em consumeDahuaEvents.
 */
function consumeHikvisionEvents(buf, onData) {
  let restante = buf;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fim = fimDoEventoHikvision(restante);
    if (fim < 0) break;
    const bloco = restante.slice(0, fim);
    restante = restante.slice(fim);
    const dados = parseEventoHikvision(bloco);
    // Tratamos "tem employeeNo" como reconhecido. Sem employeeNo = ignora.
    if (dados) onData(dados);
  }
  return restante;
}

/**
 * Índice onde termina o PRIMEIRO evento completo do buffer, ou -1 se ainda não
 * chegou inteiro. Aceita as duas formas do corpo: XML (fecha em
 * `</EventNotificationAlert>`) e JSON (fecha ao balancear as chaves).
 */
function fimDoEventoHikvision(buf) {
  const TAG_FIM = '</EventNotificationAlert>';
  const iXml = buf.indexOf(TAG_FIM);
  const iJson = buf.indexOf('{');
  if (iXml >= 0 && (iJson < 0 || iXml < iJson)) return iXml + TAG_FIM.length;
  if (iJson < 0) return -1;
  return fimDoObjetoJson(buf, iJson);
}

/** Fim do objeto JSON iniciado em `inicio` (respeita chaves dentro de string). */
function fimDoObjetoJson(buf, inicio) {
  let profundidade = 0;
  let emString = false;
  let escapado = false;
  for (let i = inicio; i < buf.length; i++) {
    const c = buf[i];
    if (emString) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') emString = true;
    else if (c === '{') profundidade++;
    else if (c === '}' && --profundidade === 0) return i + 1;
  }
  return -1;
}

/** Bloco cru da stream → { UserID, Similarity }, ou null se não der acesso. */
function parseEventoHikvision(bloco) {
  if (!bloco.includes('AccessControllerEvent')) return null;
  const iJson = bloco.indexOf('{');
  if (iJson >= 0) {
    try {
      const ev = JSON.parse(bloco.slice(iJson)).AccessControllerEvent || {};
      const emp = ev.employeeNoString ?? ev.employeeNo;
      if (!emp) return null;
      return { UserID: String(emp), Similarity: ev.similarity ?? 90 };
    } catch {
      return null; // parcial/inválido
    }
  }
  const tag = (nome) => {
    const m = bloco.match(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'i'));
    return m ? m[1].trim() : '';
  };
  const emp = tag('employeeNoString') || tag('employeeNo');
  if (!emp) return null;
  const similaridade = Number(tag('similarity'));
  return {
    UserID: emp,
    Similarity: Number.isFinite(similaridade) && similaridade > 0 ? similaridade : 90,
  };
}

// ---------- Control iD: polling de eventos de acesso → nuvem ----------
//
// Diferente de Dahua/Hikvision, o Control iD não expõe stream de eventos: o
// caminho nativo é o aparelho fazer PUSH para a nuvem (Monitor/object_changes).
// Esse push exige que o terminal alcance a internet e esteja configurado — o
// que nem sempre acontece na instalação. Este poller é a rede de segurança:
// lê access_logs novos direto na LAN, com a MESMA marca d'água usada pelo
// replay offline (deviceBaselines), então nenhum acesso é enviado duas vezes.
// Se o push nativo já tiver entregue o evento, a dedup da nuvem o descarta.

const controlIdListeners = new Set();
const CONTROLID_POLL_MS = 3000;

function startControlIdEventListener(token, device) {
  if (controlIdListeners.has(device.id)) return;
  controlIdListeners.add(device.id);
  console.log(`[agente] ${device.nome}: monitorando acessos (Control iD, polling)`);
  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const logs = await controlIdFetchNewLogs(device);
        for (const log of logs) {
          const ok = await forwardAccessEvent(token, device, {
            UserID: String(log.user_id),
            Similarity: 100,
            timestamp: new Date(log.time * 1000).toISOString(),
          });
          // Só avança a marca d'água no que a nuvem confirmou — mesmo critério
          // do replay offline; senão um acesso recusado sumiria para sempre.
          if (ok) setBaseline(device.id, log.id);
          else break;
        }
      } catch (err) {
        console.error(
          `[agente] ${device.nome}: falha ao ler acessos (Control iD): ${err.message || err}`,
        );
      }
      await sleep(CONTROLID_POLL_MS);
    }
  })();
}

/**
 * Lê os access_logs mais recentes do Control iD e devolve, em ordem crescente,
 * só os que passaram da marca d'água. Na primeira leitura apenas estabelece a
 * baseline (não reprocessa o histórico do aparelho).
 *
 * Ordena DESC no aparelho: `asc` traz os 50 registros MAIS ANTIGOS, que num
 * terminal em uso já estão muito abaixo da baseline — nunca chegaria evento.
 */
async function controlIdFetchNewLogs(device) {
  const session = await controlIdLogin(device);
  const res = await lanRequest(
    device,
    'POST',
    `/load_objects.fcgi?session=${session}`,
    { json: { object: 'access_logs', order: ['id', 'desc'], limit: 50 } },
  );
  const logs = (res.data && res.data.access_logs) || [];
  const baseline = deviceBaselines.get(device.id);
  if (!Array.isArray(logs) || logs.length === 0) {
    // Aparelho ainda sem nenhum acesso (recém-instalado ou pós-reset): fixa a
    // marca d'água em 0 AGORA. Sem isso, a baseline continuava indefinida e o
    // PRIMEIRO acesso da vida do aparelho era consumido só para inicializá-la
    // — a passagem nunca chegava à nuvem.
    if (baseline === undefined) setBaseline(device.id, 0);
    return [];
  }
  if (baseline === undefined) {
    const maxId = Math.max(...logs.map((l) => l.id).filter(Boolean));
    setBaseline(device.id, maxId);
    console.log(
      `[agente] ${device.nome}: baseline de acessos inicializada em ID ${maxId} (Control iD).`,
    );
    return [];
  }
  return logs
    .filter((l) => l.id > baseline && l.user_id)
    .sort((a, b) => a.id - b.id);
}

// ---------- HTTP helpers ----------
// Skew do relógio da nuvem (`registrarSkewDaNuvem`/`agoraDaNuvem`) e
// `cloudRequest` moveram para core/nuvem.js. `configDir` moveu para
// core/estado.js.

// ---------- Utils ----------

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

// Janela que o replay da Hikvision varre ao reconectar. 24h cobre uma queda
// longa de internet sem trazer o histórico inteiro do aparelho.
const HIK_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function syncDeviceOfflineLogs(token, device) {
  // Dahua / Intelbras — recupera acessos que ocorreram enquanto o agente
  // estava sem alcançar o aparelho (ex.: internet/energia do facial caiu). A
  // stream ao vivo não os viu; eles ficaram só no log interno do terminal.
  // O protocolo (recordFinder.cgi, parse INI) mora no driver — `buscarDesde`
  // só lê e devolve; quem manda para a nuvem e decide até onde persistir a
  // marca d'água (represar no primeiro envio que falhar) é este orquestrador.
  const driver = resolverDriver(device);
  if (driver && driver.buscarDesde) {
    if (dahuaFacial.offlineSyncBusy.has(device.id)) return;
    dahuaFacial.offlineSyncBusy.add(device.id);
    try {
      const baseline = deviceBaselines.get(device.id);
      const { eventos, novaMarca } = await driver.buscarDesde(device, baseline);

      if (baseline === undefined) {
        // Primeira vez: estabelece a marca d'água SEM reprocessar o histórico.
        if (novaMarca !== undefined) {
          setBaseline(device.id, novaMarca);
          console.log(`[agente] ${device.nome}: baseline de acessos inicializada em RecNo ${novaMarca}.`);
        } else {
          console.log(`[agente] ${device.nome}: log de acesso vazio.`);
        }
        return;
      }
      if (novaMarca === undefined || novaMarca <= baseline) {
        console.log(
          `[agente] ${device.nome}: recovery sem novidade (maior RecNo ${novaMarca} <= baseline ${baseline}).`,
        );
        return;
      }

      let enviados = 0;
      let falhas = 0;
      // Até onde é seguro avançar a marca d'água: o maior RecNo confirmado
      // pela nuvem antes do primeiro envio que falhar (esses não voltam
      // mesmo, não adianta represá-los).
      let ultimoConfirmado = baseline;
      for (const ev of eventos) {
        console.log(
          `[agente] ${device.nome}: replay RecNo ${ev._marca} UserID ${ev.UserID} timestamp ${ev.timestamp}`,
        );
        const ok = await forwardAccessEvent(token, device, ev, { backlog: true });
        if (ok) {
          enviados++;
          if (falhas === 0) ultimoConfirmado = ev._marca;
        } else {
          falhas++;
        }
      }

      // A marca d'água só avança até o último acesso que a nuvem CONFIRMOU.
      // Antes ela ia direto para `novaMarca` mesmo com envios falhando — o
      // reconnect seguinte via "sem novidade" e as passagens recusadas sumiam
      // do histórico para sempre. Represar o watermark faz o próximo ciclo
      // tentar de novo; o `backlog: true` e a deduplicação na nuvem cuidam de
      // reenvio repetido.
      if (falhas > 0) {
        setBaseline(device.id, ultimoConfirmado);
        console.error(
          `[agente] ${device.nome}: recuperados ${enviados} acesso(s), ${falhas} FALHARAM. ` +
          `Baseline represada em RecNo ${ultimoConfirmado} (não avançou até ${novaMarca}) — ` +
          `nova tentativa no próximo ciclo.`,
        );
      } else {
        // Sem falhas: avança até a maior marca lida (`buscarDesde` já excluiu
        // do array `eventos` o que foi filtrado por UserID vazio/negado, mas
        // `novaMarca` cobre esses registros também — nunca virariam evento).
        setBaseline(device.id, novaMarca);
        console.log(`[agente] ${device.nome}: recuperados ${enviados} acesso(s) offline (RecNo ${baseline}→${novaMarca}).`);
      }
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ler log de acesso do Intelbras:`, err.message || err);
    } finally {
      dahuaFacial.offlineSyncBusy.delete(device.id);
    }
  }

  // Hikvision
  if (device.fabricante === 'hikvision') {
    try {
      console.log(`[agente] ${device.nome}: iniciando sincronização de acessos offline (Hikvision)...`);
      // Janela de tempo em vez de posição: sem startTime/endTime, o ISAPI
      // devolve os 50 eventos MAIS ANTIGOS do aparelho — num terminal em uso
      // eles ficam muito abaixo da marca d'água e nada seria recuperado.
      const agora = agoraDaNuvem();
      const desde = new Date(agora.getTime() - HIK_REPLAY_WINDOW_MS);
      const res = await lanRequest(
        device,
        'POST',
        '/ISAPI/AccessControl/AcsEvent?format=json',
        {
          json: {
            AcsEventCond: {
              searchID: "agent-offline-sync",
              searchResultPosition: 0,
              maxResults: 50,
              major: 0,
              minor: 0,
              startTime: hikIsoComOffset(desde),
              endTime: hikIsoComOffset(agora),
            }
          }
        }
      );
      const infoList = res.data && res.data.AcsEvent && res.data.AcsEvent.InfoList;
      if (!Array.isArray(infoList) || infoList.length === 0) {
        return;
      }

      infoList.sort((a, b) => (a.serialNo || 0) - (b.serialNo || 0));

      const baseline = deviceBaselines.get(device.id);
      if (baseline === undefined) {
        const maxSerial = Math.max(...infoList.map(l => l.serialNo).filter(Boolean));
        setBaseline(device.id, maxSerial);
        console.log(`[agente] ${device.nome}: baseline de acessos offline inicializada em Serial ${maxSerial}`);
        return;
      }

      let processedCount = 0;
      for (const log of infoList) {
        const serial = log.serialNo || 0;
        if (serial <= baseline) continue;
        if (log.employeeNoString) {
          const ok = await forwardAccessEvent(token, device, {
            UserID: log.employeeNoString,
            Similarity: 100,
            timestamp: log.time,
          }, { backlog: true });
          // Represa na primeira falha (mesmo critério do Intelbras/Control iD):
          // avançar após recusa apagaria a passagem do histórico para sempre.
          if (!ok) break;
        }
        setBaseline(device.id, serial);
        processedCount++;
      }
      console.log(`[agente] ${device.nome}: processou ${processedCount} novos acessos offline (Hikvision).`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ler logs do dispositivo Hikvision:`, err.message || err);
    }
  }

  // Control iD — mesma leitura do poller ao vivo (marca d'água compartilhada),
  // só que marcada como backlog: são passagens que já aconteceram, então a
  // nuvem registra na auditoria sem acionar abertura automática.
  if (device.fabricante === 'control_id') {
    try {
      console.log(`[agente] ${device.nome}: iniciando sincronização de acessos offline (Control iD)...`);
      const novos = await controlIdFetchNewLogs(device);
      let processedCount = 0;
      for (const log of novos) {
        const ok = await forwardAccessEvent(
          token,
          device,
          {
            UserID: String(log.user_id),
            Similarity: 100,
            timestamp: new Date(log.time * 1000).toISOString(),
          },
          { backlog: true },
        );
        // Represa a marca d'água na primeira falha: o próximo ciclo tenta de
        // novo, em vez de pular a passagem para sempre.
        if (!ok) break;
        setBaseline(device.id, log.id);
        processedCount++;
      }
      console.log(`[agente] ${device.nome}: processou ${processedCount} novos acessos offline (Control iD).`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ler logs do dispositivo Control iD:`, err.message || err);
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n[agente] encerrando.');
  process.exit(0);
});
