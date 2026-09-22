# Remediação de Segurança Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os vazamentos confirmados de autorização, XSS, segredos, uploads e SSRF sem quebrar os fluxos legítimos do condomínio.

**Architecture:** A autorização ficará no serviço de encomendas e a impressão tratará dados como texto. O storage passa a validar data URLs e guardar objetos privados; o facial só consumirá imagens de origem controlada. Configurações AWS permanecem documentadas em runbook, não executadas pelo código.

**Tech Stack:** NestJS 11, Prisma/MySQL, Jest, Angular 21, AWS SDK S3/R2, Flutter (testes de compatibilidade somente).

**Spec:** `docs/superpowers/specs/2026-09-22-remediacao-seguranca-design.md`

## Global Constraints

- Não alterar RDS, credenciais, Security Groups ou outros recursos AWS nesta implementação.
- A autorização de tenant deve estar no service antes de qualquer escrita, leitura sensível ou notificação.
- Não retornar senha de dispositivo facial a clientes do portal.
- Uploads novos de dados pessoais não podem receber ACL pública.
- Preservar leitura de URLs públicas e data URLs legadas durante a migração.
- Não adicionar dependências sem necessidade; usar APIs Node/AWS SDK existentes.
- Todo segredo obrigatório deve vir de variável de ambiente, nunca de fallback no fonte.

## Review Focus

- Um morador de outro tenant cria uma encomenda e tenta disparar push/WhatsApp: deve receber 403 antes de qualquer query de escrita.
- Descrição/remetente contendo HTML deve aparecer literalmente na impressão, sem elemento ou script executável.
- Upload `data:image/svg+xml` ou MIME não permitido deve ser rejeitado antes de chamar S3/R2.
- URL facial para `127.0.0.1`, `169.254.169.254` e host externo deve ser recusada sem requisição HTTP.
- Registro legado com URL pública R2 deve continuar sendo lido, enquanto novos uploads são privados.

---

### Task 1: Isolamento de encomendas e impressão segura

**Files:**
- Modify: `apps/api/src/app/encomendas/encomendas.service.ts`
- Modify: `apps/api/src/app/encomendas/encomendas.controller.ts`
- Modify: `apps/api/src/app/auth/mobile-auth.controller.ts`
- Create: `apps/api/src/app/encomendas/encomendas.authz.spec.ts`
- Modify: `apps/portaria-web/src/app/encomendas/encomendas-page.component.ts`
- Create: `apps/portaria-web/src/app/encomendas/encomendas-page.component.spec.ts`

**Interfaces:**
- Consumes: `TenantAccessService.assertCondominio(idCondominio, payload)` and `assertOperador(user, contexto)`.
- Produces: `EncomendasService.create(dto, operador)` which rejects an unlinked tenant before storage, database or notification work.

- [ ] **Step 1: Write failing API authorization tests**

```ts
it('rejects creating an encomenda for a tenant not linked to the JWT', async () => {
  tenant.assertCondominio.mockRejectedValueOnce(new ForbiddenException());
  await expect(service.create({ ...dto, id_condominio: 2 }, moradorTenant1))
    .rejects.toBeInstanceOf(ForbiddenException);
  expect(prisma.encomendas.create).not.toHaveBeenCalled();
  expect(notifications.sendPushNotification).not.toHaveBeenCalled();
});

it('requires an operator for the console list endpoint', () => {
  expect(() => controller.list(1, undefined as any, undefined)).toThrow(ForbiddenException);
});
```

- [ ] **Step 2: Run the API test to verify it fails**

Run: `npm exec nx test @org/api --testPathPattern=encomendas.authz.spec.ts`

Expected: FAIL because `create` does not assert the target tenant and the list controller does not require an operator.

- [ ] **Step 3: Implement service/controller authorization**

```ts
async create(dto: CreateEncomendaDto, operador?: JwtPayload) {
  await this.tenant.assertCondominio(dto.id_condominio, operador);
  // existing storage, database and notification sequence follows
}

list(idCondominio: number, user: JwtPayload, status?: string) {
  assertOperador(user, 'listar encomendas do condomínio');
  return this.service.findAll(idCondominio, status);
}
```

