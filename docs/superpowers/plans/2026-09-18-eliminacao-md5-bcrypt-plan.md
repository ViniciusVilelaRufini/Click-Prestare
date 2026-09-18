# Plano de Execução: Eliminação de MD5 e Blindagem de Senhas com Bcrypt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar totalmente a criação e armazenamento de senhas em MD5 no NestJS e Express, implementando auto-migração Just-in-Time para Bcrypt em todos os fluxos de login e adicionando ferramenta de auditoria de conformidade no AWS RDS.

**Architecture:** Mapeamento de padrão de hash em tempo de execução: hashes iniciados em `$2` são validados via `bcrypt.compare`; hashes legados em MD5 (32 hex) são validados e instantaneamente promovidos para `bcrypt.hash(10)` no banco antes de emitir a sessão. Todas as queries de inserção/atualização de senhas passam a usar Bcrypt e queries parametrizadas com placeholders (`?`).

**Tech Stack:** Node.js, NestJS, Express, Prisma ORM, MySQL 8.4 (AWS RDS), bcrypt, Jest.

**Spec:** `docs/superpowers/specs/2026-09-18-eliminacao-md5-bcrypt-design.md`

## Global Constraints
- Nenhuma operação destrutiva ou bloqueante: usuários com senha MD5 continuam conseguindo logar normalmente.
- Fator de custo do Bcrypt padronizado em 10 (ou 12 no NestJS).
- Nenhuma query SQL com concatenação direta de senhas ou variáveis de usuário (uso estrito de `?`).
- Todas as alterações validadas por testes automatizados (`npx nx test api`).

---

### Task 1: Auto-migração Just-in-Time no Login de Síndico Web (NestJS)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/auth.service.ts`
- Test: `click-cond-web/apps/api/src/app/auth/senha-bcrypt.spec.ts`

**Interfaces:**
- Consumes: `bcrypt.compare(senha, hash)`, `createHash('md5')`, `bcrypt.hash(senha, 12)`, `prisma.users.update`
- Produces: Usuário autenticado com hash do banco atualizado para `$2b$12$...` se antes era MD5.

- [ ] **Step 1: Inserir atualização para Bcrypt quando síndico com MD5 loga com sucesso**
  Em `auth.service.ts` (linhas ~240-255), quando `sindicoMatch === true` e `!isBcryptSindico`, executar `prisma.users.update` gravando `await bcrypt.hash(senha, 12)`.
- [ ] **Step 2: Executar teste de regressão**
  Run: `npx nx test api --testFile=senha-bcrypt.spec.ts`
  Expected: PASS
- [ ] **Step 3: Commit**
  ```bash
  git add click-cond-web/apps/api/src/app/auth/auth.service.ts
  git commit -m "security: auto-migrate sindico web MD5 passwords to bcrypt on login"
  ```

---

### Task 2: Blindagem do Backend Express contra MD5 e SQL Injection

**Files:**
- Modify: `click-cond-api/click-cond-api/src/database/DB_Funcionarios.js`
- Modify: `click-cond-api/click-cond-api/src/database/DB_Moradores.js`
- Modify: `click-cond-api/click-cond-api/src/database/DB_Sindico.js`
- Modify: `click-cond-api/click-cond-api/src/database/DB_Users.js`

**Interfaces:**
- Consumes: `bcryptjs` ou `bcrypt`
- Produces: Funções de banco seguras que gravam apenas Bcrypt e usam queries com parâmetros preparados (`?`).

- [ ] **Step 1: Atualizar DB_Funcionarios.js para usar Bcrypt e prepared statements**
- [ ] **Step 2: Atualizar DB_Moradores.js para usar Bcrypt e prepared statements**
- [ ] **Step 3: Atualizar DB_Sindico.js para usar Bcrypt e auto-migração no login**
- [ ] **Step 4: Atualizar DB_Users.js para auto-migração no login de moradores**
- [ ] **Step 5: Validar sintaxe Node.js**
  Run: `node --check click-cond-api/click-cond-api/src/database/DB_*.js`
  Expected: PASS
- [ ] **Step 6: Commit**
  ```bash
  git add click-cond-api/click-cond-api/src/database/
  git commit -m "security: replace MD5 with bcrypt and parameterize queries in Express database layer"
  ```

---

### Task 3: Sanitização de Scripts Utilitários e Seeds

**Files:**
- Modify: `click-cond-web/prisma/seed.ts`
- Modify: `click-cond-web/prisma/stress_test.ts`
- Modify: `click-cond-web/apps/api/src/app/create_sindico.js`
- Modify: `click-cond-api/click-cond-api/create_user.js`
- Modify: `click-cond-api/click-cond-api/create_final_user.js`
- Modify: `click-cond-api/click-cond-api/fix_user.js`

- [ ] **Step 1: Substituir geração de MD5 por bcrypt nos scripts**
- [ ] **Step 2: Verificar sintaxe**
  Run: `node --check click-cond-web/apps/api/src/app/create_sindico.js`
- [ ] **Step 3: Commit**
  ```bash
  git add click-cond-web/prisma/ click-cond-web/apps/api/src/app/create_sindico.js click-cond-api/click-cond-api/*.js
  git commit -m "security: sanitize utility scripts and seeds to generate bcrypt hashes"
  ```

---

### Task 4: Script de Diagnóstico e Auditoria no AWS RDS

**Files:**
- Create: `click-cond-web/scripts/migration/audit-password-hashes.mjs`

- [ ] **Step 1: Criar script de auditoria que conta hashes Bcrypt vs MD5 no RDS**
- [ ] **Step 2: Executar auditoria contra o banco de dados ativo**
  Run: `node click-cond-web/scripts/migration/audit-password-hashes.mjs`
  Expected: Relatório exibindo % de usuários com Bcrypt e % restante com MD5.
- [ ] **Step 3: Commit**
  ```bash
  git add click-cond-web/scripts/migration/audit-password-hashes.mjs
  git commit -m "feat: add password hash security audit script for RDS"
  ```

---

### Task 5: Verificação de Build, Testes e Geração do Pacote de Deploy

**Files:**
- Build: `click-cond-web/apps/api`
- Generate: `click-cond-web/deploy-api-aws.zip`

- [ ] **Step 1: Executar suite de testes da API**
  Run: `npx nx test api`
- [ ] **Step 2: Recompilar a API NestJS**
  Run: `npx nx build api`
- [ ] **Step 3: Gerar pacote de deploy atualizado para o Elastic Beanstalk**
  Run: `node click-cond-web/scripts/migration/bundle-eb.mjs`
- [ ] **Step 4: Atualizar cópia na Área de Trabalho**
