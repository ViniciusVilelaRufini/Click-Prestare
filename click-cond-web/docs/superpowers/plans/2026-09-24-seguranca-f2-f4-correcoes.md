# Plano de Correções de Segurança — F2 (Web + E-mail), F2 (Ajustes Concorrência/Timing) e F4 (Direct API + Trust Proxy 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os três pontos identificados em produção: entregar tela de redefinição universal na `portaria-web` com link `https://` no e-mail (compatível com web e app atual); mitigar race condition com update atômico, eliminar vazamento por timing attack, limitar requisições por e-mail e corrigir auditoria no F2; e fazer a `portaria-web` chamar a API diretamente, ajustando `trust proxy = 2` e unificando a extração do IP real na auditoria.

**Architecture:**
1. Nova página Angular standalone `RedefinirSenhaPageComponent` em `apps/portaria-web` servida em `/redefinir-senha?token=...`, mantendo botão para abrir no app via deep link. E-mail no `MailService` passa a enviar link `https://www.clickprestarecondominios.com.br/redefinir-senha?token=...`.
2. F2 robusto: consumo atômico de token via `prisma.redefinicoes_Senha.updateMany({ where: { token_hash, usado_em: null, expira_em: { gt: now } } })`, envio de e-mail assíncrono em segundo plano (tempo uniforme de resposta independente de conta existir), rate limit de 3 solicitações/hora por e-mail e resolução de `id_condominio` real da conta para auditoria.
3. `portaria-web` direcionada para `https://api.clickprestarecondominios.com.br/api` em produção via `api.config.ts` e interceptor HTTP global, contornando o proxy reverso do Amplify.
4. `trust proxy = 2` (CloudFront + ALB) no `main.ts` e `extractClientIp` em `request-context.ts` utilizando diretamente `req.ip` validado pelo Express.

**Tech Stack:** NestJS, Express (`trust proxy`, `proxy-addr`), Prisma, MySQL, Angular 17+ (Signals, Standalone Components), Jest.

---

## Global Constraints
- Todo link de recuperação no e-mail DEVE ser `https://` para evitar bloqueios em clientes de e-mail (Gmail/Outlook) e permitir uso por porteiro/web.
- O consumo de token DEVE ser atômico (uma única transação/update condicional): dois cliques simultâneos nunca podem passar ambos.
- A resposta da solicitação de recuperação DEVE ter tempo uniforme (~5-15ms) para e-mails existentes e inexistentes.
- O IP registrado na auditoria e no throttler DEVE ser o IP real do cliente (resolvido por `req.ip` com `trust proxy: 2`), ignorando `X-Forwarded-For` forjado.

---

### Task 1: [F2] Página de Redefinição na `portaria-web` e E-mail com Link `https://`

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/auth/redefinir-senha-page.component.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/app.routes.ts`
- Modify: `click-cond-web/apps/api/src/app/common/mail/mail.service.ts`
- Test: `click-cond-web/apps/portaria-web/src/app/auth/redefinir-senha-page.component.spec.ts`

- [ ] **Passo 1: Escrever teste unitário para o componente `RedefinirSenhaPageComponent`**
  - Testa validação de token ausente na URL, senhas curtas (< 6 chars), senhas divergentes, chamada HTTP ao backend `POST /api/auth/redefinir-senha` e feedback de sucesso/erro.
- [ ] **Passo 2: Criar `RedefinirSenhaPageComponent`**
  - Componente standalone Angular com design idêntico ao console (`app-bg`, `bg-graphite-*`, `bg-accent`), campos de nova senha e confirmação com alternador de visibilidade (olho), botão "Salvar Nova Senha" e botão secundário "Abrir no Aplicativo Móvel" (`clickprestare://redefinir-senha?token=...`).
- [ ] **Passo 3: Registrar rota `/redefinir-senha` em `app.routes.ts`**
- [ ] **Passo 4: Atualizar template do `MailService.sendResetPasswordLink`**
  - O botão principal passa a ser `https://www.clickprestarecondominios.com.br/redefinir-senha?token=${token}`.
  - Adicionar link de contingência e menção ao app móvel.
- [ ] **Passo 5: Rodar testes do componente e validar build da `portaria-web`**
  - Executar: `npx nx test portaria-web` e `npx nx build portaria-web`.
- [ ] **Passo 6: Commit do Task 1**

---

