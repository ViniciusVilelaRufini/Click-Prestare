# Confirmação de reserva 30 minutos antes

Push ao morador 30 min antes da reserva pedindo confirmação de uso; sem
confirmação, cancelamento automático **apenas** nas áreas em que o síndico
ligar a política.

## ⛔ Bloqueio de deploy

A migração está **incompleta**. Hoje existe em produção apenas
`Areas_Sociais_Agendamentos.confirmada_em`. Faltam:

```sql
ALTER TABLE Areas_Sociais_Agendamentos ADD COLUMN lembrete_enviado_em DATETIME NULL, ALGORITHM=INSTANT;
ALTER TABLE Areas_Sociais           ADD COLUMN exige_confirmacao TINYINT NOT NULL DEFAULT 0, ALGORITHM=INSTANT;
```

O Prisma seleciona todos os campos escalares do modelo por padrão, então
**subir este código antes das colunas existirem quebra toda consulta de
agendamentos e de áreas sociais**. Nada aqui vai para a master antes de o
controller aplicar e verificar as duas colunas. O banco estava degradado
(commits pendurados em `waiting for handler commit`, Railway relatando
"upstream GCP issues") quando a migração foi interrompida.

## Contexto

- API: `click-cond-web/apps/api/src/app/areas-sociais/` e `.../facial/`.
- App: `click-cond-app/click-cond-app/lib/pages/shared/areas sociais/` e
  `lib/services/firebase_service.dart`.
- Push já existe: `updateStatusAgendamento` envia via
  `this.notifications.sendPushNotification(token, title, body, data)`.
- O app já sabe abrir diálogo a partir de push: o tipo `autorizacao_visitante`
  faz exatamente isso em `firebase_service.dart` — este é o padrão a seguir.
- Ticks já existem no facial (`tickReservasAreas`, a cada 10 min) — o novo tick
  segue o mesmo mecanismo de agendamento.

## Global Constraints

- Escopo por tenant não muda: tudo por `this.tenant.assert*` com o JWT.
- Respostas só GANHAM campos; campos novos de requisição são opcionais (há app
  publicado em produção).
- Nunca `new Date()` cru para "agora"/"hoje" — usar `agoraNoFusoDoCondominio()`
  / `TIMEZONE_CONDOMINIO` (Railway em UTC, usuários em UTC−3).
- Não perturbar: transação da manutenção com facial/push fora dela,
  `combineDateTime`/`colideComJanela`, status `cancelado`, validação de
  `convidados`, contagem do limite mensal.
- Testes: `npx nx test api --testPathPatterns=areas-sociais` em `click-cond-web`.

---

## Task 1 — Backend: lembrete, confirmação e cancelamento opt-in

**Campos** (já no `schema.prisma`, aplicados ao banco pelo controller):
`confirmada_em DateTime?`, `lembrete_enviado_em DateTime?` em
`Areas_Sociais_Agendamentos`; `exige_confirmacao Int @default(0)` em
`Areas_Sociais`.

**Tick** (`tickConfirmacaoReservas`, a cada 5 min, ao lado dos ticks existentes):

1. **Lembrete.** Reservas `aprovado` cujo início cai na janela
   [agora+25min, agora+35min], com `lembrete_enviado_em IS NULL`: envia push
   `confirmacao_reserva` com `id_agendamento`, e grava `lembrete_enviado_em`
   **apenas quando o envio deu certo**. A janela é maior que o intervalo do
   tick de propósito — com janela de 5 min, um atraso de execução pula a
   reserva para sempre.
2. **Cancelamento.** Reservas `aprovado`, de áreas com `exige_confirmacao = 1`,
   cujo início já passou, com `confirmada_em IS NULL` **e**
   `lembrete_enviado_em IS NOT NULL`: marca `cancelado`, revoga o facial e
   avisa por push, reusando `notificarCancelamentosPorManutencao` como
   referência de padrão (facial e push fora de transação).

   **A condição `lembrete_enviado_em IS NOT NULL` é obrigatória.** Morador sem
   `fcm_token`, ou cujo push falhou, nunca teve como confirmar — cancelar a
   reserva dele seria puni-lo por uma falha nossa.

**Endpoint** `POST /areas-sociais/agendamento/confirmar` `{ id }`: grava
`confirmada_em` com o horário no fuso do condomínio. Só o dono da reserva
(validado pelo JWT, mesmo padrão de `removeAgendamento`); confirmar duas vezes
é idempotente. "Não vou usar" reaproveita `agendamento/remove`, que já existe.

**Leitura**: `confirmada_em` e `exige_confirmacao` passam a ser devolvidos nos
endpoints que já devolvem a reserva e a área.

**Testes**: janela do lembrete inclui as bordas e ignora quem já recebeu;
push falhado não grava `lembrete_enviado_em`; cancelamento só em área opt-in;
reserva sem lembrete enviado NÃO é cancelada; confirmada não é cancelada;
confirmar de outro usuário é negado; dupla confirmação não duplica.

---

## Task 2 — App: diálogo de confirmação e selo

- `firebase_service.dart`: tratar o tipo `confirmacao_reserva` abrindo diálogo
  "Vai usar a área?" com **Confirmar** e **Não vou usar**, no mesmo molde do
  `autorizacao_visitante`. Notificação tocada com o app fechado abre a mesma
  tela.
- Meus agendamentos: selo "Confirmada" / "Aguardando confirmação"; em área com
  `exige_confirmacao`, o texto avisa que a reserva cai se não confirmar.
- Cadastro da área (`new_area_social.dart`) e portaria-web: checkbox
  "Exigir confirmação 30 min antes", explicando que sem confirmação a reserva
  é cancelada e o horário liberado.

**Testes**: `flutter analyze` nos arquivos tocados; validação manual quando o
emulador voltar a falar com produção.
