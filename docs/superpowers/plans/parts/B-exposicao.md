## B — Exposição de segredos, SSRF, XSS e agente local

> Todos os caminhos são relativos a `C:/w/sec`. Os arquivos do repo usam **CRLF** (`agent/*.bat`, `agent/src/**/*.js`, a maior parte de `apps/api`); preserve o terminador de linha do arquivo ao editar. `apps/portaria-web/.../encomendas-page.component.ts` é LF.
> Suíte que já falha antes e deve ser ignorada: `apps/api/src/app/auth/meus-eventos-entrada-manual.spec.ts`.

---

### Task B1: Filtro de estáticos compara o caminho decodificado e a credencial do Firebase sai da pasta servida

Fingerprint: `api-main-static-deny-filter-percent-encoding-bypass-firebase-sa`

O `main.ts` testa as regex contra `req.path` (ainda percent-encoded), mas o `serve-static`/`send` decodifica antes de abrir o arquivo: `GET /firebase-service%2Daccount.jso%6E` passa no filtro e serve `assets/firebase-service-account.json`. Além disso o `NotificationsService` ainda lê a credencial de `__dirname/assets/`, justamente a pasta pública. Correção: (a) o filtro decodifica antes de comparar (e recusa codificação inválida); (b) a credencial só vem de `FIREBASE_SERVICE_ACCOUNT_JSON` (produção já usa) ou de `FIREBASE_SERVICE_ACCOUNT_PATH` apontando para fora de `assets/`.

**Atenção para o dono:** quem roda a API localmente com `apps/api/src/assets/firebase-service-account.json` precisa mover o arquivo para fora de `src/assets` e definir `FIREBASE_SERVICE_ACCOUNT_PATH=<caminho absoluto>` no `.env` (ou usar `FIREBASE_SERVICE_ACCOUNT_JSON`). Produção (EB) já usa `FIREBASE_SERVICE_ACCOUNT_JSON` e não muda. Se algum pacote local (`deploy-api-aws.zip`, `eb-package/`) com a chave já foi enviado ao EB, a chave precisa ser rotacionada no console do Firebase — isso não é resolvido por código.

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/assets-estaticos.util.ts`
- Create: `click-cond-web/apps/api/src/app/common/assets-estaticos.util.spec.ts`
- Create: `click-cond-web/apps/api/src/app/notifications/notifications.credencial.spec.ts`
- Modify: `click-cond-web/apps/api/src/main.ts:86-96`
- Modify: `click-cond-web/apps/api/src/app/notifications/notifications.service.ts:35-46`

**Interfaces:**
- Consumes: nada de outras tasks.
- Produces: `caminhoEstaticoBloqueado(caminho: string | undefined): boolean` em `apps/api/src/app/common/assets-estaticos.util.ts`; env nova `FIREBASE_SERVICE_ACCOUNT_PATH` (caminho absoluto, fora de `dist/assets`). A Task B2 depende de o fallback `assets/firebase-service-account.json` não existir mais.

- [ ] **Step 1: Write the failing tests**

`click-cond-web/apps/api/src/app/common/assets-estaticos.util.spec.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { caminhoEstaticoBloqueado } from './assets-estaticos.util';

/**
 * main.ts serve dist/assets na raiz do site. O send (serve-static) DECODIFICA o
 * caminho antes de abrir o arquivo; o filtro testava o caminho cru, então
 * '/firebase-service%2Daccount.jso%6E' passava e baixava a chave do Firebase.
 */
describe('caminhoEstaticoBloqueado — compara o caminho decodificado', () => {
  it.each([
    '/firebase-service-account.json',
    '/firebase-service%2Daccount.jso%6E',
    '/firebase-service-account%2Ejson',
    '/%66irebase-service-account.json',
    '/qualquer.%4A%53%4F%4E',
    '/sub/..%2Ffirebase-service-account.json',
    '/%E0%A4%A', // percent-encoding malformado: o send devolveria 400; aqui é recusado
  ])('bloqueia %s', (p) => expect(caminhoEstaticoBloqueado(p)).toBe(true));

  it.each(['/simulator.html', '/simulador-acesso.html', '/api/facial/devices', '/', undefined])(
    'libera %s',
    (p) => expect(caminhoEstaticoBloqueado(p as any)).toBe(false),
  );

  it('main.ts usa o filtro decodificado antes do useStaticAssets', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'main.ts'), 'utf8');
    const idxFiltro = main.indexOf('caminhoEstaticoBloqueado(req.path)');
    const idxStatic = main.indexOf("app.useStaticAssets(join(__dirname, 'assets'))");
    expect(idxFiltro).toBeGreaterThan(-1);
    expect(idxStatic).toBeGreaterThan(idxFiltro);
  });
});
```

`click-cond-web/apps/api/src/app/notifications/notifications.credencial.spec.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn((c: any) => ({ cert: c })) },
  messaging: jest.fn(),
}));

import * as admin from 'firebase-admin';
import { NotificationsService } from './notifications.service';

/**
 * A pasta assets/ é servida publicamente na raiz (main.ts). A credencial do
 * Firebase nunca pode ser lida de lá: só de FIREBASE_SERVICE_ACCOUNT_JSON ou de
 * FIREBASE_SERVICE_ACCOUNT_PATH fora da pasta servida.
 */
