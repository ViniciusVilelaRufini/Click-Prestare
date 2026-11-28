'use strict';
/**
 * Aparelhos FALSOS que falam os protocolos reais:
 *   - Hikvision ISAPI com autenticação Digest de verdade (valida o hash)
 *   - Control iD .fcgi com sessão
 *
 * Objetivo: exercitar o código real do agente/cliente sem hardware. Tudo que
 * chega fica registrado em `estado` para o harness inspecionar depois.
 */
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/**
 * `server.close()` sozinho ESPERA as conexões abertas terminarem — e a stream
 * de eventos nunca termina, então o close nunca resolvia. Aqui derrubamos os
 * sockets primeiro: é o que acontece de verdade quando o aparelho perde
 * energia ou o switch cai.
 */
function comFechamentoForcado(server) {
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  server.fecharAgora = () =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      sockets.clear();
      server.close(resolve);
    });
  return server;
}

const USER = 'admin';
const PASS = 'senha123';
const REALM = 'DS-K1T671M';

const estado = {
  hik: {
    usuarios: new Map(), // employeeNo -> { name, Valid }
    rostos: new Map(), // FPID -> tamanho do jpeg
    portaAberta: 0,
    digestOk: 0,
    digestFalhou: 0,
    acsEventConds: [],
    requisicoes: [],
  },
  cid: {
    sessions: new Set(),
    usuarios: new Map(), // id -> { name, registration }
    rostos: new Map(),
    portaAberta: 0,
    proximoId: 100,
    accessLogs: [],
    loadObjectsConds: [],
    requisicoes: [],
  },
};

// ---------- Hikvision (Digest) ----------

function exigeDigest(req, res, body) {
  const auth = req.headers.authorization || '';
  if (!/^Digest /i.test(auth)) {
    estado.hik.digestFalhou++;
    res.writeHead(401, {
      'WWW-Authenticate': `Digest realm="${REALM}", nonce="${crypto.randomBytes(8).toString('hex')}", qop="auth"`,
    });
    res.end('unauthorized');
    return false;
  }
  // Valida o hash de verdade: senha errada ou cálculo errado não passa.
  const campo = (k) => {
    const m = auth.match(new RegExp(`${k}="?([^",]+)"?`, 'i'));
    return m ? m[1] : '';
  };
  const ha1 = md5(`${USER}:${campo('realm')}:${PASS}`);
  const ha2 = md5(`${req.method}:${campo('uri')}`);
  const qop = campo('qop');
  const esperado = qop
    ? md5(`${ha1}:${campo('nonce')}:${campo('nc')}:${campo('cnonce')}:${qop}:${ha2}`)
    : md5(`${ha1}:${campo('nonce')}:${ha2}`);
  if (esperado !== campo('response')) {
    estado.hik.digestFalhou++;
    res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", nonce="x", qop="auth"` });
    res.end('bad digest');
    return false;
  }
  // O `uri` do header precisa bater com o caminho realmente pedido, senão o
  // aparelho real recusa (é o que evita replay do header em outra rota).
  if (campo('uri') !== req.url) {
    estado.hik.digestFalhou++;
    res.writeHead(401);
    res.end('uri mismatch');
    return false;
  }
  estado.hik.digestOk++;
  return true;
}

const jpegFalso = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(2048, 0x42),
  Buffer.from([0xff, 0xd9]),
]);

