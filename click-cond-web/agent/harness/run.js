'use strict';
/**
 * Harness de verificação sem hardware.
 *
 * Sobe: aparelho Hikvision falso (Digest real), Control iD falso (sessão) e uma
 * NUVEM falsa que fala o mesmo protocolo de poll/result/event do backend.
 * Depois roda o AGENTE REAL (cópia byte a byte de agent/index.js) contra tudo e
 * confere o que chegou em cada ponta.
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  comFechamentoForcado,
  estado,
  servidorHik,
  servidorControlId,
  servidorDahua,
  USER,
  PASS,
} = require('./mock-device');

const PORTA_NUVEM = 9100;
const PORTA_HIK = 9101;
const PORTA_CID = 9102;
const PORTA_DAHUA = 9103;
const TOKEN = 'token-de-teste';

const DEVICES = {
  10: {
    id: 10,
    nome: 'Terminal Hikvision',
    tipo: 'facial',
    fabricante: 'hikvision',
    ip: '127.0.0.1',
    porta: PORTA_HIK,
    api_user: USER,
    api_password: PASS,
  },
  20: {
    id: 20,
    nome: 'Terminal Control iD',
    tipo: 'facial',
    fabricante: 'control_id',
    ip: '127.0.0.1',
    porta: PORTA_CID,
    api_user: USER,
    api_password: PASS,
  },
  // Marca que JÁ funciona em produção: está aqui para provar não-regressão.
  30: {
    id: 30,
    nome: 'Terminal Intelbras',
    tipo: 'facial',
    fabricante: 'intelbras',
    ip: '127.0.0.1',
    porta: PORTA_DAHUA,
    api_user: USER,
    api_password: PASS,
  },
};

const filaComandos = new Map([[10, []], [20, []], [30, []]]);
const resultados = new Map(); // commandId -> result
const eventos = [];
const statusRecebidos = [];
let proximoCmd = 1;

function enfileirar(deviceId, cmd) {
  const id = `cmd-${proximoCmd++}`;
  filaComandos.get(deviceId).push({ id, ...cmd });
  return id;
}

// ---------- Nuvem falsa ----------
function criarNuvem() {
  return comFechamentoForcado(
    http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const json = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const p = req.url.split('?')[0];

      if (p === `/api/facial/agent/condo/${TOKEN}/poll`) {
        const devices = Object.values(DEVICES).map((device) => {
          const commands = filaComandos.get(device.id);
          filaComandos.set(device.id, []);
          return { device, commands };
        });
        return json({ devices, poll_interval_ms: 300 });
      }
      if (p === `/api/facial/agent/condo/${TOKEN}/result`) {
        resultados.set(body.commandId, body);
        return json({ ok: true });
      }
      if (p === `/api/facial/agent/condo/${TOKEN}/event`) {
        eventos.push(body);
        return json({ ok: true });
      }
      if (p === `/api/facial/agent/condo/${TOKEN}/device-status`) {
        statusRecebidos.push(...(body.statuses || []));
        return json({ ok: true });
      }
      res.writeHead(404);
      res.end('nao implementado: ' + p);
    });
  })
  .listen(PORTA_NUVEM, '127.0.0.1'),
  );
}
let nuvem = criarNuvem();

// ---------- Aparelhos falsos ----------
let streamRes = null;
const hik = servidorHik(PORTA_HIK, (res) => {
  streamRes = res;
});
const cid = servidorControlId(PORTA_CID);
let streamDahua = null;
let dahua = servidorDahua(PORTA_DAHUA, (res) => {
  streamDahua = res;
});

/** Simula o aparelho caindo da rede e voltando (queda de energia/switch). */
async function piscarAparelhoDahua(msFora) {
  await dahua.fecharAgora();
  streamDahua = null;
  await new Promise((r) => setTimeout(r, msFora));
  dahua = servidorDahua(PORTA_DAHUA, (res) => {
    streamDahua = res;
  });
}

/** Empurra um reconhecimento pela stream de eventos do Intelbras/Dahua. */
function empurrarEventoDahua(userId, similarity) {
  if (!streamDahua) return false;
  const dados = JSON.stringify({ UserID: userId, Similarity: similarity, CardNo: '' });
  streamDahua.write(
    `--myboundary\r\nContent-Type: text/plain\r\n\r\n` +
      `Code=_DoorFace_;action=Pulse;index=0;data=${dados}\r\n`,
  );
  return true;
}

