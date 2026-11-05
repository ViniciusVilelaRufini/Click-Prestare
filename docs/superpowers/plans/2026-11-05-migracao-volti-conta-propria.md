# Migração do Volti e do Voltz para a conta 117153693161

> Plano de execução. Nada aqui foi executado: até agora só houve leitura de código e do inventário.
> Requisito Well-Architected: separar as cargas em contas. Hoje a conta 850401152034 (Prestare) também hospeda dois produtos do mesmo dono.
> Conta de destino: **117153693161** ("Volti"), Organization `o-4u23300she`, região `sa-east-1`. O dono tem admin no IAM Identity Center e a `OrganizationAccountAccessRole` existe na conta.

**Fontes lidas** (todas as citações abaixo apontam para elas):
- Inventário: `C:\Users\vinic\Desktop\Click-with-Prestare\.playwright-mcp\volti-inv.txt`
- Volti (aluguel de motos): repositório `C:\Users\vinic\Desktop\Aluguel-moto` (remoto `ViniciusVilelaRufini/Aluguel-moto`), worktrees em `C:\Users\vinic\Desktop\volti-wt\*`. A linha principal é **`origin/main`** (último commit `b661416c`, 04/11). O `main` local está parado em 22/10, então leia sempre `origin/main`. Arquivos: `infra/README.md`, `infra/lib/config.ts`, `infra/lib/stacks/single-dev-stack.ts`, `infra/lib/volti-app.ts`, `deploy/single/cloudshell.md`, `deploy/single/compose.yml`, `.github/workflows/infra.yml`, `.github/workflows/ios-testflight.yml`, `services/api/prisma/schema.prisma`, `services/api/src/modules/auth/principal-resolver.service.ts`, `docs/decisoes.md`.
- Voltz (marketplace e entregas): `C:\Users\vinic\Desktop\voltz-loja-web` (remoto `ViniciusVilelaRufini/voltz-app`, linha principal `origin/main`, último commit em 26/10). Arquivos: `infra/aws/platform.yaml`, `infra/aws/README.md`, `infra/aws/parameters.example.json`, `.github/workflows/deploy-api.yml`, `deploy-painel.yml`, `ios-testflight.yml`, `docs/publicacao/*.md`, `docs/superpowers/specs/2026-10-13-hospedagem-aws-voltz-design.md`.

---

## 1. O que existe hoje e o que está no ar

### 1.1 São dois produtos, e nenhum deles substitui o outro

A pergunta inicial era se o `voltz-platform` (14/10) tinha sido substituído pelo `volti-dev` (25/10). **Não foi.** São produtos diferentes, em repositórios diferentes:

| | **Volti** (aluguel de motos elétricas) | **Voltz** (marketplace, lojista e entregador) |
|---|---|---|
| Repositório | `Aluguel-moto` | `voltz-app` (cópia local `voltz-loja-web`) |
| Infra | CDK, qualifier `volti` (`infra/`) | CloudFormation `infra/aws/platform.yaml`, stack `voltz-platform` |
| Stacks na 850401152034 | `volti-cdk-toolkit`, `volti-dev-admin-web`, `volti-dev-auth`, `volti-dev-single` | `voltz-platform` (mais a interna do EB `awseb-e-y43c2efpy8-stack`) |
| Banco | Postgres 16 + PostGIS **num container da EC2** (volume `pgdata`, `deploy/single/compose.yml:18`) | RDS `voltz-postgres` (fora do template; `infra/aws/README.md` §1) |
| Situação | **Vivo e em desenvolvimento intenso**: ~40 worktrees, 3 branches ainda sem merge (`fix/gps-aws`, `fix/gps-realtime`, `fix/alarme-furto`, todas de 04/11). Um rastreador J16 real está ligado a `api-volti-dev.prestarecondominios.com.br:5023` (`docs/gt06-j16-instalacao.md:68,106,130`) | **Vivo, mas parado desde 26/10**. O EB `voltz-api-prod` está Green, com último deploy em 26/10 04:32 (inventário), e o log do nginx tem 262 KB. Os builds do TestFlight e do Android apontam para `https://d3vedyuotgbbos.cloudfront.net/api` |

O inventário cita "Volti/Voltz" como se fosse um produto só. Este plano move **os dois** para fora da conta do Prestare. A conta 117153693161 se chama "Volti". Pôr o Voltz nela também é uma decisão do dono (ver **D1** na §4). A alternativa mais pura é uma terceira conta "Voltz" na mesma Organization. Os passos são os mesmos e só muda o ID da conta.

### 1.2 Volti: recursos na 850401152034 (perfil `single`)

O README chama este perfil de "o dev atual" (`infra/README.md:9`). A decisão está em `docs/decisoes.md` (25/10, lacunas T20). Não existe prod.

- **`volti-cdk-toolkit`**: bootstrap com `--qualifier volti` (`deploy/single/cloudshell.md` §3). Junto vêm o bucket `cdk-volti-assets-850401152034-sa-east-1`, o ECR `cdk-volti-container-assets-…` e 5 roles `cdk-volti-*`.
- **`volti-dev-admin-web`**: bucket `volti-dev-850401152034-admin-web` e CloudFront `E3FQTKVZNPG3W2` (`d41r9n2snfmlc.cloudfront.net`, sem domínio próprio).
- **`volti-dev-auth`**: dois pools de usuários.
  - `volti-dev-customers`: login sem senha, OTP por e-mail via SES e SMS via SNS, e IdPs Google e Apple.
  - `volti-dev-staff`: MFA TOTP obrigatório e 5 grupos.
  - Domínios do Hosted UI: `volti-dev-clientes` e `volti-dev-equipe` (`infra/lib/config.ts:138-139`).
  - Segredos `volti/dev/idp-google` e `volti/dev/idp-apple` no Secrets Manager.
  - Role de SMS `CustomerPoolsmsRole`, o que mostra que o deploy usou `-c customerSignup=open`.
  - E-mail pelo SES com a identidade de domínio `voltz.prestarecondominios.com.br` (`cloudshell.md:22`, `infra/lib/volti-app.ts:177`).
