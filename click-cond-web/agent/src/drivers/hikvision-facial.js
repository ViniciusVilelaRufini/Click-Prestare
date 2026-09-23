'use strict';

/**
 * agent/src/drivers/hikvision-facial.js — Driver Hikvision (linha de acesso
 * facial: ISAPI, Digest auth).
 *
 * Expõe o contrato de driver da spec (todos opcionais exceto `id`):
 *   id, testar(device), executar(device, cmd),
 *   escutar(device, aoEvento, opcoes?), buscarDesde(device, marca).
 * (`acertarRelogio` não existe para esta marca — não há CGI de hora no
 * ISAPI usado hoje; o campo fica ausente e quem orquestra já lida com isso
 * via optional chaining.)
 *
 * `escutar`'s `opcoes.aoConectar` (extensão do contrato — ver comentário
 * completo em dahua-facial.js): chamada a cada conexão bem-sucedida do
 * stream alertStream (primeiro byte recebido), inclusive a primeira.
 *
 * O log genérico "assinando eventos de acesso (<driver.id>)" já é emitido
 * por quem orquestra (index.js) ANTES de chamar `escutar` — por isso, ao
 * contrário do código original (que logava de novo aqui dentro), este
 * driver não repete a mensagem.
 */

const http = require('http');
const { buildDigestHeader } = require('../lib/digest');
const { hikIsoComOffset } = require('../lib/dahua-formato');
const { buildMultipart } = require('../lib/multipart');
const {
  lanRequest: lanRequestComTimeout,
  okFrom,
  sleep,
} = require('../lib/http');
const { agoraDaNuvem } = require('../core/nuvem');

// lib/http.js não conhece o timeout da LAN — é config injetada por quem monta
// o agente (index.js lê LAN_TIMEOUT_MS do .env e chama configurar() cedo no
// boot). Mesmo padrão do driver Dahua/Intelbras.
let lanTimeoutMs = 8000;
function configurar({ lanTimeoutMs: t } = {}) {
  if (t) lanTimeoutMs = t;
}
function lanRequest(device, method, pathname, opts) {
  return lanRequestComTimeout(device, method, pathname, opts, lanTimeoutMs);
}

// ---------- Contrato: testar ----------

