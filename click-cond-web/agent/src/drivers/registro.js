'use strict';

/**
 * agent/src/drivers/registro.js — resolve qual driver fala com um device.
 *
 * DUAS perguntas diferentes, duas funções:
 *
 *   - `resolverDriver(device)` — COMANDOS (`testar`/ping, `executar`:
 *     open_door, enroll, remove...): pela FAMÍLIA do fabricante, qualquer
 *     que seja o `tipo`. Uma catraca/botoeira/leitor de tag ou QR da Control
 *     iD, Intelbras ou Hikvision fala o mesmo protocolo da marca que o
 *     facial — era assim antes da refatoração (despacho só por fabricante) e
 *     resolver por (tipo, fabricante) fazia esses aparelhos caírem no REST
 *     genérico (open_door quebrado, ping em GET /status → "offline").
 *
 *   - `resolverDriverDeEventos(device)` — OUVINTE de reconhecimento facial
 *     (`escutar`, `buscarDesde`, `acertarRelogio`, marca d'água): só para
 *     `tipo` 'facial' (tipo ausente conta como facial — é o default da API).
 *     Uma câmera LPR Intelbras não pode herdar o ouvinte facial da Dahua.
 *
 * Fabricante NORMALIZADO: "intelbras" e "dahua" são a MESMA linha de
 * aparelho (a Intelbras é OEM da Dahua — mesmo protocolo RPC2/CGI) e caem no
 * driver `dahua-facial`. A API já grava devices com fabricante literal
 * "dahua" (ver `normalizarFabricante` em apps/api/src/app/facial/facial.service.ts)
 * — sem essa normalização aqui, esses devices cairiam sem driver.
 *
 * Sem driver conhecido, as duas devolvem `null`. Quem chama decide o que
 * fazer (index.js cai no REST genérico para comandos; o Supervisor loga uma
 * vez "sem driver para <tipo>/<fabricante>" e não assina nada).
 */

const dahuaFacial = require('./dahua-facial');
const hikvisionFacial = require('./hikvision-facial');
const controlidFacial = require('./controlid-facial');

// fabricante (bruto) → família de driver. Hikvision e Control iD não têm
// entrada: o fabricante já é gravado com o nome literal ("hikvision"/
// "control_id"), então a família cai no fallback (`|| device.fabricante`).
const FAMILIA_POR_FABRICANTE = {
  intelbras: 'dahua',
  dahua: 'dahua',
};

const DRIVERS_POR_FAMILIA = {
  dahua: dahuaFacial,
  hikvision: hikvisionFacial,
  control_id: controlidFacial,
};

/** Driver para COMANDOS (ping, open_door, enroll...): por família, qualquer tipo. */
function resolverDriver(device) {
  if (!device || !device.fabricante) return null;
  const familia = FAMILIA_POR_FABRICANTE[device.fabricante] || device.fabricante;
  return Object.prototype.hasOwnProperty.call(DRIVERS_POR_FAMILIA, familia)
    ? DRIVERS_POR_FAMILIA[familia]
    : null;
}

/** Driver para o OUVINTE de eventos faciais (escutar/buscarDesde/acertarRelogio): só tipo 'facial'. */
function resolverDriverDeEventos(device) {
  if (!device) return null;
  if ((device.tipo || 'facial') !== 'facial') return null;
  return resolverDriver(device);
}

module.exports = { resolverDriver, resolverDriverDeEventos, FAMILIA_POR_FABRICANTE };
