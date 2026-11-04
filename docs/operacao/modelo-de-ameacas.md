# Modelo de ameaças — Prestare

Última revisão: 2026-11-04 · Dono: o fundador (Vinicius Vilela) · Próxima revisão: trimestral (junto do pentest, ver [seguranca-de-aplicacao.md](seguranca-de-aplicacao.md)) e a cada mudança de arquitetura (novo componente, novo provedor, nova superfície pública).

Método: STRIDE simplificado sobre o diagrama de fluxo de dados abaixo. Cada ameaça aponta o controle que existe hoje (com o arquivo) e o risco residual. Controles formais: [objetivos-de-controle.md](objetivos-de-controle.md). Caminhos relativos a `click-cond-web/apps/api/src/app/` salvo indicação.

## 1. O que protegemos

| Ativo | Por que importa |
|---|---|
| Fotos de rosto e templates faciais de moradores | Dado biométrico (LGPD art. 5º, II e art. 11) |
| Fotos de rosto e de documento de visitantes | Dado pessoal identificador |
| Cadastro de moradores, apartamentos, veículos, ocorrências | Dado pessoal + segurança física do condomínio |
| Eventos de acesso (quem entrou, quando) | Perfil de rotina de pessoas |
| Credenciais (senhas, JWT, MFA, chaves de nuvem) | Porta de entrada para todo o resto |
| Disponibilidade da portaria | O porteiro depende do sistema para liberar entrada |

## 2. Diagrama de fluxo de dados (texto)

```
[App Flutter]  [Portaria-web (Amplify)]  [CRM admin]  [Agente local Windows]
        \              |                    |              /
         +------- HTTPS -------> CloudFront api.prestarecondominios.com.br
                                   |  (instância só aceita porta 80 da prefix list do CloudFront)
                                   v
                    Elastic Beanstalk (NestJS, single-instance t3.small)
                      |-- RDS MySQL (criptografado, single-AZ)
                      |-- S3 storage-click-dev (outra conta): fotos/arquivos
                      |-- Amazon Bedrock (assistente IA); Gemini como contingência
                      |-- SMTP, WhatsApp Cloud API, Firebase (push), Superlógica
[Dispositivos Dahua/Intelbras na LAN] <--LAN--> Agente local (só conexões de saída HTTPS)
```

Fronteiras de confiança: Internet → CloudFront → API; API → serviços de terceiros; LAN do condomínio → agente → API.

## 3. Ameaças e controles

### 3.1 Spoofing (identidade)

| Ameaça | Controle existente | Onde |
|---|---|---|
| Adivinhar/roubar senha de síndico ou funcionário | bcrypt (custo 12); hashes MD5 legados migram para bcrypt no primeiro login; throttle de 5–10 req/min nas rotas de login | `auth/auth.service.ts`, `auth/auth.controller.ts`, `auth/mobile-auth.controller.ts` |
| Senha vazada de síndico usada no console web | MFA por e-mail: código de 6 dígitos guardado como bcrypt, vale 10 min, 5 tentativas, dispositivo confiável por 30 dias | `auth/mfa/mfa.service.ts`, `auth.service.ts` (`exigirMfaSindico`) |
| Forjar JWT | `JWT_SECRET` obrigatório, sem fallback: o processo aborta no boot se faltar | `auth/jwt-secret.ts` |
| Token antigo após troca de senha | `senha_alterada_em` invalida tokens emitidos antes | `auth/jwt.strategy.ts`, `auth/senha-alterada.util.ts` |
| Token de porteiro/CRM tratado como usuário do app | `ehTokenDeUsuarioApp` separa os espaços de id | `auth/usuario-app.guard.ts` |
| Chamada falsa às rotas internas do facial | `INTERNAL_SYNC_TOKEN` comparado com `timingSafeEqual` | `facial/facial.controller.ts` |
| Webhook falso do WhatsApp | assinatura HMAC sobre o corpo bruto | `whatsapp/whatsapp-puro.ts`, `main.ts` (`rawBody`) |

### 3.2 Tampering (adulteração)

| Ameaça | Controle | Onde |
|---|---|---|
| Entrada inválida / mass assignment | `ValidationPipe` global com `whitelist` e `transform` | `apps/api/src/main.ts` |
| Upload malicioso (HTML/SVG/JS no bucket público) | lista fechada de MIME, extensão derivada do tipo (nunca do cliente), teto de 25 MB | `common/storage/storage.service.ts` (`TIPOS_PERMITIDOS`, `MAX_UPLOAD_BYTES`) |
| Expurgo apagando objeto alheio via `foto_url` forjada | `deleteUrl` só aceita URL do próprio storage e key dentro de `PREFIXOS_FOTO_*` | `storage.service.ts`, `storage-delete-prefixo.spec.ts` |
| Leitura de arquivos do servidor pelos estáticos | `caminhoEstaticoBloqueado` sobre o caminho decodificado | `common/assets-estaticos.util.ts`, `main.ts` |
| SQL injection | acesso ao banco só via Prisma (consultas parametrizadas) | `prisma/` |

### 3.3 Repudiation (negar autoria)

