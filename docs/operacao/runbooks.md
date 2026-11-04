# Runbooks operacionais

Dono de todos os procedimentos: o fundador (Vinicius Vilela). Conta AWS `850401152034`, região `sa-east-1`, ambiente EB `Clickprestareapi-env`. Alarmes chegam por e-mail via SNS `prestare-alertas`. Painel: CloudWatch `Prestare-Operacao`. Em incidente de segurança, siga também `plano-resposta-incidentes.md`.

> Os alarmes, o painel, o canary e o grupo de logs são criados na rodada WAFR (grupo 1). Se algum ainda não existir na conta, o passo correspondente vale como procedimento-alvo.

## 1. Deploy

Há dois caminhos, ambos autenticados por OIDC (role `github-deploy-prestare`, sem chave estática): `deploy-api.yml` (push na `main`, descrito abaixo) e o job `deploy` do `ci.yml` (push no `master`, versão `v-<run>-<sha>`). Fluxo do `deploy-api.yml`:

1. Migrações SQL, se houver, são aplicadas **antes** do push, manualmente no RDS (nunca depois).
2. `git push` em `master` e `main`; cada branch dispara seu caminho e o `deploy-api.yml` espera o ambiente ficar `Ready` antes de atualizar.
3. O workflow: `npm ci` -> `nx build @org/api` -> `scripts/migration/bundle-eb.mjs` (gera `deploy-api-aws.zip`) -> envia ao S3 do EB como versão `api-<SHA>` -> `update-environment`.
4. Verificações automáticas do workflow: a versão no ambiente é a esperada, `Status=Ready` e `Health != Red`, e `GET /api/health` responde com CORS correto.
5. Disparo manual: `gh workflow run deploy-api.yml --ref main` (sem `--ref main` o padrão é `master` e o job não roda).

Cuidados: não acrescentar `--option-settings` (variáveis do EB já no limite de 4096 caracteres; ver `cotas-e-limites.md`). Se o workflow ficou verde mas a versão não mudou, o passo "Verify deployed version" falha de propósito.

## 2. Rollback

Reimplantar a versão anterior do EB (ficam guardadas as versões `api-<SHA>` do `deploy-api.yml` e `v-<run>-<SHA>` do `ci.yml`; use o rótulo que `describe-application-versions` listar):

```bash
aws elasticbeanstalk describe-application-versions --application-name <app> \
  --query 'ApplicationVersions[].[VersionLabel,DateCreated]' --output text
aws elasticbeanstalk update-environment --environment-name Clickprestareapi-env \
  --version-label api-<SHA-anterior>
aws elasticbeanstalk wait environment-updated --environment-names Clickprestareapi-env
```

Depois confirme `https://api.prestarecondominios.com.br/api/health`. Se a versão ruim incluía migração de banco, avalie se o schema novo é compatível com o código antigo antes de reverter; migrações devem ser aditivas. Registre o caso em post-incidente (`melhoria-continua.md`).

## 3. Restaurar o banco (RDS `database-1`)

Restauração cria uma **nova** instância; não sobrescreve a atual.

1. Console RDS -> `database-1` -> Actions -> *Restore to point in time* (qualquer instante dentro da retenção, ~5 min de granularidade) ou escolha um snapshot automático/manual.
2. Nome novo (ex.: `database-1-restore-AAAAMMDD`), mesma VPC, mesmo security group e mesma criptografia (instância atual: db.t4g.micro, 20 GB, single-AZ).
3. Valide: conectar e contar linhas nas tabelas centrais (ex.: `Users`, `Acessos_Facial`).
4. Troque o endpoint: ajustar o host no env do EB (atenção ao limite de 4096 caracteres: substituir valor, não acrescentar). A deletion protection da instância original permanece ligada.
5. Pós-restauração: confirmar `/api/health`, rodar o canary manualmente, anotar horário e causa.

Detalhes de RTO/RPO em `plano-recuperacao-desastre.md`.

## 4. Rotacionar credencial

Regra geral: criar a nova -> atualizar onde é usada -> verificar -> revogar a antiga. Nunca registrar o valor em repo, chat ou log.

