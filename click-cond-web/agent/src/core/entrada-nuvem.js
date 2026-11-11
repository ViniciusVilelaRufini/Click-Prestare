'use strict';

/**
 * agent/src/core/entrada-nuvem.js — saneia o que chega da nuvem no poll antes
 * de o laço usar. O corpo é JSON de fora: um campo faltando ou torto não pode
 * derrubar o laço nem virar um laço apertado martelando a API.
 */

// Piso do intervalo de polling. `sleep(NaN)`/`sleep(0)` voltam na hora: um
// `poll_interval_ms` não numérico ou minúsculo faria o agente bater na nuvem
// (e nos aparelhos) sem pausa nenhuma.
const POLL_MIN_MS = 1000;

/**
 * Intervalo de polling a usar: `valor` se for um número finito > 0 (nunca
 * abaixo de `minimo`), senão `padrao`. `minimo` inválido cai em POLL_MIN_MS.
 */
function intervaloDePoll(valor, padrao, minimo = POLL_MIN_MS) {
  const piso = Number.isFinite(Number(minimo)) && Number(minimo) > 0 ? Number(minimo) : POLL_MIN_MS;
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'object') return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.max(piso, n);
}

/** Entradas `{ device, commands }` do poll que têm device com id. */
function entradasValidas(body) {
  const lista = body && Array.isArray(body.devices) ? body.devices : [];
  return lista.filter(
    (e) => e && typeof e === 'object' && e.device && typeof e.device === 'object' && e.device.id != null,
  );
}

/**
 * A resposta do poll do CONDOMÍNIO serve para alguma coisa? Só quando é 2xx E
 * o corpo é o objeto esperado (`{ devices: [...] }`).
 *
 * Antes, qualquer resposta que não fosse 401/404 seguia adiante: um 5xx, um
 * 429 ou a página HTML do balanceador virava corpo `{}` → lista de devices
 * vazia → o laço PARAVA todos os ouvintes, zerava o cache de devices e o
 * mapa de offline, sem backoff nenhum. Uma lista vazia só vale quando a
 * nuvem a mandou de verdade (`{ devices: [] }` com 2xx).
 *
 * Devolve `{ ok: true, body }` ou `{ ok: false, motivo }` (texto curto para o
 * log). 401/404 são tratados por quem chama ANTES daqui (token inválido).
 */
function avaliarRespostaDoPoll(res) {
  const status = res ? res.status : undefined;
  const trecho = () => {
    const bruto =
      res && typeof res.raw === 'string' && res.raw
        ? res.raw
        : res && typeof res.data === 'string'
          ? res.data
          : '';
    const curto = bruto.replace(/\s+/g, ' ').trim().slice(0, 120);
    return curto ? `: ${curto}` : '';
  };
  if (typeof status !== 'number' || status < 200 || status >= 300) {
    return { ok: false, motivo: `nuvem respondeu HTTP ${String(status)} ao poll${trecho()}` };
  }
  const body = res.data;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.devices)) {
    return { ok: false, motivo: `corpo inesperado no poll (HTTP ${status})${trecho()}` };
  }
  return { ok: true, body };
}

module.exports = { POLL_MIN_MS, intervaloDePoll, entradasValidas, avaliarRespostaDoPoll };
