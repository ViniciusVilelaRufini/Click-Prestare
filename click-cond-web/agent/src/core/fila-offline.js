'use strict';

/**
 * agent/src/core/fila-offline.js — store-and-forward: fila em disco para
 * eventos que não subiram para a nuvem.
 *
 * A LAN continua viva quando a internet cai: o aparelho segue reconhecendo e
 * o agente segue recebendo o stream — só o upload para a nuvem falha. Sem a
 * fila, esses acessos sumiam da auditoria. Aqui cada evento que não subiu é
 * gravado em disco (sobrevive a restart do agente) e reenviado com a flag
 * `backlog: true` quando a nuvem volta — a nuvem audita com o timestamp
 * original, mas não reaciona abertura nem manda push atrasado.
 */

const fs = require('fs');
const path = require('path');
const { configDir } = require('./estado');
const { cloudRequest } = require('./nuvem');

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

/** Quantos eventos estão pendentes de reenvio na fila offline agora. */
function pendentes() {
  try {
    const file = offlineQueuePath();
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
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
    // O flush tem `await` no meio: enquanto ele reenviava, o stream pode
    // ter enfileirado eventos NOVOS (appendFileSync no fim do arquivo).
    // Regravar só com `restantes` apagava esses eventos — relê o arquivo e
    // preserva tudo o que foi acrescentado depois da leitura inicial. (Ler
    // e gravar aqui é síncrono: nada mais roda no meio.)
    let novos = [];
    try {
      const atuais = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      novos = atuais.slice(lines.length);
    } catch {
      /* arquivo sumiu no meio — nada novo a preservar */
    }
    const restantes = lines.slice(enviados).concat(novos);
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

module.exports = { offlineQueuePath, enqueueOfflineEvent, flushOfflineEvents, pendentes };
