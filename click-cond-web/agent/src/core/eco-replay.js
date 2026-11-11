'use strict';

/**
 * agent/src/core/eco-replay.js — evita o ECO do replay. Módulo puro (sem
 * relógio nem I/O: todo instante vem de quem chama).
 *
 * O replay do log interno do aparelho (`syncDeviceOfflineLogs`) roda em toda
 * reconexão do stream e relê tudo acima da marca d'água. A marca só avança
 * alguns segundos depois de um evento ao vivo — então um stream que reabre
 * logo após uma passagem faz o replay reenviar, como `backlog`, um acesso que
 * o agente JÁ mandou ao vivo. A nuvem só deduplica backlog em ±5 s, e os dois
 * carimbos vêm de relógios diferentes (chegada na nuvem x `CreateTime` do
 * aparelho): o eco passava e, num terminal de sentido automático, virava uma
 * "saída" falsa.
 *
 * Aqui fica, por aparelho, a lista dos eventos AO VIVO recentes (pessoa +
 * instante em que o agente recebeu) que a nuvem ACEITOU ou que foram para a
 * fila offline (`registrarAposEnvio`) — um evento recusado de vez não entra:
 * o replay tem de reenviá-lo, não tratá-lo como eco.
 *
 * O casamento é decidido sobre a LISTA inteira do replay (`separarEcos`):
 * cada evento ao vivo ainda livre casa com o registro da mesma pessoa mais
 * PRÓXIMO no tempo, a até `JANELA_ECO_MS` do `CreateTime`. É por CONTAGEM: um
 * evento ao vivo consome no máximo UM registro — se a pessoa passou duas
 * vezes e só uma chegou ao vivo, a outra ainda é enviada. (Antes era guloso,
 * registro a registro: um registro antigo REAL casava com um evento ao vivo
 * posterior e era descartado no lugar do eco de verdade.)
 *
 * PRINCÍPIO: na dúvida, NÃO é eco. Um backlog duplicado a nuvem deduplica;
 * uma passagem descartada some do histórico.
 *
 * O evento consumido guarda a marca (RecNo/serialNo/id) do registro que o
 * consumiu: se o replay reler o MESMO registro (marca d'água represada por
 * uma falha de envio mais adiante), ele continua sendo eco sem gastar outro
 * evento ao vivo.
 *
 * `cobrirAte` tira da memória o que a marca d'água já cobriu: um evento ao
 * vivo cujo registro ficou ABAIXO da marca nunca volta no replay, e deixado
 * aqui consumiria uma passagem NOVA da mesma pessoa (entrada ao vivo, stream
 * cai, saída 40 s depois só no log → a saída sumiria como "eco").
 */

// O instante do evento ao vivo é o relógio do agente (corrigido pela nuvem);
// o `CreateTime` é o do aparelho, acertado por esse mesmo relógio de hora em
// hora: 15 s cobrem a deriva no intervalo. (Eram 60 s — largo o bastante para
// engolir uma segunda passagem real da mesma pessoa.)
const JANELA_ECO_MS = 15 * 1000;
// Limites da memória, por aparelho.
const IDADE_MAX_MS = 10 * 60 * 1000;
const MAX_ENTRADAS_POR_APARELHO = 500;

