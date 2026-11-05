# Migração do Volti e do Voltz para a conta AWS própria (117153693161)

> Copie este arquivo para os repositórios `Aluguel-moto` (Volti) e `voltz-app` (Voltz).
> Data da migração: madrugada de **05/11/2026** (UTC). Sem segredos neste arquivo.

## Por que mudou

A conta AWS **850401152034** era compartilhada entre a Prestare e os produtos Volti e Voltz. Para atender o AWS Well-Architected ("separar workloads em contas"), Volti e Voltz foram para uma conta própria na mesma organização:

| | |
|---|---|
| Conta nova | **117153693161** (nome "Volti") |
| Organização | `o-4u23300she` (conta de gerenciamento: 850401152034, Prestare) |
| Região | `sa-east-1` |
| Acesso | Portal IAM Identity Center: https://d-946752aa07.awsapps.com/start → conta **Volti** → `Administrador` (usuário `vinicius`, com MFA) |
| Root da conta nova | e-mail `viniciusvilelarufini+volti@gmail.com` (só emergência) |
| Alertas | Tópico SNS `volti-alertas` (e-mail do dono) — SES bounce/complaint e budget |

**Atenção para quem opera:** o root da conta Prestare **não** entra na conta nova (root não assume role). Use sempre o portal do Identity Center. Credenciais para CLI: portal → Volti → *Chaves de acesso* (temporárias, ~4 h).

---

## Volti (repositório `Aluguel-moto`)

### Infraestrutura na conta nova
- CDK com o mesmo qualifier: `cdk bootstrap ... --qualifier volti --toolkit-stack-name volti-cdk-toolkit --tags Projeto=Volti`.
- Stacks: `volti-dev-admin-web`, `volti-dev-auth`, `volti-dev-single`.
- Instância: `i-01f8eb46e89da38ec` (t4g.small). Agenda 07:00–23:00 (São Paulo) **ativa** na conta nova.
- **Contexto usado no deploy** (repita estes `-c` em todo `cdk deploy`):

```bash
pnpm exec cdk deploy --all --require-approval never --toolkit-stack-name volti-cdk-toolkit \
  -c env=dev -c profile=single -c account=117153693161 -c branch=main \
  -c budgetEmail=viniciusvilelarufini@gmail.com \
  -c hostedZoneId=Z03695231GTYDRI5SV3Z6 -c apiDomain=api-volti-dev.prestarecondominios.com.br \
  -c sesFromEmail=nao-responda@voltz.prestarecondominios.com.br -c customerSignup=open \
  -c googleIdpSecretName=volti/dev/idp-google -c appleIdpSecretName=volti/dev/idp-apple \
  -c customerDomainPrefix=volti-dev-clientes-v2 -c staffDomainPrefix=volti-dev-equipe-v2 \
  -c gt06Port=true -c openGt06=true
```

- O padrão no código (`infra/lib/stacks/single-dev-stack.ts`: `DEFAULT_HOSTED_ZONE_ID = Z04583703P20295WCJ8TF`, `DEFAULT_BRANCH = feat/galpao`) **ficou desatualizado** — passe sempre `-c hostedZoneId` e `-c branch`, ou atualize o padrão (e os testes `infra/test/single-profile.test.ts`).

### DNS
- `api-volti-dev.prestarecondominios.com.br` agora é uma **subzona na conta nova** (`Z03695231GTYDRI5SV3Z6`), delegada pela zona da Prestare (registro NS).
- O nome não mudou: o rastreador J16 (configurado por SMS para `api-volti-dev…:5023`) **não precisa** ser reconfigurado.

### Cognito (mudou — pools novos)

| | Clientes | Equipe (staff) |
|---|---|---|
| User pool | `sa-east-1_WB2SHyTtB` | `sa-east-1_JtUwhL5gs` |
| App client | `2q6n1rg3pek6nf7lm9h6qssdjm` | `4t9n1efb3ia2gsbfdarp2ofkuh` |
| Domínio Hosted UI | `volti-dev-clientes-v2.auth.sa-east-1.amazoncognito.com` | `volti-dev-equipe-v2.auth.sa-east-1.amazoncognito.com` |

