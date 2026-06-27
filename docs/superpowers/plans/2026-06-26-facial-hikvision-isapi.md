# Facial Hikvision (ISAPI) no nível do Intelbras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o terminal facial **Hikvision** (protocolo ISAPI) com TODAS as operações no mesmo nível do Intelbras: ping, abrir porta (já existe), cadastro de rosto, atualização, remoção e eventos de acesso — tanto no Agente Local quanto no modo direto do backend.

**Architecture:** Espelha exatamente a integração Intelbras. O `fabricante === 'hikvision'` ganha ramos próprios em cada operação do agente (`agent/index.js`) e do cliente direto (`facial-device-client.service.ts`). A nuvem **não muda**: o agente já repassa eventos para `POST /api/facial/agent/condo/:token/event` com `external_id`, e o `facial.service.ts` resolve a pessoa por esse id (ex.: `morador_42`) — Hikvision reusa o mesmo caminho. A autenticação Digest já é tratada em `request()` (agente) e `send()` (backend).

**Tech Stack:** Node nativo (agente, sem libs), NestJS + axios (backend), ISAPI do Hikvision (XML/JSON + multipart para foto, alertStream para eventos), auth Digest.

**Convenção-chave (igual Intelbras):** o `UserID` no aparelho = o nosso `externalId` (`morador_<id>` / `visitante_<id>`). No Hikvision esse campo chama **`employeeNo`**. O evento de reconhecimento devolve `employeeNoString` = o mesmo valor → a nuvem resolve a pessoa. Assim nada muda no backend de resolução.

**Referências ISAPI (validar contra o manual do modelo antes do go-live — firmware varia):**
- Ping/identidade: `GET /ISAPI/System/deviceInfo`
- Abrir porta (JÁ IMPLEMENTADO): `PUT /ISAPI/AccessControl/RemoteControl/door/1` (XML)
- Criar usuário: `POST /ISAPI/AccessControl/UserInfo/Record?format=json`
- Atualizar usuário: `PUT /ISAPI/AccessControl/UserInfo/Modify?format=json`
- Remover usuário: `PUT /ISAPI/AccessControl/UserInfo/Delete?format=json`
- Cadastrar rosto: `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json` (multipart: parte JSON + parte JPEG)
- Remover rosto: `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD` com `{ "FPID": [{ "value": "<employeeNo>" }] }`
- Eventos: `GET /ISAPI/Event/notification/alertStream` (stream multipart; evento `AccessControllerEvent.employeeNoString`)

---

### Task 1: Agente — ping do Hikvision (ISAPI deviceInfo)

Hoje `doPing` cai no genérico `GET /status` para Hikvision, que não existe no aparelho. Trocar por `GET /ISAPI/System/deviceInfo` (Digest já tratado em `lanRequest`).

**Files:**
- Modify: `click-cond-web/agent/index.js` (função `doPing`, ramo após `intelbras`)

- [ ] **Step 1: Adicionar o ramo hikvision no doPing**

Em `agent/index.js`, dentro de `doPing(device)`, logo após o bloco `if (device.fabricante === 'intelbras') { ... }` e ANTES do `const res = await lanRequest(device, 'GET', '/status');`:

```js
  if (device.fabricante === 'hikvision') {
    // ISAPI: deviceInfo prova rede + credencial (Digest tratado em request()).
    const res = await lanRequest(device, 'GET', '/ISAPI/System/deviceInfo');
    return { ok: res.status >= 200 && res.status < 300, statusCode: res.status };
  }
```

- [ ] **Step 2: Sintaxe**

Run: `cd click-cond-web && node --check agent/index.js`
Expected: sem erro (imprime nada).

- [ ] **Step 3: Commit**

```bash
git add click-cond-web/agent/index.js
git commit -m "feat(agent): ping do Hikvision via ISAPI deviceInfo"
```

---

### Task 2: Agente — suporte a multipart no request() (necessário para a foto)

O `FaceDataRecord` do Hikvision exige `multipart/form-data` (uma parte JSON + uma parte JPEG). O `request()` atual só faz json/xml/binary e SEMPRE sobrescreve o `Content-Type`. Precisamos: (a) um helper que monta o corpo multipart, e (b) o `request()` respeitar um `Content-Type` já definido em `opts.headers`.

