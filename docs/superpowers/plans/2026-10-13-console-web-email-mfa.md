# MFA por e-mail no console web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exigir MFA por e-mail para o login por senha do console web e permitir confiar com segurança no navegador por 30 dias.

**Architecture:** Um `PortariaMfaService` isolado cria e consome desafios de uso único e tokens de dispositivos confiáveis exclusivos do console. `AuthService` continua autenticando senha e assinando a sessão, mas só a emite quando esse serviço confirma o MFA ou uma confiança válida; o Angular trata a resposta discriminada e só persiste JWT após a confirmação.

**Tech Stack:** NestJS 11, Prisma/MySQL, bcrypt, Node crypto, `@nestjs/throttler`, Angular 21, RxJS, Jest/Nx.

**Spec:** `docs/superpowers/specs/2026-10-13-console-web-email-mfa-design.md`

## Global Constraints

- Não alterar as rotas, tabelas ou contratos do MFA móvel (`MfaService`, `Mfa_Challenges`, `User_Trusted_Devices`).
- MFA vale 10 minutos, aceita no máximo 5 tentativas e reenviar só após 60 segundos.
- O cookie de confiança é `Secure`, `HttpOnly`, `SameSite=Lax`, limitado a autenticação, contém token aleatório bruto e expira em 30 dias; o banco guarda somente SHA-256.
- O desafio, o dispositivo confiável e a emissão do JWT revalidam conta e condomínio ativos; o JWT nunca sai antes da confirmação de MFA sem confiança válida.
- Não incluir senha, JWT, e-mail completo ou erro do provedor de e-mail na resposta de desafio/erro.
- QR Code e duração atual do JWT da portaria permanecem inalterados.
- Toda modificação começa com um teste que falha e termina com testes focados passando e um commit restrito aos arquivos da tarefa.

## Review Focus

- Cookie de outro usuário, papel ou navegador não deve pular MFA; o teste pertence à Tarefa 2.
- Conta ou condomínio desativado após a senha, mas antes do código, não deve receber JWT; o teste pertence à Tarefa 3.
- Reenvio que falha no e-mail não pode deixar desafio novo utilizável; o teste pertence à Tarefa 2.
- Abrir `/verificar-acesso` sem estado transitório ou após expirar deve voltar ao login sem erro de tela; o teste pertence à Tarefa 5.
- Uma resposta de desafio jamais deve acionar `_persist` nem gravar `portaria_token`; o teste pertence à Tarefa 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` | Modelos de desafio e dispositivo confiável do console. |
| `prisma/migrations-manual/2026-10-13-portaria-web-mfa.sql` | DDL idempotente aplicado pelo procedimento de migration manual do repositório. |
| `apps/api/src/app/auth/portaria-mfa.service.ts` | Códigos, desafios, confiança e validação de sessão pendente. |
| `apps/api/src/app/auth/portaria-mfa.service.spec.ts` | Testes unitários dos limites e isolamento do serviço. |
| `apps/api/src/app/auth/auth.service.ts` | Integração da senha, confiança e emissão final de sessão. |
| `apps/api/src/app/auth/auth.controller.ts` | DTOs/rotas de confirmar e reenviar MFA; cookie de confiança. |
| `apps/api/src/app/auth/auth.controller.spec.ts` | Testes de contrato HTTP/cookie das novas rotas. |
| `apps/api/src/app/auth/auth.module.ts` | Registro do serviço novo. |
| `apps/portaria-web/src/app/auth/auth.service.ts` | Tipos discriminados e operações de login/MFA; persistência apenas de sessão. |
| `apps/portaria-web/src/app/auth/login-page.component.ts` | Redirecionamento para a validação quando a senha retorna desafio. |
| `apps/portaria-web/src/app/auth/verificar-acesso-page.component.ts` | Tela pública de código, reenvio e confiança. |
| `apps/portaria-web/src/app/auth/verificar-acesso-page.component.spec.ts` | Testes da tela e do estado transitório. |
| `apps/portaria-web/src/app/app.routes.ts` | Rota pública `/verificar-acesso`. |

### Task 1: Persistência e contratos do MFA da portaria

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma: após User_Trusted_Devices`
- Create: `click-cond-web/prisma/migrations-manual/2026-10-13-portaria-web-mfa.sql`
- Create: `click-cond-web/apps/api/src/app/auth/portaria-mfa.types.ts`
- Test: `click-cond-web/apps/api/src/app/auth/portaria-mfa.types.spec.ts`

