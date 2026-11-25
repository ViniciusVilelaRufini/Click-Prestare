#!/bin/bash
# Bateria de testes de produção Prestare — só leitura (nenhuma escrita no banco ou na AWS).
# Uso no CloudShell (conta 850401152034): bash bateria.sh [--banco]  -> relatório em ~/testes/relatorio-<ts>.txt
# --banco: abre o túnel (scripts/ops/tunel-rds.sh ao lado) e roda integridade.sql (só leitura).
# Rodar depois de cada deploy. Criada na bateria de 25/11/2026 (ver docs/operacao/bateria-producao-2026-11-25.md).
set -u
API=https://api.prestarecondominios.com.br/api
WWW=https://www.prestarecondominios.com.br
ENV_NAME=Clickprestareapi-env
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p ~/testes; OUT=~/testes/relatorio-$TS.txt; : > $OUT
P=0; W=0; F=0
ok(){ P=$((P+1)); printf 'PASS  %-38s %s\n' "$1" "${2:-}" | tee -a $OUT >/dev/null; }
av(){ W=$((W+1)); printf 'WARN  %-38s %s\n' "$1" "${2:-}" | tee -a $OUT; }
fa(){ F=$((F+1)); printf 'FAIL  %-38s %s\n' "$1" "${2:-}" | tee -a $OUT; }
sec(){ echo "== $1" >> $OUT; }
code(){ curl -s -o /tmp/b -w '%{http_code}' --max-time 20 "$@"; }

sec "1. API caixa-preta"
c=$(code $API/health); [ "$c" = 200 ] && ok health "200" || fa health "$c"
# latência health (20 req)
ts=(); for i in $(seq 20); do ts+=($(curl -s -o /dev/null -w '%{time_total}' --max-time 20 $API/health)); done
p50=$(printf '%s\n' "${ts[@]}" | sort -n | sed -n 10p); p95=$(printf '%s\n' "${ts[@]}" | sort -n | sed -n 19p)
awk "BEGIN{exit !($p95<1.0)}" && ok "latencia health p50/p95" "${p50}s/${p95}s" || av "latencia health p50/p95" "${p50}s/${p95}s"
# cabeçalhos de segurança
H=$(curl -sI --max-time 20 $API/health)
for h in strict-transport-security x-content-type-options x-frame-options; do echo "$H" | grep -qi "^$h:" && ok "header $h" || fa "header $h" ausente; done
echo "$H" | grep -qi '^x-powered-by:' && fa "header x-powered-by" "exposto" || ok "header x-powered-by" "oculto"
# CORS
a=$(curl -sI --max-time 20 -H 'Origin: https://evil.example.com' $API/health | grep -i '^access-control-allow-origin' | tr -d '\r')
[ -z "$a" ] && ok "CORS origem estranha" "sem ACAO" || fa "CORS origem estranha" "$a"
a=$(curl -sI --max-time 20 -H "Origin: $WWW" $API/health | grep -i '^access-control-allow-origin' | tr -d '\r')
echo "$a" | grep -q "$WWW" && ok "CORS origem oficial" || fa "CORS origem oficial" "'$a'"
# rotas protegidas sem token -> 401
for r in condominios/1/moradores condominios/1/visitas condominios/1/dashboard condominios/1/relatorios condominios/1/encomendas condominios/1/ocorrencias condominios/1/apartamentos condominios/1/comunicados condominios/1/pessoas facial/devices; do
  c=$(code $API/$r); case $c in 401|403) ok "sem token /$r" "$c";; 404) av "sem token /$r" "404 (rota?)";; *) fa "sem token /$r" "$c $(head -c 120 /tmp/b)";; esac
