# Segurança de aplicação — pentest trimestral e revisão do pipeline

Última revisão: 2026-11-04 · Dono: o fundador (Vinicius Vilela) · Cadência: **trimestral** (jan, abr, jul, out) para pentest e revisão do pipeline; **a cada mudança relevante** para a revisão de código de segurança.

Relacionados: [modelo-de-ameacas.md](modelo-de-ameacas.md), [objetivos-de-controle.md](objetivos-de-controle.md), [plano-resposta-incidentes.md](plano-resposta-incidentes.md), [melhoria-continua.md](melhoria-continua.md).

## 1. Estado atual (o que existe hoje, com evidência)

| Prática | Estado | Evidência |
|---|---|---|
| Auditoria de segurança manual do código | Feita em 23/09 (achados F2/F4 com plano) | `docs/superpowers/plans/2026-09-24-f3-f2-f4-seguranca-implementacao.md` |
| Varredura de vazamento de segredos | Feita em 20/10 (repo privado, porta 3306 fechada) | `docs/superpowers/plans/2026-10-20-correcoes-varredura-vazamento.md` |
| Testes automatizados de regressão de segurança | Rodam em todo push/PR (`nx test api`) | `common/security-hardening.spec.ts`, `auth/*.spec.ts`, `auth/mobile-auth.authz.spec.ts`, `auth/tenant-access.*.spec.ts`, `common/storage/storage-delete-prefixo.spec.ts` |
| Typecheck, testes e build em todo push e PR | Ativo | `.github/workflows/ci.yml` |
| Varredura de dependências | `npm audit` no CI (informativo, não bloqueia) + Dependabot semanal (npm, pub, actions) | `ci.yml` job `audit`, `.github/dependabot.yml` |
| Deploy sem chave estática | Os dois caminhos de deploy (`deploy-api.yml` na `main` e o job `deploy` do `ci.yml` no `master`) usam OIDC com a role `github-deploy-prestare` | `.github/workflows/deploy-api.yml`, `.github/workflows/ci.yml` |
| Verificação pós-deploy | Confere a versão no EB, saúde do ambiente e `/api/health` com CORS | `deploy-api.yml` |
| Pentest interno (caixa-branca + dinâmico limitado) | **Primeiro ciclo executado em 2026-11-04**: 1 achado Alto (P-01, corrigido no código; causa raiz, o signup sem verificação de e-mail, segue aberta). Próximo até 2027-02-04 | [pentest/README.md](pentest/README.md), [pentest/2026-11-04-pentest-interno.md](pentest/2026-11-04-pentest-interno.md) |
| Pentest externo / de caixa preta | **Não realizado** | — |
| SAST/DAST automatizado (CodeQL, ZAP) | **Não existe** | — |
| Varredura de segredos no CI | **Não existe** (só as varreduras manuais) | — |

## 2. Pentest trimestral

Responsável: o fundador. Ciclo: um por trimestre, ~1 dia de trabalho, contra o **ambiente de produção com o condomínio de teste** (nunca contra dados de cliente real) ou, quando existir, um ambiente de staging.

### 2.1 Escopo mínimo de cada ciclo

1. **Autenticação**: força bruta e throttle (`auth/auth.controller.ts`, `mobile-auth.controller.ts`), MFA (limite de 5 tentativas, replay do desafio, `mfa_token` reutilizado), recuperação de senha, expiração e invalidação de JWT.
2. **Autorização / isolamento**: com duas contas de condomínios diferentes, tentar ler/alterar recursos do outro por id (IDOR) em todos os controllers com `:idCondominio` e, sobretudo, nas rotas **sem** `:idCondominio`, que dependem do service (ver comentário em `auth/tenant.guard.ts`). Testar também token de porteiro e `crm_admin` em rotas do app e vice-versa (`auth/usuario-app.guard.ts`).
3. **Entrada de dados**: payloads com campos extras (o `ValidationPipe` usa `whitelist`), tipos trocados, limites (JSON de até 100 MB), upload com MIME perigoso (`common/storage/storage.service.ts`), URLs que o servidor busca (SSRF — `common/url-segura.util.ts`).
4. **Superfície pública**: rotas `@Public()`, webhooks (WhatsApp HMAC, facial/hardware sem CORS), `INTERNAL_SYNC_TOKEN`, simuladores em `/assets` (`common/assets-estaticos.util.ts`).
5. **Infraestrutura**: acesso direto ao ALB e às instâncias (deve falhar fora do CloudFront), portas expostas, RDS inalcançável pela internet, bucket de arquivos privado (listagem, escrita anônima, URL assinada expirada), cabeçalhos de segurança, CORS.
6. **Assistente IA**: prompt injection, vazamento de contexto de outro condomínio, abuso de custo (`chat-ia/`).
7. **App móvel**: segredos embutidos no binário, armazenamento do token, pinning não é exigido hoje.

### 2.2 Execução