- Client do operador: `2nkr9gfld2mebh517coh1cmk3a`. Painel admin (CloudFront): `d1rr3qsncubg2y.cloudfront.net`.
- Pools antigos (conta 850401152034): clientes `sa-east-1_fXgZKJxHC`, equipe `sa-east-1_N6canrhbI` — **não usar mais**.
- Usuários migrados: 9 clientes (o `cognitoSub` no banco foi religado ao `sub` novo; cadastros duplicados e-mail/Google ficaram com o primeiro), 2 da equipe (`StaffUser.cognitoSub = NULL` → religa pelo e-mail no primeiro login; **cada um refaz senha e TOTP**).
- **E-mail do Cognito temporariamente pelo remetente padrão** (`COGNITO_DEFAULT`, 50 e-mails/dia, remetente `no-reply@verificationemail.com`) porque o SES da conta nova está em sandbox. Isso foi feito por `update-user-pool` fora do CDK (drift). Quando o SES for liberado, voltar para `DEVELOPER` com a identidade `voltz.prestarecondominios.com.br` (ou rodar o CDK de novo forçando atualização do pool).

### Variáveis do GitHub (já atualizadas em 05/11)
`CLIENTE_COGNITO_USER_POOL_ID`, `CLIENTE_COGNITO_CLIENT_ID`, `CLIENTE_COGNITO_DOMAIN` → valores da tabela acima. `CLIENTE_API_BASE_URL` não mudou.
Build do TestFlight disparado com os valores novos (run `42057248914`). **Builds antigos do app não fazem mais login.**

### Dados e segredos
- Banco `volti` migrado por `pg_dump`/`pg_restore` (contagens conferidas). Banco do Traccar recriado do zero; `moto-0059` reprovisionado (`gt06.sh provision`).
- Arquivos dos 5 buckets copiados para `volti-dev-117153693161-single-*`.
- Preservados (copiados da conta antiga): `FRAUD_HASH_SECRET`, `PICKUP_CODE_SECRET`, `STATION_QR_SECRET`, a deploy key do GitHub (a mesma) e os segredos `volti/dev/idp-google` / `volti/dev/idp-apple`. Os demais segredos foram gerados de novo no primeiro boot.
- Configurações copiadas que não vêm do CDK: `/volti/dev/config/GT06=on`, `GT06_BIND=0.0.0.0`, `IOT_SIM=off`.

### Pendências do Volti
- [ ] **Google Cloud Console** (client OAuth Web do Volti) → *Authorized redirect URIs*: adicionar `https://volti-dev-clientes-v2.auth.sa-east-1.amazoncognito.com/oauth2/idpresponse`.
- [ ] **Apple Developer** (Services ID do Volti) → *Sign in with Apple*: domínio `volti-dev-clientes-v2.auth.sa-east-1.amazoncognito.com` e a mesma URL de retorno.
- [ ] Builds novos do **operador** e do **Android** com `--dart-define=COGNITO_*` novos.
- [ ] Atualizar docs do repo: `infra/README.md` (linhas ~61 e ~290), `deploy/single/cloudshell.md` (~20–22: conta, `HOSTED_ZONE_ID`, branch), `docs/decisoes.md` (~638).
- [ ] Voltar o e-mail do Cognito para o SES quando a AWS aprovar (caso de suporte `179384080500972`).

---

## Voltz (repositório `voltz-app`)

### Infraestrutura na conta nova
- Stack `voltz-platform` criada com o template do branch **`infra/conta-propria`** (commit `4aa473d`): parâmetros opcionais `DomainName` e `CertificateArn` no CloudFront. **Falta fazer o merge desse PR na `main`.**
- `SolutionStackName`: a versão antiga (`v6.11.10 ... Node.js 24`) não existe mais para ambientes novos; foi usada a versão atual de Node.js 24 no Amazon Linux 2023.
- Domínio fixo: **https://voltz.prestarecondominios.com.br** (subzona `Z0374535I42NIUNJ0XSO` na conta nova, certificado ACM em `us-east-1`).
- Saídas da stack:

| Saída | Valor |
|---|---|
| GitHubDeployRoleArn | `arn:aws:iam::117153693161:role/voltz-platform-GitHubDeployRole-iKZ61Os44wZ0` |
| DeployBucketName | `voltz-platform-deploybucket-xmtjiny8a7jc` |
| PanelBucketName | `voltz-platform-panelbucket-jg9euven7qak` |
| MediaBucketName | `voltz-platform-mediabucket-ymjapbp0uch0` |
| CloudFrontDistributionId | `E3969PZ9CI7AJA` |
| CloudFrontDomainName | `d2zki94ryplo5a.cloudfront.net` |
| ApiEndpoint | `voltz-api-117153693161.sa-east-1.elasticbeanstalk.com` |

