#!/bin/bash
# Grava no Crm_Config (cifrados como encryptSecret do servidor) o pixel e a chave de
# conversões da OpenAI Ads. Rodar no AWS CloudShell. A chave é lida sem eco e nunca é impressa.
set -u
ENV_NAME=Clickprestareapi-env
APP=click-prestare-api
PIXEL_ID=17H2XPR4dY5HHBNUs9L5ha

command -v mysql >/dev/null || sudo dnf install -y -q mariadb105 >/dev/null 2>&1 || sudo yum install -y -q mariadb105 >/dev/null 2>&1
command -v mysql >/dev/null || { echo "ERRO: cliente mysql indisponível"; exit 1; }

ler() { # parâmetro SSM, senão configuração do Elastic Beanstalk
  local v
  v=$(aws ssm get-parameter --name "/prestare/api/$1" --with-decryption --query Parameter.Value --output text 2>/dev/null)
  if [ -z "$v" ] || [ "$v" = "None" ]; then
    v=$(aws elasticbeanstalk describe-configuration-settings --application-name "$APP" --environment-name "$ENV_NAME" \
      --query "ConfigurationSettings[0].OptionSettings[?OptionName=='$1'].Value|[0]" --output text 2>/dev/null)
  fi
  [ "$v" = "None" ] && v=""
  printf '%s' "$v"
}

SEGREDO_SERVIDOR=$(ler FACIAL_CRED_KEY)
[ -n "$SEGREDO_SERVIDOR" ] || SEGREDO_SERVIDOR=$(ler JWT_SECRET)
[ -n "$SEGREDO_SERVIDOR" ] || { echo "ERRO: segredo do servidor não encontrado"; exit 1; }
export SEGREDO_SERVIDOR

INST=$(aws ec2 describe-instances --filters Name=instance-state-name,Values=running "Name=tag:elasticbeanstalk:environment-name,Values=$ENV_NAME" --query 'Reservations[0].Instances[0].InstanceId' --output text)
URL=$(ler DATABASE_URL)
eval "$(python3 - "$URL" <<'PY'
import sys, urllib.parse as u, shlex
p = u.urlparse(sys.argv[1])
print(f"DBHOST={shlex.quote(p.hostname)}; DBUSER={shlex.quote(u.unquote(p.username))}; DBPASS={shlex.quote(u.unquote(p.password))}; DBNAME={shlex.quote(p.path[1:])}")
PY
)"
pkill -f StartPortForwardingSessionToRemoteHost 2>/dev/null
nohup aws ssm start-session --target "$INST" --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$DBHOST,portNumber=3306,localPortNumber=3307" >/tmp/tunel.log 2>&1 &
sleep 6
sql() { MYSQL_PWD="$DBPASS" mysql -h 127.0.0.1 -P 3307 -u "$DBUSER" "$DBNAME" -N -B "$@"; }
sql -e "select 1" >/dev/null || { echo "ERRO: sem conexão com o banco"; exit 1; }

cifra() { node -e '
const c=require("crypto");const k=c.createHash("sha256").update(process.env.SEGREDO_SERVIDOR).digest();
const iv=c.randomBytes(12),x=c.createCipheriv("aes-256-gcm",k,iv);
const e=Buffer.concat([x.update(process.env.TEXTO,"utf8"),x.final()]);
process.stdout.write("enc:v1:"+Buffer.concat([iv,x.getAuthTag(),e]).toString("base64"));'; }

# Confere o segredo do servidor com um valor já cifrado, sem imprimir nada dele.
EXISTENTE=$(sql -e "select valor from Crm_Config where chave='OPENAI_ADS_API_KEY'")
if [ -n "$EXISTENTE" ]; then
  VALOR="$EXISTENTE" node -e '
const c=require("crypto");const k=c.createHash("sha256").update(process.env.SEGREDO_SERVIDOR).digest();
const r=Buffer.from(process.env.VALOR.slice(7),"base64");
const d=c.createDecipheriv("aes-256-gcm",k,r.subarray(0,12));d.setAuthTag(r.subarray(12,28));
Buffer.concat([d.update(r.subarray(28)),d.final()]);' 2>/dev/null \
    || { echo "ERRO: o segredo encontrado não bate com o do servidor; nada foi gravado"; exit 1; }
  echo "ok: segredo do servidor conferido"
fi

printf 'Cole a chave de conversões (não aparece na tela) e tecle Enter: '
read -rs CHAVE; echo
CHAVE=$(printf '%s' "$CHAVE" | tr -d '[:space:]')
[ ${#CHAVE} -ge 20 ] || { echo "ERRO: chave vazia ou curta demais; nada foi gravado"; exit 1; }

# Valida a chave: um evento de teste, sem clique real, não é atribuído a nenhuma campanha.
HTTP=$(CHAVE="$CHAVE" node -e '
fetch("https://bzr.openai.com/v1/events?pid='"$PIXEL_ID"'",{method:"POST",headers:{Authorization:"Bearer "+process.env.CHAVE,"Content-Type":"application/json"},
body:JSON.stringify({events:[{id:"teste-chave-"+Date.now(),type:"lead_created",timestamp_ms:Date.now(),oppref:"teste-configuracao",action_source:"offline",data:{type:"customer_action"}}]})})
.then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write("rede"))')
echo "OpenAI respondeu: $HTTP"
case "$HTTP" in 401|403) echo "ERRO: a OpenAI recusou a chave; nada foi gravado"; exit 1;; rede) echo "ERRO: sem resposta da OpenAI; nada foi gravado"; exit 1;; esac

for par in "OPENAI_ADS_CONVERSIONS_API_KEY:$CHAVE" "OPENAI_ADS_PIXEL_ID:$PIXEL_ID"; do
  NOME=${par%%:*}; export TEXTO=${par#*:}
  V=$(cifra)
  sql -e "insert into Crm_Config (chave, valor, updated_at) values ('$NOME','$V',now()) on duplicate key update valor=values(valor), updated_at=now();" || { echo "ERRO ao gravar $NOME"; exit 1; }
done
unset CHAVE TEXTO SEGREDO_SERVIDOR
sql -e "select chave, left(valor,7), length(valor) from Crm_Config where chave in ('OPENAI_ADS_CONVERSIONS_API_KEY','OPENAI_ADS_PIXEL_ID');"
pkill -f StartPortForwardingSessionToRemoteHost 2>/dev/null
echo "PRONTO: gravado. O servidor passa a usar em até 5 minutos."
