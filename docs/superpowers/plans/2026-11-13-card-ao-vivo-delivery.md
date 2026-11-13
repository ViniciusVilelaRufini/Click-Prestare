# Card ao vivo do delivery — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O atendimento de delivery vira um card ao vivo (Live Activity no iPhone, notificação fixa no Android) de CHEGOU até ENTREGUE/RECUSADO, com RECUSAR/AUTORIZAR no card.

**Architecture:** O motor do card da portaria (`card-ao-vivo/`) passa a aceitar `origem: 'delivery'`: o núcleo de abrir/atualizar/encerrar fica genérico e recebe o conteúdo pronto; um módulo puro novo monta o conteúdo do delivery a partir do atendimento. `DeliveryService.atualizarStatus` chama o card em vez da notificação solta (que continua para quem não tem card). No iPhone o mesmo `CardPortariaAttributes` desenha o layout de delivery pela `origem`; os botões escolhem a rota pela `origem`.

**Tech Stack:** NestJS + Prisma (MySQL RDS), Jest; Flutter (flutter_local_notifications 22.3.3); Swift/SwiftUI ActivityKit (extensão CardPortaria, compilada só no CI do TestFlight).

**Spec:** `docs/superpowers/specs/2026-11-13-card-ao-vivo-delivery-design.md` (prévia aprovada: `card-preview/delivery.html` no scratchpad, servida em `http://127.0.0.1:5180/delivery.html`).

## Global Constraints

- Push (APNs da Live Activity e push de dados do FCM) ≤ 3900 bytes de JSON (`cabeNoPush`); passou → mesmo push sem `foto`.
- Campos novos do `ContentState` em Swift só **opcionais** (o iOS descarta em silêncio o push que não decodifica).
- Altura do card ≤ 154 pt (orçamento comentado em `TelaBloqueio`); Ilha sempre preta (`Paleta.ilha`).
- Card de delivery só para aparelho com `Users_Devices.card_versao >= 2`; o app novo manda `card_versao: 2`.
- Toca/vibra: abertura (`chegou`), `aguardando` e `retirar`; o resto é silencioso.
- Card de delivery aberto há mais de 2 h (7200 s) sem estado final é encerrado pelo tique.
- Fases do delivery (strings exatas): `chegou`, `aguardando`, `autorizado`, `retirar`, `entregue`, `recusado`. CANCELADA encerra na hora.
- Dismissal: `entregue` 300 s, `recusado` 120 s, CANCELADA 0 s.
- Motivo do RECUSAR pelo card: `'Recusada pelo morador.'` (mesmo texto da tela do app).
- Notificação de hoje (`notificarMorador`, só `Users.fcm_token`) suprimida apenas quando esse token tem card de delivery **aberto e confirmado** (sem `reserva_enviada_em`).
- Nada vai ao TestFlight nem ao `master`/`main` sem ordem do usuário. A migração SQL é aplicada no RDS (CloudShell + `tunel.sh`) e verificada antes de qualquer deploy da API.

## Review Focus

1. Tique de 30 s expira `aguardando` da portaria em 180 s — um card de delivery em `aguardando` nunca pode virar `expirado` por isso.
2. Aparelho com app 1.2.42–1.2.45 (`card_versao` 1) nunca recebe card de delivery; recebe a notificação de hoje.
3. Morador responde pela tela do app (não pelo card): o card vai a `autorizado`/`recusado` com "Você autorizou/recusou" e nenhuma notificação solta é enviada a ele.
4. Foto do entregador grande ou nome longo levando o push acima de 3900 bytes: sai sem foto, não falha.
5. Resposta pelo botão do card quando a portaria já mudou o status (409) ou o pedido não aceita mais resposta (400): o card fecha no aparelho em vez de ficar parado.

Cada item tem teste na tarefa dona (marcados com **[RF n]**); o item 5 no iPhone só é verificável no aparelho.

---

### Task 1: `card_versao` no banco e no registro do aparelho

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma` (model `Users_Devices`, depois de `card_tema`)
- Create: `click-cond-web/prisma/sql/2026-11-13-card-ao-vivo-delivery.sql`
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` (`updateFcmToken`), `mobile-auth.controller.ts` (`update-fcm-token`)
- Test: `click-cond-web/apps/api/src/app/auth/mobile-auth.card-token.spec.ts`