- **`volti-dev-single`**:
  - VPC própria 10.40.0.0/24.
  - EC2 `i-0fe5328a27dc50798` (`t4g.small`, ARM, 25 GB gp3 criptografado).
  - KMS `alias/volti-dev`, que **só a role da instância consegue decifrar**.
  - 5 buckets `volti-dev-850401152034-single-{anexos,catalogo,documentos-kyc,fotos-devolucao,relatorios}`.
  - SSM `/volti/dev/config/*` e `/volti/dev/secrets/*`.
  - Documentos SSM `volti-dev-update`, `volti-dev-seed` e `volti-dev-admin`.
  - Agenda: liga às 07:00 e desliga às 23:00.
  - DLM: snapshot diário, 3 retidos.
  - Budget de US$ 20 filtrado pela tag `Projeto=Volti`.
- **Fora do CloudFormation**:
  - **Registro A `api-volti-dev.prestarecondominios.com.br`** na zona do Prestare `Z04583703P20295WCJ8TF`. A própria instância faz UPSERT dele a cada boot (`deploy/single/dns.sh`; o IAM fica em `single-dev-stack.ts:392-403`).
  - O parâmetro `/volti/dev/github-deploy-key`.
  - Os segredos dos IdPs.
  - Ainda **sem** OIDC nem role de CI. O `infra.yml` só faz deploy quando existe `vars.AWS_DEPLOY_ROLE_ARN_DEV`, e o README manda não configurar essa variável enquanto o perfil for `single` (`infra/README.md:358`).

**O que fica guardado na EC2** (volumes do Docker em `deploy/single/compose.yml`):

| Volume | Conteúdo | Precisa migrar? |
|---|---|---|
| `pgdata` | bancos `volti` (todo o negócio) e `traccar` (dispositivos e posições do GT06) | **Sim** |
| `redisdata` | cache, locks e realtime (AOF) | Não: o estado é efêmero. O `redis-cli FLUSHALL` do novo começa vazio |
| `caddydata` / `caddyconfig` | certificado do Let's Encrypt | Não: o Caddy reemite quando o DNS apontar |
| `/opt/volti/.env` | montado a partir do SSM pelo `render-env.sh` | Não: é regerado |

### 1.3 Voltz: recursos na 850401152034

- **Stack `voltz-platform`** (`infra/aws/platform.yaml`):
  - EB `voltz-api` / `voltz-api-prod`: `t3.micro`, Node 24, CNAME `voltz-api-850401152034.sa-east-1.elasticbeanstalk.com`.
  - CloudFront `E7141MRA5JPV3` (`d3vedyuotgbbos.cloudfront.net`, sem alias), com três origens: painel, `/media/*` e `/api/*`, esta com o cabeçalho `x-origin-verify`.
  - Buckets `voltz-platform-panelbucket-ifzr9kf8ld5i`, `…-deploybucket-xsfgjeucsfzp` e `…-mediabucket-brxehmp7vh0l`. Este último é o que está em uso, porque é a origem do CloudFront. As outras duas `mediabucket-*` são órfãs de substituições, porque o bucket tem `Retain` (`platform.yaml:55`).
  - SNS e 5 alarmes, budget de US$ 1 (`platform.yaml:626`).
  - Roles do EB e `GitHubDeployRole`.
  - **`GitHubOidcProvider`** (`platform.yaml:373`, **sem `DeletionPolicy`**).
- **Fora da stack**:
  - RDS `voltz-postgres` (`db.t4g.micro`, 20 GB, **PubliclyAccessible=True** pelo inventário). O SG `sg-04a0746bd694d90e9` fica na VPC `vpc-09ee59bf10910dc2b` (`parameters.example.json`).
  - Os parâmetros SSM `/voltz/prod/*` (`infra/aws/README.md` §Parâmetros, `docs/publicacao/autenticacao-producao.md:5`).
  - A identidade SES do remetente.
  - O bucket `cf-templates-13cbooboiuson-sa-east-1`, criado no mesmo dia pelo console do CloudFormation. Ele é provavelmente do Voltz; confirme o conteúdo.
- **Deriva**: a stack foi atualizada pela última vez em 14/10, mas o template no `main` mudou em 20/10 (permissão do SES) e em 26/10 (CSP). O que está em produção é **mais antigo** que o repositório. Na conta nova, o deploy sobe a versão atual, então teste o envio de e-mail e os cabeçalhos.
- **Atenção**: o inventário **não lista nenhum `/voltz/prod/*`** no SSM. Antes de tudo, confirme onde estão os segredos do Voltz com `get-parameters-by-path --path /voltz/prod` ou nas variáveis de ambiente do EB.

### 1.4 Dependências cruzadas com o Prestare (o que não pode quebrar)

1. **Provedor OIDC do GitHub.** Uma conta tem um só provedor para `token.actions.githubusercontent.com` (`voltz-loja-web/infra/aws/README.md` passo 6). Ele foi criado pela `voltz-platform`. A role `github-deploy-prestare`, criada em 04/11 nos dois caminhos de deploy do Prestare (`.github/workflows/ci.yml:108`, `deploy-api.yml:62`), quase certamente usa esse mesmo provedor. **Apagar a `voltz-platform` como está apaga o provedor e derruba o deploy do Prestare.**
2. **Zona Route 53 `prestarecondominios.com.br`** (`Z04583703P20295WCJ8TF`). Nela estão o A `api-volti-dev` e os registros do SES de `voltz.prestarecondominios.com.br`.
3. **Cotas e configuração da conta inteira**: limite de gasto de SMS do SNS (US$ 1), sandbox do SES, budgets. Os docs do Prestare já registram a conta como compartilhada:
   - `docs/operacao/cotas-e-limites.md:21`
   - `modelo-de-ameacas.md:112`
   - `objetivos-de-controle.md:111`
   - `plano-recuperacao-desastre.md:44`
   - `prioridades-e-governanca.md:41`
   - `seguranca-de-aplicacao.md:90`
   - `plano-resposta-incidentes.md:103`

---

## 2. Como cada peça fica na conta 117153693161

Credenciais: crie dois perfis SSO, `prestare` (850401152034) e `volti` (117153693161), ambos com o permission set de administrador. Todos os comandos abaixo levam `--profile` e `--region sa-east-1`.

