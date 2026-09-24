# Agente Local — Click Portaria

Faz a ponte entre a nuvem (AWS) e os dispositivos de controle de acesso
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
[ Condomínio - LAN ]                         [ Nuvem - AWS ]
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
- **URL da API** (ex.: `https://api.clickprestarecondominios.com.br`).
- **Um token** — no portal, **Terminais de Dispositivos** → **"Copiar URL Webhook"**
  em **qualquer** dispositivo e cole (pode colar a URL inteira). Esse único token
  gerencia **todos** os dispositivos do condomínio (modo condomínio).

> O IP/usuário/senha de cada aparelho **não** vão no agente — já ficam na nuvem
> (você cadastra uma vez no portal) e descem automaticamente.

**4. Inicie:** depois de configurado, dê dois cliques no `click-agent.exe` (ou
rode `install-windows.bat` como Administrador para iniciar junto com o Windows).

Em poucos segundos o portal mostra **"Agente conectado"** no card do device.

## Opção B — Via Node (Raspberry Pi, Linux, dev)

Requer Node.js 18+ (o agente não tem dependências npm em runtime — só para
gerar o bundle). Copie a pasta `agent/`, rode `npm run build` (gera
`dist/click-agent.cjs`), `cp .env.example .env`, preencha os mesmos campos
acima e rode `node dist/click-agent.cjs` (ou `npm start`).

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
ExecStart=/usr/bin/node /opt/click-agent/dist/click-agent.cjs
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

## Auto-atualização

O executável (Opção A), **em modo condomínio** (`AGENT_TOKEN`), se atualiza
sozinho: na partida e a cada 6h ele consulta a última versão publicada e, se
houver uma mais nova, baixa (só de um host confiável — github.com e o CDN de
release dele —, com TLS validado de verdade), confere o SHA-256 e troca o
próprio arquivo. Se a versão nova não conseguir completar nem um poll em 3
tentativas seguidas, o agente reverte sozinho para a anterior, e marca essa
versão como recusada (não tenta baixá-la de novo enquanto a nuvem não
publicar outra). Só age rodando como o `.exe` empacotado (Node SEA) — via
`node dist/click-agent.cjs` (Opção B) fica de fora, sem efeito nenhum. O modo
legado por dispositivo (`DEVICE_TOKENS`, sem `AGENT_TOKEN`) também fica de
fora — só o modo condomínio tem esse wiring hoje. Ver `src/core/atualizador.js`
para o protocolo completo.

**Pré-requisito para a troca funcionar de verdade:** a instalação precisa ter
um laço de reinício — `run-agent-service.cmd` com `goto loop` ao lado do exe,
gerado pelo instalador (`install-windows.bat`, ver "Rodar como serviço"
acima). Trocar o arquivo e sair não adianta nada se ninguém sobe a versão
nova em seguida; sem esse laço, o agente detecta a ausência dele e **pula a
troca**, só logando um aviso pra reinstalar pelo portal.

### Publicando uma versão nova

1. Suba `AGENT_VERSION` em `src/versao.js` (formato `AAAA.MM.DD` ou
   `AAAA.MM.DD.N` para mais de um release no mesmo dia).
2. Gere o executável: `npm run build:exe` (dentro de `agent/`) — produz
   `click-agent.exe` e `click-agent.exe.sha256` na pasta `agent/`.
3. Publique o release no GitHub, com a tag `agent-v<versão>` (ex.:
   `agent-v2026.09.24`) e os dois arquivos como assets:
   ```bash
   cd agent
   gh release create agent-v<versao> dist/../click-agent.exe click-agent.exe.sha256 --latest
   ```
   A API (`GET /api/facial/agent/condo/:token/versao`, ver
   `apps/api/.../facial/agent-version.service.ts`) lê o último release desse
   jeito: tag `agent-v<versão>` e os assets `click-agent.exe` +
   `click-agent.exe.sha256` — nomes exatos, senão a API não reconhece o
   release como uma versão publicada (cai em "nenhuma versão disponível").
   Cache de 10 min: um release novo pode levar até esse tempo para os
   agentes verem.

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
