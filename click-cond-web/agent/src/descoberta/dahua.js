'use strict';

/**
 * agent/src/descoberta/dahua.js — protocolo de descoberta DHIP da linha
 * Dahua/Intelbras. VALIDADO em campo (24/09, SS 3530 MF FACE W): pacote de 32
 * bytes ('20 00 00 00' + 'DHIP', tamanho do JSON LE nos offsets 16 e 24) +
 * JSON DHDiscover.search, para 239.255.255.251:37810 (e broadcast). O
 * aparelho responde, para a porta de origem, com client.notifyDevInfo.
 * Não pede senha: só anuncia modelo, série, MAC e IP.
 */

const { normalizarMac } = require('./formato');

const PORTA = 37810;
const GRUPO = '239.255.255.251';

function montarPacoteDhip() {
  const json = Buffer.from(JSON.stringify({ method: 'DHDiscover.search', params: { mac: '', uni: 1 } }));
  const cab = Buffer.alloc(32);
  cab.write('\x20\x00\x00\x00DHIP', 0, 'latin1');
  cab.writeUInt32LE(json.length, 16);
  cab.writeUInt32LE(json.length, 24);
  return Buffer.concat([cab, json]);
}

function interpretarRespostaDhip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length <= 32) return null;
  if (buf.subarray(4, 8).toString('latin1') !== 'DHIP') return null;
  let msg;
  try {
    msg = JSON.parse(buf.subarray(32).toString('utf8'));
  } catch {
    return null;
  }
  const info = msg?.params?.deviceInfo;
  const ip = info?.IPv4Address?.IPAddress;
  if (msg?.method !== 'client.notifyDevInfo' || !info || typeof ip !== 'string') return null;
  return {
    mac: normalizarMac(msg.mac),
    ip,
    porta: Number(info.HttpPort) || 80,
    fabricante: 'intelbras',
    modelo: typeof info.DeviceType === 'string' ? info.DeviceType : null,
    numero_serie: typeof info.SerialNo === 'string' && info.SerialNo ? info.SerialNo : null,
    dhcp: typeof info.IPv4Address.DhcpEnable === 'boolean' ? info.IPv4Address.DhcpEnable : null,
    validado_em_campo: true,
    // DeviceClass diz o que o aparelho É (BSC/ASC = controle de acesso; IPC,
    // NVR... = câmera/gravador), para o portal não oferecer uma câmera como
    // terminal facial.
    classe: typeof info.DeviceClass === 'string' && info.DeviceClass ? info.DeviceClass : null,
  };
}

module.exports = { PORTA, GRUPO, montarPacoteDhip, interpretarRespostaDhip };
