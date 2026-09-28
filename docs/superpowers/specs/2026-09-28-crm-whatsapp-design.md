# CRM — Caixa de WhatsApp (Cloud API)

Data: 2026-09-28 · Status: aprovado pelo usuário no chat

## Objetivo

Atender o número comercial **+55 17 99660-8148** (Cloud API, phone id
`1356887267509002`, WABA `1804931620699472`, app `2599967397096582`) de dentro
do CRM, com cada conversa ligada a um lead da aba Marketing e à origem do
anúncio. Um único atendente (o dono) na v1.

## Fora de escopo (v1)

- Mídia (imagem, áudio, documento): gravada como marcador de texto, ex. `[áudio recebido]`.
- Mensagens por template (fora da janela de 24h).
- Vários atendentes, atribuição, respostas rápidas.
- Tempo real por WebSocket (usa polling).

## Arquitetura

### API (NestJS, módulo novo `apps/api/src/app/whatsapp/`)

| Unidade | Papel |
|---|---|
| `whatsapp-segredos` | Reaproveita `MarketingSegredosService` (tipo ampliado): `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` — env ou `crm_config` cifrado. |
| `assinatura.ts` | Função pura: valida `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o app secret, comparação em tempo constante). |
| `whatsapp-webhook.controller` | `GET /api/public/whatsapp/webhook` (handshake `hub.verify_token` → devolve `hub.challenge`); `POST` idem (valida assinatura, responde 200 rápido, processa). |
| `whatsapp-inbound.service` | Interpreta o payload: `messages` → grava mensagem de entrada (idempotente por `wamid`), cria/atualiza conversa, liga ao lead; `statuses` → atualiza status da mensagem de saída. |
| `whatsapp-lead-link.ts` | Regra de junção: conversa nova procura em `crm_leads` um lead `nome LIKE 'Clique no WhatsApp%'`, `whatsapp=''`, criado nos últimos 30 min, sem conversa ligada, mais recente → atualiza `whatsapp` e `nome` (perfil). Sem candidato → cria lead `organico` com o número. |
| `whatsapp-graph.client` | `POST /v25.0/{phone_id}/messages` (texto) e `mark as read`. |
| `whatsapp-crm.controller` (guard `CrmAdminGuard`) | `GET /crm/whatsapp/conversas`, `GET /crm/whatsapp/conversas/:id/mensagens` (marca como lidas), `POST /crm/whatsapp/conversas/:id/mensagens` (enviar; 409 se janela fechada), `GET /crm/whatsapp/nao-lidas`. |

Corpo bruto: `main.ts` usa `json({ limit, verify })` guardando `req.rawBody`
para a validação da assinatura.

### Dados (MySQL, SQL manual antes do deploy)

`crm_whatsapp_conversas`: `id`, `wa_id` (único, só dígitos), `nome_perfil`,
`lead_id` (FK `crm_leads`, SET NULL), `ultima_msg_em`, `ultima_do_cliente_em`,
`nao_lidas`, `criado_em`.

`crm_whatsapp_mensagens`: `id`, `conversa_id` (FK CASCADE), `wamid` (único),
`direcao` (`entrada`/`saida`), `tipo`, `texto` (Text), `status`
(`recebida`/`enviada`/`entregue`/`lida`/`falhou`), `erro` (nullable),
`criado_em`. Índice (`conversa_id`, `criado_em`).

### Regras

- **Janela de 24h:** envio livre permitido só se `agora - ultima_do_cliente_em < 24h`; senão 409 "janela de 24h fechada".
- **Idempotência:** o Meta reenvia webhooks; `wamid` único impede duplicar.
- **Status:** só avança (`enviada` → `entregue` → `lida`); `falhou` grava `erro`.
- **Webhook sempre 200** após assinatura válida (erros de processamento vão para log), para o Meta não desativar o endpoint; assinatura inválida → 401.

### CRM web (Angular, aba nova `whatsapp`)

- Rota `painel/whatsapp`, item de menu com contador de não lidas (polling 30s).
- Duas colunas: lista de conversas (nome/número, trecho da última mensagem, hora, badge de não lidas) e o chat (bolhas entrada/saída, status ✓/✓✓/lida, aviso de janela fechada que bloqueia o campo).
- Polling de 10s na conversa aberta e na lista.
- Link "Ver lead" para a aba Marketing.

## Configuração no Meta (feita por mim via navegador)

1. Usuário do sistema admin no Gerenciador de Negócios, com o app e a WABA atribuídos → token permanente (`whatsapp_business_messaging`, `whatsapp_business_management`).
2. App secret do app `Prestare Mensagens`.
3. Webhook do app: URL `https://api.prestarecondominios.com.br/api/public/whatsapp/webhook`, verify token aleatório, campo `messages` assinado; `POST /{waba}/subscribed_apps`.
4. Segredos cifrados em `crm_config`.

## Virada do site

Só depois do teste ponta a ponta (mensagem real recebida e respondida pelo
CRM): landing `/sobre` passa de `5517992559990` para `5517996608148`.

## Testes

Unitários: assinatura (válida/inválida/ausente), handshake, parser do payload
(texto, mídia → marcador, status), idempotência por `wamid`, junção com o
clique (dentro/fora dos 30 min, já ligado), janela de 24h, envio (sucesso,
erro do Graph → `falhou`). Ponta a ponta manual em produção com o celular do
usuário.
