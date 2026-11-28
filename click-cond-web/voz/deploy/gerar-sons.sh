#!/usr/bin/env bash
# Gera as mensagens faladas ao visitante (Amazon Polly, voz Camila, pt-BR) no
# formato .sln do Asterisk (signed linear 16 bits, 8 kHz) — o PCM que o Polly
# devolve já é esse formato, sem conversão — e o "beep" (tom de 1 kHz, 0,2 s).
#
#   bash gerar-sons.sh [pasta]           padrão: /usr/share/asterisk/sounds/prestare
#   bash gerar-sons.sh --s3 [pasta]      também envia para s3://.../deploy/voz/sons/
#
# Precisa de aws-cli com polly:SynthesizeSpeech (ex.: CloudShell) e node.
# O serviço toca como sound:prestare/<nome>; o Asterisk acha o arquivo em
# /usr/share/asterisk/sounds/prestare/<nome>.sln para qualquer idioma.
set -euo pipefail

ENVIAR_S3=0
if [ "${1:-}" = "--s3" ]; then ENVIAR_S3=1; shift; fi
DESTINO="${1:-/usr/share/asterisk/sounds/prestare}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGIAO=sa-east-1
BUCKET=prestare-arquivos-850401152034

declare -A TEXTOS=(
  [apto-nao-encontrado]="Apartamento não encontrado. Confira o número e tente de novo."
  [servico-indisponivel]="O interfone está indisponível no momento."
  [ninguem-atendeu]="Ninguém atendeu. Tente novamente mais tarde."
  [aguarde-para-chamar]="Aguarde um pouco para chamar novamente."
)

mkdir -p "$DESTINO"
for nome in "${!TEXTOS[@]}"; do
  aws polly synthesize-speech --region "$REGIAO" \
    --engine neural --voice-id Camila --language-code pt-BR \
    --output-format pcm --sample-rate 8000 \
    --text "${TEXTOS[$nome]}" "$DESTINO/$nome.sln" >/dev/null
  echo "gerado $DESTINO/$nome.sln"
done
node "$AQUI/tom.mjs" "$DESTINO/beep.sln" 1000 0.2
echo "gerado $DESTINO/beep.sln"

if [ -d /etc/asterisk ] && id asterisk >/dev/null 2>&1; then
  chown -R root:asterisk "$DESTINO" 2>/dev/null || true
  chmod 755 "$DESTINO" && chmod 644 "$DESTINO"/*.sln
fi

if [ "$ENVIAR_S3" = 1 ]; then
  for arq in "$DESTINO"/*.sln; do
    aws s3 cp "$arq" "s3://$BUCKET/deploy/voz/sons/$(basename "$arq")" --region "$REGIAO" --only-show-errors
  done
  echo "enviado para s3://$BUCKET/deploy/voz/sons/"
fi
