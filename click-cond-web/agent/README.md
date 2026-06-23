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

- Máquina sempre-ligada na mesma rede dos aparelhos. Pode ser o **PC da
  portaria**, ou um mini PC / Raspberry Pi.

Há dois jeitos de instalar. **A opção A (executável) é a recomendada** — não
precisa instalar nada na máquina da portaria.

## Opção A — Executável (.exe), sem instalar Node ⭐

O executável embute o próprio Node: é só copiar e rodar.

**1. Gere o executável** (uma vez, em qualquer máquina com Node 20+):
```bash
cd click-cond-web/agent
npm run build:exe        # gera click-agent.exe (Windows) / click-agent (Linux/macOS)
```

**2. Na máquina da portaria**, crie uma pasta (ex.: `C:\ClickAgente`) e copie:
- `click-agent.exe`
- `.env` (copie de `.env.example` e preencha — veja abaixo)
- `install-windows.bat` (opcional, para iniciar com o Windows)

**3. Configure (só 2 valores).** Você **não** precisa editar arquivo: rode o
`click-agent.exe` por uma **janela de terminal** uma vez e ele pergunta e salva
o `.env` sozinho. Ele pede:
- **URL da API** (ex.: `https://sua-api.up.railway.app`).
- **Um token** — no portal, **Terminais de Dispositivos** → **"Copiar URL Webhook"**
  em **qualquer** dispositivo e cole (pode colar a URL inteira). Esse único token
  gerencia **todos** os dispositivos do condomínio (modo condomínio).

> O IP/usuário/senha de cada aparelho **não** vão no agente — já ficam na nuvem
> (você cadastra uma vez no portal) e descem automaticamente.

**4. Inicie:** depois de configurado, dê dois cliques no `click-agent.exe` (ou
rode `install-windows.bat` como Administrador para iniciar junto com o Windows).

Em poucos segundos o portal mostra **"Agente conectado"** no card do device.

## Opção B — Via Node (Raspberry Pi, Linux, dev)

Requer Node.js 18+ (o agente não tem dependências npm). Copie a pasta `agent/`,
`cp .env.example .env`, preencha os mesmos campos acima e rode `node index.js`.

## Rodar como serviço (iniciar com a máquina)

### Windows (executável)

Rode `install-windows.bat` **como Administrador**, na mesma pasta do
`click-agent.exe`. Ele registra uma tarefa que sobe o agente no boot.
Para remover: `schtasks /Delete /TN ClickPortariaAgent /F`.

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
