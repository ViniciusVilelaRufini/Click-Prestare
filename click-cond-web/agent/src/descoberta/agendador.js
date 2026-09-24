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
  prazoTotalMs = 60000,
}) {
  let ultimaLeve = null;
  let ultimaVarredura = null;
  let emCurso = false;
  // A API entrega o pedido do portal UMA vez (o poll já o consumiu). Se ele
  // chega com uma descoberta em andamento, não pode se perder: fica lembrado
  // e vira varredura no próximo tick livre.
  let varreduraPendente = false;
  // Cada descoberta tem um número; a que estourou o prazo e termina depois
  // não envia resultado velho por cima de uma mais nova.
  let geracao = 0;

  async function tick({ pedidoDaNuvem, offlineDesde }) {
    if (emCurso) {
      if (pedidoDaNuvem) varreduraPendente = true;
      return;
    }
    // Tudo dentro do try, inclusive a decisão (agora()/offlineDesde podem
    // lançar) — sem isso uma exceção síncrona aqui vira rejeição não tratada
    // no `void agendadorDescoberta.tick(...)` de index.js e derruba o agente
    // inteiro (poll, comandos, heartbeat). `emCurso` só vira true quando a
    // descoberta de fato começa (depois da decisão), mas o `finally` cobre
    // qualquer saída — decisão que lança nunca deixa emCurso travado em true.
    let timer = null;
    try {
      const t = agora();
      const algumOfflineAntigo = [...offlineDesde.values()].some((desde) => t - desde > offlineParaVarrerMs);
      const podeVarrerPorOffline = ultimaVarredura == null || t - ultimaVarredura >= minEntreVarredurasMs;
      const varredura = pedidoDaNuvem || varreduraPendente || (algumOfflineAntigo && podeVarrerPorOffline);
      const leveVencida = ultimaLeve == null || t - ultimaLeve >= intervaloLeveMs;
      if (!varredura && !leveVencida) return;

      emCurso = true;
      varreduraPendente = false;
      ultimaLeve = t;
      if (varredura) ultimaVarredura = t;
      const minha = ++geracao;
      const trabalho = (async () => {
        const achados = await descobrir({ varredura });
        if (minha !== geracao) return;
        await enviar(achados);
      })();
      // Prazo total: se a descoberta ou o envio travarem (socket que nunca
      // fecha, rede estranha), emCurso ficaria true para sempre e o agente
      // nunca mais procuraria aparelhos. Promise.race solta o agendador; o
      // trabalho velho continua pendurado, mas sem enviar nada (geração).
      const estouro = new Promise((_, falhar) => {
        timer = setTimeout(() => falhar(new Error(`prazo de ${prazoTotalMs} ms excedido; descoberta abandonada`)), prazoTotalMs);
      });
      await Promise.race([trabalho, estouro]);
    } catch (err) {
      console.error(`[agente] descoberta: ${err.message || err}`);
    } finally {
      if (timer) clearTimeout(timer);
      emCurso = false;
    }
  }

  return { tick };
}

module.exports = { criarAgendador };
