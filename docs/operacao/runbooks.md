# Runbooks operacionais

Dono de todos os procedimentos: o fundador (Vinicius Vilela). Conta AWS `850401152034`, região `sa-east-1`, ambiente EB `Clickprestareapi-env` (balanceado: Application Load Balancer + Auto Scaling group de 2 a 4 instâncias em sa-east-1b e sa-east-1c; sem SSH). Alarmes chegam por e-mail via SNS `prestare-alertas`. Painel: CloudWatch `Prestare-Operacao`. Em incidente de segurança, siga também `plano-resposta-incidentes.md`.

> Os alarmes, o painel, o canary e o grupo de logs são criados na rodada WAFR (grupo 1). Se algum ainda não existir na conta, o passo correspondente vale como procedimento-alvo.

## 1. Deploy

Há dois caminhos, ambos autenticados por OIDC (role `github-deploy-prestare`, sem chave estática): `deploy-api.yml` (push na `main`, descrito abaixo) e o job `deploy` do `ci.yml` (push no `master`, versão `v-<run>-<sha>`). Fluxo do `deploy-api.yml`:

1. Migrações SQL, se houver, são aplicadas **antes** do push, manualmente no RDS (nunca depois), pelo túnel da seção 6. O workflow `database-migration.yml` foi aposentado (abria o security group do banco para a internet); não existe mais caminho por GitHub Actions até o RDS.
2. `git push` em `master` e `main`; cada branch dispara seu caminho e o `deploy-api.yml` espera o ambiente ficar `Ready` antes de atualizar.
3. O workflow: `npm ci` -> `nx build @org/api` -> `scripts/migration/bundle-eb.mjs` (gera `deploy-api-aws.zip`) -> envia ao S3 do EB como versão `api-<SHA>` -> `update-environment`. A política de deploy é *Rolling com batch de 1* e as mudanças de configuração também são em rolling por saúde: sempre há instância atendendo, sem indisponibilidade.
4. Verificações automáticas do workflow: a versão no ambiente é a esperada, `Status=Ready` e `Health != Red`, e `GET /api/health` responde com CORS correto.
5. Disparo manual: `gh workflow run deploy-api.yml --ref main` (sem `--ref main` o padrão é `master` e o job não roda).

Cuidados: com duas ou mais instâncias, a migração deve ser compatível com o código antigo e o novo ao mesmo tempo (aditiva), porque durante o rolling as duas versões convivem. Não acrescentar `--option-settings` (variáveis do EB já no limite de 4096 caracteres; ver `cotas-e-limites.md`). Se o workflow ficou verde mas a versão não mudou, o passo "Verify deployed version" falha de propósito.

## 2. Rollback

Reimplantar a versão anterior do EB (ficam guardadas as versões `api-<SHA>` do `deploy-api.yml` e `v-<run>-<SHA>` do `ci.yml`; use o rótulo que `describe-application-versions` listar):

```bash
aws elasticbeanstalk describe-application-versions --application-name <app> \
  --query 'ApplicationVersions[].[VersionLabel,DateCreated]' --output text
aws elasticbeanstalk update-environment --environment-name Clickprestareapi-env \
  --version-label api-<SHA-anterior>
aws elasticbeanstalk wait environment-updated --environment-names Clickprestareapi-env
```

O rollback também é rolling (sem queda).

Depois confirme `https://api.prestarecondominios.com.br/api/health`. Se a versão ruim incluía migração de banco, avalie se o schema novo é compatível com o código antigo antes de reverter; migrações devem ser aditivas. Registre o caso em post-incidente (`melhoria-continua.md`).

## 3. Restaurar o banco (RDS `database-1`)

Restauração cria uma **nova** instância; não sobrescreve a atual. O `database-1` é Multi-AZ (failover automático na mesma região), fica em subnets privadas sem rota para a internet (subnet group `prestare-db-privado`, route table `prestare-privada`) e não é publicamente acessível. Uma falha de zona não exige restauração: o RDS promove o standby sozinho (em geral 1 a 2 minutos). Restaure só para corrupção, apagão lógico ou perda do banco.

1. Console RDS -> `database-1` -> Actions -> *Restore to point in time* (qualquer instante dentro da retenção de 7 dias, ~5 min de granularidade) ou escolha um snapshot automático/manual.
2. Nome novo (ex.: `database-1-restore-AAAAMMDD`). **Subnet group `prestare-db-privado`**, **Publicly accessible = No**, security group do banco (o que só aceita a API), mesma criptografia, Multi-AZ conforme a produção. Não use o subnet group padrão: ele é público.
3. Valide pelo túnel (seção 6, apontando `DBHOST` para o endpoint novo): contar linhas nas tabelas centrais (ex.: `Users`, `Acessos_Facial`) e comparar com a produção.
4. Troque o endpoint de uma destas formas:
   - **Renomear** (foi como a migração para Multi-AZ foi feita em 04/11/2026): renomear a instância atual para `database-1-antigo` e depois a restaurada para `database-1`. O endpoint volta a ser o mesmo e a `DATABASE_URL` não muda; há alguns minutos de indisponibilidade durante a renomeação.
   - **Trocar a URL**: atualizar o parâmetro SSM `/prestare/api/DATABASE_URL` (seção 4) e reiniciar os app servers.
   A deletion protection da instância original permanece ligada.