### 2.1 DNS e certificados

Mantenha os nomes e delegue subzonas para a conta nova. Assim a conta Volti não precisa de permissão nenhuma na zona do Prestare.

- **Zona `api-volti-dev.prestarecondominios.com.br`** na 117153693161 (o registro A fica no ápice da subzona).
  - Mantém o nome que o J16 recebeu por SMS (`SERVER,1,api-volti-dev…,5023,0#`). Não é preciso reconfigurar o rastreador na moto.
  - Mantém o `API_BASE_URL` dos apps.
  - O deploy passa a usar `-c hostedZoneId=<id da subzona nova>`, com o mesmo `-c apiDomain`. A condição de IAM `ChangeResourceRecordSetsNormalizedRecordNames` continua igual (`single-dev-stack.ts:396`).
- **Zona `voltz.prestarecondominios.com.br`** na 117153693161.
  - Guarda a identidade SES usada pelo Volti e pelo Voltz.
  - Pode receber um domínio próprio para o Voltz (ver D3).
  - Antes de delegar, copie para a subzona todos os registros `*.voltz.prestarecondominios.com.br` que hoje estão na zona-mãe: os CNAMEs `_domainkey` do SES antigo e o MX/TXT do MAIL FROM, se houver.
- **Na zona-mãe** (conta Prestare): crie os registros NS das duas subzonas e **apague o A `api-volti-dev`** junto com os registros copiados. O NS não pode conviver com outros dados no mesmo nome.
- Custo: US$ 0,50 por zona por mês.
- Certificados:
  - O Volti não usa ACM: o Caddy emite pelo Let's Encrypt.
  - O Voltz hoje usa o certificado padrão do CloudFront. Se ganhar domínio (D3), crie o ACM em **us-east-1** na conta nova, validado por DNS na subzona.

### 2.2 Volti

**Bootstrap e ordem dos stacks.** Faça tudo pelo CloudShell da conta nova, seguindo `deploy/single/cloudshell.md` §0 a §7.

1. `cdk bootstrap aws://117153693161/sa-east-1 --qualifier volti --toolkit-stack-name volti-cdk-toolkit --tags Projeto=Volti`. O qualifier `volti` já está fixado no synthesizer do app, por isso não use o padrão `hnb659fds`.
2. `cdk deploy --all`. O próprio CDK resolve a ordem: `volti-dev-admin-web`, depois `volti-dev-auth` (que precisa da origem do painel para os callbacks), depois `volti-dev-single`. Contexto:
   - `-c env=dev -c profile=single -c account=117153693161`
   - `-c branch=main`, ou a branch que a instância antiga está seguindo. Confira em `/etc/volti/instance.env`, porque o padrão do código ainda é `feat/galpao` (`single-dev-stack.ts:31`).
   - `-c budgetEmail=…`
   - `-c hostedZoneId=<subzona> -c apiDomain=api-volti-dev.prestarecondominios.com.br`
   - `-c sesFromEmail=nao-responda@voltz.prestarecondominios.com.br -c customerSignup=open`
   - `-c googleIdpSecretName=volti/dev/idp-google -c appleIdpSecretName=volti/dev/idp-apple`
   - **`-c customerDomainPrefix=… -c staffDomainPrefix=…` novos** (ver o item Cognito abaixo).
   - Os mesmos `-c gt06Port/gt06Cidrs/openGt06/schedule` usados na conta antiga. Eles **não estão gravados no repositório**: reconstrua a partir de `aws cloudformation get-template --stack-name volti-dev-single` e das regras do SG na conta antiga (procure a ingress 5023 e o `CfnSchedule`).
3. Os segredos dos IdPs (`volti/dev/idp-google`, `volti/dev/idp-apple`) precisam **existir antes** do passo 2 (`infra/README.md:69`).

**Dados**

| Origem | Estratégia |
|---|---|
| Postgres `volti` e `traccar` (container) | Na janela de corte: `pg_dump -Fc` dos dois bancos na instância antiga (comando em `infra/README.md:326`), cópia para um bucket temporário na conta nova e `pg_restore --no-owner` na instância nova. O caminho é o mesmo da §"Migrar para ECS/RDS depois" do README, só que entre contas |
| Traccar | Prefira **não** restaurar o banco `traccar`. O dump traz o usuário admin e os papéis com senhas antigas, que não batem com os segredos regerados. Rode `gt06.sh init` e reprovisione os IMEIs a partir do banco `volti` com `gt06.sh provision` (`cloudshell.md` §Rastreador GT06). Perde-se o histórico de posições do Traccar, que tem retenção de 90 dias e está espelhado no `volti` pela ponte |
| 5 buckets single + admin-web | `aws s3 sync` com uma role de cópia: bucket policy no destino liberando a role de origem, ou origem → destino a partir da conta nova com policy de leitura na origem. O bucket `documentos-kyc` usa KMS próprio, então a role de cópia precisa de `kms:Decrypt` na origem e `kms:GenerateDataKey` na chave de destino. O admin-web **não** é copiado, porque o painel é reconstruído pelo `volti-dev-admin action=publish-panel` |
| SSM `/volti/dev/config/*` | Não copie. A stack nova gera os parâmetros com os valores novos |
| SSM `/volti/dev/secrets/*` | A instância gera tudo no primeiro boot com `--no-overwrite`. **Pré-semeie** só `FRAUD_HASH_SECRET`, `PICKUP_CODE_SECRET` e `STATION_QR_SECRET` (se existir), porque trocar esses valores invalida hashes, códigos de retirada e QRs (`infra/README.md` passo 5). Como só a role da instância decifra, o dono adiciona um statement temporário de `kms:Decrypt` para a própria role SSO na key policy de `alias/volti-dev` antigo, lê os valores, grava na conta nova com `--key-id alias/volti-dev` **antes** de gravar a deploy key (o boot só segue depois dela) e remove o statement. Os demais (`DB_PASSWORD`, `MQTT_*`, `TRACCAR_*`, `BRIDGE_DB_PASSWORD`) nascem novos |
| `/volti/dev/github-deploy-key` | Chave nova (`cloudshell.md` §2 e §5). O dono cadastra a pública no GitHub como somente leitura e, no fim, apaga a deploy key antiga |
| Secrets Manager `volti/dev/idp-*` | Copie o valor de `get-secret-value` (perfil `prestare`) direto para `create-secret` (perfil `volti`) por pipe, sem gravar em disco |