- Ferramentas: Burp Suite Community ou OWASP ZAP, `curl`, scripts de teste de IDOR, `npm audit`, `trufflehog`/`gitleaks` no repositório.
- Registrar achados em uma nota por ciclo (data, achado, severidade, evidência, correção, data de fechamento). Local: `docs/operacao/pentest/AAAA-MM-DD-pentest-interno.md`, com o roteiro do ciclo em [pentest/README.md](pentest/README.md).
- Severidade ≥ alta: tratar como incidente SEV2 ([plano-resposta-incidentes.md](plano-resposta-incidentes.md)); corrigir com teste de regressão antes de fechar.
- A cada achado corrigido, acrescentar um `*.spec.ts` no mesmo padrão dos existentes e atualizar o [modelo de ameaças](modelo-de-ameacas.md).

### 2.3 Pentest independente

Uma vez por ano, ou antes de fechar contrato com cliente que exija, contratar teste de terceiros. Orçamento e escolha: decisão do fundador. Hoje **não contratado**.

## 3. Revisão trimestral do pipeline

Checklist (o fundador executa no mesmo dia do pentest):

- [ ] `.github/workflows/*.yml`: nenhuma ação sem versão fixa de major; permissões mínimas (`permissions:` por workflow); o deploy usa só OIDC (nenhum `AWS_ACCESS_KEY_ID`); `database-migration.yml` e `prepare-api-domain.yml` foram aposentados e não devem reaparecer.
- [ ] Role `github-deploy-prestare` no IAM: política só com o necessário (Elastic Beanstalk e o bucket do bundle); trust policy limitada ao repositório e à branch/ambiente; sem chaves estáticas do GitHub sobrando em *Settings → Secrets* (os secrets do usuário `github-actions-deploy` foram removidos em 2026-11-04). Conferir também que nenhum usuário IAM tem chave de acesso ativa e que o acesso humano é pelo IAM Identity Center.
- [ ] Dependabot: PRs abertos há mais de 30 dias; atualizar ou justificar.
- [ ] `npm audit`: nenhum `high`/`critical` aberto sem decisão registrada. Se algum persistir, decidir se o job `audit` passa a bloquear (hoje é informativo).
- [ ] Segredos: listar os parâmetros `/prestare/api/*` no SSM e conferir a data da última rotação (SMTP, `JWT_SECRET`, `INTERNAL_SYNC_TOKEN`, Superlógica, Firebase, `DATABASE_URL`); conferir que nenhum segredo voltou para o ambiente do EB e o limite de 4096 caracteres do que sobrou.
- [ ] Migrações: aplicadas manualmente pelo túnel SSM (`runbooks.md`, seção 6), **antes** do push, a partir de arquivos revisados de `click-cond-web/prisma/sql/`; compatíveis com o código antigo (rolling).
- [ ] Branches `master` e `main`: `master` e `main` disparam deploy (ambos por OIDC, com verificação de versão); conferir proteção de branch no GitHub.
- [ ] Repositório continua privado; checar *Security → Secret scanning* do GitHub e alertas abertos.
- [ ] Último deploy: o passo "Verify deployed version" passou? (falha silenciosa já aconteceu — env acima de 4096).

## 4. Revisão de código de segurança (a cada mudança)

Antes de fazer merge de mudanças em autenticação, autorização, upload, expurgo, webhooks ou rotas novas:

1. A rota é `@Public()` de propósito? Se não, está sob `JwtAuthGuard` global.
2. O recurso pertence ao condomínio do token? (`TenantGuard` não cobre rotas sem `:idCondominio`; checar no service.)
3. Rota do app: usa `UsuarioAppGuard`/`idUsuarioApp` (nunca `sub` cru).
4. Input novo: DTO validado; upload só pelos tipos de `StorageService`.
5. Dado pessoal novo: entra em [classificacao-e-retencao-de-dados.md](classificacao-e-retencao-de-dados.md) com prazo.
6. Há teste de regressão, inclusive o caso negativo (acesso negado).

## 5. Itens a implementar (compromissos com data)

| Item | Prazo | Dono |
|---|---|---|
| Primeiro pentest interno completo e nota em `docs/operacao/pentest/` | **Feito em 2026-11-04**. Próximo ciclo até 2027-02-04 | Fundador |
| Verificação de e-mail no cadastro (causa raiz do P-01) | Antes do primeiro cliente real | Fundador |
| Habilitar secret scanning/push protection no GitHub | Próximo trimestre | Fundador |
| Avaliar CodeQL no CI | Próximo trimestre | Fundador |
| Decidir se `npm audit` passa a bloquear o CI | Na primeira revisão de pipeline | Fundador |

## Riscos aceitos / pendentes

- Nunca houve pentest externo; a confiança vem do pentest interno de 04/11, da auditoria de 23/09, da varredura de 20/10 e dos testes automatizados.
- Causa raiz do P-01 aberta: cadastro sem verificação de e-mail.
- `npm audit` é informativo; vulnerabilidade `high` pode chegar ao `main`. O Dependabot e a revisão trimestral são a rede de segurança.
- O CI do `master` convive com testes antigos; os dois caminhos publicam, então conferir a verificação de versão a cada deploy.
- Pessoa única executa, revisa e aprova: não há revisão por segundo par de olhos. Mitigação: checklist e testes automatizados; contratar revisão externa anual.
- Conta AWS compartilhada com o projeto Volti (cargas não separadas em contas distintas), bucket antigo `storage-click-dev` ainda público em outra conta e demais pendências: ver [modelo-de-ameacas.md](modelo-de-ameacas.md), seção 5.
