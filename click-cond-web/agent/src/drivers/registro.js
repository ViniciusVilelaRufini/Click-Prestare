'use strict';

/**
 * agent/src/drivers/registro.js — resolve qual driver fala com um device,
 * por (tipo, fabricante).
 *
 * Fabricante NORMALIZADO: "intelbras" e "dahua" são a MESMA linha de
 * aparelho (a Intelbras é OEM da Dahua — mesmo protocolo RPC2/CGI) e caem no
 * driver `dahua-facial`. A API já grava devices com fabricante literal
 * "dahua" (ver `normalizarFabricante` em apps/api/src/app/facial/facial.service.ts)
 * — sem essa normalização aqui, esses devices cairiam sem driver.
 *
 * Combinação (tipo, fabricante) sem driver conhecido devolve `null`. Quem
 * chama decide o que fazer (hoje: index.js ignora; o Supervisor da tarefa 6
 * loga uma vez "sem driver para <tipo>/<fabricante>" e não assina nada).
 */

const dahuaFacial = require('./dahua-facial');
const hikvisionFacial = require('./hikvision-facial');
const controlidFacial = require('./controlid-facial');

// fabricante (bruto) → família de driver.
const FAMILIA_POR_FABRICANTE = {
  intelbras: 'dahua',
  dahua: 'dahua',
};

// "tipo/família" → módulo do driver. Hikvision e Control iD não têm entrada
// em FAMILIA_POR_FABRICANTE: o fabricante já é gravado com o nome literal
// ("hikvision"/"control_id"), então a família cai no fallback (`|| device.fabricante`
// em resolverDriver) e bate direto com a chave abaixo.
const DRIVERS_POR_CHAVE = {
  'facial/dahua': dahuaFacial,
  'facial/hikvision': hikvisionFacial,
  'facial/control_id': controlidFacial,
};

function resolverDriver(device) {
  if (!device) return null;
  const familia = FAMILIA_POR_FABRICANTE[device.fabricante] || device.fabricante;
  const chave = `${device.tipo}/${familia}`;
  return DRIVERS_POR_CHAVE[chave] || null;
}

module.exports = { resolverDriver, FAMILIA_POR_FABRICANTE };