5. Reiniciar os app servers do EB (`aws elasticbeanstalk restart-app-server --environment-name Clickprestareapi-env`) para o pool reconectar, confirmar `/api/health`, rodar o canary manualmente, anotar horário e causa.

Pendência de 04/11/2026: a instância antiga está parada como `database-1-antigo`, mantida só como fallback. A AWS religa instâncias paradas após 7 dias (e volta a cobrar): decidir a exclusão (com snapshot final) até 2026-11-11.

Detalhes de RTO/RPO em `plano-recuperacao-desastre.md`.

## 4. Rotacionar credencial

Regra geral: criar a nova -> atualizar onde é usada -> verificar -> revogar a antiga. Nunca registrar o valor em repo, chat ou log.

- **Deploy (GitHub Actions)**: não há chave a rotacionar; os dois caminhos usam OIDC (role `github-deploy-prestare`). A chave estática do usuário IAM `github-actions-deploy` foi desativada e os secrets correspondentes saíram do GitHub.
- **Segredos da API** (SSM Parameter Store, `/prestare/api/*`, SecureString com a chave KMS `alias/prestare-dados`, rotação da chave ligada): `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_SYNC_TOKEN`, `SMTP_PASS`, `SUPERLOGICA_APP_TOKEN`, `SUPERLOGICA_ACCESS_TOKEN`, `FIREBASE_SERVICE_ACCOUNT_JSON`. Saíram do ambiente do EB e são lidos no boot (`apps/api/src/app/common/segredos-ssm.ts`); se um obrigatório faltar, o processo não sobe (falha rápida). Procedimento:
  1. Gerar o novo valor (no provedor, quando for externo).
  2. Atualizar o parâmetro: `aws ssm put-parameter --name /prestare/api/<NOME> --type SecureString --key-id alias/prestare-dados --overwrite --value <novo>`, sem deixar o valor no histórico do shell.
  3. Reiniciar os app servers: `aws elasticbeanstalk restart-app-server --environment-name Clickprestareapi-env`. O parâmetro só é lido no boot.
  4. Verificar: `/api/health`, um login e a função do segredo (e-mail enviado, push, chamada à Superlógica).
  5. Revogar o valor antigo no provedor.
  Casos: trocar `JWT_SECRET` desloga todos os usuários; trocar `INTERNAL_SYNC_TOKEN` exige trocar também no agente local; trocar a senha do banco exige alterar no RDS (modify master password) e na `DATABASE_URL` na mesma janela, com breve indisponibilidade.
- **Arquivos (S3)**: não há chave estática. O bucket privado `prestare-arquivos-850401152034` é acessado pelo role da instância; a chave `click_user` foi removida do EB. Não crie chaves de acesso para a API.
- **Gemini / WhatsApp / demais variáveis que continuam no EB**: alterar o valor existente (o limite de 4096 caracteres vale para o que sobrou), aplicar via `update-environment` e conferir a versão; ou migrar o item para o SSM.

## 5. Respostas aos alarmes

Alarmes pelo nome (CloudWatch, `sa-east-1`, exceto o do CloudFront): `prestare-eb-saude`, `prestare-ec2-statuscheck` (por Auto Scaling group), `prestare-alb-instancias-doentes`, `prestare-alb-5xx`, `prestare-rds-cpu`, `prestare-rds-armazenamento`, `prestare-rds-conexoes`, `prestare-cloudfront-5xx`, `prestare-canary-falha`, `prestare-api-erros`.

Primeiro passo comum: abrir o painel `Prestare-Operacao`, checar `/api/health` e os eventos recentes do EB (`aws elasticbeanstalk describe-events --environment-name Clickprestareapi-env --max-items 20`).

### 5.1 `prestare-eb-saude` (EB health Degraded/Severe)
Ver o motivo no console do EB (Health). Causas usuais: deploy ruim, processo caindo, disco cheio. Se começou logo após deploy: rollback (seção 2). Senão, ler os logs do EB no CloudWatch Logs; como último recurso, *Restart app server(s)*.

### 5.2 `prestare-cloudfront-5xx`
O alarme e o tópico SNS `prestare-alertas` correspondente ficam em **us-east-1** (métricas globais do CloudFront).
Distinguir 502/504 (origem fora ou lenta) de 500 (erro da aplicação). Testar `/api/health`. 502/504 com EB verde: o caminho agora é CloudFront -> ALB -> instâncias. Verificar o security group `prestare-alb` (só aceita porta 80 da prefix list de origem do CloudFront), o security group da instância (só aceita o SG do ALB) e a saúde dos *targets* do ALB. Se o `alb-5xx` também disparou, o problema é a aplicação, não a borda. 500: ver filtro ERROR (5.8).

