'use strict';

/**
 * agent/src/descoberta/arp.js — tabela ARP do Windows (`arp -a`): o MAC de
 * qualquer IP da LAN com quem o PC falou há pouco. É a identidade universal
 * (vale para toda marca) usada para reencontrar um aparelho que mudou de IP.
 */

const { execFile } = require('child_process');
const { normalizarMac } = require('./formato');

function interpretarArp(texto) {
  const mapa = new Map();
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const m = linha.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})\s/i);
    if (!m) continue;
    const mac = normalizarMac(m[2]);
    if (mac) mapa.set(m[1], mac);
  }
  return mapa;
}

function lerTabelaArp() {
  return new Promise((resolve) => {
    execFile('arp', ['-a'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? new Map() : interpretarArp(stdout));
    });
  });
}

module.exports = { interpretarArp, lerTabelaArp };
