'use strict';

/**
 * agent/src/core/nuvem.js — cliente da API na nuvem: requisição autenticada
 * pela URL (config via `configurar`, não variável global solta) e a
 * correção de relógio (skew) contra o servidor.
 */

const { request } = require('../lib/http');

// URL base da API na nuvem — injetada por configurar(), quem lê o .env
// (API_URL) é index.js.
let apiUrl = '';

function configurar({ apiUrl: url } = {}) {
  apiUrl = (url || '').replace(/\/+$/, '');
}

// Defasagem entre o relógio DESTA máquina e o da nuvem, em ms (positivo = a
// máquina local está adiantada). Toda resposta HTTP traz o header `Date` do
// servidor, então dá para medir isso de graça, sem NTP.
//
// Por que isso existe: o PC da portaria costuma rodar com o relógio livre no
// CMOS, sem sincronizar com ninguém. Encontrado em produção com 91,5s de
// adiantamento (`w32tm`: "Fonte: Local CMOS Clock"). O agente gravava essa hora
// errada no terminal, o terminal carimbava os acessos 91s no futuro, e no
// histórico a passagem aparecia DEPOIS da queda de rede que veio antes dela.
let cloudClockSkewMs = 0;
let cloudClockSkewConhecido = false;

function registrarSkewDaNuvem(res, enviadoEm) {
  const dateHeader = res?.headers?.date;
  if (!dateHeader) return;
  const servidorMs = Date.parse(dateHeader);
  if (!Number.isFinite(servidorMs)) return;
  // O header tem resolução de 1s e a resposta leva um RTT para chegar; usar o
  // meio do intervalo tira o viés da latência. Precisão de ~1s é de sobra:
  // o que importa é não errar por minutos.
  const localMs = (enviadoEm + Date.now()) / 2;
  const novo = localMs - servidorMs;
  // Suaviza para uma amostra ruim (pico de latência) não sacudir o relógio.
  cloudClockSkewMs = cloudClockSkewConhecido
    ? cloudClockSkewMs * 0.7 + novo * 0.3
    : novo;
  cloudClockSkewConhecido = true;
}

/** Hora atual corrigida pela da nuvem — use no lugar de `new Date()` para
 *  qualquer coisa que vire timestamp de evento ou vá para o aparelho. */
function agoraDaNuvem() {
  return new Date(Date.now() - cloudClockSkewMs);
}

async function cloudRequest(method, pathname, jsonBody) {
  const enviadoEm = Date.now();
  const res = await request(apiUrl + pathname, {
    method,
    json: jsonBody,
    timeout: 15000,
  });
  registrarSkewDaNuvem(res, enviadoEm);
  return res;
}

module.exports = { configurar, cloudRequest, registrarSkewDaNuvem, agoraDaNuvem };
