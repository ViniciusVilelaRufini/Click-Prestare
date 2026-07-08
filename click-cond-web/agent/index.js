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

// Versão do agente — sobe no boot para você conferir qual código está
// realmente rodando (útil ao trocar o .exe: se ainda mostra a versão antiga,
// o processo velho não foi substituído).
const AGENT_VERSION = '2026.07.04-guest-usetime-diag';

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
// Intervalo do heartbeat de status do aparelho (online/offline no portal).
const DEVICE_STATUS_INTERVAL_MS = Number(
  process.env.DEVICE_STATUS_INTERVAL_MS || 5000,
);
// deviceId → último status online reportado (loga só na mudança).
const lastDeviceOnline = new Map();
// deviceId → maior RecNo/serialNo/ID de log de acesso já processado no dispositivo.
// Persistido em disco: sem isso, reiniciar o agente zerava a marca d'água e o
// primeiro reconnect reprocessava (ou pulava) o histórico inteiro.
const deviceBaselines = new Map();
function baselinesPath() {
  return path.join(configDir(), 'device-baselines.json');
}
function loadBaselines() {
  try {
    const obj = JSON.parse(fs.readFileSync(baselinesPath(), 'utf8'));
    for (const [k, v] of Object.entries(obj)) deviceBaselines.set(Number(k), v);
  } catch { /* primeiro boot: arquivo ainda não existe */ }
}
function setBaseline(deviceId, val) {
  deviceBaselines.set(deviceId, val);
  try {
    fs.writeFileSync(baselinesPath(), JSON.stringify(Object.fromEntries(deviceBaselines)), 'utf8');
  } catch (e) {
    console.error(`[agente] falha ao salvar baseline: ${e.message || e}`);
  }
}
loadBaselines();
// Devices com recuperação de log offline em curso (evita corrida entre a
// recuperação da transição e o avanço de baseline do heartbeat).
const offlineSyncBusy = new Set();
// deviceId → epoch ms do último avanço de baseline (throttle).
const lastBaselineAdvance = new Map();
const BASELINE_ADVANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 min

/**
 * Enquanto o aparelho está ONLINE de forma estável, a stream ao vivo já
 * encaminha cada acesso — aqui só mantemos a marca d'água (maior RecNo) atual,
 * para que o PRÓXIMO reconnect só reprocesse a janela realmente offline, e não
 * os eventos que a stream já pegou. Só avança; nunca reencaminha. Throttle de
 * 10 min (a leitura do log é um lote; não faz sentido a cada heartbeat).
 */
