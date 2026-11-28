# Sons do interfone

Mensagens tocadas ao visitante no facial (`sound:prestare/<nome>`), em
`/usr/share/asterisk/sounds/prestare/<nome>.sln` (signed linear 16 bits, 8 kHz):

| nome | texto |
|---|---|
| `apto-nao-encontrado` | Apartamento não encontrado. Confira o número e tente de novo. |
| `servico-indisponivel` | O interfone está indisponível no momento. |
| `ninguem-atendeu` | Ninguém atendeu. Tente novamente mais tarde. |
| `aguarde-para-chamar` | Aguarde um pouco para chamar novamente. |
| `beep` | tom de 1 kHz, 0,2 s (aviso aos 2:30 de conversa) |

Os arquivos não ficam no repositório. Para gerar de novo (Amazon Polly, voz
Camila neural; precisa de `polly:SynthesizeSpeech`, por exemplo no CloudShell):

```bash
bash deploy/gerar-sons.sh ./sons-geradas          # só gera
bash deploy/gerar-sons.sh --s3 ./sons-geradas     # gera e envia a s3://prestare-arquivos-850401152034/deploy/voz/sons/
```

Na EC2, copie os `.sln` para `/usr/share/asterisk/sounds/prestare/` (dono
`root:asterisk`, 644). O `instalar.sh` só avisa se algum estiver faltando.
Para ouvir: `asterisk -rx "core show file formats"` deve listar `sln`; um
`.sln` vira wav com `sox -t raw -r 8000 -e signed -b 16 -c 1 x.sln x.wav`.