function servidorHik(porta, onStream) {
  return comFechamentoForcado(
    http
    .createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const caminho = req.url.split('?')[0];
        estado.hik.requisicoes.push(`${req.method} ${req.url}`);

        if (!exigeDigest(req, res, body)) return;

        const json = (obj, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        const parse = () => {
          try {
            return JSON.parse(body.toString('utf8'));
          } catch {
            return {};
          }
        };

        if (caminho === '/ISAPI/System/deviceInfo') {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end('<DeviceInfo><model>DS-K1T671M</model></DeviceInfo>');
        }

        if (caminho === '/ISAPI/Streaming/channels/101/picture') {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(jpegFalso);
        }

        if (caminho === '/ISAPI/AccessControl/RemoteControl/door/1') {
          estado.hik.portaAberta++;
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/AccessControl/UserInfo/Record') {
          const info = parse().UserInfo?.[0];
          if (!info?.employeeNo) return json({ statusString: 'Error' }, 400);
          // Aparelho real recusa cadastro duplicado — o cliente precisa cair
          // para o Modify quando isso acontece.
          if (estado.hik.usuarios.has(String(info.employeeNo))) {
            return json({ statusString: 'Error: duplicate' }, 400);
          }
          estado.hik.usuarios.set(String(info.employeeNo), info);
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/AccessControl/UserInfo/Modify') {
          const info = parse().UserInfo?.[0];
          if (!info?.employeeNo) return json({ statusString: 'Error' }, 400);
          estado.hik.usuarios.set(String(info.employeeNo), info);
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/AccessControl/UserInfo/Delete') {
          const lista = parse().UserInfoDelCond?.EmployeeNoList ?? [];
          for (const e of lista) estado.hik.usuarios.delete(String(e.employeeNo));
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/Intelligent/FDLib/FDSetUp') {
          for (const f of parse().FPID ?? []) estado.hik.rostos.delete(String(f.value));
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/Intelligent/FDLib/FaceDataRecord') {
          // Verifica de verdade o multipart: precisa ter a parte JSON com FPID
          // e a parte binária do JPEG.
          const ct = req.headers['content-type'] || '';
          const m = ct.match(/boundary=(.+)$/);
          if (!m) return json({ statusString: 'Error: sem boundary' }, 400);
          const texto = body.toString('binary');
          const partes = texto.split('--' + m[1]);
          const parteJson = partes.find((p) => p.includes('FaceDataRecord'));
          const parteImg = partes.find((p) => p.includes('filename='));
          if (!parteJson || !parteImg) {
            return json({ statusString: 'Error: multipart incompleto' }, 400);
          }
          const corpo = parteJson.slice(parteJson.indexOf('{'));
          let fpid;
          try {
            fpid = JSON.parse(corpo.slice(0, corpo.lastIndexOf('}') + 1)).FPID;
          } catch {
            return json({ statusString: 'Error: json invalido' }, 400);
          }
          const bytesImg = parteImg.slice(parteImg.indexOf('\r\n\r\n') + 4).length;
          if (bytesImg < 100) return json({ statusString: 'Error: imagem vazia' }, 400);
          estado.hik.rostos.set(String(fpid), bytesImg);
          return json({ statusCode: 1, statusString: 'OK' });
        }

        if (caminho === '/ISAPI/AccessControl/UserInfo/Search') {
          const cond = parse().UserInfoSearchCond ?? {};
          const pos = Number(cond.searchResultPosition ?? 0);
          const max = Number(cond.maxResults ?? 50);
          const todos = [...estado.hik.usuarios.keys()];
          const pagina = todos.slice(pos, pos + max);
          return json({
            UserInfoSearch: {
              searchID: cond.searchID,
              responseStatusStrg: pos + pagina.length < todos.length ? 'MORE' : 'OK',
              numOfMatches: pagina.length,
              totalMatches: todos.length,
              UserInfo: pagina.map((employeeNo) => ({ employeeNo })),
            },
          });
        }

        if (caminho === '/ISAPI/AccessControl/AcsEvent') {
          const cond = parse().AcsEventCond ?? {};
          estado.hik.acsEventConds.push(cond);
          // Aparelho real EXIGE a janela de tempo; sem ela devolve os mais
          // antigos. Aqui recusamos, para provar que o cliente manda a janela.
          if (!cond.startTime || !cond.endTime) {
            return json({ statusString: 'Error: startTime/endTime obrigatorios' }, 400);
          }
          return json({
            AcsEvent: {
              searchID: cond.searchID,
              responseStatusStrg: 'OK',
              InfoList: [
                { serialNo: 501, employeeNoString: 'morador_7', time: new Date().toISOString() },
                { serialNo: 502, employeeNoString: 'visitante_9', time: new Date().toISOString() },
              ],
            },
          });
        }

        if (caminho === '/ISAPI/Event/notification/alertStream') {
          res.writeHead(200, {
            'Content-Type': 'multipart/mixed; boundary=MIME_boundary',
          });
          onStream(res);
          return;
        }

        res.writeHead(404);
        res.end('nao implementado: ' + caminho);
      });
    })
    .listen(porta, '127.0.0.1'),
  );
}