Pass `payload` from the mobile `insert` route to `create`; add `@ReqUser()` to the console `list` route. Do not trust `id_condominio` just because it came from a mobile body.

- [ ] **Step 4: Write failing portal XSS tests**

```ts
it('escapes untrusted encomenda fields in printable markup', () => {
  const markup = component.buildPrintLabel({ descricao: '<img src=x onerror=alert(1)>' } as Encomenda);
  expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(markup).not.toContain('<img src=x');
});
```

- [ ] **Step 5: Implement escaped print markup**

Create a private `escapeHtml(value: unknown): string` that escapes `&`, `<`, `>`, `"` and `'`. Move label construction into a testable `buildPrintLabel(e: Encomenda): string`; call it from both print methods before `document.write`.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm exec nx test @org/api --testPathPattern=encomendas.authz.spec.ts` and `npm exec nx test portaria-web --testPathPattern=encomendas-page.component.spec.ts`

Commit: `git add apps/api/src/app/encomendas apps/api/src/app/auth/mobile-auth.controller.ts apps/portaria-web/src/app/encomendas && git commit -m "fix: proteger encomendas por tenant e escapar impressao"`

### Task 2: Segredos e superfície de dispositivos faciais

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app/facial/facial.service.ts`
- Modify: `apps/api/src/app/facial/facial.controller.ts`
- Create: `apps/api/src/app/facial/facial.secrets.spec.ts`
- Create: `docs/security/ROTACAO_DE_SEGREDOS.md`

**Interfaces:**
- Produces: respostas de dispositivos sem `api_password`; segredo SMTP exclusivamente configurado por ambiente.

- [ ] **Step 1: Write failing regression tests**

```ts
it('never exposes api_password from list or get device', async () => {
  await expect(service.listDevices(1)).resolves.not.toHaveProperty('[0].api_password');
  await expect(service.getDevice(1)).resolves.not.toHaveProperty('api_password');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec nx test @org/api --testPathPattern=facial.secrets.spec.ts`

Expected: FAIL because current service decrypts and returns the password.

- [ ] **Step 3: Remove source fallback and sanitize device DTOs**

Delete the SMTP credential assignment in `main.ts`; only normalize configured addresses, never supply a password. Return explicit public device projections from portal-facing list/get/create/update methods, excluding `api_password` and `webhook_token` unless a dedicated authenticated agent configuration endpoint requires the token.

- [ ] **Step 4: Add the rotation runbook**

Document rotation order for SMTP, Linketrack, database, device/agent tokens and deployment environment variables. Do not include real credentials.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm exec nx test @org/api --testPathPattern=facial.secrets.spec.ts`

Commit: `git add apps/api/src/main.ts apps/api/src/app/facial docs/security/ROTACAO_DE_SEGREDOS.md && git commit -m "fix: remover segredos expostos e sanitizar facial"`

### Task 3: Upload privado e validado

**Files:**
- Modify: `apps/api/src/app/common/storage/storage.service.ts`
- Create: `apps/api/src/app/common/storage/storage.service.spec.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Produces: `uploadDataUrl(dataUrl, prefix, hint?)` rejects unsupported MIME or oversized content and writes no public ACL.
- Produces: `StorageService.isTrustedPublicUrl(url)` for compatibility decisions in consumers.

- [ ] **Step 1: Write failing storage tests**

```ts
it.each(['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGgxPg=='])
('rejects unsupported upload MIME %s', async (value) => {
  await expect(service.uploadDataUrl(value, 'moradores')).rejects.toBeInstanceOf(BadRequestException);
});

it('uploads a valid jpeg without public ACL', async () => {
  await service.uploadDataUrl('data:image/jpeg;base64,/9j/AA==', 'moradores');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ ACL: undefined, ContentType: 'image/jpeg' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec nx test @org/api --testPathPattern=storage.service.spec.ts`