**Interfaces:**
- Produces `PortariaMfaChallengeResponse`, `PortariaLoginResult` e tipos de contexto usados pelas Tarefas 2–5.
- Produces os delegates Prisma `portaria_Mfa_Challenges` e `portaria_Trusted_Devices`.

- [ ] **Step 1: Write the failing contract test**

```ts
import { isPortariaMfaChallenge } from './portaria-mfa.types';

it('diferencia desafio de sessão final sem aceitar objeto incompleto', () => {
  expect(isPortariaMfaChallenge({ mfa_required: true, mfa_token: 'x', email_masked: 'a*@b.com', expires_in_seconds: 600 })).toBe(true);
  expect(isPortariaMfaChallenge({ access_token: 'jwt' })).toBe(false);
  expect(isPortariaMfaChallenge({ mfa_required: true, mfa_token: 'x' })).toBe(false);
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-mfa.types.spec.ts --runInBand`

Expected: FAIL because `portaria-mfa.types` does not exist.

- [ ] **Step 3: Add schema, manual migration and types**

Add `Portaria_Mfa_Challenges` with `token @unique @db.Char(36)`, `papel`, `id_conta`, `login`, `id_condominio`, `nome`, nullable `turno`, `email`, `code_hash`, `tentativas`, `expires_at`, `created_at` and `updated_at`; index `[token]` and `[id_conta, papel, expires_at]`. Add `Portaria_Trusted_Devices` with `papel`, `id_conta`, unique `device_hash @db.Char(64)`, nullable `user_agent`/`ip_address`, `expires_at`, `created_at`, `last_used_at`; index `[id_conta, papel, expires_at]`.

Define the response boundary explicitly:

```ts
export interface PortariaMfaChallengeResponse {
  mfa_required: true;
  mfa_token: string;
  email_masked: string;
  expires_in_seconds: 600;
}

export const isPortariaMfaChallenge = (value: unknown): value is PortariaMfaChallengeResponse =>
  !!value && typeof value === 'object' && (value as any).mfa_required === true &&
  typeof (value as any).mfa_token === 'string' && typeof (value as any).email_masked === 'string' &&
  (value as any).expires_in_seconds === 600;
```

Write SQL with `CREATE TABLE IF NOT EXISTS`, exact indexes and `utf8mb4`; do not run it against a shared database in this task.

- [ ] **Step 4: Generate client and run focused test**

Run: `npx prisma generate --schema prisma/schema.prisma; npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-mfa.types.spec.ts --runInBand`

Expected: Prisma generation succeeds and Jest reports PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-10-13-portaria-web-mfa.sql apps/api/src/app/auth/portaria-mfa.types.ts apps/api/src/app/auth/portaria-mfa.types.spec.ts
git commit -m "feat(auth): adiciona contratos de mfa da portaria"
```

### Task 2: Serviço isolado de desafio e dispositivo confiável

**Files:**
- Create: `click-cond-web/apps/api/src/app/auth/portaria-mfa.service.ts`
- Test: `click-cond-web/apps/api/src/app/auth/portaria-mfa.service.spec.ts`

**Interfaces:**
- Consumes os tipos da Tarefa 1, `PrismaService` e `MailService`.
- Produces `createChallenge(context)`, `verifyChallenge(token, code)`, `resendChallenge(token)`, `findTrustedDevice(context, rawToken)`, `createTrustedDevice(context, meta)` e `rotateTrustedDevice(...)`.

- [ ] **Step 1: Write failing service tests**

```ts
it('cria desafio de 10 minutos, envia código e retorna apenas e-mail mascarado', async () => {
  await expect(service.createChallenge(context)).resolves.toMatchObject({
    mfa_required: true, email_masked: 'po****@click.com', expires_in_seconds: 600,
  });
  expect(mail.sendMfaCode).toHaveBeenCalledWith('porteiro@click.com', 'Porteiro', expect.stringMatching(/^\d{6}$/));
});

it('invalida após cinco códigos incorretos', async () => {
  prisma.portaria_Mfa_Challenges.findFirst.mockResolvedValue(challengeWithAttempts(4));
  await expect(service.verifyChallenge('challenge', '000000')).rejects.toMatchObject({ status: 401 });
  expect(prisma.portaria_Mfa_Challenges.delete).toHaveBeenCalled();
});

