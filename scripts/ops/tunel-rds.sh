#!/bin/bash
# Abre tunel SSM ate o RDS (porta local 3307) via a instancia da API e exporta credenciais do banco.
# Uso: source scripts/ops/tunel-rds.sh   ->  depois: mysql_prestare -e "select 1"
# Credenciais vem do parametro SSM em TUNEL_URL_PARAM (padrao /prestare/api/DATABASE_URL, a URL da API).
# Migracoes com o usuario administrativo: TUNEL_URL_PARAM=/prestare/db/ADMIN_URL source scripts/ops/tunel-rds.sh
ENV_NAME=Clickprestareapi-env
INST=$(aws ec2 describe-instances --filters Name=instance-state-name,Values=running "Name=tag:elasticbeanstalk:environment-name,Values=$ENV_NAME" --query 'Reservations[0].Instances[0].InstanceId' --output text)
TUNEL_PARAM_SSM="${TUNEL_URL_PARAM:-/prestare/api/DATABASE_URL}"
URL=$(aws ssm get-parameter --name "$TUNEL_PARAM_SSM" --with-decryption --query Parameter.Value --output text 2>/dev/null)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then
  if [ "$TUNEL_PARAM_SSM" != "/prestare/api/DATABASE_URL" ]; then
    echo "erro: parametro SSM $TUNEL_PARAM_SSM vazio ou inexistente; tunel nao aberto" >&2
    return 1 2>/dev/null || exit 1
  fi
  URL=$(aws elasticbeanstalk describe-configuration-settings --application-name click-prestare-api --environment-name $ENV_NAME \
    --query "ConfigurationSettings[0].OptionSettings[?OptionName=='DATABASE_URL'].Value|[0]" --output text)
fi
eval "$(python3 - "$URL" <<'EOF'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
print(f"DBHOST={p.hostname}; DBUSER={u.unquote(p.username)}; DBPASS='{u.unquote(p.password)}'; DBNAME={p.path[1:]}")
EOF
)"
pkill -f 'StartPortForwardingSessionToRemoteHost' 2>/dev/null
nohup aws ssm start-session --target "$INST" --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$DBHOST,portNumber=3306,localPortNumber=3307" > /tmp/tunel.log 2>&1 &
sleep 6
# TLS quando houver o bundle de CA do RDS (global-bundle.pem da documentacao da AWS).
# Mesma variavel do run-sql-migration.mjs. Cliente mysql da Oracle: VERIFY_CA, nao VERIFY_IDENTITY
# (o cliente conecta em 127.0.0.1, o tunel, nao no hostname do certificado). Cliente MariaDB (o
# mariadb105 do CloudShell): nao tem --ssl-mode e o --ssl-verify-server-cert confere o hostname,
# entao so forca TLS (--ssl), sem verificar a CA (aviso). Sem o bundle, segue como antes (aviso).
RDS_CA_BUNDLE="${RDS_CA_BUNDLE:-$HOME/global-bundle.pem}"
if [ -f "$RDS_CA_BUNDLE" ]; then
  if mysql --version 2>/dev/null | grep -qi mariadb; then
    MYSQL_SSL_ARGS=(--ssl "--ssl-ca=$RDS_CA_BUNDLE")
    echo "aviso: cliente mysql e MariaDB; TLS forcado, mas sem verificar a CA pelo tunel (o cliente mysql da Oracle faz VERIFY_CA)" >&2
  else
    MYSQL_SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$RDS_CA_BUNDLE")
  fi
else
  MYSQL_SSL_ARGS=()
  echo "aviso: bundle de CA do RDS nao encontrado em $RDS_CA_BUNDLE; mysql sem verificacao de certificado (defina RDS_CA_BUNDLE)" >&2
fi
mysql_prestare() { MYSQL_PWD="$DBPASS" mysql ${MYSQL_SSL_ARGS[@]+"${MYSQL_SSL_ARGS[@]}"} -h 127.0.0.1 -P 3307 -u "$DBUSER" "$DBNAME" "$@"; }
echo "tunel via $INST -> $DBHOST"