// ---------- Control iD (.fcgi com sessão) ----------

function servidorControlId(porta) {
  return comFechamentoForcado(
    http
    .createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, 'http://x');
        const caminho = url.pathname;
        const session = url.searchParams.get('session');
        estado.cid.requisicoes.push(`${req.method} ${caminho}`);
        const json = (obj, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        const parse = () => {
          try {
            return JSON.parse(body.toString('utf8'));
          } catch {
            return {};
          }
        };

        if (caminho === '/login.fcgi') {
          const { login, password } = parse();
          if (login !== USER || password !== PASS) return json({ error: 'auth' }, 401);
          const s = crypto.randomBytes(6).toString('hex');
          estado.cid.sessions.add(s);
          return json({ session: s });
        }

        // Todas as demais rotas exigem sessão válida — é o que prova que o
        // cliente está fazendo login antes de operar.
        if (!session || !estado.cid.sessions.has(session)) {
          return json({ error: 'session invalida' }, 401);
        }

        if (caminho === '/create_objects.fcgi') {
          const { object, values } = parse();
          if (object !== 'users') return json({ error: 'objeto' }, 400);
          const ids = values.map((v) => {
            const id = estado.cid.proximoId++;
            estado.cid.usuarios.set(String(id), v);
            return id;
          });
          return json({ ids });
        }

        if (caminho === '/user_set_image.fcgi') {
          const userId = url.searchParams.get('user_id');
          if (!estado.cid.usuarios.has(String(userId))) {
            return json({ error: 'usuario inexistente' }, 400);
          }
          if (body.length < 100) return json({ error: 'imagem vazia' }, 400);
          estado.cid.rostos.set(String(userId), body.length);
          return json({ success: true });
        }

        if (caminho === '/modify_objects.fcgi') {
          const { values, where } = parse();
          const id = String(where?.users?.id);
          const atual = estado.cid.usuarios.get(id);
          if (!atual) return json({ error: 'inexistente' }, 400);
          estado.cid.usuarios.set(id, { ...atual, ...values });
          return json({ changes: 1 });
        }

        if (caminho === '/destroy_objects.fcgi') {
          const { where } = parse();
          const id = String(where?.users?.id);
          estado.cid.usuarios.delete(id);
          estado.cid.rostos.delete(id);
          return json({ changes: 1 });
        }

        if (caminho === '/execute_actions.fcgi') {
          estado.cid.portaAberta++;
          return json({ success: true });
        }

        if (caminho === '/load_objects.fcgi') {
          const cond = parse();
          estado.cid.loadObjectsConds.push(cond);
          if (cond.object === 'users') {
            return json({
              users: [...estado.cid.usuarios.entries()].map(([id, v]) => ({
                id: Number(id),
                ...v,
              })),
            });
          }
          if (cond.object === 'access_logs') {
            let logs = [...estado.cid.accessLogs];
            const [campo, dir] = cond.order ?? ['id', 'asc'];
            logs.sort((a, b) => (dir === 'desc' ? b[campo] - a[campo] : a[campo] - b[campo]));
            if (cond.limit) logs = logs.slice(0, cond.limit);
            return json({ access_logs: logs });
          }
          return json({ error: 'objeto desconhecido' }, 400);
        }

        res.writeHead(404);
        res.end('nao implementado: ' + caminho);
      });
    })
    .listen(porta, '127.0.0.1'),
  );
}

// ---------- Intelbras / Dahua (RPC2 + cgi, Digest) ----------

estado.dahua = {
  usuarios: new Map(), // UserID -> objeto
  rostos: new Map(), // UserID -> tamanho do base64
  portaAberta: 0,
  relogioSincronizado: 0,
  registros: [], // log de acesso (recordFinder)
  requisicoes: [],
};

