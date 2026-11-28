// Controle HTTPS do serviço (API → voz), em https://voz.prestarecondominios.com.br/controle
//   POST /controle/chamadas/:id/portaria | /dtmf {digitos} | /encerrar   (x-voz-token)
//   GET  /controle/saude                                                (sem token)
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const ROTA = /^\/controle\/chamadas\/(\d{1,12})\/(portaria|dtmf|encerrar)$/;
const DIGITOS = /^[0-9*#]{1,10}$/;
const LIMITE_CORPO = 4096;

const resumo = (s) => createHash('sha256').update(String(s)).digest();

function tokenConfere(recebido, esperado) {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;
  // Compara os resumos (mesmo tamanho) para não vazar o tamanho do token.
  return timingSafeEqual(resumo(recebido), resumo(esperado));
}

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(texto);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (p) => {
      tamanho += p.length;
      if (tamanho > LIMITE_CORPO) {
        reject(Object.assign(new Error('corpo grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(p);
    });
    req.on('end', () => {
      const texto = Buffer.concat(partes).toString('utf8').trim();
      if (!texto) return resolve({});
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function criarControle({ vozToken, servico, saudeAri = () => false, log = console }) {
  if (!vozToken) throw new Error('VOZ_INTERNAL_TOKEN ausente');

  return async function controle(req, res) {
    try {
      const caminho = new URL(req.url, 'http://x').pathname;

      if (req.method === 'GET' && caminho === '/controle/saude') {
        return responder(res, 200, { ok: true, ari: Boolean(saudeAri()) });
      }

      const m = req.method === 'POST' ? ROTA.exec(caminho) : null;
      if (!m) return responder(res, 404, { ok: false });
      if (!tokenConfere(req.headers['x-voz-token'], vozToken)) return responder(res, 401, { ok: false });

      const id = Number(m[1]);
      const acao = m[2];
      let ok;
      if (acao === 'dtmf') {
        const corpo = await lerCorpo(req);
        const digitos = corpo?.digitos;
        if (typeof digitos !== 'string' || !DIGITOS.test(digitos)) return responder(res, 400, { ok: false });
        ok = await servico.dtmf(id, digitos);
      } else {
        req.resume();
        ok = acao === 'portaria' ? await servico.forcarPortaria(id) : await servico.encerrar(id);
      }
      return responder(res, ok ? 200 : 404, { ok: Boolean(ok) });
    } catch (e) {
      if (e?.status) return responder(res, e.status, { ok: false });
      log.error(`[controle] ${e?.stack ?? e}`);
      return responder(res, 500, { ok: false });
    }
  };
}

function lerCertificado(certDir) {
  return {
    cert: readFileSync(path.join(certDir, 'fullchain.pem')),
    key: readFileSync(path.join(certDir, 'privkey.pem')),
  };
}

/**
 * Sobe o HTTPS com o certificado do Let's Encrypt (cópia do hook de renovação
 * em /etc/prestare-voz/tls). Sem certificado, tenta de novo a cada minuto;
 * SIGHUP relê o certificado sem derrubar o processo.
 */
export function iniciarControleHttps({ handler, porta, certDir, log = console }) {
  let servidor = null;

  const subir = () => {
    let tls;
    try {
      tls = lerCertificado(certDir);
    } catch (e) {
      log.error(`[controle] sem certificado em ${certDir} (${e.message}); nova tentativa em 60 s`);
      setTimeout(subir, 60_000).unref();
      return;
    }
    servidor = https.createServer({ ...tls, minVersion: 'TLSv1.2' }, handler);
    servidor.requestTimeout = 10_000;
    servidor.headersTimeout = 5_000;
    servidor.on('error', (e) => {
      log.error(`[controle] HTTPS na porta ${porta} falhou: ${e.message}`);
      process.exit(1);
    });
    servidor.listen(porta, () => log.info(`[controle] HTTPS na porta ${porta}`));
  };

  process.on('SIGHUP', () => {
    if (!servidor) return;
    try {
      servidor.setSecureContext(lerCertificado(certDir));
      log.info('[controle] certificado relido');
    } catch (e) {
      log.error(`[controle] não reli o certificado: ${e.message}`);
    }
  });

  subir();
  return () => servidor?.close();
}
