'use strict';

/**
 * agent/src/core/atualizador.js — auto-atualização do executável (tarefa 8).
 *
 * PROTOCOLO (spec, decisão 6)
 * ----------------------------
 * O agente consulta `GET /api/facial/agent/condo/:token/versao` na partida
 * (após o primeiro poll bem-sucedido) e a cada 6h. Se houver versão maior:
 *   1. baixa para `click-agent.new.exe` ao lado do exe atual;
 *   2. confere o SHA-256 contra o que a nuvem informou — divergente é
 *      DESCARTADO (nunca troca um arquivo cujo hash não bate: é o único jeito
 *      de garantir que o que vai rodar na máquina do cliente é exatamente o
 *      que foi publicado, sem depender de TLS estrito — o resto do agente já
 *      não valida certificado nenhum, ver lib/http.js);
 *   3. grava `atualizacao.json` ({ de, para, tentativas: 0 }), renomeia o exe
 *      em uso para `click-agent.old.exe` (Windows deixa renomear um .exe em
 *      execução, só não deixa apagar/sobrescrever) e o novo para o mesmo nome
 *      do exe atual, e sai com código 0 — o laço de serviço
 *      (run-agent-service.cmd) reinicia sozinho.
 *
 * Na PRÓXIMA partida, se `atualizacao.json` existe e `para` é a versão que
 * está rodando agora, incrementa `tentativas`. Se chegar a 3 (a versão nova
 * não conseguiu nem completar um poll 3 vezes seguidas), reverte sozinho:
 * o exe atual (quebrado) vira `click-agent.bad.exe` (fica no disco para
 * inspeção, nunca é apagado) e `click-agent.old.exe` volta a ser o exe.
 * Depois do PRIMEIRO poll bem-sucedido da versão nova, `atualizacao.json` é
 * apagado — a atualização foi confirmada, não conta mais como tentativa.
 *
 * TESTABILIDADE (nota do controller)
 * -----------------------------------
 * Isto troca o executável de máquinas de clientes: errar aqui é grave. Cada
 * ponto de risco é injetável (`criarAtualizador(deps)`), para os testes
 * rodarem 100% num diretório temporário, sem tocar em arquivo real nem rede
 * real: `isSea` (nunca mexe em disco fora de um exe SEA de verdade),
 * `caminhoExe`/`diretorio` (onde vivem o exe e o `atualizacao.json`),
 * `buscarVersao`/`baixar` (a camada HTTP) e `sair` (no lugar de
 * `process.exit`, que mataria o processo de teste).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { configDir } = require('./estado');
const { cloudRequest } = require('./nuvem');
const { AGENT_VERSION } = require('../versao');

const ARQ_ATUALIZACAO = 'atualizacao.json';
const NOME_OLD = 'click-agent.old.exe';
const NOME_NEW = 'click-agent.new.exe';
const NOME_BAD = 'click-agent.bad.exe';
const MAX_TENTATIVAS = 3;
const MAX_REDIRECTS = 5;
// 6h — mesmo valor da spec. Não veio de env: diferente do intervalo de
// telemetria (que já existia configurável antes desta tarefa), este é novo e
// a spec não pede override.
const INTERVALO_VERIFICACAO_MS = 6 * 60 * 60 * 1000;

/** `node:sea` só existe a partir do Node 20 com o flag de build SEA; em Node
 *  mais velho, ou rodando `node index.js` direto (dev), `isSea()` não existe
 *  ou devolve false — os dois casos têm de significar "não mexe em disco". */
function isSeaReal() {
  try {
    // eslint-disable-next-line global-require
    const sea = require('node:sea');
    return typeof sea.isSea === 'function' && sea.isSea();
  } catch {
    return false;
  }
}

/**
 * Compara duas versões no formato `AAAA.MM.DD[.N]`: segmento a segmento,
 * numericamente (não como string — "10" > "9"), segmento faltando = 0 (então
 * "2026.09.24" e "2026.09.24.0" são iguais). Devolve >0 se `a` é mais nova
 * que `b`, <0 se mais velha, 0 se igual — mesma convenção de comparator do
 * `Array.prototype.sort`.
 */
function compararVersoes(a, b) {
  const segmentos = (v) =>
    String(v || '')
      .split('.')
      .map((n) => Number(n) || 0);
  const sa = segmentos(a);
  const sb = segmentos(b);
  const tamanho = Math.max(sa.length, sb.length);
  for (let i = 0; i < tamanho; i++) {
    const diff = (sa[i] || 0) - (sb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function lerJsonEm(diretorio, nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(diretorio, nome), 'utf8'));
  } catch {
    return padrao;
  }
}

