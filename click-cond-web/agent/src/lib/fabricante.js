'use strict';

/**
 * agent/src/lib/fabricante.js — normaliza o `fabricante` que vem da nuvem.
 *
 * O campo é texto livre no cadastro: "Intelbras", " hikvision ", "Control iD"
 * e "control_id" têm de cair no MESMO protocolo. Comparar a string crua fazia
 * um aparelho cadastrado com outra grafia ficar sem driver (comandos no REST
 * genérico, sem ouvinte de eventos).
 *
 * Módulo puro e sem dependências: é usado por `drivers/registro.js` (escolha
 * do driver) e por `lib/http.js` (Control iD não usa auth por header).
 */

// grafia normalizada → família de driver.
const FAMILIA_POR_FABRICANTE = {
  // A Intelbras é OEM da Dahua: mesmo protocolo RPC2/CGI.
  intelbras: 'dahua',
  dahua: 'dahua',
  hikvision: 'hikvision',
  hik: 'hikvision',
  control_id: 'control_id',
  controlid: 'control_id',
  'control id': 'control_id',
  'control-id': 'control_id',
};

/** trim + minúsculas + sem acentos + espaços internos colapsados. Não-string vira ''. */
function normalizarFabricante(bruto) {
  if (typeof bruto !== 'string') return '';
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Família de driver do fabricante, ou a própria grafia normalizada quando
 *  não há alias (quem chama decide se existe driver para ela). */
function familiaDoFabricante(bruto) {
  const n = normalizarFabricante(bruto);
  return Object.prototype.hasOwnProperty.call(FAMILIA_POR_FABRICANTE, n)
    ? FAMILIA_POR_FABRICANTE[n]
    : n;
}

module.exports = { FAMILIA_POR_FABRICANTE, normalizarFabricante, familiaDoFabricante };
