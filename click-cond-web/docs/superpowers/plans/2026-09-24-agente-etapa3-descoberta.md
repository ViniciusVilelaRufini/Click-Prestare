# Etapa 3 — Descoberta na rede e correção de IP · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o agente acha faciais Intelbras/Dahua, Hikvision e Control iD na LAN, o portal os oferece para cadastro já preenchidos, e a nuvem corrige sozinha o IP de um aparelho cadastrado que mudou de endereço (identificado pelo MAC).

**Architecture:** módulos puros no agente (`agent/src/descoberta/`) montam pacotes e interpretam respostas; um orquestrador faz a rede (UDP multicast + varredura HTTP + ARP) e agrupa por MAC; `index.js` agenda e envia para `POST /api/facial/agent/condo/:token/descobertos`. Na API, um `DescobertaService` novo sanitiza, guarda em memória por condomínio, aprende MAC e corrige IP (com auditoria); o portal lê por rotas de operador e mostra a seção "Encontrados na rede".

**Tech Stack:** agente em Node (CommonJS, só módulos nativos: `dgram`, `http`, `child_process`, `os`), testes `node --test`; API NestJS + Prisma (MySQL), jest; portal Angular (signals, standalone), jest.

**Spec:** `click-cond-web/docs/superpowers/specs/2026-09-24-agente-etapa3-descoberta-design.md`

## Global Constraints

- Todos os caminhos abaixo são relativos a `click-cond-web/` (raiz do monorepo Nx). Rodar comandos de lá, exceto onde indicado.
- Agente: **nenhuma dependência npm em runtime**; só módulos nativos do Node. CommonJS, `'use strict'`.
- Descoberta **só lê**: nenhuma credencial é enviada a aparelho achado; nenhuma senha é testada.
- Valores de `fabricante` são exatamente `'intelbras'`, `'hikvision'`, `'control_id'` (Dahua vira `'intelbras'`).
- MAC sempre normalizado: minúsculas, separado por `:`, 17 caracteres (`b4:4c:3b:f4:e3:01`).
- Hikvision e Control iD levam `validado_em_campo: false`; Intelbras/Dahua `true`.
- Comentários e mensagens em português, no estilo do código vizinho (comentário explica o PORQUÊ).
- Rota pública do agente trata o corpo como não confiável (sanitizar: tipos, tamanhos, no máximo 200 achados).
- Correção de IP só dentro do condomínio do token, casada por MAC exato, sempre auditada (`DISPOSITIVO_IP_CORRIGIDO`).
- Não rodar `prisma db push`/migrate contra banco nenhum: a migração é um SQL manual (aplicado pelo controlador fora do plano).
- Testes do agente: `node --test agent/test/*.test.js`. Harness: `cd agent && node harness/run.js`. API: `npx jest apps/api/src/app/facial --silent` (ou `npx nx test api -- <padrão>`). Portal: `npx nx test portaria-web -- terminais-faciais`.

## Fato de campo (sonda de 24/09 no SS 3530 MF FACE W) — usar como fixture

Resposta DHIP real (JSON após o cabeçalho de 32 bytes):

```json
{"mac":"b4:4c:3b:f4:e3:01","method":"client.notifyDevInfo","params":{"deviceInfo":{"AlarmInputChannels":1,"AlarmOutputChannels":0,"DeviceClass":"BSC","DeviceID":"","DeviceType":"SS 3530 MF FACE W","Find":"BC","FindVersion":0,"HttpPort":80,"IPv4Address":{"DefaultGateway":"192.168.3.1","DhcpEnable":true,"IPAddress":"192.168.3.175","SubnetMask":"255.255.255.0"},"IPv6Address":{"DefaultGateway":null,"DhcpEnable":false,"IPAddress":"\/0","LinkLocalAddress":"fe80::b64c:3bff:fef4:e301\/64"},"Init":2198,"MachineGroup":"","MachineName":"K3LJ3400209RH","Manufacturer":"Intelbras","Port":37777,"RemoteVideoInputChannels":0,"SerialNo":"K3LJ3400209RH","UnLoginFuncMask":1,"Vendor":"Intelbras","Version":"2.000.00IB004.0.R","VideoInputChannels":1,"VideoOutputChannels":16}}}
```

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `agent/src/descoberta/formato.js` (novo) | `normalizarMac`, tipo `Achado` (JSDoc), `agruparPorMac` |
| `agent/src/descoberta/dahua.js` (novo) | `montarPacoteDhip()`, `interpretarRespostaDhip(buf)` |
| `agent/src/descoberta/hikvision.js` (novo) | `montarProbeSadp(uuid)`, `interpretarRespostaSadp(buf)` |
| `agent/src/descoberta/controlid.js` (novo) | `pareceControlId({ status, headers, corpo })`, `hostsDaSubrede(ip, mascara)` |
| `agent/src/descoberta/arp.js` (novo) | `interpretarArp(texto)`, `lerTabelaArp()` |
| `agent/src/descoberta/index.js` (novo) | `descobrir({ varredura, destinos, esperaMs })` — rede + agrupamento |
| `agent/src/index.js` (modificar) | agendamento, flag `descobrir` do poll, gatilho de device offline, envio |
| `agent/test/descoberta-*.test.js` (novos) | testes dos módulos puros |
| `agent/harness/mock-device.js`, `agent/harness/run.js` (modificar) | responder DHIP simulado; rota `descobertos` na nuvem simulada; cenário |
| `prisma/schema.prisma` + `prisma/manual_2026-09_facial_devices_mac.sql` (novo) | colunas `mac`, `numero_serie` |
| `apps/api/src/app/facial/descoberta.service.ts` (novo) + `.spec.ts` | sanitização, memória por condomínio, aprender MAC, corrigir IP, pedido "procurar" |
| `apps/api/src/app/facial/agent.controller.ts` (modificar) | `POST condo/:token/descobertos`; `descobrir` no poll |
| `apps/api/src/app/facial/facial.controller.ts` (modificar) | `GET facial/descobertos`, `POST facial/descobertos/procurar` |
| `apps/api/src/app/facial/facial.service.ts` (modificar) | `CreateDeviceDto` aceita `mac`/`numero_serie` |
| `apps/api/src/app/facial/facial.module.ts` (modificar) | registra `DescobertaService` |
| `apps/portaria-web/src/app/terminais-faciais/*` (modificar) + spec novo | seção "Encontrados na rede", Cadastrar preenchido, Procurar, aviso de IP |

---

### Task 1: Agente — formatos puros de descoberta (DHIP, SADP, Control iD, ARP, agrupamento)

**Files:**
- Create: `agent/src/descoberta/formato.js`, `agent/src/descoberta/dahua.js`, `agent/src/descoberta/hikvision.js`, `agent/src/descoberta/controlid.js`, `agent/src/descoberta/arp.js`
- Test: `agent/test/descoberta-formato.test.js`

**Interfaces:**
- Produces:
  - `formato.normalizarMac(s: string): string | null` — aceita `b4-4C-3b-...`, `B44C3B...` (12 hex) ou com `:`; devolve minúsculo com `:` ou `null` se inválido; `00:00:00:00:00:00` e `ff:ff:ff:ff:ff:ff` → `null`.
  - `formato.agruparPorMac(achados: Achado[]): Achado[]` — um por MAC; ao fundir, campos não nulos do segundo preenchem os nulos do primeiro; achados sem MAC são mantidos um por IP.
  - `Achado = { mac: string|null, ip: string, porta: number, fabricante: 'intelbras'|'hikvision'|'control_id', modelo: string|null, numero_serie: string|null, dhcp: boolean|null, validado_em_campo: boolean }`
  - `dahua.montarPacoteDhip(): Buffer`; `dahua.interpretarRespostaDhip(buf: Buffer): Achado|null` (null se não for DHIP válido); `dahua.PORTA = 37810`; `dahua.GRUPO = '239.255.255.251'`.
  - `hikvision.montarProbeSadp(uuid: string): Buffer`; `hikvision.interpretarRespostaSadp(buf: Buffer): Achado|null`; `hikvision.PORTA = 37020`; `hikvision.GRUPO = '239.255.255.250'`.
  - `controlid.pareceControlId({ status: number, headers: object, corpo: string }): boolean`; `controlid.hostsDaSubrede(ip: string, mascara: string): string[]` — só para máscara `255.255.255.0` (devolve os 254 hosts exceto o próprio `ip`); outra máscara → `[]`.
  - `arp.interpretarArp(texto: string): Map<string, string>` (ip → mac normalizado); `arp.lerTabelaArp(): Promise<Map<string,string>>` (roda `arp -a`, erro → Map vazio).

