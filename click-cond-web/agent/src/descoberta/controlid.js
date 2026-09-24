'use strict';

/**
 * agent/src/descoberta/controlid.js — Control iD não tem protocolo de
 * descoberta: o orquestrador faz GET http://ip:80/ nos hosts da /24 local e
 * este módulo reconhece a página do aparelho. NÃO VALIDADO EM CAMPO.
 * Só /24: sub-rede maior (ex. a /20 virtual do Hyper-V/WSL) faria milhares de
 * requisições por varredura sem nenhum aparelho de portaria do outro lado.
 */

function pareceControlId({ status, headers, corpo }) {
  if (!(status >= 200 && status < 400)) return false;
  const texto = `${JSON.stringify(headers || {})} ${String(corpo || '').slice(0, 20000)}`;
  return /control\s?id/i.test(texto);
}

function hostsDaSubrede(ip, mascara) {
  if (mascara !== '255.255.255.0') return [];
  const partes = String(ip).split('.');
  if (partes.length !== 4) return [];
  const prefixo = partes.slice(0, 3).join('.');
  const hosts = [];
  for (let n = 1; n <= 254; n++) {
    const h = `${prefixo}.${n}`;
    if (h !== ip) hosts.push(h);
  }
  return hosts;
}

module.exports = { pareceControlId, hostsDaSubrede };
