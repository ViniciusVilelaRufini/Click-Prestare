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
                                   v
                    Application Load Balancer (SG prestare-alb: porta 80 só da prefix list do CloudFront)
                                   v
                    Elastic Beanstalk (NestJS, Auto Scaling 2-4 x t3.small, sa-east-1b/1c; SG só aceita o ALB)
                      |-- RDS MySQL (criptografado, Multi-AZ, subnets privadas sem rota para a internet)
                      |-- SSM Parameter Store /prestare/api/* (segredos, KMS), lido no boot
                      |-- S3 prestare-arquivos-850401152034 (privado, SSE-KMS): fotos/arquivos por URL assinada
                      |-- Amazon Bedrock (assistente IA); Gemini como contingência
                      |-- SMTP, WhatsApp Cloud API, Firebase (push), Superlógica
[Dispositivos Dahua/Intelbras na LAN] <--LAN--> Agente local (só conexões de saída HTTPS)
```

Acesso humano ao banco: AWS CloudShell (Identity Center) → túnel SSM por uma instância → RDS; não há acesso direto da internet.

Fronteiras de confiança: Internet → CloudFront → ALB → API; API → serviços de terceiros; LAN do condomínio → agente → API.

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
| Fotos legíveis por quem tiver a URL | Mitigado em 2026-11-04: bucket privado (Block Public Access, SSE-KMS, só HTTPS) e URLs assinadas de até 1 h. O bucket público antigo (`storage-click-dev`, outra conta) ainda existe até ser desativado; ver seção 5 | `common/storage/storage.service.ts` |
| Segredos lidos do ambiente da instância/console do EB | Segredos no SSM SecureString (KMS), fora do EB; permissão só ao role da instância | `common/segredos-ssm.ts` |
| Banco alcançável pela internet | Banco em subnet sem rota para a internet, `PubliclyAccessible=false`; acesso humano só por túnel SSM | RDS, `scripts/ops/tunel-rds.sh` |

### 3.5 Denial of service

- Throttle global por IP: 20 req/s e 600 req/min (`common/throttle/throttlers.ts`), mais restrito em login e recuperação de senha.
- O ALB só aceita a prefix list do CloudFront e as instâncias só aceitam o ALB; `trust proxy` extrai o IP real (`main.ts`, `common/throttle/trust-proxy.spec.ts`; conferir o número de saltos após a entrada do ALB).
- Bulkhead por dependência (IA 8, Superlógica 4, WhatsApp 8, SMTP 4 por instância): provedor lento não esgota a API, que responde 503 na hora (`common/limitar-concorrencia.ts`). Tarefas agendadas rodam uma vez por cluster (`common/lock-distribuido.ts`) e o bloqueio de login é compartilhado.
- Promessa rejeitada e esquecida não derruba o processo (`main.ts`, handler de `unhandledRejection`).
- Risco residual: o teto é 4 instâncias e o limite de requisições é por instância; sem cópia entre regiões; o parser aceita JSON de até 100 MB (`main.ts`), limite alto.

### 3.6 Elevation of privilege

- Perfis por papel (Síndico, Morador, Funcionário, porteiro, `crm_admin`): `auth/usuario-app.guard.ts` (`UsuarioAppGuard`), `crm/crm-admin.guard.ts`; permissões por funcionário cobertas em `auth/permissao-funcionario*.spec.ts`.
- Rotas do app exigem token de usuário do app, não apenas token válido.
- Pipeline: deploy por `main` (`deploy-api.yml`, ambiente `production`) e por `master` (job `deploy` do `ci.yml`), ambos com credencial AWS por OIDC (role `github-deploy-prestare`), sem chave estática. Os workflows com chave estática (`database-migration.yml`, `prepare-api-domain.yml`) foram aposentados e a chave do usuário `github-actions-deploy` foi desativada. Acesso humano à AWS é pelo IAM Identity Center (sessões de 4 h); root com MFA e sem chaves.

## 4. Ameaças específicas do produto

| Cenário | Controle / lacuna |
|---|---|
| Porteiro libera entrada sem autorização do morador | Portaria remota: o morador autoriza ou nega no app; ação auditada |
| Agente local comprometido na LAN | Só conexões de saída HTTPS; token interno; reenvio offline com deduplicação. Lacuna: o agente guarda credenciais dos dispositivos na máquina do condomínio. Comandos e estado do agente ficam em tabelas compartilhadas (`agente_comandos`, `agente_dispositivos_estado`), válidas para qualquer instância |
| Rosto órfão em terminal após exclusão | `tickFantasmas` remove biometria órfã (Dahua e Intelbras) e registra `FANTASMAS_REMOVIDOS` |
| Prompt injection no assistente IA | O assistente tem ferramentas que criam reserva, ocorrência, visitante, comunicado etc., mas só **propõe**: a ação fica pendente e só executa após confirmação do usuário no app (`chat-ia/acao-pendente.store.ts`, `chat-ia/chat-ia.service.ts`); consultas filtradas por `id_condominio`. Lacuna: as ações pendentes ficam em memória. Revisar a cada mudança de prompt ou de ferramenta |

## 5. Riscos aceitos / pendentes

Resolvidos em 2026-11-04 (registro): bucket de fotos público em outra conta (migrado para bucket privado com URL assinada); chave estática `click_user` (removida do EB, a API usa só o role da instância); segredos só em variáveis do EB (agora no SSM); single-instance/single-AZ (ALB + ASG 2-4 em duas zonas, RDS Multi-AZ); banco acessível pela internet (agora privado); ausência de IAM Identity Center (ativo); chave estática de deploy (desativada).

Abertos:

1. **Ponto de melhoria: conta de gerenciamento da Organization hospeda a carga**: o risco de conta compartilhada com o Volti/Voltz foi resolvido em 2026-11-05 (migrados para a conta-membro própria 117153693161 na Organization o-4u23300she). O Prestare segue na 850401152034, que também é a conta de gerenciamento da Organization; mover a carga para uma conta-membro é melhoria futura, não risco alto. Restam na 850401152034 só sobras aposentadas do Volti/Voltz, paradas e com backup final, a excluir após a janela de verificação (ver `prioridades-e-governanca.md`).
2. **Cadastro sem verificação de e-mail**: raiz do achado P-01 do pentest ([pentest/2026-11-04-pentest-interno.md](pentest/2026-11-04-pentest-interno.md)); o código foi corrigido, mas qualquer lógica que trate `Users.email` como prova de identidade segue frágil até existir verificação.
3. **Bucket antigo `storage-click-dev`** (conta 952520388262) continua público e com chave em quarentena, intocado; desativar após confirmar que nada o referencia. Instância `database-1-antigo` parada, a excluir.
4. **Senha SMTP**: agora no SSM; confirmar se a senha anterior já foi trocada no provedor.
5. **Sem cópia entre regiões** de banco e arquivos.
6. **JWT do app dura 365 dias** (`auth/auth.module.ts`); mitigado pela invalidação na troca de senha, mas não existe revogação individual de sessão.
7. **MFA só para síndico no console web**; porteiro e admin do CRM dependem de senha + throttle.
8. **Desafios de MFA pendentes ficam em memória** (`mfaPendentes` em `auth.service.ts`): com várias instâncias, o desafio vale na instância que o criou. A stickiness do ALB reduz o problema, mas uma troca de instância obriga a refazer o login.

Revisão: a cada trimestre pelo fundador e, obrigatoriamente, antes de entrar o primeiro cliente com dados reais.