- [ ] **Step 1: Write the failing tests** — `agent/test/descoberta-formato.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizarMac, agruparPorMac } = require('../src/descoberta/formato');
const dahua = require('../src/descoberta/dahua');
const hik = require('../src/descoberta/hikvision');
const cid = require('../src/descoberta/controlid');
const { interpretarArp } = require('../src/descoberta/arp');

const RESPOSTA_REAL = '{"mac":"b4:4c:3b:f4:e3:01","method":"client.notifyDevInfo","params":{"deviceInfo":{"DeviceClass":"BSC","DeviceType":"SS 3530 MF FACE W","HttpPort":80,"IPv4Address":{"DefaultGateway":"192.168.3.1","DhcpEnable":true,"IPAddress":"192.168.3.175","SubnetMask":"255.255.255.0"},"Manufacturer":"Intelbras","SerialNo":"K3LJ3400209RH","Vendor":"Intelbras","Version":"2.000.00IB004.0.R"}}}';

function comCabecalho(json) {
  const corpo = Buffer.from(json);
  const h = Buffer.alloc(32);
  h.write('\x20\x00\x00\x00DHIP', 0, 'latin1');
  h.writeUInt32LE(corpo.length, 16);
  h.writeUInt32LE(corpo.length, 24);
  return Buffer.concat([h, corpo]);
}

test('normalizarMac aceita traços, maiúsculas e 12 hex; rejeita lixo', () => {
  assert.strictEqual(normalizarMac('B4-4C-3B-F4-E3-01'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(normalizarMac('b44c3bf4e301'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(normalizarMac('ff-ff-ff-ff-ff-ff'), null);
  assert.strictEqual(normalizarMac('00:00:00:00:00:00'), null);
  assert.strictEqual(normalizarMac('xyz'), null);
  assert.strictEqual(normalizarMac(undefined), null);
});

test('pacote DHIP tem cabeçalho de 32 bytes com o tamanho do JSON', () => {
  const p = dahua.montarPacoteDhip();
  assert.strictEqual(p.subarray(4, 8).toString('latin1'), 'DHIP');
  const tam = p.readUInt32LE(16);
  assert.strictEqual(p.readUInt32LE(24), tam);
  assert.strictEqual(p.length, 32 + tam);
  assert.deepStrictEqual(JSON.parse(p.subarray(32).toString()), {
    method: 'DHDiscover.search', params: { mac: '', uni: 1 },
  });
});

test('interpreta a resposta DHIP real do SS 3530 MF', () => {
  const a = dahua.interpretarRespostaDhip(comCabecalho(RESPOSTA_REAL));
  assert.deepStrictEqual(a, {
    mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras',
    modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true,
  });
});

test('DHIP: ignora o próprio pedido (DHDiscover.search) e lixo', () => {
  assert.strictEqual(dahua.interpretarRespostaDhip(dahua.montarPacoteDhip()), null);
  assert.strictEqual(dahua.interpretarRespostaDhip(Buffer.from('oi')), null);
});

test('interpreta ProbeMatch SADP (Hikvision, não validado em campo)', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><ProbeMatch><Uuid>X</Uuid><Types>inquiry</Types><DeviceType>135340</DeviceType><DeviceDescription>DS-K1T671M</DeviceDescription><DeviceSN>DS-K1T671M20210101AAWRF12345678</DeviceSN><CommandPort>8000</CommandPort><HttpPort>80</HttpPort><MAC>44-19-b6-aa-bb-cc</MAC><IPv4Address>192.168.3.64</IPv4Address><DHCP>false</DHCP></ProbeMatch>';
  assert.deepStrictEqual(hik.interpretarRespostaSadp(Buffer.from(xml)), {
    mac: '44:19:b6:aa:bb:cc', ip: '192.168.3.64', porta: 80, fabricante: 'hikvision',
    modelo: 'DS-K1T671M', numero_serie: 'DS-K1T671M20210101AAWRF12345678', dhcp: false, validado_em_campo: false,
  });
  assert.strictEqual(hik.interpretarRespostaSadp(hik.montarProbeSadp('ABC')), null);
});

test('reconhece a página do Control iD; hosts da /24', () => {
  assert.strictEqual(cid.pareceControlId({ status: 200, headers: {}, corpo: '<title>Control iD</title>' }), true);
  assert.strictEqual(cid.pareceControlId({ status: 200, headers: { server: 'lighttpd' }, corpo: '<html>controlid.com.br</html>' }), true);
  assert.strictEqual(cid.pareceControlId({ status: 401, headers: { 'www-authenticate': 'Digest realm="Login to K3LJ"' }, corpo: '' }), false);
  const hosts = cid.hostsDaSubrede('192.168.3.74', '255.255.255.0');
  assert.strictEqual(hosts.length, 253);
  assert.ok(!hosts.includes('192.168.3.74') && hosts.includes('192.168.3.1') && hosts.includes('192.168.3.254'));
  assert.deepStrictEqual(cid.hostsDaSubrede('172.26.144.1', '255.255.240.0'), []);
});

test('interpreta a saída do arp -a do Windows', () => {
  const texto = '\r\nInterface: 192.168.3.74 --- 0x7\r\n  Endereço IP           Endereço físico       Tipo\r\n  192.168.3.1           a0-b1-c2-d3-e4-f5     dinâmico\r\n  192.168.3.175         b4-4c-3b-f4-e3-01     dinâmico\r\n  192.168.3.255         ff-ff-ff-ff-ff-ff     estático\r\n';
  const m = interpretarArp(texto);
  assert.strictEqual(m.get('192.168.3.175'), 'b4:4c:3b:f4:e3:01');
  assert.strictEqual(m.get('192.168.3.1'), 'a0:b1:c2:d3:e4:f5');
  assert.strictEqual(m.has('192.168.3.255'), false);
});

test('agruparPorMac funde o mesmo aparelho e mantém sem-MAC por IP', () => {
  const base = { porta: 80, fabricante: 'intelbras', modelo: null, numero_serie: null, dhcp: null, validado_em_campo: true };
  const r = agruparPorMac([
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175' },
    { ...base, mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', modelo: 'SS 3530', numero_serie: 'K3' },
    { ...base, mac: null, ip: '192.168.3.9', fabricante: 'control_id', validado_em_campo: false },
    { ...base, mac: null, ip: '192.168.3.9', fabricante: 'control_id', validado_em_campo: false },
  ]);
  assert.strictEqual(r.length, 2);
  const f = r.find((a) => a.mac);
  assert.strictEqual(f.modelo, 'SS 3530');
  assert.strictEqual(f.numero_serie, 'K3');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test agent/test/descoberta-formato.test.js`
Expected: FAIL — `Cannot find module '../src/descoberta/formato'`.

- [ ] **Step 3: Implement the five modules**

`agent/src/descoberta/formato.js`:

```js
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
```

`agent/src/descoberta/dahua.js`:

```js
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
  };
}

module.exports = { PORTA, GRUPO, montarPacoteDhip, interpretarRespostaDhip };
```

`agent/src/descoberta/hikvision.js`:

```js
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
  };
}

module.exports = { PORTA, GRUPO, montarProbeSadp, interpretarRespostaSadp };
```

`agent/src/descoberta/controlid.js`:

```js
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
```

`agent/src/descoberta/arp.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test agent/test/descoberta-formato.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/src/descoberta agent/test/descoberta-formato.test.js
git commit -m "feat(agente): formatos da descoberta na rede (DHIP, SADP, Control iD, ARP)"
```

---

