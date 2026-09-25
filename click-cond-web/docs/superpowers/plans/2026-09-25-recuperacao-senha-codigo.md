# Recuperação de Senha por Código de 6 Dígitos no App Mobile — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o fluxo nativo de recuperação de senha por código de 6 dígitos no App Mobile (Flutter) integrado à API (NestJS/Prisma), com design padronizado à tela de login e login automático imediato na conclusão.

**Architecture:** Fluxo em 3 etapas desacopladas: (1) Solicitação de código por e-mail com `ticket_id`; (2) Validação do código de 6 dígitos no app com limite de 5 tentativas e emissão de `reset_token`; (3) Persistência da nova senha com retorno imediato do token JWT de autenticação para entrada direta na Home.

**Tech Stack:** Flutter / Dart, NestJS / TypeScript, Prisma ORM, MySQL, Nodemailer / SES.

**Spec:** `click-cond-web/docs/superpowers/specs/2026-09-25-recuperacao-senha-codigo-design.md`

## Global Constraints

- **Design System:** Todas as telas de recuperação devem obrigatoriamente usar `GridBackground()`, botão circular de voltar no topo esquerdo, logo oficial `PRESTARE GESTÃO` com squircle, card arredondado (`24px`), badge de perfil no topo do card e botão azul com seta (`ENTRAR →` ou `AVANÇAR →`).
- **Segurança de Código:** Expiração de 10 minutos para o código numérico de 6 dígitos, limite rígido de 5 tentativas incorretas com bloqueio do desafio e proteção contra timing attack na solicitação.
- **Auto-Login:** A rota de alteração de senha deve responder com payload idêntico ao login bem-sucedido (JWT + dados do usuário), permitindo que o app salve a sessão no `LocalStorage` e entre direto no condomínio sem pedir senha novamente.
- **Compatibilidade:** O endpoint web de redefinição anterior (`/auth/redefinir-senha` via link) não pode ser quebrado para a portaria-web.

---

### Task 1: Banco de Dados e Migração SQL

**Files:**
- Create: `click-cond-web/prisma/sql/2026-09-25-redefinicoes-senha-codigo.sql`
- Modify: `click-cond-web/prisma/schema.prisma`

**Interfaces:**
- Produces: colunas `ticket_id`, `codigo_hash`, `tentativas`, `reset_token_hash`, `verificado_em` na tabela `redefinicoes_senha`.

- [ ] **Step 1: Criar o script SQL idempotente de migração**
```sql
-- click-cond-web/prisma/sql/2026-09-25-redefinicoes-senha-codigo.sql
ALTER TABLE `redefinicoes_senha`
  ADD COLUMN IF NOT EXISTS `ticket_id` VARCHAR(64) NULL AFTER `id_conta`,
  ADD COLUMN IF NOT EXISTS `codigo_hash` VARCHAR(255) NULL AFTER `token_hash`,
  ADD COLUMN IF NOT EXISTS `tentativas` INT NOT NULL DEFAULT 0 AFTER `codigo_hash`,
  ADD COLUMN IF NOT EXISTS `reset_token_hash` CHAR(64) NULL AFTER `tentativas`,
  ADD COLUMN IF NOT EXISTS `verificado_em` DATETIME NULL AFTER `usado_em`;
```

- [ ] **Step 2: Atualizar o modelo no `schema.prisma`**
Adicionar os campos ao model `redefinicoes_Senha` no `schema.prisma` e gerar o Prisma Client:
`npx prisma generate`

- [ ] **Step 3: Aplicar a migração no banco de dados local/produção**
Executar via script node / prisma db execute.

- [ ] **Step 4: Commit**
```bash
git add prisma/sql/2026-09-25-redefinicoes-senha-codigo.sql prisma/schema.prisma
git commit -m "feat(db): add 6-digit code support columns to redefinicoes_senha"
```

---

### Task 2: Template de E-mail de Código no Backend (`MailService`)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/common/mail/mail.service.ts`
- Test: `click-cond-web/apps/api/src/app/common/mail/mail.service.spec.ts`

**Interfaces:**
- Produces: `sendResetPasswordCode(email: string, nome: string, codigo: string): Promise<boolean>`

- [ ] **Step 1: Escrever o teste unitário para `sendResetPasswordCode`**
Criar teste verificando se o HTML gerado inclui o código de 6 dígitos formatado, o nome do usuário e o aviso de expiração de 10 minutos.

