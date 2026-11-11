'use strict';

/**
 * agent/src/core/exclusivo.js — roda uma tarefa por chave SEM concorrência.
 *
 * Uso: o replay do log offline (`syncDeviceOfflineLogs`) passou a ser
 * disparado a cada reconexão do stream, além do heartbeat. Dois replays do
 * mesmo aparelho ao mesmo tempo reenviariam os mesmos acessos; mas descartar
 * o pedido que chega com um replay em curso deixaria sem cobertura a janela
 * da reconexão que acabou de acontecer (o replay em curso leu o log ANTES
 * dela). Então: pedido no meio = UMA execução extra quando a atual terminar
 * (vários pedidos no meio se juntam numa só).
 */
function criarExclusivoPorChave() {
  // chave → { promessa, pendente: tarefa | null }
  const emCurso = new Map();

  function rodar(chave, tarefa) {
    const atual = emCurso.get(chave);
    if (atual) {
      atual.pendente = tarefa;
      return atual.promessa;
    }
    const registro = { pendente: null, promessa: null };
    emCurso.set(chave, registro);
    registro.promessa = Promise.resolve()
      .then(async () => {
        let proxima = tarefa;
        while (proxima) {
          await proxima();
          // Pedido(s) que chegaram enquanto rodava: mais UMA execução.
          proxima = registro.pendente;
          registro.pendente = null;
        }
      })
      .finally(() => {
        emCurso.delete(chave);
      });
    return registro.promessa;
  }

  return { rodar, ocupado: (chave) => emCurso.has(chave) };
}

module.exports = { criarExclusivoPorChave };