/** Empurra um reconhecimento pela stream ao vivo da Hikvision. */
function empurrarEventoHik(employeeNo, similarity) {
  if (!streamRes) return false;
  const corpo = JSON.stringify({
    ipAddress: '127.0.0.1',
    eventType: 'AccessControllerEvent',
    AccessControllerEvent: { employeeNoString: employeeNo, similarity },
  });
  streamRes.write(
    `--MIME_boundary\r\nContent-Type: application/json\r\nContent-Length: ${corpo.length}\r\n\r\n${corpo}\r\n`,
  );
  return true;
}

/** Mesmo evento, no formato XML — o padrão de fábrica do firmware Hikvision. */
function empurrarEventoHikXml(employeeNo, similarity) {
  if (!streamRes) return false;
  const corpo =
    `<?xml version="1.0" encoding="UTF-8"?>\r\n<EventNotificationAlert>` +
    `<eventType>AccessControllerEvent</eventType>` +
    `<AccessControllerEvent><employeeNoString>${employeeNo}</employeeNoString>` +
    `<similarity>${similarity}</similarity></AccessControllerEvent>` +
    `</EventNotificationAlert>`;
  streamRes.write(
    `--MIME_boundary\r\nContent-Type: application/xml\r\nContent-Length: ${corpo.length}\r\n\r\n${corpo}\r\n`,
  );
  return true;
}