- **Deploy (GitHub Actions)**: não há chave a rotacionar; os dois caminhos usam OIDC (role `github-deploy-prestare`). Pendentes com chave estática em secrets: `database-migration.yml` e `prepare-api-domain.yml`; até migrá-los para OIDC, rotacione criando nova chave IAM, atualizando o secret, testando e apagando a antiga.
- **Variáveis do EB** (JWT, banco, SMTP, chaves de API): alterar o valor existente (não acrescentar variáveis; limite 4096) e aplicar via `update-environment`. Trocar o segredo do JWT desloga todos os usuários.
- **Senha do banco**: alterar no RDS (modify master password) e no env do EB na mesma janela; breve indisponibilidade.
- **Chave S3 `click_user`** (conta 952520388262): gerar nova no IAM daquela conta, atualizar o env do EB, apagar a antiga.
- **SMTP / Firebase / Gemini / WhatsApp**: gerar no painel do provedor, atualizar o env do EB, testar envio, revogar a anterior.

## 5. Respostas aos alarmes

Alarmes pelo nome (CloudWatch, `sa-east-1`, exceto o do CloudFront): `prestare-eb-saude`, `prestare-ec2-statuscheck`, `prestare-rds-cpu`, `prestare-rds-armazenamento`, `prestare-rds-conexoes`, `prestare-cloudfront-5xx`, `prestare-canary-falha`, `prestare-api-erros`.

Primeiro passo comum: abrir o painel `Prestare-Operacao`, checar `/api/health` e os eventos recentes do EB (`aws elasticbeanstalk describe-events --environment-name Clickprestareapi-env --max-items 20`).

### 5.1 `prestare-eb-saude` (EB health Degraded/Severe)
Ver o motivo no console do EB (Health). Causas usuais: deploy ruim, processo caindo, disco cheio. Se começou logo após deploy: rollback (seção 2). Senão, ler os logs do EB no CloudWatch Logs; como último recurso, *Restart app server(s)*.

### 5.2 `prestare-cloudfront-5xx`
O alarme e o tópico SNS `prestare-alertas` correspondente ficam em **us-east-1** (métricas globais do CloudFront).
Distinguir 502/504 (origem fora ou lenta) de 500 (erro da aplicação). Testar `/api/health`. 502/504 com EB verde: verificar prefix list/security group da instância (só aceita porta 80 do CloudFront) e a saúde do EB. 500: ver filtro ERROR (5.8).

### 5.3 `prestare-rds-cpu` (CPU alta)
Ver Performance Insights/processlist: consulta lenta ou varredura. Encerrar a consulta travada, corrigir índice depois. Se recorrente, avaliar classe maior (custo; decisão do fundador). Cruzar com picos de tráfego do agente de portaria.

### 5.4 `prestare-rds-armazenamento` (espaço baixo; disco de 20 GB)
Ver o que cresceu (tabelas de eventos como `Acessos_Facial`). Aumentar o armazenamento alocado (só cresce, não encolhe; há intervalo mínimo entre alterações) e abrir tarefa de expurgo/retenção.

### 5.5 `prestare-rds-conexoes` (mais de 50 conexões)
Checar `SHOW PROCESSLIST`: vazamento de conexão após deploy ou rajada. Reiniciar o app no EB libera o pool. Se recorrente, ajustar o pool da API ou a classe da instância.

### 5.6 `prestare-ec2-statuscheck` (StatusCheckFailed)
Instância única (sem SSH). Fazer *Reboot* da instância; se persistir, *Rebuild environment* do EB. Single-AZ: se for falha da AWS, abrir caso no AWS Support.

### 5.7 `prestare-canary-falha` (canary `prestare-health`)
O canary roda a cada 15 min com dois passos: `api-health` (API) e `site-sobre` (página `/sobre`); veja qual passo falhou. Verificar se é a API (`curl /api/health`), CloudFront ou DNS. Se a API está de pé, ver o relatório do canary (pode ser falso positivo de rede). Dois ciclos seguidos falhando = indisponibilidade real: seguir `plano-recuperacao-desastre.md` e comunicar clientes (`responsabilidades-e-escalonamento.md`).

### 5.8 `prestare-api-erros` (filtro ERROR)
O metric filter `ERROR` no log group `/aws/elasticbeanstalk/Clickprestareapi-env/var/log/web.stdout.log` (retenção 30 dias) dispara o alarme com mais de 20 ocorrências em 5 min. No CloudWatch Logs Insights: `fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50`. Identificar rota/serviço; se repetitivo e afeta usuários, tratar como incidente; se isolado, abrir issue.
