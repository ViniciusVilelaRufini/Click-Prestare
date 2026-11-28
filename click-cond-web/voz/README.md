# Prestare Voz

Central do "Interfone pelo app": Asterisk 20 (PJSIP + ARI) e coturn numa EC2
(`voz.prestarecondominios.com.br`, i-0bdd877976ff40bf6, 54.21.36.213), mais este
serviço Node 22 que controla as chamadas. Desenho:
`docs/superpowers/specs/2026-11-27-interfone-pelo-app-design.md`; contrato com a
API: `docs/superpowers/plans/2026-11-27-interfone-pelo-app.md`.

## Arquitetura

```
facial (fac-<id>) ──SIP 5060──► Asterisk ──Stasis "prestare"──► serviço (src/)
monitor (mon-<id>) ◄─originate─┘   ▲                              │ HTTPS x-voz-token
app / console ──WebRTC wss:8089────┘ (sip:entrar + X-Prestare-Token)
                                                                  ▼
                                               API /api/interno/interfone/*
```

- `src/contas.js`: a cada 60 s busca as contas na API e gera
  `/etc/asterisk/pjsip_prestare.conf`; só recarrega o `res_pjsip` quando mudou.
- `src/chamada.js`: máquina de estados pura (devolve ações).
- `src/servico.js`: trata os canais do Stasis (`facial`, `entrar`, `monitor`) e
  executa as ações pela ARI (`src/ari.js`).
- `src/token.js`: valida o token de voz (JWT HS256, 120 s) emitido pela API.
- `src/controle.js`: `https://voz.prestarecondominios.com.br/controle` —
  `POST /controle/chamadas/:id/portaria|dtmf|encerrar` (x-voz-token) e
  `GET /controle/saude`.
- `asterisk/`, `coturn/`, `fail2ban/`, `nginx/`: configuração instalada pelo `deploy/instalar.sh`.

O HTTP do Asterisk (ARI e `/ws`) escuta **só em 127.0.0.1:8088**, sem TLS. Para
fora, o nginx termina o TLS na 8089 e repassa só `location = /ws` (WebSocket)
ao Asterisk; `/ari` e qualquer outro caminho dão 404. O `instalar.sh` confere
isso no fim (`/ari` pela 8089 tem de responder 404).
Limitação: atrás do nginx, o Asterisk vê toda conexão WSS vindo de 127.0.0.1, então
o fail2ban (jail `asterisk`) não vê o IP real de quem usa o WebRTC e não o
bloqueia; ele só protege o SIP direto (5060). No WSS a proteção é o token de voz.

Quem atende pode chegar antes da chamada existir no serviço (o INVITE da origem
ainda juntando ICE, ou a API ainda respondendo ao facial): o canal espera até
10 s pelo id antes de ser desligado. No SIGTERM, cada chamada ativa vira
`encerrada falha` na API (teto de 3 s); ao reconectar a ARI, as chamadas cujos
canais sumiram também.

App e console nunca ficam registrados: pedem um token à API e discam
`sip:entrar@voz.prestarecondominios.com.br`. Quem liga (console/app) entra com
`papel:'origem'`; o serviço busca a chamada na API e toca de volta até alguém entrar.

## Variáveis (`/etc/prestare-voz.env`, gravado pelo instalar.sh, 600)

| variável | padrão |
|---|---|
| `VOZ_INTERNAL_TOKEN` (obrigatória) | SSM `/prestare/voz/VOZ_INTERNAL_TOKEN` |
| `VOZ_TOKEN_SECRET` (obrigatória) | SSM `/prestare/voz/VOZ_TOKEN_SECRET` |
| `VOZ_ARI_SENHA` (obrigatória) | SSM `/prestare/voz/VOZ_ARI_SENHA` |
| `VOZ_API_BASE` | `https://api.prestarecondominios.com.br/api` |
| `VOZ_ARI_URL` / `VOZ_ARI_USUARIO` | `http://127.0.0.1:8088` / `prestare` |
| `VOZ_PJSIP_ARQUIVO` | `/etc/asterisk/pjsip_prestare.conf` |
| `VOZ_CONTROLE_PORTA` | `443` |
| `VOZ_CERT_DIR` | `/etc/prestare-voz/tls` (`fullchain.pem`, `privkey.pem`) |

`VOZ_TURN_SECRET` (SSM) só entra no `/etc/turnserver.conf`. Os segredos não
podem ter espaço, `;`, aspas, `$`, `` ` ``, `\` ou `#` (o `preencher.mjs` recusa).

O serviço roda como **root** (`prestare-voz.service`) porque lê a chave TLS
(`root:turnserver 640`) e abre a porta 443; o systemd limita os poderes a
`CAP_NET_BIND_SERVICE`, sistema só-leitura e escrita apenas no
`pjsip_prestare.conf`.

O hook de renovação do certbot fica em
`/etc/letsencrypt/renewal-hooks/deploy/prestare.sh` e é **reescrito pelo
instalar.sh a cada deploy** (`deploy/hook-renovacao.sh`). Ele copia o
certificado para `/etc/asterisk/keys/voz.{crt,key}` (reserva) e
`/etc/prestare-voz/tls/` (nginx e serviço), faz `systemctl reload nginx` e
`reload asterisk`, e reinicia `prestare-voz` e `coturn`. O site padrão do nginx
é removido porque ocuparia a porta 80 da renovação `--standalone`.

## Implantar

Automático: push na `main` mexendo em `click-cond-web/voz/**` dispara
`.github/workflows/deploy-voz.yml` (testes → tgz em
`s3://prestare-arquivos-850401152034/deploy/voz/` → `instalar.sh` por SSM →
`/controle/saude`). Manual: `gh workflow run deploy-voz.yml --ref main`.

O `instalar.sh <sha>` (root, na EC2) lê os segredos do SSM, instala a release em
`/opt/prestare-voz/releases/<sha>` (link `atual`), preenche as configurações,
reinicia o Asterisk **só se a configuração mudou** (derruba chamadas em curso) e
sempre reinicia o `prestare-voz` (chamadas em curso perdem o controle e são
derrubadas como órfãs ao subir).

## Testar

```bash
npm ci && npm test          # node --test, sem Asterisk
```

Na EC2 (SSM Session Manager):

```bash
curl -s https://voz.prestarecondominios.com.br/controle/saude   # {"ok":true,"ari":true}
asterisk -rx "pjsip show transports"                            # udp, tcp, wss
asterisk -rx "pjsip show endpoints"                             # fac-* / mon-* da API
journalctl -u prestare-voz -f
```

**Facial simulado** (sem aparelho): com um facial habilitado na API (ex.: `fac-12`)
e o ramal configurado, rode

```bash
sudo bash /opt/prestare-voz/atual/deploy/simular-facial.sh fac-12 106 [segundos]
```

Ele origina pela ARI um canal Local que entra em `Stasis(prestare,facial,fac-12,106)`
como o facial real; o lado "visitante" fala áudio de teste (`tt-monkeys`) depois
de atendido. Sem vídeo — para vídeo, registre um softphone (Linphone/pjsua) com
a conta e a senha do facial (tela do síndico) e disque o ramal.

Sons: ver `sons/README.md`.
