'use strict';

/**
 * agent/src/descoberta/agendador.js — QUANDO descobrir (etapa 3):
 *  - leve (só multicast) na partida e a cada 5 min;
 *  - com varredura HTTP quando o portal pede ("Procurar na rede") ou quando
 *    um device cadastrado está offline há mais de 2 min (pode ter mudado de
 *    IP) — esta última no máximo 1 vez a cada 10 min (254 GETs por /24).
 * Uma descoberta por vez. `tick` é chamado a cada volta do poll de index.js.
 */

function criarAgendador({
  descobrir,
  enviar,
  agora = Date.now,
  intervaloLeveMs = 300000,
  minEntreVarredurasMs = 600000,
  offlineParaVarrerMs = 120000,
}) {
  let ultimaLeve = null;
  let ultimaVarredura = null;
  let emCurso = false;

  async function tick({ pedidoDaNuvem, offlineDesde }) {
    if (emCurso) return;
    const t = agora();
    const algumOfflineAntigo = [...offlineDesde.values()].some((desde) => t - desde > offlineParaVarrerMs);
    const podeVarrerPorOffline = ultimaVarredura == null || t - ultimaVarredura >= minEntreVarredurasMs;
    const varredura = pedidoDaNuvem || (algumOfflineAntigo && podeVarrerPorOffline);
    const leveVencida = ultimaLeve == null || t - ultimaLeve >= intervaloLeveMs;
    if (!varredura && !leveVencida) return;

    emCurso = true;
    try {
      ultimaLeve = t;
      if (varredura) ultimaVarredura = t;
      const achados = await descobrir({ varredura });
      await enviar(achados);
    } catch (err) {
      console.log(`[agente] descoberta: ${err.message || err}`);
    } finally {
      emCurso = false;
    }
  }

  return { tick };
}

module.exports = { criarAgendador };