it('não reconhece token confiável de outro papel ou conta', async () => {
  prisma.portaria_Trusted_Devices.findFirst.mockResolvedValue(null);
  await expect(service.findTrustedDevice({ ...context, papel: 'sindico' }, rawDeviceToken)).resolves.toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-mfa.service.spec.ts --runInBand`

Expected: FAIL because `PortariaMfaService` does not exist.

- [ ] **Step 3: Implement minimum secure behavior**

Use `crypto.randomUUID()` for challenge identifiers, `crypto.randomInt(100000, 1_000_000)` for codes, bcrypt cost 10 for code hashes and SHA-256 for device hashes. Delete a newly created challenge if `sendMfaCode` fails and return generic `ServiceUnavailableException`. Verify expiration and attempt counter before comparing; delete after success or fifth failure. Re-send only after 60 seconds, replace the hash and expiry, and update `created_at`.

Use a strict context type:

```ts
export interface PendingPortariaIdentity {
  papel: 'funcionario' | 'sindico';
  idConta: number;
  login: string;
  idCondominio: number;
  nome: string;
  turno: string | null;
  email: string;
}
```

`findTrustedDevice` must include `papel`, `id_conta`, hash and `expires_at: { gt: new Date() }` in the query. `createTrustedDevice` returns the raw random 32-byte hex token only to its caller; persistence receives only its hash. `rotateTrustedDevice` deletes/replaces the old hash atomically enough for one request and returns a new raw token.

- [ ] **Step 4: Run focused service tests**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-mfa.service.spec.ts --runInBand`

Expected: PASS, including expired challenge, cooldown, send failure, one-time use and trust isolation cases.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/auth/portaria-mfa.service.ts apps/api/src/app/auth/portaria-mfa.service.spec.ts
git commit -m "feat(auth): adiciona desafios mfa da portaria"
```

### Task 3: Integrar senha, revalidação e endpoints Nest

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts:131-260`
- Modify: `click-cond-web/apps/api/src/app/auth/auth.controller.ts:45-55`
- Modify: `click-cond-web/apps/api/src/app/auth/auth.module.ts: providers`
- Create: `click-cond-web/apps/api/src/app/auth/portaria-login-mfa.spec.ts`
- Create: `click-cond-web/apps/api/src/app/auth/auth.controller.spec.ts`

**Interfaces:**
- Consumes `PortariaMfaService` from Task 2.
- Produces `loginPortaria(login, senha, trustedDeviceToken?)`, `verificarMfaPortaria(...)` and `reenviarMfaPortaria(...)`.

- [ ] **Step 1: Write failing integration tests**

```ts
it('não assina JWT depois da senha quando não há dispositivo confiável', async () => {
  mfa.findTrustedDevice.mockResolvedValue(false);
  mfa.createChallenge.mockResolvedValue(challengeResponse);
  await expect(service.loginPortaria('porteiro@click.com', 'senha')).resolves.toEqual(challengeResponse);
  expect(jwt.sign).not.toHaveBeenCalled();
});

it('só assina JWT após código correto e revalidação de conta e condomínio ativos', async () => {
  mfa.verifyChallenge.mockResolvedValue(pendingIdentity);
  await service.verificarMfaPortaria('challenge', '123456', false, meta);
  expect(jwt.sign).toHaveBeenCalled();
});

it('controlador grava cookie confiável apenas após confirmação marcada', async () => {
  await controller.verifyMfa({ mfa_token: 'c', code: '123456', remember_device: true }, request, response);
  expect(response.cookie).toHaveBeenCalledWith('portaria_trusted_device', expect.any(String), expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-login-mfa.spec.ts apps/api/src/app/auth/auth.controller.spec.ts --runInBand`

Expected: FAIL because the new methods/endpoints do not exist.

- [ ] **Step 3: Implement integration and HTTP contract**

Refactor `montarSessaoPortaria` into a reusable internal finalizer that accepts a resolved, freshly loaded active identity; it must retain current `typeAccess`, condominium selection and JWT payload behavior. In `loginPortaria`, validate password as today, resolve a valid e-mail (funcionário: `email`; síndico: `Users.email`, then `login` only if it is syntactically an e-mail), then use the trusted-device cookie. If trust fails, return `createChallenge`; never call the finalizer.

Implement public throttled routes:

```ts
@Public()
@Throttle({ medium: { limit: 5, ttl: 60_000 } })
@Post('portaria/mfa/verify')
verifyMfa(@Body() body: { mfa_token: string; code: string; remember_device?: boolean }, @Req() req: any, @Res({ passthrough: true }) res: Response) { /* ... */ }

@Public()
@Throttle({ medium: { limit: 3, ttl: 60_000 } })
@Post('portaria/mfa/resend')
resendMfa(@Body() body: { mfa_token: string }) { /* ... */ }
```

Clear an invalid trusted-device cookie before returning the challenge. On successful remembered verification, set `maxAge: 30 * 24 * 60 * 60 * 1000`, `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/api/auth'`; do not send raw device tokens in JSON. Revalidate account and condominium state after `verifyChallenge` and before signing, rejecting if disabled or moved.

- [ ] **Step 4: Run backend tests and type check**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-login-mfa.spec.ts apps/api/src/app/auth/auth.controller.spec.ts apps/api/src/app/auth/login-portaria-typeaccess.spec.ts --runInBand; npx tsc -p apps/api/tsconfig.app.json --noEmit`

Expected: PASS; existing type-access tests continue passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/auth/auth.service.ts apps/api/src/app/auth/auth.controller.ts apps/api/src/app/auth/auth.module.ts apps/api/src/app/auth/portaria-login-mfa.spec.ts apps/api/src/app/auth/auth.controller.spec.ts
git commit -m "feat(auth): exige mfa no login do console"
```

### Task 4: Cliente Angular e transição de login

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/auth.service.ts:1-100`
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/login-page.component.ts:452-510`
- Create: `click-cond-web/apps/portaria-web/src/app/auth/auth.service.mfa.spec.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/auth/login-page.mfa.spec.ts`

**Interfaces:**
- Consumes a união de resposta das Tarefas 1 e 3.
- Produces `AuthService.iniciarLogin`, `AuthService.confirmarMfaPortaria`, `AuthService.reenviarMfaPortaria`, estado transitório de MFA e `destinoPosLogin()` só após sessão.

- [ ] **Step 1: Write failing client tests**

```ts
it('não persiste token quando login retorna desafio', () => {
  service.iniciarLogin('p@click.com', 'senha').subscribe();
  http.expectOne('/api/auth/login-portaria').flush(challenge);
  expect(localStorage.getItem('portaria_token')).toBeNull();
  expect(service.pendingMfa()).toEqual(challenge);
});

it('persiste sessão apenas quando a confirmação retorna access_token', () => {
  service.confirmarMfaPortaria('123456', true).subscribe();
  http.expectOne('/api/auth/portaria/mfa/verify').flush(session);
  expect(localStorage.getItem('portaria_token')).toBe(session.access_token);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test portaria-web --runInBand --testPathPattern="(auth.service.mfa|login-page.mfa)"`

Expected: FAIL because the methods/state do not exist.

- [ ] **Step 3: Implement discriminated response handling**

Change `login` to `iniciarLogin` returning `Observable<PorteiroInfo | PortariaMfaChallengeResponse>`. Persist only when `'access_token' in result`; store only `{ mfa_token, email_masked, expires_in_seconds, issued_at }` in `sessionStorage` under `portaria_mfa_pending`; never store password. Expose a read-only signal/computed that rejects missing or older-than-10-minute state and clears it.

`confirmarMfaPortaria(code, rememberDevice)` posts exactly `{ mfa_token, code, remember_device: rememberDevice }`, clears the pending state only on success and persists the returned `PorteiroInfo`. `reenviarMfaPortaria()` posts only `mfa_token`. Enable `withCredentials: true` for all three authentication requests so the secure trusted-device cookie can be sent and received.

In `LoginPageComponent.onSubmit`, route a challenge to `/verificar-acesso`; route a session to the existing post-login destination. Map errors without exposing internal e-mail provider details.

- [ ] **Step 4: Run focused frontend tests**

Run: `npx nx test portaria-web --runInBand --testPathPattern="(auth.service.mfa|login-page.mfa)"`

Expected: PASS; challenge response leaves `localStorage` without JWT.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/auth/auth.service.ts apps/portaria-web/src/app/auth/login-page.component.ts apps/portaria-web/src/app/auth/auth.service.mfa.spec.ts apps/portaria-web/src/app/auth/login-page.mfa.spec.ts
git commit -m "feat(portaria): direciona login para verificacao mfa"
```

### Task 5: Tela pública de validação, rota e verificação final

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/auth/verificar-acesso-page.component.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/auth/verificar-acesso-page.component.spec.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/app.routes.ts: rota após login`

**Interfaces:**
- Consumes `AuthService.pendingMfa`, `confirmarMfaPortaria` e `reenviarMfaPortaria` da Tarefa 4.
- Produces rota pública `/verificar-acesso` e navegação pós-validação igual ao login atual.

- [ ] **Step 1: Write failing component/route tests**

```ts
it('volta ao login sem desafio pendente válido', () => {
  fixture.detectChanges();
  expect(router.navigate).toHaveBeenCalledWith(['/login']);
});

it('envia código de seis dígitos, opção de confiança e segue ao dashboard', () => {
  component.code.set('123456');
  component.rememberDevice.set(true);
  component.confirmar();
  expect(auth.confirmarMfaPortaria).toHaveBeenCalledWith('123456', true);
});

it('bloqueia reenvio até o contador de 60 segundos terminar', () => {
  expect(component.podeReenviar()).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test portaria-web --runInBand --testPathPattern="verificar-acesso-page"`

Expected: FAIL because the component and route do not exist.

- [ ] **Step 3: Implement accessible MFA screen and route**

Create a standalone component using `CommonModule` and `FormsModule`. It displays `email_masked`, an input with `inputmode="numeric"`, `maxlength="6"`, label and `aria-live` status/error text. Sanitize user input to six ASCII digits. Disable confirmation until exactly six digits, disable re-send for 60 seconds after initial load and after each success, and show the remaining challenge lifetime. The checkbox label must state “Confiar neste dispositivo por 30 dias”.

On verification success, follow the same multiple-condominium decision as `LoginPageComponent`; on expired/invalid challenge, clear pending state and return to login. Add public lazy route:

```ts
{
  path: 'verificar-acesso',
  loadComponent: () => import('./auth/verificar-acesso-page.component').then((m) => m.VerificarAcessoPageComponent),
},
```

- [ ] **Step 4: Run frontend suite, type check and production build**

Run: `npx nx test portaria-web --runInBand; npx nx run portaria-web:typecheck; npx nx build portaria-web --configuration=production`

Expected: all tests, TypeScript validation and production build PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/auth/verificar-acesso-page.component.ts apps/portaria-web/src/app/auth/verificar-acesso-page.component.spec.ts apps/portaria-web/src/app/app.routes.ts
git commit -m "feat(portaria): adiciona tela de verificacao por email"
```

### Task 6: Validação integrada e documentação operacional

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-console-web-email-mfa-design.md: Testes e aceitação`
- Create: `click-cond-web/apps/api/src/app/auth/portaria-mfa.integration.spec.ts`

**Interfaces:**
- Consumes os fluxos completos entregues nas Tarefas 1–5.
- Produces evidência automatizada de que o JWT só sai após MFA ou confiança válida.

- [ ] **Step 1: Write failing end-to-end service-boundary test**

```ts
it('primeiro login exige código, o segundo com cookie confiável não exige, e outro token exige código', async () => {
  await expect(loginWithPassword(noCookie)).resolves.toMatchObject({ mfa_required: true });
  const session = await verifyWithCode('123456', true);
  expect(session.access_token).toEqual(expect.any(String));
  await expect(loginWithPassword(trustedCookie)).resolves.toHaveProperty('access_token');
  await expect(loginWithPassword(otherCookie)).resolves.toMatchObject({ mfa_required: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth/portaria-mfa.integration.spec.ts --runInBand`

Expected: FAIL until the full flow is wired.

- [ ] **Step 3: Stabilize only real integration gaps**

Adjust mocks/fixtures and production code only where the test reveals a violation of the specification. Do not weaken the assertions, skip disabled-account coverage, or add test-only bypasses.

- [ ] **Step 4: Run complete relevant verification**

Run: `npx jest --config apps/api/jest.config.cts apps/api/src/app/auth --runInBand; npx nx test portaria-web --runInBand; npx nx run portaria-web:typecheck; npx nx build portaria-web --configuration=production; git diff --check`

Expected: all commands PASS and `git diff --check` has no output.

- [ ] **Step 5: Update acceptance evidence and commit**

Add the exact manual test result template to the design document: first browser prompts for code, trusted browser does not, a private/new browser prompts, and QR remains unchanged. Then commit:

```bash
git add apps/api/src/app/auth/portaria-mfa.integration.spec.ts docs/superpowers/specs/2026-10-13-console-web-email-mfa-design.md
git commit -m "test(auth): valida fluxo completo de mfa da portaria"
```

## Self-review

- **Cobertura da especificação:** Tarefa 1 cria persistência; 2 aplica código, expiração, tentativas, reenvio e confiança; 3 integra senha, sessão, cookie, e estado ativo; 4 garante que o cliente não persista antes do MFA; 5 entrega a interface/rota; 6 valida o fluxo cruzado e critérios de aceite.
- **Placeholders:** revisado; cada tarefa contém arquivos, interfaces, testes, comandos e comportamento concreto.
- **Consistência de tipos:** `PortariaMfaChallengeResponse` é produzido em 1, consumido em 2–4; `PendingPortariaIdentity` é produzido por 2 e revalidado/emite sessão em 3; `PorteiroInfo` é persistido apenas em 3–5.
- **Review Focus:** os cinco riscos listados no cabeçalho são cobertos respectivamente pelas Tarefas 2, 3, 2, 5 e 4.
