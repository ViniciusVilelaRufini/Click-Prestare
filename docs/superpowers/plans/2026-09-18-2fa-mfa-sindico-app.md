# Autenticação de Dois Fatores (2FA/MFA) no App do Síndico - Plano de Implementação

> **Data:** 2026-09-18  
> **Escopo:** Exclusivo para o **App do Síndico** (`click-cond-app`) e **API NestJS** (`click-cond-web/apps/api`).  
> **Exclusão explícita:** Não se aplica ao CRM Web nem ao Portaria Web.  
> **Abordagem Escolhida:** Abordagem 1 — Código numérico de 6 dígitos por e-mail (SMTP/Resend) + "Lembrar deste aparelho por 30 dias".

---

## 1. Visão Geral

Implementar camada de segurança de segundo fator (2FA/MFA) out-of-band por e-mail para contas de **Síndico** no aplicativo Flutter (`click-cond-app`).
Se o síndico acessar por um novo aparelho ou se a autorização de 30 dias expirou, a API valida login e senha e emite um desafio MFA temporário de 6 dígitos enviado ao e-mail cadastrado. O aplicativo apresenta uma tela dedicada de digitação do código com auto-focus, contagem regressiva e opção "Lembrar deste aparelho por 30 dias".

---

## 2. Estrutura de Arquivos e Componentes