**Cognito: senhas e segredos TOTP não são exportáveis.**

- **Pool novo = `sub` novo.** A API liga as pessoas pelo `sub` (`schema.prisma:453` `Customer.cognitoSub @unique`, `:512` `StaffUser.cognitoSub`). Sem tratamento:
  - cada cliente vira um cadastro **novo e vazio** no primeiro login (`principal-resolver.service.ts` `upsertCustomer`);
  - cada funcionário recebe 403 `staff-account-relink-required` (`principal-resolver.service.ts:107-110`).
- **Funcionários** (pool staff, MFA TOTP):
  - recrie cada um com `admin-create-user` no pool novo;
  - no banco restaurado, rode `UPDATE "StaffUser" SET "cognitoSub" = NULL`;
  - no primeiro login, o resolver liga o cadastro pelo e-mail (`linkInvite`, linhas 112-113);
  - cada um define senha e registra o TOTP de novo.
- **Clientes**:
  - liste o pool antigo (`list-users`: `sub`, e-mail, telefone) e crie no novo com `admin-create-user --message-action SUPPRESS`, com `email_verified=true` e `phone_number_verified=true`, como faz o `volti-dev-admin create-customer`;
  - **antes de abrir o acesso**, faça um `UPDATE "Customer" SET "cognitoSub"=<novo> WHERE "cognitoSub"=<antigo>` com o mapa gerado;
  - como o login é por OTP, o cliente não percebe a troca de senha.
- **Clientes que entraram por Google ou Apple**:
  - o usuário federado só nasce no primeiro login. Use `admin-link-provider-for-user` para ligar a identidade social ao usuário nativo pré-criado, ou aceite um religamento manual pelo e-mail;
  - como é dev com dados de teste, apagar e recadastrar é aceitável se o dono preferir (D2).
- **Domínios do Hosted UI**:
  - os prefixos são únicos por região, então `volti-dev-clientes` e `volti-dev-equipe` **colidem** enquanto o pool antigo existir;
  - use prefixos novos (sugestão: `volti-dev-clientes-v2`, `volti-dev-equipe-v2`) para permitir a convivência e o rollback.
- **O dono precisa atualizar os provedores sociais**:
  - **Google Cloud Console** → *APIs & Services → Credentials* → client OAuth Web do Volti → *Authorized redirect URIs*: adicionar `https://volti-dev-clientes-v2.auth.sa-east-1.amazoncognito.com/oauth2/idpresponse`. Se *Authorized JavaScript origins* estiver preenchido, adicionar o domínio também.
  - **Apple Developer** → *Identifiers → Services IDs* → o Services ID do Volti → *Sign in with Apple → Configure*: adicionar em *Domains* `volti-dev-clientes-v2.auth.sa-east-1.amazoncognito.com` e em *Return URLs* a mesma URL `…/oauth2/idpresponse`.
  - As URLs antigas podem sair depois do descomissionamento. O formato está em `infra/README.md:85`.
- **SES e SNS na conta nova**:
  - verifique a identidade de domínio `voltz.prestarecondominios.com.br` em sa-east-1. O Easy DKIM gera 3 CNAMEs novos, que vão na subzona;
  - peça **saída do sandbox do SES**, ou o OTP por e-mail só chega a destinatários verificados;
  - o SNS nasce em sandbox: re-verifique os números de teste e rode `aws sns set-sms-attributes --attributes MonthlySpendLimit=1` (`cloudshell.md` §4).
- **Apps**: o pool, o client e o domínio são embutidos no build. Mude as variáveis do GitHub do `Aluguel-moto` usadas em `.github/workflows/ios-testflight.yml:75-80`:
  - `CLIENTE_COGNITO_USER_POOL_ID`
  - `CLIENTE_COGNITO_CLIENT_ID`
  - `CLIENTE_COGNITO_DOMAIN`
  - `CLIENTE_API_BASE_URL` continua igual.

  Gere um TestFlight novo e um build novo do operador e do cliente Android (`--dart-define=COGNITO_*`, `apps/cliente/README.md:358`, `apps/operador/README.md:20`). Os builds antigos param de fazer login quando o pool antigo sair.

**GitHub Actions do Volti** (`.github/workflows/infra.yml`):
- Nenhuma mudança de código agora.
- As variáveis `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN_DEV` e `CERTIFICATE_ARN_DEV` (linhas 88, 110, 116-147) **devem continuar não configuradas** enquanto o dev for `single`. Confirme no GitHub que não existem. Se existirem e apontarem para a 850401152034, apague.
- Quando o dev completo vier, crie na 117153693161 o provedor OIDC e a role com trust `repo:ViniciusVilelaRufini/Aluguel-moto:environment:dev` (`infra/README.md:364-368`) e preencha as variáveis com a conta nova.
- Testes a ajustar **só se** os padrões mudarem: `infra/lib/stacks/single-dev-stack.ts:33` (`DEFAULT_HOSTED_ZONE_ID`) e `infra/test/single-profile.test.ts:217,256`. Recomendação: **não mude o padrão no código**, passe `-c hostedZoneId` no deploy. Para tornar o padrão o da subzona, é um commit pequeno e os testes mudam junto.
- Docs a atualizar depois do corte:
  - `infra/README.md:61,290`
  - `deploy/single/cloudshell.md:20-22`
  - `docs/decisoes.md:638`

### 2.3 Voltz

**Infra.** Use o mesmo `infra/aws/platform.yaml`, com change set `CREATE` na conta nova (`infra/aws/README.md` §Deploy). Parâmetros novos:
- `VpcId` e `PublicSubnetId` da VPC padrão da 117153693161, ou de uma VPC criada para isso.
- `RdsSecurityGroupId` e `RdsInstanceIdentifier` do RDS restaurado (abaixo).
- `CloudFrontOriginPrefixListId` igual (`pl-5da64334` é regional).
- `GitHubSubject` igual (o mesmo repositório).
- `OriginVerifySecret` novo.
- `AlertEmail`.

