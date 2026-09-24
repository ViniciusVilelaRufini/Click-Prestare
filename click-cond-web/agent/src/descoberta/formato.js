'use strict';

/**
 * agent/src/descoberta/formato.js — tipos e utilidades puras da descoberta
 * na rede (etapa 3). Sem rede aqui: testável isolado.
 *
 * @typedef {Object} Achado
 * @property {string|null} mac  normalizado (minúsculo, com ':'), identidade do aparelho
 * @property {string} ip
 * @property {number} porta     porta HTTP
 * @property {'intelbras'|'hikvision'|'control_id'} fabricante
 * @property {string|null} modelo
 * @property {string|null} numero_serie
 * @property {boolean|null} dhcp
 * @property {boolean} validado_em_campo  false = protocolo feito pela documentação
 */

/** MAC em qualquer formato comum → 'aa:bb:cc:dd:ee:ff'; null se inválido/broadcast/zero. */
function normalizarMac(s) {
  if (typeof s !== 'string') return null;
  const hex = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12) return null;
  if (hex === '000000000000' || hex === 'ffffffffffff') return null;
  return hex.match(/../g).join(':');
}

/**
 * Um aparelho pode responder por dois caminhos (multicast + varredura, ou
 * duas interfaces). Funde por MAC; os campos não nulos do repetido preenchem
 * os que faltavam. Sem MAC (ARP ainda não viu o IP), agrupa por IP.
 */
function agruparPorMac(achados) {
  const porChave = new Map();
  for (const a of achados) {
    const chave = a.mac || `ip:${a.ip}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { ...a });
      continue;
    }
    for (const [k, v] of Object.entries(a)) {
      if (atual[k] == null && v != null) atual[k] = v;
    }
  }
  return [...porChave.values()];
}

module.exports = { normalizarMac, agruparPorMac };
