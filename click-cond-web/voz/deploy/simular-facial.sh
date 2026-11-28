#!/usr/bin/env bash
# Simula um facial já cadastrado discando um ramal, sem aparelho (Task I3).
# Rodar NA EC2, como root (sudo), por exemplo pelo SSM Session Manager:
#
#   sudo bash /opt/prestare-voz/atual/deploy/simular-facial.sh <conta> <ramal> [segundos]
#   sudo bash /opt/prestare-voz/atual/deploy/simular-facial.sh fac-12 106
#
# Cria um canal Local: a ponta ";2" entra em [prestare-facial-teste], que chama
# Stasis(prestare,facial,<conta>,<ramal>) exatamente como um facial registrado;
# a ponta ";1" faz o papel do visitante em [prestare-visitante-teste] e, depois
# de atendida, fala sem parar (tt-monkeys). Sem vídeo: para vídeo use um
# softphone (Linphone/pjsua) registrado como a conta do facial.
#
# A originação é pela ARI (127.0.0.1:8088) porque o "channel originate" do CLI
# desiste em 30 s — menos que o toque do apartamento + a transferência para a portaria.
set -euo pipefail

CONTA="${1:?uso: simular-facial.sh <conta fac-ID> <ramal> [segundos]}"
RAMAL="${2:?uso: simular-facial.sh <conta fac-ID> <ramal> [segundos]}"
SEGUNDOS="${3:-180}"

[[ "$CONTA" =~ ^fac-[0-9]+$ ]] || { echo "conta inválida: $CONTA (esperado fac-<id>)" >&2; exit 1; }
[[ "$RAMAL" =~ ^[0-9]{1,10}$ ]] || { echo "ramal inválido: $RAMAL" >&2; exit 1; }
[[ "$SEGUNDOS" =~ ^[0-9]{1,4}$ ]] || { echo "segundos inválido: $SEGUNDOS" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . /etc/prestare-voz.env; set +a

asterisk -rx "dialplan set global PRESTARE_CONTA_TESTE $CONTA" >/dev/null

echo "Chamando o ramal $RAMAL como $CONTA (toca até ${SEGUNDOS}s)..."
# A credencial vai ao curl pela entrada padrão (--config -), nunca no argv
# (que apareceria no ps). printf é embutido do bash: também não vira processo.
# Os segredos não têm aspas nem barra invertida (o preencher.mjs recusa).
printf 'user = "%s:%s"\n' "${VOZ_ARI_USUARIO:-prestare}" "${VOZ_ARI_SENHA}" | \
curl --config - -fsS -G -X POST \
  "${VOZ_ARI_URL:-http://127.0.0.1:8088}/ari/channels" \
  --data-urlencode "endpoint=Local/${RAMAL}@prestare-facial-teste/n" \
  --data-urlencode "context=prestare-visitante-teste" \
  --data-urlencode "extension=s" \
  --data-urlencode "priority=1" \
  --data-urlencode "timeout=${SEGUNDOS}" \
  --data-urlencode "callerId=Facial simulado <${CONTA}>" \
  -o /dev/null -w "ARI respondeu %{http_code}\n"

echo "Acompanhe: journalctl -u prestare-voz -f   |   asterisk -rx 'core show channels'"
echo "Encerrar à força: asterisk -rx 'channel request hangup all'"
