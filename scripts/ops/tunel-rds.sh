#!/bin/bash
# Abre tunel SSM ate o RDS (porta local 3307) via a instancia da API e exporta credenciais do banco.
# Uso: source scripts/ops/tunel-rds.sh   ->  depois: mysql_prestare -e "select 1"
ENV_NAME=Clickprestareapi-env
INST=$(aws ec2 describe-instances --filters Name=instance-state-name,Values=running "Name=tag:elasticbeanstalk:environment-name,Values=$ENV_NAME" --query 'Reservations[0].Instances[0].InstanceId' --output text)
URL=$(aws ssm get-parameter --name /prestare/api/DATABASE_URL --with-decryption --query Parameter.Value --output text 2>/dev/null)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then
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
# TLS verificado quando houver o bundle de CA do RDS (global-bundle.pem da documentacao da AWS).
# Mesma variavel do run-sql-migration.mjs. VERIFY_CA, nao VERIFY_IDENTITY: o cliente conecta em
# 127.0.0.1 (o tunel), nao no hostname do certificado. Sem o bundle, segue como antes (aviso).
RDS_CA_BUNDLE="${RDS_CA_BUNDLE:-$HOME/global-bundle.pem}"
if [ -f "$RDS_CA_BUNDLE" ]; then
  MYSQL_SSL_ARGS=(--ssl-mode=VERIFY_CA "--ssl-ca=$RDS_CA_BUNDLE")
else
  MYSQL_SSL_ARGS=()
  echo "aviso: bundle de CA do RDS nao encontrado em $RDS_CA_BUNDLE; mysql sem verificacao de certificado (defina RDS_CA_BUNDLE)" >&2
fi
mysql_prestare() { MYSQL_PWD="$DBPASS" mysql ${MYSQL_SSL_ARGS[@]+"${MYSQL_SSL_ARGS[@]}"} -h 127.0.0.1 -P 3307 -u "$DBUSER" "$DBNAME" "$@"; }
echo "tunel via $INST -> $DBHOST"