function gravarJsonAtomicoEm(diretorio, nome, obj) {
  const destino = path.join(diretorio, nome);
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, destino);
}

function sha256DoArquivo(caminho) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const leitura = fs.createReadStream(caminho);
    leitura.on('data', (chunk) => hash.update(chunk));
    leitura.on('end', () => resolve(hash.digest('hex')));
    leitura.on('error', reject);
  });
}

/**
 * Baixa `urlStr` para `destino`, seguindo redirecionamentos (até
 * `opts.maxRedirects`, default 5 — os assets de release do GitHub redirecionam
 * para outro host). SÓ aceita HTTPS: a checagem é na URL, não no transporte,
 * então continua valendo mesmo com `opts.transporte` trocado (é assim que os
 * testes reaproveitam esta função de verdade contra um servidor local, sem
 * precisar de certificado — trocam só o `get` por um que fala HTTP por baixo
 * dos panos, a checagem de esquema roda igual).
 *
 * Não valida certificado (`rejectUnauthorized: false`), mesma escolha do
 * resto do agente (lib/http.js) — quem garante a integridade do arquivo é o
 * SHA-256 conferido depois, não o TLS.
 */
function baixarArquivo(urlStr, destino, opts = {}) {
  const transporte = opts.transporte || https;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  function tentar(url, restantes) {
    return new Promise((resolve, reject) => {
      if (!/^https:\/\//i.test(url)) {
        reject(new Error(`Download de atualização precisa ser HTTPS: ${url}`));
        return;
      }
      let req;
      try {
        req = transporte.get(url, { rejectUnauthorized: false }, (res) => {
          const { statusCode, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume(); // descarta o corpo do redirect
            if (restantes <= 0) {
              reject(new Error('Download de atualização: excesso de redirecionamentos'));
              return;
            }
            const proxima = new URL(headers.location, url).toString();
            resolve(tentar(proxima, restantes - 1));
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`Download de atualização falhou: HTTP ${statusCode}`));
            return;
          }
          const arquivo = fs.createWriteStream(destino);
          res.on('error', (err) => {
            arquivo.destroy();
            reject(err);
          });
          arquivo.on('error', reject);
          // Espera 'close' (não só 'finish'): no Windows, renomear o arquivo
          // logo em seguida (verificar()) falha se o descritor ainda estiver
          // aberto — 'finish' dispara antes do fd fechar de fato.
          arquivo.on('close', () => resolve());
          res.pipe(arquivo);
        });
      } catch (err) {
        reject(err);
        return;
      }
      req.on('error', reject);
    });
  }

  return tentar(urlStr, maxRedirects);
}

/** Consulta padrão (produção): a mesma rota que o portal usa para saber se
 *  há atualização, autenticada pelo token do condomínio (o `AGENT_TOKEN`
 *  já configurado em index.js). Falha de rede vira `null` — quem chama
 *  (`verificar`) trata como "nada disponível agora", não como erro fatal. */
async function buscarVersaoPadrao(token) {
  const res = await cloudRequest('GET', `/api/facial/agent/condo/${token}/versao`);
  return res && res.data && typeof res.data === 'object' ? res.data : null;
}

/**
 * Monta o atualizador com as dependências injetadas (produção usa os
 * defaults reais; os testes trocam `isSea`, `diretorio`, `caminhoExe`,
 * `buscarVersao`, `baixar` e `sair`).
 */
