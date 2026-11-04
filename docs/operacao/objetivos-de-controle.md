# Objetivos de controle de segurança — Prestare

Última revisão: 2026-11-04 · Dono: o fundador · Revisão: trimestral, junto do [modelo de ameaças](modelo-de-ameacas.md).

Cada objetivo diz o que precisa ser verdade, como é verificado hoje e onde está o controle. "Evidência" é algo que se pode abrir e conferir. Caminhos de código relativos a `click-cond-web/apps/api/src/app/`.

## OC-1 Só quem deve entra (identidade e autenticação)

| Controle | Evidência |
|---|---|
| Senhas armazenadas com bcrypt; MD5 legado é migrado no login | `auth/auth.service.ts`, `auth/senha-bcrypt.spec.ts` |
| JWT assinado com segredo obrigatório (sem fallback) | `auth/jwt-secret.ts` |
| Sessão de porteiro/síndico na portaria-web expira em 24 h (`PORTARIA_JWT_EXPIRES_IN`); sessão do app dura até 365 dias | `auth/auth.service.ts`, `auth/auth.module.ts` |
| Troca de senha invalida tokens anteriores | `auth/jwt.strategy.ts`, `auth/revogacao-troca-senha.spec.ts` |
| MFA por e-mail para síndico no console web | `auth/mfa/mfa.service.ts`, `auth/sindico-login-mfa.spec.ts` |
| Recuperação de senha por código, com throttle | `auth/redefinir-senha.spec.ts`, `auth/auth.controller.ts` |
| Admin do CRM autentica em tabela própria, token com `role: crm_admin` | `crm/crm-auth.service.ts`, `crm/crm-admin.guard.ts` |

Lacuna: sem MFA para porteiro e CRM admin (ver modelo de ameaças, item 7).

## OC-2 Cada um vê só o que é seu (autorização e isolamento)

| Controle | Evidência |
|---|---|
| Guards globais em ordem: JWT, Tenant, Throttler | `app.module.ts` (`APP_GUARD`) |
| Rotas com `:idCondominio` só abrem se o token pertence ao condomínio | `auth/tenant.guard.ts`, `auth/tenant-access.service.ts` |
| Rotas do app exigem token de usuário do app | `auth/usuario-app.guard.ts`, `usuario-app.guard.cobertura.spec.ts` |
| Rotas do CRM exigem `crm_admin` | `crm/crm-admin.guard.ts` |
| Permissões por funcionário (flags) respeitadas nos services | `auth/permissao-funcionario*.spec.ts` |
| Rotas públicas são exceção explícita (`@Public()`) | `auth/public.decorator.ts` |

Regra de desenvolvimento: rota nova sem `:idCondominio` na URL precisa checar o tenant no service; o guard não cobre esse caso (comentário em `tenant.guard.ts`).

## OC-3 Dados protegidos em trânsito e em repouso

| Controle | Evidência |
|---|---|
| TLS no CloudFront; instância só aceita a prefix list do CloudFront, sem SSH, IMDSv2 | configuração do EB/EC2 (conta 850401152034) |
| HSTS 180 dias, Helmet, CORS por lista fechada | `main.ts`, `common/cors-origins.ts` |
| RDS MySQL com criptografia em repouso, backup automático e deletion protection | console RDS `database-1` |
| Upload com lista fechada de tipos e teto de 25 MB | `common/storage/storage.service.ts` |
| Documento de visitante mascarado na interface | portaria-web `moradores-page.component.*` |

Lacuna: fotos em bucket de outra conta com objetos `public-read` (risco aceito, modelo de ameaças item 1).

## OC-4 Dados pessoais têm prazo de vida (LGPD)

Detalhe em [classificacao-e-retencao-de-dados.md](classificacao-e-retencao-de-dados.md).

| Controle | Evidência |
|---|---|
| Expurgo diário de fotos/documentos de visitantes após 90 dias | `visitantes/visitantes.service.ts` (`tickRetencaoDadosVisitantes`), `visitantes/retencao-lgpd-pessoas.spec.ts` |
| Convites mortos expurgados após 7 dias | `convites/convites.service.ts` (`DIAS_RETENCAO_CONVITE`) |
| Revogação de biometria apaga a foto e registra consentimento | `consentimentos/consentimentos.service.ts`, `revogar-biometria-foto.spec.ts` |
| Exclusão de conta pelo titular (`POST /users/delete-account`) remove acesso e rosto nos terminais | `auth/mobile-auth.service.ts` (`deleteAccount`), `auth/delete-account-facial.spec.ts` |
| Purga de condomínio só após desativação e confirmação do nome | `crm/crm-condominios.service.ts` (`purgar`) |