// ---------- Interfone no Intelbras / Dahua (conta SIP + lista telefônica) ----------
//
// Formato da "API of HTTP Protocol Specification" da Dahua, V3.26 (2023-02-28),
// capítulo 13 (Intelligent Building APIs):
//   - 13.3.1 configManager.cgi?action=getConfig&name=SIP → linhas
//     `table.SIP.<Campo>=<valor>`; setConfig com `SIP.<Campo>=<valor>` na URL
//     → "OK".
//   - 13.4 VideoTalkContact: recordUpdater.cgi insert (→ "RecNo=N"), update e
//     remove por recno (→ "OK"); recordFinder.cgi find (→ totalCount, found,
//     records[i].Campo).
// Os campos que o firmware Intelbras usa de fato (e se ele mascara a senha na
// leitura) só a bancada confirma — por isso as chaves abaixo são as da doc.

/** Configuração SIP de fábrica (conta desativada, senha padrão 123456 do manual Intelbras). */
function sipDeFabrica() {
  return {
    AccoutName: '',
    AuthID: '',
    AuthPassword: '123456',
    LocalRTPPort: '15000',
    LocalSIPPort: '5060',
    RegisterRealm: 'VDP',
    SIPServer: '',
    SIPServerPort: '5060',
    UserEnable: 'false',
    UserID: '',
    UserType: '2',
  };
}

/** Volta o interfone do aparelho falso ao estado de fábrica (e desliga as falhas simuladas). */
function reiniciarInterfoneDahua() {
  estado.dahua.sip = sipDeFabrica();
  estado.dahua.contatos = []; // registros VideoTalkContact (com RecNo)
  estado.dahua.proximoRecNo = 1;
  // Simulações: firmware que esconde a senha na leitura; firmware sem a
  // configuração SIP por configManager (ex.: outra interface web); busca que
  // devolve só os primeiros N contatos.
  estado.dahua.mascararSenhaSip = false;
  estado.dahua.semConfigSip = false;
  estado.dahua.limiteBuscaContatos = null;
  // Responde "OK" ao setConfig mas não grava (para o cliente conferir lendo de volta).
  estado.dahua.sipIgnoraGravacao = false;
  // Firmware que devolve a senha "cifrada" (legível, mas diferente da gravada).
  estado.dahua.senhaLidaCifrada = false;
  // Firmware sem o campo AuthID na conta SIP (não aparece na leitura e é ignorado no set).
  estado.dahua.sipSemAuthID = false;
  // Busca de contatos: firmware que ignora `offset`, sem getQuerySize, sem totalCount.
  estado.dahua.ignoraOffset = false;
  estado.dahua.semQuerySize = false;
  estado.dahua.semTotalCount = false;
  // Atraso (ms) em cada resposta do aparelho (para testar o prazo do comando).
  estado.dahua.atrasoMs = 0;
  estado.dahua.gravacoesSip = 0;
  estado.dahua.ultimoSetSip = '';
  estado.dahua.urls = [];
}
reiniciarInterfoneDahua();

const CAMPOS_CONTATO = [
  'FirstName',
  'FamilyName',
  'NickName',
  'VTShortNumber',
  'VTMiddleNumber',
  'VTLongNumber',
  'VTOBuilding',
  'VTOUnit',
  'Notes',
  'Type',
  'RegisterType',
  'VTHPassword',
  'GroupNumber',
];

function contatosParaIni(lista, total) {
  const linhas = [...(estado.dahua.semTotalCount ? [] : [`totalCount=${total}`]), `found=${lista.length}`];
  lista.forEach((c, i) => {
    for (const [k, v] of Object.entries(c)) linhas.push(`records[${i}].${k}=${v}`);
  });
  return linhas.join('\r\n') + '\r\n';
}

