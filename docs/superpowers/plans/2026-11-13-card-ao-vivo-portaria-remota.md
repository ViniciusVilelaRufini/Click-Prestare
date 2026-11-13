# Card ao vivo da portaria remota — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O pedido de autorização de visitante vira um card ao vivo (Live Activity no iPhone, notificação fixa no Android) com NEGAR/AUTORIZAR, atualizado pelo servidor até o visitante entrar.

**Architecture:** O NestJS ganha o módulo `card-ao-vivo` (tabela `Cards_Ao_Vivo`, cliente APNs HTTP/2, envio por FCM de dados, tique de expiração e reserva automática) chamado pelos pontos do fluxo em `VisitantesService` e `FacialService`. O app Flutter ganha a notificação fixa Android e um canal com a ponte Swift; o iOS ganha a extensão `CardPortaria` (SwiftUI/ActivityKit) e intents, com o alvo criado no CI por script.

**Tech Stack:** NestJS + Prisma (MySQL), `node:http2` + `node:crypto` (ES256), firebase-admin; Flutter 3.41, firebase_messaging, flutter_local_notifications; Swift/SwiftUI/ActivityKit/AppIntents (iOS 17); fastlane + match + xcodeproj (Ruby).

**Spec:** `docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota-design.md`

## Global Constraints

- Visual Prestare Dark: fundo `#000`, superfície `#141414`, divisor `#242424`, borda `#666`, texto `#FFFFFF`/`#A3A3A3`/`#8A8A8A`; cantos retos em botões e tags; Barlow Condensed 600 MAIÚSCULO espaçado (rótulos/botões), Barlow 400/500 (conteúdo), Barlow Condensed 300 (contagem); cor só em ponto de 6px/texto curto: `#FFC83D` aguardando, `#5EC28A` liberado/entrou, `#FF6B6B` negado, `#666666` expirado.
- Janela de resposta 3 min (a partir de `auth_solicitado_em`); LIBERADO espera 10 min (`AUTORIZACAO_EXPIRACAO_MS`); ENTROU some após 5 min; NEGADO/EXPIRADO/respondido por outro somem após 2 min.
- Reserva automática: sem confirmação do aparelho em 10 s → push comum de hoje para aquele aparelho.
- NEGAR sem desbloqueio; AUTORIZAR exige desbloqueio (iOS `.requiresAuthentication`; Android abre o app).
- Primeira resposta vale; a segunda é recusada nos dois caminhos de dados.
- Todo gancho vale para o caminho antigo (`Visitantes`) e o de Pessoas/Visitas (`*ViaPessoasVisitas`).
- iOS: app continua com deployment target 16.0; extensão 17.0; push-to-start só iOS 17.2+.
- Bundle da extensão `br.com.clickprestare.app.CardPortaria`; tópico APNs `br.com.clickprestare.app.push-type.liveactivity`; team `9FD7V97G5V`.
- Nenhuma variável nova no Elastic Beanstalk (limite 4096); a chave .p8 fica no S3 privado `prestare-arquivos-850401152034`, objeto `config/apns/AuthKey.p8`; Key ID e Team ID como constantes no código.
- Textos do card em português, exatamente como a tabela da seção 3 do spec.
- Migração SQL aplicada à mão no RDS antes do push; push em `master` e `main`.

## Review Focus

1. Aparelho com app antigo (não entende `card_portaria`) — tem que receber o push comum pela reserva, nunca ficar sem aviso. Teste no Task 3.
2. Dois moradores respondendo quase juntos — a segunda resposta é recusada e o card dela vira "respondido por X". Teste no Task 4.
3. Servidor reinicia entre abrir o card e os 10 s da reserva — o tique tem que mandar o push comum. Teste no Task 3.
4. Logout com card aberto — tokens do usuário somem e nada mais chega a esse aparelho. Teste no Task 5.
5. APNs responde 410 (token morto) — o token sai de `Users_Devices.card_token_inicio` e o aparelho cai no push comum. Teste no Task 2.

---