- Banco: RDS `voltz-postgres` na conta nova (privado, criptografado com `alias/voltz-rds`, backup 7 dias), endpoint `voltz-postgres.c3g8gi8oaabn.sa-east-1.rds.amazonaws.com`. Dados = cópia de 05/11 ~01:55 UTC (não houve escrita depois disso no antigo).
- Parâmetros `/voltz/prod/*` copiados; alterados: `DATABASE_URL` (endpoint novo), `ORIGIN_VERIFY_SECRET` (novo, igual ao parâmetro da stack), `URL_PUBLICA_API` (domínio novo), `CORS_ORIGINS` (inclui o domínio novo).
- Versão da API em produção, painel e mídia copiados.

### Ponte para os apps já instalados
A distribuição antiga **`E7141MRA5JPV3`** (`d3vedyuotgbbos.cloudfront.net`, ainda na conta 850401152034) virou **ponte**: todas as origens apontam para `voltz.prestarecondominios.com.br`. Os builds instalados continuam funcionando. Ela deve ser desligada só depois que todos atualizarem o app.

### Pendências do Voltz
- [ ] Merge do PR `infra/conta-propria`.
- [ ] Variáveis do GitHub (`deploy-api.yml` / `deploy-painel.yml`): `AWS_DEPLOY_ROLE_ARN`, `EB_DEPLOY_BUCKET`, `PANEL_BUCKET`, `MEDIA_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `CLOUDFRONT_DOMAIN_NAME` → valores da tabela acima. **Enquanto não mudar, um deploy do GitHub vai para a conta antiga.**
- [ ] Trocar a URL fixa `https://d3vedyuotgbbos.cloudfront.net` por `https://voltz.prestarecondominios.com.br` em: `.github/workflows/ios-testflight.yml` (~33), `app/lib/dados/providers.dart` (~32), `app/lib/core/links.dart` (~3) e nos docs de publicação. Gerar builds novos.
- [ ] Webhook do Asaas → `https://voltz.prestarecondominios.com.br/api/pagamentos/webhook`.
- [ ] Tela de consentimento do Google e URL de privacidade nas lojas com o domínio novo.
- [ ] E-mail de confirmação depende do SES da conta nova (em sandbox até a aprovação).

---

## Compartilhado

- **SES:** identidade de domínio `voltz.prestarecondominios.com.br` verificada na conta nova (DKIM + MAIL FROM `mail.voltz.prestarecondominios.com.br`), supressão de bounce/complaint ligada e alarmes de reputação. **Produção ainda não aprovada** (caso `179384080500972`). A identidade antiga, na conta Prestare, continua verificada até a limpeza.
- **SNS (SMS):** a conta nova nasce em sandbox (limite de gasto US$ 1/mês).

## Sobras na conta antiga (850401152034) — apagar após a verificação

Ficam paradas, com backup final, até o dono confirmar que tudo funciona na conta nova:

- **Volti:** instância `i-0fe5328a27dc50798` (parada; agendas desligadas), stacks `volti-dev-*` e `volti-cdk-toolkit`, pools Cognito antigos, 6 buckets `volti-dev-850401152034-*`, KMS `alias/volti-dev`, parâmetros `/volti/dev/*`, segredos `volti/dev/idp-*`.
- **Voltz:** ambiente EB `voltz-api-prod` (Auto Scaling em 0), RDS `voltz-postgres` **parado** com snapshot final `voltz-postgres-final-20261105` — **a AWS religa automaticamente um RDS parado após 7 dias (~12/11/2026)**; stack `voltz-platform` antiga (o provedor OIDC do GitHub dela está com `Retain` porque a Prestare usa), buckets `voltz-platform-*`, distribuição-ponte `E7141MRA5JPV3` (manter até os apps atualizarem).
- **DNS:** a zona `prestarecondominios.com.br` (Prestare) mantém só os NS das duas subzonas.

## Rollback (se precisar)
- **Volti:** apagar o NS `api-volti-dev` na zona da Prestare, ligar a instância antiga (o serviço `volti-dns` recria o registro A) e subir os containers. Os builds antigos do app voltam a logar no pool antigo. O que foi gravado na conta nova se perde, a não ser que se faça o dump reverso.
- **Voltz:** devolver as origens da distribuição `E7141MRA5JPV3` (backup da configuração salvo como `voltz-cf-antiga-backup.json` no CloudShell da Prestare), voltar o Auto Scaling do EB antigo para 1 e ligar o RDS antigo.

Plano completo e histórico: `Click-with-Prestare/docs/superpowers/plans/2026-11-05-migracao-volti-conta-propria.md`.
