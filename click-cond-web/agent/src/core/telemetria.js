'use strict';

/**
 * agent/src/core/telemetria.js — monta e envia periodicamente o retrato de
 * saúde do agente para a nuvem: versão, SO, hora de início, a saúde de cada
 * device (via `Supervisor.saude()`, ver core/supervisor.js) e quantos
 * eventos aguardam reenvio na fila offline (core/fila-offline.js).
 *
 * `online` de cada device vem do HEARTBEAT (o ping periódico de index.js,
 * `lastDeviceOnline`), via o getter `onlineDoDispositivo(id)` — não do
 * Supervisor: o estado do ouvinte não diz se o aparelho responde (Control
 * iD só "conectava" depois de uma falha, Dahua/Hikvision nunca voltavam a
 * false, e device sem ouvinte — LPR, catraca — ficaria sempre vermelho). O
 * estado do ouvinte segue junto, separado, em `ouvinte_ativo`.
 *
 * É o que alimenta o card do agente no portal (tarefa 7): sem isso, o
 * operador só sabe que "o agente está conectado" (poll) — não SE a versão
 * instalada está desatualizada, nem POR QUE um device específico está mudo
 * (sem driver, offline, erro no último acerto de relógio...).
 *
 * Falha de envio só loga — telemetria é diagnóstico, não pode derrubar o
 * loop principal (poll de comandos) nem entrar na fila offline: perder uma
 * telemetria não é como perder um acesso (a próxima, em 60s, corrige).
 */

const os = require('os');
const { AGENT_VERSION } = require('../versao');
const { cloudRequest } = require('./nuvem');

const INTERVALO_PADRAO_MS = 60000;

/** Monta o payload no formato esperado por POST .../condo/:token/telemetria.
 *  `onlineDoDispositivo(id)` → true só quando o último heartbeat respondeu. */
function montarPayload({ supervisor, pendentes, iniciadoEm, onlineDoDispositivo = () => false }) {
  return {
    versao: AGENT_VERSION,
    so: `${os.platform()} ${os.release()}`,
    iniciado_em: iniciadoEm,
    dispositivos: supervisor
      .saudeTodos()
      .map((s) => ({ ...s, online: onlineDoDispositivo(s.id) === true })),
    eventos_pendentes: pendentes(),
  };
}

/** Envia a telemetria uma vez. Erro de rede/HTTP fica só no log (ver acima). */
async function enviarTelemetria(token, opcoes) {
  try {
    await cloudRequest(
      'POST',
      `/api/facial/agent/condo/${token}/telemetria`,
      montarPayload(opcoes),
    );
  } catch (err) {
    console.error(`[agente] falha ao enviar telemetria: ${err.message || err}`);
  }
}

/**
 * Dispara o envio periódico: um envio imediato (o portal não espera o
 * intervalo inteiro pela primeira telemetria) e depois a cada `intervaloMs`
 * (produção: 60s — vem de index.js, que lê TELEMETRIA_INTERVAL_MS do .env,
 * mesmo padrão de DEVICE_STATUS_INTERVAL_MS; o harness usa um valor curto).
 * Devolve o timer (com `unref()`, como os outros timers do agente) para o
 * chamador poder cancelar se precisar.
 */
function iniciarTelemetria(token, { intervaloMs = INTERVALO_PADRAO_MS, ...opcoes }) {
  void enviarTelemetria(token, opcoes);
  const timer = setInterval(() => {
    void enviarTelemetria(token, opcoes);
  }, intervaloMs);
  timer.unref?.();
  return timer;
}

module.exports = { montarPayload, enviarTelemetria, iniciarTelemetria, INTERVALO_PADRAO_MS };