- [ ] **Step 2: Rodar o teste para verificar que falha**
`npx jest apps/api/src/app/common/mail/mail.service.spec.ts`

- [ ] **Step 3: Implementar `sendResetPasswordCode` no `MailService`**
Adicionar template HTML estilizado com a marca Prestare Gestão, caixa azul de destaque com letras grandes e monoespaçadas para o código e rodapé de segurança.

- [ ] **Step 4: Rodar o teste para verificar aprovação**
`npx jest apps/api/src/app/common/mail/mail.service.spec.ts`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/app/common/mail/mail.service.ts apps/api/src/app/common/mail/mail.service.spec.ts
git commit -m "feat(mail): implement sendResetPasswordCode template in MailService"
```

---

### Task 3: Endpoints da API no NestJS (`MobileAuthService` & `MobileAuthController`)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts`
- Test: `click-cond-web/apps/api/src/app/auth/redefinir-senha.spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/auth/mobile/solicitar-codigo-redefinicao` -> `{ success: true, ticket_id, email_masked, expira_em_segundos: 600 }`
  - `POST /api/auth/mobile/validar-codigo-redefinicao` -> `{ success: true, reset_token }`
  - `POST /api/auth/mobile/redefinir-senha` -> `{ success: true, token, user, message }`

- [ ] **Step 1: Escrever os testes unitários cobrindo o ciclo de vida completo do código de 6 dígitos**
Casos de teste:
1. Solicitação com geração de código e retorno de `ticket_id`.
2. Validação com código correto gerando `reset_token`.
3. Validação com código incorreto incrementando tentativas e exibindo contagem restante.
4. Bloqueio automático após 5 tentativas incorretas.
5. Rejeição de código expirado.
6. Alteração de senha com `reset_token` retornando token JWT e payload de login.

- [ ] **Step 2: Rodar os testes para verificar que falham**
`npx jest apps/api/src/app/auth/redefinir-senha.spec.ts`

- [ ] **Step 3: Implementar a lógica no `MobileAuthService` e controllers**
Implementar geração criptográfica (`crypto.randomInt(100000, 999999)`), hash bcrypt do código, disparo assíncrono de e-mail, validação de tentativas e geração de sessão JWT de login após salvar a nova senha.

- [ ] **Step 4: Rodar os testes para verificar aprovação completa**
`npx jest apps/api/src/app/auth/redefinir-senha.spec.ts`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/app/auth/mobile-auth.service.ts apps/api/src/app/auth/mobile-auth.controller.ts apps/api/src/app/auth/redefinir-senha.spec.ts
git commit -m "feat(api): implement 6-digit code recovery endpoints with auto-login"
```

---

### Task 4: Atualização dos Serviços HTTP no Flutter (`controller_sindico.dart`)

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/controllers/controller_sindico.dart`

**Interfaces:**
- Produces:
  - `solicitarCodigoRedefinicaoApi(String email, String loginType): Future<Map<String, dynamic>>`
  - `validarCodigoRedefinicaoApi(String ticketId, String codigo): Future<String>`
  - `redefinirSenhaComAutoLoginApi(String resetToken, String novaSenha, String loginType): Future<Map<String, dynamic>>`

- [ ] **Step 1: Adicionar as 3 funções HTTP no `controller_sindico.dart`**
Conectar com os novos endpoints da API, tratando mensagens de erro da API e serialização JSON.

- [ ] **Step 2: Verificar sintaxe e integridade Dart**
Rodar verificação nos controllers.

- [ ] **Step 3: Commit**
```bash
git add click-cond-app/click-cond-app/lib/controllers/controller_sindico.dart
git commit -m "feat(mobile): add 6-digit recovery API methods in controller_sindico"
```

---