/** configManager.cgi do interfone. Devolve true se respondeu. */
function responderConfigSip(url, acao, texto) {
  const p = url.searchParams;
  if (acao === 'getConfig' && p.get('name') === 'SIP') {
    if (estado.dahua.semConfigSip) {
      texto('Error\r\nBad Request!\r\n', 400);
      return true;
    }
    const linhas = Object.entries(estado.dahua.sip)
      .filter(([k]) => !(k === 'AuthID' && estado.dahua.sipSemAuthID))
      .map(([k, v]) => {
        let valor = v;
        if (k === 'AuthPassword' && estado.dahua.mascararSenhaSip) valor = '******';
        else if (k === 'AuthPassword' && estado.dahua.senhaLidaCifrada) valor = md5(`cifra:${v}`).toUpperCase();
        return `table.SIP.${k}=${valor}`;
      });
    texto(linhas.join('\r\n') + '\r\n');
    return true;
  }
  if (acao === 'setConfig' && [...p.keys()].some((k) => k.startsWith('SIP.'))) {
    if (estado.dahua.semConfigSip) {
      texto('Error\r\nBad Request!\r\n', 400);
      return true;
    }
    if (!estado.dahua.sipIgnoraGravacao) {
      for (const [k, v] of p) {
        if (!k.startsWith('SIP.')) continue;
        if (k === 'SIP.AuthID' && estado.dahua.sipSemAuthID) continue;
        estado.dahua.sip[k.slice(4)] = v;
      }
    }
    estado.dahua.gravacoesSip++;
    estado.dahua.ultimoSetSip = [...p.keys()].join('&');
    texto('OK\r\n');
    return true;
  }
  return false;
}

/** recordFinder/recordUpdater de VideoTalkContact. Devolve true se respondeu. */
function responderContatos(caminho, url, acao, texto) {
  const p = url.searchParams;
  if (p.get('name') !== 'VideoTalkContact') return false;
  if (caminho === '/cgi-bin/recordFinder.cgi' && acao === 'getQuerySize') {
    // Tabela 13-14: a resposta de exemplo é "Count=200".
    const fimDeLinha = String.fromCharCode(13, 10);
    if (estado.dahua.semQuerySize) texto(`Error${fimDeLinha}Bad Request!${fimDeLinha}`, 400);
    else texto(`Count=${estado.dahua.contatos.length}${fimDeLinha}`);
    return true;
  }
  if (caminho === '/cgi-bin/recordFinder.cgi' && acao === 'find') {
    let lista = estado.dahua.contatos;
    const filtro = p.get('condition.VTShortNumber');
    if (filtro != null) lista = lista.filter((c) => c.VTShortNumber === filtro);
    const total = lista.length;
    // `offset` não está na tabela 13-9 da doc; firmwares Dahua costumam
    // aceitar — `ignoraOffset` simula o que não aceita.
    const offset = estado.dahua.ignoraOffset ? 0 : Number(p.get('offset') || 0);
    const count = Number(p.get('count') || 0) || total;
    let fatia = lista.slice(offset, offset + count);
    if (estado.dahua.limiteBuscaContatos != null) fatia = fatia.slice(0, estado.dahua.limiteBuscaContatos);
    texto(contatosParaIni(fatia, total));
    return true;
  }
  if (caminho !== '/cgi-bin/recordUpdater.cgi') return false;
  const campos = {};
  for (const k of CAMPOS_CONTATO) if (p.has(k)) campos[k] = p.get(k);
  if (acao === 'insert') {
    // VTShortNumber, RegisterType e VTHPassword são obrigatórios (tabela 13-8).
    if (!campos.VTShortNumber || !campos.RegisterType || !campos.VTHPassword) {
      texto('Error\r\nBad Request!\r\n', 400);
      return true;
    }
    // Número repetido: tratamos como recusa (o firmware real, a conferir) —
    // força o cliente a atualizar em vez de inserir de novo.
    if (estado.dahua.contatos.some((c) => c.VTShortNumber === campos.VTShortNumber)) {
      texto('Error\r\nBad Request!\r\n', 400);
      return true;
    }
    const RecNo = String(estado.dahua.proximoRecNo++);
    estado.dahua.contatos.push({ RecNo, CreateTime: '1764200000', ...campos });
    texto(`RecNo=${RecNo}\r\n`);
    return true;
  }
  const alvo = estado.dahua.contatos.find((c) => c.RecNo === p.get('recno'));
  if (acao === 'update' || acao === 'remove') {
    if (!alvo) {
      texto('Error\r\nBad Request!\r\n', 400);
      return true;
    }
    if (acao === 'update') Object.assign(alvo, campos);
    else estado.dahua.contatos = estado.dahua.contatos.filter((c) => c !== alvo);
    texto('OK\r\n');
    return true;
  }
  texto('Error\r\nBad Request!\r\n', 400);
  return true;
}

