#!/usr/bin/env bash
# Instala/atualiza a central de voz nesta EC2 (Ubuntu 24.04, Asterisk do apt,
# coturn, Node 22). Rodado como root pelo deploy-voz.yml via SSM, de dentro da
# release extraída:
#   bash /opt/prestare-voz/releases/<sha>/deploy/instalar.sh <sha>
#
# Segredos: SSM Parameter Store /prestare/voz/{VOZ_TOKEN_SECRET,VOZ_INTERNAL_TOKEN,
# VOZ_TURN_SECRET,VOZ_ARI_SENHA}. Certificado e sons já ficam na máquina (hook do
# certbot e geração única); este script só confere.
set -euo pipefail

SHA="${1:?uso: instalar.sh <sha>}"
REL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=/opt/prestare-voz
REGIAO=sa-east-1
DOMINIO=voz.prestarecondominios.com.br
export IP_PUBLICO=54.21.36.213

log() { echo "[instalar $(date +%H:%M:%S)] $*"; }
falhar() { echo "[instalar] ERRO: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || falhar "rode como root"
command -v asterisk >/dev/null || falhar "asterisk não instalado"
id asterisk >/dev/null 2>&1 || falhar "usuário asterisk não existe"
command -v turnserver >/dev/null || falhar "coturn não instalado"
NODE_BIN="$(command -v node)" || falhar "node não instalado"
AWS_BIN=/snap/bin/aws
[ -x "$AWS_BIN" ] || AWS_BIN="$(command -v aws)" || falhar "aws-cli não instalado"

log "release $SHA em $REL"

# 1. Segredos do SSM ---------------------------------------------------------
for nome in VOZ_TOKEN_SECRET VOZ_INTERNAL_TOKEN VOZ_TURN_SECRET VOZ_ARI_SENHA; do
  valor="$("$AWS_BIN" ssm get-parameter --region "$REGIAO" --name "/prestare/voz/$nome" \
    --with-decryption --query Parameter.Value --output text)"
  [ -n "$valor" ] && [ "$valor" != "None" ] || falhar "parâmetro /prestare/voz/$nome vazio"
  export "$nome=$valor"
done
log "segredos lidos do SSM"

# 2. IP privado (IMDSv2) -----------------------------------------------------
TOKEN_IMDS="$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
IP_PRIVADO="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN_IMDS" \
  http://169.254.169.254/latest/meta-data/local-ipv4)"
[[ "$IP_PRIVADO" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || falhar "IP privado inválido: $IP_PRIVADO"
export IP_PRIVADO
log "IP privado $IP_PRIVADO"

# 3. Código ------------------------------------------------------------------
DEST="$BASE/releases/$SHA"
mkdir -p "$BASE/releases"
if [ "$REL" != "$DEST" ]; then
  rm -rf "$DEST" && mkdir -p "$DEST" && cp -a "$REL/." "$DEST/"
fi
cd "$DEST"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
ln -sfn "$DEST" "$BASE/atual"
# Guarda as 3 releases mais recentes (nunca a atual).
for antiga in $(ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +4); do
  [ "${antiga%/}" = "$DEST" ] || rm -rf "${antiga%/}"
done
PREENCHER=("$NODE_BIN" "$DEST/deploy/preencher.mjs")
log "código instalado em $DEST"

# 4. Ambiente do serviço -----------------------------------------------------
export VOZ_API_BASE=https://api.prestarecondominios.com.br/api
export VOZ_ARI_URL=http://127.0.0.1:8088
export VOZ_ARI_USUARIO=prestare
export VOZ_PJSIP_ARQUIVO=/etc/asterisk/pjsip_prestare.conf
export VOZ_CONTROLE_PORTA=443
export VOZ_CERT_DIR=/etc/prestare-voz/tls
"${PREENCHER[@]}" --env /etc/prestare-voz.env.novo \
  VOZ_API_BASE VOZ_INTERNAL_TOKEN VOZ_TOKEN_SECRET VOZ_ARI_SENHA VOZ_ARI_URL \
  VOZ_ARI_USUARIO VOZ_PJSIP_ARQUIVO VOZ_CONTROLE_PORTA VOZ_CERT_DIR
chown root:root /etc/prestare-voz.env.novo
chmod 600 /etc/prestare-voz.env.novo
mv -f /etc/prestare-voz.env.novo /etc/prestare-voz.env

# 5. Asterisk ----------------------------------------------------------------
# instalar_conf <modelo> <destino> <dono:grupo> -> devolve 0 se mudou
instalar_conf() {
  local modelo="$1" destino="$2" dono="$3" tmp
  tmp="$(mktemp)"
  # Chamada dentro de `if`: o set -e não vale aqui, então cada passo confere.
  "${PREENCHER[@]}" "$modelo" "$tmp" || { rm -f "$tmp"; falhar "não preenchi $modelo"; }
  [ -s "$tmp" ] || { rm -f "$tmp"; falhar "$modelo ficou vazio"; }
  if [ -f "$destino" ] && cmp -s "$tmp" "$destino"; then
    rm -f "$tmp"
    return 1
  fi
  install -o "${dono%%:*}" -g "${dono##*:}" -m 640 "$tmp" "$destino" || falhar "não instalei $destino"
  rm -f "$tmp"
  log "atualizado $destino"
  return 0
}

[ -d /etc/asterisk.original-ubuntu ] || cp -a /etc/asterisk /etc/asterisk.original-ubuntu
MUDOU_ASTERISK=0
for f in pjsip.conf extensions.conf http.conf ari.conf rtp.conf modules.conf logger.conf manager.conf; do
  if instalar_conf "$DEST/asterisk/$f" "/etc/asterisk/$f" root:asterisk; then MUDOU_ASTERISK=1; fi
done
# Arquivo de contas: o serviço (root) reescreve no lugar; o Asterisk só lê.
if [ ! -f /etc/asterisk/pjsip_prestare.conf ]; then
  echo "; preenchido pelo prestare-voz" > /etc/asterisk/pjsip_prestare.conf
  MUDOU_ASTERISK=1
fi
chown root:asterisk /etc/asterisk/pjsip_prestare.conf
chmod 640 /etc/asterisk/pjsip_prestare.conf

for arq in /etc/asterisk/keys/voz.crt /etc/asterisk/keys/voz.key /etc/prestare-voz/tls/fullchain.pem /etc/prestare-voz/tls/privkey.pem; do
  [ -s "$arq" ] || falhar "certificado ausente: $arq (rodar o certbot e o hook de renovação)"
done
for som in apto-nao-encontrado servico-indisponivel ninguem-atendeu aguarde-para-chamar beep; do
  ls /usr/share/asterisk/sounds/prestare/"$som".* >/dev/null 2>&1 \
    || log "AVISO: som prestare/$som ausente (ver deploy/gerar-sons.sh)"
done

# 6. coturn ------------------------------------------------------------------
MUDOU_TURN=0
if instalar_conf "$DEST/coturn/turnserver.conf" /etc/turnserver.conf root:turnserver; then MUDOU_TURN=1; fi
if [ -f /etc/default/coturn ] && ! grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi

# 7. fail2ban ----------------------------------------------------------------
if [ -d /etc/fail2ban/jail.d ]; then
  if ! cmp -s "$DEST/fail2ban/prestare-voz.conf" /etc/fail2ban/jail.d/prestare-voz.conf; then
    install -m 644 "$DEST/fail2ban/prestare-voz.conf" /etc/fail2ban/jail.d/prestare-voz.conf
    touch /var/log/asterisk/messages && chown asterisk:asterisk /var/log/asterisk/messages
    systemctl restart fail2ban || log "AVISO: fail2ban não reiniciou"
  fi
fi

# 7b. nginx (TLS 8089 → só /ws do Asterisk; a ARI nunca sai do loopback) ----
if ! command -v nginx >/dev/null; then
  log "instalando nginx"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx
fi
# O site padrão ocuparia a porta 80, que o certbot --standalone usa na renovação.
rm -f /etc/nginx/sites-enabled/default
install -m 644 "$DEST/nginx/prestare-voz.conf" /etc/nginx/sites-available/prestare-voz.conf
ln -sfn /etc/nginx/sites-available/prestare-voz.conf /etc/nginx/sites-enabled/prestare-voz.conf
nginx -t || falhar "configuração do nginx inválida"

# 7c. Hook de renovação do certificado (sobrescrito sempre; idempotente) -----
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 "$DEST/deploy/hook-renovacao.sh" /etc/letsencrypt/renewal-hooks/deploy/prestare.sh

# 8. systemd -----------------------------------------------------------------
sed "s#__NODE__#$NODE_BIN#" "$DEST/deploy/prestare-voz.service" > /etc/systemd/system/prestare-voz.service.novo
mv -f /etc/systemd/system/prestare-voz.service.novo /etc/systemd/system/prestare-voz.service
systemctl daemon-reload
systemctl enable asterisk coturn nginx prestare-voz >/dev/null 2>&1

# 9. Reinícios (Asterisk só quando a configuração mudou: derruba chamadas) ----
if [ "$MUDOU_ASTERISK" = 1 ] || ! systemctl is-active --quiet asterisk; then
  log "reiniciando asterisk"
  systemctl restart asterisk
  for _ in $(seq 1 30); do
    asterisk -rx 'core show uptime' >/dev/null 2>&1 && break
    sleep 1
  done
fi
if [ "$MUDOU_TURN" = 1 ] || ! systemctl is-active --quiet coturn; then
  log "reiniciando coturn"
  systemctl restart coturn
fi
# Depois do Asterisk: se ele ainda escutava na 8089 (versão antiga com TLS),
# já soltou a porta.
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl restart nginx
fi
log "reiniciando prestare-voz"
systemctl restart prestare-voz

# 10. Conferência ------------------------------------------------------------
SAUDE=""
for _ in $(seq 1 30); do
  SAUDE="$(curl -fsS --max-time 3 --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO/controle/saude" 2>/dev/null || true)"
  [[ "$SAUDE" == *'"ari":true'* ]] && break
  sleep 2
done
asterisk -rx 'pjsip show transports' || true
systemctl --no-pager --lines=0 status asterisk coturn nginx prestare-voz || true
# A ARI não pode responder pela 8089 pública.
ARI_FORA="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 --resolve "$DOMINIO:8089:127.0.0.1" \
  "https://$DOMINIO:8089/ari/api-docs/resources.json" || true)"
[ "$ARI_FORA" = "404" ] || falhar "a 8089 respondeu $ARI_FORA para /ari (esperado 404)"
[[ "$SAUDE" == *'"ari":true'* ]] || {
  journalctl -u prestare-voz --no-pager -n 40 || true
  falhar "saúde do serviço não confirmou ARI: ${SAUDE:-sem resposta}"
}
log "ok: $SAUDE"