**Files:**
- Modify: `click-cond-web/agent/index.js` (função `request()`; adicionar helper `buildMultipart`)

- [ ] **Step 1: request() não sobrescreve Content-Type pré-definido**

Em `agent/index.js`, dentro de `request()`, achar o bloco que define o payload/headers:

```js
    let payload;
    if (opts.json !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.json));
      headers['Content-Type'] = 'application/json';
    } else if (opts.xml !== undefined) {
      payload = Buffer.from(opts.xml);
      headers['Content-Type'] = 'application/xml';
    } else if (opts.binary !== undefined) {
      payload = opts.binary;
      headers['Content-Type'] = 'application/octet-stream';
    }
    if (payload) headers['Content-Length'] = payload.length;
```

Substituir por (só seta Content-Type se ainda não veio em opts.headers):

```js
    let payload;
    if (opts.json !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.json));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (opts.xml !== undefined) {
      payload = Buffer.from(opts.xml);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml';
    } else if (opts.binary !== undefined) {
      payload = opts.binary;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream';
    }
    if (payload) headers['Content-Length'] = payload.length;
```

- [ ] **Step 2: Helper buildMultipart (adicionar perto de okFrom)**

Em `agent/index.js`, adicionar a função:

```js
/**
 * Monta um corpo multipart/form-data. parts = [{ name, json } | { name, jpeg, filename }].
 * Devolve { body: Buffer, contentType }. Usado no cadastro de rosto do Hikvision.
 */
function buildMultipart(parts) {
  const boundary = '----clickbnd' + crypto.randomBytes(8).toString('hex');
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.json !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"\r\nContent-Type: application/json\r\n\r\n`,
        ),
      );
      chunks.push(Buffer.from(JSON.stringify(p.json)));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename || 'face.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
      );
      chunks.push(p.jpeg);
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
```

- [ ] **Step 3: Sintaxe**

Run: `cd click-cond-web && node --check agent/index.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/agent/index.js
git commit -m "feat(agent): suporte a multipart no request() + helper buildMultipart (p/ Hikvision)"
```

---

### Task 3: Agente — cadastro/atualização de rosto do Hikvision

Espelha `dahuaEnroll`: cria/atualiza o usuário e sobe a foto. `employeeNo = externalId`. ValidFrom/ValidTo (Hikvision usa `Valid.beginTime`/`endTime` em ISO 8601) seguem `cmd.validFrom`/`cmd.validTo` (já enviados pela nuvem; default permanente).

**Files:**
- Modify: `click-cond-web/agent/index.js` (função `doEnroll`, ramo após `intelbras`; adicionar `hikvisionEnroll`)

- [ ] **Step 1: Rotear hikvision no doEnroll**

Em `doEnroll(device, cmd)`, logo após `if (device.fabricante === 'intelbras') { return dahuaEnroll(device, cmd); }`:

```js
  if (device.fabricante === 'hikvision') {
    return hikvisionEnroll(device, cmd);
  }