describe('NotificationsService — credencial do Firebase fora da pasta pública', () => {
  const OLD = { ...process.env };
  const pastaAssets = path.resolve(__dirname, 'assets');
  let tmp: string | null = null;

  beforeEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    (admin.initializeApp as jest.Mock).mockClear();
    (admin.credential.cert as jest.Mock).mockClear();
  });

  afterEach(() => {
    process.env = { ...OLD };
    fs.rmSync(pastaAssets, { recursive: true, force: true });
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('não usa mais assets/firebase-service-account.json (fica desligado sem env)', () => {
    fs.mkdirSync(pastaAssets, { recursive: true });
    fs.writeFileSync(path.join(pastaAssets, 'firebase-service-account.json'), '{"project_id":"x"}');
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
    expect(svc.enabled).toBe(false);
  });

  it('recusa FIREBASE_SERVICE_ACCOUNT_PATH apontando para dentro de assets/', () => {
    fs.mkdirSync(pastaAssets, { recursive: true });
    const arq = path.join(pastaAssets, 'sa.json');
    fs.writeFileSync(arq, '{"project_id":"x"}');
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = arq;
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
    expect(svc.enabled).toBe(false);
  });

  it('carrega de FIREBASE_SERVICE_ACCOUNT_PATH fora da pasta servida', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-'));
    const arq = path.join(tmp, 'sa.json');
    fs.writeFileSync(arq, '{"project_id":"x"}');
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = arq;
    const svc: any = new NotificationsService({} as any);
    svc.onModuleInit();
    expect(admin.credential.cert).toHaveBeenCalledWith(arq);
    expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    expect(svc.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts assets-estaticos.util notifications.credencial`
Expected: FAIL — `Cannot find module './assets-estaticos.util'`; em `notifications.credencial.spec.ts`, "não usa mais assets/..." falha (`initializeApp` chamado 1 vez pelo fallback de arquivo) e "carrega de FIREBASE_SERVICE_ACCOUNT_PATH" falha (`enabled` false, env desconhecida).

- [ ] **Step 3: Write minimal implementation**

Criar `click-cond-web/apps/api/src/app/common/assets-estaticos.util.ts`:

```ts
/**
 * Decide se um pedido ao servidor de arquivos estáticos (dist/assets servido na
 * raiz por main.ts) deve ser recusado. A comparação é feita no caminho
 * DECODIFICADO: o serve-static/send decodifica antes de abrir o arquivo, então
 * '/firebase-service%2Daccount.jso%6E' chega no disco como
 * '/firebase-service-account.json'. Codificação inválida também é recusada.
 */
export function caminhoEstaticoBloqueado(caminho: string | undefined): boolean {
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(caminho ?? '');
  } catch {
    return true;
  }
  return /^\/[^/]+\.json$/i.test(decodificado) || /service-account/i.test(decodificado);
}
```

Em `click-cond-web/apps/api/src/main.ts`, adicionar o import junto dos outros imports de `./app/common/...`:

```ts
import { caminhoEstaticoBloqueado } from './app/common/assets-estaticos.util';
```

e trocar o middleware (linhas 86-96). Antes:

```ts
  // Serve arquivos estáticos copiados de src/assets (simulador facial em /simulator.html)
  // Só HTML dos simuladores. A pasta também carrega a credencial de serviço do
  // Firebase (copiada pelo build) — nunca pode sair por aqui.
  app.use((req: any, res: any, next: any) => {
    if (/^\/[^/]+\.json$/i.test(req.path ?? '') || /service-account/i.test(req.path ?? '')) {
      return res.status(404).end();
    }
    next();
  });
  app.useStaticAssets(join(__dirname, 'assets'));
```

Depois:

```ts
  // Serve arquivos estáticos copiados de src/assets (simulador facial em /simulator.html)
  // Só HTML dos simuladores. Nenhum .json/credencial pode sair por aqui — e o
  // filtro olha o caminho DECODIFICADO, igual ao que o serve-static abre.
  app.use((req: any, res: any, next: any) => {
    if (caminhoEstaticoBloqueado(req.path)) {
      return res.status(404).end();
    }
    next();
  });
  app.useStaticAssets(join(__dirname, 'assets'));
```

Em `click-cond-web/apps/api/src/app/notifications/notifications.service.ts`, trocar o bloco "2) Tenta arquivo local." (linhas 35-46). Antes:

```ts
      // 2) Tenta arquivo local.
      const serviceAccountPath = path.resolve(
        __dirname,
        'assets/firebase-service-account.json',
      );
      if (!fs.existsSync(serviceAccountPath)) {
        this.logger.warn('Notificações push desativadas (firebase-service-account.json ausente).');
        return;
      }
```

Depois:

```ts
      // 2) Arquivo de credencial FORA da pasta servida: dist/assets é público na
      // raiz do site (main.ts), então o antigo assets/firebase-service-account.json
      // ia no pacote e ficava a um bypass de filtro de ser baixado.
      const caminhoCred = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
      if (!caminhoCred) {
        this.logger.warn(
          'Notificações push desativadas (defina FIREBASE_SERVICE_ACCOUNT_JSON ou FIREBASE_SERVICE_ACCOUNT_PATH).',
        );
        return;
      }
      const serviceAccountPath = path.resolve(caminhoCred);
      const pastaPublica = path.resolve(__dirname, 'assets') + path.sep;
      if (serviceAccountPath.startsWith(pastaPublica)) {
        this.logger.warn(
          'FIREBASE_SERVICE_ACCOUNT_PATH aponta para a pasta pública assets/. Notificações push desativadas.',
        );
        return;
      }
      if (!fs.existsSync(serviceAccountPath)) {
        this.logger.warn(`Notificações push desativadas (${serviceAccountPath} ausente).`);
        return;
      }
```

(As linhas seguintes — `admin.initializeApp({ credential: admin.credential.cert(serviceAccountPath) })` e o log "file credentials" — ficam como estão.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts assets-estaticos.util notifications`
Expected: PASS (inclui `notifications.multi-device.spec.ts`, que continua verde).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/common/assets-estaticos.util.ts click-cond-web/apps/api/src/app/common/assets-estaticos.util.spec.ts click-cond-web/apps/api/src/main.ts click-cond-web/apps/api/src/app/notifications/notifications.service.ts click-cond-web/apps/api/src/app/notifications/notifications.credencial.spec.ts
git commit -m "fix(security): filtro de estaticos decodifica o caminho e credencial do Firebase sai de assets/

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: Pacote do Elastic Beanstalk e build do webpack não levam credenciais

Fingerprint: `eb-bundle-includes-firebase-service-account`

`webpack.config.js` copia `src/assets` inteiro para `dist/assets` e `scripts/migration/bundle-eb.mjs` copia `dist/assets` inteiro para `eb-package/` e o zip. Na máquina do dev, `src/assets/firebase-service-account.json` (gitignored) entra no pacote. Correção: filtro explícito no `cpSync` do bundle (sem `.json`, `service-account`, `.env*`, `.pem/.key/.p12/.pfx`) e `ignore` equivalente no asset do webpack.

**Files:**
- Create: `click-cond-web/scripts/migration/assets-do-pacote.mjs`
- Create: `click-cond-web/scripts/migration/assets-do-pacote.test.mjs`
- Modify: `click-cond-web/scripts/migration/bundle-eb.mjs:1-4,28-33`
- Modify: `click-cond-web/apps/api/webpack.config.js:18`

**Interfaces:**
- Consumes: B1 (o fallback `assets/firebase-service-account.json` não é mais lido, então tirá-lo do pacote não desliga o push).
- Produces: `assetVaiNoPacote(caminhoRelativo: string): boolean` em `scripts/migration/assets-do-pacote.mjs`.

- [ ] **Step 1: Write the failing test**

`click-cond-web/scripts/migration/assets-do-pacote.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetVaiNoPacote } from './assets-do-pacote.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('credenciais e .json ficam fora do pacote do Elastic Beanstalk', () => {
  for (const p of [
    'firebase-service-account.json',
    'sub/qualquer.json',
    'chave-service-account.txt',
    '.env',
    'sub/.env.local',
    'cert.pem',
    'id.key',
    'loja.p12',
    'x.pfx',
  ]) {
    assert.equal(assetVaiNoPacote(p), false, p);
  }
});

test('a pasta raiz e os simuladores HTML continuam indo', () => {
  for (const p of ['', 'simulator.html', 'simulador-acesso.html', 'simulator-qr.html', 'simulator-rfid.html']) {
    assert.equal(assetVaiNoPacote(p), true, p);
  }
});

test('bundle-eb.mjs copia os assets com o filtro', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'bundle-eb.mjs'), 'utf8');
  assert.match(fonte, /filter:\s*\(origem\)\s*=>\s*assetVaiNoPacote\(path\.relative\(assetsSrc, origem\)\)/);
});

test('webpack não copia .json nem service-account para dist/assets', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../../apps/api/webpack.config.js'), 'utf8');
  assert.ok(fonte.includes("ignore: ['**/*.json', '**/*service-account*', '**/.env*']"));
  assert.ok(!fonte.includes("assets: ['./src/assets']"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/migration/assets-do-pacote.test.mjs`
Expected: FAIL — `Cannot find module '.../assets-do-pacote.mjs'` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write minimal implementation**

Criar `click-cond-web/scripts/migration/assets-do-pacote.mjs`:

```js
/**
 * O que de apps/api/dist/assets pode ir para o pacote do Elastic Beanstalk.
 * A pasta é servida publicamente na raiz do site (main.ts) e, na máquina do
 * dev, já carregou a chave do Firebase (gitignored) — que entrava no zip.
 * Fica de fora qualquer .json, credencial, .env e chave/certificado.
 */
const BLOQUEADOS = [
  /\.json$/i,
  /service-account/i,
  /(^|[\\/])\.env/i,
  /\.(pem|key|p12|pfx)$/i,
];

export function assetVaiNoPacote(caminhoRelativo) {
  return !BLOQUEADOS.some((re) => re.test(caminhoRelativo));
}
```

Em `click-cond-web/scripts/migration/bundle-eb.mjs`, adicionar o import depois de `import { execSync } from 'child_process';`:

```js
import { assetVaiNoPacote } from './assets-do-pacote.mjs';
```

e trocar o passo 2. Antes:

```js
  // 2. Copia assets se existirem
  const assetsSrc = path.join(WEB_ROOT, 'apps/api/dist/assets');
  if (fs.existsSync(assetsSrc)) {
    console.log('2. Copiando assets...');
    fs.cpSync(assetsSrc, path.join(EB_DIR, 'assets'), { recursive: true });
  }
```

Depois:

```js
  // 2. Copia assets se existirem — sem .json/credenciais (a pasta é pública e,
  // na máquina do dev, carrega a chave do Firebase).
  const assetsSrc = path.join(WEB_ROOT, 'apps/api/dist/assets');
  if (fs.existsSync(assetsSrc)) {
    console.log('2. Copiando assets (sem .json/credenciais)...');
    fs.cpSync(assetsSrc, path.join(EB_DIR, 'assets'), {
      recursive: true,
      filter: (origem) => assetVaiNoPacote(path.relative(assetsSrc, origem)),
    });
  }
```

Em `click-cond-web/apps/api/webpack.config.js`, trocar a linha 18. Antes:

```js
      assets: ['./src/assets'],
```

Depois:

```js
      // src/assets vai para dist/assets, servido na raiz do site: nada de
      // .json/credencial (a chave do Firebase do dev mora ali, gitignored).
      assets: [
        {
          input: './src/assets',
          glob: '**/*',
          output: 'assets',
          ignore: ['**/*.json', '**/*service-account*', '**/.env*'],
        },
      ],
```

- [ ] **Step 4: Run test to verify it passes, then check a real build**

Run: `cd C:/w/sec/click-cond-web && node --test scripts/migration/assets-do-pacote.test.mjs`
Expected: PASS (4 testes).

Then confirm o webpack com um marcador (o worktree não tem a chave real):

Run: `cd C:/w/sec/click-cond-web && echo {} > apps/api/src/assets/firebase-service-account.json && npx nx build api && ls apps/api/dist/assets; rm apps/api/src/assets/firebase-service-account.json`
Expected: `ls` lista só os 5 `.html` (`simulador-acesso.html`, `simulator-botoeira.html`, `simulator-qr.html`, `simulator-rfid.html`, `simulator.html`), sem `firebase-service-account.json`.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/scripts/migration/assets-do-pacote.mjs click-cond-web/scripts/migration/assets-do-pacote.test.mjs click-cond-web/scripts/migration/bundle-eb.mjs click-cond-web/apps/api/webpack.config.js
git commit -m "fix(security): pacote do EB e build da API nao copiam credenciais de assets/

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3: Guarda de SSRF entende IPv6 com IPv4 embutido e fixa o IP validado na conexão

Fingerprints: `url-segura:urlExternaSegura:ipv4-mapped-ipv6-hex-bypass`, `url-segura:urlExternaSegura:dns-rebinding-check-then-fetch`

(1) O WHATWG URL serializa `[::ffff:169.254.169.254]` como `::ffff:a9fe:a9fe`; `ipEhPrivado` só reconhecia a forma pontuada, então o metadata da AWS passava como público. (2) `urlExternaSegura` resolve o DNS e devolve só um booleano; o `axios.get`/`fetch` resolve de novo (DNS rebinding). Correção: expandir o IPv6 em 8 grupos e checar IPv4 embutido (mapeado, compatível, NAT64, 6to4) + `fec0::/10`; e um `lookup` que rejeita endereço interno, passado em `http.Agent`/`https.Agent` nas três chamadas (`toDataUrl`, `fetchPhotoBrutaAsBase64`, `extrairTextoPdf` — esta troca `fetch` por `axios`). Formas IPv4 hex/decimal/octal (`0x7f000001`, `2130706433`) já são normalizadas pelo WHATWG URL para pontuada; ficam como regressão.

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/url-segura.util.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/common/url-segura.util.ts` (arquivo inteiro)
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts:37,1370-1375,5925-5930`
- Modify: `click-cond-web/apps/api/src/app/chat-ia/chat-ia.service.ts:35,1064-1072`

**Interfaces:**
- Consumes: nada.
- Produces (em `apps/api/src/app/common/url-segura.util.ts`): `ipEhPrivado(ip: string): boolean` (mesma assinatura, mais formas), `urlExternaSegura(url: string): Promise<boolean>` (inalterada), `lookupSeguro(hostname: string, options: any, callback?: any): void` (assinatura de `net.LookupFunction`; erro com `code = 'EHOSTBLOQUEADO'`), `agentesSemRedeInterna(): { httpAgent: http.Agent; httpsAgent: https.Agent }`.

- [ ] **Step 1: Write the failing test**

`click-cond-web/apps/api/src/app/common/url-segura.util.spec.ts`:

```ts
jest.mock('dns', () => {
  const real = jest.requireActual('dns');
  return { ...real, lookup: jest.fn() };
});

import * as http from 'http';
import axios from 'axios';
import { agentesSemRedeInterna, ipEhPrivado, lookupSeguro, urlExternaSegura } from './url-segura.util';

const dnsMock = jest.requireMock('dns') as { lookup: jest.Mock };

function responderDns(enderecos: { address: string; family: number }[]) {
  dnsMock.lookup.mockImplementation((_h: string, _o: any, cb: any) => cb(null, enderecos));
}

function chamarLookup(host: string, opts: any) {
  return new Promise<{ err: any; addr: any; family: any }>((resolve) =>
    lookupSeguro(host, opts, (err: any, addr?: any, family?: any) => resolve({ err, addr, family })),
  );
}

describe('ipEhPrivado — IPv6 com IPv4 interno embutido', () => {
  it.each([
    '::ffff:a9fe:a9fe', // ::ffff:169.254.169.254 como o WHATWG URL serializa
    '::ffff:7f00:1', // ::ffff:127.0.0.1
    '::ffff:a00:5', // ::ffff:10.0.0.5
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '::ffff:0:a9fe:a9fe', // SIIT
    '::a9fe:a9fe', // IPv4-compatible (::/96)
    '64:ff9b::a9fe:a9fe', // NAT64
    '2002:a9fe:a9fe::1', // 6to4
    'fec0::1', // site-local
    'fe80::1%eth0',
    'fd00:ec2::254', // IMDS IPv6 da AWS
    '::',
  ])('trata %s como privado', (ip) => expect(ipEhPrivado(ip)).toBe(true));

  it.each(['2001:4860:4860::8888', '::ffff:808:808', '64:ff9b::808:808', '8.8.8.8'])(
    'aceita %s (público)',
    (ip) => expect(ipEhPrivado(ip)).toBe(false),
  );
});

describe('urlExternaSegura — host literal interno em qualquer forma', () => {
  it.each([
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:127.0.0.1]:3000/',
    'http://[::ffff:10.0.0.5]/',
    'http://[64:ff9b::169.254.169.254]/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://0251.0376.0251.0376/',
  ])('bloqueia %s', async (u) => expect(await urlExternaSegura(u)).toBe(false));
});

describe('lookupSeguro — o IP validado é o IP conectado (DNS rebinding)', () => {
  afterEach(() => dnsMock.lookup.mockReset());

  it('recusa nome que resolve para endereço interno', async () => {
    responderDns([{ address: '169.254.169.254', family: 4 }]);
    const { err } = await chamarLookup('rebind.exemplo.com', {});
    expect(err?.code).toBe('EHOSTBLOQUEADO');
  });

  it('recusa se QUALQUER endereço da resposta for interno', async () => {
    responderDns([
      { address: '8.8.8.8', family: 4 },
      { address: '::ffff:a9fe:a9fe', family: 6 },
    ]);
    const { err } = await chamarLookup('rebind.exemplo.com', {});
    expect(err?.code).toBe('EHOSTBLOQUEADO');
  });

  it('devolve endereço público (forma simples e forma all:true)', async () => {
    responderDns([{ address: '8.8.8.8', family: 4 }]);
    expect(await chamarLookup('ok.exemplo.com', {})).toEqual({ err: null, addr: '8.8.8.8', family: 4 });
    const todos = await chamarLookup('ok.exemplo.com', { all: true });
    expect(todos.err).toBeNull();
    expect(todos.addr).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('axios com agentesSemRedeInterna não conecta num servidor interno', async () => {
    const server = http.createServer((_req, res) => res.end('segredo-interno'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as any;
    responderDns([{ address: '127.0.0.1', family: 4 }]);
    try {
      await expect(
        axios.get(`http://rebind.exemplo.com:${port}/`, {
          ...agentesSemRedeInterna(),
          proxy: false,
          timeout: 3000,
        }),
      ).rejects.toThrow(/endereço interno/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts common/url-segura.util`
Expected: FAIL — os casos IPv6 hex (`::ffff:a9fe:a9fe`, `::ffff:0:a9fe:a9fe`, `::a9fe:a9fe`, `64:ff9b::...`, `2002:...`, `fec0::1`) retornam `false`; `http://[::ffff:169.254.169.254]/...` e as outras URLs IPv6 retornam `true`; os testes de `lookupSeguro`/`agentesSemRedeInterna` falham com `TypeError: ... is not a function`. (As URLs `0x7f000001`/`2130706433`/octal já passam — são regressão.)

- [ ] **Step 3: Write minimal implementation**

Substituir o conteúdo de `click-cond-web/apps/api/src/app/common/url-segura.util.ts` por:

```ts
import * as dns from 'dns';
import { lookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';

/**
 * Proteção contra SSRF para URLs que o servidor baixa a pedido de um usuário
 * (foto_pessoa, link_doc...). Bloqueia esquemas que não sejam http(s), IPs
 * privados/loopback/link-local (inclui o metadata da AWS, 169.254.169.254) e
 * hosts que RESOLVEM para esses endereços. Quem chama deve também desligar
 * redirecionamentos (um 302 para o IP interno contornaria esta checagem) e
 * usar agentesSemRedeInterna() — sem ele o cliente HTTP resolve o nome de
 * novo e um DNS com TTL 0 troca a resposta para um IP interno (rebinding).
 */

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::", sufixo IPv4 e zona %eth0); null se inválido. */
function gruposIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const sufixoV4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (sufixoV4) {
    const o = sufixoV4.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${sufixoV4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(':') : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const zeros = partes.length === 2 ? 8 - esq.length - dir.length : 0;
  if (zeros < 0) return null;
  const grupos = [...esq, ...Array(zeros).fill('0'), ...dir];
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
}

function ipv4DosGrupos(alto: number, baixo: number): string {
  return `${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`;
}

export function ipEhPrivado(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local + metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast/reservado
    );
  }
  if (v === 6) {
    const g = gruposIpv6(ip);
    if (!g) return true;
    const zerosAte = (n: number) => g.slice(0, n).every((x) => x === 0);
    // IPv4 embutido — o WHATWG URL serializa tudo em hex (::ffff:a9fe:a9fe):
    // mapeado (::ffff:0:0/96), SIIT (::ffff:0:0:0/96), compatível (::/96,
    // inclui :: e ::1) e NAT64 (64:ff9b::/96).
    if (
      (zerosAte(5) && g[5] === 0xffff) ||
      (zerosAte(4) && g[4] === 0xffff && g[5] === 0) ||
      zerosAte(6) ||
      (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    ) {
      return ipEhPrivado(ipv4DosGrupos(g[6], g[7]));
    }
    if (g[0] === 0x2002) return ipEhPrivado(ipv4DosGrupos(g[1], g[2])); // 6to4
    return (
      (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 (ULA; inclui fd00:ec2::254 da AWS)
      (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local
      (g[0] & 0xff00) === 0xff00 // multicast
    );
  }
  return true; // não é IP válido: trate como inseguro
}

/** true se a URL é http(s) e todos os endereços do host são públicos. */
export async function urlExternaSegura(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !ipEhPrivado(host);
  try {
    const enderecos = await lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipEhPrivado(e.address));
  } catch {
    return false;
  }
}

/**
 * `lookup` para net/http: resolve o nome e RECUSA se qualquer endereço for
 * interno. Passado no http(s).Agent, o endereço checado é o mesmo que a
 * conexão usa (fecha o DNS rebinding entre urlExternaSegura e o download).
 */
export function lookupSeguro(hostname: string, options: any, callback?: any): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opcoes: dns.LookupAllOptions = { ...(options || {}), all: true };
  dns.lookup(hostname, opcoes, (err, lista) => {
    if (err) return callback(err);
    if (!lista.length || lista.some((e) => ipEhPrivado(e.address))) {
      const bloqueio: NodeJS.ErrnoException = new Error(`Host ${hostname} resolve para endereço interno`);
      bloqueio.code = 'EHOSTBLOQUEADO';
      return callback(bloqueio);
    }
    if (options && options.all) return callback(null, lista);
    return callback(null, lista[0].address, lista[0].family);
  });
}

/** Agentes para axios (`{ ...agentesSemRedeInterna() }`) que conectam só em IP público. */
export function agentesSemRedeInterna(): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  return {
    httpAgent: new http.Agent({ lookup: lookupSeguro as any }),
    httpsAgent: new https.Agent({ lookup: lookupSeguro as any }),
  };
}
```

Em `click-cond-web/apps/api/src/app/facial/facial.service.ts`, linha 37. Antes:

```ts
import { urlExternaSegura } from '../common/url-segura.util';
```

Depois:

```ts
import { agentesSemRedeInterna, urlExternaSegura } from '../common/url-segura.util';
```

Em `toDataUrl` (linhas 1370-1375) e em `fetchPhotoBrutaAsBase64` (linhas 5925-5930) — o bloco é idêntico nas duas funções; trocar nas DUAS. Antes:

```ts
        const res = await axios.get(foto, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: 15 * 1024 * 1024,
        });
```

Depois:

```ts
        const res = await axios.get(foto, {
          ...agentesSemRedeInterna(), // o IP checado é o IP conectado (DNS rebinding)
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: 15 * 1024 * 1024,
        });
```

Em `click-cond-web/apps/api/src/app/chat-ia/chat-ia.service.ts`, linha 35. Antes:

```ts
import { urlExternaSegura } from '../common/url-segura.util';
```

Depois:

```ts
import { agentesSemRedeInterna, urlExternaSegura } from '../common/url-segura.util';
```

E o início de `extrairTextoPdf` (linhas 1064-1072). Antes:

```ts
  private async extrairTextoPdf(url: string): Promise<string> {
    if (!(await urlExternaSegura(url))) throw new Error('URL do documento bloqueada (host interno/inválido)');
    // redirect:'error' — um 302 para IP interno contornaria a checagem acima.
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Falha ao baixar documento (${res.status})`);
    const declarado = Number(res.headers.get('content-length') ?? 0);
    if (declarado > 30 * 1024 * 1024) throw new Error('Documento acima do limite');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 30 * 1024 * 1024) throw new Error('Documento acima do limite');
