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
const { enqueueOfflineEvent, flushOfflineEvents, pendentes } = require('./core/fila-offline');
const {
  configurar: configurarNuvem,
  cloudRequest,
  agoraDaNuvem,
} = require('./core/nuvem');
const { Supervisor } = require('./core/supervisor');
const { iniciarTelemetria } = require('./core/telemetria');
const { resolverDriver } = require('./drivers/registro');
const dahuaFacial = require('./drivers/dahua-facial');
const hikvisionFacial = require('./drivers/hikvision-facial');
const controlidFacial = require('./drivers/controlid-facial');

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
// Os drivers também falam LAN e não leem `process.env` (ficam testáveis
// isolados) — recebem o mesmo timeout por configurar(), assim como
// core/nuvem.js recebe apiUrl.
dahuaFacial.configurar({ lanTimeoutMs: LAN_TIMEOUT_MS });
hikvisionFacial.configurar({ lanTimeoutMs: LAN_TIMEOUT_MS });
controlidFacial.configurar({ lanTimeoutMs: LAN_TIMEOUT_MS });
// Intervalo do heartbeat de status do aparelho (online/offline no portal).
const DEVICE_STATUS_INTERVAL_MS = Number(
  process.env.DEVICE_STATUS_INTERVAL_MS || 5000,
);
// Intervalo da telemetria (versão + saúde por device + fila offline) —
// produção usa o default de 60s; o harness passa um valor curto via env
// para não esperar um minuto inteiro pelo cenário (ver core/telemetria.js).
const TELEMETRIA_INTERVAL_MS = Number(
  process.env.TELEMETRIA_INTERVAL_MS || 60000,
);
// Hora de início do processo — vai na telemetria (`iniciado_em`) para o
// portal saber há quanto tempo o agente está de pé, sem depender do relógio
// desta máquina (que pode estar desviado — ver core/nuvem.js).
const INICIADO_EM = new Date().toISOString();
// deviceId → último status online reportado (loga só na mudança).
const lastDeviceOnline = new Map();
// Ciclo de vida do ouvinte de eventos por device (assina uma vez, reconecta
// com espera crescente se `escutar` falhar, para quando o device sai da
// lista) fica em `supervisor` (criado dentro de `runCondoLoop`, ver
// src/core/supervisor.js) — substitui o antigo Set `driverListenersAtivos`.
// deviceId → maior RecNo/serialNo/ID de log de acesso já processado no
// dispositivo (Map + funções de leitura/gravação em core/estado.js).
loadBaselines();
// Devices com recuperação de log offline em curso — evita corrida entre a
// recuperação (syncDeviceOfflineLogs) e o avanço de baseline do heartbeat
// (advanceBaselineWhileOnline), e entre dois gatilhos de recuperação
// concorrentes (heartbeat vs. `aoConectar` do stream). Genérico por device
// id: não pertence a driver nenhum, para tarefas 5/6 usarem sem mudança.
const offlineSyncBusy = new Set();

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

  // Um SupervisorDispositivo por device: resolve o driver, assina `escutar`
  // (uma vez) e reconecta sozinho (espera crescente) se a assinatura falhar.
  // `aoRecuperarOffline` é chamado pelo Supervisor toda vez que o driver
  // conecta (é o fast-path já existente) — o STREAM reabre periodicamente
  // por conta própria (não é sinal de queda de verdade — ver comentário no
  // driver Dahua/Intelbras), então este callback só age quando o HEARTBEAT
  // (abaixo) já tinha marcado o device como offline.
  const supervisor = new Supervisor({
    resolverDriver,
    aoEvento: (device, data) => forwardAccessEvent(token, device, data),
    aoRecuperarOffline: (device) => {
      if (lastDeviceOnline.get(device.id) === false) {
        lastDeviceOnline.set(device.id, true);
        console.log(
          `[agente] ${device.nome}: aparelho ONLINE (stream reconectou) — recuperando acessos offline`,
        );
        syncDeviceOfflineLogs(token, device).catch((e) =>
          console.error(`[agente] ${device.nome}: erro ao sincronizar acessos offline:`, e.message || e),
        );
      }
    },
  });

  // Telemetria (tarefa 7): versão + SO + saúde por device (supervisor.saudeTodos())
  // + fila offline pendente, a cada TELEMETRIA_INTERVAL_MS — alimenta o card do
  // agente no portal (GET facial/agent/saude). Modo condomínio só: é o único que
  // tem `supervisor` (o modo legado por device não o usa).
  iniciarTelemetria(token, {
    supervisor,
    pendentes,
    iniciadoEm: INICIADO_EM,
    intervaloMs: TELEMETRIA_INTERVAL_MS,
  });

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

      // Mantém um SupervisorDispositivo por device da lista atual — cria o
      // que é novo (resolve driver, assina `escutar`), para (`parar()`) o
      // que saiu da lista (removido/desativado no portal).
      supervisor.atualizar((body.devices || []).map((entry) => entry.device));

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
            // Fora da janela de recovery em curso (evita corrida com ela).
            const driverDoDevice = resolverDriver(device);
            if (!offlineSyncBusy.has(device.id)) {
              driverDoDevice?.advanceBaselineWhileOnline?.(device)?.catch(() => {});
            }
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
  // Dahua/Intelbras, Hikvision e Control iD já falam pelo contrato de driver
  // (src/drivers) — o switch abaixo só sobra pra fabricante sem driver
  // conhecido (fallback REST genérico).
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