### Task 5: Redesenho da Tela de Solicitação no Flutter (`forgot_password.dart`)

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/sindico/forgot_password.dart`

**Interfaces:**
- Consumes: `solicitarCodigoRedefinicaoApi`
- Produces: navegação para `RecuperarSenhaCodigoPage(ticketId, emailMasked, loginType, email)`

- [ ] **Step 1: Refatorar layout para aderir 100% ao design system de Login**
Adicionar:
- `Scaffold` com `GridBackground()` + gradiente vertical.
- Botão circular de voltar (`_buildBackButton`).
- Marca oficial com logo squircle e texto `PRESTARE GESTÃO` (`_buildBrand`).
- Card central flutuante (`_buildFormCard`) com cantos arredondados (`24px`).
- Badge do perfil selecionado (`_buildTypeBadge`).
- Campo moderno `AppInput` com ícone de envelope.
- Botão azul `ENVIAR CÓDIGO →`.

- [ ] **Step 2: Conectar ao `solicitarCodigoRedefinicaoApi`**
Ao submeter o e-mail, chamar a API, receber `ticket_id` e `email_masked`, e navegar suavemente para `RecuperarSenhaCodigoPage`.

- [ ] **Step 3: Commit**
```bash
git add click-cond-app/click-cond-app/lib/pages/sindico/forgot_password.dart
git commit -m "feat(mobile): redesign forgot_password screen to match login aesthetic"
```

---

### Task 6: Nova Tela de Digitação do Código de 6 Dígitos no Flutter (`recuperar_senha_codigo_page.dart`)

**Files:**
- Create: `click-cond-app/click-cond-app/lib/pages/sindico/recuperar_senha_codigo_page.dart`

**Interfaces:**
- Consumes: `ticket_id`, `email_masked`, `loginType`, `validarCodigoRedefinicaoApi`, `solicitarCodigoRedefinicaoApi`
- Produces: navegação para `RecuperarSenhaNovaSenhaPage(resetToken, loginType)`

- [ ] **Step 1: Criar a tela com o padrão visual do Login**
Incluir `GridBackground()`, circular back button, logo, card, profile badge ("Morador" / "Síndico" / "Funcionário").

- [ ] **Step 2: Implementar as 6 caixinhas individuais de PIN**
Entrada de 6 dígitos com auto-avanço, colagem direta da área de transferência e envio automático ao preencher o 6º dígito.

- [ ] **Step 3: Implementar o cronômetro de 10 min e o botão de reenvio com 60s de cooldown**
Exibir contagem regressiva e habilitar "Reenviar código" após 60 segundos.

- [ ] **Step 4: Conectar à validação na API e avançar para a Etapa 3**
Ao receber o `reset_token`, navegar para `RecuperarSenhaNovaSenhaPage`.

- [ ] **Step 5: Commit**
```bash
git add click-cond-app/click-cond-app/lib/pages/sindico/recuperar_senha_codigo_page.dart
git commit -m "feat(mobile): add 6-digit PIN code verification screen"
```

---

### Task 7: Nova Tela de Nova Senha com Auto-Login no Flutter (`recuperar_senha_nova_senha_page.dart`)

**Files:**
- Create: `click-cond-app/click-cond-app/lib/pages/sindico/recuperar_senha_nova_senha_page.dart`

**Interfaces:**
- Consumes: `reset_token`, `loginType`, `redefinirSenhaComAutoLoginApi`
- Produces: login automático, persistência no `LocalStorage` e redirecionamento para o Dashboard inicial correspondente.

- [ ] **Step 1: Criar a tela com o padrão visual do Login**
Incluir `GridBackground()`, circular back button, logo, card, profile badge.

- [ ] **Step 2: Implementar os campos de "Nova Senha" e "Confirmar Senha"**
Adicionar alternador de visibilidade (olhinho), validação de correspondência e indicador visual de tamanho mínimo (6 caracteres).

- [ ] **Step 3: Implementar o salvamento de senha e bootstrapping da sessão de login**
Ao clicar em "SALVAR E ENTRAR →":
1. Chamar `redefinirSenhaComAutoLoginApi`.
2. Salvar credenciais e JWT no `LocalStorage` (`saveToken`, `saveUser`, etc.).
3. Exibir diálogo ou toast de boas-vindas.
4. Redirecionar com `Navigator.pushAndRemoveUntil` para a rota principal do perfil (ex: `DashboardMoradorPage`).

- [ ] **Step 4: Commit**
```bash
git add click-cond-app/click-cond-app/lib/pages/sindico/recuperar_senha_nova_senha_page.dart
git commit -m "feat(mobile): add new password screen with seamless auto-login"
```

---

### Task 8: Verificação de Build, Testes e Integração Final

**Files:**
- All touched files

- [ ] **Step 1: Rodar a suíte completa de testes unitários da API**
`npx jest apps/api/src/app/auth/redefinir-senha.spec.ts`

- [ ] **Step 2: Rodar o analisador do Flutter para garantir zero erros de tipagem/linter**
`flutter analyze` em `click-cond-app/click-cond-app`

- [ ] **Step 3: Testar e validar o fluxo visual no emulador**

- [ ] **Step 4: Commit final e fechamento**
```bash
git commit -m "chore: complete 6-digit password recovery with auto-login integration"
```