Expected: FAIL because arbitrary MIME is accepted and `ACL: public-read` is sent.

- [ ] **Step 3: Implement strict parser and limits**

Parse the `data:<mime>;base64,<payload>` header, whitelist JPEG/PNG/WebP/PDF, decode with strict base64 validation, and enforce `5 MiB` for images and `10 MiB` for PDF. Throw `BadRequestException` before S3/R2 if invalid. Remove `ACL: 'public-read'`; retain the returned object key or configured private URL format without making content public.

Set the global JSON limit in `main.ts` to `12mb`; routes requiring larger files must use explicit multipart/streaming in a future scoped change.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm exec nx test @org/api --testPathPattern=storage.service.spec.ts`

Commit: `git add apps/api/src/app/common/storage/storage.service.ts apps/api/src/app/common/storage/storage.service.spec.ts apps/api/src/main.ts && git commit -m "fix: validar uploads e remover acesso publico"`

### Task 4: Bloqueio de SSRF no facial

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts`
- Create: `apps/api/src/app/facial/facial.ssrF.spec.ts`

**Interfaces:**
- Produces: `assertTrustedImageUrl(url: string): Promise<void>` used by `toDataUrl` and `fetchPhotoAsBase64`.

- [ ] **Step 1: Write failing SSRF tests**

```ts
it.each(['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'https://attacker.example/x.jpg'])
('rejects untrusted image URL without issuing HTTP request: %s', async (url) => {
  await expect((service as any).fetchPhotoAsBase64(url)).resolves.toBeNull();
  expect(axios.get).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm exec nx test @org/api --testPathPattern=facial.ssrF.spec.ts`

Expected: FAIL because Axios is called for arbitrary HTTP(S) URLs.

- [ ] **Step 3: Implement trusted-origin validation**

Accept only HTTPS URLs whose hostname is the hostname of `R2_PUBLIC_URL` or `AWS_S3_BASE_URL`. Reject credentials in URLs, non-HTTPS URLs, localhost, private/link-local/reserved IPv4 and IPv6 literals. Use Axios with `maxRedirects: 0`, `responseType: 'arraybuffer'`, timeout `15000`, and reject a response whose content type is not JPEG/PNG/WebP.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm exec nx test @org/api --testPathPattern=facial.ssrF.spec.ts`

Commit: `git add apps/api/src/app/facial/facial.service.ts apps/api/src/app/facial/facial.ssrF.spec.ts && git commit -m "fix: bloquear SSRF no fluxo facial"`

### Task 5: Runbook de endurecimento AWS/RDS e verificação integrada

**Files:**
- Create: `docs/security/AWS_RDS_HARDENING.md`
- Modify: `docs/security/ROTACAO_DE_SEGREDOS.md`

- [ ] **Step 1: Document exact operational sequence**

Document preflight backup/snapshot, creation of a least-privilege application user, deployment with TLS URL/CA, validation, Security Group restriction, `require_secure_transport=ON`, `local_infile=0`, slow query log/CloudWatch and retirement of the administrator connection. Include rollback instructions for each phase and prohibit committing credentials.

- [ ] **Step 2: Run integrated verification**

Run: `npm exec nx test @org/api`, `npm exec nx typecheck @org/api`, `npm exec nx test portaria-web`, and `npm exec nx typecheck portaria-web`.

- [ ] **Step 3: Commit**

Commit: `git add docs/security && git commit -m "docs: adicionar runbook de endurecimento AWS"`

## Plan Self-Review

- Spec coverage: Tasks 1–5 cover todos os sete itens de escopo; mudanças remotas AWS e migração completa de cookies permanecem explicitamente fora de escopo.
- Placeholder scan: nenhum marcador `TODO`, `TBD` ou passo sem ação/teste específico.
- Type consistency: Task 1 usa o `JwtPayload` e `TenantAccessService` existentes; Tasks 3 e 4 mantêm os métodos de upload/facial existentes e adicionam helpers privados.
- Review focus: os cinco cenários listados possuem testes nas Tasks 1, 3 e 4.
