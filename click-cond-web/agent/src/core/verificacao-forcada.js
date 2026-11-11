'use strict';

/**
 * agent/src/core/verificacao-forcada.js — "Atualizar agora".
 *
 * A resposta do poll do condomínio pode trazer `verificar_atualizacao: true`
 * (botão no portal). O laço do poll (index.js) chama `pedir(token)` e segue:
 * isto dispara NA HORA a mesma verificação que roda a cada 6 h
 * (`atualizador.verificar`), sem ser aguardado pelo laço.
 *
 * Duas travas, para uma flag repetida a cada poll (2 s) não virar martelada
 * na nuvem/GitHub:
 *   - se já há uma verificação rodando (a periódica ou uma forçada — quem
 *     sabe é o próprio atualizador, via `emAndamento`), não pede outra e NÃO
 *     gasta o intervalo: o pedido seguinte, com ela terminada, dispara;
 *   - no mínimo `intervaloMinMs` (60 s) entre o INÍCIO de duas verificações
 *     forçadas.
 *
 * Agente que não consegue se atualizar sozinho (fora do .exe empacotado, ou
 * instalação sem laço de reinício) não é filtrado aqui: `verificar` roda e é
 * o atualizador que deixa o estado `indisponivel` para a tela mostrar.
 */

const INTERVALO_MINIMO_FORCADA_MS = 60000;

function criarVerificacaoForcada({
  verificar,
  emAndamento = () => false,
  intervaloMinMs = INTERVALO_MINIMO_FORCADA_MS,
  agora = Date.now,
  log = console,
}) {
  let ultimaEm = null;

  /** Devolve true se disparou uma verificação agora. Síncrono e nunca lança:
   *  a verificação roda solta (o laço do poll não espera por ela). */
  function pedir(token) {
    if (emAndamento()) return false;
    const instante = agora();
    if (ultimaEm !== null && instante - ultimaEm < intervaloMinMs) return false;
    ultimaEm = instante;
    const aoFalhar = (err) =>
      log.error(`[agente] atualizador: falha na verificação forçada: ${(err && err.message) || err}`);
    try {
      Promise.resolve(verificar(token)).catch(aoFalhar);
    } catch (err) {
      aoFalhar(err);
    }
    return true;
  }

  return { pedir };
}

module.exports = { criarVerificacaoForcada, INTERVALO_MINIMO_FORCADA_MS };