- Interceptor global grava ações em `AuditLog`/`Auditoria` com o IP real do cliente (AsyncLocalStorage): `common/interceptors/audit.interceptor.ts`, `auditoria/auditoria.service.ts`, `common/context/request-context.ts`.
- Consentimentos são append-only (a revogação é um registro novo): `consentimentos/consentimentos.service.ts`.
- Risco residual: o log de auditoria está no mesmo banco; quem tem acesso ao RDS pode alterá-lo.

### 3.4 Information disclosure

| Ameaça | Controle | Onde |
|---|---|---|
| Porteiro/síndico lê dados de outro condomínio (IDOR) | `TenantGuard` compara `:idCondominio` com o JWT ou resolve o vínculo no banco; services usam `TenantAccessService` | `auth/tenant.guard.ts`, `auth/tenant-access.service.ts` |
| Documento de visitante exposto na tela | mascarado na UI | `apps/portaria-web/src/app/moradores/moradores-page.component.*` |
| Vazamento de segredo no repositório | repo privado; varredura de 20/10; `npm audit` e Dependabot | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| Interceptação em trânsito | HTTPS no CloudFront; HSTS de 180 dias com preload (Helmet) | `main.ts` |
| CORS aberto | lista fechada de origens; `.vercel.app` descartado | `common/cors-origins.ts` |
| Fotos legíveis por quem tiver a URL | **risco aceito**: objetos `public-read` em bucket de outra conta | seção 5, item 1 |

### 3.5 Denial of service

- Throttle global por IP: 20 req/s e 600 req/min (`common/throttle/throttlers.ts`), mais restrito em login e recuperação de senha.
- A instância só aceita tráfego do CloudFront; `trust proxy` de 2 saltos extrai o IP real (`main.ts`, `common/throttle/trust-proxy.spec.ts`).
- Promessa rejeitada e esquecida não derruba o processo (`main.ts`, handler de `unhandledRejection`).
- Risco residual: single-instance e single-AZ; o parser aceita JSON de até 100 MB (`main.ts`), limite alto.

### 3.6 Elevation of privilege

- Perfis por papel (Síndico, Morador, Funcionário, porteiro, `crm_admin`): `auth/usuario-app.guard.ts` (`UsuarioAppGuard`), `crm/crm-admin.guard.ts`; permissões por funcionário cobertas em `auth/permissao-funcionario*.spec.ts`.
- Rotas do app exigem token de usuário do app, não apenas token válido.
- Pipeline: deploy por `main` (`deploy-api.yml`, ambiente `production`) e por `master` (job `deploy` do `ci.yml`), ambos com credencial AWS por OIDC (role `github-deploy-prestare`), sem chave estática. Pendentes com chave estática: `database-migration.yml` e `prepare-api-domain.yml`.

## 4. Ameaças específicas do produto

| Cenário | Controle / lacuna |
|---|---|
| Porteiro libera entrada sem autorização do morador | Portaria remota: o morador autoriza ou nega no app; ação auditada |
| Agente local comprometido na LAN | Só conexões de saída HTTPS; token interno; reenvio offline com deduplicação. Lacuna: o agente guarda credenciais dos dispositivos na máquina do condomínio |
| Rosto órfão em terminal após exclusão | `tickFantasmas` remove biometria órfã (Dahua e Intelbras) e registra `FANTASMAS_REMOVIDOS` |
| Prompt injection no assistente IA | O assistente tem ferramentas que criam reserva, ocorrência, visitante, comunicado etc., mas só **propõe**: a ação fica pendente e só executa após confirmação do usuário no app (`chat-ia/acao-pendente.store.ts`, `chat-ia/chat-ia.service.ts`); consultas filtradas por `id_condominio`. Lacuna: as ações pendentes ficam em memória. Revisar a cada mudança de prompt ou de ferramenta |

## 5. Riscos aceitos / pendentes

1. **Bucket de fotos público em outra conta** (`storage-click-dev`, conta 952520388262): objetos `public-read`, sem controle de acesso por condomínio. Aceito até existir bucket próprio, privado, com URL assinada.
2. **Chave estática do `click_user`** em quarentena da AWS e presente no ambiente do EB. O caminho é usar o role da instância (`common/aws-credenciais.util.ts`); a troca ainda não foi concluída.
3. **Senha SMTP a rotacionar**; segredos ficam em variáveis do EB (limite de 4096 caracteres), sem Secrets Manager/SSM.
4. **Single-AZ / single-instance** (RDS e EB): afeta disponibilidade, não confidencialidade.
5. **Conta AWS compartilhada** com recursos de outro projeto (Volti) e sem IAM Identity Center.
6. **JWT do app dura 365 dias** (`auth/auth.module.ts`); mitigado pela invalidação na troca de senha, mas não existe revogação individual de sessão.
7. **MFA só para síndico no console web**; porteiro e admin do CRM dependem de senha + throttle.
8. **Desafios de MFA pendentes ficam em memória** (`mfaPendentes` em `auth.service.ts`): reinício da instância faz o usuário refazer o login.

Revisão dos itens 1–3: a cada trimestre pelo fundador e, obrigatoriamente, antes de entrar o primeiro cliente com dados reais.
