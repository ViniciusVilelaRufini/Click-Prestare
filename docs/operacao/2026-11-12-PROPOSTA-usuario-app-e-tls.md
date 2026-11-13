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
| Migrações manuais e `scripts/ops/tunel-rds.sh` | master | usuário administrativo, só como break-glass |
| TLS no servidor | opcional | parameter group com `require_secure_transport=1` |
| TLS no Prisma | `prefer`, aceita qualquer certificado | `sslaccept=strict` + `sslcert=<bundle>` na URL |
| CA do RDS no pacote do EB | ausente | `global-bundle.pem` dentro do pacote |
| Túnel (`mysql_prestare`) | `--ssl-mode` padrão (PREFERRED) | `--ssl-mode=VERIFY_CA --ssl-ca=$RDS_CA_BUNDLE` quando o bundle existe (já no código) |

## Passo a passo proposto (janela de manutenção curta, com snapshot antes)

1. **Snapshot manual** do `database-1` (RDS → Snapshots) e anotar o id.
2. **Bundle de CA**: baixar o `global-bundle.pem` da página oficial da AWS sobre SSL/TLS no RDS. No CloudShell,
   salvar em `$HOME/global-bundle.pem` (é o caminho padrão que o `tunel-rds.sh` procura; ou exporte `RDS_CA_BUNDLE`).
3. **Usuário da aplicação**: abrir o túnel (`source scripts/ops/tunel-rds.sh`, que já passa a verificar o certificado)
   e rodar `click-cond-web/prisma/sql/2026-11-12-PROPOSTA-usuario-app-e-tls.sql`, trocando `<GERAR_NA_HORA>`
   por uma senha gerada na hora (no próprio terminal; não salvar o arquivo editado, não deixar no histórico do shell).
   Conferir com `SHOW GRANTS FOR 'click_app'@'%'`.
4. **Bundle no pacote do EB**: incluir o `global-bundle.pem` no zip gerado por `click-cond-web/scripts/migration/bundle-eb.mjs`
   (por exemplo em `certs/global-bundle.pem` na raiz do pacote) — mudança de código separada, revisada antes.
5. **Nova `DATABASE_URL` no SSM**: mesma forma da atual, com `click_app`, a senha nova e, no fim da query string,
   `sslaccept=strict&sslcert=<caminho absoluto do bundle na instância>`. Gravar com
   `aws ssm put-parameter --name /prestare/api/DATABASE_URL --type SecureString --key-id alias/prestare-dados --overwrite --value <novo>`
   (procedimento do `runbooks.md`, seção de segredos), sem deixar o valor no histórico.
6. **Reiniciar** `aws elasticbeanstalk restart-app-server --environment-name Clickprestareapi-env` e verificar
   `/api/health`, um login do app, um login da portaria-web e uma gravação (ex.: registrar uma encomenda de teste
   no condomínio "teste Api prestare").
7. **TLS obrigatório no servidor**: criar um parameter group customizado da família do `database-1` (MySQL 8.0)
   com `require_secure_transport=1`, associar ao `database-1` e aplicar na janela (reinício). Conferir com
   `SHOW VARIABLES LIKE 'require_secure_transport'` (→ `ON`) e `SHOW STATUS LIKE 'Ssl_cipher'` (não vazio) pelo túnel.
8. **Master só para emergência**: trocar a senha do master (RDS → modify master password), atualizar o
   `.env` local de quem roda migrações e registrar no `runbooks.md` que a `DATABASE_URL` da API não é mais o master.
9. **API legada** (`click-cond-api`): não é publicada por nenhum workflow; se voltar a rodar, `MySQL.js` precisa de
   `ssl: { ca: <bundle>, rejectUnauthorized: true }` antes (hoje desliga a verificação).

## Volta

- API não sobe/erro de conexão após o passo 6: restaurar a `DATABASE_URL` anterior no SSM e reiniciar o EB.
- Clientes recusados após o passo 7: voltar o `database-1` ao parameter group anterior e reiniciar.
- O snapshot do passo 1 cobre qualquer erro no passo 3.

## Fora desta proposta

- Usuário separado para migrações (hoje o administrativo) — decidir junto.
- `sslaccept=strict` sem bundle no pacote depende do trust store do sistema da instância — não fazer o passo 5 antes do 4.
