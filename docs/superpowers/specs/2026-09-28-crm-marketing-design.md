# CRM — aba Marketing (leads do site + Google Ads + OpenAI Ads)

Data: 2026-09-28 · Status: aprovado em conversa

## Objetivo

Ver no CRM (`apps/crm-web`) quanto as campanhas custam, quantos pedidos de
orçamento geram e quantos viram contrato — e acompanhar cada lead até o
fechamento. Hoje o formulário da landing `/sobre` só abre o WhatsApp; nada é
gravado.

## Decisões

- Leads do site gravados pela nossa API em tempo real.
- Google Ads via **Google Ads Script** (roda dentro da conta 999-675-8337) que
  envia os números 1x/dia. A API oficial exige conta MCC + developer token; a
  criação da MCC foi bloqueada pelo Google ("limite de criação"). O script não
  precisa de aprovação. Troca futura para a API oficial não muda a tela.
- OpenAI Ads via API oficial (`api.ads.openai.com`, chave criada em Ads Manager
  → Configurações), consultada pelo backend de hora em hora.
- Leads com status (opção B): novo → em_contato → proposta → fechado | perdido,
  mais observação. Sem conversão automática em cliente.

## Dados (Prisma, `prisma/schema.prisma`)

### `Crm_Leads` (`crm_leads`)
| campo | tipo | nota |
|---|---|---|
| id | Int PK autoincrement | |
| nome | String(120) | |
| condominio | String(160) | |
| unidades | String(60) | texto livre ("59 apartamentos") |
| whatsapp | String(20) | só dígitos |
| origem | enum `google` \| `openai` \| `instagram` \| `organico` | |
| gclid, oppref | String? (255) | |
| utm_source, utm_medium, utm_campaign | String? (120) | |
| pagina | String? (255) | path de onde veio |
| status | enum `novo` \| `em_contato` \| `proposta` \| `fechado` \| `perdido` | default `novo` |
| observacao | Text? | |
| status_em | DateTime? | última troca de status |
| criado_em | DateTime default now | index |

### `Crm_Anuncios_Diario` (`crm_anuncios_diario`)
| campo | tipo | nota |
|---|---|---|
| id | Int PK | |
| plataforma | enum `google` \| `openai` | |
| campanha_id | String(64) | |
| campanha_nome | String(200) | |
| dia | Date | |
| impressoes, cliques | Int | |
| gasto | Decimal(12,2) | BRL |
| conversoes | Decimal(10,2) | |
| atualizado_em | DateTime @updatedAt | |
| unique | (plataforma, campanha_id, dia) | upsert |

Migração: SQL aplicado direto no banco de produção antes do push (padrão do
projeto), mais `prisma generate`.

## Backend (`apps/api`, NestJS)

Módulo novo `marketing` dentro de `crm/` (ou `apps/api/src/app/marketing/`):

- `POST /public/leads` — público (`@Public`), throttle ~5/min por IP. Valida
  nome/condomínio/whatsapp/unidades (tamanhos, whatsapp 10–13 dígitos). Deriva
  `origem`: gclid→google, oppref→openai, utm_source=instagram→instagram, senão
  organico. Responde 204.
- `POST /public/ads/google` — público, exige header `X-Ingest-Token` igual a
  `ADS_INGEST_TOKEN` (comparação constante). Corpo: `{ rows: [{campanha_id,
  campanha_nome, dia, impressoes, cliques, gasto, conversoes}] }`. Upsert.
- Job OpenAI: `onModuleInit` + `setInterval` 1h (padrão dos outros jobs, flag
  "rodando"). Lê últimos 7 dias em `GET /v1/ad_account/insights`
  (aggregation_level=campaign, time_granularity=daily, fields impressions,
  clicks, spend) e `POST /v1/conversions/insights`. Upsert. Sem
  `OPENAI_ADS_API_KEY` → job não roda (log de aviso).
- `GET /crm/marketing/resumo?de&ate` (CrmAdminGuard) — KPIs, por canal, série
  diária, frescor de cada fonte.
- `GET /crm/marketing/leads?status&origem&de&ate` (CrmAdminGuard).
- `PATCH /crm/marketing/leads/:id` (CrmAdminGuard) — status/observação.

Env novos (Elastic Beanstalk): `ADS_INGEST_TOKEN`, `OPENAI_ADS_API_KEY`.

## Landing (`apps/portaria-web/public/sobre/index.html`)

- Ao carregar: lê gclid/oppref/utm_* da URL e guarda em `sessionStorage`.
- Em `enviar`: `navigator.sendBeacon(API/public/leads, json)` antes de abrir o
  WhatsApp. Falha da API não bloqueia o WhatsApp.

## Google Ads Script

Arquivo versionado em `docs/marketing/google-ads-script.js`. Usa `AdsApp.report`
(campaign, últimos 7 dias, segmentado por data) e `UrlFetchApp.fetch` com o
token. Instalado manualmente em Ferramentas → Scripts, agendado diariamente.

## CRM (`apps/crm-web`)

Nova aba `marketing` (rota filha de `painel`, item em `navItens`):
- Filtro de período (7d, 30d padrão, mês atual, personalizado).
- KPIs: Investimento, Leads, Custo por lead, Contratos fechados (+ custo por
  contrato).
- Tabela por canal: impressões, cliques, CTR, gasto, leads (da nossa tabela),
  custo/lead, fechados.
- Gráfico diário: gasto e leads.
- Lista de leads com filtros, selo de origem, botão WhatsApp; painel lateral
  para status e observação.
- Rodapé com frescor de cada fonte; aviso se > 36 h.

## Erros

- Landing: API fora → WhatsApp abre igual; lead perdido só no banco.
- Script/Job: falha registrada em log; dados antigos continuam; aviso de
  frescor no CRM.
- Ingest com token errado → 401.

## Testes

- Unit: derivação de origem, validação do lead, upsert idempotente, cálculo
  dos KPIs (custo por lead com zero leads → null).
- E2E manual: envio na landing aparece no CRM; POST do script com token
  certo/errado; job OpenAI com chave real.

## Fora de escopo

Converter lead em cliente; API oficial do Google Ads; notificação de lead
novo.
