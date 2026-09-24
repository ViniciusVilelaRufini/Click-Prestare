'use strict';

/**
 * agent/src/drivers/dahua-facial.js — Driver Dahua / Intelbras (linha SS
 * facial: SS 3530 MF FACE etc.).
 *
 * VALIDADO ao vivo num SS 3530 MF FACE W (firmware 2.000.00IB004, 2021). A
 * Intelbras é OEM da Dahua: o login é o handshake RPC2 em duas etapas
 * (challenge → hash MD5 maiúsculo → login), e a gestão de usuário/rosto usa
 * os CGIs AccessUser.cgi / AccessFace.cgi com Digest auth. O faceId que
 * guardamos é o próprio UserID (string definida por nós, ex.: "morador_42")
 * — o push de evento do aparelho devolve esse UserID, então não dependemos
 * de id interno.
 *
 * Expõe o contrato de driver da spec (todos opcionais exceto `id`):
 *   id, testar(device), executar(device, cmd),
 *   escutar(device, aoEvento, opcoes?), buscarDesde(device, marca),
 *   acertarRelogio(device).
 *
 * `escutar`'s `opcoes.aoConectar` (extensão do contrato, opcional): chamada a
 * cada conexão bem-sucedida do stream de eventos (primeiro byte recebido),
 * inclusive a primeira. Serve para quem orquestra (hoje index.js, na
 * Supervisor da tarefa 6) disparar uma ação assim que o stream (re)conecta —
 * ex.: recuperar o log offline sem esperar o próximo heartbeat. O driver só
 * avisa; a decisão de agir (e evitar disparo duplicado com o heartbeat) é de
 * quem orquestra.
 *
 * Mais duas funções extras (fora do contrato) usadas pelo preview ao vivo em
 * index.js: `setDeviceLightingMode` e `snapshotComDigest` — o servidor HTTP
 * do preview é orquestração genérica (fica em index.js), mas o protocolo por
 * trás (CGIs de iluminação, snapshot com Digest reusando o nonce) é só Dahua.
 *
 * O Set "recovery de log offline em curso" (evitar corrida entre o replay e
 * o avanço de baseline do heartbeat) NÃO mora aqui: é orquestração genérica
 * por device id, então vive em index.js (compartilhado entre drivers
 * futuros) e é passado para `advanceBaselineWhileOnline` só como um guard no
 * CALL SITE — este módulo não guarda esse estado.
 */

const http = require('http');
const { md5, buildDigestHeader, parseChallengeInto, computeDigest } = require('../lib/digest');
const { formatDahuaTime, parseDahuaINI, dahuaEpochToISO } = require('../lib/dahua-formato');
const {
  request,
  lanRequest: lanRequestComTimeout,
  okFrom,
  parseJson,
  sleep,
} = require('../lib/http');
const { deviceBaselines, setBaseline, lerJson, gravarJsonAtomico } = require('../core/estado');
const { agoraDaNuvem } = require('../core/nuvem');

// lib/http.js não conhece o timeout da LAN — é config injetada por quem monta
// o agente (index.js lê LAN_TIMEOUT_MS do .env). Guardamos aqui um valor com
// default (mesmo default de index.js) e index.js chama configurar() cedo no
// boot para sobrepor. Evita o driver ler `process.env`/globais soltos de
// index.js — fica testável isolado, só recebendo a config que precisa.
let lanTimeoutMs = 8000;
function configurar({ lanTimeoutMs: t } = {}) {
  if (t) lanTimeoutMs = t;
}
function lanRequest(device, method, pathname, opts) {
  return lanRequestComTimeout(device, method, pathname, opts, lanTimeoutMs);
}