/** Log de acesso no formato INI que o recordFinder devolve. */
function registrosParaIni(registros) {
  const linhas = [`found=${registros.length}`];
  registros.forEach((r, i) => {
    for (const [k, v] of Object.entries(r)) linhas.push(`records[${i}].${k}=${v}`);
  });
  return linhas.join('\r\n') + '\r\n';
}

function servidorDahua(porta, onStream) {
  return comFechamentoForcado(
    http
    .createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      // `atrasoMs` (testes de prazo): o aparelho demora a responder cada requisição.
      req.on('end', () => setTimeout(() => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, 'http://x');
        const caminho = url.pathname;
        const acao = url.searchParams.get('action');
        estado.dahua.requisicoes.push(`${req.method} ${caminho}?${acao ?? ''}`);
        (estado.dahua.urls || (estado.dahua.urls = [])).push(req.url);
        const parse = () => {
          try {
            return JSON.parse(body.toString('utf8'));
          } catch {
            return {};
          }
        };
        const json = (obj, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        const texto = (s, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'text/plain' });
          res.end(s);
        };

        // Login RPC2 em 2 etapas (desafio + hash MD5 maiúsculo) — sem Digest.
        if (caminho === '/RPC2_Login') {
          const p = parse();
          if (!p.params?.password) {
            return json({
              result: false,
              session: 'sess-teste',
              params: { realm: 'Login to SS', random: '123456', encryption: 'Default' },
            });
          }
          const ha = md5(`${USER}:Login to SS:${PASS}`).toUpperCase();
          const esperado = md5(`${USER}:123456:${ha}`).toUpperCase();
          if (p.params.password !== esperado) {
            return json({ result: false, error: { message: 'senha invalida' } });
          }
          return json({ result: true, session: 'sess-teste' });
        }

        // Todo o resto exige Digest.
        if (!exigeDigest(req, res, body)) return;

        if (caminho === '/cgi-bin/magicBox.cgi') return texto('type=SS3530\r\n');
        if (caminho === '/cgi-bin/configManager.cgi') {
          if (responderConfigSip(url, acao, texto)) return;
          return texto('OK\r\n');
        }
        if (responderContatos(caminho, url, acao, texto)) return;
        if (caminho === '/cgi-bin/global.cgi' && acao === 'setCurrentTime') {
          estado.dahua.relogioSincronizado++;
          return texto('OK\r\n');
        }
        if (caminho === '/cgi-bin/accessControl.cgi' && acao === 'openDoor') {
          estado.dahua.portaAberta++;
          return texto('OK\r\n');
        }
        if (caminho === '/cgi-bin/snapshot.cgi') {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(jpegFalso);
        }
        if (caminho === '/cgi-bin/recordFinder.cgi') {
          // Igual ao SS 3530 MF real (confirmado em campo, 24/09): filtra por
          // StartTime/EndTime (epoch s, sobre CreateTime) quando vierem, devolve
          // do MAIS ANTIGO ao mais novo e corta em 1024 registros por resposta,
          // qualquer que seja o `count` pedido.
          const ini = url.searchParams.get('StartTime');
          const fim = url.searchParams.get('EndTime');
          let lista = estado.dahua.registros;
          if (ini != null && fim != null) {
            lista = lista.filter((r) => {
              const t = Number(r.CreateTime);
              return t >= Number(ini) && t <= Number(fim);
            });
          }
          lista = [...lista].sort((a, b) => Number(a.RecNo) - Number(b.RecNo)).slice(0, 1024);
          return texto(registrosParaIni(lista));
        }
        if (caminho === '/cgi-bin/AccessUser.cgi') {
          if (acao === 'removeMulti') {
            for (const [k, v] of url.searchParams) {
              if (k.startsWith('UserIDList')) {
                estado.dahua.usuarios.delete(v);
                estado.dahua.rostos.delete(v);
              }
            }
            return texto('OK\r\n');
          }
          if (acao === 'insertMulti') {
            const lista = parse().UserList ?? [];
            for (const u of lista) {
              // Aparelho real recusa duplicado — é por isso que o cliente
              // remove antes de inserir (replace limpo).
              if (estado.dahua.usuarios.has(u.UserID)) return texto('Error: duplicate', 400);
              estado.dahua.usuarios.set(u.UserID, u);
            }
            return texto('OK\r\n');
          }
          return texto('Error: acao', 400);
        }
        if (caminho === '/cgi-bin/AccessFace.cgi') {
          const lista = parse().FaceList ?? [];
          for (const f of lista) {
            if (!estado.dahua.usuarios.has(f.UserID)) return texto('Error: sem usuario', 400);
            const foto = (f.PhotoData || [])[0] || '';
            if (foto.length < 100) return texto('Error: foto invalida', 400);
            if (acao === 'insertMulti' && estado.dahua.rostos.has(f.UserID)) {
              return texto('Error: rosto duplicado', 400); // força o updateMulti
            }
            estado.dahua.rostos.set(f.UserID, foto.length);
          }
          return texto('OK\r\n');
        }
        if (caminho === '/RPC2') {
          const p = parse();
          const ids = [...estado.dahua.usuarios.keys()];
          if (p.method === 'UserInfo.getCount') {
            return json({ result: true, params: { Count: ids.length } });
          }
          if (p.method === 'UserInfo.getMulti') {
            const ini = p.params?.StartNo ?? 0;
            const qtd = p.params?.Count ?? 100;
            return json({
              result: true,
              params: {
                UserList: ids.slice(ini, ini + qtd).map((UserID) => ({ UserID })),
              },
            });
          }
          if (p.method === 'UserInfo.removeMulti') {
            for (const u of p.params?.UserList ?? []) {
              estado.dahua.usuarios.delete(u.UserID);
              estado.dahua.rostos.delete(u.UserID);
            }
            return json({ result: true });
          }
          return json({ result: false, error: { message: 'metodo' } });
        }
        if (caminho === '/cgi-bin/eventManager.cgi') {
          res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary',
          });
          // Aparelho real manda algo assim que a conexão abre.
          res.write('--myboundary\r\nContent-Type: text/plain\r\n\r\nHeartbeat\r\n');
          onStream(res);
          return;
        }
        res.writeHead(404);
        res.end('nao implementado: ' + caminho);
      }, estado.dahua.atrasoMs || 0));
    })
    .listen(porta, '127.0.0.1'),
  );
}