### Task 2: [F2] Ajustes Menores — Concorrência, Timing Attack, Limite por E-mail e Auditoria

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts`

- [ ] **Passo 1: Atualizar testes em `redefinir-senha.spec.ts`**
  - Teste 1: Rejeição concorrente do mesmo token (update condicional atômico).
  - Teste 2: Limite de no máximo 3 solicitações por hora por e-mail/conta.
  - Teste 3: Auditoria grava com `id_condominio` real da conta em vez de 0.
  - Teste 4: `solicitarRedefinicaoSenha` não aguarda o envio de e-mail (retorno imediato e não-bloqueante).
- [ ] **Passo 2: Implementar consumo atômico de token**
  - Usar `this.prisma.redefinicoes_Senha.updateMany({ where: { token_hash, usado_em: null, expira_em: { gt: now } }, data: { usado_em: now } })`. Se `count === 0`, lançar `BadRequestException('Link de redefinição inválido ou expirado.')`.
- [ ] **Passo 3: Implementar envio assíncrono de e-mail (Eliminação do Timing Attack)**
  - Chamar `setImmediate(() => { this.mail.sendResetPasswordLink(...).catch(...) })` após gravar o token. Resposta HTTP retorna imediatamente sem esperar o transporte SMTP/Resend.
- [ ] **Passo 4: Implementar rate limit por e-mail**
  - Consultar se já existem >= 3 registros em `redefinicoes_Senha` na última 1 hora para aquela conta. Se sim, logar aviso e retornar sucesso genérico imediatamente sem gerar novo token nem enviar e-mail.
- [ ] **Passo 5: Resolver `id_condominio` real para registro no `AuditLog`**
  - Buscar condomínio associado ao síndico (`sindicos_Condominios`), morador (`apartamentos_Users` -> `apartamento.id_condominio`) ou funcionário (`funcionarios_Portaria.id_condominio`).
- [ ] **Passo 6: Rodar `npx jest --testPathPatterns=redefinir-senha.spec.ts` e confirmar 100% de sucesso**
- [ ] **Passo 7: Commit do Task 2**

---

### Task 3: [F4] `portaria-web` Chamando a API Diretamente

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/shared/api.config.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/auth/auth.interceptor.ts`
- Test: `click-cond-web/apps/portaria-web/src/app/auth/auth.interceptor.spec.ts`

- [ ] **Passo 1: Escrever teste no `auth.interceptor.spec.ts`**
  - Testa que URLs relativas iniciando com `/api/` são reescritas para `https://api.clickprestarecondominios.com.br/api/...` quando em ambiente de produção (não-localhost).
- [ ] **Passo 2: Atualizar `api.config.ts`**
  - Definir `API_BASE` dinâmico: `'http://localhost:3000/api'` ou `'/api'` em localhost; `'https://api.clickprestarecondominios.com.br/api'` em produção.
- [ ] **Passo 3: Atualizar `auth.interceptor.ts`**
  - Interceptar qualquer requisição com `url.startsWith('/api')` e garantir redirecionamento direto para `https://api.clickprestarecondominios.com.br`, garantindo que nenhuma chamada fique no proxy do Amplify.
- [ ] **Passo 4: Executar testes da `portaria-web` e validar build**
  - Executar: `npx nx test portaria-web` e `npx nx build portaria-web`.
- [ ] **Passo 5: Commit do Task 3**

---

### Task 4: [F4] Trust Proxy = 2 e Extração Confiável de IP na Auditoria

**Files:**
- Modify: `click-cond-web/apps/api/src/main.ts`
- Modify: `click-cond-web/apps/api/src/app/common/context/request-context.ts`
- Modify: `click-cond-web/apps/api/src/app/common/throttle/trust-proxy.spec.ts`

- [ ] **Passo 1: Atualizar testes em `trust-proxy.spec.ts`**
  - Teste 1: Com `trust proxy = 2` e dois proxies à frente (ALB + CloudFront), o IP resolvido por `req.ip` e por `extractClientIp` é o IP real do cliente, ignorando headers `X-Forwarded-For` forjados injetados pelo cliente.
  - Teste 2: `extractClientIp` não mais divide cegamente `X-Forwarded-For` pelo índice 0.
- [ ] **Passo 2: Atualizar `extractClientIp` em `request-context.ts`**
  - Priorizar `req.ip` (resolvido com base na regra de trust proxy configurada no Express) e só então fallbacks sanitizados de socket/conexão.
- [ ] **Passo 3: Ajustar `app.set('trust proxy', 2)` no `main.ts`**
  - Configurar exatamente 2 saltos (CloudFront + ALB).
- [ ] **Passo 4: Executar suíte de testes do backend**
  - Executar: `npx jest --testPathPatterns="(trust-proxy|throttlers|redefinir-senha)\.spec\.ts"`.
  - Executar: `npx tsc --noEmit -p tsconfig.app.json`.
- [ ] **Passo 5: Commit do Task 4**

---

### Task 5: Validação Global, Sincronização de Branches e Teste no Emulador

- [ ] **Passo 1: Executar testes completos e typecheck (`npx nx test api`, `npx nx build api`, `npx nx build portaria-web`)**
- [ ] **Passo 2: Sincronizar branches `master` e `main` e enviar para `origin` (disparando deploy na AWS)**
- [ ] **Passo 3: Validar que o app no emulador Android continua funcionando e abre links de contingência**
- [ ] **Passo 4: Reportar resultados ao usuário com guia de verificação em produção**