async function testar(device) {
  // ISAPI: deviceInfo prova rede + credencial (Digest tratado em request()).
  const res = await lanRequest(device, 'GET', '/ISAPI/System/deviceInfo');
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
      return hikvisionEnroll(device, cmd);
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

/** VALIDADO (ISAPI). Requer Digest auth — tratado automaticamente em request(). */
async function abrirPorta(device) {
  const res = await lanRequest(
    device,
    'PUT',
    '/ISAPI/AccessControl/RemoteControl/door/1',
    { xml: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>' },
  );
  return okFrom(res);
}

/** ISAPI entrega o quadro direto, sem controle de iluminação (o terminal já
 *  expõe o canal 101 como stream principal). */
async function capturarSnapshot(device) {
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

/** ISAPI: cria/atualiza o usuário e sobe o rosto. employeeNo = externalId. */
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

async function removerUsuario(device, cmd) {
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

/**
 * Identificador que NÓS gravamos no aparelho ("morador_42", "visitante_9",
 * "prestador_servico_3").
 *
 * A varredura de fantasmas apaga tudo que está no aparelho e não está no nosso
 * banco. Num terminal Hikvision, "tudo" inclui o usuário admin que o
 * instalador criou no próprio aparelho — apagá-lo trancaria o instalador
 * para fora. Restringir a listagem ao nosso padrão mantém a varredura fazendo
 * o trabalho dela sem tocar em quem não é nosso.
 */
const NOSSO_EXTERNAL_ID = /^(morador|visitante|prestador_servico)_\d+$/;

/** ISAPI pagina por searchResultPosition; o employeeNo é o nosso external_id
 *  (= face_id gravado no enrollment). */
async function listarUsuarios(device) {
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

/** Sem lote equivalente ao RPC2 da Dahua: cai para remoção individual. Uma
 *  falha isolada não aborta o lote — a varredura de fantasmas roda de hora
 *  em hora e tenta de novo o que sobrou. */
async function removerUsuarios(device, cmd) {
  const alvos = cmd.faceIds || [];
  if (alvos.length === 0) return { ok: true };
  const falhas = [];
  for (const faceId of alvos) {
    try {
      const r = await removerUsuario(device, { faceId });
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

// ---------- Contrato: escutar (alertStream de eventos de acesso) ----------

/**
 * Abre o stream e mantém reconectando enquanto ninguém chamar `parar()`. O
 * aparelho pode fechar a conexão periodicamente — não é erro; por isso o
 * loop reabre sempre (com uma pausa curta) até ser parado.
 */
function escutar(device, aoEvento, opcoes = {}) {
  const aoConectar = opcoes.aoConectar;
  let parado = false;
  (async () => {
    while (!parado) {
      try {
        await hikvisionAlertOnce(device, aoEvento, aoConectar);
      } catch (err) {
        console.error(
          `[agente] ${device.nome}: stream Hikvision caiu (${err.message || err}); reabrindo em 5s`,
        );
      }
      if (parado) break;
      await sleep(5000);
    }
  })();
  return () => {
    parado = true;
  };
}

/** Abre UMA conexão alertStream (Digest) e processa enquanto o aparelho mantém.
 *  `aoConectar`, se passado, é chamado uma única vez no primeiro byte. */
function hikvisionAlertOnce(device, aoEvento, aoConectar) {
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
            let aoConectarDisparado = false;
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              if (!aoConectarDisparado && aoConectar) {
                aoConectarDisparado = true;
                aoConectar();
              }
              buf += chunk;
              buf = consumeHikvisionEvents(buf, aoEvento);
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
    challenge.setTimeout(lanTimeoutMs, () => challenge.destroy(new Error('timeout no desafio')));
    challenge.end();
  });
}

/**
 * Extrai eventos AccessControllerEvent completos do buffer e os normaliza para o
 * formato que `aoEvento` espera ({ UserID, Similarity }). Hikvision usa
 * employeeNoString (= nosso external_id) e currentVerifyMode/faceRect.
 *
 * Emite assim que o evento está COMPLETO, sem esperar o boundary que fecha a
 * parte — esse boundary só chega junto com o evento SEGUINTE, então quem
 * esperasse por ele só encaminharia o acesso quando a próxima pessoa passasse
 * (e ainda o carimbaria com a hora errada). Mesmo cuidado em
 * dahua-facial.js/consumeDahuaEvents.
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

// ---------- Contrato: buscarDesde (replay do log interno) ----------
//
// Diferente de posição/paginação, o ISAPI EXIGE uma janela de tempo
// (startTime/endTime) em AcsEvent — sem ela devolve os eventos MAIS ANTIGOS
// do aparelho, que num terminal em uso já estão muito abaixo da marca
// d'água (nunca chegaria evento). HIK_REPLAY_WINDOW_MS cobre uma queda longa
// de internet sem trazer o histórico inteiro do aparelho.
const HIK_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Não fala com a nuvem: só lê o log de acesso (AcsEvent) e devolve os
 * eventos válidos desde `marca` (serialNo), mais a nova marca-d'água
 * candidata (maior serialNo lido). Quem chama decide até onde persistir a
 * marca — mesmo contrato do driver Dahua/Intelbras (ver comentário em
 * dahua-facial.js `buscarDesde`).
 *
 * `marca === undefined` (device nunca visto): devolve `eventos: []` — a
 * primeira leitura só ESTABELECE a marca d'água.
 *
 * `logVazio: true` distingue "aparelho sem NENHUM registro na janela" de "há
 * registros, mas nenhum novo além de `marca`".
 */
async function buscarDesde(device, marca) {
  const agora = agoraDaNuvem();
  const desde = new Date(agora.getTime() - HIK_REPLAY_WINDOW_MS);
  const res = await lanRequest(
    device,
    'POST',
    '/ISAPI/AccessControl/AcsEvent?format=json',
    {
      json: {
        AcsEventCond: {
          searchID: 'agent-offline-sync',
          searchResultPosition: 0,
          maxResults: 50,
          major: 0,
          minor: 0,
          startTime: hikIsoComOffset(desde),
          endTime: hikIsoComOffset(agora),
        },
      },
    },
  );
  const infoList = res.data && res.data.AcsEvent && res.data.AcsEvent.InfoList;
  if (!Array.isArray(infoList) || infoList.length === 0) {
    return { eventos: [], novaMarca: marca, logVazio: true };
  }

  infoList.sort((a, b) => (a.serialNo || 0) - (b.serialNo || 0));
  const maxSerial = Math.max(...infoList.map((l) => l.serialNo || 0));
  if (marca === undefined || maxSerial <= marca) {
    return { eventos: [], novaMarca: maxSerial };
  }

  const eventos = infoList
    .filter((l) => (l.serialNo || 0) > marca && l.employeeNoString)
    .map((l) => ({
      UserID: l.employeeNoString,
      Similarity: 100,
      timestamp: l.time,
      _marca: l.serialNo || 0,
    }));
  return { eventos, novaMarca: maxSerial };
}

module.exports = {
  id: 'hikvision-facial',
  configurar,
  testar,
  executar,
  escutar,
  buscarDesde,
};
