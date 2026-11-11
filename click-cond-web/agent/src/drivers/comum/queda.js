'use strict';

/**
 * agent/src/drivers/comum/queda.js — aviso de queda/recuperação do ouvinte
 * de eventos de UM aparelho.
 *
 * Com o aparelho fora do ar, o laço de `escutar` tenta reabrir a cada poucos
 * segundos; logar toda tentativa enchia o agent-service.log com a mesma
 * linha (um facial desligado = ~17 mil linhas por dia) e escondia o resto.
 * Aqui a queda é logada UMA vez e a recuperação UMA vez.
 */
function criarAvisoDeQueda(log = console) {
  let caido = false;
  return {
    /** Loga `mensagem` (erro) só se ainda não estava caído. Devolve se logou. */
    caiu(mensagem) {
      if (caido) return false;
      caido = true;
      log.error(mensagem);
      return true;
    },
    /** Loga `mensagem` só se estava caído. Devolve se logou. */
    voltou(mensagem) {
      if (!caido) return false;
      caido = false;
      log.log(mensagem);
      return true;
    },
    caido: () => caido,
  };
}

module.exports = { criarAvisoDeQueda };