// ---------- Login RPC2 (handshake em duas etapas) ----------
// Não é chamado hoje por nenhum comando (o ping usa um GET cgi com Digest,
// que prova credencial SEM abrir sessão — ver `testar`); mantido porque é o
// caminho de autenticação "oficial" do protocolo Dahua/RPC2 e pode ser
// necessário para chamadas RPC2 futuras que exijam sessão.
async function dahuaLogin(device) {
  const base = `http://${device.ip}:${device.porta}`;
  const user = device.api_user || 'admin';
  const pass = device.api_password || 'admin';
  const s1 = await request(`${base}/RPC2_Login`, {
    method: 'POST',
    timeout: lanTimeoutMs,
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
    timeout: lanTimeoutMs,
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

// ---------- Contrato: testar ----------

/**
 * NÃO usar login RPC2 aqui: ele cria uma sessão que não é encerrada e, com o
 * heartbeat a cada ~20s, estoura o limite do aparelho ("too many
 * connections") — derrubando o ping E os comandos. Um GET cgi com Digest
 * prova rede + credencial SEM criar sessão (stateless).
 */
async function testar(device) {
  const res = await lanRequest(device, 'GET', '/cgi-bin/magicBox.cgi?action=getDeviceType');
  return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
}

// ---------- Contrato: executar ----------

async function executar(device, cmd) {
  switch (cmd.type) {
    case 'ping':
      return testar(device);
    case 'open_door':
      return abrirPorta(device);
    case 'enroll':
    case 'update':
      return dahuaEnroll(device, cmd);
    case 'remove':
      return removerUsuario(device, cmd);
    case 'snapshot':
      return capturarSnapshot(device);
    case 'list_users':
      return listarUsuarios(device);
    case 'remove_users':
      return removerUsuarios(device, cmd);
    default:
      return { ok: false, error: `comando desconhecido: ${cmd.type}` };
  }
}

/** VALIDADO ao vivo (SS 3530 MF FACE W): abre o relé via cgi com Digest. */
async function abrirPorta(device) {
  const res = await lanRequest(
    device,
    'GET',
    '/cgi-bin/accessControl.cgi?action=openDoor&channel=1',
  );
  return okFrom(res);
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

/** VALIDADO ao vivo: array vai como query-param (?UserIDList[0]=id), não JSON. */
async function removerUsuario(device, cmd) {
  const res = await lanRequest(
    device,
    'GET',
    `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(cmd.faceId)}`,
  );
  return okFrom(res);
}

async function capturarSnapshot(device) {
  // Liga o flash automaticamente antes do snapshot
  await setDeviceLightingMode(device, 'Manual').catch(() => {});
  await sleep(300); // aguarda acender e exposição regular

  const res = await lanRequest(device, 'GET', '/cgi-bin/snapshot.cgi?channel=1');

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

async function listarUsuarios(device) {
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

async function removerUsuarios(device, cmd) {
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

// ---------- Iluminação / snapshot com Digest (preview ao vivo) ----------

/** Altera o modo de iluminação (LED/Flash) do dispositivo (Manual = ligado, Auto = automático). */
async function setDeviceLightingMode(device, mode) {
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
      req.setTimeout(lanTimeoutMs, () => req.destroy(new Error('timeout')));
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

// ---------- Contrato: escutar (stream de eventos de acesso) ----------
//
// Aparelhos Dahua/Intelbras não fazem push HTTP para uma URL: eles MANTÊM um
// stream (multipart) em /cgi-bin/eventManager.cgi?action=attach. Assinamos
// esse stream e, a cada rosto reconhecido (evento _DoorFace_ com UserID !=
// FFFFFF), repassamos o evento cru para `aoEvento`. Quem chama (hoje
// index.js, na Supervisor da tarefa 6) decide o que fazer com o evento —
// aqui só falamos o protocolo do aparelho.

/**
 * Abre o stream e mantém reconectando enquanto ninguém chamar `parar()`. O
 * aparelho fecha a conexão periodicamente — é esperado, não é erro; por isso
 * o loop reabre sempre (com uma pausa curta) até ser parado.
 *
 * `opcoes.aoConectar` (ver comentário do contrato no topo do arquivo): chamada
 * no primeiro byte recebido de CADA conexão bem-sucedida (inclusive a
 * primeira). Quem orquestra decide se/quando agir sobre isso.
 */
function escutar(device, aoEvento, opcoes = {}) {
  const aoConectar = opcoes.aoConectar;
  let parado = false;
  let streamCaida = false;
  (async () => {
    while (!parado) {
      try {
        await dahuaAttachOnce(device, aoEvento, aoConectar);
      } catch (err) {
        if (!streamCaida) {
          console.error(
            `[agente] ${device.nome}: stream de eventos caiu (${err.message || err}); reabrindo em 5s`,
          );
        }
        streamCaida = true;
      }
      if (parado) break;
      streamCaida = false;
      await sleep(5000); // o aparelho fecha o stream periodicamente — reabre
    }
  })();
  return () => {
    parado = true;
  };
}

/** Abre UMA conexão de streaming (resolve quando o aparelho a encerra).
 *  `aoConectar`, se passado, é chamado uma única vez no primeiro byte. */
function dahuaAttachOnce(device, aoEvento, aoConectar) {
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
            let aoConectarDisparado = false;
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              if (!aoConectarDisparado && aoConectar) {
                aoConectarDisparado = true;
                aoConectar();
              }
              buf += chunk;
              buf = consumeDahuaEvents(buf, aoEvento);
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
    challenge.setTimeout(lanTimeoutMs, () =>
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
  let restante = buf;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const iCode = restante.indexOf('Code=_DoorFace_');
    if (iCode < 0) break;
    const iData = restante.indexOf('data=', iCode);
    if (iData < 0) break; // cabeçalho chegou, corpo ainda não
    const iChave = restante.indexOf('{', iData);
    if (iChave < 0) break;
    const fim = fimDoObjetoJson(restante, iChave);
    if (fim < 0) break; // JSON pela metade: espera o resto do chunk
    const bruto = restante.slice(iChave, fim);
    restante = restante.slice(fim);
    try {
      onData(JSON.parse(bruto));
    } catch {
      /* JSON inválido — ignora */
    }
  }
  // Sem acesso pendente à vista, guarda só o trecho depois do último boundary:
  // o resto é heartbeat/evento de outro tipo e faria o buffer crescer à toa.
  if (restante.indexOf('Code=_DoorFace_') < 0) {
    const ultimo = restante.lastIndexOf('--myboundary');
    if (ultimo > 0) restante = restante.slice(ultimo);
  }
  return restante;
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

// ---------- Contrato: buscarDesde (replay do log interno) ----------
//
// Confirmado em campo no SS 3530 MF (24/09): recordFinder.cgi devolve o log de
// acesso em formato INI (records[i].Campo=valor), do MAIS ANTIGO ao mais novo,
// e CORTA em 1024 registros qualquer que seja o `count`; `offset` e
// `condition.*` são ignorados. Com o log acima de 1024 passagens, "pegar um
// lote grande e filtrar por RecNo" nunca via as passagens novas — o replay
// dizia "sem novidade" e a entrada feita offline sumia.
//
// O que o firmware respeita é o filtro `StartTime`/`EndTime` (epoch em
// segundos, sobre o CreateTime). Então buscamos por JANELA DE HORÁRIO: se a
// resposta vier cheia (1024), a janela é dividida ao meio e cada metade é
// buscada de novo, da mais nova para a mais antiga — parando assim que
// aparece um registro já processado (RecNo <= marca).
//
// Limite conhecido: passagens com CreateTime fora da janela (queda maior que
// JANELA_PASSADO_S, ou aparelho que voltou com o relógio em 2000 após perder
// energia) não são recuperadas.
const CORTE_DO_APARELHO = 1024;
const JANELA_PASSADO_S = 7 * 24 * 3600;
const JANELA_FUTURO_S = 24 * 3600; // tolera relógio do aparelho adiantado
const PROFUNDIDADE_MAX = 16; // 8 dias / 2^16 ≈ 10 s por fatia

function recNo(r) {
  return parseInt(r.RecNo, 10) || 0;
}

function janelaPadrao() {
  const agora = Math.floor(Date.now() / 1000);
  return { ini: agora - JANELA_PASSADO_S, fim: agora + JANELA_FUTURO_S };
}

async function buscarNaJanela(device, ini, fim) {
  const res = await lanRequest(
    device,
    'GET',
    `/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&StartTime=${ini}&EndTime=${fim}&count=${CORTE_DO_APARELHO}`,
  );
  return parseDahuaINI(String(res.raw || ''));
}

/**
 * Registros com RecNo > marca dentro de [ini, fim]. Devolve também o menor
 * RecNo visto, para a metade mais antiga ser pulada quando a mais nova já
 * alcançou a marca.
 */
async function coletarDesde(device, ini, fim, marca, prof = 0) {
  const registros = await buscarNaJanela(device, ini, fim);
  const menor = registros.reduce((m, r) => Math.min(m, recNo(r)), Infinity);
  if (registros.length < CORTE_DO_APARELHO || fim - ini < 2 || prof >= PROFUNDIDADE_MAX) {
    if (registros.length >= CORTE_DO_APARELHO) {
      console.log(`[agente] ${device.nome}: log do aparelho cheio mesmo numa fatia de ${fim - ini}s; algumas passagens podem ficar de fora.`);
    }
    return { registros: registros.filter((r) => recNo(r) > marca), menor };
  }
  const meio = Math.floor((ini + fim) / 2);
  const novos = await coletarDesde(device, meio + 1, fim, marca, prof + 1);
  if (novos.menor <= marca) return novos;
  const antigos = await coletarDesde(device, ini, meio, marca, prof + 1);
  return {
    registros: [...antigos.registros, ...novos.registros],
    menor: Math.min(antigos.menor, novos.menor),
  };
}

/** Maior RecNo dentro de [ini, fim] (0 se a janela está vazia). */
async function maiorRecNo(device, ini, fim, prof = 0) {
  const registros = await buscarNaJanela(device, ini, fim);
  if (registros.length === 0) return 0;
  if (registros.length < CORTE_DO_APARELHO || fim - ini < 2 || prof >= PROFUNDIDADE_MAX) {
    return registros.reduce((m, r) => Math.max(m, recNo(r)), 0);
  }
  const meio = Math.floor((ini + fim) / 2);
  const nova = await maiorRecNo(device, meio + 1, fim, prof + 1);
  return nova || maiorRecNo(device, ini, meio, prof + 1);
}

// Até a versão 2026.09.24 a marca era lida com o corte de 1024 e ficou
// travada abaixo do RecNo real. Tratá-la como verdadeira reenviaria, na
// primeira recuperação, passagens que o stream ao vivo já tinha mandado.
// Por isso cada aparelho tem a marca REESTABELECIDA uma vez pela busca por
// janela (sem replay) antes de voltar a recuperar passagens offline.
const MARCAS_POR_JANELA_FILE = 'dahua-marca-por-janela.json';
let marcasPorJanela = null;

function marcaConfiavel(deviceId) {
  if (!marcasPorJanela) marcasPorJanela = new Set(lerJson(MARCAS_POR_JANELA_FILE, []));
  return marcasPorJanela.has(deviceId);
}

function registrarMarcaPorJanela(deviceId, valor) {
  setBaseline(deviceId, valor);
  if (marcaConfiavel(deviceId)) return;
  marcasPorJanela.add(deviceId);
  try {
    gravarJsonAtomico(MARCAS_POR_JANELA_FILE, [...marcasPorJanela]);
  } catch (e) {
    console.error(`[agente] falha ao salvar ${MARCAS_POR_JANELA_FILE}: ${e.message || e}`);
  }
}

/**
 * Não fala com a nuvem: só lê o log interno e devolve os eventos válidos
 * (com UserID, sem tentativa negada no próprio aparelho) desde `marca`
 * (RecNo), mais a nova marca-d'água candidata (maior RecNo lido). Quem
 * chama decide até onde persistir a marca — se algum envio falhar, deve
 * represar no `_marca` do último confirmado (ver index.js
 * `syncDeviceOfflineLogs`), para o próximo ciclo tentar de novo.
 *
 * `marca === undefined` (device nunca visto): devolve `eventos: []` — a
 * primeira leitura só ESTABELECE a marca d'água, sem reprocessar o
 * histórico inteiro do aparelho como se fossem acessos novos.
 *
 * `logVazio: true` distingue "aparelho sem NENHUM registro no log interno"
 * (nada a propor, `novaMarca` não avança) de "há registros, mas nenhum novo
 * além de `marca`" — index.js usa os dois para logar mensagens distintas.
 */
async function buscarDesde(device, marca) {
  const { ini, fim } = janelaPadrao();
  if (marca === undefined || !marcaConfiavel(device.id)) {
    const maior = await maiorRecNo(device, ini, fim);
    if (!maior) return { eventos: [], novaMarca: marca, logVazio: true };
    registrarMarcaPorJanela(device.id, Math.max(maior, marca || 0));
    return { eventos: [], novaMarca: Math.max(maior, marca || 0) };
  }
  const { registros: janela } = await coletarDesde(device, ini, fim, marca);
  if (janela.length === 0) return { eventos: [], novaMarca: marca };
  const maxRecNo = janela.reduce((m, r) => Math.max(m, recNo(r)), marca);

  // O log interno guarda TAMBÉM as tentativas NEGADAS pelo aparelho
  // (ErrorCode != 0, ex.: 16 = sem saldo/na regra). Reenviar negada como
  // acesso corrompe a auditoria (vira "entrada" falsa na nuvem). Só
  // passagens de sucesso (ErrorCode 0/ausente) com UserID viram evento.
  const negadoNoAparelho = (r) =>
    r.ErrorCode != null && String(r.ErrorCode).trim() !== '0';
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
  const eventos = janela
    .filter((r) => r.UserID && r.UserID.trim() !== '' && !negadoNoAparelho(r))
    .sort((a, b) => parseInt(a.RecNo, 10) - parseInt(b.RecNo, 10))
    .map((r) => ({
      UserID: r.UserID,
      CardNo: r.CardNo,
      Similarity: 100,
      timestamp: dahuaEpochToISO(r.CreateTime),
      _marca: parseInt(r.RecNo, 10),
    }));
  return { eventos, novaMarca: maxRecNo };
}

// ---------- Extra: avança a marca d'água enquanto online (não é do contrato) ----------
//
// Enquanto o aparelho está ONLINE de forma estável, a stream ao vivo já
// encaminha cada acesso — aqui só mantemos a marca d'água (maior RecNo) atual,
// para que o PRÓXIMO reconnect só reprocesse a janela realmente offline, e não
// os eventos que a stream já pegou. Só avança; nunca reencaminha. Throttle de
// 10 min (a leitura do log é um lote; não faz sentido a cada heartbeat).
//
// O guard "recovery de log offline em curso" NÃO mora aqui (ver comentário no
// topo do arquivo) — quem chama (index.js) só invoca esta função fora dessa
// janela, usando o Set genérico que ele próprio mantém.
const lastBaselineAdvance = new Map();
const BASELINE_ADVANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 min

async function advanceBaselineWhileOnline(device, force = false) {
  const agora = Date.now();
  // Throttle: 10 min no caso ocioso; 10s logo após um evento ao vivo (force).
  // Mesmo no force coalescemos rajadas de reconhecimentos (o fetch é do log
  // inteiro) — 10s continua bem abaixo da janela de dedup (20s), então nenhum
  // evento ao vivo fica "descoberto" tempo suficiente para ser reenviado.
  const minIntervalo = force ? 10 * 1000 : BASELINE_ADVANCE_INTERVAL_MS;
  if (agora - (lastBaselineAdvance.get(device.id) || 0) < minIntervalo) return;
  lastBaselineAdvance.set(device.id, agora);
  try {
    const { ini, fim } = janelaPadrao();
    const maxRecNo = await maiorRecNo(device, ini, fim);
    if (!maxRecNo) return;
    const baseline = deviceBaselines.get(device.id);
    if (baseline === undefined || maxRecNo > baseline || !marcaConfiavel(device.id)) {
      registrarMarcaPorJanela(device.id, Math.max(maxRecNo, baseline || 0));
    }
  } catch {
    /* aparelho oscilou; o próximo ciclo tenta de novo */
  }
}

// ---------- Contrato: acertarRelogio ----------
//
// Relógio do aparelho: sem NTP ele DERIVA (visto em produção: ~2 min atrasado)
// e volta a 2000 ao perder energia. A nuvem compara a hora do log do aparelho
// (CreateTime dos replays) com a hora de chegada dos eventos ao vivo — minutos
// de atraso fazem a saída real parecer "eco da entrada" e serem descartadas.
// `force`: index.js chama com force=true no reconnect e sem force (respeita o
// throttle de 1h) no heartbeat estável.
const lastClockSyncAt = new Map(); // deviceId -> epoch ms
const CLOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000;

async function acertarRelogio(device, force = false) {
  const agora = Date.now();
  if (!force && agora - (lastClockSyncAt.get(device.id) || 0) < CLOCK_SYNC_INTERVAL_MS)
    return;
  lastClockSyncAt.set(device.id, agora);
  try {
    // Hora da NUVEM, não a desta máquina. O PC da portaria roda com o relógio
    // livre no CMOS e erra por minutos; gravar essa hora no terminal fazia os
    // acessos serem carimbados no futuro e aparecerem fora de ordem no
    // histórico. Ver `agoraDaNuvem`.
    const t = formatDahuaTime(agoraDaNuvem());
    const res = await lanRequest(
      device,
      'GET',
      `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(t)}`,
    );
    if (res.status >= 200 && res.status < 300) {
      // Deriva o skew via agoraDaNuvem() em vez de ler o estado interno de
      // core/nuvem.js diretamente (módulo não expõe o valor cru).
      const skew = Math.round((Date.now() - agoraDaNuvem().getTime()) / 1000);
      console.log(
        `[agente] ${device.nome}: relógio do aparelho acertado (${t})` +
          (Math.abs(skew) >= 5
            ? ` — ATENÇÃO: o relógio DESTA máquina está ${Math.abs(skew)}s ${
                skew > 0 ? 'adiantado' : 'atrasado'
              } em relação ao servidor. Ative a sincronização de horário do Windows.`
            : ''),
      );
    } else {
      console.log(
        `[agente] ${device.nome}: falha ao acertar relógio (HTTP ${res.status}): ${String(res.raw || '').slice(0, 80)}`,
      );
    }
  } catch (e) {
    console.log(`[agente] ${device.nome}: falha ao acertar relógio (${e.message || e})`);
  }
}

module.exports = {
  id: 'dahua-facial',
  configurar,
  testar,
  executar,
  escutar,
  buscarDesde,
  acertarRelogio,
  // Extras usados fora do contrato por index.js (preview ao vivo e
  // heartbeat de marca d'água — ver comentários acima de cada um).
  setDeviceLightingMode,
  snapshotComDigest,
  advanceBaselineWhileOnline,
};