### 5.3 `prestare-rds-cpu` (CPU alta)
Ver Performance Insights/processlist: consulta lenta ou varredura. Encerrar a consulta travada, corrigir índice depois. Se recorrente, avaliar classe maior (custo; decisão do fundador). Cruzar com picos de tráfego do agente de portaria.

### 5.4 `prestare-rds-armazenamento` (espaço baixo; disco de 20 GB)
Ver o que cresceu (tabelas de eventos como `Acessos_Facial`). Aumentar o armazenamento alocado (só cresce, não encolhe; há intervalo mínimo entre alterações) e abrir tarefa de expurgo/retenção.

### 5.5 `prestare-rds-conexoes` (mais de 50 conexões)
Checar `SHOW PROCESSLIST`: vazamento de conexão após deploy ou rajada. Reiniciar o app no EB libera o pool. Se recorrente, ajustar o pool da API ou a classe da instância.

### 5.6 `prestare-ec2-statuscheck` (StatusCheckFailed)
O alarme agora é por Auto Scaling group. Com 2 a 4 instâncias, o grupo substitui a instância com falha e o ALB a tira da rotação; normalmente basta acompanhar. Se persistir, ver o *Activity history* do ASG e os eventos do EB; *Rebuild environment* só como último recurso. Se for falha da AWS, abrir caso no AWS Support. Sem SSH: para inspecionar, usar o Session Manager (SSM).

### 5.7 `prestare-canary-falha` (canary `prestare-health`)
O canary roda a cada 15 min com dois passos: `api-health` (API) e `site-sobre` (página `/sobre`); veja qual passo falhou. Verificar se é a API (`curl /api/health`), CloudFront ou DNS. Se a API está de pé, ver o relatório do canary (pode ser falso positivo de rede). Dois ciclos seguidos falhando = indisponibilidade real: seguir `plano-recuperacao-desastre.md` e comunicar clientes (`responsabilidades-e-escalonamento.md`).

### 5.8 `prestare-api-erros` (filtro ERROR)
O metric filter `ERROR` no log group `/aws/elasticbeanstalk/Clickprestareapi-env/var/log/web.stdout.log` (retenção 30 dias) dispara o alarme com mais de 20 ocorrências em 5 min. No CloudWatch Logs Insights: `fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50`. Identificar rota/serviço; se repetitivo e afeta usuários, tratar como incidente; se isolado, abrir issue.

### 5.9 `prestare-alb-instancias-doentes` (UnHealthyHostCount >= 1 por 3 min)
Há instância reprovando o health check `/api/health`. Ver os *targets* do ALB e os eventos do EB; causas usuais: deploy em andamento, processo caindo, RDS ou SSM inacessível no boot (o boot falha rápido se faltar segredo obrigatório). Uma instância doente não derruba o serviço (o ALB usa a outra), mas some a redundância: tratar como urgente. Se foi logo após deploy, rollback (seção 2).

### 5.10 `prestare-alb-5xx` (5xx dos targets > 20 em 5 min)
Erro da aplicação visto pelo ALB. Ver o filtro ERROR (5.8). Atenção a **503 rápidos**: são o *bulkhead* por dependência (limite de concorrência por instância: IA 8, Superlógica 4, WhatsApp 8, SMTP 4, em `limitar-concorrencia.ts`) recusando chamadas quando o terceiro está lento. Nesse caso a causa é o provedor externo, não a API.

## 6. Acessar o banco (pessoas e migrações)

O RDS está em subnet privada, sem rota para a internet e sem acesso a partir de IP residencial. O único caminho é o túnel SSM Session Manager por uma instância da API:

1. Abrir o **AWS CloudShell** (região `sa-east-1`) logado pelo IAM Identity Center (portal `https://d-946752aa07.awsapps.com/start`, permission set `Administrador`).
2. Obter o script do repo (`scripts/ops/tunel-rds.sh`) e carregá-lo: `source tunel-rds.sh`. Ele escolhe uma instância em execução do ambiente, lê `DATABASE_URL` do SSM (`/prestare/api/DATABASE_URL`, sem imprimir), abre o port forwarding para o RDS na porta local **3307** e define a função `mysql_prestare`.
3. Usar: `mysql_prestare -e "select 1"` (ou `mysql_prestare < migracao.sql`). Não copie a senha para fora do CloudShell.
4. Ao terminar: `pkill -f StartPortForwardingSessionToRemoteHost`.

Usos: **migrações SQL** (aplicar antes do push, conferir com `SHOW CREATE TABLE`/contagens depois) e **verificação de restore** (seção 3; para a instância restaurada, ajustar `DBHOST` antes de abrir o túnel). Se o túnel não abrir, conferir se há instância `running` no ASG e se o plugin do Session Manager está disponível no CloudShell.