```

Depois:

```ts
  private async extrairTextoPdf(url: string): Promise<string> {
    if (!(await urlExternaSegura(url))) throw new Error('URL do documento bloqueada (host interno/inválido)');
    // maxRedirects 0 — um 302 para IP interno contornaria a checagem acima; os
    // agentes refazem a checagem no IP que de fato conecta (DNS rebinding).
    const axios = (await import('axios')).default;
    const res = await axios.get(url, {
      ...agentesSemRedeInterna(),
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 0,
      maxContentLength: 30 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`Falha ao baixar documento (${res.status})`);
    const buffer = Buffer.from(res.data);
    if (buffer.length > 30 * 1024 * 1024) throw new Error('Documento acima do limite');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts common/url-segura.util security-hardening chat-ia facial`
Expected: PASS (`security-hardening.spec.ts` continua verde: `::ffff:10.0.0.1`, `fd00::1`, `::1` seguem privados).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/common/url-segura.util.ts click-cond-web/apps/api/src/app/common/url-segura.util.spec.ts click-cond-web/apps/api/src/app/facial/facial.service.ts click-cond-web/apps/api/src/app/chat-ia/chat-ia.service.ts
git commit -m "fix(security): SSRF guard entende IPv6 com IPv4 embutido e fixa o IP validado na conexao

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4: IP/porta do terminal facial validados no cadastro e na edição

Fingerprint: `facial/device-ip-unvalidated-cloud-direct-http-ssrf`

`createDevice`/`updateDevice` gravam `ip` e `porta` sem validação; com o agente offline, `FacialDeviceClientService.baseUrl` monta `http://${ip}:${porta}` e a API chama direto (ex.: `ip = '169.254.169.254/latest/meta-data/x#'`). Correção: `ip` só IPv4 literal (sem loopback `0/8`/`127/8`, link-local `169.254/16`, multicast/reservado `>=224`) ou hostname sintaticamente válido (sem `/ ? # @` espaço, sem último rótulo numérico/hex que o parser de URL leria como IPv4, sem `localhost`/`*.localhost`/`*.internal`), ou `sim`/`simulador`; `porta` inteiro 1–65535. Faixas privadas de LAN (10/8, 172.16/12, 192.168/16) continuam aceitas — os terminais moram nelas. A validação fica só no create/update (o teste de integração do client usa `127.0.0.1` direto no `FacialDeviceClientService` e precisa continuar funcionando); o banco não tem dados reais, então não há registro antigo a sanear.

**Files:**
- Create: `click-cond-web/apps/api/src/app/facial/device-endereco.util.ts`
- Create: `click-cond-web/apps/api/src/app/facial/facial-device-endereco.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts:37` (import), `:928-941` (createDevice), `:995-1010` (updateDevice)

**Interfaces:**
- Consumes: nada.
- Produces: `motivoIpDispositivoInvalido(ip: unknown): string | null`, `validarIpDispositivo(ip: unknown): string`, `validarPortaDispositivo(porta: unknown): number` (as duas últimas lançam `BadRequestException`) em `apps/api/src/app/facial/device-endereco.util.ts`.

- [ ] **Step 1: Write the failing test**

`click-cond-web/apps/api/src/app/facial/facial-device-endereco.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { FacialService } from './facial.service';
import { motivoIpDispositivoInvalido } from './device-endereco.util';

/**
 * O ip/porta do terminal vira URL na API quando o agente está offline
 * (FacialDeviceClientService.baseUrl). Sem validação, o síndico apontava a
 * API para o metadata da AWS ou para a VPC.
 */
describe('motivoIpDispositivoInvalido', () => {
  it.each([
    '169.254.169.254',
    '169.254.169.254/latest/meta-data/x#',
    '127.0.0.1',
    '0.0.0.0',
    '224.0.0.1',
    'localhost',
    'api.localhost',
    'metadata.google.internal',
    '2130706433',
    '0x7f000001',
    '127.1',
    '192.168.0.300',
    '10.0.0.1?x=1',
    'user@10.0.0.1',
    ' 192.168.0.10',
    '::1',
    '',
  ])('recusa %s', (ip) => expect(motivoIpDispositivoInvalido(ip)).not.toBeNull());

  it.each(['192.168.3.175', '10.0.0.20', '172.16.5.4', '200.150.10.2', 'portaria.condominio.com.br', 'sim', 'simulador'])(
    'aceita %s',
    (ip) => expect(motivoIpDispositivoInvalido(ip)).toBeNull(),
  );
});

describe('FacialService.createDevice / updateDevice — endereço do terminal', () => {
  function build() {
    const device: any = {
      id: 1, id_condominio: 10, nome: 'facial', tipo: 'facial', ativo: 1,
      ip: '192.168.3.175', porta: 80, api_password: null, id_area_social: null,
    };
    const prisma: any = {
      facial_Devices: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        findUnique: jest.fn(async () => ({ ...device })),
        findFirst: jest.fn(async () => ({ ...device })),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data)),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma };
  }
  const base = { id_condominio: 10, nome: 'Facial', fabricante: 'intelbras' };

  it('create recusa ip que reescreve a URL para o metadata da AWS', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.createDevice({ ...base, ip: '169.254.169.254/latest/meta-data/x#' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
  });

  it('create recusa porta fora de 1-65535', async () => {
    const { svc, prisma } = build();
    await expect(svc.createDevice({ ...base, ip: '192.168.3.175', porta: 70000 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
  });

  it('create aceita IP de LAN e normaliza porta numérica', async () => {
    const { svc, prisma } = build();
    await svc.createDevice({ ...base, ip: '192.168.3.175', porta: '8080' as any });
    const data = prisma.facial_Devices.create.mock.calls[0][0].data;
    expect(data.ip).toBe('192.168.3.175');
    expect(data.porta).toBe(8080);
  });

  it('create sem porta continua usando 80', async () => {
    const { svc, prisma } = build();
    await svc.createDevice({ ...base, ip: '10.0.0.20' });
    expect(prisma.facial_Devices.create.mock.calls[0][0].data.porta).toBe(80);
  });

  it('update recusa ip de loopback e não grava', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateDevice(1, { ip: '127.0.0.1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
  });

  it('update sem ip/porta no corpo não valida nem mexe neles', async () => {
    const { svc, prisma } = build();
    await svc.updateDevice(1, { nome: 'novo' });
    const data = prisma.facial_Devices.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('ip');
    expect(data).not.toHaveProperty('porta');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts facial-device-endereco`
Expected: FAIL — `Cannot find module './device-endereco.util'`.

- [ ] **Step 3: Write minimal implementation**

Criar `click-cond-web/apps/api/src/app/facial/device-endereco.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

/**
 * Endereço do terminal (ip/porta) cadastrado pelo síndico. O mesmo valor vira
 * `http://${ip}:${porta}/...` no agente local E, com o agente offline, na
 * própria API (FacialDeviceClientService.baseUrl) — sem validação, um "ip"
 * como `169.254.169.254/latest/meta-data/x#` fazia a API chamar o metadata da
 * AWS. Rede privada (10/8, 172.16/12, 192.168/16) continua aceita: é onde os
 * terminais moram.
 */
const ROTULO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function motivoIpDispositivoInvalido(ip: unknown): string | null {
  if (typeof ip !== 'string' || !ip) return 'Informe o IP do terminal.';
  if (ip === 'sim' || ip === 'simulador') return null;
  const versao = isIP(ip);
  if (versao === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return 'IP de loopback não é um terminal.';
    if (a === 169 && b === 254) return 'IP link-local (169.254.x.x) não é aceito.';
    if (a >= 224) return 'IP multicast/reservado não é aceito.';
    return null;
  }
  if (versao === 6) return 'Use o IPv4 do terminal.';
  if (ip.length > 253) return 'Host do terminal longo demais.';
  const rotulos = ip.split('.');
  if (!rotulos.every((r) => ROTULO.test(r))) return 'IP/host do terminal com caracteres inválidos.';
  // Último rótulo numérico/hex: o parser de URL lê como IPv4 (2130706433, 0x7f000001, 127.1).
  if (/^(0x[0-9a-f]*|\d+)$/i.test(rotulos[rotulos.length - 1])) return 'IPv4 do terminal inválido.';
  const host = ip.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'Host interno não é aceito.';
  }
  return null;
}

export function validarIpDispositivo(ip: unknown): string {
  const motivo = motivoIpDispositivoInvalido(ip);
  if (motivo) throw new BadRequestException(motivo);
  return ip as string;
}

export function validarPortaDispositivo(porta: unknown): number {
  const n = Number(porta);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new BadRequestException('Porta do terminal deve ser um número de 1 a 65535.');
  }
  return n;
}
```

Em `click-cond-web/apps/api/src/app/facial/facial.service.ts`, adicionar logo após a linha 37 (`import ... from '../common/url-segura.util';`):

```ts
import { validarIpDispositivo, validarPortaDispositivo } from './device-endereco.util';
```

Em `createDevice` (linhas 928-941). Antes:

```ts
  async createDevice(dto: CreateDeviceDto, operador?: JwtPayload) {
    await this.assertAreaDoCondominio(dto.id_area_social, dto.id_condominio);
```

Depois:

```ts
  async createDevice(dto: CreateDeviceDto, operador?: JwtPayload) {
    const ip = validarIpDispositivo(dto.ip);
    const porta = validarPortaDispositivo(dto.porta ?? 80);
    await this.assertAreaDoCondominio(dto.id_area_social, dto.id_condominio);
```

e, no `data` do `prisma.facial_Devices.create` do mesmo método. Antes:

```ts
        ip: dto.ip,
        porta: dto.porta ?? 80,
```

Depois:

```ts
        ip,
        porta,
```

Em `updateDevice` (linhas 995-1010). Antes:

```ts
  async updateDevice(id: number, dto: UpdateDeviceDto, operador?: JwtPayload) {
    const antes = await this.getDevice(id);
    await this.assertAreaDoCondominio(dto.id_area_social, antes.id_condominio);
```

Depois:

```ts
  async updateDevice(id: number, dto: UpdateDeviceDto, operador?: JwtPayload) {
    const antes = await this.getDevice(id);
    const ip = dto.ip !== undefined ? validarIpDispositivo(dto.ip) : undefined;
    const porta = dto.porta !== undefined ? validarPortaDispositivo(dto.porta ?? 80) : undefined;
    await this.assertAreaDoCondominio(dto.id_area_social, antes.id_condominio);
```

e no `data` do `prisma.facial_Devices.update`. Antes:

```ts
        ...(dto.ip !== undefined && { ip: dto.ip }),
        ...(dto.porta !== undefined && { porta: dto.porta }),
```

Depois:

```ts
        ...(ip !== undefined && { ip }),
        ...(porta !== undefined && { porta }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts facial`
Expected: PASS (incluindo `facial-create-device-mac.spec.ts`, `facial-update-device-ativo.spec.ts` e `facial-device-client.integracao.spec.ts`, que usam `192.168.3.175`/`127.0.0.1` sem passar pelo create).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/facial/device-endereco.util.ts click-cond-web/apps/api/src/app/facial/facial-device-endereco.spec.ts click-cond-web/apps/api/src/app/facial/facial.service.ts
git commit -m "fix(security): valida ip/porta do terminal facial no cadastro e na edicao

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B5: Expurgo LGPD só apaga objeto dentro do prefixo do dono

Fingerprint: `storage:deleteUrl:attacker-supplied-stored-url-deletes-foreign-object`

`resolveFoto` guarda qualquer string não-data-URL como `foto_pessoa`/`foto_documento`; o expurgo chama `storage.deleteUrl` nesse valor, que apaga qualquer key do bucket compartilhado (ata, comprovante, foto de morador de outro condomínio) se a URL estiver sob `publicUrl` ou não tiver esquema. Correção: `deleteUrl(url, prefixosPermitidos)` com lista obrigatória — visitante/Pessoa só apaga `visitantes/` ou `convites/` (foto herdada do convite em `confirmar`), convite só `convites/`. Lista vazia/ausente não apaga nada.

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/storage/storage-delete-prefixo.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/common/storage/storage.service.ts:39-40,153-178`
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts:16,225-226,301-302`
- Modify: `click-cond-web/apps/api/src/app/convites/convites.service.ts:12,141,591`
- Modify (specs existentes): `click-cond-web/apps/api/src/app/common/security-hardening.spec.ts:79-86`, `click-cond-web/apps/api/src/app/visitantes/retencao-lgpd-pessoas.spec.ts:1,50-51`, `click-cond-web/apps/api/src/app/convites/convites.spec.ts:3,366,538`

**Interfaces:**
- Consumes: nada.
- Produces: `StorageService.deleteUrl(url: string | null | undefined, prefixosPermitidos: readonly string[]): Promise<boolean>`; constantes `PREFIXOS_FOTO_VISITANTE` (`['visitantes/', 'convites/']`) e `PREFIXOS_FOTO_CONVITE` (`['convites/']`) exportadas de `apps/api/src/app/common/storage/storage.service.ts`.

- [ ] **Step 1: Write the failing test**

`click-cond-web/apps/api/src/app/common/storage/storage-delete-prefixo.spec.ts`:

```ts
import { PREFIXOS_FOTO_CONVITE, PREFIXOS_FOTO_VISITANTE, StorageService } from './storage.service';
import { VisitantesService } from '../../visitantes/visitantes.service';

/**
 * O valor de foto_pessoa/foto_documento é escolhido pelo cliente (resolveFoto
 * guarda URL não-data verbatim). O expurgo LGPD apagava qualquer objeto do
 * bucket compartilhado que a URL apontasse — ata, comprovante, foto de outro
 * condomínio. Agora o expurgo de cada dono só apaga dentro do próprio prefixo.
 */
describe('StorageService.deleteUrl — só dentro do prefixo do dono', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  function criar() {
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.R2_BUCKET = 'bkt';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';
    const svc: any = new StorageService();
    svc.client = { send: jest.fn().mockResolvedValue({}) };
    return svc;
  }

  it('objeto do nosso storage fora do prefixo esperado não é apagado', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/documentos/ata.pdf', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('documentos/ata.pdf', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantesX/a.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', PREFIXOS_FOTO_CONVITE)).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
  });

  it('sem prefixos permitidos não apaga nada', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', [])).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/a.jpg', undefined)).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
  });

  it('foto de visitante (ou herdada do convite) continua sendo apagada', async () => {
    const svc = criar();
    expect(await svc.deleteUrl('https://pub.example.com/visitantes/1-a.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(true);
    expect(await svc.deleteUrl('https://pub.example.com/convites/2-b.jpg', PREFIXOS_FOTO_VISITANTE)).toBe(true);
    expect(svc.client.send.mock.calls.map((c: any) => c[0].input.Key)).toEqual([
      'visitantes/1-a.jpg',
      'convites/2-b.jpg',
    ]);
  });
});