A conta nova não tem provedor OIDC, então o `GitHubOidcProvider` do template é criado sem conflito. O nome do EB inclui a conta (`voltz-api-117153693161`), portanto não colide.

**RDS.**
1. Confira `StorageEncrypted` e `KmsKeyId` do `voltz-postgres`.
2. Se não estiver criptografado, compartilhe o snapshot manual direto com a 117153693161.
3. Se estiver criptografado com `aws/rds`, essa chave não pode ser compartilhada. Copie o snapshot com uma CMK nova na 850401152034 com grant para a 117153693161, compartilhe e, na conta nova, copie com uma CMK local.
4. `restore-db-instance-from-db-snapshot` com `--no-publicly-accessible` (fecha o item pendente de `docs/publicacao/checklist.md` §1), backup ≥ 7 dias e SG que só aceita o SG da API (a ingress é criada pelo template).
5. Alternativa equivalente: `pg_dump`/`pg_restore`, já que o RDS antigo é público.

**S3.** Faça `s3 sync` do `mediabucket-brxehmp7vh0l` para o MediaBucket novo; ele guarda os uploads. O painel vem do `deploy-painel.yml`. O deploy bucket não migra.

**Segredos.** Leia `/voltz/prod/*` da conta antiga (`get-parameters-by-path --with-decryption`, chave `aws/ssm`) e grave na nova por pipe. Valores que **mudam**:
- `DATABASE_URL` (endpoint novo)
- `ORIGIN_VERIFY_SECRET` (igual ao parâmetro novo da stack)
- `CORS_ORIGINS` e `URL_PUBLICA_API` (domínio novo)

Valores que ficam iguais: Twilio, Asaas, Firebase, Google Maps, os client IDs do Google e da Apple, o JWT (mantém as sessões), `ADMIN_*`.

**SES e SMS.** Use a mesma identidade de domínio da §2.2, que serve aos dois produtos. Peça produção no SES. Se `SMS_PROVEDOR=sns`, peça também a saída do sandbox do SNS.

**Domínio do Voltz (D3).** O domínio padrão `d3vedyuotgbbos.cloudfront.net` **pertence à distribuição antiga e não migra**. Dependem dele:
- os apps: `app/lib/dados/providers.dart:32` e `app/lib/core/links.dart:3`;
- o `ios-testflight.yml:33`;
- a URL de privacidade nas lojas (`docs/publicacao/checklist.md:47`);
- a tela de consentimento do Google (`autenticacao-producao.md:137`);
- o webhook do Asaas (`pagamentos.md:19`);
- o link de confirmação de e-mail (`URL_PUBLICA_API`).

Recomendação: aproveite a migração para dar um nome fixo, por exemplo `app.voltz.prestarecondominios.com.br` ou um domínio próprio do Voltz. Isso exige mudar o template: `Aliases` e `ViewerCertificate` com ACM em us-east-1 na distribuição, mais um parâmetro. Assim esta é a última vez que os apps mudam de URL. Ponte para os builds já instalados: troque as origens da distribuição antiga `E7141MRA5JPV3` para o domínio da distribuição nova (HTTPS only, sem repassar o `Host`) e mantenha-a até os testadores atualizarem.

**GitHub do `voltz-app`.** Em *Settings → Variables*, atualize as variáveis usadas por `deploy-api.yml` e `deploy-painel.yml`:
- `AWS_DEPLOY_ROLE_ARN` (saída `GitHubDeployRoleArn` da stack nova)
- `EB_DEPLOY_BUCKET`
- `PANEL_BUCKET`
- `MEDIA_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`
- `CLOUDFRONT_DOMAIN_NAME`

`EB_APPLICATION_NAME` e `EB_ENVIRONMENT_NAME` continuam `voltz-api` / `voltz-api-prod`. Arquivos com a URL fixa no código:
- `.github/workflows/ios-testflight.yml:33`
- `app/lib/dados/providers.dart:32`
- `app/lib/core/links.dart:3`
- `backend/src/mensageria/confirmacao-email.service.ts:34` (comentário)
- `docs/publicacao/android.md:25`, `ios.md:71`, `testflight.md:29`, `autenticacao-producao.md:26,116,137,149`, `checklist.md:47`

Os dois workflows são só `workflow_dispatch` na `main`, então nada publica sozinho.

---

## 3. Runbook ordenado

Convenções:
- **[A]** = o agente faz, com credenciais SSO do dono e aprovação em cada passo.
- **[D]** = só o dono.
- **✔** = verificação obrigatória antes de seguir.

### Fase 0: preparação (sem impacto, pode ser feita dias antes)

1. **[A]** Leituras na 850401152034:
   - `aws organizations describe-organization`: anote se a 850401152034 é a conta de gerenciamento.
   - `aws iam list-open-id-connect-providers` e `aws iam get-role --role-name github-deploy-prestare` (o `Principal.Federated`). ✔ Confirme se o Prestare usa o provedor da `voltz-platform`.
   - `aws ssm get-parameters-by-path --path /voltz/prod --query 'Parameters[].Name'`.
   - `aws rds describe-db-instances --db-instance-identifier voltz-postgres --query '…StorageEncrypted,KmsKeyId,AllocatedStorage'`.
   - `aws route53 list-resource-record-sets --hosted-zone-id Z04583703P20295WCJ8TF`: liste tudo que contém `voltz.` ou `api-volti-dev`.
   - `aws ses get-account --region sa-east-1`: está fora do sandbox?
   - `aws cloudformation get-template` das três stacks `volti-dev-*` e regras do SG da EC2: reconstrua os `-c`.
   - `aws s3 ls s3://cf-templates-13cbooboiuson-sa-east-1 --recursive`.
   - Na instância (Session Manager): `cat /etc/volti/instance.env` (branch) e `docker compose … exec postgres psql -c '\l'` (bancos e tamanhos).
   - Contagem de usuários dos dois pools.
