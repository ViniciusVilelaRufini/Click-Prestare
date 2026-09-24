'use strict';

/**
 * agent/src/descoberta/hikvision.js — SADP (Search Active Devices Protocol)
 * da Hikvision: XML <Probe> para 239.255.255.250:37020; o aparelho responde
 * <ProbeMatch>. NÃO VALIDADO EM CAMPO (feito pela documentação/capturas
 * públicas) — por isso `validado_em_campo: false` até um cliente ter o
 * aparelho.
 */

const { normalizarMac } = require('./formato');

const PORTA = 37020;
const GRUPO = '239.255.255.250';

function montarProbeSadp(uuid) {
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`,
  );
}

function tag(xml, nome) {
  const m = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`, 'i'));
  return m ? m[1].trim() : null;
}

function interpretarRespostaSadp(buf) {
  const xml = Buffer.isBuffer(buf) ? buf.toString('utf8') : '';
  if (!/<ProbeMatch>/i.test(xml)) return null;
  const ip = tag(xml, 'IPv4Address');
  if (!ip) return null;
  const dhcp = tag(xml, 'DHCP');
  return {
    mac: normalizarMac(tag(xml, 'MAC')),
    ip,
    porta: Number(tag(xml, 'HttpPort')) || 80,
    fabricante: 'hikvision',
    modelo: tag(xml, 'DeviceDescription') || tag(xml, 'DeviceType'),
    numero_serie: tag(xml, 'DeviceSN'),
    dhcp: dhcp == null ? null : dhcp.toLowerCase() === 'true',
    validado_em_campo: false,
    classe: null, // SADP não traz uma classe equivalente ao DeviceClass do DHIP
  };
}

module.exports = { PORTA, GRUPO, montarProbeSadp, interpretarRespostaSadp };
