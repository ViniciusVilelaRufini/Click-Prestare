# Segurança — F2 (recuperação de senha) e F4 (IP do cliente forjável)

Data: 2026-09-24 · Status: **plano, execução adiada** (próxima rodada). Origem: auditoria de
23/09 (`click-cond-web/docs/superpowers/evidence/2026-09-23-security-audit-backend.md`, na
branch `production-readiness`), que marcou os dois como **Alto** e bloqueantes para cliente
real. Ambos conferidos de novo no código de produção (master `ab4b19cc`) em 24/09: continuam
abertos.

Ao retomar: reler este plano, confirmar as decisões marcadas com ❓ com o usuário e seguir o
processo de sempre (brainstorming curto → spec → plano de implementação → implementação com
testes → revisão → deploy).

---

## Pré-requisito: F3 (limite de tentativas) ainda não está em produção

A auditoria corrigiu o F3 só na branch `production-readiness`. No master, três controllers
ainda usam `@Throttle({ default: ... })`, e esse nome de throttler não existe (os configurados
chamam-se `short` e `medium`). O limite é ignorado em:

- `apps/api/src/app/auth/auth.controller.ts`
- `apps/api/src/app/crm/crm-auth.controller.ts`
- `apps/api/src/app/visitantes/visitantes.controller.ts`

F2 e F4 dependem de limite de tentativas funcionando. **Fazer o F3 primeiro:** trocar para
`medium` (ou `short`) e trazer da branch o teste estrutural que impede `default` de voltar
(`throttlers.spec.ts`, commits `cab20b95`/`e116116c` em `production-readiness`).

---

## F2 — "Esqueci minha senha" troca a senha na hora

### Como está hoje

Rotas públicas (sem login):

- `POST /api/sindico/recovery-password`
- `POST /api/moradores/recovery-password`
- `POST /api/funcionarios/recovery-password`

Controller: `apps/api/src/app/auth/mobile-auth.controller.ts` (linhas ~47, ~118, ~208; já com
`@Throttle({ medium: { limit: 10, ttl: 60_000 } })`). Serviço:
`apps/api/src/app/auth/mobile-auth.service.ts` (`recoveryPasswordSindico`,
`recoveryPasswordMorador`, `recoveryPasswordFuncionario`, ~linhas 2379–2418). O fluxo:

1. Recebe um e-mail.
2. Se não existe → `404 E-mail não encontrado`.
3. Se existe → **gera senha nova, grava o hash na hora** e manda a senha por e-mail
   (`mail.sendForgotPassword`).

Telas: app Flutter `lib/pages/sindico/forgot_password.dart` (e textos em
`lib/utils/localizable/*`); ver se a portaria-web tem tela equivalente para funcionário.

### Problemas

1. **Qualquer um derruba o acesso de qualquer um:** basta saber o e-mail. A senha muda na
   hora; o dono fica sem entrar até ler o e-mail. Repetível à vontade (10/min por IP, e com o
   F4 aberto o IP é forjável).
2. **Enumeração de contas:** a resposta diferencia e-mail existente (200) de inexistente
   (404).
3. **Senha em texto puro no e-mail:** fica guardada na caixa de entrada para sempre.

### Solução proposta: link de redefinição com prazo

1. **Pedido** (`POST .../recovery-password`, mesmas 3 rotas para não quebrar o app atual):
   - resposta **sempre igual**, com o mesmo tempo de resposta:
     `200 { success: true, mensagem: "Se o e-mail estiver cadastrado, enviamos as instruções." }`;
   - se a conta existe: gera um token aleatório (`randomBytes(32)`), grava **só o hash**
     (SHA-256) com o papel, o id da conta, a expiração (**30 min**) e `usado_em = null`;
     invalida pedidos anteriores ainda abertos da mesma conta; manda por e-mail um **link**
     (não a senha);
   - **a senha atual não muda.**
2. **Tabela nova** (SQL em `prisma/sql/`, allowlist do `scripts/run-sql-migration.mjs`,
   aplicar antes do deploy):
   `Redefinicoes_Senha (id, papel ENUM('sindico','morador','funcionario'), id_conta INT,
   token_hash CHAR(64) UNIQUE, expira_em DATETIME, usado_em DATETIME NULL, criado_em,
   ip VARCHAR(45) NULL)`.
3. **Confirmação** (rota pública nova, ex. `POST /api/auth/redefinir-senha`
   `{ token, nova_senha }`): valida hash, prazo e uso único; aplica a mesma regra de força de
   senha do `updatePassword`; grava com bcrypt; marca `usado_em`; audita
   (`SENHA_REDEFINIDA`, sem a senha). Token inválido ou expirado → uma mensagem só
   ("link inválido ou expirado").
4. **Página do link:** ❓ decidir onde o link abre:
   - **(recomendado)** página pública na portaria-web (`/redefinir-senha?token=...`), que
     funciona para os três papéis e em qualquer aparelho;
   - ou deep link para o app (exige configurar App Links/Universal Links; mais trabalho).
5. **Limites:** manter `medium` 10/min por IP no pedido; somar limite **por e-mail** (ex. 3
   pedidos/hora) para não virar spam de e-mail; limite na confirmação.
