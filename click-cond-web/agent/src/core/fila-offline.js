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
// Disco cheio/arquivo travado ao REGRAVAR a fila depois de um flush: as
// linhas que já subiram continuam no arquivo. Guardamos aqui (em memória)
// quais são, para o próximo flush pular em vez de reenviar tudo a cada poll.
let jaEnviadasSemGravar = [];
// Loga a falha de gravação uma vez (o flush roda a cada poll, ~2 s); volta a
// avisar se o disco se recuperar e falhar de novo.
let falhaDeGravacaoAvisada = false;

/** Quantas das primeiras `lines` já subiram num flush anterior que não
 *  conseguiu regravar o arquivo. Se o começo do arquivo não bate mais com o
 *  que lembramos (alguém podou/apagou), esquece e recomeça do zero — reenviar
 *  é seguro (a nuvem deduplica backlog); pular o que não subiu, não. */
function jaEnviadasNoInicio(lines) {
  const n = jaEnviadasSemGravar.length;
  if (n === 0) return 0;
  if (lines.length < n || jaEnviadasSemGravar.some((l, i) => lines[i] !== l)) {
    jaEnviadasSemGravar = [];
    return 0;
  }
  return n;
}

/**
 * A resposta da nuvem a um evento é uma falha TRANSITÓRIA (vale guardar e
 * reenviar)? Critério ÚNICO dos dois lados — quem decide enfileirar
 * (`forwardAccessEvent`, index.js) e quem reenvia (`flushOfflineEvents`):
 *   - 5xx = nuvem fora do ar;
 *   - 401/404 = token piscando (device reativando no portal);
 *   - 408/429 = timeout e throttle.
 * Os demais 4xx (400/403/422: validação) são definitivos — reenviar daria o
 * mesmo erro para sempre. Erro de rede não chega aqui (é exceção, sempre
 * transitória). Antes o flush só parava em 5xx: um evento enfileirado por
 * 401/404/408/429 era dado como "enviado" e sumia na primeira tentativa.
 */
function respostaTransitoria(status) {
  return status >= 500 || status === 401 || status === 404 || status === 408 || status === 429;
}

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
  if (lines.length === 0) {
    jaEnviadasSemGravar = [];
    return;
  }

  flushEmAndamento = true;
  try {
    // Começa depois do que já subiu num flush que não conseguiu regravar.
    const jaSubiram = jaEnviadasNoInicio(lines);
    const aEnviar = lines.slice(jaSubiram);
    if (aEnviar.length > 0) {
      console.log(`[agente] reenviando ${aEnviar.length} evento(s) da fila offline...`);
    }
    let enviados = jaSubiram;
    for (const line of aEnviar) {
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
        // Transitório (mesmo critério que pôs o evento na fila — ver
        // `respostaTransitoria`) ou rede: para e tenta de novo no próximo
        // flush. 2xx = aceito; demais 4xx = a nuvem rejeitou de vez (ex.:
        // acesso negado por regra — já auditado lá), não adianta re-tentar.
        if (respostaTransitoria(res.status)) break;
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
    if (enviados > 0) {
      // Esta função é chamada com `void` (index.js): uma exceção aqui virava
      // rejeição não tratada e derrubava o processo inteiro — disco cheio
      // desligava o controle de acesso. Falhou ao regravar: os eventos
      // continuam no arquivo antigo e o que já subiu fica marcado em memória.
      try {
        fs.writeFileSync(file, restantes.length ? restantes.join('\n') + '\n' : '', 'utf8');
        jaEnviadasSemGravar = [];
        falhaDeGravacaoAvisada = false;
      } catch (err) {
        jaEnviadasSemGravar = lines.slice(0, enviados);
        if (!falhaDeGravacaoAvisada) {
          falhaDeGravacaoAvisada = true;
          console.error(
            `[agente] falha ao regravar a fila offline (${err.message || err}) — disco cheio? ` +
              `O arquivo ficou como estava e o que já subiu está marcado em memória (não é reenviado); ` +
              `novo aviso só se voltar a falhar depois de recuperar.`,
          );
        }
      }
    }
    if (enviados > jaSubiram) {
      console.log(
        `[agente] fila offline: ${enviados - jaSubiram} reenviado(s), ${restantes.length} restante(s)`,
      );
    }
  } finally {
    flushEmAndamento = false;
  }
}

module.exports = {
  offlineQueuePath,
  enqueueOfflineEvent,
  flushOfflineEvents,
  pendentes,
  respostaTransitoria,
};