```

- [ ] **Step 2: Implementar hikvisionEnroll (adicionar após dahuaEnroll)**

```js
/** Hikvision ISAPI: cria/atualiza o usuário e sobe o rosto. employeeNo = externalId. */
async function hikvisionEnroll(device, cmd) {
  const employeeNo = String(cmd.externalId || cmd.faceId);
  const nome = cmd.nome || employeeNo;
  // Hikvision quer ISO 8601 local; default permanente. Converte "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS".
  const toIso = (s, fb) => (s ? s.replace(' ', 'T') : fb);
  const beginTime = toIso(cmd.validFrom, '2000-01-01T00:00:00');
  const endTime = toIso(cmd.validTo, '2037-12-31T23:59:59');

  const userBody = {
    UserInfo: [
      {
        employeeNo,
        name: nome,
        userType: 'normal',
        Valid: { enable: true, beginTime, endTime, timeType: 'local' },
        doorRight: '1',
        RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
      },
    ],
  };
  // Cria; se já existir, o aparelho devolve erro → cai para Modify.
  let u = await lanRequest(
    device,
    'POST',
    '/ISAPI/AccessControl/UserInfo/Record?format=json',
    { json: userBody },
  );
  if (!(u.status >= 200 && u.status < 300) || /error|fail/i.test(String(u.raw || ''))) {
    u = await lanRequest(
      device,
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Modify?format=json',
      { json: userBody },
    );
  }
  if (!(u.status >= 200 && u.status < 300)) {
    return { ok: false, statusCode: u.status, error: `usuário: ${String(u.raw || '').slice(0, 120)}` };
  }

  if (cmd.fotoBase64) {
    const jpeg = Buffer.from(cmd.fotoBase64, 'base64');
    const mp = buildMultipart([
      { name: 'FaceDataRecord', json: { faceLibType: 'blackFD', FDID: '1', FPID: employeeNo } },
      { name: 'img', jpeg, filename: 'face.jpg' },
    ]);
    const f = await lanRequest(
      device,
      'POST',
      '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
      { binary: mp.body, headers: { 'Content-Type': mp.contentType } },
    );
    if (!(f.status >= 200 && f.status < 300) || /error|fail/i.test(String(f.raw || ''))) {
      return { ok: false, statusCode: f.status, error: `rosto recusado: ${String(f.raw || '').slice(0, 120)}`, faceId: employeeNo };
    }
  }
  return { ok: true, faceId: employeeNo };
}
```

- [ ] **Step 3: Sintaxe**

Run: `cd click-cond-web && node --check agent/index.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/agent/index.js
git commit -m "feat(agent): cadastro/atualização de rosto do Hikvision (ISAPI UserInfo + FaceDataRecord)"
```

---

### Task 4: Agente — remoção do Hikvision (usuário + rosto)

**Files:**
- Modify: `click-cond-web/agent/index.js` (função `doRemove`, ramo após `intelbras`)

- [ ] **Step 1: Rotear hikvision no doRemove**

Em `doRemove(device, cmd)`, logo após o bloco `if (device.fabricante === 'intelbras') { ... }`:

```js
  if (device.fabricante === 'hikvision') {
    const employeeNo = String(cmd.faceId);
    // Remove o rosto da FDLib.
    await lanRequest(
      device,
      'PUT',
      '/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD',
      { json: { FPID: [{ value: employeeNo }] } },
    ).catch(() => undefined);
    // Remove o usuário.
    const res = await lanRequest(
      device,
      'PUT',
      '/ISAPI/AccessControl/UserInfo/Delete?format=json',
      { json: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } } },
    );
    return okFrom(res);
  }
```

- [ ] **Step 2: Sintaxe**

Run: `cd click-cond-web && node --check agent/index.js`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add click-cond-web/agent/index.js
git commit -m "feat(agent): remoção do Hikvision (ISAPI FDLib + UserInfo Delete)"
```

---

### Task 5: Agente — eventos de acesso do Hikvision (alertStream → nuvem)

Espelha `startDahuaEventListener`/`dahuaAttachOnce`: assina `GET /ISAPI/Event/notification/alertStream` (stream multipart, Digest), extrai os blocos `AccessControllerEvent` com `employeeNoString` e repassa para a nuvem via `forwardAccessEvent` (que já existe e já faz debounce + POST `/event`).

**Files:**
- Modify: `click-cond-web/agent/index.js` (no `runCondoLoop`, iniciar o listener; adicionar `startHikvisionEventListener` + `hikvisionAlertOnce` + `consumeHikvisionEvents`)

- [ ] **Step 1: Iniciar o listener no loop do condomínio**

Em `runCondoLoop`, achar o bloco que inicia o listener do Intelbras:

```js
        if (device.fabricante === 'intelbras') {
          startDahuaEventListener(token, device);
        }
```

Adicionar logo abaixo:

```js
        if (device.fabricante === 'hikvision') {
          startHikvisionEventListener(token, device);
        }
```

- [ ] **Step 2: Implementar o listener (adicionar após o bloco Dahua de eventos)**

