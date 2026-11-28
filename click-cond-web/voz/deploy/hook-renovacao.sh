#!/bin/sh
# Hook de renovação do certbot para voz.prestarecondominios.com.br.
# Instalado pelo instalar.sh em /etc/letsencrypt/renewal-hooks/deploy/prestare.sh
# (sobrescrito a cada deploy, idempotente). Copia o certificado para quem usa:
#   /etc/asterisk/keys/voz.{crt,key}        (asterisk 640; reserva, o Asterisk hoje não faz TLS)
#   /etc/prestare-voz/tls/fullchain.pem     (644)  nginx 8089, controle 443 do serviço
#   /etc/prestare-voz/tls/privkey.pem       (root:turnserver 640)
# e recarrega nginx/asterisk e reinicia prestare-voz e coturn.
set -eu

LIVE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/voz.prestarecondominios.com.br}"
[ -s "$LIVE/fullchain.pem" ] && [ -s "$LIVE/privkey.pem" ] || { echo "certificado não encontrado em $LIVE" >&2; exit 1; }

install -d -m 755 /etc/asterisk/keys /etc/prestare-voz/tls
install -o asterisk -g asterisk -m 640 "$LIVE/fullchain.pem" /etc/asterisk/keys/voz.crt
install -o asterisk -g asterisk -m 640 "$LIVE/privkey.pem" /etc/asterisk/keys/voz.key
install -o root -g root -m 644 "$LIVE/fullchain.pem" /etc/prestare-voz/tls/fullchain.pem
install -o root -g turnserver -m 640 "$LIVE/privkey.pem" /etc/prestare-voz/tls/privkey.pem

systemctl reload nginx || true
systemctl reload asterisk || true
systemctl restart prestare-voz coturn || true