function criarAtualizador(deps = {}) {
  const {
    isSea = isSeaReal,
    diretorio = configDir,
    caminhoExe = () => process.execPath,
    buscarVersao = buscarVersaoPadrao,
    baixar = baixarArquivo,
    sair = (codigo) => process.exit(codigo),
    log = console,
  } = deps;

  /**
   * Chamado uma vez, na partida do processo — ANTES de qualquer poll. Só
   * existe trabalho a fazer se `atualizacao.json` aponta para a versão que
   * está rodando agora (ou seja: esta é a versão recém-trocada, subindo pela
   * enésima vez). Incrementa `tentativas`; na 3ª, desiste e reverte.
   */
  function verificarInicializacao() {
    if (!isSea()) {
      log.log('[agente] atualizador: fora de um executável SEA — não mexe em arquivos');
      return;
    }
    const dir = diretorio();
    const estado = lerJsonEm(dir, ARQ_ATUALIZACAO, null);
    if (!estado || estado.para !== AGENT_VERSION) return;

    const tentativas = (Number(estado.tentativas) || 0) + 1;
    if (tentativas >= MAX_TENTATIVAS) {
      log.error(
        `[agente] atualização ${estado.de} → ${estado.para} falhou ${tentativas}x seguidas sem completar um poll — revertendo para ${estado.de}`,
      );
      const dirExe = path.dirname(caminhoExe());
      try {
        fs.renameSync(caminhoExe(), path.join(dirExe, NOME_BAD));
        fs.renameSync(path.join(dirExe, NOME_OLD), caminhoExe());
      } catch (err) {
        log.error(`[agente] falha ao reverter a atualização: ${err.message || err}`);
      }
      try {
        fs.unlinkSync(path.join(dir, ARQ_ATUALIZACAO));
      } catch {
        /* já não existia */
      }
      sair(0);
      return;
    }

    gravarJsonAtomicoEm(dir, ARQ_ATUALIZACAO, { ...estado, tentativas });
    log.log(
      `[agente] atualização ${estado.de} → ${estado.para}: tentativa ${tentativas}/${MAX_TENTATIVAS} de completar um poll`,
    );
  }

  /** Chamado após o PRIMEIRO poll bem-sucedido: a versão atual provou que
   *  fala com a nuvem, então a atualização (se havia uma em curso) está
   *  confirmada — apaga `atualizacao.json` para não contar mais tentativas. */
  function confirmarSucesso() {
    if (!isSea()) return;
    try {
      fs.unlinkSync(path.join(diretorio(), ARQ_ATUALIZACAO));
    } catch {
      /* nada pendente — caminho normal (sem atualização em curso) */
    }
  }

  /** Consulta se há versão mais nova e, se houver, baixa/confere/troca. Nunca
   *  lança — falha de rede, hash divergente etc. só logam e devolvem sem
   *  efeito (a próxima verificação, em 6h, tenta de novo). */
  async function verificar(token) {
    if (!isSea()) {
      log.log('[agente] atualizador: fora de um executável SEA — não verifica atualização automática');
      return;
    }

    let info;
    try {
      info = await buscarVersao(token);
    } catch (err) {
      log.error(`[agente] falha ao consultar versão disponível: ${err.message || err}`);
      return;
    }
    if (!info || !info.versao || !info.url || !info.sha256) return; // nada publicado, ou a nuvem falhou

    if (compararVersoes(info.versao, AGENT_VERSION) <= 0) return; // já está na versão mais nova (ou mais nova ainda)

    log.log(`[agente] nova versão disponível: ${AGENT_VERSION} → ${info.versao} — baixando`);
    const dirExe = path.dirname(caminhoExe());
    const novo = path.join(dirExe, NOME_NEW);

    try {
      await baixar(info.url, novo);
    } catch (err) {
      log.error(`[agente] falha ao baixar atualização: ${err.message || err}`);
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada baixado ainda */
      }
      return;
    }

    let hash;
    try {
      hash = await sha256DoArquivo(novo);
    } catch (err) {
      log.error(`[agente] falha ao conferir hash da atualização: ${err.message || err}`);
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada a apagar */
      }
      return;
    }
    if (hash.toLowerCase() !== String(info.sha256).toLowerCase()) {
      log.error(
        `[agente] hash da atualização não confere (esperado ${info.sha256}, obtido ${hash}) — descartando`,
      );
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada a apagar */
      }
      return;
    }

    try {
      gravarJsonAtomicoEm(diretorio(), ARQ_ATUALIZACAO, {
        de: AGENT_VERSION,
        para: info.versao,
        tentativas: 0,
      });
      const exeAtual = caminhoExe();
      fs.renameSync(exeAtual, path.join(dirExe, NOME_OLD));
      fs.renameSync(novo, exeAtual);
    } catch (err) {
      log.error(`[agente] falha ao trocar o executável pela versão nova: ${err.message || err}`);
      return;
    }

    log.log(`[agente] atualizado para ${info.versao} — reiniciando`);
    sair(0);
  }

  /** Verificação imediata (chame só depois do primeiro poll OK — ver
   *  index.js) + repetição a cada 6h. Mesmo padrão de
   *  `core/telemetria.js#iniciarTelemetria`: devolve o timer (com `unref()`)
   *  para o chamador guardar o handle. */
  function agendarVerificacaoPeriodica(token, intervaloMs = INTERVALO_VERIFICACAO_MS) {
    void verificar(token);
    const timer = setInterval(() => void verificar(token), intervaloMs);
    timer.unref?.();
    return timer;
  }

  return {
    verificarInicializacao,
    confirmarSucesso,
    verificar,
    agendarVerificacaoPeriodica,
  };
}

module.exports = {
  compararVersoes,
  baixarArquivo,
  criarAtualizador,
  INTERVALO_VERIFICACAO_MS,
  ARQ_ATUALIZACAO,
};