2. **[A]** Proteção do Prestare. Se o ✔ acima confirmar que o Prestare usa o provedor OIDC da `voltz-platform`:
   - change set `UPDATE` na `voltz-platform` adicionando `DeletionPolicy: Retain` e `UpdateReplacePolicy: Retain` só no `GitHubOidcProvider`;
   - o template vem do commit que está em produção (`aws cloudformation get-template`), não do `main`, para não puxar a deriva;
   - ✔ o change set mostra **só** essa alteração, sem `Replacement`.

   Depois do descomissionamento, o provedor fica órfão e passa a ser do Prestare. Registre isso nos docs de operação do Prestare.
3. **[D]** Configure os perfis SSO `prestare` e `volti`. Na 117153693161, ative o Cost Explorer e um budget mensal da conta inteira. ✔ `aws sts get-caller-identity --profile volti` retorna 117153693161.
4. **[A]** Na 117153693161, crie as zonas `api-volti-dev.prestarecondominios.com.br` e `voltz.prestarecondominios.com.br`. Copie para a segunda os registros existentes de `voltz.*` (DKIM e MAIL FROM antigos), para que a identidade antiga continue verificada durante a convivência. **Ainda sem delegar.**
5. **[A]** SES na 117153693161: crie a identidade de domínio `voltz.prestarecondominios.com.br` com Easy DKIM e grave os 3 CNAMEs novos **na zona-mãe e na subzona**. Assim a verificação já sai antes da delegação. ✔ Status `Verified`.
6. **[D]** No console do SES da 117153693161, peça *Request production access* (texto em `voltz-loja-web/docs/publicacao/autenticacao-producao.md:96`). Se o SMS for usado, peça também a saída do sandbox do SNS. Os dois pedidos levam até ~24 h ou mais.
7. **[A]** Copie `volti/dev/idp-google` e `volti/dev/idp-apple` para a 117153693161 por pipe. ✔ `describe-secret` existe, e o valor não aparece em log.
8. **[D]** Adicione as URLs novas do Cognito no Google Cloud Console e no Apple Developer (§2.2). A URL nova já pode ser cadastrada antes do domínio existir.
9. **[A]** Congele as branches: o dono avisa os agentes e worktrees ativos que, durante a janela, ninguém roda `volti-dev-update` nem `deploy-api`/`deploy-painel` do Voltz.

### Fase 1: Volti em paralelo (a conta antiga continua servindo)

10. **[A]** No CloudShell da 117153693161 (`cloudshell.md` §1 e §2):
    - instale Node 24 e pnpm;
    - gere a deploy key nova; **[D]** cadastre a parte pública no GitHub (*Aluguel-moto → Settings → Deploy keys*, somente leitura);
    - faça o clone de `origin/main`.
11. **[A]** `cdk bootstrap … --qualifier volti --toolkit-stack-name volti-cdk-toolkit --tags Projeto=Volti`. ✔ A stack `volti-cdk-toolkit` está `CREATE_COMPLETE` e existe o `/cdk-bootstrap/volti/version`.
12. **[A]** `cdk deploy --all` com o contexto da §2.2, que inclui o `hostedZoneId` da subzona nova e os prefixos `-v2`. Para o DNS, a subzona ainda não está delegada. Nesse período o registro existe só nela, sem efeito público, e a API é testada pelo IP ou pelo `sslip.io`. Também é possível fazer o deploy primeiro com `-c apiDomain=-` e trocar no corte. ✔ As 3 stacks em `*_COMPLETE`, `/volti/dev/config/*` preenchido e Hosted UI `https://volti-dev-equipe-v2.auth.sa-east-1.amazoncognito.com/login?...` respondendo.
13. **[D]** Na key policy antiga de `alias/volti-dev`, adicione um statement temporário de Decrypt para a role SSO. **[A]** Leia `FRAUD_HASH_SECRET`, `PICKUP_CODE_SECRET` e `STATION_QR_SECRET` e grave na conta nova com `--key-id alias/volti-dev`. **[D]** Remova o statement. ✔ `get-key-policy` igual ao original.
14. **[A]** Grave `/volti/dev/github-deploy-key` (`cloudshell.md` §5). O primeiro boot leva ~15 min. ✔ `/var/log/volti-boot.log` termina sem erro, `docker ps` mostra os containers saudáveis e `curl -k https://<ip>/health` retorna 200.
15. **[A]** Ensaio de dados: faça um `pg_dump` "quente" do `volti` antigo, restaure no novo, rode o mapa de `sub` (§2.2) num banco de ensaio e meça os tempos. ✔ As contagens de linhas das tabelas principais batem.

### Fase 2: janela de corte do Volti (~1 h, fora do horário de testes; sugestão: depois das 20:00)

16. **[A]** Na instância antiga: `docker compose … stop api traccar-bridge` (congela as escritas). Depois, `pg_dump -Fc` de `volti` (e de `traccar`, só para backup) com `umask 077`, e `aws s3 cp` para um bucket temporário na conta antiga com policy de leitura para a role de cópia da 117153693161.
17. **[A]** `aws s3 sync` dos 5 buckets single (passada final; a primeira pode ser feita na Fase 1).
18. **[A]** Na instância nova:
    - pare a API;
    - `pg_restore --clean --no-owner -d volti`;
    - recrie os usuários do Cognito e aplique o mapa de `sub` (clientes) e `cognitoSub=NULL` (staff);
    - `gt06.sh init` e `gt06.sh provision`;
    - suba a API e rode `volti-dev-admin action=publish-panel`.

    ✔ Contagens iguais ao dump, `/health` 200, login do staff pelo painel novo e login de um cliente de teste por OTP no e-mail.
19. **[A]** DNS:
    - a instância antiga é parada com `dns.sh down`, o que estaciona o A em 192.0.2.1;
    - **desligue as duas agendas do EventBridge Scheduler antigas**, ou a instância antiga religa às 07:00 e o `volti-dns` faz UPSERT de novo do A na zona-mãe;
    - apague o A `api-volti-dev` da zona-mãe e crie o NS de `api-volti-dev.prestarecondominios.com.br` apontando para os 4 servidores da subzona;
    - na instância nova, reinicie o `volti-dns`.

    ✔ `dig +trace api-volti-dev.prestarecondominios.com.br` chega na subzona com o IP novo, o Caddy emite o certificado (log), `curl https://api-volti-dev.prestarecondominios.com.br/health` retorna 200 e o J16 reconecta (posição nova na ficha da moto, TTL 60 s).