/** Captura um quadro (JPEG) da câmera do facial e devolve em base64. Dahua,
 *  Hikvision e Control iD já saem por `executeOnDevice` (via driver) antes de
 *  chegar aqui; esta função só sobra pra fabricante sem driver conhecido. */
async function doSnapshot(device) {
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
  const driver = resolverDriver(device);
  if (driver) {
    // Dahua/Intelbras: ver `testar` no driver (não usa login RPC2 — estouraria
    // o limite de sessões do aparelho com o heartbeat repetindo a cada 20s).
    return driver.testar(device);
  }
  const res = await lanRequest(device, 'GET', '/status');
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

async function doOpenDoor(device) {
  // Dahua/Intelbras, Hikvision e Control iD abrem pelo driver
  // (executeOnDevice já delegou antes de chegar aqui; este ponto só existe
  // para fabricante sem driver conhecido — fallback REST genérico).
  const res = await lanRequest(device, 'POST', '/open_door', { json: {} });
  return okFrom(res);
}

async function doEnroll(device, cmd) {
  // Dahua/Intelbras, Hikvision e Control iD cadastram pelo driver
  // (executeOnDevice já delegou antes de chegar aqui). Fallback REST
  // genérico: POST /persons (cadastro) ou PUT /persons/:id (update)
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

/** Fallback REST genérico (fabricante sem driver conhecido). Dahua/Intelbras,
 *  Hikvision e Control iD removem pelo driver (executeOnDevice já delegou
 *  antes de chegar aqui). */
async function doRemove(device, cmd) {
  const res = await lanRequest(device, 'DELETE', `/persons/${cmd.faceId}`);
  if (res.status === 404) return { ok: true }; // já não existia
  return okFrom(res);
}

/** Fallback REST genérico (fabricante sem driver conhecido). Dahua/Intelbras,
 *  Hikvision e Control iD listam usuários pelo driver (executeOnDevice já
 *  delegou antes de chegar aqui). */
async function doListUsers(device) {
  return { ok: false, error: `list_users não suportado para ${device.fabricante}` };
}

/** Fallback REST genérico (fabricante sem driver conhecido). Dahua/Intelbras,
 *  Hikvision e Control iD removem em lote pelo driver (executeOnDevice já
 *  delegou antes de chegar aqui). */
async function doRemoveUsers(device, cmd) {
  return { ok: false, error: `remove_users não suportado para ${device.fabricante}` };
}

// Login e enroll Dahua/Intelbras (RPC2, AccessUser/AccessFace) moveram para
// src/drivers/dahua-facial.js. Hikvision (ISAPI) moveu para
// src/drivers/hikvision-facial.js. Control iD (.fcgi com sessão) moveu para
// src/drivers/controlid-facial.js.

// ---------- Dahua/Hikvision/Control iD: eventos de acesso -> nuvem ----------
//
// O protocolo de cada marca (attach multipart Dahua, alertStream Hikvision,
// polling de access_logs Control iD) mora no respectivo driver (`escutar`)
// -- ver o dispatch genérico em runCondoLoop, que chama
// driver.escutar(device, (data) => forwardAccessEvent(token, device, data), opcoes).

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
    if (!opts.backlog && ok && !offlineSyncBusy.has(device.id)) {
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

// O poller de eventos ao vivo do Control iD (sem stream nativo utilizável:
// o push exige internet configurada no terminal, nem sempre presente na
// instalação) e a assinatura do alertStream da Hikvision moveram para os
// respectivos drivers (`escutar` em hikvision-facial.js/controlid-facial.js)
// — ver o dispatch genérico em runCondoLoop.

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

/**
 * Recupera acessos que ocorreram enquanto o agente estava sem alcançar o
 * aparelho (ex.: internet/energia do facial caiu, ou o agente ficou
 * parado). A stream/poller ao vivo não os viu; eles ficaram só no log
 * interno do terminal.
 *
 * Genérico por driver (Dahua/Intelbras, Hikvision, Control iD todos
 * implementam `buscarDesde` — o laço usa só o registro, ver `registro.js`).
 * O protocolo de cada marca (recordFinder.cgi/INI na Dahua, AcsEvent com
 * janela de tempo na Hikvision, access_logs por id no Control iD) mora no
 * driver — `buscarDesde` só lê e devolve; quem manda para a nuvem e decide
 * até onde persistir a marca d'água (represar no primeiro envio que falhar)
 * é este orquestrador.
 */
async function syncDeviceOfflineLogs(token, device) {
  const driver = resolverDriver(device);
  if (!driver || !driver.buscarDesde) return;
  if (offlineSyncBusy.has(device.id)) return;
  offlineSyncBusy.add(device.id);
  // Rótulo usado em TODO log desta função: a orquestração é genérica (um só
  // driver.buscarDesde para as três marcas — ver comentário acima), então o
  // texto perdeu a menção "(Hikvision)"/"(Control iD)" que os blocos antigos
  // tinham; incluir o id do driver aqui devolve essa pista sem reintroduzir
  // um bloco por fabricante.
  const rotulo = `${device.nome} (${driver.id})`;
  try {
    const baseline = deviceBaselines.get(device.id);
    const { eventos, novaMarca, logVazio } = await driver.buscarDesde(device, baseline);

    if (logVazio) {
      console.log(`[agente] ${rotulo}: log de acesso vazio.`);
      return;
    }
    if (baseline === undefined) {
      // Primeira vez: estabelece a marca d'água SEM reprocessar o histórico.
      setBaseline(device.id, novaMarca);
      console.log(`[agente] ${rotulo}: baseline de acessos inicializada em ${novaMarca}.`);
      return;
    }
    if (novaMarca <= baseline) {
      console.log(
        `[agente] ${rotulo}: recovery sem novidade (marca atual ${novaMarca} <= baseline ${baseline}).`,
      );
      return;
    }

    let enviados = 0;
    let falhas = 0;
    // Até onde é seguro avançar a marca d'água: a última marca confirmada
    // pela nuvem antes do primeiro envio que falhar (esses não voltam mesmo,
    // não adianta represá-los).
    let ultimoConfirmado = baseline;
    for (const ev of eventos) {
      console.log(
        `[agente] ${rotulo}: replay marca ${ev._marca} UserID ${ev.UserID} timestamp ${ev.timestamp}`,
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
    // próximo ciclo via "sem novidade" e as passagens recusadas sumiam do
    // histórico para sempre. Represar o watermark faz o próximo ciclo tentar
    // de novo; o `backlog: true` e a deduplicação na nuvem cuidam de reenvio
    // repetido.
    if (falhas > 0) {
      setBaseline(device.id, ultimoConfirmado);
      console.error(
        `[agente] ${rotulo}: recuperados ${enviados} acesso(s), ${falhas} FALHARAM. ` +
        `Baseline represada em ${ultimoConfirmado} (não avançou até ${novaMarca}) — ` +
        `nova tentativa no próximo ciclo.`,
      );
    } else {
      // Sem falhas: avança até a maior marca lida (`buscarDesde` já excluiu
      // do array `eventos` o que foi filtrado por UserID vazio/negado, mas
      // `novaMarca` cobre esses registros também — nunca virariam evento).
      setBaseline(device.id, novaMarca);
      console.log(`[agente] ${rotulo}: recuperados ${enviados} acesso(s) offline (${baseline}→${novaMarca}).`);
    }
  } catch (err) {
    console.error(`[agente] ${rotulo}: falha ao ler log de acesso offline:`, err.message || err);
  } finally {
    offlineSyncBusy.delete(device.id);
  }
}

process.on('SIGINT', () => {
  console.log('\n[agente] encerrando.');
  process.exit(0);
});