// ---------- Asserções ----------
const falhas = [];
const passes = [];
function checar(nome, condicao, detalhe = '') {
  if (condicao) passes.push(nome);
  else falhas.push(`${nome}${detalhe ? ' — ' + detalhe : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarResultado(cmdId, timeoutMs = 15000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (resultados.has(cmdId)) return resultados.get(cmdId);
    await sleep(100);
  }
  return null;
}

/**
 * O agente grava estado (marca d'água, fila offline) AO LADO do index.js. Por
 * isso rodamos uma CÓPIA numa pasta descartável: um teste nunca pode sobrescrever
 * o estado do agente de verdade que esteja rodando nesta máquina.
 */
function prepararCopiaDoAgente() {
  const destino = path.join(__dirname, '.tmp-agent');
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'index.js'), path.join(destino, 'index.js'));
  for (const f of ['device-baselines.json', 'events-queue.jsonl']) {
    const alvo = path.join(destino, f);
    if (fs.existsSync(alvo)) fs.unlinkSync(alvo);
  }
  return path.join(destino, 'index.js');
}

async function main() {
  const agentePath = prepararCopiaDoAgente();

  const agente = spawn(process.execPath, [agentePath], {
    env: {
      ...process.env,
      API_URL: `http://127.0.0.1:${PORTA_NUVEM}`,
      AGENT_TOKEN: TOKEN,
      POLL_INTERVAL_MS: '300',
      DEVICE_STATUS_INTERVAL_MS: '1000',
      LAN_TIMEOUT_MS: '5000',
      LIVEVIEW_PORT: '8799',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logAgente = [];
  agente.stdout.on('data', (d) => logAgente.push(d.toString()));
  agente.stderr.on('data', (d) => logAgente.push('[err] ' + d.toString()));

  try {
    await sleep(1500); // deixa o agente conectar e assinar as streams

    // ===== Hikvision =====
    const cEnroll = enfileirar(10, {
      type: 'enroll',
      externalId: 'morador_42',
      nome: 'Ana Souza',
      fotoBase64: Buffer.alloc(3000, 7).toString('base64'),
      validFrom: '2026-08-17 08:00:00',
      validTo: '2026-08-17 18:00:00',
    });
    const rEnroll = await esperarResultado(cEnroll);
    checar('hik: enroll OK', rEnroll?.ok === true, JSON.stringify(rEnroll));
    checar('hik: faceId = external_id', rEnroll?.faceId === 'morador_42', rEnroll?.faceId);
    checar('hik: usuário gravado', estado.hik.usuarios.has('morador_42'));
    checar('hik: rosto gravado (multipart aceito)', estado.hik.rostos.has('morador_42'));
    const uHik = estado.hik.usuarios.get('morador_42');
    checar('hik: validade convertida p/ ISO', uHik?.Valid?.beginTime === '2026-08-17T08:00:00', uHik?.Valid?.beginTime);
    checar('hik: Digest validado pelo aparelho', estado.hik.digestOk > 0, `ok=${estado.hik.digestOk}`);

    // Re-enroll: o Record duplicado dá 400 e precisa cair para o Modify.
    const cRe = enfileirar(10, {
      type: 'enroll',
      externalId: 'morador_42',
      nome: 'Ana Souza Silva',
      fotoBase64: Buffer.alloc(3000, 9).toString('base64'),
    });
    const rRe = await esperarResultado(cRe);
    checar('hik: re-enroll cai para Modify', rRe?.ok === true, JSON.stringify(rRe));
    checar(
      'hik: nome atualizado',
      estado.hik.usuarios.get('morador_42')?.name === 'Ana Souza Silva',
      estado.hik.usuarios.get('morador_42')?.name,
    );

    // Segundo usuário, para a listagem paginar.
    await esperarResultado(
      enfileirar(10, { type: 'enroll', externalId: 'visitante_9', nome: 'Bob', fotoBase64: Buffer.alloc(3000, 5).toString('base64') }),
    );

    // Usuário criado no aparelho pelo instalador: a varredura de fantasmas não
    // pode enxergá-lo, senão o apagaria e o trancaria fora do equipamento.
    estado.hik.usuarios.set('admin_instalador', { employeeNo: 'admin_instalador' });
    estado.cid.usuarios.set('1', { name: 'Admin', registration: 'admin' });

    const cList = enfileirar(10, { type: 'list_users' });
    const rList = await esperarResultado(cList);
    checar('hik: list_users OK', rList?.ok === true, JSON.stringify(rList));
    checar(
      'hik: listou os dois usuários',
      Array.isArray(rList?.userIds) && rList.userIds.length === 2 &&
        rList.userIds.includes('morador_42') && rList.userIds.includes('visitante_9'),
      JSON.stringify(rList?.userIds),
    );
    checar(
      'hik: NÃO lista o admin do instalador',
      !rList?.userIds?.includes('admin_instalador'),
      JSON.stringify(rList?.userIds),
    );

    const cSnap = enfileirar(10, { type: 'snapshot' });
    const rSnap = await esperarResultado(cSnap);
    checar('hik: snapshot OK', rSnap?.ok === true, JSON.stringify(rSnap)?.slice(0, 120));
    checar(
      'hik: snapshot é JPEG',
      typeof rSnap?.imageBase64 === 'string' &&
        Buffer.from(rSnap.imageBase64, 'base64').slice(0, 2).toString('hex') === 'ffd8',
    );

    const cDoor = enfileirar(10, { type: 'open_door' });
    const rDoor = await esperarResultado(cDoor);
    checar('hik: open_door OK', rDoor?.ok === true && estado.hik.portaAberta === 1);

    // Remoção em lote (varredura de fantasmas) — sem lote no ISAPI, o agente
    // precisa cair para remoção individual.
    const cRem = enfileirar(10, { type: 'remove_users', faceIds: ['morador_42', 'visitante_9'] });
    const rRem = await esperarResultado(cRem);
    checar('hik: remove_users OK', rRem?.ok === true, JSON.stringify(rRem));
    // Só o admin do instalador sobrevive — os nossos dois saíram.
    checar(
      'hik: usuários removidos, admin do instalador preservado',
      estado.hik.usuarios.size === 1 && estado.hik.usuarios.has('admin_instalador'),
      `restaram ${[...estado.hik.usuarios.keys()].join(',')}`,
    );
    checar('hik: rostos removidos da FDLib', estado.hik.rostos.size === 0, `restaram ${estado.hik.rostos.size}`);

    // Evento ao vivo pela alertStream.
    const antes = eventos.length;
    const empurrou = empurrarEventoHik('morador_42', 88);
    checar('hik: alertStream foi assinada', empurrou);
    await sleep(1200);
    const evHik = eventos.slice(antes).find((e) => e.external_id === 'morador_42');
    checar('hik: evento ao vivo chegou à nuvem', !!evHik, JSON.stringify(eventos.slice(antes)));
    checar('hik: confiança normalizada 0-1', evHik?.confidence === 0.88, String(evHik?.confidence));
    // Encaminhado SEM precisar do boundary da parte seguinte: se dependesse
    // dele, o acesso só subiria quando a próxima pessoa passasse.
    checar('hik: encaminha sem esperar o próximo evento', !!evHik);

    // Formato XML — padrão de fábrica do firmware. Pessoa diferente para não
    // esbarrar no debounce por credencial.
    const antesXml = eventos.length;
    empurrarEventoHikXml('prestador_servico_3', 77);
    await sleep(1500);
    const evXml = eventos.slice(antesXml).find((e) => e.external_id === 'prestador_servico_3');
    checar('hik: evento XML da stream chegou à nuvem', !!evXml, JSON.stringify(eventos.slice(antesXml)));
    checar('hik: confiança do XML normalizada', evXml?.confidence === 0.77, String(evXml?.confidence));

    // ===== Control iD =====
    const cCid = enfileirar(20, {
      type: 'enroll',
      externalId: 'morador_77',
      nome: 'Carla',
      fotoBase64: Buffer.alloc(4000, 3).toString('base64'),
    });
    const rCid = await esperarResultado(cCid);
    checar('cid: enroll OK', rCid?.ok === true, JSON.stringify(rCid));
    // O faceId precisa ser o id INTERNO do aparelho (é por ele que o push
    // nativo resolve a pessoa), não o nosso external_id.
    checar('cid: faceId = id interno do aparelho', /^\d+$/.test(String(rCid?.faceId)), String(rCid?.faceId));
    const idInterno = String(rCid?.faceId);
    checar('cid: usuário gravado', estado.cid.usuarios.has(idInterno));
    checar(
      'cid: registration = nosso external_id',
      estado.cid.usuarios.get(idInterno)?.registration === 'morador_77',
    );
    checar('cid: rosto gravado', estado.cid.rostos.has(idInterno));

    const cCidList = enfileirar(20, { type: 'list_users' });
    const rCidList = await esperarResultado(cCidList);
    checar('cid: list_users OK', rCidList?.ok === true, JSON.stringify(rCidList));
    checar(
      'cid: listou o id interno',
      rCidList?.userIds?.includes(idInterno),
      JSON.stringify(rCidList?.userIds),
    );
    checar(
      'cid: NÃO lista usuário sem registration nosso',
      !rCidList?.userIds?.includes('1'),
      JSON.stringify(rCidList?.userIds),
    );

    const cCidDoor = enfileirar(20, { type: 'open_door' });
    const rCidDoor = await esperarResultado(cCidDoor);
    checar('cid: open_door OK', rCidDoor?.ok === true && estado.cid.portaAberta === 1);

    // Poller de eventos ao vivo do Control iD: injeta log novo no aparelho.
    const antesCid = eventos.length;
    estado.cid.accessLogs.push({
      id: 9001,
      time: Math.floor(Date.now() / 1000),
      user_id: Number(idInterno),
      event: 7,
    });
    await sleep(4000);
    const evCid = eventos.slice(antesCid).find((e) => e.external_id === idInterno);
    checar('cid: poller ao vivo enviou o acesso', !!evCid, JSON.stringify(eventos.slice(antesCid)));
    checar('cid: evento ao vivo NÃO é backlog', evCid && !evCid.backlog);

    // Não pode reenviar o mesmo log no ciclo seguinte (marca d'água).
    const qtdAntes = eventos.filter((e) => e.external_id === idInterno).length;
    await sleep(3000);
    const qtdDepois = eventos.filter((e) => e.external_id === idInterno).length;
    checar('cid: não reenvia o mesmo acesso', qtdDepois === qtdAntes, `${qtdAntes} → ${qtdDepois}`);

    // O poller precisa pedir DESC — com asc o aparelho devolve os mais antigos
    // e nada acima da marca d'água apareceria.
    const condsLogs = estado.cid.loadObjectsConds.filter((c) => c.object === 'access_logs');
    checar(
      'cid: consulta de logs usa order desc',
      condsLogs.length > 0 && condsLogs.every((c) => c.order?.[1] === 'desc'),
      JSON.stringify(condsLogs[0]?.order),
    );

    const cCidRem = enfileirar(20, { type: 'remove_users', faceIds: [idInterno] });
    const rCidRem = await esperarResultado(cCidRem);
    checar('cid: remove_users OK', rCidRem?.ok === true, JSON.stringify(rCidRem));
    checar('cid: usuário removido', !estado.cid.usuarios.has(idInterno));

    // ===== Intelbras / Dahua: NÃO-REGRESSÃO da marca que já funciona =====
    const cDh = enfileirar(30, {
      type: 'enroll',
      externalId: 'morador_5',
      nome: 'Diego',
      fotoBase64: Buffer.alloc(3000, 1).toString('base64'),
    });
    const rDh = await esperarResultado(cDh);
    checar('dahua: enroll OK', rDh?.ok === true, JSON.stringify(rDh));
    checar('dahua: usuário gravado', estado.dahua.usuarios.has('morador_5'));
    checar('dahua: rosto gravado', estado.dahua.rostos.has('morador_5'));
    checar(
      'dahua: morador fica com validade permanente',
      estado.dahua.usuarios.get('morador_5')?.ValidFrom === '2000-01-01 00:00:00',
      estado.dahua.usuarios.get('morador_5')?.ValidFrom,
    );

    // Visitante: a janela da visita vai para o aparelho, que nega sozinho depois.
    const cDhVis = enfileirar(30, {
      type: 'enroll',
      externalId: 'visitante_8',
      nome: 'Entregador',
      fotoBase64: Buffer.alloc(3000, 2).toString('base64'),
      validFrom: '2026-08-17 08:00:00',
      validTo: '2026-08-17 18:00:00',
      userTimes: 1,
    });
    const rDhVis = await esperarResultado(cDhVis);
    checar('dahua: enroll de visitante OK', rDhVis?.ok === true, JSON.stringify(rDhVis));
    const uVis = estado.dahua.usuarios.get('visitante_8');
    checar('dahua: janela da visita enviada', uVis?.ValidTo === '2026-08-17 18:00:00', uVis?.ValidTo);
    // UseTime só vale com UserType=2 (convidado) — regressão aqui quebraria o
    // "uma entrada só" do visitante.
    checar('dahua: visitante vai como convidado (UserType 2)', uVis?.UserType === 2, String(uVis?.UserType));
    checar('dahua: UseTime preservado', uVis?.UseTime === 1, String(uVis?.UseTime));

    // Re-sync do mesmo rosto: o insertMulti duplicado dá erro no aparelho, por
    // isso o cliente remove antes (replace limpo). Sem isso o cadastro trava.
    const cDhRe = enfileirar(30, {
      type: 'enroll',
      externalId: 'morador_5',
      nome: 'Diego Alves',
      fotoBase64: Buffer.alloc(3000, 4).toString('base64'),
    });
    checar('dahua: re-sync não trava em duplicado', (await esperarResultado(cDhRe))?.ok === true);
    checar('dahua: nome atualizado', estado.dahua.usuarios.get('morador_5')?.UserName === 'Diego Alves');

    const rDhList = await esperarResultado(enfileirar(30, { type: 'list_users' }));
    checar(
      'dahua: list_users via RPC2',
      rDhList?.ok === true && rDhList.userIds.includes('morador_5') && rDhList.userIds.includes('visitante_8'),
      JSON.stringify(rDhList),
    );

    const rDhSnap = await esperarResultado(enfileirar(30, { type: 'snapshot' }));
    checar('dahua: snapshot OK', rDhSnap?.ok === true && !!rDhSnap.imageBase64);

    const rDhDoor = await esperarResultado(enfileirar(30, { type: 'open_door' }));
    checar('dahua: open_door OK', rDhDoor?.ok === true && estado.dahua.portaAberta === 1);

    // Evento ao vivo ISOLADO (nenhum outro depois): se o parser depender do
    // boundary seguinte, este acesso fica preso até a próxima pessoa passar.
    const antesDh = eventos.length;
    checar('dahua: stream de eventos assinada', empurrarEventoDahua('morador_5', 92));
    await sleep(1500);
    const evDh = eventos.slice(antesDh).find((e) => e.external_id === 'morador_5');
    checar('dahua: evento isolado chega sem esperar o próximo', !!evDh, JSON.stringify(eventos.slice(antesDh)));

    const rDhRem = await esperarResultado(
      enfileirar(30, { type: 'remove_users', faceIds: ['morador_5', 'visitante_8'] }),
    );
    checar('dahua: remove_users via RPC2', rDhRem?.ok === true && estado.dahua.usuarios.size === 0);

    checar('dahua: relógio sincronizado', estado.dahua.relogioSincronizado > 0, String(estado.dahua.relogioSincronizado));

    // ===== Aparelho cai da rede e volta: replay do log interno =====
    // A stream ao vivo não viu esses acessos (o agente não alcançava o
    // aparelho); eles ficaram só no log interno do terminal.

    // 1ª volta: estabelece a marca d'água SEM reprocessar o histórico.
    estado.dahua.registros = [
      { RecNo: '100', UserID: 'morador_5', CreateTime: String(Math.floor(Date.now() / 1000)), ErrorCode: '0' },
    ];
    await piscarAparelhoDahua(2500);
    await sleep(4000);

    // 2ª volta: agora sim, o que entrou durante a queda precisa ser recuperado.
    const antesReplay = eventos.length;
    const agoraSeg = Math.floor(Date.now() / 1000);
    estado.dahua.registros = [
      ...estado.dahua.registros,
      { RecNo: '101', UserID: 'morador_77', CreateTime: String(agoraSeg), ErrorCode: '0' },
      // Tentativa NEGADA pelo aparelho: reenviar como acesso corromperia a
      // auditoria (viraria "entrada" falsa na nuvem).
      { RecNo: '102', UserID: 'visitante_31', CreateTime: String(agoraSeg), ErrorCode: '16' },
    ];
    await piscarAparelhoDahua(2500);
    await sleep(5000);

    const replayed = eventos.slice(antesReplay);
    checar(
      'replay: acesso ocorrido na queda é recuperado',
      replayed.some((e) => e.external_id === 'morador_77'),
      JSON.stringify(replayed),
    );
    checar(
      'replay: vem marcado como backlog (não reabre a porta)',
      replayed.find((e) => e.external_id === 'morador_77')?.backlog === true,
    );
    checar(
      'replay: tentativa NEGADA no aparelho não vira acesso',
      !replayed.some((e) => e.external_id === 'visitante_31'),
      JSON.stringify(replayed.map((e) => e.external_id)),
    );
    checar(
      'replay: histórico anterior à marca dagua não é reprocessado',
      !replayed.some((e) => e.external_id === 'morador_5'),
      JSON.stringify(replayed.map((e) => e.external_id)),
    );

    // ===== Queda de internet: store-and-forward =====
    // O acesso acontece com a nuvem inalcançável. A pessoa passou pela porta;
    // perder esse registro é perder auditoria. O agente guarda em disco e
    // reenvia quando a nuvem volta.
    await nuvem.fecharAgora();
    await sleep(600);
    const antesQueda = eventos.length;
    empurrarEventoDahua('morador_99', 95); // credencial distinta: o debounce de 8s por pessoa descartaria uma repetida
    await sleep(1500);
    checar(
      'rede: nada chega enquanto a nuvem está fora',
      eventos.length === antesQueda,
      `${eventos.length - antesQueda} evento(s)`,
    );

    nuvem = criarNuvem();
    await sleep(4000); // poll volta a responder → dispara o flush da fila
    const evReenviado = eventos.slice(antesQueda).find((e) => e.external_id === 'morador_99');
    checar(
      'rede: acesso da queda é reenviado quando a nuvem volta',
      !!evReenviado,
      JSON.stringify(eventos.slice(antesQueda)),
    );

    // ===== Heartbeat de status =====
    checar(
      'status: ambos reportados online',
      statusRecebidos.some((s) => s.deviceId === 10 && s.online) &&
        statusRecebidos.some((s) => s.deviceId === 20 && s.online),
      JSON.stringify(statusRecebidos.slice(0, 6)),
    );

    // ===== Replay offline da Hikvision (janela de tempo) =====
    const condsAcs = estado.hik.acsEventConds;
    if (condsAcs.length > 0) {
      checar(
        'hik: replay manda janela de tempo',
        condsAcs.every((c) => !!c.startTime && !!c.endTime),
        JSON.stringify(condsAcs[0]),
      );
      checar(
        'hik: janela em ISO com offset (sem sufixo Z)',
        /[+-]\d{2}:\d{2}$/.test(condsAcs[0].startTime),
        condsAcs[0].startTime,
      );
    }
  } finally {
    agente.kill();
    void nuvem.fecharAgora();
    void hik.fecharAgora();
    void dahua.fecharAgora();
    void cid.fecharAgora();
    try {
      if (streamRes) streamRes.end();
    } catch {
      /* stream já fechada */
    }
    fs.writeFileSync(path.join(__dirname, '.tmp-agent', 'agent-log.txt'), logAgente.join(''), 'utf8');
  }

  console.log('\n===== RESULTADO =====');
  for (const p of passes) console.log('  PASS  ' + p);
  for (const f of falhas) console.log('  FALHA ' + f);
  console.log(`\n${passes.length} passaram, ${falhas.length} falharam`);
  process.exit(falhas.length ? 1 : 0);
}

main().catch((e) => {
  console.error('harness quebrou:', e);
  process.exit(2);
});