20. **[D]** Teste ponta a ponta no app: login com Google e com Apple pelo domínio `-v2`, reserva, fotos de devolução (upload no bucket novo) e painel.

**Rollback do Volti** (antes da Fase 4):
1. Apague o NS da subzona na zona-mãe.
2. Ligue a instância antiga (o `volti-dns` faz UPSERT do A de novo).
3. `docker compose up -d`.
4. Os apps antigos voltam a funcionar. Os builds novos (pool `-v2`) não funcionam no antigo, então guarde os builds anteriores.
5. O que foi escrito no ambiente novo nesse meio-tempo se perde, a menos que se faça um dump reverso.

### Fase 3: Voltz (janela própria, ~1–2 h)

21. **[A]** Na 117153693161, crie as CMKs e o snapshot e restaure o RDS (§2.3). Faça o ensaio primeiro com um snapshot quente. ✔ `psql` a partir do CloudShell via SG temporário, ou só pela API. `_prisma_migrations` tem o mesmo último registro.
22. **[A]** Grave `/voltz/prod/*` na conta nova. Faça o change set `CREATE` de `platform.yaml` (revise com o checklist de `infra/aws/README.md`) e execute. Se D3 = domínio próprio, faça antes um commit no `voltz-app` com `Aliases`/ACM (**[A]** escreve, **[D]** aprova o merge). ✔ Stack `CREATE_COMPLETE`, **[D]** confirma a assinatura do SNS e do Budget no e-mail.
23. **[D]** Atualize as variáveis do GitHub do `voltz-app` (§2.3). **[A]** Dispare `deploy-api.yml` e `deploy-painel.yml` (`gh workflow run … --ref main`). ✔ Os dois verdes, `https://<novo>/api/health` com `"status":"ok"` e o painel abrindo.
24. Corte:
    - **[A]** congele as escritas no Voltz antigo: troque a origem `/api/*` da distribuição antiga para uma resposta 503 (função do CloudFront ou origem inexistente). Não mexa no ambiente EB: ele fica intacto para o rollback;
    - tire um snapshot novo (ou faça `pg_dump`) **depois** do congelamento e refaça o restore na conta nova a partir dele. Com um banco desse tamanho, o restore completo é mais simples que um delta;
    - troque **todas** as origens da distribuição antiga `E7141MRA5JPV3` para o domínio da distribuição nova.

    ✔ Pelo domínio antigo `d3vedyuotgbbos…/api/health`, a resposta vem do EB novo (confira no log do EB novo).
25. **[D]**
    - Webhook do Asaas para a URL nova;
    - tela de consentimento do Google (link da política);
    - URL de privacidade nas lojas;
    - novos builds Android e TestFlight com o `API_URL` novo, que **[A]** muda nos arquivos da §2.3 num commit.

**Rollback do Voltz:** devolva as origens da distribuição antiga para o EB e o bucket antigos. Eles continuam intactos até a Fase 4, e as variáveis do GitHub voltam aos valores anteriores. Anote esses valores antes do passo 23.

### Fase 4: descomissionamento na 850401152034 (≥ 14 dias depois, com tudo verificado)

Comece por um checklist de aceite assinado pelo dono:
- 14 dias sem erro;
- builds novos instalados pelos testadores;
- J16 estável;
- e-mails e SMS chegando.

**Volti**

26. **[A]** Backups finais:
    - snapshot manual do volume da EC2 antiga com tag `final-migracao`;
    - cópia do dump de `volti`/`traccar` para um bucket da 117153693161 com expiração em 90 dias.
27. **[A]** `cdk destroy --all --toolkit-stack-name volti-cdk-toolkit -c env=dev -c profile=single -c account=850401152034` com o perfil `prestare`. Antes de executar, **[D]** confere a lista de stacks. Ficam para trás por `RETAIN`: os 5 buckets single, o bucket admin-web, a KMS `alias/volti-dev` e o pool staff (`cloudshell.md` §Desmontar).
28. **[A]** Limpeza do que sobrou:
    - esvazie e apague os 6 buckets, só depois de conferir as contagens contra os buckets novos;
    - apague o pool `volti-dev-staff` e o domínio dele;
    - `schedule-key-deletion` da KMS (30 dias);
    - apague `/volti/dev/github-deploy-key`, `/volti/dev/secrets/*` e o que mais restar em `/volti/dev/*`;
    - apague os segredos `volti/dev/idp-*` (`--recovery-window-in-days 7`);
    - apague os snapshots do DLM, menos o `final-migracao`, que sai depois de 90 dias;
    - apague os log groups `volti*`.
29. **[A]** Apague a stack `volti-cdk-toolkit`, esvaziando antes o bucket `cdk-volti-assets-…` e o ECR `cdk-volti-container-assets-…`.
30. **[D]**
    - apague a deploy key antiga no GitHub;
    - remova as URLs antigas do Cognito no Google e na Apple;
    - remova os números da sandbox do SNS na conta antiga.

**Voltz**

31. **[A]** `delete-db-instance --db-instance-identifier voltz-postgres --final-db-snapshot-identifier voltz-postgres-final-<data>`. ✔ O snapshot está `available`. Ele **fica** na conta antiga por 90 dias; depois, apague-o ou mantenha uma cópia compartilhada na conta nova.
32. **[A]** Esvazie o panel bucket e o deploy bucket e delete a stack `voltz-platform`. O `GitHubOidcProvider` fica, graças ao Retain do passo 2. ✔ Os dois caminhos de deploy do Prestare (`ci.yml` e `deploy-api.yml`) assumem a role. Rode um `workflow_dispatch` ou espere o próximo push e veja o passo `configure-aws-credentials` verde.
33. **[A]** Apague os 3 buckets `voltz-platform-mediabucket-*` (já sincronizados) e o `cf-templates-13cbooboiuson-sa-east-1`, se o conteúdo for só do Voltz. Também a distribuição-ponte `E7141MRA5JPV3`: primeiro desabilite, e só apague quando o dono confirmar que não há builds antigos em uso.
34. **[A]** SES antigo: apague a identidade `voltz.prestarecondominios.com.br` da 850401152034 e os CNAMEs de DKIM antigos (agora na subzona). ✔ O e-mail do Volti e do Voltz continua saindo pela conta nova.
35. **[A]** Nos docs de operação do Prestare (lista na §1.4), marque o item "cargas não separadas" como resolvido e registre que o provedor OIDC e as 2 delegações NS são do Prestare. Atualize a memória `aws-partner-central-ftr` ou a de governança, se fizer sentido.