### Task 2: Agente — orquestrador `descobrir()` (UDP + varredura HTTP + ARP)

**Files:**
- Create: `agent/src/descoberta/index.js`
- Test: `agent/test/descoberta-orquestrador.test.js`

**Interfaces:**
- Consumes: tudo da Task 1.
- Produces: `descobrir({ varredura = false, destinos, esperaMs = 3000, hostsVarredura } = {}): Promise<Achado[]>`.
  - `destinos` (opcional, para testes/harness): lista `[{ protocolo: 'dhip'|'sadp', host: string, porta: number }]`; quando presente, **substitui** os destinos multicast/broadcast padrão e as interfaces (envia unicast de um socket em `0.0.0.0`). Em produção o agente lê `DESCOBERTA_DESTINOS` do `.env` (formato `dhip@127.0.0.1:47810,sadp@127.0.0.1:47020`) e repassa.
  - `hostsVarredura` (opcional, testes): lista de `host:porta` a sondar via HTTP no lugar das /24 locais.
  - Achados sem MAC são completados pela ARP (`lerTabelaArp`) antes de `agruparPorMac`.
  - Nunca lança: erro de socket/HTTP é engolido e registrado com `console.log` uma vez por descoberta.

- [ ] **Step 1: Write the failing test** — `agent/test/descoberta-orquestrador.test.js` sobe um responder DHIP UDP e um servidor HTTP "Control iD" em `127.0.0.1` e chama `descobrir` com `destinos`/`hostsVarredura`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const http = require('http');
const { descobrir } = require('../src/descoberta');

const RESPOSTA = JSON.stringify({ mac: 'b4:4c:3b:f4:e3:01', method: 'client.notifyDevInfo', params: { deviceInfo: { DeviceType: 'SS 3530 MF FACE W', HttpPort: 80, SerialNo: 'K3', IPv4Address: { IPAddress: '127.0.0.1', DhcpEnable: true } } } });
function dhip(json) {
  const c = Buffer.from(json); const h = Buffer.alloc(32);
  h.write('\x20\x00\x00\x00DHIP', 0, 'latin1'); h.writeUInt32LE(c.length, 16); h.writeUInt32LE(c.length, 24);
  return Buffer.concat([h, c]);
}

test('descobrir junta resposta DHIP e página Control iD', async () => {
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, r) => { if (msg.includes('DHDiscover')) udp.send(dhip(RESPOSTA), r.port, r.address); });
  await new Promise((ok) => udp.bind(0, '127.0.0.1', ok));
  const web = http.createServer((q, s) => { s.end('<title>Control iD</title>'); });
  await new Promise((ok) => web.listen(0, '127.0.0.1', ok));
  try {
    const achados = await descobrir({
      varredura: true,
      esperaMs: 800,
      destinos: [{ protocolo: 'dhip', host: '127.0.0.1', porta: udp.address().port }],
      hostsVarredura: [`127.0.0.1:${web.address().port}`],
    });
    const intel = achados.find((a) => a.fabricante === 'intelbras');
    assert.ok(intel, JSON.stringify(achados));
    assert.strictEqual(intel.mac, 'b4:4c:3b:f4:e3:01');
    const cid = achados.find((a) => a.fabricante === 'control_id');
    assert.ok(cid, JSON.stringify(achados));
    assert.strictEqual(cid.porta, web.address().port);
    assert.strictEqual(cid.validado_em_campo, false);
  } finally {
    udp.close(); web.close();
  }
});

