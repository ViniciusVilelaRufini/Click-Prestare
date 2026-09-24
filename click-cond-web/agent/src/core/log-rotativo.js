'use strict';

/**
 * agent/src/core/log-rotativo.js — rotação do log de serviço (tarefa 9).
 *
 * O `run-agent-service.cmd` (laço de reinício, tarefa 9 também) redireciona
 * TODO stdout/stderr do exe para `agent-service.log` em modo *append*
 * (`>>`) — nada dentro do processo Node controla esse arquivo diretamente, e
 * o cmd nunca trunca: reiniciar o agente (crash, atualização, reboot) só
 * soma mais linhas ao mesmo arquivo pra sempre. Sem rotação, esse log cresce
 * sem limite numa máquina que fica ligada meses.
 *
 * Por isso, ao iniciar, o agente confere o TAMANHO do log e, se passou de
 * 5 MB, renomeia para `agent-service.1.log` (sobrescrevendo o anterior — só
 * guardamos uma geração, não é um histórico). O rename tira o arquivo do
 * caminho `agent-service.log`; a PRÓXIMA vez que o laço reiniciar o exe, o
 * `>>` do .cmd recria `agent-service.log` do zero.
 */

const fs = require('fs');
const path = require('path');
const { configDir } = require('./estado');

const NOME_LOG = 'agent-service.log';
const NOME_LOG_ROTACIONADO = 'agent-service.1.log';
const LIMITE_BYTES = 5 * 1024 * 1024; // 5 MB, conforme a spec.

/**
 * Chamada uma vez, no boot do processo (antes de qualquer coisa que dependa
 * do log já estar no tamanho certo). Nunca lança: um erro ao rotacionar o
 * log não pode impedir o agente de subir.
 *
 * `deps` injetável para teste: `diretorio` (função, default `configDir`),
 * `nomeLog`/`nomeRotacionado`/`limiteBytes` (default os da spec) e `log`
 * (default `console`).
 */
function rotacionarLogSeGrande(deps = {}) {
  const {
    diretorio = configDir,
    nomeLog = NOME_LOG,
    nomeRotacionado = NOME_LOG_ROTACIONADO,
    limiteBytes = LIMITE_BYTES,
    log = console,
  } = deps;

  const caminhoLog = path.join(diretorio(), nomeLog);
  let tamanho;
  try {
    tamanho = fs.statSync(caminhoLog).size;
  } catch {
    return; // ainda não existe (primeiro boot, ou log acabou de rotacionar) — nada a fazer
  }
  if (tamanho <= limiteBytes) return;

  try {
    fs.renameSync(caminhoLog, path.join(diretorio(), nomeRotacionado));
  } catch (err) {
    log.error(`[agente] falha ao rotacionar ${nomeLog}: ${err.message || err}`);
  }
}

module.exports = {
  rotacionarLogSeGrande,
  NOME_LOG,
  NOME_LOG_ROTACIONADO,
  LIMITE_BYTES,
};