### Task 1: Banco — tabela de cards e token de abertura

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma` (model `Users_Devices`, novo model `Cards_Ao_Vivo`)
- Create: `click-cond-web/prisma/sql/2026-11-13-card-ao-vivo.sql`, `click-cond-web/prisma/sql/2026-11-13-card-ao-vivo-verificacao.sql`

**Interfaces — Produces:**
- `Users_Devices.card_token_inicio String? @db.VarChar(200)`
- `model Cards_Ao_Vivo { id Int @id @default(autoincrement()); origem String @db.VarChar(10) /* 'visitante'|'visita' */; id_pedido Int; id_user Int; plataforma String @db.VarChar(10) /* 'ios'|'android' */; fcm_token String @db.VarChar(500); token_inicio String? @db.VarChar(200); token_atualizacao String? @db.VarChar(200); fase String @db.VarChar(20); fase_em DateTime; confirmado_em DateTime?; reserva_enviada_em DateTime?; encerrado_em DateTime?; created_at DateTime @default(now()); user Users @relation(onDelete: Cascade) }` com índices `(origem, id_pedido)`, `(encerrado_em, fase)`, `(id_user)`.

- [ ] **Step 1:** Escrever o SQL idempotente (padrão de `2026-11-11-votos-por-unidade.sql`: confere `information_schema`) e a verificação.
- [ ] **Step 2:** Atualizar o `schema.prisma` e rodar `npx prisma generate` em `click-cond-web`. Esperado: sem erro.
- [ ] **Step 3:** Commit.

### Task 2: Cliente APNs e conteúdo do card

**Files:**
- Create: `click-cond-web/apps/api/src/app/card-ao-vivo/apns.client.ts`, `conteudo.ts`, `apns.client.spec.ts`, `conteudo.spec.ts`

**Interfaces — Produces:**
- `type FaseCard = 'aguardando'|'liberado'|'entrou'|'negado'|'expirado'`
- `interface ConteudoCard { fase: FaseCard; nome: string; tipo: 'Visitante'|'Prestador'; unidade: string; chegouEm: number; expiraEm: number; respondidoPor: string|null; voceRespondeu: boolean; pelaPortaria: boolean; horaResposta: number|null; horaEntrada: number|null }` (epochs em segundos; chaves = as do `ContentState` Swift).
- `montarConteudo(base: BaseCard, fase: FaseCard, extras?: Partial<ConteudoCard>): ConteudoCard` — `expiraEm = chegouEm + 180`.
- `payloadInicio(c: ConteudoCard, attrs: { idCartao: string; idPedido: string; origem: string }, agora: number)`, `payloadAtualizacao(c, agora)`, `payloadFim(c, agora, dismissalSeg: number)` → objetos `{ aps: {...} }` (event `start|update|end`, `attributes-type: 'CardPortariaAttributes'`, alerta só no start: título `"<tipo> na portaria"`, corpo `"<nome> quer entrar. Autorizar?"`).
- `class ApnsClient { enviar(token: string, corpo: object, prioridade: 5|10): Promise<{ status: number; motivo?: string }> }` — JWT ES256 (`crypto.sign(..., { dsaEncoding: 'ieee-p1363' })`) renovado a cada 50 min; chave lida uma vez do S3 (`config/apns/AuthKey.p8`); sem chave → `{ status: 0, motivo: 'sem-chave' }` e log `warn` uma vez.

- [ ] **Step 1: Testes** — `conteudo.spec.ts`: `montarConteudo(...,'aguardando').expiraEm === chegouEm+180`; `payloadInicio` tem `aps.event==='start'`, `aps['attributes-type']==='CardPortariaAttributes'`, `aps.alert.title==='Visitante na portaria'`; `payloadFim(...,120).aps['dismissal-date'] === agora+120`. `apns.client.spec.ts`: JWT tem 3 partes, header `{alg:'ES256',kid}`, assinatura de 64 bytes e verifica com a chave pública de teste (gerar par EC P-256 no teste); sem chave → `status 0`.
- [ ] **Step 2:** Rodar `npx jest apps/api/src/app/card-ao-vivo` (em `click-cond-web`) → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar de novo → PASS. Commit.

### Task 3: `CardAoVivoService` — abrir, reserva, tique

**Files:**
- Create: `card-ao-vivo/card-ao-vivo.service.ts`, `card-ao-vivo.module.ts`, `card-ao-vivo.controller.ts`, `card-ao-vivo.service.spec.ts`
- Modify: `notifications/notifications.service.ts` (`enviarParaAparelho` público; `enviarDados`), `app.module.ts` (importar módulo)

**Interfaces:**
- Consumes: Task 1 models; Task 2 `ApnsClient`, `montarConteudo`, `payload*`.
- Produces:
  - `interface PedidoCard { origem: 'visitante'|'visita'; id: number; nome: string; isPrestador: boolean; bloco: string|null; apto: string|null; solicitadoEm: Date; fotoUrl?: string }`
  - `abrir(p: PedidoCard, idsUsuarios: number[]): Promise<void>` — encerra cards abertos do mesmo pedido; por aparelho de `Users_Devices` de cada usuário: iOS com `card_token_inicio` → APNs start (cria linha); `plataforma==='android'` → FCM dados `{type:'card_portaria', id_cartao, id_pedido, origem, conteudo: JSON}` (cria linha); demais → push comum na hora (`type:'autorizacao_visitante'`, mesmo texto de hoje). Agenda `verificarReserva(origem,id)` em 10 s (`unref`).
  - `confirmar(idUser: number, idCartao: number, tokenAtualizacao?: string): Promise<{ ok: boolean }>` — só o dono da linha.
  - `verificarReserva(origem, id)`: linhas `fase='aguardando'`, `confirmado_em IS NULL`, `reserva_enviada_em IS NULL`, `encerrado_em IS NULL` → `enviarParaAparelho(fcm_token, ...)` com o push comum e marca `reserva_enviada_em`.
  - `tick()`: reserva atrasada (`created_at < agora-15s`); AGUARDANDO com `fase_em < agora-180s` → `expirado`; LIBERADO com `fase_em < agora-600s` → encerra sem mostrar; registrado com `executarComLock(this.prisma, 'card-ao-vivo:tick', ...)` a cada 30 s (fora de `NODE_ENV=test`).
  - Rota `POST /card-ao-vivo/confirmar` body `{ id_cartao: number; token_atualizacao?: string }` (JWT do app; `idUsuarioDoToken(payload)`).
  - APNs 410/400 `BadDeviceToken|Unregistered` → `card_token_inicio = null` naquele aparelho e push comum para ele.

- [ ] **Step 1: Testes** (prisma e clientes falsos): abrir com 1 iOS (token), 1 Android, 1 aparelho sem plataforma → 1 APNs start, 1 FCM dados, 1 push comum imediato, 2 linhas; reserva com Android não confirmado → push comum para o `fcm_token` dele e `reserva_enviada_em` gravado; reserva com linha confirmada → nada; `confirmar` de outro usuário → `{ok:false}`; tique expira AGUARDANDO de 4 min atrás (APNs update com `fase:'expirado'` e FCM dados) e encerra LIBERADO de 11 min; tique manda reserva de linha de 20 s sem confirmação (servidor reiniciado); APNs 410 → token zerado + push comum.
- [ ] **Step 2:** `npx jest apps/api/src/app/card-ao-vivo` → FAIL. **Step 3:** implementar. **Step 4:** PASS. Commit.

### Task 4: Fases — responder, entrar, encerrar (ganchos nos dois caminhos)

**Files:**
- Modify: `card-ao-vivo/card-ao-vivo.service.ts`; `visitantes/visitantes.service.ts` (construtor: `@Optional() private readonly cardAoVivo?: CardAoVivoService` por último; `notificarMoradoresAutorizacao`, `autorizar`, `negar`, `checkIn`, `liberarAcesso`, `checkOut`, `remove` e versões `*ViaPessoasVisitas`); `visitantes/visitantes.module.ts`; `facial/facial.service.ts` (ramo `isEntrada` ~6000, após `r.count > 0`); `facial/facial.module.ts`
- Test: `card-ao-vivo/card-ao-vivo.fases.spec.ts`, `visitantes/portaria-remota.spec.ts` (ajustar + novos)

**Interfaces — Produces (no service):**
- `respondido(origem, id, fase: 'liberado'|'negado', quem: { idUser: number|null; nome: string|null; pelaPortaria: boolean }): Promise<void>` — por linha aberta: `voceRespondeu = linha.id_user === quem.idUser`; LIBERADO → APNs update/FCM dados; NEGADO → APNs end com dismissal 120 s / FCM dados, `encerrado_em`.
- `entrou(origem, id, em: Date): Promise<void>` — fase `entrou`, APNs end com dismissal 300 s (conteúdo `entrou`), FCM dados, `encerrado_em`. No-op sem linha aberta.
- `encerrar(origem, id): Promise<void>` — APNs end com dismissal imediato, FCM dados `fase:'encerrado'` (app remove a notificação).
- `encerrarDoUsuario(idUser): Promise<void>` (logout).
- Ganchos: `solicitarAutorizacao*` → `abrir` (via `notificarMoradoresAutorizacao`, que passa a usar `cardAoVivo.abrir` quando injetado; WhatsApp continua); `autorizar*` → `respondido('liberado')` e, com `darEntrada`, `entrou`; `negar*` → `respondido('negado')`; `liberarAcesso*` com pedido pendente → `respondido('liberado', pelaPortaria)`; `checkIn*` → (pendente: `respondido(... pelaPortaria)`) + `entrou`; facial entrada → `entrou`; `checkOut*`/`remove*` → `encerrar`.
- Caminho antigo `autorizar`/`negar`: `this.assertPedidoPendente(ref)` e prazo `AUTORIZACAO_EXPIRACAO_MS` (hoje 15 min com mensagem de 10).
- Todas as chamadas ao card são "melhor esforço": `void ... .catch(log)` — falha no card nunca derruba a resposta HTTP.

- [ ] **Step 1: Testes** — fases: dois moradores, o 1º autoriza → linha do 1º `voceRespondeu:true`, do 2º `respondidoPor:'Maria'`; negar encerra; `entrou` sem linha aberta não chama APNs; `portaria-remota.spec`: caminho antigo, `negar` depois de `autorizar` → `BadRequestException('Esta solicitação já foi respondida ou resolvida pela portaria.')`; `autorizar` chama `cardAoVivo.respondido`; `checkIn` com pendente chama `respondido` e `entrou`; falha do card (rejeita) não muda `{ ok: true }`.
- [ ] **Step 2:** `npx jest apps/api/src/app/visitantes apps/api/src/app/card-ao-vivo apps/api/src/app/facial` → FAIL nos novos.
- [ ] **Step 3:** implementar. **Step 4:** a suíte inteira de visitantes/facial/card passa. Commit.

### Task 5: Registro do token de abertura e logout no servidor

**Files:**
- Modify: `auth/mobile-auth.controller.ts` (`update-fcm-token` aceita `card_token_inicio?: string`), `auth/mobile-auth.service.ts` (`updateFcmToken` grava `card_token_inicio` no `Users_Devices`; `removeFcmToken` chama `cardAoVivo.encerrarDoUsuario`), `auth/auth.module.ts`
- Test: `auth/mobile-auth.card-token.spec.ts`

- [ ] **Step 1: Testes** — `updateFcmToken(1,'fcm-x','ios','abc123')` grava `card_token_inicio:'abc123'` no upsert do aparelho; sem o campo não apaga o existente (`undefined` não entra no `data`); `removeFcmToken` chama `encerrarDoUsuario(1)`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. Commit.

### Task 6: App Flutter — ponte iOS (Dart) e notificação Android

**Files:**
- Modify: `click-cond-app/click-cond-app/pubspec.yaml` (`flutter_local_notifications: ^19.4.2`; versão `1.2.42+96`), `lib/services/firebase_service.dart`, `lib/main.dart`, `android/app/src/main/AndroidManifest.xml` (receivers do plugin se exigidos)
- Create: `lib/services/card_ao_vivo/card_ao_vivo_ios.dart`, `lib/services/card_ao_vivo/card_android.dart`, `lib/services/card_ao_vivo/textos_card.dart`
- Test: `test/card_ao_vivo/textos_card_test.dart`

**Interfaces — Produces:**
- `CardAoVivoIos.definirSessao(String token, String baseUrl)`, `limparSessao()`, `Future<String?> obterTokenInicio()`; handler `tokenInicioAtualizado` → `FirebaseService.instance.registrarNoServidor()`. Canal `prestare/card_ao_vivo`. No-op fora do iOS.
- `TextosCard textosCard(Map<String, dynamic> conteudo)` → `(titulo, corpo, emAndamento: bool)` com os textos da seção 3 do spec (ex.: aguardando → título `"Vinicius Vilela · na portaria"`, corpo `"Visitante · Bloco A · Apto 106 · responda até 14:31"`).
- `CardAndroid.exibir(Map<String, dynamic> data)` — notificação id = `id_cartao`, `ongoing` enquanto aguardando/liberado, ações `negar` (segundo plano) e `autorizar` (`showsUserInterface: true`) só em aguardando; `fase:'encerrado'` → cancela; depois de exibir, `POST /card-ao-vivo/confirmar {id_cartao}`.
- `@pragma('vm:entry-point') respostaCardSegundoPlano(NotificationResponse r)` → NEGAR via `POST /visitantes/:id/negar` com a sessão (`ensureStorageReady()` antes).
- Abertura pelo AUTORIZAR → `POST /visitantes/:id/autorizar` e abre `PendentesVisitantePage`; erro do servidor vira mensagem (`api_mensagem_erro`).
- `registrarNoServidor` envia `card_token_inicio` e chama `definirSessao`; `_desregistrar` chama `limparSessao`.

- [ ] **Step 1: Teste** `textos_card_test.dart`: cada fase da tabela do spec produz o título/corpo esperado; `negado` com `voceRespondeu:false` e `respondidoPor:'Marina'` → `"Negado por Marina às 14:31."`.
- [ ] **Step 2:** `flutter test test/card_ao_vivo` → FAIL. **Step 3:** implementar. **Step 4:** PASS + `flutter analyze` sem erro novo. Commit.

### Task 7: iOS nativo — extensão, ponte, intents e CI

**Files:**
- Create: `ios/CardPortaria/CardPortariaAttributes.swift` (app+extensão), `ios/CardPortaria/CardIntents.swift` (app+extensão), `ios/CardPortaria/CardPortariaWidget.swift`, `ios/CardPortaria/CardVisual.swift`, `ios/CardPortaria/Info.plist`, `ios/CardPortaria/Fonts/*.ttf` (Barlow Regular/Medium, Barlow Condensed Light/SemiBold — OFL), `ios/Runner/CardAoVivoBridge.swift`, `ios/scripts/criar_alvo_card.rb`
- Modify: `ios/Runner/AppDelegate.swift`, `ios/Runner/Info.plist` (`NSSupportsLiveActivities` YES), `ios/fastlane/Fastfile`, `ios/fastlane/Matchfile`, `.github/workflows/ios-release.yml` (passo antes do CocoaPods: `bundle exec ruby scripts/criar_alvo_card.rb`)

**Interfaces:**
- `struct CardPortariaAttributes: ActivityAttributes { idCartao: String; idPedido: String; origem: String; struct ContentState: Codable, Hashable { fase, nome, tipo, unidade: String; chegouEm, expiraEm: Double; respondidoPor: String?; voceRespondeu, pelaPortaria: Bool; horaResposta, horaEntrada: Double? } }`
- `CardSessao` (keychain `kSecClassGenericPassword`, service `br.com.clickprestare.card`, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`): `salvar(token:baseUrl:)`, `ler() -> (token, baseUrl)?`, `apagar()`; `CardApi.post(path:body:)`.
- `NegarCardIntent`/`AutorizarCardIntent: LiveActivityIntent` com `@Parameter idCartao, idPedido`; Autorizar `static var authenticationPolicy = .requiresAuthentication`; após sucesso atualizam a Activity local (fase `negado`/`liberado`, `voceRespondeu: true`).
- `CardAoVivoBridge.registrar(com: FlutterBinaryMessenger)`; métodos `definirSessao`, `limparSessao`, `obterTokenInicio`, `suportado`; observa `pushToStartTokenUpdates` (17.2+, grava em `UserDefaults` e chama `tokenInicioAtualizado`) e `activityUpdates` → `pushTokenUpdates` → `POST /card-ao-vivo/confirmar`.
- Visual: layouts da tela de bloqueio, Ilha expandida/compacta/mínima conforme spec seção 3 e `docs/superpowers/specs/2026-11-13-card-ao-vivo-portaria-remota/`; logo desenhado em SwiftUI (dois prédios, janelas `#FFC83D`); contagem com `Text(timerInterval:)`; toque no card → `widgetURL("clickprestare://solicitacoes")`.
- `criar_alvo_card.rb`: idempotente (sai se o alvo `CardPortaria` existir); cria alvo `:app_extension` iOS 17.0, bundle acima, `INFOPLIST_FILE = CardPortaria/Info.plist`, `SWIFT_VERSION 5.0`, adiciona arquivos/fontes, adiciona `CardPortariaAttributes.swift`, `CardIntents.swift` e `CardAoVivoBridge.swift` ao Runner, fase "Embed Foundation Extensions" no Runner e dependência.
- Fastfile: `match` com `[APP_ID, EXT_ID]`; `update_code_signing_settings` para os dois alvos; `export_options.provisioningProfiles` com os dois.

- [ ] **Step 1:** Escrever os arquivos.
- [ ] **Step 2:** Verificação local possível: `ruby -c` nos .rb (se houver Ruby) e revisão; a compilação real é o TestFlight (Task 9).
- [ ] **Step 3:** Commit.

### Task 8: Infra — Apple, chave APNs, migração

- [ ] **Step 1:** Apple Developer (Playwright, sessão do usuário): criar App ID `br.com.clickprestare.app.CardPortaria` (sem capacidades); criar chave APNs ("Prestare Card ao Vivo", Sandbox & Production, team scoped); anotar Key ID (vai para a constante `APNS_KEY_ID` do `apns.client.ts`).
- [ ] **Step 2:** Subir a `.p8` para `s3://prestare-arquivos-850401152034/config/apns/AuthKey.p8` pelo CloudShell; apagar a cópia local. Conferir que a role do EB lê o objeto (mesmo bucket já usado pela API).
- [ ] **Step 3:** Aplicar `2026-11-13-card-ao-vivo.sql` no RDS (CloudShell + `tunel.sh`) e rodar a verificação: colunas/tabela presentes.

### Task 9: Publicar e conferir

- [ ] **Step 1:** Suíte da API: `npx jest apps/api/src/app/visitantes apps/api/src/app/card-ao-vivo apps/api/src/app/facial apps/api/src/app/auth apps/api/src/app/notifications` → PASS; `npx tsc -p apps/api/tsconfig.app.json --noEmit` sem erro novo.
- [ ] **Step 2:** `flutter test` (pasta do card + suíte) e `flutter build apk --debug` para validar Android compila.
- [ ] **Step 3:** Merge em `master` e `main`, push; acompanhar `deploy-api.yml` até "Verify deployed version" verde.
- [ ] **Step 4:** `gh workflow run ios-release.yml --ref master -f destino=testflight`; acompanhar; corrigir até o upload passar.
- [ ] **Step 5:** Conferir a API no ar: `POST /card-ao-vivo/confirmar` sem token → 401 (rota existe).