**Interfaces:**
- Produces: coluna `Users_Devices.card_versao Int @default(1) @db.Int`; `updateFcmToken(idUser, fcm, plataforma?, cardTokenInicio?, cardAndroid?, cardTema?, cardVersao?: number)`; corpo HTTP aceita `card_versao`.

- [ ] **Step 1: Teste** `it('grava card_versao 2 do app novo; ausente ou inválido não mexe')`: `updateFcmToken(1,'fcm-x','iOS',undefined,false,undefined,2)` → `create.card_versao === 2` e `update.card_versao === 2`; sem o argumento → `'card_versao' in update === false`; `0`, `100` ou `'2'` (string) → não grava.
- [ ] **Step 2:** `npx jest -c apps/api/jest.config.cts mobile-auth.card-token` → FAIL.
- [ ] **Step 3:** Implementar: aceita inteiro 1–99; controller repassa `body?.card_versao`. SQL idempotente no padrão de `2026-11-13-card-ao-vivo-tema.sql`: `ALTER TABLE Users_Devices ADD COLUMN card_versao INT NOT NULL DEFAULT 1 AFTER card_tema` + `SELECT` de verificação (`ok = 1` quando a coluna existe, `IS_NULLABLE='NO'`, `COLUMN_DEFAULT='1'`). `npx prisma generate --schema prisma/schema.prisma`.
- [ ] **Step 4:** teste PASS; `npx tsc -p apps/api/tsconfig.app.json --noEmit` limpo.
- [ ] **Step 5:** commit `feat(card-ao-vivo): card_versao do aparelho (card de delivery só para o app novo)`.

### Task 2: Conteúdo do card do delivery (módulo puro)

**Files:**
- Create: `click-cond-web/apps/api/src/app/card-ao-vivo/delivery-conteudo.ts`
- Modify: `click-cond-web/apps/api/src/app/card-ao-vivo/conteudo.ts`
- Test: `click-cond-web/apps/api/src/app/card-ao-vivo/delivery-conteudo.spec.ts`, `conteudo.spec.ts`

**Interfaces:**
- Produces (conteudo.ts):
  - `FaseCard` passa a incluir `'chegou' | 'autorizado' | 'retirar' | 'entregue' | 'recusado'`.
  - `ConteudoCard.tipo: string` (era a união Visitante|Prestador; no delivery leva o entregador); novos opcionais `foto?: string`, `motivo?: string | null`.
  - `payloadInicio(c, attrs, agora, alerta?: {titulo, corpo})` — sem `alerta` usa `textoAlerta(c)` como hoje.
  - `payloadAtualizacao(c, agora, alerta?: {titulo, corpo} | null)` — com alerta inclui `alert` e `sound: 'default'`.
  - `export const DELIVERY_MAX_SEG = 7200`.
- Produces (delivery-conteudo.ts):
  - `type StatusDelivery = 'AGENDADA'|'CHEGOU'|'AGUARDANDO_AUTORIZACAO'|'AUTORIZADA'|'RETIRADA_NA_PORTARIA'|'CONCLUIDA'|'CANCELADA'|'RECUSADA'`
  - `interface AtendimentoCard { id: number; status: StatusDelivery; estabelecimento: string|null; chegou_em: Date|null; autorizado_em: Date|null; recusado_em: Date|null; concluido_em: Date|null; motivo: string|null; bloco: string|null; apto: string|null; entregadorNome: string|null; entregadorPlataforma: string|null; fotoEntregador: string|null }`
  - `faseDoStatus(s: StatusDelivery): FaseCard | 'encerrar' | null` — AGENDADA→null; CHEGOU→chegou; AGUARDANDO_AUTORIZACAO→aguardando; AUTORIZADA→autorizado; RETIRADA_NA_PORTARIA→retirar; CONCLUIDA→entregue; RECUSADA→recusado; CANCELADA→'encerrar'.
  - `conteudoDelivery(a: AtendimentoCard, fase: FaseCard, extras: { voceRespondeu: boolean; foto?: string | null }, agoraSeg: number): ConteudoCard`
  - `alertaDelivery(fase: FaseCard, c: ConteudoCard): { titulo: string; corpo: string } | null`
  - `mensagemDelivery(status: StatusDelivery, motivo?: string | null): string` — os textos de hoje de `DeliveryService.notificarMorador`, movidos para cá sem mudar.
  - `dismissalDelivery(fase): number | null` — entregue 300, recusado 120, demais null.