async function advanceBaselineWhileOnline(device, force = false) {
  if (device.fabricante !== 'intelbras') return;
  if (offlineSyncBusy.has(device.id)) return;
  const agora = Date.now();
  // Throttle: 10 min no caso ocioso; 10s logo após um evento ao vivo (force).
  // Mesmo no force coalescemos rajadas de reconhecimentos (o fetch é do log
  // inteiro) — 10s continua bem abaixo da janela de dedup (20s), então nenhum
  // evento ao vivo fica "descoberto" tempo suficiente para ser reenviado.
  const minIntervalo = force ? 10 * 1000 : BASELINE_ADVANCE_INTERVAL_MS;
  if (agora - (lastBaselineAdvance.get(device.id) || 0) < minIntervalo) return;
  lastBaselineAdvance.set(device.id, agora);
  try {
    const { maxRecNo } = await dahuaFindAccessRecords(device, ACCESS_LOG_CAP);
    if (!maxRecNo) return;
    const baseline = deviceBaselines.get(device.id);
    if (baseline === undefined || maxRecNo > baseline) setBaseline(device.id, maxRecNo);
  } catch {
    /* aparelho oscilou; o próximo ciclo tenta de novo */
  }
}
// Relógio do aparelho: sem NTP ele DERIVA (visto em produção: ~2 min atrasado)
// e volta a 2000 ao perder energia. A nuvem compara a hora do log do aparelho
// (CreateTime dos replays) com a hora de chegada dos eventos ao vivo — minutos
// de atraso fazem a saída real parecer "eco da entrada" e serem descartadas.
// Sincroniza no reconnect (force) e a cada hora enquanto online.
const lastClockSyncAt = new Map(); // deviceId -> epoch ms
const CLOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000;
async function dahuaSyncClock(device, force = false) {
  if (device.fabricante !== 'intelbras') return;
  const agora = Date.now();
  if (!force && agora - (lastClockSyncAt.get(device.id) || 0) < CLOCK_SYNC_INTERVAL_MS)
    return;
  lastClockSyncAt.set(device.id, agora);
  try {
    const t = formatDahuaTime(new Date());
    const res = await lanRequest(
      device,
      'GET',
      `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(t)}`,
    );
    if (res.status >= 200 && res.status < 300) {
      console.log(`[agente] ${device.nome}: relógio do aparelho acertado (${t})`);
    } else {
      console.log(
        `[agente] ${device.nome}: falha ao acertar relógio (HTTP ${res.status}): ${String(res.raw || '').slice(0, 80)}`,
      );
    }
  } catch (e) {
    console.log(`[agente] ${device.nome}: falha ao acertar relógio (${e.message || e})`);
  }
}

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
        // acesso e repassa cada reconhecimento para a nuvem.
        if (device.fabricante === 'intelbras') {
          startDahuaEventListener(token, device);
        }
        if (device.fabricante === 'hikvision') {
          startHikvisionEventListener(token, device);
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
              // e acerta o relógio (ele deriva; ver dahuaSyncClock).
              syncDeviceOfflineLogs(token, device).catch((e) =>
                console.error(`[agente] ${device.nome}: erro ao sincronizar acessos offline:`, e.message || e)
              );
              dahuaSyncClock(device, true).catch(() => {});
            }
          } else if (online) {
            // Online estável: só mantém a marca d'água atual (a stream já cobre
            // os eventos); assim o próximo reconnect só reprocessa a janela real.
            advanceBaselineWhileOnline(device).catch(() => {});
            dahuaSyncClock(device).catch(() => {});
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
  if (device.fabricante !== 'intelbras') {
    return {
      ok: false,
      error: `Captura por câmera não suportada para ${device.fabricante}.`,
    };
  }
  // Liga o flash automaticamente antes do snapshot
  await setDeviceLightingMode(device, 'Manual').catch(() => {});
  await sleep(300); // aguarda acender e exposição regular

  const res = await lanRequest(
    device,
    'GET',
    '/cgi-bin/snapshot.cgi?channel=1',
  );

  // Restaura para automático após o snapshot
  await setDeviceLightingMode(device, 'Auto').catch(() => {});

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

/** Altera o modo de iluminação (LED/Flash) do dispositivo (Manual = ligado, Auto = automático). */
async function setDeviceLightingMode(device, mode) {
  if (device.fabricante !== 'intelbras') return;
  console.log(`[agente] ${device.nome}: setDeviceLightingMode chamado para "${mode}"`);

  if (mode === 'Manual') {
    try {
      // 1. Garante que a câmera principal está no modo Colorido para que a foto do cadastro seja em cores
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&VideoInOptions[0].DayNightColor=0');
      // 2. Desativa o canal secundário (infravermelho) para evitar conflitos de iluminação
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[1][0].Mode=Off');
      // 3. Define o canal principal (LED branco) como Manual
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[0][0].Mode=Manual');
      // 4. Define a intensidade do LED branco para 100% (ligado)
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[0][0].MiddleLight[0].Light=100');
      console.log(`[agente] ${device.nome}: LED branco ativado com sucesso (Manual, 100%)`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ativar LED branco:`, err.message || err);
    }
  } else {
    try {
      // Restaura as configurações padrão do dispositivo (Auto)
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[0][0].Mode=Auto');
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[0][0].MiddleLight[0].Light=0');
      await lanRequest(device, 'GET', '/cgi-bin/configManager.cgi?action=setConfig&Lighting[1][0].Mode=Auto');
      console.log(`[agente] ${device.nome}: LED branco restaurado para automatico`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao restaurar LED branco:`, err.message || err);
    }
  }
}

// ---------- Preview ao vivo (servidor local MJPEG por snapshots) ----------
//
// O aparelho NÃO expõe MJPEG (só RTSP H.264, que o browser não toca nativo).
// Então montamos um multipart/x-mixed-replace a partir de snapshots rápidos.
// Roda só em localhost: o navegador do PC da portaria (mesma rede da câmera)
// consome direto — sem a latência da nuvem. ~3 fps (teto do snapshot).

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
    const device = lastDevices.find((d) => d.fabricante === 'intelbras');
    if (!device) {
      res.writeHead(503);
      return res.end('nenhum terminal facial conectado');
    }
    if (reqPath === '/snapshot') {
      snapshotComDigest(device, {})
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
  await setDeviceLightingMode(device, 'Manual').catch(() => {});

  const st = {}; // estado do Digest (reusa o nonce entre quadros = mais fps)
  let lastLightOnAt = 0;
  while (alive) {
    let jpeg = null;
    try {
      // Reforça o comando de acendimento do LED a cada 800ms em segundo plano para evitar que o firmware o desligue por inatividade
      if (Date.now() - lastLightOnAt > 800) {
        lastLightOnAt = Date.now();
        void setDeviceLightingMode(device, 'Manual').catch(() => {});
      }
      jpeg = await snapshotComDigest(device, st);
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
  await setDeviceLightingMode(device, 'Auto').catch(() => {});

  try {
    res.end();
  } catch {
    /* já fechou */
  }
}

/** GET snapshot reutilizando o nonce do Digest (evita o 401 a cada quadro). */
function snapshotComDigest(device, st) {
  const reqPath = '/cgi-bin/snapshot.cgi?channel=1';
  const user = device.api_user || 'admin';
  const pass = device.api_password || 'admin';
  const fetchOne = (authHeader) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: device.ip,
          port: device.porta,
          path: reqPath,
          method: 'GET',
          headers: authHeader ? { Authorization: authHeader } : {},
        },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              wa: r.headers['www-authenticate'],
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(LAN_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
      req.end();
    });

  return (async () => {
    if (st.realm) {
      st.nc = (st.nc || 0) + 1;
      const r = await fetchOne(computeDigest(user, pass, 'GET', reqPath, st));
      if (r.status === 200) return r.body; // nonce ainda válido (1 req/quadro)
      if (r.status === 401 && r.wa) {
        parseChallengeInto(r.wa, st);
        st.nc = 1;
        return (await fetchOne(computeDigest(user, pass, 'GET', reqPath, st)))
          .body;
      }
    }
    const c = await fetchOne(null); // primeiro acesso: dispara o 401
    if (c.status === 200) return c.body;
    parseChallengeInto(c.wa || '', st);
    st.nc = 1;
    return (await fetchOne(computeDigest(user, pass, 'GET', reqPath, st))).body;
  })();
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

async function doPing(device) {
  if (device.fabricante === 'control_id') {
    await controlIdLogin(device); // login OK prova conectividade
    return { ok: true };
  }
  if (device.fabricante === 'intelbras') {
    // NÃO usar login RPC2 aqui: ele cria uma sessão que não é encerrada e, com o
    // heartbeat a cada 20s, estoura o limite do aparelho ("too many connections")
    // — derrubando o ping E os comandos. Um GET cgi com Digest prova rede +
    // credencial SEM criar sessão (stateless).
    const res = await lanRequest(
      device,
      'GET',
      '/cgi-bin/magicBox.cgi?action=getDeviceType',
    );
    return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
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
  // VALIDADO ao vivo (SS 3530 MF FACE W): abre o relé via cgi com Digest.
  if (device.fabricante === 'intelbras') {
    const res = await lanRequest(
      device,
      'GET',
      '/cgi-bin/accessControl.cgi?action=openDoor&channel=1',
    );
    return okFrom(res);
  }
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
  if (device.fabricante === 'intelbras') {
    return dahuaEnroll(device, cmd);
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
  if (device.fabricante === 'intelbras') {
    // VALIDADO ao vivo: array vai como query-param (?UserIDList[0]=id), não JSON.
    const res = await lanRequest(
      device,
      'GET',
      `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(cmd.faceId)}`,
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

async function doListUsers(device) {
  if (device.fabricante !== 'intelbras') {
    return { ok: false, error: `list_users não suportado para ${device.fabricante}` };
  }
  const countResp = await lanRequest(
    device,
    'POST',
    '/RPC2',
    { json: { method: 'UserInfo.getCount', params: { Conditions: {} } } }
  );
  if (countResp.status !== 200 || !countResp.data || countResp.data.result === false) {
    return { ok: false, error: `Falha ao obter quantidade de usuários: status ${countResp.status}` };
  }
  const total = countResp.data.params?.Count ?? 0;
  if (total === 0) {
    return { ok: true, userIds: [] };
  }

  const ids = [];
  const PAGE = 100;
  let startNo = 0;

  while (startNo < total) {
    const resp = await lanRequest(
      device,
      'POST',
      '/RPC2',
      {
        json: {
          method: 'UserInfo.getMulti',
          params: { Conditions: {}, StartNo: startNo, Count: PAGE }
        }
      }
    );
    if (resp.status !== 200 || !resp.data || resp.data.result === false) {
      return { ok: false, error: `Falha ao obter lista de usuários (startNo: ${startNo})` };
    }
    const list = resp.data.params?.UserList ?? [];
    for (const u of list) {
      if (u.UserID && u.UserID !== 'FFFFFF') {
        ids.push(u.UserID);
      }
    }
    startNo += PAGE;
    if (list.length < PAGE) break;
  }
  return { ok: true, userIds: ids };
}

async function doRemoveUsers(device, cmd) {
  if (device.fabricante !== 'intelbras') {
    return { ok: false, error: `remove_users não suportado para ${device.fabricante}` };
  }
  const userIds = cmd.faceIds || [];
  if (userIds.length === 0) {
    return { ok: true };
  }
  const res = await lanRequest(
    device,
    'POST',
    '/RPC2',
    {
      json: {
        method: 'UserInfo.removeMulti',
        params: {
          UserList: userIds.map((id) => ({ UserID: id }))
        }
      }
    }
  );
  if (res.status !== 200 || !res.data || res.data.result === false) {
    return { ok: false, error: `Falha ao remover lista de usuários: status ${res.status}` };
  }
  return { ok: true };
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

// ---------- Dahua / Intelbras (linha SS facial: SS 3530 MF FACE etc.) ----------
//
// VALIDADO ao vivo num SS 3530 MF FACE W (firmware 2.000.00IB004, 2021). A
// Intelbras é OEM da Dahua: o login é o handshake RPC2 em duas etapas
// (challenge → hash MD5 maiúsculo → login), e a gestão de usuário/rosto usa os
// CGIs AccessUser.cgi / AccessFace.cgi com Digest auth. O faceId que guardamos
// é o próprio UserID (string definida por nós, ex.: "morador_42") — o push de
// evento do aparelho devolve esse UserID, então não dependemos de id interno.

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

async function dahuaLogin(device) {
  const base = `http://${device.ip}:${device.porta}`;
  const user = device.api_user || 'admin';
  const pass = device.api_password || 'admin';
  const s1 = await request(`${base}/RPC2_Login`, {
    method: 'POST',
    timeout: LAN_TIMEOUT_MS,
    json: {
      method: 'global.login',
      params: { userName: user, password: '', clientType: 'Web3.0', loginType: 'Direct' },
      id: 1,
    },
  });
  const d1 = parseJson(s1);
  const p = d1.params || {};
  const session = d1.session;
  if (!p.realm || !p.random || !session) {
    const e = new Error('Dahua: aparelho não respondeu o desafio de login (RPC2)');
    e.statusCode = s1.status;
    throw e;
  }
  const ha = md5(`${user}:${p.realm}:${pass}`).toUpperCase();
  const loginHash = md5(`${user}:${p.random}:${ha}`).toUpperCase();
  const s2 = await request(`${base}/RPC2_Login`, {
    method: 'POST',
    timeout: LAN_TIMEOUT_MS,
    headers: { Cookie: `DWebClientSessionID=${session}` },
    json: {
      method: 'global.login',
      params: {
        userName: user,
        password: loginHash,
        clientType: 'Web3.0',
        loginType: 'Direct',
        authorityType: 'Default',
        passwordType: 'Default',
      },
      id: 2,
      session,
    },
  });
  const d2 = parseJson(s2);
  if (!d2.result) {
    const msg = (d2.error && d2.error.message) || 'login negado';
    const e = new Error(`Dahua: ${msg} (confira usuário/senha do aparelho)`);
    e.statusCode = s2.status;
    throw e;
  }
  return session;
}

async function dahuaEnroll(device, cmd) {
  const userId = String(cmd.externalId || cmd.faceId);
  const userBody = {
    UserList: [
      {
        UserID: userId,
        UserName: cmd.nome || userId,
        // UseTime só é aplicado pelo firmware quando UserType=2 (Guest).
        // Tabela Dahua: 0=geral, 1=blocklist, 2=convidado, 3=ronda, 4=VIP.
        UserType: typeof cmd.userTimes === 'number' && cmd.userTimes > 0 ? 2 : 0,
        Authority: 2,
        Doors: [0],
        TimeSections: [255],
        // Visitante manda a janela da visita (cmd.validFrom/validTo) — o aparelho
        // NEGA sozinho após o término. Morador/sem janela: permanente. Cuidado:
        // sem NTP o relógio volta a 2000 ao perder energia; por isso o morador
        // fica em 2000 (sempre vale) e o agente mantém a hora sincronizada.
        ValidFrom: cmd.validFrom || '2000-01-01 00:00:00',
        ValidTo: cmd.validTo || '2037-12-31 23:59:59',
        UseTime: typeof cmd.userTimes === 'number' ? cmd.userTimes : -1,
      },
    ],
  };
  // REPLACE LIMPO: remove antes (idempotente). Sem isso, re-sincronizar um rosto
  // que já existe dá "Bad Request" no insertMulti (duplicado) e o cadastro trava
  // em "pendente" para sempre (0 enviados). Remover o usuário leva o rosto junto.
  await lanRequest(
    device,
    'GET',
    `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(userId)}`,
  ).catch(() => {});

  // Cria o usuário do zero.
  const u = await lanRequest(
    device,
    'POST',
    '/cgi-bin/AccessUser.cgi?action=insertMulti',
    { json: userBody },
  );
  if (!(u.status >= 200 && u.status < 300) || /error/i.test(String(u.raw || ''))) {
    return {
      ok: false,
      statusCode: u.status,
      error: `usuário: ${String(u.raw || '').slice(0, 120)}`,
    };
  }

  // Sobe o rosto (insert do zero; fallback updateMulti por segurança). O aparelho
  // extrai a biometria e recusa imagem sem rosto nítido — aí sim é foto ruim.
  if (cmd.fotoBase64) {
    const faceBody = { FaceList: [{ UserID: userId, PhotoData: [cmd.fotoBase64] }] };
    let f = await lanRequest(
      device,
      'POST',
      '/cgi-bin/AccessFace.cgi?action=insertMulti',
      { json: faceBody },
    );
    if (!(f.status >= 200 && f.status < 300) || /error/i.test(String(f.raw || ''))) {
      f = await lanRequest(
        device,
        'POST',
        '/cgi-bin/AccessFace.cgi?action=updateMulti',
        { json: faceBody },
      );
    }
    if (!(f.status >= 200 && f.status < 300) || /error/i.test(String(f.raw || ''))) {
      return {
        ok: false,
        statusCode: f.status,
        error: `rosto recusado: ${String(f.raw || '').slice(0, 120)}`,
        faceId: userId,
      };
    }
  }
  return { ok: true, faceId: userId };
}

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

// ---------- Dahua: stream de eventos de acesso → nuvem ----------
//
// Aparelhos Dahua/Intelbras não fazem push HTTP para uma URL: eles MANTÊM um
// stream (multipart) em /cgi-bin/eventManager.cgi?action=attach. Assinamos esse
// stream e, a cada rosto reconhecido (evento _DoorFace_ com UserID != FFFFFF),
// repassamos o acesso para a nuvem. O UserID é o nosso external_id (morador_42).

const dahuaListeners = new Set(); // deviceIds já com listener ativo

// Debounce na ORIGEM: o aparelho dispara vários _DoorFace_ por aproximação
// (múltiplos frames). Sem isso, vários POSTs concorrentes chegariam à nuvem e
// poderiam embaralhar a alternância entrada/saída. Guardamos o último envio por
// (device, UserID) e ignoramos repetições dentro da janela. O check+set é
// síncrono (antes de qualquer await), então é seguro contra a rajada.
const AGENT_EVENT_DEBOUNCE_MS = 8000;
const lastAccessForwardedAt = new Map(); // "deviceId:userId" -> epoch ms

function startDahuaEventListener(token, device) {
  if (dahuaListeners.has(device.id)) return;
  dahuaListeners.add(device.id);
  console.log(`[agente] ${device.nome}: assinando eventos de acesso (Dahua)`);
  let streamWasDown = false;
  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await dahuaAttachOnce(token, device, () => {
          // Chamado no primeiro byte recebido da stream.
          // Se a stream estava caída (internet estava desconectada), este é o
          // sinal imediato de que o aparelho voltou — dispara recovery SEM
          // esperar o próximo heartbeat (que pode demorar até 5s).
          if (streamWasDown && !lastDeviceOnline.get(device.id)) {
            streamWasDown = false;
            lastDeviceOnline.set(device.id, true);
            console.log(`[agente] ${device.nome}: aparelho ONLINE (stream reconectou) — recuperando acessos offline`);
            syncDeviceOfflineLogs(token, device).catch((e) =>
              console.error(`[agente] ${device.nome}: erro ao sincronizar acessos offline:`, e.message || e)
            );
          } else {
            streamWasDown = false;
          }
        });
      } catch (err) {
        if (!streamWasDown) {
          console.error(
            `[agente] ${device.nome}: stream de eventos caiu (${err.message || err}); reabrindo em 5s`,
          );
        }
        streamWasDown = true;
      }
      await sleep(5000); // o aparelho fecha o stream periodicamente — reabre
    }
  })();
}

/** Abre UMA conexão de streaming (resolve quando o aparelho a encerra).
 *  onConnect é chamado uma única vez no primeiro byte recebido. */
function dahuaAttachOnce(token, device, onConnect) {
  return new Promise((resolve, reject) => {
    const user = device.api_user || 'admin';
    const pass = device.api_password || 'admin';
    const path = '/cgi-bin/eventManager.cgi?action=attach&codes=[All]';

    // 1) Desafio Digest (o attach exige autenticação por header).
    const challenge = http.request(
      { host: device.ip, port: device.porta, path, method: 'GET' },
      (cres) => {
        cres.resume();
        if (cres.statusCode !== 401) {
          return reject(new Error(`desafio inesperado: HTTP ${cres.statusCode}`));
        }
        const wa = cres.headers['www-authenticate'] || '';
        if (!/digest/i.test(wa)) return reject(new Error('aparelho não pediu Digest'));
        const authHeader = buildDigestHeader(user, pass, 'GET', path, wa);

        // 2) Conexão de streaming autenticada (sem timeout: fica aberta).
        const stream = http.request(
          {
            host: device.ip,
            port: device.porta,
            path,
            method: 'GET',
            headers: { Authorization: authHeader },
          },
          (sres) => {
            if (sres.statusCode !== 200) {
              sres.resume();
              return reject(new Error(`attach HTTP ${sres.statusCode}`));
            }
            let buf = '';
            let onConnectFired = false;
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              if (!onConnectFired && onConnect) { onConnectFired = true; onConnect(); }
              buf += chunk;
              buf = consumeDahuaEvents(buf, (data) =>
                forwardAccessEvent(token, device, data),
              );
              // Trava de segurança contra evento gigante/parcial sem fim.
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
    challenge.setTimeout(LAN_TIMEOUT_MS, () =>
      challenge.destroy(new Error('timeout no desafio')),
    );
    challenge.end();
  });
}

/**
 * Consome eventos completos do buffer (separados por --myboundary) e devolve o
 * trecho final ainda incompleto. Só processa o evento de acesso (_DoorFace_).
 */
function consumeDahuaEvents(buf, onData) {
  const parts = buf.split('--myboundary');
  const tail = parts.pop(); // último pode estar pela metade
  for (const part of parts) {
    if (!part.includes('Code=_DoorFace_')) continue;
    const i = part.indexOf('data=');
    if (i < 0) continue;
    try {
      onData(JSON.parse(part.slice(i + 5).trim()));
    } catch {
      /* JSON parcial/inválido — ignora */
    }
  }
  return tail;
}

// ---------- Store-and-forward: fila em disco para eventos offline ----------
//
// A LAN continua viva quando a internet cai: o aparelho segue reconhecendo e
// o agente segue recebendo o stream — só o upload para a nuvem falha. Sem a
// fila, esses acessos sumiam da auditoria. Aqui cada evento que não subiu é
// gravado em disco (sobrevive a restart do agente) e reenviado com a flag
// `backlog: true` quando a nuvem volta — a nuvem audita com o timestamp
// original, mas não reaciona abertura nem manda push atrasado.

const OFFLINE_QUEUE_MAX = 5000; // ~alguns dias de acessos; acima disso descarta os mais antigos
let flushEmAndamento = false;

function offlineQueuePath() {
  return path.join(configDir(), 'events-queue.jsonl');
}

function enqueueOfflineEvent(body, deviceNome) {
  try {
    const file = offlineQueuePath();
    fs.appendFileSync(file, JSON.stringify(body) + '\n', 'utf8');
    // Poda: mantém só as últimas OFFLINE_QUEUE_MAX linhas.
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > OFFLINE_QUEUE_MAX) {
      fs.writeFileSync(
        file,
        lines.slice(lines.length - OFFLINE_QUEUE_MAX).join('\n') + '\n',
        'utf8',
      );
    }
    console.log(
      `[agente] ${deviceNome}: evento guardado na fila offline (${lines.length} pendente(s))`,
    );
  } catch (err) {
    console.error(`[agente] falha ao gravar fila offline: ${err.message || err}`);
  }
}

/**
 * Reenvia a fila offline (chamado após cada poll bem-sucedido = nuvem
 * alcançável). Para no primeiro erro e preserva o restante para a próxima
 * tentativa. Eventos reenviados vão com `backlog: true`.
 */
async function flushOfflineEvents(token) {
  if (flushEmAndamento) return;
  const file = offlineQueuePath();
  let lines;
  try {
    if (!fs.existsSync(file)) return;
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return;
  }
  if (lines.length === 0) return;

  flushEmAndamento = true;
  try {
    console.log(`[agente] reenviando ${lines.length} evento(s) da fila offline...`);
    let enviados = 0;
    for (const line of lines) {
      let body;
      try {
        body = JSON.parse(line);
      } catch {
        enviados++; // linha corrompida — descarta
        continue;
      }
      try {
        const res = await cloudRequest(
          'POST',
          `/api/facial/agent/condo/${token}/event`,
          { ...body, backlog: true },
        );
        // 2xx = aceito; 4xx = a nuvem rejeitou de vez (ex.: acesso negado por
        // regra — já auditado lá), não adianta re-tentar. 5xx/rede = para e
        // tenta de novo no próximo flush.
        if (res.status >= 500) break;
        enviados++;
      } catch {
        break; // nuvem ainda inalcançável — preserva o restante
      }
    }
    const restantes = lines.slice(enviados);
    fs.writeFileSync(file, restantes.length ? restantes.join('\n') + '\n' : '', 'utf8');
    if (enviados > 0) {
      console.log(
        `[agente] fila offline: ${enviados} reenviado(s), ${restantes.length} restante(s)`,
      );
    }
  } finally {
    flushEmAndamento = false;
  }
}

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

  const eventTimestamp = data.timestamp
    ? new Date(data.timestamp).toISOString()
    : new Date().toISOString();

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
        ok ? 'OK' : `nuvem recusou HTTP ${res.status}`
      }`,
    );
    // 5xx = nuvem com problema transitório — guarda para reenvio. 4xx é
    // rejeição definitiva (regra/validação), já tratada/auditada na nuvem.
    if (res.status >= 500) enqueueOfflineEvent(body, device.nome);
    // Evento AO VIVO (não backlog): avança a marca d'água para incluir o RecNo
    // deste acesso ANTES de um eventual offline. Assim a recuperação reenviará
    // só os eventos realmente perdidos, sem sobrepor os que a stream já pegou.
    if (!opts.backlog) advanceBaselineWhileOnline(device, true).catch(() => {});
  } catch (err) {
    console.error(
      `[agente] ${device.nome}: falha ao enviar acesso ${userId}: ${err.message || err}`,
    );
    // Sem internet: guarda em disco e reenvia quando a nuvem voltar.
    enqueueOfflineEvent(body, device.nome);
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
 */
function consumeHikvisionEvents(buf, onData) {
  // O alertStream entrega blocos separados por boundary "--MIME_boundary".
  const parts = buf.split('--MIME_boundary');
  const tail = parts.pop();
  for (const part of parts) {
    if (!part.includes('AccessControllerEvent')) continue;
    const i = part.indexOf('{');
    if (i < 0) continue;
    try {
      const json = JSON.parse(part.slice(i));
      const ev = json.AccessControllerEvent || {};
      const emp = ev.employeeNoString;
      // Tratamos "tem employeeNo" como reconhecido. Sem employeeNo = ignora.
      if (emp) onData({ UserID: String(emp), Similarity: ev.similarity ?? 90 });
    } catch {
      /* parcial/inválido — ignora */
    }
  }
  return tail;
}

function okFrom(res) {
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

/**
 * Monta um corpo multipart/form-data. parts = [{ name, json } | { name, jpeg, filename }].
 * Devolve { body: Buffer, contentType }. Usado no cadastro de rosto do Hikvision.
 */
function buildMultipart(parts) {
  const boundary = '----clickbnd' + crypto.randomBytes(8).toString('hex');
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.json !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"\r\nContent-Type: application/json\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.from(JSON.stringify(p.json)));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename || 'face.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
      );
      chunks.push(p.jpeg);
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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
        resolve({ status: res.statusCode, data, raw, buffer });
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

function formatDahuaTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function parseDahuaINI(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('=');
    if (parts.length < 2) continue;
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    const match = key.match(/^records\[(\d+)\]\.(.+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const field = match[2];
      if (!records[idx]) {
        records[idx] = {};
      }
      records[idx][field] = value;
    }
  }
  return records.filter(Boolean);
}

/**
 * Lê o log de acesso interno do terminal Dahua/Intelbras via recordFinder.cgi
 * e devolve os registros já parseados. Descoberto empiricamente no SS 3530 MF:
 *   - action=find&name=AccessControlCardRec&count=N funciona (startFind/token
 *     e factory.create dão HTTP 400 neste firmware);
 *   - a resposta é INI (records[i].Campo=valor) e vem do MAIS ANTIGO p/ o mais
 *     novo; `offset` é IGNORADO — para pegar os recentes buscamos count>=total
 *     e filtramos por RecNo;
 *   - campos úteis: RecNo (sequencial), UserID (nosso external_id), CreateTime
 *     (epoch unix), Type ("Entry" sempre — o sentido é decidido na nuvem).
 */
// ATENÇÃO: `found=` na resposta é a QUANTIDADE RETORNADA (min(count, total)),
// NÃO o total do aparelho. A marca d'água confiável é o maior RecNo. Como o
// `find` vem do mais antigo→novo e ignora offset, buscamos um lote grande (CAP)
// e usamos o maior RecNo. CAP cobre com folga um terminal de condomínio; um
// log acima disso perderia os mais recentes (limitação conhecida do firmware).
const ACCESS_LOG_CAP = 20000;
async function dahuaFindAccessRecords(device, count) {
  const res = await lanRequest(
    device,
    'GET',
    `/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&count=${count}`,
  );
  const records = parseDahuaINI(String(res.raw || ''));
  const maxRecNo = records.reduce(
    (m, r) => Math.max(m, parseInt(r.RecNo, 10) || 0),
    0,
  );
  return { maxRecNo, records };
}

/** CreateTime do aparelho (epoch unix, string) → ISO. Se o relógio estiver
 *  zerado (aparelho sem NTP volta a 2000 ao perder energia), usa agora. */
function dahuaEpochToISO(createTime) {
  const sec = parseInt(createTime, 10);
  if (!sec || sec < 1577836800 /* 2020-01-01 */) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

async function syncDeviceOfflineLogs(token, device) {
  // Dahua / Intelbras — recupera acessos que ocorreram enquanto o agente
  // estava sem alcançar o aparelho (ex.: internet/energia do facial caiu). A
  // stream ao vivo não os viu; eles ficaram só no log interno do terminal.
  if (device.fabricante === 'intelbras') {
    if (offlineSyncBusy.has(device.id)) return;
    offlineSyncBusy.add(device.id);
    try {
      // Uma única busca do log (mais antigo→novo). A marca d'água é o maior
      // RecNo; filtramos os novos por RecNo > baseline.
      const { records, maxRecNo } = await dahuaFindAccessRecords(device, ACCESS_LOG_CAP);
      if (records.length === 0) {
        console.log(`[agente] ${device.nome}: log de acesso vazio.`);
        return;
      }
      const baseline = deviceBaselines.get(device.id);

      // Primeira vez: estabelece a marca d'água SEM reprocessar o histórico.
      if (baseline === undefined) {
        setBaseline(device.id, maxRecNo);
        console.log(`[agente] ${device.nome}: baseline de acessos inicializada em RecNo ${maxRecNo}.`);
        return;
      }
      if (maxRecNo <= baseline) {
        console.log(
          `[agente] ${device.nome}: recovery sem novidade (maior RecNo ${maxRecNo} <= baseline ${baseline}).`,
        );
        return;
      }

      const janela = records.filter((r) => parseInt(r.RecNo, 10) > baseline);
      // O log interno guarda TAMBÉM as tentativas NEGADAS pelo aparelho
      // (ErrorCode != 0, ex.: 16 = sem saldo/na regra). Reenviar negada como
      // acesso corrompe a auditoria (vira "entrada" falsa na nuvem). Só
      // passagens de sucesso (ErrorCode 0/ausente) com UserID viram evento.
      const negadoNoAparelho = (r) =>
        r.ErrorCode != null && String(r.ErrorCode).trim() !== '0';
      const novos = janela
        .filter((r) => r.UserID && r.UserID.trim() !== '' && !negadoNoAparelho(r))
        .sort((a, b) => parseInt(a.RecNo, 10) - parseInt(b.RecNo, 10));
      // Diagnóstico: loga cru o que foi pulado, em vez de sumir calado.
      for (const r of janela) {
        if (!r.UserID || r.UserID.trim() === '') {
          console.log(
            `[agente] ${device.nome}: registro offline IGNORADO (sem UserID): ${JSON.stringify(r).slice(0, 300)}`,
          );
        } else if (negadoNoAparelho(r)) {
          console.log(
            `[agente] ${device.nome}: registro offline IGNORADO (negado no aparelho, ErrorCode ${r.ErrorCode}): ${JSON.stringify(r).slice(0, 300)}`,
          );
        }
      }

      let enviados = 0;
      for (const rec of novos) {
        console.log(
          `[agente] ${device.nome}: replay RecNo ${rec.RecNo} UserID ${rec.UserID} CreateTime ${rec.CreateTime}`,
        );
        await forwardAccessEvent(token, device, {
          UserID: rec.UserID,
          CardNo: rec.CardNo,
          Similarity: 100,
          timestamp: dahuaEpochToISO(rec.CreateTime),
        }, { backlog: true });
        enviados++;
      }
      // Avança a marca para o maior RecNo (mesmo que alguns não tivessem UserID).
      setBaseline(device.id, maxRecNo);
      console.log(`[agente] ${device.nome}: recuperados ${enviados} acesso(s) offline (RecNo ${baseline}→${maxRecNo}).`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ler log de acesso do Intelbras:`, err.message || err);
    } finally {
      offlineSyncBusy.delete(device.id);
    }
  }

  // Hikvision
  if (device.fabricante === 'hikvision') {
    try {
      console.log(`[agente] ${device.nome}: iniciando sincronização de acessos offline (Hikvision)...`);
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
              minor: 0
            }
          }
        }
      );
      const infoList = res.data && res.data.AcsEvent && res.data.AcsEvent.InfoList;
      if (!Array.isArray(infoList) || infoList.length === 0) {
        return;
      }

      infoList.sort((a, b) => (a.serialNo || 0) - (b.serialNo || 0));

      let baseline = deviceBaselines.get(device.id);
      if (baseline === undefined) {
        const maxSerial = Math.max(...infoList.map(l => l.serialNo).filter(Boolean));
        setBaseline(device.id, maxSerial);
        console.log(`[agente] ${device.nome}: baseline de acessos offline inicializada em Serial ${maxSerial}`);
        return;
      }

      let processedCount = 0;
      for (const log of infoList) {
        const serial = log.serialNo || 0;
        if (serial > baseline) {
          if (log.employeeNoString) {
            await forwardAccessEvent(token, device, {
              UserID: log.employeeNoString,
              Similarity: 100,
              timestamp: log.time,
            }, { backlog: true });
          }
          baseline = serial;
          setBaseline(device.id, serial);
          processedCount++;
        }
      }
      console.log(`[agente] ${device.nome}: processou ${processedCount} novos acessos offline (Hikvision).`);
    } catch (err) {
      console.error(`[agente] ${device.nome}: falha ao ler logs do dispositivo Hikvision:`, err.message || err);
    }
  }

  // Control iD
  if (device.fabricante === 'control_id') {
    try {
      console.log(`[agente] ${device.nome}: iniciando sincronização de acessos offline (Control iD)...`);
      const session = await controlIdLogin(device);
      const res = await lanRequest(
        device,
        'POST',
        `/load_objects.fcgi?session=${session}`,
        {
          json: {
            object: "access_logs",
            order: ["id", "asc"],
            limit: 50
          }
        }
      );
      const logs = res.data && res.data.access_logs;
      if (!Array.isArray(logs) || logs.length === 0) {
        return;
      }

      let baseline = deviceBaselines.get(device.id);
      if (baseline === undefined) {
        const maxId = Math.max(...logs.map(l => l.id).filter(Boolean));
        setBaseline(device.id, maxId);
        console.log(`[agente] ${device.nome}: baseline de acessos offline inicializada em ID ${maxId}`);
        return;
      }

      let processedCount = 0;
      for (const log of logs) {
        if (log.id > baseline) {
          await forwardAccessEvent(token, device, {
            UserID: String(log.user_id),
            Similarity: log.confidence ? Math.min(100, Math.round(log.confidence / 18)) : 100,
            timestamp: new Date(log.time * 1000).toISOString(),
          }, { backlog: true });
          baseline = log.id;
          setBaseline(device.id, log.id);
          processedCount++;
        }
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