// ---------- DHIP (descoberta multicast — etapa 3) ----------

/** Responde DHDiscover.search como o SS 3530 MF real (ver spec da etapa 3). */
function iniciarRespondedorDhip({ porta, ip, httpPorta, mac = 'b4:4c:3b:f4:e3:01', serie = 'K3LJ3400209RH' }) {
  const s = dgram.createSocket('udp4');
  s.on('message', (msg, r) => {
    if (!msg.includes('DHDiscover.search')) return;
    const json = Buffer.from(JSON.stringify({ mac, method: 'client.notifyDevInfo', params: { deviceInfo: {
      DeviceClass: 'BSC', DeviceType: 'SS 3530 MF FACE W', HttpPort: httpPorta, SerialNo: serie,
      Vendor: 'Intelbras', IPv4Address: { IPAddress: ip, DhcpEnable: true, SubnetMask: '255.255.255.0' } } } }));
    const h = Buffer.alloc(32);
    h.write('\x20\x00\x00\x00DHIP', 0, 'latin1'); h.writeUInt32LE(json.length, 16); h.writeUInt32LE(json.length, 24);
    s.send(Buffer.concat([h, json]), r.port, r.address);
  });
  s.bind(porta, '127.0.0.1');
  return s;
}

module.exports = {
  comFechamentoForcado,
  estado,
  servidorHik,
  servidorControlId,
  servidorDahua,
  reiniciarInterfoneDahua,
  iniciarRespondedorDhip,
  USER,
  PASS,
  jpegFalso,
};
