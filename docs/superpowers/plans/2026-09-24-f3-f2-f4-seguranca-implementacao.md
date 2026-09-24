# Implementação de Segurança — F3 (Throttlers), F2 (Recuperação Segura via Deep Link) e F4 (Trust Proxy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar vulnerabilidades críticas de segurança: rate limiting ignorado (F3), troca imediata e insegura de senha com vazamento em texto puro substituída por recuperação segura via Deep Link no app Flutter (F2), e proteção contra forja de IP de cliente no proxy (F4).

**Architecture:**
1. Correção dos overrides de throttler (`short` e `medium`) em todos os controllers e teste estrutural que bloqueia nomes inválidos.
2. Modelo `Redefinicoes_Senha` no Prisma com token SHA-256 de 30 min, resposta sem enumeração de contas e rota pública `POST /api/auth/redefinir-senha`.
3. Template de e-mail sem texto puro com link `clickprestare://redefinir-senha?token=...`.
4. Deep link no Android/iOS com captura via `app_links` e nova tela Flutter `RedefinirSenhaPage` para entrada da nova senha.
5. Configuração `trust proxy: 1` e testes de integridade.

**Tech Stack:** NestJS, TypeScript, Prisma, MySQL, Flutter/Dart (`app_links`), Jest.

**Spec:** `click-cond-web/docs/superpowers/plans/2026-09-24-seguranca-f2-f4.md`

## Global Constraints
- Nenhuma senha em texto puro no e-mail ou em respostas da API.
- Respostas de solicitação de recuperação padronizadas (sem enumeração de contas, status 200 sempre com mensagem uniforme).
- Token de uso único, expiração máxima de 30 minutos, apenas hash SHA-256 armazenado no banco.
- Ao concluir tudo, subir no emulador Android `Pixel_10` (`emulator-5554`) para validação pelo usuário.

---

### Task 1: [F3] Correção dos Throttlers nos Controllers e Teste Estrutural

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/auth.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/crm/crm-auth.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/facial/agent.controller.ts`
- Create: `click-cond-web/apps/api/src/app/common/throttle/throttlers.ts`
- Test: `click-cond-web/apps/api/src/app/common/throttle/throttlers.spec.ts`

- [ ] **Passo 1: Criar arquivo de definição dos throttlers e teste estrutural**
- [ ] **Passo 2: Rodar o teste para verificar falha nos controllers com `@Throttle({ default })`**
- [ ] **Passo 3: Corrigir os controllers substituindo `default` pelos throttlers registrados (`medium` ou `short`)**
- [ ] **Passo 4: Rodar o teste estrutural e confirmar aprovação**
- [ ] **Passo 5: Commit das correções do F3**

---

### Task 2: [F2] Modelagem de Banco de Dados para `Redefinicoes_Senha`

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma`
- Create: `click-cond-web/prisma/sql/2026-09-24-redefinicoes-senha.sql`

- [ ] **Passo 1: Adicionar model `Redefinicoes_Senha` ao `schema.prisma`**
- [ ] **Passo 2: Gerar o script de migração SQL em `prisma/sql/`**
- [ ] **Passo 3: Rodar `npx prisma generate`**
- [ ] **Passo 4: Commit da modelagem**

---

### Task 3: [F2] Backend — Solicitação e Confirmação de Redefinição de Senha

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts`
- Modify: `click-cond-web/apps/api/src/app/common/mail/mail.service.ts`
- Test: `click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts`

- [ ] **Passo 1: Escrever testes unitários para o fluxo de solicitação e confirmação**
- [ ] **Passo 2: Implementar novo método `solicitarRedefinicaoSenha` unificado e seguro (sem alterar senha e sem enumeração)**
- [ ] **Passo 3: Implementar método `confirmarRedefinicaoSenha` com hash bcrypt, invalidação do token e auditoria**
- [ ] **Passo 4: Atualizar `mail.service.ts` com o novo template de e-mail contendo o link com validade de 30 min**
- [ ] **Passo 5: Rodar os testes unitários e verificar 100% de sucesso**
- [ ] **Passo 6: Commit do backend F2**

---

### Task 4: [F2] App Flutter — Deep Link e Tela `RedefinirSenhaPage`

**Files:**
- Modify: `click-cond-app/click-cond-app/pubspec.yaml`
- Modify: `click-cond-app/click-cond-app/android/app/src/main/AndroidManifest.xml`
- Modify: `click-cond-app/click-cond-app/ios/Runner/Info.plist`
- Create: `click-cond-app/click-cond-app/lib/pages/auth/redefinir_senha_page.dart`
- Modify: `click-cond-app/click-cond-app/lib/pages/sindico/forgot_password.dart`
- Modify: `click-cond-app/click-cond-app/lib/main.dart`
- Modify: `click-cond-app/click-cond-app/lib/controllers/controller_sindico.dart`

- [ ] **Passo 1: Adicionar dependência `app_links` e configurar manifestos Android/iOS para `clickprestare://redefinir-senha`**
- [ ] **Passo 2: Criar tela `RedefinirSenhaPage` com campos de senha, confirmação e validações de força**
- [ ] **Passo 3: Integrar chamada da API `redefinirSenhaApi(token, novaSenha)`**
- [ ] **Passo 4: Configurar listener de Deep Link no `main.dart` para navegar até `RedefinirSenhaPage` ao receber o link**
- [ ] **Passo 5: Atualizar textos informativos na tela `ForgotPassword`**
- [ ] **Passo 6: Commit das alterações do app**

---

### Task 5: [F4] Proteção contra IP Forjado (Trust Proxy)

**Files:**
- Modify: `click-cond-web/apps/api/src/main.ts`
- Test: `click-cond-web/apps/api/src/app/common/throttle/trust-proxy.spec.ts`

- [ ] **Passo 1: Escrever teste validando que `X-Forwarded-For` forjado não é o IP registrado**
- [ ] **Passo 2: Ajustar `app.set('trust proxy', 1)` no `main.ts`**
- [ ] **Passo 3: Executar testes da API e confirmar aprovação**
- [ ] **Passo 4: Commit do F4**

---

### Task 6: Validação Completa, Teste no Emulador Android e Deploy

- [ ] **Passo 1: Rodar a suíte completa de testes da API (`npx nx test api`) e typecheck (`npx nx typecheck api`)**
- [ ] **Passo 2: Iniciar o emulador Android `Pixel_10`**
- [ ] **Passo 3: Subir e executar o app no emulador Android (`flutter run -d emulator-5554`)**
- [ ] **Passo 4: Apresentar resultados e orientações de teste ao usuário**