- [ ] **Step 1: Testes** (`delivery-conteudo.spec.ts`):
  - `faseDoStatus` para os 8 status (tabela acima).
  - `conteudoDelivery` com atendimento `{estabelecimento:'Burger King', entregadorNome:'Carlos', entregadorPlataforma:'iFood', bloco:'A', apto:'106', chegou_em: 12:40}` em `chegou` → `nome 'Burger King'`, `tipo 'Carlos · iFood'`, `unidade 'Bloco A · Apto 106'`, `chegouEm` = epoch de chegou_em, `expiraEm = chegouEm + 7200`; sem entregador → `tipo 'Entregador'`; sem estabelecimento → `nome 'Delivery'`.
  - `autorizado` com `autorizado_em` → `horaResposta` = epoch; `voceRespondeu:false` → `pelaPortaria true`; `entregue` → `horaEntrada` = epoch de `concluido_em`; `recusado` → `motivo` copiado e `horaResposta` = epoch de `recusado_em`.
  - `foto` presente em extras → `c.foto` igual; ausente → sem a chave.
  - `alertaDelivery`: `chegou` → `{titulo:'Delivery na portaria', corpo:'Burger King chegou. Acompanhe pelo card.'}`; `aguardando` → `{titulo:'Autorize a entrega', corpo:'A portaria aguarda sua autorização para Burger King.'}`; `retirar` → `{titulo:'Retire na portaria', corpo:'Sua entrega de Burger King está na portaria.'}`; `autorizado`/`entregue`/`recusado` → `null`.
  - `conteudo.spec.ts`: `payloadAtualizacao(c, 1000, {titulo:'T', corpo:'C'})` tem `aps.alert` e `aps.sound`; sem alerta não tem `alert`. `payloadInicio(c, attrs, 1000, {titulo:'T', corpo:'C'})` usa o alerta passado.
- [ ] **Step 2:** `npx jest -c apps/api/jest.config.cts delivery-conteudo conteudo` → FAIL.
- [ ] **Step 3:** Implementar. `stale-date` do início para delivery sai de `c.expiraEm + 30` (já é o comportamento).
- [ ] **Step 4:** PASS + `tsc` limpo (a mudança de `tipo` para `string` não pode quebrar a portaria).
- [ ] **Step 5:** commit `feat(card-ao-vivo): conteúdo do card do delivery`.

### Task 3: Motor do card aceita `origem: 'delivery'`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/card-ao-vivo/card-ao-vivo.service.ts`
- Test: `click-cond-web/apps/api/src/app/card-ao-vivo/card-ao-vivo.delivery.spec.ts` (novo; reaproveita `montarCard` exportado de `card-ao-vivo.service.spec.ts` — `aparelhos` ganham `card_versao`)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `OrigemPedido = 'visitante' | 'visita' | 'delivery'`.
  - `abrirDelivery(a: AtendimentoCard, idUser: number): Promise<void>`
  - `atualizarDelivery(a: AtendimentoCard, idUser: number, opts: { voceRespondeu: boolean }): Promise<{ cobertos: Set<string> }>` — `cobertos` = `fcm_token` dos aparelhos que tinham card de delivery deste atendimento **aberto e confirmado e sem reserva** ANTES da mudança. Sem linha aberta e fase não-terminal → abre (chama `abrirDelivery`) e devolve `cobertos` vazio. Fase `'encerrar'` → encerra.