test('sem varredura não faz HTTP; sem resposta devolve lista vazia sem lançar', async () => {
  const achados = await descobrir({ varredura: false, esperaMs: 300, destinos: [{ protocolo: 'dhip', host: '127.0.0.1', porta: 9 }] });
  assert.deepStrictEqual(achados, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test agent/test/descoberta-orquestrador.test.js`
Expected: FAIL — `Cannot find module '../src/descoberta'`.

- [ ] **Step 3: Implement `agent/src/descoberta/index.js`**

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test agent/test/descoberta-orquestrador.test.js` then `node --test agent/test/*.test.js`
Expected: PASS; suíte inteira verde.

- [ ] **Step 5: Commit**

```bash
git add agent/src/descoberta/index.js agent/test/descoberta-orquestrador.test.js
git commit -m "feat(agente): orquestrador da descoberta (UDP, varredura HTTP e ARP)"
```

---

### Task 3: Agente — agendamento, gatilhos e envio para a nuvem (+ harness)

**Files:**
- Create: `agent/src/descoberta/agendador.js`, `agent/test/descoberta-agendador.test.js`
- Modify: `agent/src/index.js` (modo condomínio, perto de `iniciarTelemetria` e do heartbeat ~linhas 266-375)
- Modify: `agent/harness/mock-device.js`, `agent/harness/run.js`

**Interfaces:**
- Consumes: `descobrir` (Task 2); `cloudRequest` de `agent/src/core/nuvem.js`; `lerTabelaArp` (Task 1).
- Produces:
  - `criarAgendador({ descobrir, enviar, agora = Date.now, intervaloLeveMs = 300000, minEntreVarredurasMs = 600000, offlineParaVarrerMs = 120000 })` → `{ tick({ pedidoDaNuvem: boolean, offlineDesde: Map<number, number> }): Promise<void> }`.
    - Faz descoberta **leve** (sem varredura) no primeiro `tick` e depois a cada `intervaloLeveMs`.
    - Faz descoberta **com varredura** quando `pedidoDaNuvem` é true, ou quando algum device está offline há mais de `offlineParaVarrerMs` — no máximo uma varredura por `minEntreVarredurasMs` (o pedido da nuvem ignora esse limite).
    - Nunca roda duas descobertas ao mesmo tempo (tick durante uma em curso é ignorado).
    - Depois de cada descoberta chama `enviar(achados)`.
  - Corpo enviado: `POST /api/facial/agent/condo/:token/descobertos` com `{ achados: Achado[], macs_cadastrados: [{ id: number, mac: string }] }` — `macs_cadastrados` = devices da lista atual que estão online no heartbeat (`lastDeviceOnline.get(id) === true`) e cujo IP aparece na tabela ARP.
  - Poll: `body.descobrir === true` vira `pedidoDaNuvem`.

- [ ] **Step 1: Write the failing test** — `agent/test/descoberta-agendador.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarAgendador } = require('../src/descoberta/agendador');

function montar() {
  let t = 1_000_000;
  const chamadas = [];
  const enviados = [];
  const ag = criarAgendador({
    descobrir: async (o) => { chamadas.push(o.varredura); return [{ ip: 'x' }]; },
    enviar: async (a) => { enviados.push(a); },
    agora: () => t,
  });
  return { ag, chamadas, enviados, avancar: (ms) => { t += ms; } };
}
const nada = { pedidoDaNuvem: false, offlineDesde: new Map() };

test('leve no primeiro tick e a cada 5 min; envia o resultado', async () => {
  const { ag, chamadas, enviados, avancar } = montar();
  await ag.tick(nada);
  await ag.tick(nada);
  avancar(300000);
  await ag.tick(nada);
  assert.deepStrictEqual(chamadas, [false, false]);
  assert.strictEqual(enviados.length, 2);
});

test('pedido da nuvem força varredura mesmo logo após outra', async () => {
  const { ag, chamadas } = montar();
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  assert.deepStrictEqual(chamadas, [true, true]);
});

test('device offline há mais de 2 min dispara varredura, no máximo 1 a cada 10 min', async () => {
  const { ag, chamadas, avancar } = montar();
  await ag.tick(nada); // leve inicial
  const offline = new Map([[7, 1_000_000]]);
  avancar(60000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // 1 min offline: nada
  avancar(90000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // 2,5 min: varre
  avancar(60000);
  await ag.tick({ pedidoDaNuvem: false, offlineDesde: offline }); // limite de 10 min
  assert.deepStrictEqual(chamadas, [false, true]);
});

test('não sobrepõe duas descobertas', async () => {
  let soltar;
  const chamadas = [];
  const ag = criarAgendador({
    descobrir: (o) => { chamadas.push(o.varredura); return new Promise((ok) => { soltar = () => ok([]); }); },
    enviar: async () => {},
  });
  const p = ag.tick(nada);
  await ag.tick({ pedidoDaNuvem: true, offlineDesde: new Map() });
  soltar();
  await p;
  assert.strictEqual(chamadas.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test agent/test/descoberta-agendador.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agent/src/descoberta/agendador.js`**

```js
'use strict';

/**
 * agent/src/descoberta/agendador.js — QUANDO descobrir (etapa 3):
 *  - leve (só multicast) na partida e a cada 5 min;
 *  - com varredura HTTP quando o portal pede ("Procurar na rede") ou quando
 *    um device cadastrado está offline há mais de 2 min (pode ter mudado de
 *    IP) — esta última no máximo 1 vez a cada 10 min (254 GETs por /24).
 * Uma descoberta por vez. `tick` é chamado a cada volta do poll de index.js.
 */

function criarAgendador({
  descobrir,
  enviar,
  agora = Date.now,
  intervaloLeveMs = 300000,
  minEntreVarredurasMs = 600000,
  offlineParaVarrerMs = 120000,
}) {
  let ultimaLeve = null;
  let ultimaVarredura = null;
  let emCurso = false;

  async function tick({ pedidoDaNuvem, offlineDesde }) {
    if (emCurso) return;
    const t = agora();
    const algumOfflineAntigo = [...offlineDesde.values()].some((desde) => t - desde > offlineParaVarrerMs);
    const podeVarrerPorOffline = ultimaVarredura == null || t - ultimaVarredura >= minEntreVarredurasMs;
    const varredura = pedidoDaNuvem || (algumOfflineAntigo && podeVarrerPorOffline);
    const leveVencida = ultimaLeve == null || t - ultimaLeve >= intervaloLeveMs;
    if (!varredura && !leveVencida) return;

    emCurso = true;
    try {
      ultimaLeve = t;
      if (varredura) ultimaVarredura = t;
      const achados = await descobrir({ varredura });
      await enviar(achados);
    } catch (err) {
      console.log(`[agente] descoberta: ${err.message || err}`);
    } finally {
      emCurso = false;
    }
  }

  return { tick };
}

module.exports = { criarAgendador };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test agent/test/descoberta-agendador.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into `agent/src/index.js` (modo condomínio)**

1. Requires no topo, junto dos outros `require('./core/...')`:

```js
const { descobrir } = require('./descoberta');
const { criarAgendador } = require('./descoberta/agendador');
const { lerTabelaArp } = require('./descoberta/arp');
```

2. Perto das outras constantes de `.env` (~linha 100), ler destinos de teste:

```js
// Só para o harness/testes: substitui o multicast real por destinos unicast
// ("dhip@127.0.0.1:47810,sadp@127.0.0.1:47020"). Vazio em produção.
const DESCOBERTA_DESTINOS = String(process.env.DESCOBERTA_DESTINOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [protocolo, resto] = s.split('@');
    const [host, porta] = String(resto || '').split(':');
    return { protocolo, host, porta: Number(porta) };
  })
  .filter((d) => d.host && d.porta);
```

3. Junto de `lastDeviceOnline` (~linha 122): `const offlineDesde = new Map(); // deviceId → quando ficou offline (ms)`.

4. No heartbeat, no bloco que detecta MUDANÇA de estado (`if (lastDeviceOnline.get(device.id) !== online)`), manter `offlineDesde`: se `online` → `offlineDesde.delete(device.id)`; se offline → `offlineDesde.set(device.id, Date.now())`. Também remover de `offlineDesde` os ids que saíram de `body.devices`.

5. Depois de `iniciarTelemetria(...)`, criar o agendador:

```js
  // Etapa 3: descoberta na rede. Só lê (sem senha). O MAC dos devices
  // cadastrados que estão online vai junto: é assim que a nuvem aprende o MAC
  // de quem foi cadastrado antes desta versão, para reencontrá-lo se o IP mudar.
  const agendadorDescoberta = criarAgendador({
    descobrir: (o) =>
      descobrir({ ...o, destinos: DESCOBERTA_DESTINOS.length ? DESCOBERTA_DESTINOS : undefined }),
    enviar: async (achados) => {
      const arp = await lerTabelaArp();
      const macs_cadastrados = lastDevices
        .filter((d) => lastDeviceOnline.get(d.id) === true && arp.has(d.ip))
        .map((d) => ({ id: d.id, mac: arp.get(d.ip) }));
      await cloudRequest('POST', `/api/facial/agent/condo/${token}/descobertos`, {
        achados,
        macs_cadastrados,
      }).catch((e) => console.error(`[agente] falha ao enviar descobertos: ${e.message || e}`));
    },
  });
```

6. No laço do poll, logo depois de `supervisor.atualizar(...)`, disparar sem bloquear o laço:

```js
      void agendadorDescoberta.tick({ pedidoDaNuvem: body.descobrir === true, offlineDesde });
```

- [ ] **Step 6: Harness — responder DHIP simulado e rota na nuvem simulada**

Em `agent/harness/mock-device.js`, exportar uma função nova e adicioná-la ao `module.exports`:

```js
const dgram = require('dgram');
/** Responde DHDiscover.search como o SS 3530 MF real (ver spec da etapa 3). */
function iniciarRespondedorDhip({ porta, ip, httpPorta, mac = 'b4:4c:3b:f4:e3:01', serie = 'K3LJ3400209RH' }) {
  const s = dgram.createSocket('udp4');
  s.on('message', (msg, r) => {
    if (!msg.includes('DHDiscover.search')) return;
    const json = Buffer.from(JSON.stringify({ mac, method: 'client.notifyDevInfo', params: { deviceInfo: {
      DeviceClass: 'BSC', DeviceType: 'SS 3530 MF FACE W', HttpPort: httpPorta, SerialNo: serie,
      Vendor: 'Intelbras', IPv4Address: { IPAddress: ip, DhcpEnable: true, SubnetMask: '255.255.255.0' } } } }));
    const h = Buffer.alloc(32);
    h.write('\x20\x00\x00\x00DHIP', 0, 'latin1'); h.writeUInt32LE(json.length, 16); h.writeUInt32LE(json.length, 24);
    s.send(Buffer.concat([h, json]), r.port, r.address);
  });
  s.bind(porta, '127.0.0.1');
  return s;
}
```

Em `agent/harness/run.js`:
- na nuvem simulada (`criarNuvem`, handler de `/poll` e rotas `condo/${TOKEN}/...`): guardar `const descobertos = [];` no escopo do módulo (como `telemetrias`); rota `POST /api/facial/agent/condo/${TOKEN}/descobertos` → `descobertos.push(body)` e `{ ok: true }`; o JSON do `/poll` passa a incluir `descobrir: pedirDescoberta` (variável de módulo, `let pedirDescoberta = false;`, zerada ao responder a primeira vez que for `true`);
- iniciar `iniciarRespondedorDhip({ porta: 47810, ip: '127.0.0.1', httpPorta: <porta do mock Dahua já usado no harness> })` e passar `DESCOBERTA_DESTINOS: 'dhip@127.0.0.1:47810'` no `env` com que o harness sobe o agente (mesmo lugar onde já passa `TELEMETRIA_INTERVAL_MS`);
- cenário novo, perto do cenário de telemetria:

```js
    // ===== Descoberta na rede (etapa 3) =====
    await sleep(3000);
    const comIntelbras = descobertos.find((d) => (d.achados || []).some((a) => a.mac === 'b4:4c:3b:f4:e3:01'));
    checar('descoberta: facial Intelbras simulado chegou à nuvem', !!comIntelbras, JSON.stringify(descobertos.slice(-1)));
    const antesPedido = descobertos.length;
    pedirDescoberta = true;
    await sleep(6000);
    checar('descoberta: "Procurar na rede" do portal gera nova descoberta', descobertos.length > antesPedido, String(descobertos.length));
```

- [ ] **Step 7: Run unit tests + harness**

Run: `node --test agent/test/*.test.js` then `cd agent && node harness/run.js`
Expected: todos PASS; harness com as duas verificações novas `PASS` e `0 falharam`.

- [ ] **Step 8: Commit**

```bash
git add agent/src/descoberta/agendador.js agent/test/descoberta-agendador.test.js agent/src/index.js agent/harness/mock-device.js agent/harness/run.js
git commit -m "feat(agente): agenda a descoberta e envia os aparelhos achados para a nuvem"
```

---

### Task 4: API — migração, `DescobertaService` e rota do agente (aprende MAC, corrige IP)

**Files:**
- Create: `prisma/manual_2026-09_facial_devices_mac.sql`
- Modify: `prisma/schema.prisma` (model `Facial_Devices`, após `porta`)
- Create: `apps/api/src/app/facial/descoberta.service.ts`, `apps/api/src/app/facial/descoberta.service.spec.ts`
- Modify: `apps/api/src/app/facial/agent.controller.ts` (poll + rota nova), `apps/api/src/app/facial/facial.module.ts` (provider), `apps/api/src/app/facial/facial.service.ts` (`CreateDeviceDto` + `createDevice` gravam `mac`/`numero_serie`)

**Interfaces:**
- Consumes: `PrismaService`, `AuditoriaService.registrar({ id_condominio, usuario_nome, acao, modulo, entidade_id, descricao, detalhes })` (mesmo uso de `tickFantasmas` em `facial.service.ts`).
- Produces (usado pela Task 5):
  - `DescobertaService.receber(idCondominio: number, corpo: unknown): Promise<{ ok: true; ips_corrigidos: number; macs_aprendidos: number }>`
  - `DescobertaService.listar(idCondominio: number): { recebido_em: string|null; achados: AchadoNuvem[]; avisos: AvisoIp[] }` onde `AchadoNuvem = Achado & { id_dispositivo: number|null }` e `AvisoIp = { id_dispositivo: number; nome: string; de: string; para: string; em: string }` (no máximo os 10 mais recentes, últimas 24 h).
  - `DescobertaService.pedirProcura(idCondominio: number): void` e `DescobertaService.consumirPedido(idCondominio: number): boolean` (true uma vez por pedido).
  - `export function sanitizarDescobertos(raw: unknown): { achados: Achado[]; macs_cadastrados: { id: number; mac: string }[] }`.

- [ ] **Step 1: SQL e schema**

`prisma/manual_2026-09_facial_devices_mac.sql`:

```sql
-- Etapa 3 do agente: identidade do aparelho para reencontrá-lo quando o IP muda (DHCP).
ALTER TABLE Facial_Devices
  ADD COLUMN mac VARCHAR(17) NULL AFTER porta,
  ADD COLUMN numero_serie VARCHAR(64) NULL AFTER mac,
  ADD INDEX idx_facdev_mac (mac);
```

Em `prisma/schema.prisma`, no `model Facial_Devices`, depois de `porta`:

```prisma
  // Identidade do aparelho na LAN (etapa 3 do agente): o agente reencontra o
  // aparelho pelo MAC quando o IP muda (DHCP) e a nuvem corrige o cadastro.
  mac                String?               @db.VarChar(17)
  numero_serie       String?               @db.VarChar(64)
```

e `@@index([mac], map: "idx_facdev_mac")` junto dos outros índices. Rodar `npx prisma generate --schema=prisma/schema.prisma` (não toca banco) para o client tipar os campos novos. **Não** rodar `db push`.

- [ ] **Step 2: Write the failing tests** — `apps/api/src/app/facial/descoberta.service.spec.ts`:

```ts
import { DescobertaService, sanitizarDescobertos } from './descoberta.service';

const achado = (o: Record<string, unknown> = {}) => ({
  mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras',
  modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true, ...o,
});

function montar(devices: any[]) {
  const prisma: any = {
    facial_Devices: {
      findMany: jest.fn(async ({ where }: any) => devices.filter((d) => d.id_condominio === where.id_condominio && d.ativo === 1)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(devices.find((d) => d.id === where.id), data)),
    },
  };
  const auditoria: any = { registrar: jest.fn(async () => undefined) };
  return { svc: new DescobertaService(prisma, auditoria), prisma, auditoria };
}

describe('sanitizarDescobertos', () => {
  it('descarta itens inválidos, normaliza MAC e limita a 200', () => {
    const r = sanitizarDescobertos({
      achados: [achado({ mac: 'B4-4C-3B-F4-E3-01' }), { ip: 'x' }, achado({ fabricante: 'outra' }), ...Array(300).fill(achado())],
      macs_cadastrados: [{ id: 1, mac: 'AA-BB-CC-DD-EE-FF' }, { id: 'x', mac: 'zz' }],
    });
    expect(r.achados[0].mac).toBe('b4:4c:3b:f4:e3:01');
    expect(r.achados.length).toBe(200);
    expect(r.achados.every((a) => ['intelbras', 'hikvision', 'control_id'].includes(a.fabricante))).toBe(true);
    expect(r.macs_cadastrados).toEqual([{ id: 1, mac: 'aa:bb:cc:dd:ee:ff' }]);
  });
  it('corpo lixo vira listas vazias', () => {
    expect(sanitizarDescobertos('oi')).toEqual({ achados: [], macs_cadastrados: [] });
  });
});

describe('DescobertaService', () => {
  it('aprende MAC e série do device cadastrado pelo IP e pelo macs_cadastrados', async () => {
    const devs = [
      { id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: null, numero_serie: null },
      { id: 2, id_condominio: 10, ativo: 1, nome: 'saída', ip: '192.168.3.180', porta: 80, mac: null, numero_serie: null },
    ];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado()], macs_cadastrados: [{ id: 2, mac: 'aa:bb:cc:dd:ee:ff' }] });
    expect(devs[0]).toMatchObject({ mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH' });
    expect(devs[1].mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(r.macs_aprendidos).toBe(2);
  });

  it('corrige o IP de quem mudou (mesmo MAC) e audita', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'facial principal', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH' }];
    const { svc, auditoria } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(devs[0].ip).toBe('192.168.3.60');
    expect(r.ips_corrigidos).toBe(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'DISPOSITIVO_IP_CORRIGIDO', id_condominio: 10, entidade_id: 1 }));
    expect(svc.listar(10).avisos[0]).toMatchObject({ id_dispositivo: 1, de: '192.168.3.175', para: '192.168.3.60' });
  });

  it('não mexe em device de outro condomínio com o mesmo MAC', async () => {
    const devs = [{ id: 9, id_condominio: 99, ativo: 1, nome: 'x', ip: '10.0.0.5', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: null }];
    const { svc, prisma } = montar(devs);
    await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    expect(devs[0].ip).toBe('10.0.0.5');
  });

  it('não corrige se outro device do condomínio já usa o IP novo', async () => {
    const devs = [
      { id: 1, id_condominio: 10, ativo: 1, nome: 'a', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: null },
      { id: 2, id_condominio: 10, ativo: 1, nome: 'b', ip: '192.168.3.60', porta: 80, mac: null, numero_serie: null },
    ];
    const { svc } = montar(devs);
    const r = await svc.receber(10, { achados: [achado({ ip: '192.168.3.60' })] });
    expect(r.ips_corrigidos).toBe(0);
    expect(devs[0].ip).toBe('192.168.3.175');
  });

  it('listar marca achados já cadastrados (por MAC ou IP)', async () => {
    const devs = [{ id: 1, id_condominio: 10, ativo: 1, nome: 'a', ip: '192.168.3.175', porta: 80, mac: null, numero_serie: null }];
    const { svc } = montar(devs);
    await svc.receber(10, { achados: [achado(), achado({ mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.3.99', fabricante: 'control_id', validado_em_campo: false })] });
    const l = svc.listar(10);
    expect(l.achados.find((a) => a.ip === '192.168.3.175')?.id_dispositivo).toBe(1);
    expect(l.achados.find((a) => a.ip === '192.168.3.99')?.id_dispositivo).toBeNull();
    expect(svc.listar(11).achados).toEqual([]);
  });

  it('pedido de procura é consumido uma vez', () => {
    const { svc } = montar([]);
    expect(svc.consumirPedido(10)).toBe(false);
    svc.pedirProcura(10);
    expect(svc.consumirPedido(10)).toBe(true);
    expect(svc.consumirPedido(10)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest apps/api/src/app/facial/descoberta.service.spec.ts`
Expected: FAIL — cannot find module `./descoberta.service`.

- [ ] **Step 4: Implement `apps/api/src/app/facial/descoberta.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

/**
 * Descoberta na rede (etapa 3 do agente). O agente acha aparelhos na LAN e
 * manda aqui (POST condo/:token/descobertos). Esta classe:
 *  - sanitiza (rota pública por token: corpo não confiável);
 *  - guarda a última lista por condomínio EM MEMÓRIA (como a telemetria:
 *    perder no restart é aceitável, volta em até 5 min);
 *  - aprende o MAC/série de devices cadastrados antes da etapa 3;
 *  - corrige o IP de um device cujo MAC apareceu em outro endereço (DHCP),
 *    sempre dentro do MESMO condomínio e com auditoria.
 */

const FABRICANTES = ['intelbras', 'hikvision', 'control_id'] as const;
const MAX_ACHADOS = 200;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export interface Achado {
  mac: string | null;
  ip: string;
  porta: number;
  fabricante: (typeof FABRICANTES)[number];
  modelo: string | null;
  numero_serie: string | null;
  dhcp: boolean | null;
  validado_em_campo: boolean;
}
export interface AchadoNuvem extends Achado {
  id_dispositivo: number | null;
}
export interface AvisoIp {
  id_dispositivo: number;
  nome: string;
  de: string;
  para: string;
  em: string;
}

function normalizarMac(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const hex = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12 || hex === '000000000000' || hex === 'ffffffffffff') return null;
  return hex.match(/../g)!.join(':');
}
function ipValido(s: unknown): s is string {
  const m = typeof s === 'string' ? s.match(IPV4) : null;
  return !!m && m.slice(1).every((p) => Number(p) <= 255);
}
function texto(s: unknown, max: number): string | null {
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;
}

export function sanitizarDescobertos(raw: unknown): {
  achados: Achado[];
  macs_cadastrados: { id: number; mac: string }[];
} {
  const corpo = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const achados: Achado[] = [];
  for (const a of Array.isArray(corpo['achados']) ? corpo['achados'] : []) {
    if (achados.length >= MAX_ACHADOS) break;
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    if (!ipValido(o['ip']) || !FABRICANTES.includes(o['fabricante'] as any)) continue;
    const porta = Number(o['porta']);
    achados.push({
      mac: normalizarMac(o['mac']),
      ip: o['ip'] as string,
      porta: Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : 80,
      fabricante: o['fabricante'] as Achado['fabricante'],
      modelo: texto(o['modelo'], 100),
      numero_serie: texto(o['numero_serie'], 64),
      dhcp: typeof o['dhcp'] === 'boolean' ? (o['dhcp'] as boolean) : null,
      validado_em_campo: o['validado_em_campo'] === true,
    });
  }
  const macs_cadastrados: { id: number; mac: string }[] = [];
  for (const m of Array.isArray(corpo['macs_cadastrados']) ? corpo['macs_cadastrados'].slice(0, MAX_ACHADOS) : []) {
    const id = Number((m as any)?.id);
    const mac = normalizarMac((m as any)?.mac);
    if (Number.isInteger(id) && id > 0 && mac) macs_cadastrados.push({ id, mac });
  }
  return { achados, macs_cadastrados };
}

@Injectable()
export class DescobertaService {
  private readonly logger = new Logger(DescobertaService.name);
  private readonly ultimos = new Map<number, { recebido_em: string; achados: Achado[] }>();
  private readonly avisos = new Map<number, AvisoIp[]>();
  private readonly pedidos = new Set<number>();
  /** Por condomínio, os devices (id, ip, mac) vistos na última recepção: `listar` marca `id_dispositivo` sem ir ao banco. */
  private readonly cadastrados = new Map<number, { id: number; ip: string; mac: string | null }[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async receber(idCondominio: number, corpo: unknown) {
    const { achados, macs_cadastrados } = sanitizarDescobertos(corpo);
    const devices: any[] = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    let macs_aprendidos = 0;
    let ips_corrigidos = 0;

    // 1) Aprende MAC de quem ainda não tem: pelo relato do agente (IP do
    //    cadastro respondeu e a ARP deu o MAC) ou por um achado no mesmo IP.
    for (const d of devices) {
      if (d.mac) continue;
      const doAgente = macs_cadastrados.find((m) => m.id === d.id)?.mac ?? null;
      const noIp = achados.find((a) => a.ip === d.ip && a.mac);
      const mac = doAgente ?? noIp?.mac ?? null;
      if (!mac || devices.some((o) => o.id !== d.id && o.mac === mac)) continue;
      const data: any = { mac };
      if (!d.numero_serie && noIp?.numero_serie) data.numero_serie = noIp.numero_serie;
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data });
      Object.assign(d, data);
      macs_aprendidos++;
    }

    // 2) Corrige IP: mesmo MAC, endereço diferente, IP novo livre no condomínio.
    for (const a of achados) {
      if (!a.mac) continue;
      const d = devices.find((x) => x.mac === a.mac);
      if (!d || (d.ip === a.ip && d.porta === a.porta)) continue;
      if (devices.some((o) => o.id !== d.id && o.ip === a.ip)) continue;
      const de = d.ip;
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data: { ip: a.ip, porta: a.porta } });
      d.ip = a.ip;
      d.porta = a.porta;
      ips_corrigidos++;
      const aviso: AvisoIp = { id_dispositivo: d.id, nome: d.nome, de, para: a.ip, em: new Date().toISOString() };
      this.avisos.set(idCondominio, [aviso, ...(this.avisos.get(idCondominio) ?? [])].slice(0, 10));
      this.logger.log(`IP do dispositivo ${d.id} corrigido de ${de} para ${a.ip} (MAC ${a.mac})`);
      await this.auditoria.registrar({
        id_condominio: idCondominio,
        usuario_nome: 'Sistema (descoberta na rede)',
        acao: 'DISPOSITIVO_IP_CORRIGIDO',
        modulo: 'facial-health',
        entidade_id: d.id,
        descricao: `IP do dispositivo "${d.nome}" atualizado de ${de} para ${a.ip} (mesmo MAC ${a.mac}).`,
        detalhes: { de, para: a.ip, mac: a.mac },
      });
    }

    this.ultimos.set(idCondominio, { recebido_em: new Date().toISOString(), achados });
    this.cadastrados.set(idCondominio, devices.map((d) => ({ id: d.id, ip: d.ip, mac: d.mac ?? null })));
    return { ok: true as const, ips_corrigidos, macs_aprendidos };
  }

  listar(idCondominio: number): { recebido_em: string | null; achados: AchadoNuvem[]; avisos: AvisoIp[] } {
    const u = this.ultimos.get(idCondominio);
    const devs = this.cadastrados.get(idCondominio) ?? [];
    const limite = Date.now() - 24 * 3600 * 1000;
    return {
      recebido_em: u?.recebido_em ?? null,
      achados: (u?.achados ?? []).map((a) => ({
        ...a,
        id_dispositivo: devs.find((d) => (a.mac && d.mac === a.mac) || d.ip === a.ip)?.id ?? null,
      })),
      avisos: (this.avisos.get(idCondominio) ?? []).filter((v) => Date.parse(v.em) >= limite),
    };
  }

  pedirProcura(idCondominio: number): void {
    this.pedidos.add(idCondominio);
  }

  consumirPedido(idCondominio: number): boolean {
    return this.pedidos.delete(idCondominio);
  }
}
```

- [ ] **Step 5: Wire the controller, module and DTO**

`facial.module.ts`: importar `DescobertaService` e adicioná-lo a `providers` e a `exports`.

`agent.controller.ts`: injetar `private readonly descoberta: DescobertaService` no construtor; em `condoPoll`, no `return`, acrescentar `descobrir: this.descoberta.consumirPedido(idCondominio)`; nova rota ao lado de `condoTelemetria`:

```ts
  /**
   * Descoberta na rede (etapa 3): aparelhos achados na LAN pelo agente + MAC
   * dos cadastrados que estão online. `body` é `unknown` de propósito (rota
   * pública por token) — `DescobertaService.receber` sanitiza.
   */
  @Public()
  @Post('condo/:token/descobertos')
  async condoDescobertos(@Param('token') token: string, @Body() body: unknown) {
    const idCondominio = await this.service.resolveCondominioForAgent(token);
    return this.descoberta.receber(idCondominio, body);
  }
```

Aplicar à rota o mesmo decorator de throttle que `condoTelemetria` usa (se ela tiver `@SkipThrottle()`, repetir).

`facial.service.ts`: em `CreateDeviceDto` acrescentar

```ts
  /** MAC/série vindos da descoberta na rede (etapa 3) — identidade para corrigir IP. */
  mac?: string | null;
  numero_serie?: string | null;
```

e, em `createDevice` (linha ~849), incluir `mac` (normalizado com a mesma regra: minúsculo com `:`, ou `null`) e `numero_serie` (trim, até 64) no `data` do `create`. Adicionar um teste ao spec de `createDevice` existente (procure `createDevice` em `apps/api/src/app/facial/*.spec.ts`; se não houver, criar `facial-create-device-mac.spec.ts` com o mesmo padrão de mock de Prisma dos specs vizinhos) verificando que `mac: 'B4-4C-3B-F4-E3-01'` é gravado como `'b4:4c:3b:f4:e3:01'`.

Adicionar teste em `agent.controller` spec existente (se houver `agent.controller.spec.ts`; senão, dentro de `descoberta.service.spec.ts` basta) — mínimo: `condoPoll` devolve `descobrir: true` uma vez após `pedirProcura`.

- [ ] **Step 6: Run to verify**

Run: `npx jest apps/api/src/app/facial --silent`
Expected: PASS, incluindo os novos.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/manual_2026-09_facial_devices_mac.sql apps/api/src/app/facial
git commit -m "feat(facial): recebe descobertos do agente, aprende MAC e corrige IP com auditoria"
```

---

### Task 5: API — rotas do portal (listar e procurar)

**Files:**
- Modify: `apps/api/src/app/facial/facial.controller.ts` (ao lado de `@Get('agent/saude')`, ~linha 308)
- Test: `apps/api/src/app/facial/facial-descobertos.controller.spec.ts` (novo)

**Interfaces:**
- Consumes: `DescobertaService.listar`, `DescobertaService.pedirProcura` (Task 4); `assertTenantStrict`, `assertOperador` de `../auth/tenant.util`.
- Produces: `GET /api/facial/descobertos?id_condominio=N` → retorno de `listar`; `POST /api/facial/descobertos/procurar?id_condominio=N` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test** — instanciar o controller com mocks (siga o padrão do spec do `agentSaude`: procure `agentSaude` em `apps/api/src/app/facial/*.spec.ts` e copie o jeito de construir o `FacialController` e o `JwtPayload`):

```ts
it('lista descobertos só para operador do próprio condomínio', async () => {
  const descoberta = { listar: jest.fn(() => ({ recebido_em: null, achados: [], avisos: [] })), pedirProcura: jest.fn() };
  const ctrl = construirController({ descoberta });          // helper do spec vizinho
  await expect(ctrl.descobertos(10, operadorDoCondominio(10))).resolves.toEqual({ recebido_em: null, achados: [], avisos: [] });
  await expect(ctrl.descobertos(10, operadorDoCondominio(11))).rejects.toThrow();
  await expect(ctrl.descobertos(10, moradorDoCondominio(10))).rejects.toThrow();
});

it('procurar marca o pedido do condomínio', async () => {
  const descoberta = { listar: jest.fn(), pedirProcura: jest.fn() };
  const ctrl = construirController({ descoberta });
  await expect(ctrl.procurarDescobertos(10, operadorDoCondominio(10))).resolves.toEqual({ ok: true });
  expect(descoberta.pedirProcura).toHaveBeenCalledWith(10);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/api/src/app/facial/facial-descobertos.controller.spec.ts`
Expected: FAIL — `ctrl.descobertos is not a function`.

- [ ] **Step 3: Implement** — injetar `DescobertaService` no `FacialController` e adicionar:

```ts
  /** Aparelhos achados na LAN pelo agente (etapa 3) + avisos de IP corrigido. Só operador. */
  @Get('descobertos')
  async descobertos(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(idCondominio, user, `aparelhos encontrados na rede do condomínio ${idCondominio}`);
    assertOperador(user, 'ver os aparelhos encontrados na rede');
    return this.descoberta.listar(idCondominio);
  }

  /** Pede ao agente uma descoberta completa (multicast + varredura) no próximo poll. */
  @Post('descobertos/procurar')
  async procurarDescobertos(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
  ) {
    assertTenantStrict(idCondominio, user, `procurar aparelhos na rede do condomínio ${idCondominio}`);
    assertOperador(user, 'procurar aparelhos na rede');
    this.descoberta.pedirProcura(idCondominio);
    return { ok: true };
  }
```

Atenção à ordem das rotas: declarar antes de qualquer `@Get(':id')` do controller para não ser capturada como id.

- [ ] **Step 4: Run to verify**

Run: `npx jest apps/api/src/app/facial --silent` and `npx nx build api`
Expected: PASS; build ok.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/facial/facial.controller.ts apps/api/src/app/facial/facial-descobertos.controller.spec.ts
git commit -m "feat(facial): rotas do portal para aparelhos encontrados na rede"
```

---

### Task 6: Portal — seção "Encontrados na rede", Cadastrar preenchido, Procurar e aviso de IP

**Files:**
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais.service.ts` (tipos + `descobertos()` + `procurarDescobertos()`; perto de `agentSaude()` ~linha 285, mesmo jeito de montar `params` com `id_condominio`)
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.component.ts` (signals + `abrirCadastroDe(achado)` + `procurarNaRede()` + carga periódica junto de `agentSaude`)
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.component.html` (seção nova logo abaixo do card do agente)
- Modify: `terminais-faciais-page.layout.spec.ts` e `terminais-faciais-page.telemetria.spec.ts` — acrescentar `descobertos: jest.fn(() => of({ recebido_em: null, achados: [], avisos: [] }))` e `procurarDescobertos: jest.fn(() => of({ ok: true }))` aos mocks do `TerminaisFaciaisApi`
- Test: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.descoberta.spec.ts` (novo)

**Interfaces:**
- Consumes: rotas da Task 5.
- Produces:
  - `export interface AparelhoEncontrado { mac: string|null; ip: string; porta: number; fabricante: 'intelbras'|'hikvision'|'control_id'; modelo: string|null; numero_serie: string|null; dhcp: boolean|null; validado_em_campo: boolean; id_dispositivo: number|null }`
  - `export interface AvisoIpCorrigido { id_dispositivo: number; nome: string; de: string; para: string; em: string }`
  - `TerminaisFaciaisApi.descobertos(): Observable<{ recebido_em: string|null; achados: AparelhoEncontrado[]; avisos: AvisoIpCorrigido[] }>`
  - `TerminaisFaciaisApi.procurarDescobertos(): Observable<{ ok: true }>`
  - componente: `descobertos = signal<{...}|null>(null)`, `procurando = signal(false)`, `abrirCadastroDe(a: AparelhoEncontrado)`, `procurarNaRede()`.
  - `CreateTerminalFacial` ganha `mac?: string|null; numero_serie?: string|null` e o `form` guarda os dois (preenchidos só pelo Cadastrar; `emptyForm()` com `null`).

- [ ] **Step 1: Write the failing test** — `terminais-faciais-page.descoberta.spec.ts` (mesma montagem do `layout.spec.ts`: `TestBed` com `TerminaisFaciaisApi` mockado e `AreasSociaisApi`):

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';
import { TerminaisFaciaisApi } from './terminais-faciais.service';
import { AreasSociaisApi } from '../areas-sociais/areas-sociais.service';

const achadoIntelbras = { mac: 'b4:4c:3b:f4:e3:01', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras', modelo: 'SS 3530 MF FACE W', numero_serie: 'K3LJ3400209RH', dhcp: true, validado_em_campo: true, id_dispositivo: null };
const achadoCid = { ...achadoIntelbras, mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.3.99', fabricante: 'control_id', modelo: null, numero_serie: null, validado_em_campo: false, id_dispositivo: 4 };

function build(extra: Record<string, unknown> = {}) {
  const api = {
    list: jest.fn(() => of([])),
    syncPessoas: jest.fn(() => of([])),
    syncStatus: jest.fn(() => of({ synced: 0, pending: 0, error: 0, semFoto: 0, running: false })),
    agentInfo: jest.fn(() => of({ agent_token: 't', download_url: null })),
    agentSaude: jest.fn(() => of(null)),
    health: jest.fn(() => of({ terminais: { total: 0, offline: [], semReporteRecente: [] }, agente: { online: true, lastSeenAt: null }, fantasmas: { ultimaVarreduraEm: null, removidosHoje: 0, eventosHoje: [] } })),
    descobertos: jest.fn(() => of({ recebido_em: new Date().toISOString(), achados: [achadoIntelbras, achadoCid], avisos: [{ id_dispositivo: 4, nome: 'facial principal', de: '192.168.3.50', para: '192.168.3.99', em: new Date().toISOString() }] })),
    procurarDescobertos: jest.fn(() => of({ ok: true })),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [TerminaisFaciaisPageComponent],
    providers: [{ provide: TerminaisFaciaisApi, useValue: api }, { provide: AreasSociaisApi, useValue: { listAreas: jest.fn(() => of([])) } }],
  });
  const f = TestBed.createComponent(TerminaisFaciaisPageComponent);
  f.detectChanges();
  return { f, tela: f.componentInstance, api };
}

describe('TerminaisFaciaisPageComponent — encontrados na rede', () => {
  it('mostra os achados, o selo de não validado e o aviso de IP corrigido', () => {
    const { f } = build();
    const txt = f.nativeElement.textContent as string;
    expect(txt).toContain('Encontrados na rede');
    expect(txt).toContain('SS 3530 MF FACE W');
    expect(txt).toContain('192.168.3.175');
    expect(txt).toContain('não validado em campo');
    expect(txt).toContain('já cadastrado');
    expect(txt).toContain('de 192.168.3.50 para 192.168.3.99');
  });

  it('Cadastrar abre o formulário preenchido e sem senha', () => {
    const { tela } = build();
    tela.abrirCadastroDe(achadoIntelbras as any);
    expect(tela.showModal()).toBe(true);
    expect(tela.editingId()).toBeNull();
    expect(tela.form).toMatchObject({ fabricante: 'intelbras', modelo: 'SS 3530 MF FACE W', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01', numero_serie: 'K3LJ3400209RH', api_password: '' });
  });

  it('Procurar na rede chama a API e marca "procurando"', () => {
    const { tela, api } = build();
    tela.procurarNaRede();
    expect(api.procurarDescobertos).toHaveBeenCalled();
    expect(tela.procurando()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test portaria-web -- terminais-faciais-page.descoberta`
Expected: FAIL — `tela.abrirCadastroDe is not a function` / texto ausente.

- [ ] **Step 3: Implement**

Serviço (`terminais-faciais.service.ts`), seguindo `agentSaude()`:

```ts
  descobertos(): Observable<{ recebido_em: string | null; achados: AparelhoEncontrado[]; avisos: AvisoIpCorrigido[] }> {
    const params = { id_condominio: String(this.idCondominio()) }; // use exatamente o mesmo jeito de agentSaude()
    return this.http.get<{ recebido_em: string | null; achados: AparelhoEncontrado[]; avisos: AvisoIpCorrigido[] }>(`${this.base}/descobertos`, { params });
  }

  procurarDescobertos(): Observable<{ ok: true }> {
    const params = { id_condominio: String(this.idCondominio()) };
    return this.http.post<{ ok: true }>(`${this.base}/descobertos/procurar`, {}, { params });
  }
```

(Se `agentSaude()` monta `params` de outro jeito, copie o jeito dele — não invente `idCondominio()`.)

Componente: `descobertos = signal<... | null>(null)`, `procurando = signal(false)`; carregar `this.api.descobertos()` no mesmo lugar/intervalo onde a página carrega `agentSaude()`; ao receber uma lista com `recebido_em` mais novo que o momento do clique em Procurar, `procurando.set(false)`. Métodos:

```ts
  abrirCadastroDe(a: AparelhoEncontrado) {
    this.editingId.set(null);
    this.form = {
      ...this.emptyForm(),
      tipo: 'facial',
      fabricante: a.fabricante,
      modelo: a.modelo ?? '',
      ip: a.ip,
      porta: a.porta,
      mac: a.mac,
      numero_serie: a.numero_serie,
    };
    this.showModal.set(true);
  }

  procurarNaRede() {
    this.procurando.set(true);
    this.procuraPedidaEm = Date.now();
    this.api.procurarDescobertos().subscribe({ error: () => this.procurando.set(false) });
  }
```

e no `payload` de salvar: `mac: this.form.mac ?? undefined, numero_serie: this.form.numero_serie ?? undefined`.

Template: seção logo abaixo do card do agente, no estilo visual dos cards vizinhos (reaproveite as classes do card de saúde do agente):

```html
<section class="card">
  <header>
    <h3>Encontrados na rede</h3>
    <button type="button" (click)="procurarNaRede()" [disabled]="procurando()">
      {{ procurando() ? 'Procurando…' : 'Procurar na rede' }}
    </button>
  </header>
  @for (v of descobertos()?.avisos ?? []; track v.em) {
    <p class="aviso">IP do {{ v.nome }} atualizado de {{ v.de }} para {{ v.para }} às {{ v.em | date: 'HH:mm' }}</p>
  }
  @if (!(descobertos()?.achados?.length)) {
    <p class="vazio">Nenhum aparelho encontrado ainda.</p>
  }
  @for (a of descobertos()?.achados ?? []; track a.mac ?? a.ip) {
    <div class="linha">
      <span>{{ a.fabricante === 'control_id' ? 'Control iD' : a.fabricante === 'hikvision' ? 'Hikvision' : 'Intelbras' }}</span>
      <span>{{ a.modelo || '—' }}</span>
      <span>{{ a.ip }}</span>
      @if (!a.validado_em_campo) { <span class="selo">não validado em campo</span> }
      @if (a.id_dispositivo) {
        <span class="ok">já cadastrado ✓</span>
      } @else {
        <button type="button" (click)="abrirCadastroDe(a)">Cadastrar</button>
      }
    </div>
  }
</section>
```

(Garanta `DatePipe` nos `imports` do componente standalone se ainda não estiver.)

Atualizar os mocks dos dois specs existentes (ver **Files**).

- [ ] **Step 4: Run to verify**

Run: `npx nx test portaria-web -- terminais-faciais` and `npx nx build portaria-web`
Expected: PASS; build ok.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/terminais-faciais
git commit -m "feat(portaria): aparelhos encontrados na rede, cadastro preenchido e aviso de IP corrigido"
```

---

## Depois das tarefas (controlador, não subagente)

2. Aplicar `prisma/sql/2026-09-24-facial-devices-mac.sql` pelo workflow "Database migration" (GitHub Actions, registra em `_schema_migrations`) **antes** do push (com aprovação do usuário) e verificar as colunas.
2. Aplicar `prisma/manual_2026-09_facial_devices_mac.sql` no RDS **antes** do push (com aprovação do usuário) e verificar as colunas.
3. Bump `agent/src/versao.js` → `2026.09.25` (ou `.N`), push master + main, build do exe (`cd agent && node build-exe.mjs`), release `agent-v<versão>` com aprovação.
4. Teste em campo: o facial Intelbras do usuário aparece como "já cadastrado ✓" e o MAC é aprendido; trocar o IP (reserva no roteador) e ver a correção.
