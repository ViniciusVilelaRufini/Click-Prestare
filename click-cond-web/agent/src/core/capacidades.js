'use strict';

/**
 * agent/src/core/capacidades.js — o que este agente sabe operar além do
 * básico, declarado à nuvem em TODO poll do condomínio (query
 * `capacidades=guarita`) e na telemetria (`capacidades: ['guarita']`).
 *
 * Por quê: um agente ANTIGO que recebesse um device `tipo 'guarita'` cairia
 * no REST genérico e falaria HTTP na porta 9000 do Módulo Guarita. Com a
 * declaração, a API só entrega o Guarita a quem diz saber falar com ele.
 */

const CAPACIDADES = Object.freeze(['guarita']);
const QUERY_CAPACIDADES = `capacidades=${CAPACIDADES.join(',')}`;

/** Acrescenta `capacidades=...` à URL do poll (preserva query existente). */
function urlComCapacidades(caminho) {
  return `${caminho}${caminho.includes('?') ? '&' : '?'}${QUERY_CAPACIDADES}`;
}

module.exports = { CAPACIDADES, QUERY_CAPACIDADES, urlComCapacidades };