- Refatoração interna (o implementador escolhe a forma): o corpo de `abrir` vira um núcleo que recebe `{origem,id}`, ids de usuários, conteúdo pronto, `pushComum`, `foto` (atributo, portaria) , `versaoMinima` (portaria 1, delivery 2), alerta e fase inicial; `criarLinha` recebe a fase inicial; `aplicarFase` vira `aplicarConteudo(linhas, conteudoDaLinha, dismissalSeg, permitidas, alerta?)` usado pela portaria e pelo delivery. No delivery a foto vai em `c.foto` (estado) e, no Android, no próprio `conteudo`; se o push passar de 3900 bytes, reenviar `c` sem `foto`.
- Regras que mudam para todos:
  - `confirmar`: reenviar o estado salvo quando `atual.fase_em > atual.created_at` ou `atual.encerrado_em` (antes: `fase !== 'aguardando'`).
  - `verificarReserva`: inclui linhas `origem: 'delivery'` não confirmadas em qualquer fase; o push comum delas é `alertaDelivery(fase, lerConteudo(l)) ?? {titulo:'Delivery', corpo: mensagemDelivery('CHEGOU')}` com dados `{ id_delivery, status }`.
  - `tick`: a expiração de `aguardando` em 180 s ganha `origem: { not: 'delivery' }`; novo passo encerra linhas `origem: 'delivery'` abertas com `created_at` mais antigo que `DELIVERY_MAX_SEG`.

- [ ] **Step 1: Testes** (`card-ao-vivo.delivery.spec.ts`):
  - `abre em chegou: iPhone versao 2 recebe push-to-start com origem delivery, alerta "Delivery na portaria" e content-state fase chegou; Android versao 2 recebe dados com origem delivery`.
  - **[RF 2]** `aparelho com card_versao 1 (ou sem a coluna) recebe a notificação comum com mensagemDelivery('CHEGOU'), sem card`.
  - `atualizarDelivery chegou→aguardando manda update com alerta "Autorize a entrega"; aguardando→autorizado manda update sem alert`.
  - `entregue manda end com dismissal-date = agora + 300; recusado + 120; CANCELADA ('encerrar') end com dismissal 0`.
  - `cobertos contém só o token confirmado sem reserva; aparelho que recebeu a reserva não entra`.
  - **[RF 1]** `tique: card de delivery em aguardando há 10 min continua aguardando; o de visitante na mesma situação vira expirado`.
  - `tique: card de delivery aberto há 2 h 1 min é encerrado`.
  - **[RF 4]** `foto que leva o push acima de 3900 bytes: update vai sem foto` (foto falsa de 3500 caracteres base64 em `fotoEntregador`, com `fotoDoCard` substituída para devolvê-la).
  - `reserva de delivery não confirmado em 10 s: push comum "Delivery na portaria" para aquele aparelho`.
  - `confirmar atrasado depois de mudar de fase reenvia o estado salvo (delivery e portaria)`.