### 2.1. Backend NestJS (`click-cond-web`)
* **Modelo Prisma:** [`prisma/schema.prisma`](file:///click-cond-web/prisma/schema.prisma)
  * `Mfa_Challenges`: Desafio temporário com UUID v4, hash bcrypt do código de 6 dígitos, contagem de tentativas e expiração (10 min).
  * `User_Trusted_Devices`: Dispositivos confiáveis lembrados por 30 dias (SHA-256 do token opaco).
* **Módulo MFA:**
  * [`apps/api/src/app/auth/mfa/mfa.service.ts`](file:///click-cond-web/apps/api/src/app/auth/mfa/mfa.service.ts): Geração criptográfica do código, hashing, verificação, envio de e-mail formatado via `MailService` e emissão de device tokens.
  * [`apps/api/src/app/auth/mfa/mfa.controller.ts`](file:///click-cond-web/apps/api/src/app/auth/mfa/mfa.controller.ts): Endpoints `@Public()`: `POST /auth/mfa/verify` e `POST /auth/mfa/resend`.
* **Login do Síndico:**
  * [`apps/api/src/app/auth/mobile-auth.service.ts`](file:///click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts): Integração do gate 2FA em `loginSindico(login, senha, deviceToken?)`. Se o aparelho for confiável, emite o JWT diretamente; caso contrário, gera o desafio e retorna `{ mfa_required: true, mfa_token: "...", email_masked: "..." }`.
  * [`apps/api/src/app/auth/mobile-auth.controller.ts`](file:///click-cond-web/apps/api/src/app/auth/mobile-auth.controller.ts): Recebe header `x-device-token` ou body `device_token`.

### 2.2. Aplicativo Móvel Flutter (`click-cond-app`)
* **Utilitários e Storage:**
  * [`lib/utils/local_storage.dart`](file:///click-cond-app/click-cond-app/lib/utils/local_storage.dart): Armazenamento seguro de `sindico_device_token`.
  * [`lib/controllers/controller_sindico.dart`](file:///click-cond-app/click-cond-app/lib/controllers/controller_sindico.dart): Atualização do método `loginSindico` e inclusão de `verifyMfaCode` e `resendMfaCode`.
* **Interface do Usuário (UI):**
  * [`lib/pages/sindico/mfa_verification_page.dart`](file:///click-cond-app/click-cond-app/lib/pages/sindico/mfa_verification_page.dart): Tela premium de 6 dígitos com auto-focus, paste, timer de 10 min, cooldown de 60s para reenvio e checkbox de 30 dias.
  * [`lib/pages/sindico/login.dart`](file:///click-cond-app/click-cond-app/lib/pages/sindico/login.dart): Redirecionamento transparente para `MfaVerificationPage` quando `mfa_required == true`.

---

## 3. Tarefas de Implementação (Bite-Sized Tasks)

### Task 1: Banco de Dados e Schema Prisma (Mfa_Challenges & User_Trusted_Devices)
1. Adicionar os modelos `Mfa_Challenges` e `User_Trusted_Devices` em `click-cond-web/prisma/schema.prisma`.
2. Executar `npx prisma db push` contra o RDS e `npx prisma generate` para atualizar as tipagens no monorepo.
3. Testar compilação com `npx nx typecheck api`.
4. Commit: `chore(api): add Mfa_Challenges and User_Trusted_Devices models to Prisma schema`.

### Task 2: Backend - Serviço e Controlador de MFA com TDD
1. Criar `apps/api/src/app/auth/mfa/mfa.service.spec.ts` cobrindo:
   - Geração de código e e-mail mascarado.
   - Validação com código correto, expiração e bloqueio após 5 tentativas.
   - Geração de token de dispositivo confiável por 30 dias.
2. Implementar `mfa.service.ts` e registrar no `mobile-auth.module.ts` / `auth.module.ts`.
3. Criar `mfa.controller.ts` com rotas `@Public()`: `POST /auth/mfa/verify` e `POST /auth/mfa/resend`.
4. Adicionar template de e-mail no `MailService` (`sendMfaCode(email, nome, code)`).
5. Executar os testes unitários (`npx nx test api`).
6. Commit: `feat(api): implement 2FA challenge creation, verification, and email delivery`.

### Task 3: Backend - Integração no Endpoint `POST /sindico/login`
1. Criar teste unitário `sindico-login-mfa.spec.ts` verificando:
   - Login de síndico sem device token -> retorna `mfa_required: true`.
   - Login com device token válido e não expirado -> bypass do MFA, retorna token JWT direto.
   - Login com senha incorreta -> continua retornando erro de credenciais sem disparar MFA.
2. Atualizar `loginSindico` em `mobile-auth.service.ts` e `SindicoMobileController` em `mobile-auth.controller.ts`.
3. Rodar suíte completa de testes da API (1009+ testes).
4. Commit: `feat(api): integrate 2FA challenge and trusted device check into sindico login`.

### Task 4: Frontend Flutter - Controller, Storage e Tela `MfaVerificationPage`
1. Atualizar `lib/utils/local_storage.dart` com getters e setters de `sindico_device_token`.
2. Atualizar `lib/controllers/controller_sindico.dart` com métodos `loginSindico`, `verifyMfaCode`, `resendMfaCode` enviando o `x-device-token`.
3. Criar a tela `lib/pages/sindico/mfa_verification_page.dart` seguindo a identidade visual do app:
   - Gradiente elegante e ícone de escudo (`PhosphorIcons.shieldCheck`).
   - 6 caixas de texto com formatação visual e controle automático de foco e backspace.
   - Timer regressivo dinâmico (`09:59`).
   - Cooldown de 60 segundos no botão "Reenviar código".
   - Checkbox "Lembrar deste aparelho por 30 dias".
4. Integrar em `lib/pages/sindico/login.dart`: ao receber `mfa_required: true`, abrir `MfaVerificationPage`.
5. Criar testes unitários em `test/sindico_mfa_test.dart`.
6. Executar `flutter test` e `flutter analyze --no-fatal-infos --no-fatal-warnings`.
7. Commit: `feat(app): add 2FA verification screen and trusted device handling for sindico`.

### Task 5: Validação End-to-End e Deploy Contínuo
1. Executar bateria de verificação completa:
   - `npx nx typecheck api`
   - `npx nx test api`
   - `flutter test`
   - `npx nx build api`
2. Push para `origin master` disparando o pipeline do GitHub Actions para deploy na AWS Elastic Beanstalk.
3. Teste em produção com curl validando o retorno de `mfa_required: true` no endpoint `/sindico/login`.
