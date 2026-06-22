# Agente Local — Click Portaria

Faz a ponte entre a nuvem (Railway) e os dispositivos de controle de acesso
(facial, catraca, botoeira, leitores) que ficam na **rede local do condomínio**.

## Por que isso existe

O backend roda na nuvem. Os aparelhos ficam na LAN com IP privado
(`192.168.x.x`), que **não é acessível pela internet**. A nuvem não consegue
abrir conexão direta até o aparelho.

O agente resolve isso conectando **para fora**: ele faz polling da nuvem,
recebe comandos ("abra a porta", "cadastre este rosto", "ping"), executa no
aparelho da LAN e devolve o resultado. Como o tráfego é **só de saída**, não é
preciso liberar nenhuma porta no roteador do condomínio.

```
[ Condomínio - LAN ]                         [ Nuvem - Railway ]
  Facial / Catraca / Botoeira                       API
        ▲                                            ▲
        │ http LAN                                   │ HTTPS (saída)
        │                                            │
     ┌──┴───────────  Agente Local  ─────poll───────►┘
     │  (Raspberry Pi / mini PC sempre ligado)
```

## Requisitos

- Node.js 18 ou superior (sem dependências npm — só módulos nativos).
- Máquina sempre-ligada na mesma rede dos aparelhos (Raspberry Pi, mini PC,
  NUC, etc.).

## Instalação

1. Copie a pasta `agent/` para a máquina do condomínio.
2. Crie o arquivo de configuração:
   ```bash
   cp .env.example .env
   ```
3. Edite o `.env`:
   - `API_URL` — endereço da API na nuvem (ex.: `https://sua-api.up.railway.app`).
   - `DEVICE_TOKENS` — token de cada device que este agente gerencia, separados
     por vírgula. Pegue no portal web: em **Terminais de Dispositivos**, botão
     **"Copiar URL Webhook"** — o token é o trecho final da URL
     (`.../api/facial/webhook/<TOKEN>`).
4. Rode:
   ```bash
   node index.js
   ```

Pronto. Em poucos segundos o portal deve mostrar **"Agente conectado"** no card
do device, e os botões **Testar Conexão** / **Acionar Abertura** passam a
funcionar de verdade.

## Rodar como serviço (recomendado)

Para iniciar junto com a máquina e reiniciar sozinho:

### Linux (systemd)

`/etc/systemd/system/click-agent.service`:

```ini
[Unit]
Description=Click Portaria - Agente Local
After=network-online.target

[Service]
WorkingDirectory=/opt/click-agent
ExecStart=/usr/bin/node /opt/click-agent/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now click-agent
journalctl -u click-agent -f   # acompanhar logs
```

### Windows

Use o Agendador de Tarefas (gatilho "Ao iniciar o sistema") ou
[nssm](https://nssm.cc/) apontando para `node index.js`.

## Como funciona o webhook (eventos do aparelho → nuvem)

O acionamento (nuvem → aparelho) passa pelo agente. Já os **eventos** que o
aparelho gera (rosto reconhecido, tag lida) continuam indo **direto do aparelho
para a nuvem** via webhook — configure a URL do webhook no próprio aparelho
(a mesma URL do botão "Copiar URL Webhook"). Isso só exige que o aparelho tenha
internet de saída, o que normalmente já existe.

## Fabricantes — status de validação

Endpoints validados contra a documentação pública dos fabricantes (jun/2026).
Validação contra documentação ≠ teste em hardware — confirme com o aparelho
físico no piloto.

| Fabricante | Comando via HTTP | Observação |
|---|---|---|
| **control_id** | ✅ validado | REST com sessão (`/login.fcgi`, `/execute_actions.fcgi`, `/user_set_image.fcgi`). Recomendado. |
| **hikvision** | ✅ validado | ISAPI (`/ISAPI/AccessControl/RemoteControl/door/1`) com **Digest auth** (automático). |
| **genérico** | ✅ | `POST /open_door` e `/persons` — para botoeiras/relés HTTP comuns. |
| **intelbras** | ⚠️ não validado | API de comando fica atrás do suporte técnico. O **webhook (evento → nuvem) funciona**; só o acionamento/cadastro via HTTP é incerto. |
| **zkteco** | ❌ não é HTTP | Usa TCP/UDP 4370 (PULL/PUSH SDK). |
| **topdata** | ❌ não é HTTP | Usa TCP 3570 (SDK Inner). |
| **henry** | ❌ não é HTTP | Protocolo proprietário (SDK Henry). |

Para os fabricantes **❌**, o agente retorna um erro claro em vez de fingir
sucesso. Acione-os por uma **botoeira/relé HTTP genérico** acoplado, ou
implemente um bridge SDK (fora do escopo deste agente).

> ⚠️ A mesma lógica existe no backend (`facial-device-client.service.ts`, modo
> direto) — ao ajustar um fabricante, atualize os dois.