- [ ] **Step 2:** `npx jest -c apps/api/jest.config.cts card-ao-vivo` → os novos FAIL; os antigos continuam PASS.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx jest -c apps/api/jest.config.cts card-ao-vivo portaria-remota facial` PASS + `tsc` limpo.
- [ ] **Step 5:** commit `feat(card-ao-vivo): motor do card aceita delivery`.

### Task 4: `DeliveryService` liga o card

**Files:**
- Modify: `click-cond-web/apps/api/src/app/delivery/delivery.service.ts`, `delivery.module.ts` (importa `CardAoVivoModule`)
- Test: `click-cond-web/apps/api/src/app/delivery/delivery.card-ao-vivo.spec.ts` (novo)

**Interfaces:**
- Consumes: `abrirDelivery`, `atualizarDelivery` (Task 3), `mensagemDelivery` (Task 2).
- Produces: construtor com `@Optional() cardAoVivo?: CardAoVivoService` como último parâmetro; `private atendimentoParaCard(id: number): Promise<AtendimentoCard>` (inclui `apartamento{bloco,apto}` e `entregador{nome,plataforma,foto}`).

- [ ] **Step 1: Testes:**
  - `portaria marca CHEGOU: abre o card do morador que criou o aviso e não manda a notificação solta`.
  - `AGUARDANDO_AUTORIZACAO com card confirmado no Users.fcm_token: atualiza o card e não manda a notificação solta`; `sem card confirmado: manda a notificação solta como hoje`.
  - **[RF 3]** `morador autoriza pela tela do app: atualizarDelivery com voceRespondeu true e nenhuma notificação`.
  - `card lança erro: a notificação de hoje vai assim mesmo e a resposta HTTP não falha`.
  - `sem CardAoVivoService (módulo ausente): comportamento de hoje`.
  - `notificarMorador usa mensagemDelivery (textos iguais aos de hoje)`.
- [ ] **Step 2:** `npx jest -c apps/api/jest.config.cts delivery` → FAIL.
- [ ] **Step 3:** Implementar após a transação de `atualizarStatus`: CHEGOU → `abrirDelivery`; demais → `atualizarDelivery`, depois `notificarMorador` só se `!respostaDoMorador`, o status está na lista de hoje e `Users.fcm_token ∉ cobertos`. Erro do card → log + caminho de hoje.
- [ ] **Step 4:** suíte inteira `npx jest -c apps/api/jest.config.cts --silent` PASS + `tsc` limpo.
- [ ] **Step 5:** commit `feat(delivery): atendimento acompanha pelo card ao vivo`.

### Task 5: iPhone desenha o delivery e responde pela rota certa

**Files:**
- Modify: `click-cond-app/click-cond-app/ios/CardPortaria/CardPortariaAttributes.swift`, `CardPortariaWidget.swift`, `CardVisual.swift`, `CardIntents.swift`

**Interfaces:**
- Consumes: content-state e atributos da Task 2/3 (`origem == "delivery"`, `ContentState.foto`, `ContentState.motivo`).
- Produces: `NegarCardIntent`/`AutorizarCardIntent` com `@Parameter origem: String` (init com padrão `"visitante"`); `CardApi.enviar(_ metodo: String, _ caminho: String, corpo:)`.

- [ ] **Step 1:** `ContentState`: `var foto: String?`, `var motivo: String?`.
- [ ] **Step 2:** Visual pela prévia aprovada (`delivery.html`): cabeçalho "Delivery"; `InfoFase` com `chegou`/`retirar` "Na portaria" (marca), `autorizado` "Autorizado" (ok), `entregue` "Entregue" (ok), `recusado` "Recusado" (perigo); `Etapas(nomes:feitas:)` (portaria `["Pedido","Autorizado","Entrou"]`; delivery `["Chegou","Autorizado","Entregue"]` ou, em `retirar`, `["Chegou","Na portaria","Retirado"]`; feitas: chegou 1, autorizado/retirar 2, entregue 3); número à direita no delivery: `chegou`/`aguardando` → `Text(timerInterval: dataChegada...dataChegada+7200, countsDown: false)` com rótulo "Na portaria", `autorizado` hora da resposta "Autorizado", `retirar` hora da chegada "Aguardando você", `entregue` `horaEntrada` "Entregue", `recusado` hora da resposta "Recusado"; ilha compacta conta para cima em `chegou`/`aguardando`; `aguardando` mostra só os botões (sem `BarraTempo`); linhas de status da prévia ("Entregador chegou à portaria.", "Você autorizou. A caminho da sua unidade." / "Autorizado pela portaria. A caminho da sua unidade.", "Sua entrega está na portaria. Retire quando puder.", "Entregue às HH:mm.", "Você recusou a entrega." / "Recusado pela portaria." + motivo quando houver); avatar usa `attributes.foto ?? estado.foto`; `estadoVisivel` só troca para `expirado` quando a origem não é delivery. Conferir o orçamento de 154 pt.
- [ ] **Step 3:** Botões: rótulo "Recusar" no delivery; intents passam `origem`; `perform` no delivery faz `PATCH /delivery/:idPedido` com `{"status":"AUTORIZADA"}` ou `{"status":"RECUSADA","motivo":"Recusada pelo morador."}` e atualização local `autorizado`/`recusado` (recusado encerra com 120 s, como negado). **[RF 5]** erro HTTP 400 **ou 409** → `CardLocal.encerrar`.
- [ ] **Step 4:** Sem Mac: revisão de leitura das assinaturas Swift (tipos opcionais, `Text(timerInterval:)` com faixa válida) — a compilação real é o próximo build do TestFlight, só com ordem do usuário.
- [ ] **Step 5:** commit `feat(app-ios): card do delivery no iPhone`.

### Task 6: Android e app Flutter

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/services/card_ao_vivo/textos_card.dart`, `card_android.dart`, `lib/services/firebase_service.dart`, `lib/controllers/controller_delivery.dart`
- Test: `click-cond-app/click-cond-app/test/card_ao_vivo/textos_card_test.dart`

