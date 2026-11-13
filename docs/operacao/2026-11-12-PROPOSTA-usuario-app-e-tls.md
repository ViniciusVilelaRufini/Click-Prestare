# PROPOSTA — não aplicado: usuário de banco da API com menor privilégio e TLS obrigatório

Origem: auditoria run-3 (lote 2, S21) — `db-runtime-user-master-privileges` e `db-transport-tls-not-required`.
Estado em 12/11: **nada aplicado.** A API, o túnel e os scripts conectam ao RDS `database-1` com o
usuário master; o Prisma usa o padrão do conector MySQL (TLS se o servidor oferecer, sem verificar o
certificado); o pacote do EB não leva o bundle de CA do RDS. O banco está em subnets privadas, então
isto é defesa em profundidade e compromisso de TLS em trânsito (LGPD/DPA), não um caminho de ataque aberto.

## O que muda (quando o dono decidir)

| Item | Hoje | Depois |
|---|---|---|
| Usuário da API (`/prestare/api/DATABASE_URL`) | master | `click_app` (SELECT/INSERT/UPDATE/DELETE/EXECUTE em `click_prestare.*`, `REQUIRE SSL`) |
| Migrações manuais e `scripts/ops/tunel-rds.sh` | master (lido de `/prestare/api/DATABASE_URL`) | usuário administrativo, só como break-glass, lido de `/prestare/db/ADMIN_URL` via `TUNEL_URL_PARAM` (passo 5) |
| TLS no servidor | opcional | parameter group com `require_secure_transport=1` |
| TLS no Prisma | `prefer`, aceita qualquer certificado | `sslaccept=strict` + `sslcert=<bundle>` na URL |
| CA do RDS no pacote do EB | ausente | `global-bundle.pem` dentro do pacote |
| Túnel (`mysql_prestare`) | TLS padrão do cliente, sem verificar certificado | com o bundle (já no código): cliente mysql da Oracle → `--ssl-mode=VERIFY_CA --ssl-ca=$RDS_CA_BUNDLE`; cliente MariaDB (o `mariadb105` do CloudShell) → `--ssl --ssl-ca=$RDS_CA_BUNDLE`, TLS forçado sem verificar a CA (aviso) |

## Passo a passo proposto (janela de manutenção curta, com snapshot antes)

1. **Snapshot manual** do `database-1` (RDS → Snapshots) e anotar o id.
2. **Bundle de CA**: baixar o `global-bundle.pem` da página oficial da AWS sobre SSL/TLS no RDS. No CloudShell,
   salvar em `$HOME/global-bundle.pem` (é o caminho padrão que o `tunel-rds.sh` procura; ou exporte `RDS_CA_BUNDLE`).
   Observação: a verificação da CA (`VERIFY_CA`) exige o cliente mysql da Oracle. Com o `mariadb105` que os scripts
   instalam no CloudShell, o túnel força TLS mas não verifica o certificado (o MariaDB não tem `--ssl-mode` e o
   `--ssl-verify-server-cert` confere o hostname, que pelo túnel é `127.0.0.1`); o script avisa no stderr.
3. **Usuário da aplicação**: abrir o túnel (`source scripts/ops/tunel-rds.sh`, que já força TLS com o bundle)
   e rodar `click-cond-web/prisma/sql/2026-11-12-PROPOSTA-usuario-app-e-tls.sql`, trocando `<GERAR_NA_HORA>`
   por uma senha gerada na hora (no próprio terminal; não salvar o arquivo editado, não deixar no histórico do shell).
   Conferir com `SHOW GRANTS FOR 'click_app'@'%'`.
4. **Bundle no pacote do EB**: incluir o `global-bundle.pem` no zip gerado por `click-cond-web/scripts/migration/bundle-eb.mjs`
   (por exemplo em `certs/global-bundle.pem` na raiz do pacote) — mudança de código separada, revisada antes.
5. **URL administrativa separada no SSM** (antes de mexer na `DATABASE_URL`): gravar a URL administrativa atual
   (hoje igual à `DATABASE_URL` da API) num parâmetro próprio, com
   `aws ssm put-parameter --name /prestare/db/ADMIN_URL --type SecureString --key-id alias/prestare-dados --value <url administrativa>`,
   sem deixar o valor no histórico. O `tunel-rds.sh` lê por padrão `/prestare/api/DATABASE_URL`, que no passo 6 passa a
   ser o `click_app` (só DML); a partir daqui, migrações e qualquer acesso administrativo abrem o túnel com
   `TUNEL_URL_PARAM=/prestare/db/ADMIN_URL source scripts/ops/tunel-rds.sh` (se o parâmetro estiver vazio ou não existir,
   o script para com erro em vez de cair na URL da API).
6. **Nova `DATABASE_URL` no SSM**: mesma forma da atual, com `click_app`, a senha nova e, no fim da query string,
   `sslaccept=strict&sslcert=<caminho absoluto do bundle na instância>`. Gravar com
   `aws ssm put-parameter --name /prestare/api/DATABASE_URL --type SecureString --key-id alias/prestare-dados --overwrite --value <novo>`
   (procedimento do `runbooks.md`, seção de segredos), sem deixar o valor no histórico.
7. **Reiniciar** `aws elasticbeanstalk restart-app-server --environment-name Clickprestareapi-env` e verificar
   `/api/health`, um login do app, um login da portaria-web e uma gravação (ex.: registrar uma encomenda de teste
   no condomínio "teste Api prestare").
8. **TLS obrigatório no servidor**: criar um parameter group customizado da família do `database-1` (MySQL 8.0)
   com `require_secure_transport=1`, associar ao `database-1` e aplicar na janela (reinício). Conferir com
   `SHOW VARIABLES LIKE 'require_secure_transport'` (→ `ON`) e `SHOW STATUS LIKE 'Ssl_cipher'` (não vazio) pelo túnel.
9. **Master só para emergência**: trocar a senha do master (RDS → modify master password), atualizar
   `/prestare/db/ADMIN_URL` no SSM com a senha nova (`put-parameter --overwrite`, mesma chave KMS), atualizar o
   `.env` local de quem roda migrações e registrar no `runbooks.md` que a `DATABASE_URL` da API não é mais o master
   e que migrações usam `TUNEL_URL_PARAM=/prestare/db/ADMIN_URL`.
10. **API legada** (`click-cond-api`): não é publicada por nenhum workflow; se voltar a rodar, `MySQL.js` precisa de
   `ssl: { ca: <bundle>, rejectUnauthorized: true }` antes (hoje desliga a verificação).

## Volta

- API não sobe/erro de conexão após o passo 7: restaurar a `DATABASE_URL` anterior no SSM (a URL administrativa
  guardada em `/prestare/db/ADMIN_URL` no passo 5) e reiniciar o EB.
- Clientes recusados após o passo 8: voltar o `database-1` ao parameter group anterior e reiniciar.
- O snapshot do passo 1 cobre qualquer erro no passo 3.
- O parâmetro `/prestare/db/ADMIN_URL` pode ficar mesmo se a proposta for desfeita (o túnel sem `TUNEL_URL_PARAM`
  continua lendo a `DATABASE_URL`).

## Fora desta proposta

- Usuário separado para migrações (hoje o administrativo) — decidir junto.
- `sslaccept=strict` sem bundle no pacote depende do trust store do sistema da instância — não fazer o passo 6 antes do 4.