```js
// ---------- Hikvision: stream de eventos de acesso → nuvem ----------
const hikListeners = new Set();

function startHikvisionEventListener(token, device) {
  if (hikListeners.has(device.id)) return;
  hikListeners.add(device.id);
  console.log(`[agente] ${device.nome}: assinando eventos de acesso (Hikvision)`);
  (async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await hikvisionAlertOnce(token, device);
      } catch (err) {
        console.error(
          `[agente] ${device.nome}: stream Hikvision caiu (${err.message || err}); reabrindo em 5s`,
        );
      }
      await sleep(5000);
    }
  })();
}

/** Abre UMA conexão alertStream (Digest) e processa enquanto o aparelho mantém. */
function hikvisionAlertOnce(token, device) {
  return new Promise((resolve, reject) => {
    const user = device.api_user || 'admin';
    const pass = device.api_password || 'admin';
    const path = '/ISAPI/Event/notification/alertStream';
    const challenge = http.request(
      { host: device.ip, port: device.porta, path, method: 'GET' },
      (cres) => {
        cres.resume();
        if (cres.statusCode !== 401) return reject(new Error(`desafio inesperado: HTTP ${cres.statusCode}`));
        const wa = cres.headers['www-authenticate'] || '';
        if (!/digest/i.test(wa)) return reject(new Error('aparelho não pediu Digest'));
        const auth = buildDigestHeader(user, pass, 'GET', path, wa);
        const stream = http.request(
          { host: device.ip, port: device.porta, path, method: 'GET', headers: { Authorization: auth } },
          (sres) => {
            if (sres.statusCode !== 200) { sres.resume(); return reject(new Error(`alertStream HTTP ${sres.statusCode}`)); }
            let buf = '';
            sres.setEncoding('utf8');
            sres.on('data', (chunk) => {
              buf += chunk;
              buf = consumeHikvisionEvents(buf, (data) => forwardAccessEvent(token, device, data));
              if (buf.length > 1_000_000) buf = buf.slice(-100_000);
            });
            sres.on('end', resolve);
            sres.on('error', reject);
          },
        );
        stream.on('error', reject);
        stream.setTimeout(0);
        stream.end();
      },
    );
    challenge.on('error', reject);
    challenge.setTimeout(LAN_TIMEOUT_MS, () => challenge.destroy(new Error('timeout no desafio')));
    challenge.end();
  });
}

/**
 * Extrai eventos AccessControllerEvent completos do buffer e os normaliza para o
 * formato que forwardAccessEvent espera ({ UserID, Similarity }). Hikvision usa
 * employeeNoString (= nosso external_id) e currentVerifyMode/faceRect.
 */
function consumeHikvisionEvents(buf, onData) {
  // O alertStream entrega blocos separados por boundary "--MIME_boundary".
  const parts = buf.split('--MIME_boundary');
  const tail = parts.pop();
  for (const part of parts) {
    if (!part.includes('AccessControllerEvent')) continue;
    const i = part.indexOf('{');
    if (i < 0) continue;
    try {
      const json = JSON.parse(part.slice(i));
      const ev = json.AccessControllerEvent || {};
      const emp = ev.employeeNoString;
      // major/minor 5/75 = face autenticada com sucesso (varia por firmware;
      // tratamos "tem employeeNo" como reconhecido). Sem employeeNo = ignora.
      if (emp) onData({ UserID: String(emp), Similarity: ev.similarity ?? 90 });
    } catch {
      /* parcial/inválido — ignora */
    }
  }
  return tail;
}
```

- [ ] **Step 3: Sintaxe**

Run: `cd click-cond-web && node --check agent/index.js`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add click-cond-web/agent/index.js
git commit -m "feat(agent): eventos de acesso do Hikvision (alertStream → /event)"
```

---

### Task 6: Backend (modo direto) — espelhar ping/enroll/update/remove do Hikvision

Mantém o cliente direto (`FacialDeviceClientService`, usado quando NÃO há agente online) em sincronia. O `send()` já faz Digest. A foto usa multipart (helper local).

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial-device-client.service.ts`

- [ ] **Step 1: ping do Hikvision**

Em `ping()`, logo após o bloco `if (device.fabricante === 'intelbras') { ... }` e antes do `const res = await this.send(device, 'GET', '/status');`:

