#!/bin/sh
# Rota padrão (internet) com MTU 1400. O Asterisk repassa o vídeo do facial
# sem reempacotar: pacotes de ~1450 bytes + SRTP/extensões viram ~1500 e não
# passam em links PPPoE (limite ~1480) nem em muitas redes móveis; o provedor
# não avisa por ICMP, então o sistema nunca aprende o limite. Com MTU 1400 na
# rota, o kernel fragmenta esses pacotes e o app remonta. Idempotente: roda no
# boot e a cada 5 min (renovação do DHCP recria a rota sem o MTU).
set -eu
MTU=1400
R=$(ip route show default | head -1)
[ -n "$R" ] || exit 0
case "$R" in
  *" mtu $MTU"*) exit 0 ;;
esac
# shellcheck disable=SC2086
ip route replace $(echo "$R" | sed -E 's/ mtu (lock )?[0-9]+//') mtu $MTU
logger -t prestare-rota-mtu "rota padrão com mtu $MTU"
