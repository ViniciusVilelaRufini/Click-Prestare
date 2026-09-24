'use strict';

/**
 * agent/src/descoberta/index.js — acha aparelhos de controle de acesso na LAN
 * (etapa 3). Só LÊ: nenhuma credencial vai para aparelho achado.
 *
 *  - DHIP (Intelbras/Dahua) e SADP (Hikvision): multicast + broadcast em cada
 *    interface IPv4 não interna; coleta respostas por `esperaMs`.
 *  - Control iD (sem protocolo de descoberta): com `varredura`, GET / na
 *    porta 80 de cada host das /24 locais, concorrência limitada.
 *  - MAC que faltar vem da tabela ARP; no fim, um achado por MAC.
 *
 * `destinos`/`hostsVarredura` substituem a rede real (testes e harness).
 */

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const dahua = require('./dahua');
const hik = require('./hikvision');
const cid = require('./controlid');
const { lerTabelaArp } = require('./arp');
const { agruparPorMac } = require('./formato');

const CONCORRENCIA_HTTP = 32;
const TIMEOUT_HTTP_MS = 800;

function interfacesLocais() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal);
}

function pacoteDe(protocolo) {
  return protocolo === 'sadp'
    ? hik.montarProbeSadp(crypto.randomUUID().toUpperCase())
    : dahua.montarPacoteDhip();
}

function interpretar(msg) {
  return dahua.interpretarRespostaDhip(msg) || hik.interpretarRespostaSadp(msg);
}

/** Um socket por interface (ou um em 0.0.0.0 com destinos explícitos). */
function sondarUdp(destinos, esperaMs) {
  return new Promise((resolve) => {
    const achados = [];
    const sockets = [];
    const planos = destinos
      ? [{ endereco: '0.0.0.0', alvos: destinos }]
      : interfacesLocais().map((i) => ({
          endereco: i.address,
          alvos: [
            { protocolo: 'dhip', host: dahua.GRUPO, porta: dahua.PORTA },
            { protocolo: 'dhip', host: '255.255.255.255', porta: dahua.PORTA },
            { protocolo: 'sadp', host: hik.GRUPO, porta: hik.PORTA },
          ],
        }));
    for (const plano of planos) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(s);
      s.on('error', () => {});
      s.on('message', (msg) => {
        const a = interpretar(msg);
        if (a) achados.push(a);
      });
      s.bind(0, plano.endereco, () => {
        try {
          s.setBroadcast(true);
          if (plano.endereco !== '0.0.0.0') s.setMulticastInterface(plano.endereco);
        } catch {
          /* interface sem multicast: segue só com o que der */
        }
        for (const alvo of plano.alvos) {
          s.send(pacoteDe(alvo.protocolo), alvo.porta, alvo.host, () => {});
        }
      });
    }
    setTimeout(() => {
      for (const s of sockets) {
        try { s.close(); } catch { /* já fechado */ }
      }
      resolve(achados);
    }, esperaMs);
  });
}

function getHttp(host, porta) {
  return new Promise((resolve) => {
    const req = http.get({ host, port: porta, path: '/', timeout: TIMEOUT_HTTP_MS }, (res) => {
      let corpo = '';
      res.setEncoding('latin1');
      res.on('data', (c) => { if (corpo.length < 20000) corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function varrerHttp(hostsVarredura) {
  const alvos = hostsVarredura
    ? hostsVarredura.map((hp) => { const [h, p] = hp.split(':'); return { host: h, porta: Number(p) || 80 }; })
    : interfacesLocais().flatMap((i) => cid.hostsDaSubrede(i.address, i.netmask).map((h) => ({ host: h, porta: 80 })));
  const achados = [];
  let proximo = 0;
  async function trabalhador() {
    while (proximo < alvos.length) {
      const { host, porta } = alvos[proximo++];
      const r = await getHttp(host, porta);
      if (r && cid.pareceControlId(r)) {
        achados.push({ mac: null, ip: host, porta, fabricante: 'control_id', modelo: null, numero_serie: null, dhcp: null, validado_em_campo: false });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA_HTTP, alvos.length) }, trabalhador));
  return achados;
}

async function descobrir({ varredura = false, destinos, esperaMs = 3000, hostsVarredura } = {}) {
  try {
    const [udp, web] = await Promise.all([
      sondarUdp(destinos, esperaMs),
      varredura ? varrerHttp(hostsVarredura) : Promise.resolve([]),
    ]);
    const todos = [...udp, ...web];
    if (todos.some((a) => !a.mac)) {
      const arp = await lerTabelaArp();
      for (const a of todos) if (!a.mac) a.mac = arp.get(a.ip) || null;
    }
    return agruparPorMac(todos);
  } catch (err) {
    console.log(`[agente] descoberta na rede falhou: ${err.message || err}`);
    return [];
  }
}

module.exports = { descobrir };
