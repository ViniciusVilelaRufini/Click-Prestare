# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produzir evidência verificável de que banco, API, web e app podem iniciar operação real com segurança, ou listar bloqueios objetivos.

**Architecture:** A auditoria em camadas começa por checks read-only do banco e do código, segue para testes de autorização e fluxos, e termina com build/smoke/deploy checks. Dados de teste serão sintéticos, identificáveis e removidos por chave exata.

**Tech Stack:** MySQL/RDS, Prisma, NestJS/Jest, Flutter/Dart, Android emulator, GitHub Actions, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-23-production-readiness-design.md`

## Global Constraints

- Testes usarão dados sintéticos e não alterarão registros reais sem identificação e limpeza determinística.
- Sem permissão explícita para uma operação AWS destrutiva, restauração será apenas verificada por configuração e ficará marcada como pendência.
- A aprovação de produção exige que pendências críticas estejam resolvidas; resultados inconclusivos não serão tratados como aprovação.
- Não expor credenciais, CPF, documentos, fotos, biometria ou tokens nos relatórios.

## Review Focus

- Usuário autenticado tentando acessar outro condomínio: deve receber vazio/403 sem dados parciais.
- Registro legado sem PIN sendo listado: deve permanecer sem escrita no banco.
- Falha de migration ou schema divergente: pipeline deve parar antes do deploy.
- Sessão expirada ou resposta 401/403 no app: deve exibir erro recuperável sem apagar dados locais.
- Backup configurado sem restauração comprovada: deve ser marcado como bloqueio, não como aprovado.

---

### Task 1: Baseline de banco e migrations

**Files:**
- Create: `scripts/production-readiness/db-baseline.ps1`
- Create: `docs/superpowers/evidence/2026-09-23-db-baseline.md`

**Interfaces:**
- Consumes: `DATABASE_URL` do `.env` sem imprimir o valor.
- Produces: contagens, integridade referencial e estado de migrations sem PII.

- [ ] **Step 1: Write the read-only baseline script**
  - Consultar contagens de tabelas críticas, órfãos, divergências de condomínio, PINs duplicados e registros expirados.
  - Emitir apenas métricas agregadas.
- [ ] **Step 2: Run the script against the configured database**
  - Expected: conexão bem-sucedida; nenhuma credencial aparece na saída.
- [ ] **Step 3: Check migration status**
  - Run Prisma migration status in the API workspace.
  - Expected: status explícito, sem aplicar migration automaticamente.
- [ ] **Step 4: Record evidence and commit**
  - Salvar resultado agregado e commit sem `.env`.

### Task 2: Security and tenant isolation tests

**Files:**
- Modify: existing visitor authorization specs under `apps/api/src/app/visitantes/`
- Create: `docs/superpowers/evidence/2026-09-23-security-review.md`

**Interfaces:**
- Consumes: guards/controllers/services existentes e fixtures de autorização.
- Produces: testes para cross-tenant, role restrictions e response sanitization.

- [ ] **Step 1: Add failing cross-tenant and sensitive-field assertions**
- [ ] **Step 2: Run focused tests and confirm failures identify missing coverage**
- [ ] **Step 3: Implement only required authorization/sanitization fixes**
- [ ] **Step 4: Run visitor/security suites with migration flag true and false**
  - Expected: all suites pass and sensitive fields remain sanitized.
- [ ] **Step 5: Commit evidence and code**

### Task 3: End-to-end visitor and unit flows

**Files:**
- Modify: existing Flutter visitor/unit tests only when a failing regression is found.
- Create: `docs/superpowers/evidence/2026-09-23-flow-tests.md`

**Interfaces:**
- Consumes: API visitor tests and emulator `emulator-5554`.
- Produces: evidence for list, pending, create, update, delete, check-in/out and error recovery.

- [ ] **Step 1: Run Flutter focused suites**
- [ ] **Step 2: Build/install debug APK and smoke-test visitor screens on emulator**
- [ ] **Step 3: Use synthetic visitor data only if role and cleanup are deterministic**
- [ ] **Step 4: Query database by exact synthetic marker before and after cleanup**
- [ ] **Step 5: Record flows not executable due to permissions or empty production data**

### Task 4: Release, pipeline and rollback readiness

**Files:**
- Inspect/modify: `.github/workflows/*`, release/build configuration and migration scripts only when required by evidence.
- Create: `docs/superpowers/evidence/2026-09-23-release-readiness.md`

**Interfaces:**
- Consumes: GitHub Actions workflow definitions, package/build metadata and environment variable names.
- Produces: release checklist, migration gate, rollback instructions and explicit AWS blockers.

- [ ] **Step 1: Validate workflow YAML and required secret names without printing values**
- [ ] **Step 2: Build API and Flutter release artifacts**
- [ ] **Step 3: Verify migration/deploy ordering and rollback commands**
- [ ] **Step 4: Inspect RDS backup configuration read-only when AWS tooling is available**
- [ ] **Step 5: Record unresolved operational blockers**

### Task 5: Final production gate

**Files:**
- Create: `docs/superpowers/PRODUCTION-READINESS.md`

**Interfaces:**
- Consumes: evidence files from Tasks 1–4.
- Produces: PASS/BLOCKED decision for each criterion; no blanket approval when evidence is missing.

- [ ] **Step 1: Run all relevant automated suites again**
- [ ] **Step 2: Review evidence for secrets/PII leakage**
- [ ] **Step 3: Mark each criterion PASS, FAIL or BLOCKED with command evidence**
- [ ] **Step 4: Commit the final report**