---

## 4. Quem faz o quê

**Só o dono** (console, GitHub, aprovações e decisões):
- **D1**: o Voltz vai para a 117153693161 junto com o Volti, ou ganha uma conta própria?
- **D2**: migrar os usuários do Cognito (mapa de `sub`) ou recomeçar com os dados de teste?
- **D3**: o Voltz ganha domínio fixo agora? Qual?
- Criar os perfis SSO e ligar o Cost Explorer e o budget na conta nova.
- Pedir produção no SES e a saída do sandbox do SNS na 117153693161.
- Google Cloud Console: redirect URI novo do Cognito. Apple Developer: Domains e Return URLs do Services ID.
- GitHub:
  - deploy key nova (e apagar a antiga) no `Aluguel-moto`;
  - variáveis `CLIENTE_COGNITO_*` do `Aluguel-moto`;
  - variáveis do `voltz-app` (`AWS_DEPLOY_ROLE_ARN`, buckets, distribuição);
  - aprovar os merges.
- Statement temporário de Decrypt na key policy de `alias/volti-dev` antigo (e a remoção).
- Asaas: URL do webhook. Lojas: URL de privacidade. Google OAuth: link da política.
- Publicar os builds novos no TestFlight e na Play.
- Confirmar as assinaturas de SNS e Budget por e-mail.
- Aprovar cada passo destrutivo da Fase 4 e assinar o aceite de 14 dias.
- Avisar os agentes e worktrees sobre o congelamento.

**O agente** (com a sessão SSO do dono, passo a passo e sem nada destrutivo sem confirmação):
- todas as leituras da Fase 0;
- o change set de Retain do OIDC;
- as zonas e os registros DNS;
- a identidade SES;
- a cópia de segredos por pipe;
- bootstrap e deploy do CDK;
- dumps e restores;
- `s3 sync`;
- a recriação dos usuários do Cognito e o SQL de mapeamento;
- o change set do `platform.yaml`;
- disparar os workflows;
- trocar as origens do CloudFront;
- os commits de URL e docs nos repositórios (em branch, com PR);
- a limpeza da Fase 4.

---

## 5. Riscos

1. **Deploy do Prestare quebrado pelo OIDC.** Apagar a `voltz-platform` sem o Retain apaga o único provedor OIDC da conta (§1.4). Mitigação: passos 1, 2 e 32.
2. **Trabalho em andamento no Volti.** ~40 worktrees, 3 branches sem merge e agentes rodando. Um `volti-dev-update` na instância antiga depois do dump cria divergência de dados. Uma branch que mude `single-dev-stack.ts` ou `config.ts` durante a janela muda o que o `cdk deploy` sobe. Mitigação: congelamento (passo 9), deploy a partir de um commit fixo (anote o SHA) e merge das três branches antes ou depois da janela, nunca durante.
3. **CI ou agenda mexendo na conta antiga durante a migração.**
   - Volti: as agendas antigas religam a EC2 às 07:00, e o `volti-dns` reescreve o A na zona-mãe. Isso conflita com o NS e pode apontar o nome para a instância velha. Mitigação: desligue as agendas no passo 19.
   - Voltz: `deploy-api.yml` e `deploy-painel.yml` continuam publicando na conta antiga até as variáveis mudarem. São só `workflow_dispatch`, mas um agente pode dispará-los. Mitigação: congelamento e troca das variáveis no passo 23.
   - O `infra.yml` do Volti não deve ter `AWS_DEPLOY_ROLE_ARN_DEV`. Confirme.
4. **Usuários do Cognito.** Senhas e TOTP não migram, e o `sub` muda. Sem o mapa, os clientes perdem o histórico, e o staff recebe 403 até o `cognitoSub=NULL`. Builds com o pool antigo deixam de logar.
5. **Prefixos do Hosted UI e URLs dos IdPs.** Com prefixo novo, o login social só funciona depois que o dono atualiza o Google e a Apple (passo 8). Se esquecer, o erro é `redirect_uri_mismatch` ou `invalid_client`.
6. **SES e SNS em sandbox na conta nova.** O OTP por e-mail e o SMS só chegam a destinatários verificados até a AWS aprovar. Peça no começo (passo 6).
7. **URL do CloudFront do Voltz não migra.** Apps, lojas, Asaas e e-mails dependem dela. A ponte pela distribuição antiga resolve no curto prazo, mas mantém um recurso do Voltz na conta do Prestare até o fim da ponte.
8. **RDS criptografado com `aws/rds`.** Não pode ser compartilhado direto e exige a cópia com CMK. Os KMS ficam em duas contas durante a migração.
9. **Segredos do Volti protegidos por KMS.** Por desenho, nem o admin decifra (`infra/README.md` §Segredos). Mexer na key policy é sensível: faça exatamente um statement temporário e confira com `get-key-policy` no fim.
10. **Custo em dobro durante a convivência** (~2 a 3 semanas):
    - Volti single: ≈ US$ 21/mês (`infra/README.md` §Custo);
    - Voltz: EB `t3.micro` + RDS `db.t4g.micro` + IPv4 + CloudFront, ≈ US$ 35 a 45/mês;
    - mais 2 zonas (US$ 1/mês) e snapshots finais (centavos).

    Total extra estimado: < US$ 50 no período. O budget da conta nova deve ser da conta inteira, não por tag.
11. **Conta de gerenciamento.** Se a 850401152034 for a conta de gerenciamento da Organization (verificado no passo 1), o Prestare continua rodando nela. O Well-Architected também recomenda não ter cargas na conta de gerenciamento. Registre isso como pendência separada; não faz parte deste plano.
12. **Deriva do `platform.yaml`.** A conta nova recebe o template do `main` (SES e CSP), que nunca foi aplicado em produção. Teste o envio de e-mail e o painel (CSP) antes do corte.