done
# JWT forjado (alg none / assinatura errada)
J='eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6MSwicm9sZSI6InNpbmRpY28ifQ.'
c=$(code -H "Authorization: Bearer $J" $API/condominios/1/moradores); [ "$c" = 401 ] && ok "JWT alg=none" 401 || fa "JWT alg=none" $c
J2='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6InNpbmRpY28iLCJleHAiOjk5OTk5OTk5OTl9.c2lnbmF0dXJhLWZhbHNh'
c=$(code -H "Authorization: Bearer $J2" $API/condominios/1/moradores); [ "$c" = 401 ] && ok "JWT assinatura falsa" 401 || fa "JWT assinatura falsa" $c
# 404 sem stack
c=$(code $API/rota-que-nao-existe-$TS); grep -qiE 'at .*\.js|node_modules|stack' /tmp/b && fa "404 vaza stack" || ok "404 sem stack" $c
# login inválido: 401, sem 500, mensagem genérica
L=naoexiste.$TS@example.invalid
c=$(code -X POST -H 'Content-Type: application/json' -d "{\"login\":\"$L\",\"senha\":\"x\"}" $API/moradores/login); case $c in 400|401) ok "login morador inválido" $c;; *) fa "login morador inválido" "$c $(head -c 150 /tmp/b)";; esac
c=$(code -X POST -H 'Content-Type: application/json' -d "{\"login\":\"' OR 1=1 -- \",\"senha\":\"x\"}" $API/moradores/login); case $c in 400|401|429) ok "login com SQLi" $c;; *) fa "login com SQLi" "$c $(head -c 150 /tmp/b)";; esac
c=$(code -X POST -H 'Content-Type: application/json' -d '{"login":{"$ne":null},"senha":{"$ne":null}}' $API/moradores/login); case $c in 400|401|429) ok "login com objeto no campo" $c;; *) fa "login com objeto no campo" "$c $(head -c 150 /tmp/b)";; esac
c=$(code -X POST -H 'Content-Type: application/json' -d '{"login":' $API/moradores/login); case $c in 400) ok "JSON malformado" 400;; *) fa "JSON malformado" "$c $(head -c 150 /tmp/b)";; esac
c=$(code -X POST -H 'Content-Type: application/json' -d '[]' $API/sindico/login); case $c in 400|401) ok "login body array" $c;; *) fa "login body array" "$c $(head -c 150 /tmp/b)";; esac
c=$(code -X POST -H 'Content-Type: application/json' -d '{}' $API/auth/login-portaria); case $c in 400|401) ok "login-portaria vazio" $c;; *) fa "login-portaria vazio" "$c $(head -c 150 /tmp/b)";; esac
# corpo grande (3 MB) -> 413
head -c 3000000 /dev/zero | tr '\0' 'a' | sed 's/^/{"login":"/;s/$/"}/' > /tmp/big.json
c=$(code -X POST -H 'Content-Type: application/json' --data-binary @/tmp/big.json $API/moradores/login); case $c in 413) ok "corpo 3MB" 413;; *) fa "corpo 3MB" "$c";; esac
# throttle do login (12 tentativas com e-mail inexistente)
last=; for i in $(seq 12); do last=$(code -X POST -H 'Content-Type: application/json' -d "{\"login\":\"t$i.$L\",\"senha\":\"x\"}" $API/sindico/login); done
[ "$last" = 429 ] && ok "throttle login síndico" 429 || fa "throttle login síndico" "12a tentativa=$last"
# recuperação de senha não revela se o e-mail existe
c=$(code -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$L\"}" $API/moradores/recovery-password); r1=$(head -c 200 /tmp/b)
case $c in 200|201|202|204|429) ok "recovery e-mail inexistente" "$c";; *) fa "recovery e-mail inexistente" "$c $r1";; esac
# agente com token falso
c=$(code "$API/facial/agent/tokenfalso$TS/poll"); case $c in 401|403|404) ok "agente token falso" $c;; *) fa "agente token falso" "$c $(head -c 120 /tmp/b)";; esac
# métodos perigosos
c=$(code -X TRACE $API/health); case $c in 404|405|403|400) ok "TRACE" $c;; *) av "TRACE" $c;; esac
# portal web
c=$(code $WWW/); [ "$c" = 200 ] && ok "www /" 200 || fa "www /" $c
for p in sobre/ precos/ login; do c=$(code $WWW/$p); [ "$c" = 200 ] && ok "www /$p" 200 || av "www /$p" $c; done
HW=$(curl -sI --max-time 20 $WWW/); echo "$HW" | grep -qi '^strict-transport-security' && ok "www HSTS" || av "www HSTS" ausente
c=$(code http://api.prestarecondominios.com.br/api/health); case $c in 301|308|403) ok "API http->https" $c;; 200) fa "API aceita http puro" 200;; *) av "API http" $c;; esac
# TLS
for h in api.prestarecondominios.com.br www.prestarecondominios.com.br; do
  e=$(echo | openssl s_client -servername $h -connect $h:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  d=$(( ($(date -d "$e" +%s) - $(date +%s)) / 86400 )); [ $d -gt 21 ] && ok "TLS $h" "${d} dias" || fa "TLS $h" "expira em ${d} dias"
  echo | openssl s_client -tls1_1 -servername $h -connect $h:443 >/dev/null 2>&1 && av "TLS1.1 aceito $h" || ok "TLS1.1 recusado $h"
done
# agente: release anunciada
REL=$(curl -s --max-time 20 'https://api.github.com/repos/ViniciusVilelaRufini/Click-Prestare/releases?per_page=20' | python3 -c "import sys,json;r=[x for x in json.load(sys.stdin) if x['tag_name'].startswith('agent-v') and not x['draft'] and not x['prerelease']];print(r[0]['tag_name'] if r else '')")
[ "$REL" = agent-v2026.11.24 ] && ok "release agente mais recente" $REL || av "release agente mais recente" "$REL"

sec "2. Infra AWS"
read EH ES EV <<<$(aws elasticbeanstalk describe-environments --environment-names $ENV_NAME --query 'Environments[0].[Health,Status,VersionLabel]' --output text)
[ "$EH" = Green ] && ok "EB saúde" "$EH $ES $EV" || av "EB saúde" "$EH $ES $EV"
N=$(aws elasticbeanstalk describe-environment-resources --environment-name $ENV_NAME --query 'length(EnvironmentResources.Instances)' --output text); [ "$N" -ge 2 ] && ok "EB instâncias" $N || av "EB instâncias" "$N (sem redundância)"
EL=$(aws elasticbeanstalk describe-configuration-settings --application-name click-prestare-api --environment-name $ENV_NAME --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment'].[OptionName,Value]" --output json | python3 -c "import sys,json;print(sum(len(a)+len(b or '') for a,b in json.load(sys.stdin)))")
[ $EL -lt 3600 ] && ok "EB tamanho das envs" "$EL/4096" || av "EB tamanho das envs" "$EL/4096 (perto do limite)"
DB=$(aws rds describe-db-instances --query 'DBInstances[0]' --output json)
for k in MultiAZ StorageEncrypted DeletionProtection; do v=$(echo "$DB" | python3 -c "import sys,json;print(json.load(sys.stdin)['$k'])"); [ "$v" = True ] && ok "RDS $k" || av "RDS $k" "$v"; done
v=$(echo "$DB" | python3 -c "import sys,json;print(json.load(sys.stdin)['PubliclyAccessible'])"); [ "$v" = False ] && ok "RDS não público" || fa "RDS público" "$v"
v=$(echo "$DB" | python3 -c "import sys,json;print(json.load(sys.stdin)['BackupRetentionPeriod'])"); [ "$v" -ge 7 ] && ok "RDS retenção backup" "${v}d" || av "RDS retenção backup" "${v}d"
v=$(echo "$DB" | python3 -c "import sys,json;print(json.load(sys.stdin).get('LatestRestorableTime',''))"); ok "RDS último ponto restaurável" "$v"
DBI=$(echo "$DB" | python3 -c "import sys,json;print(json.load(sys.stdin)['DBInstanceIdentifier'])")
cw(){ aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name $1 --dimensions Name=DBInstanceIdentifier,Value=$DBI --start-time $(date -u -d '-24 hours' +%FT%TZ) --end-time $(date -u +%FT%TZ) --period 86400 --statistics $2 --query "Datapoints[0].$2" --output text; }
v=$(cw CPUUtilization Maximum); awk "BEGIN{exit !($v<80)}" && ok "RDS CPU máx 24h" "$v%" || av "RDS CPU máx 24h" "$v%"
v=$(cw FreeStorageSpace Minimum); g=$(awk "BEGIN{printf \"%.1f\", $v/1073741824}"); awk "BEGIN{exit !($g>5)}" && ok "RDS disco livre mín" "${g}GB" || av "RDS disco livre mín" "${g}GB"
v=$(cw DatabaseConnections Maximum); ok "RDS conexões máx 24h" "$v"
AL=$(aws cloudwatch describe-alarms --alarm-name-prefix prestare- --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text); [ -z "$AL" ] && ok "alarmes em ALARM" nenhum || av "alarmes em ALARM" "$AL"
NA=$(aws cloudwatch describe-alarms --query 'length(MetricAlarms)' --output text); ok "alarmes configurados" $NA
for t in $(aws cloudwatch describe-alarms --alarm-name-prefix prestare- --query 'MetricAlarms[].AlarmActions[]' --output text | tr '\t' '\n' | sort -u | grep sns); do s=$(aws sns list-subscriptions-by-topic --topic-arn $t --query "length(Subscriptions[?SubscriptionArn!='PendingConfirmation'])" --output text); [ "$s" -gt 0 ] && ok "SNS assinantes ${t##*:}" $s || fa "SNS sem assinante confirmado" "${t##*:}"; done

sec "3. Logs 24h"
G=/aws/elasticbeanstalk/$ENV_NAME/var/log/web.stdout.log
cnt(){ aws logs filter-log-events --log-group-name $G --start-time $(( ($(date +%s) - 86400) * 1000 )) --filter-pattern "$1" --query 'length(events)' --output json 2>/dev/null; }
for pat in '"Status: 500"' P2024 P2028 '"Unhandled"' '"ECONNREFUSED"' '"heap out of memory"'; do n=$(cnt "$pat"); [ "${n:-0}" = 0 ] && ok "log $pat" 0 || av "log $pat" "$n ocorrências"; done
aws logs filter-log-events --log-group-name $G --start-time $(( ($(date +%s) - 86400) * 1000 )) --filter-pattern '"Status: 500"' --query 'events[].message' --output text 2>/dev/null | grep -o 'Error: .\{0,160\}' | sort | uniq -c | sort -rn | head -8 > ~/testes/erros500-$TS.txt

if [ "${1:-}" = "--banco" ]; then
  sec "4. Integridade do banco (só leitura)"
  D=$(cd "$(dirname "$0")" && pwd)
  [ -f "$D/../tunel-rds.sh" ] && source "$D/../tunel-rds.sh" >/dev/null 2>&1
  if mysql_prestare -B < "$D/integridade.sql" > ~/testes/integridade-$TS.txt 2>&1; then
    while IFS=$'	' read -r k n e; do
      [ "$k" = chk ] && continue; [ -z "$e" ] && continue
      if [ "$e" = 0 ]; then [ "$n" = 0 ] && ok "banco $k" 0 || fa "banco $k" "$n"; elif [ "$e" = info ]; then ok "banco $k" "$n (info)"; fi
    done < <(head -60 ~/testes/integridade-$TS.txt)
  else fa "integridade.sql" "$(tail -2 ~/testes/integridade-$TS.txt)"; fi
fi
echo "== RESUMO: PASS=$P WARN=$W FAIL=$F" | tee -a $OUT
echo "relatório: $OUT"