**Interfaces:**
- Produces: `textosCard(Map conteudo, {String origem = 'visitante'})`; `apiResponderDeliveryPorId(int id, {required bool autorizar}) → Future<DeliveryResult>` (mesma chamada de `apiResponderDelivery`, sem exigir o modelo); `CardAndroid.aoAutorizarPelaNotificacao` passa a `void Function(int idPedido, String origem)`.

- [ ] **Step 1: Testes** em `textos_card_test.dart`: delivery `chegou` → título `'Burger King · na portaria'`, corpo `'Carlos · iFood · Bloco A · Apto 106'`, `emAndamento true`, `comBotoes false`; `aguardando` → `comBotoes true`, corpo contém `'aguarda sua autorização'`; `retirar` → título `'Burger King · retire na portaria'`; `entregue` → `emAndamento false`; `recusado` com motivo → corpo contém o motivo; portaria sem `origem` continua igual (testes atuais intactos).
- [ ] **Step 2:** `flutter test test/card_ao_vivo` → FAIL.
- [ ] **Step 3:** Implementar:
  - Teste extra em `textos_card_test.dart` não cobre a confirmação; ela é coberta na revisão da Task 7 (função `exibir` com `fase: 'chegou'` chama `_confirmar`).
  - `card_android.dart`: `exibir` lê a foto de `data['foto']` ou `conteudo['foto']`; no delivery: cronômetro **para cima** desde `chegouEm` em `chegou`/`aguardando` (`chronometerCountDown: false`), `onlyAlertOnce` falso em `chegou`/`aguardando`/`retirar`, duração 2 h nas fases abertas, 5 min `entregue`, 2 min `recusado`; botões "RECUSAR"/"AUTORIZAR"; payload da notificação guarda `origem`; **confirma o card** (`/card-ao-vivo/confirmar`) também quando o delivery abre em `chegou` (hoje só confirma em `aguardando` — sem isso todo card de delivery receberia a reserva em 10 s).
  - `respostaCardSegundoPlano`: origem `delivery` → `apiResponderDeliveryPorId(id, autorizar:false)` e mostra `recusado`.
  - `firebase_service.dart`: `_autorizarPelaNotificacao(int id, String origem)` → delivery usa `apiResponderDeliveryPorId(..., autorizar:true)`; `onMessage` de `card_portaria` com origem `delivery` só mostra a notificação (sem o diálogo de visitante); registro do aparelho manda `'card_versao': 2`.
- [ ] **Step 4:** `flutter analyze lib/services lib/controllers/controller_delivery.dart` limpo; `flutter test` inteiro PASS.
- [ ] **Step 5:** versão `1.2.46+100` no `pubspec.yaml`; commit `feat(app): card do delivery no Android e versão do card no registro`.

### Task 7: Verificação final e banco (sem publicar)

- [ ] **Step 1:** API: `npx jest -c apps/api/jest.config.cts --silent` e `tsc` limpos; app: `flutter test`, `flutter analyze` dos arquivos tocados e `flutter build apk --debug` OK.
- [ ] **Step 2:** Aplicar `2026-11-13-card-ao-vivo-delivery.sql` no RDS pelo CloudShell (`source ~/tunel.sh && mysql_prestare < arquivo`), conferir `ok = 1`.
- [ ] **Step 3:** Revisão de branch inteira por um revisor novo (`superpowers:requesting-code-review`), corrigir o que ele achar.
- [ ] **Step 4:** Push só do branch `feat/card-ao-vivo-portaria`; relatório ao usuário com o que falta publicar (API master+main, TestFlight 1.2.46) — **sem** publicar.