```ts
      if (device.fabricante === 'hikvision') {
        const r = await this.send(device, 'GET', '/ISAPI/System/deviceInfo');
        return r.status >= 200 && r.status < 300;
      }
```

- [ ] **Step 2: Helper de multipart na classe**

Adicionar como método privado:

```ts
  private buildMultipart(
    parts: ({ name: string; json: unknown } | { name: string; jpeg: Buffer; filename?: string })[],
  ): { body: Buffer; contentType: string } {
    const boundary = '----clickbnd' + crypto.randomBytes(8).toString('hex');
    const chunks: Buffer[] = [];
    for (const p of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      if ('json' in p) {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\nContent-Type: application/json\r\n\r\n`));
        chunks.push(Buffer.from(JSON.stringify(p.json)));
      } else {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename || 'face.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`));
        chunks.push(p.jpeg);
      }
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }
```

- [ ] **Step 3: enroll/update do Hikvision em enrollPerson e updatePerson**

Em `enrollPerson()`, após o ramo `if (device.fabricante === 'intelbras') { ... }`:

```ts
    if (device.fabricante === 'hikvision') {
      const employeeNo = String(payload.externalId);
      await this.hikvisionUpsertUser(device, employeeNo, payload.nome, payload.validFrom, payload.validTo);
      if (payload.fotoBase64) await this.hikvisionSetFace(device, employeeNo, payload.fotoBase64);
      return { faceId: employeeNo };
    }
```

Em `updatePerson()`, após o ramo intelbras:

```ts
    if (device.fabricante === 'hikvision') {
      const employeeNo = String(faceId);
      await this.hikvisionUpsertUser(device, employeeNo, payload.nome ?? employeeNo, payload.validFrom, payload.validTo);
      if (payload.fotoBase64 !== undefined) await this.hikvisionSetFace(device, employeeNo, payload.fotoBase64);
      return;
    }
```

- [ ] **Step 4: Métodos hikvisionUpsertUser e hikvisionSetFace (perto dos dahua*)**

```ts
  private async hikvisionUpsertUser(
    device: FacialDeviceConfig,
    employeeNo: string,
    nome?: string,
    validFrom?: string,
    validTo?: string,
  ): Promise<void> {
    const toIso = (s?: string, fb?: string) => (s ? s.replace(' ', 'T') : fb);
    const body = {
      UserInfo: [
        {
          employeeNo,
          name: nome || employeeNo,
          userType: 'normal',
          Valid: {
            enable: true,
            beginTime: toIso(validFrom, '2000-01-01T00:00:00'),
            endTime: toIso(validTo, '2037-12-31T23:59:59'),
            timeType: 'local',
          },
          doorRight: '1',
          RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
        },
      ],
    };
    let r = await this.send(device, 'POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', body, 'application/json');
    if (!(r.status >= 200 && r.status < 300) || /error|fail/i.test(String(r.data ?? ''))) {
      r = await this.send(device, 'PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', body, 'application/json');
    }
    if (!(r.status >= 200 && r.status < 300)) {
      throw new Error(`Hikvision: falha ao gravar usuário (HTTP ${r.status})`);
    }
  }

  private async hikvisionSetFace(device: FacialDeviceConfig, employeeNo: string, fotoBase64: string): Promise<void> {
    const mp = this.buildMultipart([
      { name: 'FaceDataRecord', json: { faceLibType: 'blackFD', FDID: '1', FPID: employeeNo } },
      { name: 'img', jpeg: Buffer.from(fotoBase64, 'base64'), filename: 'face.jpg' },
    ]);
    const r = await this.send(device, 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', mp.body, mp.contentType);
    if (!(r.status >= 200 && r.status < 300) || /error|fail/i.test(String(r.data ?? ''))) {
      throw new Error(`Hikvision: rosto recusado (HTTP ${r.status})`);
    }
  }
```

- [ ] **Step 5: removePerson do Hikvision**

Em `removePerson()`, dentro do `try`, após o ramo `if (device.fabricante === 'intelbras') { ... }`:

```ts
      if (device.fabricante === 'hikvision') {
        const employeeNo = String(faceId);
        await this.send(device, 'PUT', '/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD', { FPID: [{ value: employeeNo }] }, 'application/json').catch(() => undefined);
        await this.send(device, 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }, 'application/json');
        return;
      }