describe('VisitantesService.tickRetencaoDadosVisitantes — passa o prefixo de foto de visitante', () => {
  it('expurgo de Visitantes chama deleteUrl com PREFIXOS_FOTO_VISITANTE', async () => {
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, foto_pessoa: 'https://pub.example.com/documentos/ata.pdf', foto_documento: null },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pessoas: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    };
    const storage: any = { deleteUrl: jest.fn().mockResolvedValue(false) };
    const auditoria: any = { registrar: jest.fn().mockResolvedValue(undefined) };
    const svc = new VisitantesService(
      prisma, {} as any, storage, {} as any, auditoria, {} as any, {} as any, {} as any,
    );
    await svc.tickRetencaoDadosVisitantes(90);
    expect(storage.deleteUrl).toHaveBeenCalledWith(
      'https://pub.example.com/documentos/ata.pdf',
      PREFIXOS_FOTO_VISITANTE,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts storage-delete-prefixo`
Expected: FAIL — `PREFIXOS_FOTO_VISITANTE` é `undefined`; `deleteUrl('https://pub.example.com/documentos/ata.pdf', undefined)` devolve `true` e chama `client.send`; o `toHaveBeenCalledWith(..., PREFIXOS_FOTO_VISITANTE)` não bate (chamado só com a URL).

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/common/storage/storage.service.ts`, logo após a linha 40 (`const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;`):

```ts

/**
 * Pastas do bucket que o expurgo de cada dono pode apagar. O valor da foto
 * vem do cliente (URL não-data é guardada como veio), então o expurgo nunca
 * pode apagar fora da pasta onde o próprio fluxo grava.
 */
export const PREFIXOS_FOTO_CONVITE: readonly string[] = ['convites/'];
/** Foto de visitante nasce em visitantes/ ou é herdada do convite (convites/). */
export const PREFIXOS_FOTO_VISITANTE: readonly string[] = ['visitantes/', 'convites/'];
```

E `deleteUrl` (linhas 153-178). Antes:

```ts
  /**
   * Remove um arquivo do R2/S3 a partir de sua URL pública ou key (expurgo LGPD).
   */
  async deleteUrl(url: string | null | undefined): Promise<boolean> {
```

Depois:

```ts
  /**
   * Remove um arquivo do R2/S3 a partir de sua URL pública ou key (expurgo LGPD).
   * Só apaga se a key estiver dentro de um dos `prefixosPermitidos` (pasta do
   * dono — ver PREFIXOS_FOTO_*); lista vazia não apaga nada.
   */
  async deleteUrl(
    url: string | null | undefined,
    prefixosPermitidos: readonly string[],
  ): Promise<boolean> {
```

e, no mesmo método, antes:

```ts
      if (!key || key.split('/').includes('..')) return false;
```

Depois:

```ts
      if (!key || key.split('/').includes('..')) return false;
      if (!(prefixosPermitidos ?? []).some((p) => key.startsWith(p))) {
        this.logger.warn('deleteUrl: objeto fora da pasta do dono, ignorado.');
        return false;
      }
```

Em `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts`, linha 16. Antes:

```ts
import { StorageService } from '../common/storage/storage.service';
```

Depois:

```ts
import { PREFIXOS_FOTO_VISITANTE, StorageService } from '../common/storage/storage.service';
```

Linhas 225-226. Antes:

```ts
            this.storage.deleteUrl(v.foto_pessoa),
            this.storage.deleteUrl(v.foto_documento),
```

Depois:

```ts
            this.storage.deleteUrl(v.foto_pessoa, PREFIXOS_FOTO_VISITANTE),
            this.storage.deleteUrl(v.foto_documento, PREFIXOS_FOTO_VISITANTE),
```

Linhas 301-302. Antes:

```ts
          this.storage.deleteUrl(pessoa.foto_pessoa),
          this.storage.deleteUrl(pessoa.foto_documento),
```

Depois:

```ts
          this.storage.deleteUrl(pessoa.foto_pessoa, PREFIXOS_FOTO_VISITANTE),
          this.storage.deleteUrl(pessoa.foto_documento, PREFIXOS_FOTO_VISITANTE),
```

Em `click-cond-web/apps/api/src/app/convites/convites.service.ts`, linha 12. Antes:

```ts
import { StorageService } from '../common/storage/storage.service';
```

Depois:

```ts
import { PREFIXOS_FOTO_CONVITE, StorageService } from '../common/storage/storage.service';
```

Linha 141. Antes:

```ts
            await this.storage.deleteUrl(c.foto_url);
```

Depois:

```ts
            await this.storage.deleteUrl(c.foto_url, PREFIXOS_FOTO_CONVITE);
```

Linha 591. Antes:

```ts
        await this.storage.deleteUrl(fotoParaApagar);
```

Depois:

```ts
        await this.storage.deleteUrl(fotoParaApagar, PREFIXOS_FOTO_CONVITE);
```

Atualizar os specs existentes à nova assinatura:

`click-cond-web/apps/api/src/app/common/security-hardening.spec.ts`, teste "deleteUrl só apaga objetos do próprio storage". Antes:

```ts
    expect(await svc.deleteUrl('https://evil.example.org/documentos/segredo.pdf')).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/../x')).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
    expect(await svc.deleteUrl('https://pub.example.com/fotos/a.png')).toBe(true);
```

Depois:

```ts
    expect(await svc.deleteUrl('https://evil.example.org/documentos/segredo.pdf', ['documentos/'])).toBe(false);
    expect(await svc.deleteUrl('https://pub.example.com/../x', ['fotos/'])).toBe(false);
    expect(svc.client.send).not.toHaveBeenCalled();
    expect(await svc.deleteUrl('https://pub.example.com/fotos/a.png', ['fotos/'])).toBe(true);
```

`click-cond-web/apps/api/src/app/visitantes/retencao-lgpd-pessoas.spec.ts`: na linha 1, depois de `import { VisitantesService } from './visitantes.service';`, acrescentar:

```ts
import { PREFIXOS_FOTO_VISITANTE } from '../common/storage/storage.service';
```

e trocar (linhas 50-51). Antes:

```ts
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/rosto.jpg');
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/doc.jpg');
```

Depois:

```ts
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/rosto.jpg', PREFIXOS_FOTO_VISITANTE);
    expect(storage.deleteUrl).toHaveBeenCalledWith('https://r2/doc.jpg', PREFIXOS_FOTO_VISITANTE);
```

`click-cond-web/apps/api/src/app/convites/convites.spec.ts`: depois da linha 3 (`import { ConvitesService, MAX_CONVITES_ATIVOS } from './convites.service';`), acrescentar:

```ts
import { PREFIXOS_FOTO_CONVITE } from '../common/storage/storage.service';
```

e trocar a linha 366 `expect(storage.deleteUrl).toHaveBeenCalledWith('https://cdn/foto.jpg');` por:

```ts
      expect(storage.deleteUrl).toHaveBeenCalledWith('https://cdn/foto.jpg', PREFIXOS_FOTO_CONVITE);
```

e a linha 538 `expect(storage.deleteUrl).toHaveBeenCalledWith('https://cdn/f.jpg');` por:

```ts
      expect(storage.deleteUrl).toHaveBeenCalledWith('https://cdn/f.jpg', PREFIXOS_FOTO_CONVITE);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts storage-delete-prefixo security-hardening retencao-lgpd-pessoas convites visitantes`
Expected: PASS.

Run também a checagem de tipos (a assinatura nova obriga todos os chamadores): `cd C:/w/sec/click-cond-web && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: sem erros de `deleteUrl` (nenhuma chamada sem o 2º argumento).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/common/storage/storage.service.ts click-cond-web/apps/api/src/app/common/storage/storage-delete-prefixo.spec.ts click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts click-cond-web/apps/api/src/app/convites/convites.service.ts click-cond-web/apps/api/src/app/common/security-hardening.spec.ts click-cond-web/apps/api/src/app/visitantes/retencao-lgpd-pessoas.spec.ts click-cond-web/apps/api/src/app/convites/convites.spec.ts
git commit -m "fix(security): expurgo LGPD so apaga objetos dentro da pasta do dono

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B6: Etiqueta impressa de encomenda escapa os campos (XSS armazenado no popup)

Fingerprint: `portaria-web/encomendas-print-document-write-stored-xss`

`imprimir()` e `imprimirLote()` montam HTML por interpolação crua de `descricao`, `recebido_de`, `destinatario_apto`, `destinatario_bloco` (o morador controla via `POST /encomendas/cadastrar`) e fazem `document.write` num popup `about:blank` com a origem da portaria — `<img src=x onerror=...>` lê o `portaria_token`. Correção: `esc()` (escapa `& < > " '`) em todo campo interpolado dos dois templates.

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.imprimir.spec.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts:9-10,471-474,492,502-505`

**Interfaces:**
- Consumes: nada.
- Produces: função de módulo `esc(v: unknown): string` (não exportada) em `encomendas-page.component.ts`.

- [ ] **Step 1: Write the failing test**

`click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.imprimir.spec.ts`:

```ts
import { signal } from '@angular/core';
import { EncomendasPageComponent } from './encomendas-page.component';

/**
 * O morador pré-cadastra a encomenda (descricao, recebido_de, apto, bloco) e o
 * porteiro imprime a etiqueta: o HTML ia por document.write num popup com a
 * origem da portaria — um <img onerror> lia o token do operador.
 */
describe('EncomendasPageComponent — etiqueta impressa escapa os campos', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const encomenda: any = {
    id: 7,
    destinatario_bloco: `B${payload}`,
    destinatario_apto: `101${payload}`,
    descricao: `Caixa ${payload}`,
    recebido_de: `Loja ${payload}`,
    recebido_em: '2026-10-20T12:00:00Z',
    status: 'Esperando',
  };
  let escrito: string;
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    escrito = '';
    const popup: any = {
      document: {
        write: (h: string) => {
          escrito += h;
        },
        close: () => undefined,
      },
    };
    openSpy = jest.spyOn(window, 'open').mockReturnValue(popup);
  });

  afterEach(() => openSpy.mockRestore());

  function tela(): EncomendasPageComponent {
    const t = Object.create(EncomendasPageComponent.prototype) as any;
    t.encomendas = signal([encomenda]);
    t.selecionadas = signal(new Set([7]));
    return t;
  }

  it('imprimir() não injeta HTML vindo do morador', () => {
    tela().imprimir(encomenda);
    expect(escrito).not.toContain('<img');
    expect(escrito).toContain('Caixa &lt;img src=x onerror=alert(1)&gt;');
    expect(escrito).toContain('Loja &lt;img');
    expect(escrito).toContain('B&lt;img');
    expect(escrito).toContain('101&lt;img');
  });

  it('imprimirLote() não injeta HTML vindo do morador', () => {
    tela().imprimirLote();
    expect(escrito).not.toContain('<img');
    expect(escrito).toContain('Caixa &lt;img src=x onerror=alert(1)&gt;');
    expect(escrito).toContain('101&lt;img');
    expect(escrito).toContain('B&lt;img');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/encomendas/encomendas-page.imprimir`
Expected: FAIL — `expect(escrito).not.toContain('<img')` falha nos dois testes (o HTML contém `<img src=x onerror=alert(1)>`).

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts`, depois da linha 9 (`import { Apartamento, ApartamentosApi } from '../apartamentos/apartamentos.service';`):

```ts

/**
 * Escapa texto para o HTML das etiquetas: document.write não passa pelo escape
 * do Angular, e descricao/recebido_de/apto/bloco vêm do morador.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Em `imprimirLote()` (linhas 471-474). Antes:

```ts
          <div class="id">Encomenda #${e.id}</div>
          <div class="apto">${e.destinatario_bloco ? e.destinatario_bloco + ' / ' : ''}${e.destinatario_apto}</div>
          <div class="desc">${e.descricao}</div>
          <div class="meta">Recebido de: ${e.recebido_de ?? '—'}<br>Em: ${new Date(e.recebido_em).toLocaleString('pt-BR')}</div>
```

Depois:

```ts
          <div class="id">Encomenda #${esc(e.id)}</div>
          <div class="apto">${e.destinatario_bloco ? esc(e.destinatario_bloco) + ' / ' : ''}${esc(e.destinatario_apto)}</div>
          <div class="desc">${esc(e.descricao)}</div>
          <div class="meta">Recebido de: ${esc(e.recebido_de ?? '—')}<br>Em: ${esc(new Date(e.recebido_em).toLocaleString('pt-BR'))}</div>
```

Em `imprimir()`, linha 492. Antes:

```ts
      <html><head><title>Etiqueta #${e.id}</title>
```

Depois:

```ts
      <html><head><title>Etiqueta #${esc(e.id)}</title>
```

E linhas 502-505 (mesmo bloco, com 8 espaços de indentação). Antes:

```ts
        <div class="id">Encomenda #${e.id}</div>
        <div class="apto">${e.destinatario_bloco ? e.destinatario_bloco + ' / ' : ''}${e.destinatario_apto}</div>
        <div class="desc">${e.descricao}</div>
        <div class="meta">Recebido de: ${e.recebido_de ?? '—'}<br>Em: ${new Date(e.recebido_em).toLocaleString('pt-BR')}</div>
```

Depois:

```ts
        <div class="id">Encomenda #${esc(e.id)}</div>
        <div class="apto">${e.destinatario_bloco ? esc(e.destinatario_bloco) + ' / ' : ''}${esc(e.destinatario_apto)}</div>
        <div class="desc">${esc(e.descricao)}</div>
        <div class="meta">Recebido de: ${esc(e.recebido_de ?? '—')}<br>Em: ${esc(new Date(e.recebido_em).toLocaleString('pt-BR'))}</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/encomendas`
Expected: PASS (inclui `encomendas-page.linha.spec.ts` e `encomendas-page.erro-recebida.spec.ts`).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.component.ts click-cond-web/apps/portaria-web/src/app/encomendas/encomendas-page.imprimir.spec.ts
git commit -m "fix(security): etiqueta de encomenda escapa os campos antes do document.write

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B7: Preview ao vivo do agente só para o portaria-web (sem CORS `*`, com checagem de Host)

Fingerprint: `agent-liveview-loopback-unauthenticated-cors-wildcard`

`startLiveViewServer` (agent/src/index.js) responde `/snapshot` e `/liveview` com `Access-Control-Allow-Origin: *` e não olha `Host`: qualquer site aberto no PC da portaria lê o quadro da câmera via `fetch`, e uma página com DNS rebinding alcança o servidor. Consumidores reais: `apps/portaria-web/src/app/shared/facial-capture.component.ts` (`<img src=http://localhost:8788/liveview>` e `fetch('http://localhost:8788/snapshot')`) e `terminais-faciais-page.component.ts:1162` (`<img>` do `/liveview`). Correção: `Host` tem de ser `127.0.0.1:<porta>` ou `localhost:<porta>`; `Origin`, quando presente, tem de estar na lista do portaria-web (mesmas de `CORS_ORIGINS_PRINCIPAIS` da API + `LIVEVIEW_ORIGINS` do `.env`), e o ACAO devolve essa origem (nunca `*`). `<img>` não manda `Origin` e segue funcionando; o consumidor não muda. O token por execução fica para o dono (ver "Deferred").

**Files:**
- Create: `click-cond-web/agent/src/core/liveview-acesso.js`
- Create: `click-cond-web/agent/test/core-liveview-acesso.test.js`
- Modify: `click-cond-web/agent/src/index.js:61` (require), `:591-602` (início de `startLiveViewServer`)

**Interfaces:**
- Consumes: nada.
- Produces: `avaliarAcessoLiveView(headers: object, porta: number, origens: string[]): { permitido: boolean, origem: string | null }`, `origensLiveView(env?: object): string[]`, `ORIGENS_PORTARIA: string[]` em `agent/src/core/liveview-acesso.js`. Env opcional nova do agente: `LIVEVIEW_ORIGINS` (lista separada por vírgula).

- [ ] **Step 1: Write the failing test**

`click-cond-web/agent/test/core-liveview-acesso.test.js`:

```js
'use strict';

/**
 * agent/src/core/liveview-acesso.js — quem pode usar o preview ao vivo local
 * (127.0.0.1:8788/liveview e /snapshot). Antes: ACAO "*" e nenhum Host
 * checado — qualquer site lia o quadro da câmera da portaria.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { avaliarAcessoLiveView, origensLiveView } = require('../src/core/liveview-acesso');

const ORIGENS = origensLiveView({});
const PORTA = 8788;

test('Host diferente de 127.0.0.1/localhost:porta é recusado (DNS rebinding)', () => {
  for (const host of ['evil.example:8788', '127.0.0.1:9999', 'localhost', '', undefined]) {
    assert.deepEqual(avaliarAcessoLiveView({ host }, PORTA, ORIGENS), { permitido: false, origem: null }, String(host));
  }
});

test('origem fora da lista é recusada e não recebe ACAO', () => {
  for (const origin of ['https://evil.example', 'null', 'http://localhost:8788']) {
    assert.deepEqual(
      avaliarAcessoLiveView({ host: '127.0.0.1:8788', origin }, PORTA, ORIGENS),
      { permitido: false, origem: null },
      origin,
    );
  }
});

test('portaria-web recebe ACAO com a própria origem (nunca "*")', () => {
  assert.deepEqual(
    avaliarAcessoLiveView({ host: 'localhost:8788', origin: 'https://www.prestarecondominios.com.br' }, PORTA, ORIGENS),
    { permitido: true, origem: 'https://www.prestarecondominios.com.br' },
  );
});

test('<img> (sem Origin) no Host certo passa, sem ACAO', () => {
  assert.deepEqual(avaliarAcessoLiveView({ host: 'localhost:8788' }, PORTA, ORIGENS), { permitido: true, origem: null });
});

test('LIVEVIEW_ORIGINS acrescenta origens à lista', () => {
  const origens = origensLiveView({ LIVEVIEW_ORIGINS: 'https://portaria.exemplo.com, http://localhost:4300' });
  assert.ok(origens.includes('https://portaria.exemplo.com'));
  assert.ok(origens.includes('http://localhost:4300'));
  assert.ok(origens.includes('https://www.prestarecondominios.com.br'));
});

test('index.js não manda mais Access-Control-Allow-Origin "*" e usa avaliarAcessoLiveView', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.doesNotMatch(fonte, /Access-Control-Allow-Origin',\s*'\*'/);
  assert.match(fonte, /avaliarAcessoLiveView\(req\.headers, LIVEVIEW_PORT, origensPreview\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/core-liveview-acesso.test.js`
Expected: FAIL — `Cannot find module '../src/core/liveview-acesso'`.

- [ ] **Step 3: Write minimal implementation**

Criar `click-cond-web/agent/src/core/liveview-acesso.js` (CRLF, como os demais de `src/`):

```js
'use strict';

/**
 * Quem pode usar o preview ao vivo local (http://127.0.0.1:8788/liveview e
 * /snapshot). O servidor só escuta em 127.0.0.1, mas isso não basta:
 *  - qualquer site aberto no navegador da portaria fazia fetch('/snapshot')
 *    e LIA o quadro da câmera (o agente respondia ACAO "*");
 *  - uma página com DNS rebinding chega ao 127.0.0.1 com Host do atacante.
 * Regras: Host tem de ser 127.0.0.1:<porta> ou localhost:<porta>; Origin, se
 * vier (fetch), tem de ser do portaria-web — e o ACAO devolve essa origem,
 * nunca "*". <img> não manda Origin e continua funcionando.
 */

// Mesmas de CORS_ORIGINS_PRINCIPAIS da API (apps/api/src/app/common/cors-origins.ts)
// que servem o portaria-web. Outras: LIVEVIEW_ORIGINS no .env do agente.
const ORIGENS_PORTARIA = [
  'https://clickprestarecondominios.com.br',
  'https://www.clickprestarecondominios.com.br',
  'https://prestarecondominios.com.br',
  'https://www.prestarecondominios.com.br',
  'https://main.d340ziyanv9pav.amplifyapp.com',
  'http://localhost:4200',
];

function origensLiveView(env = process.env) {
  const extras = String((env && env.LIVEVIEW_ORIGINS) || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...ORIGENS_PORTARIA, ...extras])];
}

function avaliarAcessoLiveView(headers, porta, origens) {
  const host = String((headers && headers.host) || '').toLowerCase();
  if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) {
    return { permitido: false, origem: null };
  }
  const origin = headers && headers.origin;
  if (origin === undefined) return { permitido: true, origem: null };
  if (!origens.includes(origin)) return { permitido: false, origem: null };
  return { permitido: true, origem: origin };
}

module.exports = { avaliarAcessoLiveView, origensLiveView, ORIGENS_PORTARIA };
```

Em `click-cond-web/agent/src/index.js`, depois da linha 61 (`const controlidFacial = require('./drivers/controlid-facial');`):

```js
const { avaliarAcessoLiveView, origensLiveView } = require('./core/liveview-acesso');
```

E o início de `startLiveViewServer` (linhas 591-602). Antes:

```js
function startLiveViewServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const reqPath = (req.url || '').split('?')[0];
```

Depois:

```js
function startLiveViewServer() {
  // Só o portaria-web lê o preview: Host local + Origin da lista (ver core/liveview-acesso.js).
  const origensPreview = origensLiveView(process.env);
  const server = http.createServer((req, res) => {
    const acesso = avaliarAcessoLiveView(req.headers, LIVEVIEW_PORT, origensPreview);
    if (!acesso.permitido) {
      res.writeHead(403);
      return res.end('origem nao autorizada');
    }
    res.setHeader('Vary', 'Origin');
    if (acesso.origem) res.setHeader('Access-Control-Allow-Origin', acesso.origem);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const reqPath = (req.url || '').split('?')[0];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/core-liveview-acesso.test.js && npm test`
Expected: PASS (6 testes novos; a suíte inteira do agente, incluindo `bundle.test.js`, continua verde).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/agent/src/core/liveview-acesso.js click-cond-web/agent/test/core-liveview-acesso.test.js click-cond-web/agent/src/index.js
git commit -m "fix(security): preview ao vivo do agente so responde ao portaria-web (sem CORS *, Host checado)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B8: Agente não manda a senha do terminal em Basic antes do desafio

Fingerprint: `agent-lan-preemptive-basic-auth-cleartext`

`request()` (agent/src/lib/http.js) põe `Authorization: Basic base64(user:pass)` na PRIMEIRA requisição sempre que há `opts.auth`; `lanRequest()` usa `http://` (salvo porta 443) — a senha de admin do terminal trafega em texto reversível na LAN, mesmo para Dahua/Hikvision que exigem Digest. Correção: primeira requisição sem credencial; 401 com desafio Digest → Digest (como hoje); 401 com desafio Basic → só então Basic; sem desafio reconhecido → devolve o 401.

**Files:**
- Modify: `click-cond-web/agent/src/lib/http.js:44-51,86-111,151-152`
- Modify: `click-cond-web/agent/test/lib-http.test.js` (acrescentar testes no fim)

**Interfaces:**
- Consumes: nada.
- Produces: `request(urlStr, opts)` com o mesmo contrato de retorno; muda só quando a credencial é enviada.

- [ ] **Step 1: Write the failing test**

Acrescentar ao fim de `click-cond-web/agent/test/lib-http.test.js` (usa o helper `comServidor` já definido no arquivo):

```js
test('request(): sem Basic preventivo — aparelho Digest nunca vê a senha em Base64', async () => {
  const vistos = [];
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n1", qop="auth"' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    const res = await request(`${url}/cgi-bin/magicBox.cgi`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 200);
    assert.equal(vistos[0], '');
    assert.ok(vistos.every((h) => !/^Basic /i.test(h)), vistos.join(' | '));
  } finally {
    await fechar();
  }
});

test('request(): Basic só depois de um 401 com desafio Basic', async () => {
  const vistos = [];
  const esperado = `Basic ${Buffer.from('admin:segredo').toString('base64')}`;
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (req.headers.authorization !== esperado) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
      return res.end();
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const res = await request(`${url}/x`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 200);
    assert.deepEqual(vistos, ['', esperado]);
  } finally {
    await fechar();
  }
});

test('request(): 401 sem desafio reconhecido não reenvia credencial', async () => {
  const vistos = [];
  const { url, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    res.writeHead(401);
    res.end();
  });
  try {
    const res = await request(`${url}/x`, { auth: { user: 'admin', pass: 'segredo' } });
    assert.equal(res.status, 401);
    assert.deepEqual(vistos, ['']);
  } finally {
    await fechar();
  }
});

test('lanRequest(): aparelho Hikvision/Dahua (Digest) não recebe Basic na LAN', async () => {
  const vistos = [];
  const { port, fechar } = await comServidor((req, res) => {
    vistos.push(req.headers.authorization || '');
    if (!/^Digest /.test(req.headers.authorization || '')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n2", qop="auth"' });
      return res.end();
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const device = { ip: '127.0.0.1', porta: port, fabricante: 'hikvision', api_user: 'admin', api_password: 'segredo' };
    const res = await lanRequest(device, 'GET', '/ISAPI/System/deviceInfo', {}, 5000);
    assert.equal(res.status, 200);
    assert.ok(vistos.every((h) => !/^Basic /i.test(h)), vistos.join(' | '));
  } finally {
    await fechar();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/lib-http.test.js`
Expected: FAIL — "sem Basic preventivo" (`vistos[0]` é `Basic YWRtaW46c2VncmVkbw==`), "Basic só depois de um 401" (`vistos` é `['Basic ...']`, uma requisição só), "401 sem desafio" (`vistos` é `['Basic ...']`) e o teste de `lanRequest` (primeira requisição leva Basic).

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/agent/src/lib/http.js`, dentro de `request()` (linhas 44-51). Antes:

```js
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (opts.auth && !headers.Authorization) {
      const tok = Buffer.from(`${opts.auth.user}:${opts.auth.pass}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${tok}`;
    }
```

Depois:

```js
    // Credencial NUNCA vai na primeira requisição: Basic preventivo mandava a
    // senha de admin do terminal em Base64 (texto claro) pela LAN, mesmo para
    // aparelhos que só aceitam Digest. Ela só sai depois do 401 (ver abaixo).
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
```

E o tratamento do 401 (linhas 86-111). Antes:

```js
        // Desafio Digest (ex.: Hikvision): recalcula e repete uma vez.
        const wa = res.headers['www-authenticate'] || '';
        if (
          res.statusCode === 401 &&
          opts.auth &&
          !opts._retry &&
          /digest/i.test(wa)
        ) {
          try {
            const dh = buildDigestHeader(
              opts.auth.user,
              opts.auth.pass,
              reqOpts.method,
              reqOpts.path,
              wa,
            );
            return resolve(
              request(urlStr, {
                ...opts,
                _retry: true,
                auth: undefined,
                headers: { ...(opts.headers || {}), Authorization: dh },
              }),
            );
          } catch (e) {
            /* cai para a resposta 401 normal */
          }
        }
```

Depois:

```js
        // 401 com desafio: Digest (Hikvision/Dahua) se oferecido; Basic só se
        // o aparelho pedir Basic. Repete uma vez com a credencial.
        const wa = res.headers['www-authenticate'] || '';
        if (res.statusCode === 401 && opts.auth && !opts._retry) {
          let authorization = null;
          if (/digest/i.test(wa)) {
            try {
              authorization = buildDigestHeader(
                opts.auth.user,
                opts.auth.pass,
                reqOpts.method,
                reqOpts.path,
                wa,
              );
            } catch (e) {
              /* cai para a resposta 401 normal */
            }
          } else if (/^\s*basic\b/i.test(wa)) {
            authorization = `Basic ${Buffer.from(`${opts.auth.user}:${opts.auth.pass}`).toString('base64')}`;
          }
          if (authorization) {
            return resolve(
              request(urlStr, {
                ...opts,
                _retry: true,
                auth: undefined,
                headers: { ...(opts.headers || {}), Authorization: authorization },
              }),
            );
          }
        }
```

E o comentário em `lanRequest` (linhas 151-152). Antes:

```js
  // control_id usa sessão (na query), não auth por header. Para os demais,
  // request() tenta Basic e cai para Digest se o aparelho exigir (Hikvision).
```

Depois:

```js
  // control_id usa sessão (na query), não auth por header. Para os demais,
  // request() manda a credencial só depois do 401: Digest se o aparelho
  // oferecer, Basic só se ele pedir Basic.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web/agent && node --test test/lib-http.test.js && npm test`
Expected: PASS (todos os testes de `lib-http.test.js`, novos e antigos, e a suíte inteira do agente).

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/agent/src/lib/http.js click-cond-web/agent/test/lib-http.test.js
git commit -m "fix(security): agente so envia credencial do terminal depois do desafio 401 (sem Basic preventivo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B9: Pasta do agente (tarefa SYSTEM) trancada com icacls nos dois instaladores

Fingerprint: `agent-system-task-user-writable-install-dir`

Os dois instaladores registram `ClickPortariaAgent` como `/RU SYSTEM /RL HIGHEST` apontando para `run-agent-service.cmd`/`click-agent.exe` na pasta de onde o `.bat` rodou (`%~dp0`), sem ACL. Se um usuário comum pode escrever ali, troca o exe/.cmd e ganha SYSTEM, ou lê o `AGENT_TOKEN` do `.env`. Correção:
- **Instalador do portal** (`montarInstaladorBat`): instala em `%ProgramFiles%\ClickAgente\` (não mais na pasta de Downloads) e tranca a pasta ANTES de gravar `.env` e registrar a tarefa.
- **`agent/install-windows.bat`** (instalação manual em pasta própria, ex.: `C:\ClickAgente`): tranca a própria pasta (`%~dp0`) antes do `schtasks /Create`, e recusa rodar dentro de `X:\Users\...` (trancar Downloads/Desktop tiraria o acesso do usuário à pasta).
- O bloco de `icacls` é a constante `LINHAS_TRANCAR_PASTA_AGENTE` (`facial.service.ts`) e aparece idêntico nos dois arquivos (teste confere), como já acontece com `LINHAS_ECHO_LACO_SERVICO`.

ACL resultante: só SYSTEM (`S-1-5-18`) e Administradores (`S-1-5-32-544`), dono = Administradores, filhos resetados para herdar. **Impacto operacional para o dono:** `agent-service.log` e `status-agent.cmd` passam a exigir um prompt de administrador para leitura; instalações feitas pelo portal passam a viver em `C:\Program Files\ClickAgente\` (a pasta antiga em Downloads deixa de ser usada e pode ser apagada — ela ainda contém o `.env` antigo com o token).

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts:220-223` (nova constante após `COMANDO_AJUSTE_TAREFA`), `:248-307` (`montarInstaladorBat`)
- Modify: `click-cond-web/agent/install-windows.bat:10-12,36-37` (CRLF)
- Modify: `click-cond-web/apps/api/src/app/facial/agent-installer-bat.spec.ts:3,9` (import + helper) e dois testes novos

**Interfaces:**
- Consumes: nada.
- Produces: `export const LINHAS_TRANCAR_PASTA_AGENTE: readonly string[]` em `apps/api/src/app/facial/facial.service.ts` (linhas usam `%DIR%`, com barra final).

- [ ] **Step 1: Write the failing test**

Em `click-cond-web/apps/api/src/app/facial/agent-installer-bat.spec.ts`, trocar a linha 3. Antes:

```ts
import { COMANDO_AJUSTE_TAREFA, FacialService, LINHAS_ECHO_LACO_SERVICO } from './facial.service';
```

Depois:

```ts
import {
  COMANDO_AJUSTE_TAREFA,
  FacialService,
  LINHAS_ECHO_LACO_SERVICO,
  LINHAS_TRANCAR_PASTA_AGENTE,
} from './facial.service';
```

Depois da função `linhasDe` (termina na linha 9), acrescentar:

```ts

/** Índice da 1ª linha onde `bloco` aparece inteiro e contíguo em `linhas`; -1 se não aparece. */
function indiceDoBloco(linhas: string[], bloco: readonly string[]): number {
  for (let i = 0; i + bloco.length <= linhas.length; i++) {
    if (bloco.every((l, j) => linhas[i + j] === l)) return i;
  }
  return -1;
}
```

Dentro do `describe('FacialService.getAgentConfigFile(bat) — laço de reinício (tarefa 9)', ...)`, acrescentar (antes do `});` que fecha o describe):

```ts
  it('B9: instala em %ProgramFiles%\\ClickAgente (não em Downloads) e tranca a pasta antes do .env e da tarefa SYSTEM', () => {
    const linhas = linhasDe(conteudo);
    expect(linhas).toContain('set "DIR=%ProgramFiles%\\ClickAgente\\"');
    expect(linhas).not.toContain('set "DIR=%~dp0"');
    expect(LINHAS_TRANCAR_PASTA_AGENTE[0]).toBe(
      'icacls "%DIR%." /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q',
    );
    const idxMkdir = linhas.indexOf('if not exist "%DIR%" mkdir "%DIR%"');
    const idxAcl = indiceDoBloco(linhas, LINHAS_TRANCAR_PASTA_AGENTE);
    const idxEnv = linhas.indexOf('echo AGENT_TOKEN=token-fixo-123');
    const idxCreate = linhas.findIndex((l) => l.startsWith('schtasks /Create '));
    expect(idxMkdir).toBeGreaterThan(-1);
    expect(idxAcl).toBeGreaterThan(idxMkdir);
    expect(idxEnv).toBeGreaterThan(idxAcl);
    expect(idxCreate).toBeGreaterThan(idxAcl);
  });
```

Dentro do `describe('agent/install-windows.bat — mesmo laço de reinício e rotação de log', ...)`, acrescentar:

```ts
  it('B9: recusa pasta de perfil e tranca a pasta (só SYSTEM e Administradores) antes de registrar a tarefa SYSTEM', () => {
    const linhas = linhasDe(conteudo);
    expect(linhas).toContain('set "DIR=%~dp0"');
    const idxGuarda = linhas.indexOf('if /I "%DIR:~1,8%"==":\\Users\\" (');
    const idxAcl = indiceDoBloco(linhas, LINHAS_TRANCAR_PASTA_AGENTE);
    const idxCreate = linhas.findIndex((l) => l.startsWith('schtasks /Create '));
    expect(idxGuarda).toBeGreaterThan(-1);
    expect(idxAcl).toBeGreaterThan(idxGuarda);
    expect(idxCreate).toBeGreaterThan(idxAcl);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts agent-installer-bat`
Expected: FAIL — os dois testes "B9" falham (`LINHAS_TRANCAR_PASTA_AGENTE` é `undefined` → `TypeError: Cannot read properties of undefined`); os demais continuam verdes.

- [ ] **Step 3: Write minimal implementation**

Em `click-cond-web/apps/api/src/app/facial/facial.service.ts`, logo depois da constante `COMANDO_AJUSTE_TAREFA` (termina na linha 223):

```ts

/**
 * Tranca a pasta do agente: a tarefa roda como SYSTEM, entao so SYSTEM
 * (S-1-5-18) e Administradores (S-1-5-32-544) podem escrever ou ler ali - sem
 * isto um usuario comum trocava o click-agent.exe/run-agent-service.cmd e
 * ganhava SYSTEM, ou lia o AGENT_TOKEN do .env. Dono vira Administradores e os
 * arquivos existentes voltam a herdar a ACL da pasta. Usa %DIR% (com a barra
 * final). As MESMAS linhas estao em agent/install-windows.bat (um teste confere).
 */
export const LINHAS_TRANCAR_PASTA_AGENTE: readonly string[] = [
  'icacls "%DIR%." /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q',
  'if errorlevel 1 (',
  '  echo [ERRO] Nao consegui proteger a pasta do agente. Rode este arquivo como Administrador.',
  '  pause',
  '  exit /b 1',
  ')',
  'icacls "%DIR%." /setowner *S-1-5-32-544 /T /C /Q >nul',
  'icacls "%DIR%*" /reset /T /C /Q >nul',
];
```

Em `montarInstaladorBat`, no array `linhas`. Antes:

```ts
  const linhas = [
    '@echo off',
    'setlocal',
    'set "DIR=%~dp0"',
```

Depois:

```ts
  const linhas = [
    '@echo off',
    'setlocal',
    // Pasta fixa e protegida - nao a pasta de onde o .bat rodou (Downloads),
    // que qualquer usuario escreve: a tarefa roda como SYSTEM.
    'set "DIR=%ProgramFiles%\\ClickAgente\\"',
```

E, no mesmo array. Antes:

```ts
    'if exist "%DIR%atualizacao-falhas.txt" del "%DIR%atualizacao-falhas.txt"',
    '',
    'REM 2) Baixa a versao atual do agente (instala ou atualiza)',
    ...baixaExe,
```

Depois:

```ts
    'if exist "%DIR%atualizacao-falhas.txt" del "%DIR%atualizacao-falhas.txt"',
    '',
    'REM 2) Pasta protegida do agente: so SYSTEM e Administradores (a tarefa roda como SYSTEM)',
    'if not exist "%DIR%" mkdir "%DIR%"',
    ...LINHAS_TRANCAR_PASTA_AGENTE,
    'if not exist "%EXE%" if exist "%~dp0click-agent.exe" copy /y "%~dp0click-agent.exe" "%EXE%" >nul',
    '',
    'REM 3) Baixa a versao atual do agente (instala ou atualiza)',
    ...baixaExe,
```

E renumerar os comentários seguintes no mesmo array: `'REM 3) Escreve a configuracao do condominio'` → `'REM 4) Escreve a configuracao do condominio'`; `'REM 4) Escreve o laco de reinicio (run-agent-service.cmd)'` → `'REM 5) Escreve o laco de reinicio (run-agent-service.cmd)'`; `'REM 5) Inicia com o Windows, sem limite de 72h nem parada na bateria'` → `'REM 6) Inicia com o Windows, sem limite de 72h nem parada na bateria'`. E a mensagem final. Antes:

```ts
    'echo Pronto! Agente instalado e rodando. Confira "Agente conectado" no portal.',
```

Depois:

```ts
    'echo Pronto! Agente instalado em %DIR% e rodando. Confira "Agente conectado" no portal.',
```

Em `click-cond-web/agent/install-windows.bat` (manter CRLF). Linhas 10-12. Antes:

```bat
setlocal
set TASK=ClickPortariaAgent
set EXE=%~dp0click-agent.exe
```

Depois:

```bat
setlocal
set TASK=ClickPortariaAgent
set EXE=%~dp0click-agent.exe
set "DIR=%~dp0"
```

E entre o fim do passo 1 e o aviso do `.env` (linhas 36-37). Antes:

```bat
if exist "%~dp0atualizacao-falhas.txt" del "%~dp0atualizacao-falhas.txt"

if not exist "%~dp0.env" (
```

Depois:

```bat
if exist "%~dp0atualizacao-falhas.txt" del "%~dp0atualizacao-falhas.txt"

REM Pasta do agente: a tarefa roda como SYSTEM, entao so SYSTEM e
REM Administradores podem escrever aqui - senao qualquer usuario troca o
REM click-agent.exe/run-agent-service.cmd e ganha SYSTEM, ou le o AGENT_TOKEN.
REM Pasta de perfil (Downloads, Desktop...) nao: trancar tiraria o acesso do
REM usuario a ela. As linhas do icacls sao IDENTICAS as do instalador do portal
REM (LINHAS_TRANCAR_PASTA_AGENTE em apps/api/src/app/facial/facial.service.ts).
if /I "%DIR:~1,8%"==":\Users\" (
  echo [ERRO] Instale numa pasta propria, ex.: C:\ClickAgente - nao dentro de C:\Users.
  pause
  exit /b 1
)
icacls "%DIR%." /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q
if errorlevel 1 (
  echo [ERRO] Nao consegui proteger a pasta do agente. Rode este arquivo como Administrador.
  pause
  exit /b 1
)
icacls "%DIR%." /setowner *S-1-5-32-544 /T /C /Q >nul
icacls "%DIR%*" /reset /T /C /Q >nul

if not exist "%~dp0.env" (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/w/sec/click-cond-web && NODE_ENV=test npx jest -c apps/api/jest.config.cts agent-installer-bat agent-config-url`
Expected: PASS (testes B9 e todos os anteriores: ordem End→kill→download→cmd→run, bloco do laço idêntico, `CMDFILE`/`NOVO` em `%DIR%`).

Verificação manual recomendada numa VM Windows (não automatizável aqui): rodar o `.bat` do portal como Administrador a partir de Downloads; `icacls "C:\Program Files\ClickAgente"` deve listar só `NT AUTHORITY\SYSTEM:(OI)(CI)(F)` e `BUILTIN\Administrators:(OI)(CI)(F)`; um usuário padrão não consegue renomear `click-agent.exe` nem abrir `.env`; `schtasks /Query /TN ClickPortariaAgent /V` mostra `/TR` em `C:\Program Files\ClickAgente\run-agent-service.cmd`.

- [ ] **Step 5: Commit**

```bash
cd C:/w/sec
git add click-cond-web/apps/api/src/app/facial/facial.service.ts click-cond-web/agent/install-windows.bat click-cond-web/apps/api/src/app/facial/agent-installer-bat.spec.ts
git commit -m "fix(security): instaladores do agente trancam a pasta (icacls) antes de registrar a tarefa SYSTEM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deferred to owner

Nenhum fingerprint deste grupo ficou sem task. Ficam para decisão do dono os resíduos abaixo (as tasks acima fecham o vetor principal de cada um):

- **B7 / `agent-liveview-loopback-unauthenticated-cors-wildcard` — token aleatório por execução no `/liveview` e `/snapshot`.** Exige um canal novo nuvem → portaria-web: o agente gera o token, reporta na telemetria (`POST /facial/agent/condo/:token/telemetria`), a API guarda e expõe a operadores autenticados, e `facial-capture.component.ts`/`terminais-faciais-page.component.ts` passam a anexar `?k=<token>`. Muda três componentes e o contrato da telemetria; o B7 já fecha leitura cross-origin e DNS rebinding (sobra só processo local no PC da portaria lendo o quadro).
- **B4 / `facial/device-ip-unvalidated-cloud-direct-http-ssrf` — fallback HTTP direto da nuvem para IP privado.** Com o B4, `ip` só aceita IPv4 de LAN/público ou hostname válido; ainda assim, quando o agente está offline, a API em EB tenta `http://10.x/172.16.x/192.168.x` — o que dentro da AWS é a VPC, não a LAN do condomínio. Bloquear faixas privadas em `FacialDeviceClientService.baseUrl`, ou desligar o fallback direto em produção por env (ex.: `FACIAL_HTTP_DIRETO=false`), é decisão de produto/infra: quebra o uso de API local em dev contra terminais da LAN e o `facial-device-client.integracao.spec.ts` (usa `127.0.0.1`).
- **B5 / `storage:deleteUrl:attacker-supplied-stored-url-deletes-foreign-object` — vínculo objeto ↔ registro.** Com o B5 o expurgo só apaga dentro de `visitantes/`/`convites/`; um usuário que conheça a URL da foto de OUTRO visitante ainda pode copiá-la para o seu registro e fazê-la ser apagada quando o seu expurgo rodar. Fechar isso exige que `resolveFoto` aceite só data URL (ou o valor já gravado no próprio registro) — pode quebrar clientes que reenviam a URL existente no update ou fluxos que copiam a foto do convite — ou uma checagem de "nenhum outro registro referencia esta URL" no expurgo. Decisão de produto.
- **B1 / B2 — rotação da chave do Firebase.** Os pacotes locais `deploy-api-aws.zip`/`eb-package/` contêm `assets/firebase-service-account.json`; se algum foi enviado ao Elastic Beanstalk, a service account precisa ser rotacionada no console do Firebase/GCP (histórico de application versions no EB não é visível no código).
- **B8 (fora do fingerprint, mesmo padrão na API).** `FacialDeviceClientService.send` (`apps/api/src/app/facial/facial-device-client.service.ts:120-126`) também manda Basic preventivo para o terminal no fallback direto da nuvem. Não está entre os fingerprints verificados deste grupo; replicar a lógica do B8 lá é recomendado.