## OC-5 Ações relevantes deixam rastro

| Controle | Evidência |
|---|---|
| Interceptor de auditoria registra IP real e usuário | `common/interceptors/audit.interceptor.ts`, `common/context/request-context.ts` |
| Decisões de acesso físico, mudanças de regra e de dispositivo têm ações próprias | `auditoria/auditoria.service.ts` (`AuditoriaAcao`) |
| Consentimentos são append-only | `consentimentos/consentimentos.service.ts` |

## OC-6 Abuso é limitado

| Controle | Evidência |
|---|---|
| 20 req/s e 600 req/min por IP, global | `common/throttle/throttlers.ts` |
| 5–10 req/min em login, cadastro e recuperação | `@Throttle` em `auth/auth.controller.ts` e `auth/mobile-auth.controller.ts` |
| IP do cliente correto atrás de 2 saltos | `main.ts` (`trust proxy` = 2), `common/throttle/trust-proxy.spec.ts` |
| MFA: 5 tentativas por desafio, depois o código é invalidado | `auth/mfa/mfa.service.ts` |

## OC-7 Mudanças chegam à produção de forma segura

| Controle | Evidência |
|---|---|
| CI: typecheck, testes Jest e builds em todo push e PR | `.github/workflows/ci.yml` |
| Job `audit` roda `npm audit` e `--audit-level=high`, com resumo por severidade na execução; é **informativo** (`continue-on-error`, não bloqueia o merge). Dependabot semanal (npm, pub, actions) abre os PRs de correção | `ci.yml` (job `audit`), `.github/dependabot.yml` |
| Auditoria não grava senhas/segredos de dispositivo; busca de URL externa bloqueia IP privado (SSRF) | `common/interceptors/audit.interceptor.ts` (`redigirSegredos`), `common/url-segura.util.ts`, `common/security-hardening.spec.ts` |
| Deploy por credencial AWS temporária (OIDC, role `github-deploy-prestare`) nos dois caminhos: `main` (`deploy-api.yml`) e `master` (job `deploy` do `ci.yml`). Pendentes com chave estática: `database-migration.yml`, `prepare-api-domain.yml` | `.github/workflows/deploy-api.yml`, `.github/workflows/ci.yml` |
| Passo "Verify deployed version" confere a versão no EB | `deploy-api.yml` |
| Migrações SQL aplicadas manualmente, antes do push, por workflow dedicado ou pelo fundador | `.github/workflows/database-migration.yml`, `click-cond-web/prisma/sql/` |
| Revisão do pipeline e pentest trimestral | [seguranca-de-aplicacao.md](seguranca-de-aplicacao.md) |

## OC-8 Resposta a incidentes

Plano, papéis e playbooks em [plano-resposta-incidentes.md](plano-resposta-incidentes.md). Escalonamento em [responsabilidades-e-escalonamento.md](responsabilidades-e-escalonamento.md).

## Como este documento é mantido

- Quem: o fundador. Quando: a cada trimestre e quando um controle for adicionado, removido ou quebrar.
- Regra: um controle só entra aqui com evidência (arquivo, workflow ou recurso AWS). Se a evidência some, o controle sai ou vira lacuna.

## Riscos aceitos / pendentes

- Bucket de fotos público em outra conta e chave estática `click_user` em quarentena (ver [modelo-de-ameacas.md](modelo-de-ameacas.md), itens 1–2).
- Segredos só em variáveis do EB; senha SMTP a rotacionar; sem IAM Identity Center; conta AWS compartilhada com outro projeto.
- Single-AZ: sem failover automático (RTO/RPO em [plano-recuperacao-desastre.md](plano-recuperacao-desastre.md)).
- Sem MFA para porteiro e CRM admin; JWT do app de 365 dias sem revogação individual.
- Logs de auditoria sem imutabilidade (mesmo banco da aplicação).