```

- [ ] **Step 6: Garantir `import * as crypto from 'crypto';` no topo**

Verificar o topo de `facial-device-client.service.ts`. Se não houver, adicionar:

```ts
import * as crypto from 'crypto';
```

(O arquivo já usa `crypto` no `md5` do Digest, então provavelmente já está importado — confirmar.)

- [ ] **Step 7: Build da API**

Run: `cd click-cond-web && npx nx build api --skip-nx-cache`
Expected: `Successfully ran target build for project @org/api`.

- [ ] **Step 8: Commit**

```bash
git add click-cond-web/apps/api/src/app/facial/facial-device-client.service.ts
git commit -m "feat(facial): modo direto do Hikvision (ISAPI ping/enroll/update/remove)"
```

---

### Task 7: Build geral, deploy e checklist de validação ao vivo

Sem um Hikvision físico aqui, fica "implementado, a validar" (igual Control iD). O checklist é o roteiro de validação quando houver um aparelho.

**Files:** nenhum (build + deploy + checklist).

- [ ] **Step 1: Build do agente e da API**

Run: `cd click-cond-web && node --check agent/index.js && npx nx build api --skip-nx-cache`
Expected: agente sem erro + build da API OK.

- [ ] **Step 2: Push (Railway + main)**

Run: `git push origin HEAD:master && git push origin main`
Expected: push OK nas duas branches.

- [ ] **Step 3: Rebuild do .exe do agente (produção)**

Run: `cd click-cond-web/agent && node build-exe.mjs`
Expected: `✅ Gerado: click-agent.exe`. Publicar o novo .exe no GitHub Release `agent-v1.0.0` (asset `click-agent.exe`, clobber) — mesmo procedimento do Intelbras.

- [ ] **Step 4: Checklist de validação com um Hikvision real**

1. Cadastrar um terminal `fabricante=hikvision`, IP/porta (80 ou 443), `api_user`/`api_password` do aparelho.
2. **Testar Conexão** → deve ficar ONLINE (ping ISAPI deviceInfo).
3. **Sincronizar rostos** de um morador com foto → conferir no aparelho que o usuário (`employeeNo = morador_<id>`) e o rosto foram criados (se der "rosto recusado", a foto precisa ser um retrato nítido — mesma regra do Intelbras).
4. Mostrar o rosto no aparelho → o **dashboard** deve registrar a entrada (evento `AccessControllerEvent.employeeNoString` → `/event` → resolve a pessoa).
5. **Abrir porta** pelo portal (já funcionava) → relé aciona.
6. **Remover** a foto do morador → conferir que o usuário some do aparelho.
7. Ajustar nomes de campos ISAPI que o firmware específico recusar (ver "Referências ISAPI" no topo — `FDID`, `faceLibType`, nome da parte da imagem `img` vs `FaceImage` variam).

---

## Notas

- **Nuvem inalterada:** o agente reusa `POST /api/facial/agent/condo/:token/event` (com `external_id = employeeNo`) e o `facial.service.ts` resolve a pessoa por `morador_<id>`/`visitante_<id>` — exatamente como no Intelbras. A janela de validade (`validFrom/validTo`) já chega no comando de enroll e vira `Valid.beginTime/endTime` no aparelho.
- **Abrir porta:** já estava implementado (ISAPI RemoteControl) no agente e no `relayEndpoints` do backend — não precisa mexer.
- **Sem harness de teste no agente:** segue o padrão do projeto (a integração Intelbras também não tem testes unitários; validação é `node --check` + bancada). O multipart e o parser de eventos poderiam ganhar testes Jest no backend numa etapa futura, se o time quiser.
- **Risco de firmware:** ISAPI varia entre modelos/versões. Os nomes de campo (`FDID`, `faceLibType: 'blackFD'`, parte `img`, `planTemplateNo`) podem precisar de ajuste contra o manual do modelo — por isso o status final é "implementado, a validar ao vivo".