6. **E-mail:** novo modelo "Redefinir sua senha" com o link e o prazo; remover o envio de
   senha em texto puro.
7. ❓ **Sessões abertas:** ao redefinir, derrubar os logins ativos da conta? Exige versão de
   token no JWT. Recomendação: sim, se couber; senão, registrar como pendência.
8. **App:** ajustar o texto da tela "Esqueci minha senha" ("Enviamos um link para o seu
   e-mail"). O app antigo continua funcionando porque as rotas de pedido não mudam.

### Testes

- pedido com e-mail inexistente e existente → mesma resposta; senha **não** muda;
- token: uso único, expira em 30 min, pedido novo invalida o anterior, só o hash no banco;
- confirmação com token de papel A não altera conta de papel B;
- limite por IP e por e-mail;
- e-mail não contém senha.

---

## F4 — IP do cliente pode ser forjado

### Como está hoje

`apps/api/src/main.ts:38`: `app.set('trust proxy', true)`. Com `true`, o Express usa o
endereço **mais à esquerda** do `X-Forwarded-For`, que é o que o próprio cliente manda.
Reproduzido em produção na auditoria (`X-Forwarded-For: 203.0.113.77`, via CloudFront e direto
no EB). Afeta: limite de tentativas (cada tentativa com um IP "novo") e o IP gravado na
auditoria.

Caminhos observados até a API (proxies depois do cliente):

- **App e `api.clickprestarecondominios.com.br`:** cliente → CloudFront → nginx do EB
  (**1** salto).
- **Portaria-web (`www.`, Amplify):** cliente → CloudFront → **EC2 do Amplify (sa-east-1)**
  → CloudFront → nginx (**3** saltos). Isso porque a portaria-web chama a API por caminho
  relativo (`apps/portaria-web/src/app/shared/api.config.ts`: `API_BASE = '/api'`, ~87 usos),
  e o Amplify faz o repasse. O Socket.IO já vai direto para `api.` (`REALTIME_ORIGIN`).

Um número fixo de saltos não serve aos dois caminhos: com `2`, toda a portaria-web apareceria
com o IP do proxy do Amplify e todos os porteiros dividiriam o mesmo limite de login. Confiar
em faixas de IP da AWS permitiria forjar a partir de qualquer instância EC2.

### Solução proposta (ordem importa)

1. **Portaria-web chama a API direto** em produção: `API_BASE` passa a ser
   `https://api.clickprestarecondominios.com.br/api` (em `localhost` continua `/api` com o
   `proxy.conf.json`). Conferir:
   - CORS da API aceita `https://www.clickprestarecondominios.com.br` (a auditoria diz que
     sim) com credenciais/headers usados (Authorization);
   - todos os 87 usos passam por `API_BASE` (nenhuma URL `/api` escrita à mão);
   - uploads, downloads de arquivo e o login por QR funcionam cross-origin;
   - o rewrite `/api` do Amplify pode ficar por um tempo (compatibilidade com abas abertas) e
     sair depois.
   **Deploy do front primeiro** e verificar em produção que a portaria-web não chama mais
   `/api` relativo.
2. **API: `trust proxy` = 1** (um salto: o CloudFront antes do nginx). ❓ Confirmar na hora se o
   nginx do EB acrescenta mais um salto no `X-Forwarded-For` (a auditoria sugeriu `2`); medir
   com um endpoint de diagnóstico temporário, ou logando `req.ips` com um header forjado,
   antes de fixar o número.
3. **Fechar o acesso direto ao EB:** o Security Group do Elastic Beanstalk aceita só as faixas
   do CloudFront (prefix list gerenciada `com.amazonaws.global.cloudfront.origin-facing`).
   Sem isso, quem chama o EB direto continua forjando. **Mudança na AWS: fazer com o usuário.**
4. **Verificação em produção:** `curl -H "X-Forwarded-For: 203.0.113.77"` na rota de
   diagnóstico → o IP registrado tem que ser o real, não o forjado; errar a senha 6 vezes
   trocando o header → tem que bloquear.

### Riscos e reversão

- Se o CORS falhar, a portaria-web para. Reversão: voltar `API_BASE` para `/api` (o rewrite do
  Amplify continua lá).
- `trust proxy` errado faz todos parecerem o mesmo IP (bloqueio coletivo no login) ou volta a
  aceitar IP forjado. Por isso o passo 2 mede antes de fixar.
- Memória relacionada: `proxy-chain-e-ip-cliente` (trust proxy fixo quebra a portaria enquanto
  ela passa pelo Amplify).

---

## Fora deste plano (outras pendências da mesma auditoria)

- Limpar do `AuditLog` as linhas antigas com senha em `detalhes` e **trocar essas senhas**
  (escrita no banco de produção: exige autorização).
- Trazer para o master as outras correções da branch `production-readiness` que ainda faltam
  (conferir uma a uma; a branch divergiu). Confirmadas ausentes em 24/09: filtro de dados
  sensíveis na auditoria e backup automático do Android desligado.
- Cadastro público de síndico (signup aberto), citado como aberto na auditoria.
