#!/usr/bin/env node
/**
 * Diagnóstico direto no aparelho Dahua/Intelbras (LAN) — NÃO depende do
 * agente nem da nuvem. Serve para responder duas perguntas:
 *
 *   1. O cadastro do visitante chegou no aparelho com UserType/UseTime certos?
 *      E o UseTime decrementa depois de cada passagem?
 *        node diagnostico-dahua.js <ip> <porta> <usuario> <senha> usuario <UserID>
 *      (rode antes e depois de passar o rosto — o UseTime deve diminuir)
 *
 *   2. O aparelho emite evento quando o rosto é reconhecido? Com qual Code?
 *        node diagnostico-dahua.js <ip> <porta> <usuario> <senha> eventos
 *      (deixe rodando e passe o rosto — cada evento aparece cru no console)
 *
 * Exemplo:
 *   node diagnostico-dahua.js 192.168.1.108 80 admin senha123 usuario visitante_42
 *   node diagnostico-dahua.js 192.168.1.108 80 admin senha123 eventos
 */

const http = require('http');
const crypto = require('crypto');

const [ip, porta, user, pass, comando, userId] = process.argv.slice(2);

if (!ip || !porta || !user || !pass || !comando) {
  console.log('Uso:');
  console.log('  node diagnostico-dahua.js <ip> <porta> <usuario> <senha> usuario <UserID>');
  console.log('  node diagnostico-dahua.js <ip> <porta> <usuario> <senha> eventos');
  process.exit(1);
}

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function buildDigestHeader(method, uri, challenge) {
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

/** GET com Basic e fallback Digest (mesma lógica do agente). */
function req(pathname, headers = {}, _retry = false) {
  return new Promise((resolve, reject) => {
    if (!headers.Authorization && !_retry) {
      headers.Authorization =
        'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
    const r = http.request(
      { host: ip, port: Number(porta), path: pathname, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const wa = res.headers['www-authenticate'] || '';
          if (res.statusCode === 401 && !_retry && /digest/i.test(wa)) {
            const dh = buildDigestHeader('GET', pathname, wa);
            return resolve(req(pathname, { Authorization: dh }, true));
          }
          resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

async function cmdUsuario() {
  if (!userId) {
    console.error('Informe o UserID (ex.: visitante_42). Veja o face_id na tabela Visitantes.');
    process.exit(1);
  }
  // Vários firmwares expõem leituras diferentes — tenta todas e mostra o cru.
  const tentativas = [
    `/cgi-bin/AccessUser.cgi?action=list&UserIDList[0]=${encodeURIComponent(userId)}`,
    `/cgi-bin/AccessUser.cgi?action=getMulti&UserIDList[0]=${encodeURIComponent(userId)}`,
    `/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCard&count=20&condition.UserID=${encodeURIComponent(userId)}`,
  ];
  for (const p of tentativas) {
    console.log(`\n=== GET ${p}`);
    try {
      const r = await req(p);
      console.log(`HTTP ${r.status}`);
      console.log(r.raw.slice(0, 4000) || '(corpo vazio)');
    } catch (e) {
      console.log(`ERRO: ${e.message || e}`);
    }
  }
  console.log('\n>>> Procure nas respostas acima: UserType, UseTime, ValidFrom/ValidTo.');
  console.log('>>> Rode de novo DEPOIS de passar o rosto: o UseTime deve diminuir.');
  console.log('>>> Últimos acessos registrados no aparelho:');
  try {
    const r = await req(
      '/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec&count=5',
    );
    console.log(`HTTP ${r.status}`);
    console.log(r.raw.slice(0, 4000) || '(corpo vazio)');
  } catch (e) {
    console.log(`ERRO: ${e.message || e}`);
  }
}

function cmdEventos() {
  const path = '/cgi-bin/eventManager.cgi?action=attach&codes=[All]';
  console.log('Assinando stream de eventos... passe o rosto no aparelho.');
  console.log('(Ctrl+C para sair; a conexão reabre sozinha se o aparelho fechar)\n');
  const abrir = () => {
    const challenge = http.request(
      { host: ip, port: Number(porta), path, method: 'GET' },
      (cres) => {
        cres.resume();
        if (cres.statusCode !== 401) {
          console.error(`desafio inesperado: HTTP ${cres.statusCode}; tentando de novo em 5s`);
          return setTimeout(abrir, 5000);
        }
        const wa = cres.headers['www-authenticate'] || '';
        const authHeader = buildDigestHeader('GET', path, wa);
        const stream = http.request(
          { host: ip, port: Number(porta), path, method: 'GET', headers: { Authorization: authHeader } },
          (sres) => {
            if (sres.statusCode !== 200) {
              sres.resume();
              console.error(`attach HTTP ${sres.statusCode}; tentando de novo em 5s`);
              return setTimeout(abrir, 5000);
            }
            console.log('--- conectado; aguardando eventos ---');
            let buf = '';
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              buf += chunk;
              const parts = buf.split('--myboundary');
              buf = parts.pop();
              for (const part of parts) {
                const t = part.trim();
                if (!t || t === '--') continue;
                // Ignora heartbeats vazios; mostra qualquer evento com Code=
                if (!/Code=/.test(t)) continue;
                console.log(`\n[${new Date().toLocaleTimeString()}] ===== EVENTO =====`);
                console.log(t.slice(0, 3000));
              }
              if (buf.length > 1_000_000) buf = buf.slice(-100_000);
            });
            sres.on('end', () => {
              console.log('--- aparelho fechou o stream; reabrindo em 5s ---');
              setTimeout(abrir, 5000);
            });
            sres.on('error', (e) => {
              console.error(`stream: ${e.message || e}; reabrindo em 5s`);
              setTimeout(abrir, 5000);
            });
          },
        );
        stream.on('error', (e) => {
          console.error(`stream: ${e.message || e}; reabrindo em 5s`);
          setTimeout(abrir, 5000);
        });
        stream.setTimeout(0);
        stream.end();
      },
    );
    challenge.on('error', (e) => {
      console.error(`desafio: ${e.message || e}; tentando de novo em 5s`);
      setTimeout(abrir, 5000);
    });
    challenge.end();
  };
  abrir();
}

if (comando === 'usuario') cmdUsuario();
else if (comando === 'eventos') cmdEventos();
else {
  console.error(`Comando desconhecido: ${comando} (use "usuario" ou "eventos")`);
  process.exit(1);
}