function criarMemoriaDeEco({
  janelaMs = JANELA_ECO_MS,
  idadeMaxMs = IDADE_MAX_MS,
  maxEntradas = MAX_ENTRADAS_POR_APARELHO,
} = {}) {
  // deviceId → [{ pessoa, instanteMs, marca }] em ordem de chegada.
  // `marca` undefined = evento ainda livre; definida = registro que o consumiu.
  const porAparelho = new Map();
  // deviceId → instante até onde a marca d'água já cobre o que chegou ao vivo.
  const cobertoAte = new Map();

  function expirar(deviceId, agoraMs) {
    const lista = porAparelho.get(deviceId);
    if (!lista) return [];
    const vivas = lista.filter((e) => agoraMs - e.instanteMs <= idadeMaxMs);
    if (vivas.length === 0) porAparelho.delete(deviceId);
    else porAparelho.set(deviceId, vivas);
    return vivas;
  }

  /**
   * Um evento AO VIVO foi recebido de `pessoa` neste aparelho em `instanteMs`.
   * Se a marca d'água já cobriu esse instante (`cobrirAte` rodou entre o
   * evento chegar e ele ser registrado), não entra: o registro dele não volta
   * mais num replay.
   */
  function registrarAoVivo(deviceId, pessoa, instanteMs) {
    if (pessoa == null || !Number.isFinite(instanteMs)) return false;
    const coberto = cobertoAte.get(deviceId);
    if (coberto !== undefined && instanteMs <= coberto) return false;
    const lista = expirar(deviceId, instanteMs);
    lista.push({ pessoa: String(pessoa), instanteMs, marca: undefined });
    if (lista.length > maxEntradas) lista.splice(0, lista.length - maxEntradas);
    porAparelho.set(deviceId, lista);
    return true;
  }

  /**
   * Registra o evento ao vivo recebido em `instanteMs` DEPOIS do envio à
   * nuvem, e só se a entrega está garantida: a nuvem aceitou (`aceito`) ou o
   * evento foi para a fila offline (`enfileirado`). Recusa definitiva não
   * registra — senão o replay o trataria como eco e a marca d'água passaria
   * por cima: o evento seria perdido duas vezes.
   */
  function registrarAposEnvio(deviceId, pessoa, instanteMs, { aceito = false, enfileirado = false } = {}) {
    if (!aceito && !enfileirado) return false;
    return registrarAoVivo(deviceId, pessoa, instanteMs);
  }

  /**
   * Separa a lista do replay (`[{ pessoa, instanteMs: CreateTime em ms,
   * marca }]`) em `{ ecos, reais }` — os mesmos objetos, na ordem recebida.
   * Cada evento ao vivo livre casa com o registro da mesma pessoa mais
   * próximo no tempo (dentro da janela) e fica CONSUMIDO por ele. `agoraMs`
   * só serve para expirar entradas velhas.
   */
  function separarEcos(deviceId, registros, agoraMs) {
    const lista = expirar(deviceId, agoraMs);
    const regs = Array.isArray(registros) ? registros : [];
    const ehEcoPorIndice = new Set();
    const livres = [];
    regs.forEach((r, i) => {
      if (!r || r.pessoa == null || !Number.isFinite(r.instanteMs)) return;
      const quem = String(r.pessoa);
      // Registro relido: já tinha consumido um evento ao vivo.
      if (r.marca !== undefined && lista.some((e) => e.pessoa === quem && e.marca === r.marca)) {
        ehEcoPorIndice.add(i);
        return;
      }
      livres.push({ i, quem, instanteMs: r.instanteMs, marca: r.marca });
    });
    // Todos os pares possíveis (evento ao vivo livre × registro), do mais
    // próximo para o mais distante; cada lado entra em um par só.
    const pares = [];
    for (const e of lista) {
      if (e.marca !== undefined) continue;
      for (const r of livres) {
        if (r.quem !== e.pessoa) continue;
        const dist = Math.abs(e.instanteMs - r.instanteMs);
        if (dist <= janelaMs) pares.push({ e, r, dist });
      }
    }
    pares.sort((a, b) => a.dist - b.dist);
    const eventosUsados = new Set();
    for (const { e, r } of pares) {
      if (eventosUsados.has(e) || ehEcoPorIndice.has(r.i)) continue;
      eventosUsados.add(e);
      ehEcoPorIndice.add(r.i);
      // Sem marca no registro, `null` marca o evento como consumido mesmo assim.
      e.marca = r.marca === undefined ? null : r.marca;
    }
    return {
      ecos: regs.filter((_, i) => ehEcoPorIndice.has(i)),
      reais: regs.filter((_, i) => !ehEcoPorIndice.has(i)),
    };
  }

  /** Um registro só: é eco? (Para o replay use `separarEcos` com a lista toda.) */
  function ehEco(deviceId, registro = {}, agoraMs) {
    return separarEcos(deviceId, [registro], agoraMs).ecos.length === 1;
  }

  /**
   * A marca d'água do aparelho passou a cobrir tudo o que chegou ao vivo até
   * `instanteMs`: esses eventos saem da memória. `manterConsumidos`: preserva
   * os que já casaram com um registro (a marca d'água ficou represada e o
   * mesmo registro será relido).
   */
  function cobrirAte(deviceId, instanteMs, { manterConsumidos = false } = {}) {
    if (Number.isFinite(instanteMs)) {
      const anterior = cobertoAte.get(deviceId);
      if (anterior === undefined || instanteMs > anterior) cobertoAte.set(deviceId, instanteMs);
    }
    const lista = porAparelho.get(deviceId);
    if (!lista) return;
    const resto = lista.filter(
      (e) => e.instanteMs > instanteMs || (manterConsumidos && e.marca !== undefined),
    );
    if (resto.length === 0) porAparelho.delete(deviceId);
    else porAparelho.set(deviceId, resto);
  }

  function tamanho(deviceId) {
    return (porAparelho.get(deviceId) || []).length;
  }

  return { registrarAoVivo, registrarAposEnvio, separarEcos, ehEco, cobrirAte, tamanho };
}

/**
 * Avança a marca d'água de um aparelho online (`avancar()` lê o log do
 * aparelho e grava a marca nova) e, se ela de fato MUDOU, limpa a memória de
 * eco até o instante do FIM da busca — não do início: uma passagem ao vivo
 * que chega durante a busca tem o registro sob a marca nova e nunca volta num
 * replay; deixada na memória, consumiria a próxima passagem real da mesma
 * pessoa. (Se o registro dela ficou ACIMA da marca, o replay a reenvia como
 * backlog duplicado — a nuvem deduplica; é o lado seguro do erro.)
 *
 * `ocupado()`: há um replay em curso — quem limpa a memória é ele (leu o log
 * com a marca antiga: os registros destes eventos ainda vêm na lista dele).
 * Nunca rejeita; resolve com true quando limpou.
 */
async function avancarMarcaCobrindoEco({ eco, deviceId, lerMarca, avancar, agora, ocupado = () => false }) {
  try {
    const antes = lerMarca();
    await avancar();
    const depois = lerMarca();
    if (depois === undefined || depois === antes) return false;
    if (ocupado()) return false;
    eco.cobrirAte(deviceId, agora());
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  criarMemoriaDeEco,
  avancarMarcaCobrindoEco,
  JANELA_ECO_MS,
  IDADE_MAX_MS,
  MAX_ENTRADAS_POR_APARELHO,
};
