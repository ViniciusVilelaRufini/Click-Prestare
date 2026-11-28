# Interfone pelo app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O morador atende o visitante do facial no celular (vídeo do facial, áudio, abrir), com transferência para o console da portaria, ligações portaria ↔ unidade, foto do visitante, módulo ligado por condomínio.

**Architecture:** Asterisk (EC2 `voz.prestarecondominios.com.br`) faz SIP/mídia; um serviço Node (`click-cond-web/voz`) controla as chamadas pela ARI. A API NestJS é dona dos dados: decide quem toca, manda push (VoIP no iPhone, FCM de dados no Android), emite eventos ao console por Socket.IO, grava o registro e abre o portão. App e console **nunca ficam registrados**: o toque é por push/evento e, ao atender ou ligar, o cliente pede à API um token curto e entra na chamada por WebRTC (SIP sobre WSS) discando `sip:entrar@voz.prestarecondominios.com.br` com o cabeçalho `X-Prestare-Token`. Só faciais e monitores IP são contas SIP registradas.

**Tech Stack:** Asterisk 20 (Ubuntu 24.04 arm64, PJSIP, ARI), coturn, Node 22 (JS ESM + `ari-client` + `jsonwebtoken`, testes `node --test`), NestJS + Prisma (MySQL), Angular zoneless + JsSIP, Flutter (`flutter_callkit_incoming`, `sip_ua`, `flutter_webrtc`).

**Spec:** `docs/superpowers/specs/2026-11-27-interfone-pelo-app-design.md`

## Global Constraints

- Produção: API NestJS (`click-cond-web/apps/api/src/app`, chamado `API/`), console `click-cond-web/apps/portaria-web/src/app` (`WEB/`), CRM `click-cond-web/apps/crm-web`, app `click-cond-app/click-cond-app` (`APP/`). Express é só dev: não mexer.
- Schema: SQL manual idempotente em `click-cond-web/prisma/sql/2026-11-27-interfone.sql` (+ `-verificacao.sql`), estilo `information_schema` + `PREPARE`, `SET SESSION lock_wait_timeout = 10;`, cabeçalho "APLICAR ANTES DO DEPLOY". `schema.prisma` editado à mão com `///`. Só ADD (nada de DROP/ALTER destrutivo).
- Rótulo de unidade: `rotuloAptoBloco(apto, bloco)` (`API/visitantes/rotulo-apto-bloco.util.ts`, **apto primeiro**) → "Bloco A · Apto 106". Console: pipe `unidade`.
- Visual estritamente Prestare Dark (cantos retos, Barlow Condensed maiúsculo, cor só em ponto de 6 px). Console: classes `ps-*` existentes. App: `lib/theme/` (`AppColors`, `app_typography.dart`).
- Console zoneless: callback fora de evento (JsSIP, Socket.IO, timers) grava em `signal`.
- Tempos padrão: toque no apartamento **30 s** (15–60), toque na portaria **45 s** (15–120), conversa máx. **180 s** (aviso aos 150 s). Foto apagada em **90 dias**. Limites anti-trote: **6 chamadas/min por facial**, **3 chamadas em 5 min por unidade**.
- Mensagens ao visitante (áudio): `apto-nao-encontrado`, `servico-indisponivel`, `ninguem-atendeu`, `aguarde-para-chamar` (texto em Task V6).
- Facial nunca mostra nome de morador. Lista telefônica só bloco/andar/ramal.
- Ninguém abre fora da chamada: abrir exige chamada `atendida`, quem pede = quem atendeu, e abre **o facial da chamada**.
- Token de voz: JWT HS256, segredo `VOZ_TOKEN_SECRET`, validade **120 s**, claims `{cid:number, papel:'morador'|'portaria'|'origem', uid:number, nome:string}`.
- Segredos compartilhados API ↔ voz: `VOZ_TOKEN_SECRET`, `VOZ_INTERNAL_TOKEN` (cabeçalho `x-voz-token` nos dois sentidos), `VOZ_TURN_SECRET` (TURN REST de coturn). Na API vêm de `process.env` (carregados pelo `common/segredos-ssm.ts` como opcionais — as variáveis do EB estão no limite de 4096). Rota/serviço sem segredo configurado falha fechado.
- Endereços: WSS `wss://voz.prestarecondominios.com.br:8089/ws`; SIP do facial `voz.prestarecondominios.com.br:5060` (UDP/TCP); controle do serviço `https://voz.prestarecondominios.com.br/controle`; TURN `turn:voz.prestarecondominios.com.br:3478`.
- Push VoIP iOS: tópico `br.com.clickprestare.app.voip`, `apns-push-type: voip`, prioridade 10; todo VoIP push vira ligação CallKit no app (regra da Apple) — só mandar VoIP para chamada que ainda toca.
- Versão do recurso no app: `interfone_versao = 1`. Aparelho com 0 recebe push comum "Visitante chamando no portão — atualize o app para atender".
- Commits pequenos, mensagem em pt-BR, terminar com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Contrato da API (fonte única para todas as frentes)

Estados de chamada: `chamando` → `atendida` | `portaria` → `atendida` | `encerrada`. Resultados: `atendida_morador`, `atendida_portaria`, `nao_atendida`, `recusada`, `falha`, `cancelada` (quem originou desligou antes). Tipos: `facial_unidade`, `portaria_unidade`, `unidade_portaria`.

`DadosEntrada` (resposta de todo "atender"/"ligar") = `{ id:number, token:string, wss:string, sip_uri:'sip:entrar@voz.prestarecondominios.com.br', ice:[{urls:string[], username?:string, credential?:string}] }`.

**Serviço → API** (`x-voz-token`, `@Public()` + checagem própria):
- `GET /api/interno/interfone/contas` → `{ faciais:[{conta:'fac-<id>', senha, id_condominio, dtmf_modo:'info'|'rfc4733'}], monitores:[{conta:'mon-<id>', senha, id_condominio, id_apartamento}] }`
- `POST /api/interno/interfone/chamadas` `{conta, numero}` → `{ok:true, id, toque_s, monitores:string[]}` | `{ok:false, motivo:'nao_encontrado'|'indisponivel'|'limite'}`
- `GET /api/interno/interfone/chamadas/:id` → `{id, tipo, estado, toque_s, toque_portaria_s, monitores:string[]}`
- `POST /api/interno/interfone/chamadas/:id/evento` `{evento:'atendida', papel, uid}` | `{evento:'toque_esgotado'}` → `{proximo:'portaria'|'encerrar'}` | `{evento:'encerrada', resultado, duracao_s}`
- `POST /api/interno/interfone/registros` `{contas:[{conta, registrado:boolean}]}`

**API → serviço** (`x-voz-token`): `POST https://voz.prestarecondominios.com.br/controle/chamadas/:id/portaria` | `/dtmf` `{digitos}` | `/encerrar` → `{ok:boolean}`.

**App** (`UsuarioAppGuard`, morador da unidade):
- `POST /api/users/update-fcm-token` + campos opcionais `voip_token` (hex 16–200), `interfone_versao` (int 0–99)
- `GET /api/interfone/disponivel` → `{ativo:boolean}`
- `GET /api/interfone/chamadas/:id` → `{id, tipo, estado, resultado|null, unidade, portao, foto_url|null, atendida_por_mim:boolean}`
- `POST /api/interfone/chamadas/:id/atender` → `DadosEntrada` | 409 `{motivo:'ja_atendida'|'encerrada'}`
- `POST /api/interfone/chamadas/:id/recusar` → `{ok:true}`
- `POST /api/interfone/chamadas/:id/abrir` → `{ok:boolean, motivo?:string}`
- `POST /api/interfone/ligar-portaria` `{id_apartamento}` → `DadosEntrada` | 409 `{motivo:'portaria_indisponivel'}`
- `GET /api/interfone/historico?id_apartamento=` → `[{id, tipo, inicio, resultado, atendida_por_nome|null, foto_url|null, porta_aberta:boolean}]` (30 dias, 50 itens)
- `GET|PUT /api/interfone/preferencia` `{receber:boolean}`

Push ao app (dados, todas as chaves string): `{type:'interfone_chamada', id, tipo, unidade, portao, condominio}`, `{type:'interfone_fim', id}`, comum `{type:'interfone_perdida', id}`.

**Console da portaria** (porteiro: `tipo_sub==='funcionario_portaria'`):
- `POST /api/interfone/portaria/chamadas/:id/atender` → `DadosEntrada` | 409
- `POST /api/interfone/portaria/ligar` `{id_apartamento}` → `DadosEntrada`
- `POST /api/interfone/portaria/chamadas/:id/abrir` → `{ok, motivo?}`; `POST .../encerrar` → `{ok}`
- `GET /api/interfone/portaria/hoje` → mesmo item do histórico + `unidade`
- Socket.IO (sala dos porteiros do condomínio): `interfone:chamada` `{id, tipo, unidade, motivo:'nao_atendeu'|'recusou'|'sem_app'|null, morador_nome|null, foto_url|null}`, `interfone:fim` `{id}`.

**Síndico** (`assertSindicoEstrito`, só com `interfone_contratado=1`):
- `GET|PUT /api/interfone/config` `{contratado, ativo, toque_apto_s, transferir, toque_portaria_s}` (PUT sem `contratado`)
- `GET /api/interfone/ramais` → `[{id_apartamento, unidade, ramal|null, sugestao|null, conflito:boolean}]`; `PUT /api/interfone/ramais` `[{id_apartamento, ramal}]`
- `GET /api/interfone/faciais` → `[{id, nome, modelo, habilitado, blocos:string[]|null, dtmf|null, conta, senha, servidor, porta, registrado:boolean, registrado_em|null}]`; `PUT /api/interfone/faciais/:id` `{habilitado, blocos, dtmf}`; `POST /api/interfone/faciais/:id/nova-senha`; `GET /api/interfone/faciais/:id/lista-telefonica.csv`
- `GET|POST /api/interfone/monitores`, `DELETE /api/interfone/monitores/:id`

**CRM** (`role==='crm_admin'`): `POST /api/crm/interfone/clientes/:id/contratado` `{ligado}`; `GET /api/crm/interfone/clientes` → `[{id, nome, contratado}]`.

## Review Focus

1. App fechado/tela bloqueada quando a chamada chega: o celular toca (Android: push de dados alta prioridade → tela de ligação; iPhone: VoIP push sempre vira CallKit, mesmo se a chamada já acabou — mostrar e encerrar em seguida).
2. Dois aparelhos (ou morador e portaria) tocam em Atender ao mesmo tempo: um só entra; o outro recebe 409 `ja_atendida` e a tela de ligação fecha.
3. Visitante desliga enquanto toca: todos param (push `interfone_fim`, evento `interfone:fim`, registro `cancelada`).
4. Número digitado que colide, não existe ou está fora dos blocos do facial: "Apartamento não encontrado", sem tocar ninguém.
5. Abrir depois de a chamada acabar, ou por quem não atendeu, ou pedindo outro facial: recusado sem acionar nada.

---

## Frente API (NestJS) — branch `feat/interfone-api`

### Task A1: Schema e SQL

**Files:**
- Create: `click-cond-web/prisma/sql/2026-11-27-interfone.sql`, `click-cond-web/prisma/sql/2026-11-27-interfone-verificacao.sql`
- Modify: `click-cond-web/prisma/schema.prisma`

**Interfaces:**
- Produces (Prisma): `Condominios.interfone_contratado Int @default(0) @db.TinyInt`, `interfone_ativo Int @default(0) @db.TinyInt`, `interfone_toque_apto_s Int @default(30)`, `interfone_transferir Int @default(1) @db.TinyInt`, `interfone_toque_portaria_s Int @default(45)`; `Apartamentos.interfone_ramal String? @db.VarChar(10)` + `@@unique([id_condominio, interfone_ramal], map: "un_apto_ramal")`; `Facial_Devices.interfone_habilitado Int @default(0) @db.TinyInt`, `interfone_senha String? @db.VarChar(64)`, `interfone_blocos String? @db.Text` (JSON array; null = todos), `interfone_dtmf String? @db.VarChar(20)`, `interfone_registrado Int @default(0) @db.TinyInt`, `interfone_registrado_em DateTime? @db.DateTime(0)`; `Users_Devices.voip_token String? @db.VarChar(200)`, `interfone_versao Int @default(0)`; `Users.interfone_receber Int @default(1) @db.TinyInt`.
- Produces: model `Interfone_Monitores { id, id_condominio (FK cascade), id_apartamento (FK cascade), nome VarChar(80), senha VarChar(64), ativo TinyInt default 1, created_at }` e model `Interfone_Chamadas { id, id_condominio (FK cascade), tipo VarChar(20), estado VarChar(12), resultado VarChar(20)?, id_facial Int? (FK SetNull), id_apartamento Int? (FK SetNull), numero_discado VarChar(10)?, id_user_origem Int? (FK SetNull), id_porteiro_origem Int?, motivo_portaria VarChar(12)?, atendida_em DateTime?, atendida_por_tipo VarChar(10)?, atendida_por_id Int?, atendida_por_nome VarChar(120)?, encerrada_em DateTime?, duracao_s Int?, foto VarChar(500)?, porta_aberta_em DateTime?, porta_aberta_por_nome VarChar(120)?, porta_aberta_como VarChar(10)?, recusas Text? (JSON de id_user), created_at @default(now()) }` com índices `(id_condominio, created_at)` e `(id_apartamento, created_at)`.

- [ ] **Step 1:** Escrever o SQL idempotente (uma checagem `information_schema` por coluna/tabela/índice/FK) e o de verificação (lista colunas e tabelas esperadas, 1 linha por item com `OK`/`FALTA`).
- [ ] **Step 2:** Editar `schema.prisma` igual ao SQL, com `///` em cada campo novo.
- [ ] **Step 3:** `cd click-cond-web && npx prisma validate --schema=prisma/schema.prisma && npx prisma generate --schema=prisma/schema.prisma` → sem erro.
- [ ] **Step 4:** `npx nx run @org/api:typecheck` → sem erro. Commit.

### Task A2: Regras puras (ramal, blocos, token, TURN)

**Files:**
- Create: `API/interfone/regras.ts`, `API/interfone/token-voz.ts`, `API/interfone/regras.spec.ts`, `API/interfone/token-voz.spec.ts`

**Interfaces:**
- Produces: `sugerirRamais(aptos:{id:number; apto:string|null; bloco:string|null; ramal:string|null}[]): Map<number,{sugestao:string|null; conflito:boolean}>` — sugestão = só os dígitos do `apto`; conflito quando dois aptos geram o mesmo número (ou o ramal gravado colide); nunca sugere número em conflito.
- Produces: `ramalValido(r:string): boolean` (`/^\d{1,10}$/`).
- Produces: `facialAtendeBloco(blocosJson:string|null, bloco:string|null): boolean` (null/'' = todos; comparação por `normalizarBloco` de `common/rotulo-bloco.util.ts`).
- Produces: `assinarTokenVoz(c:{cid:number;papel:'morador'|'portaria'|'origem';uid:number;nome:string}, segredo:string, agoraSeg?:number): string` e `verificarTokenVoz(t:string, segredo:string, agoraSeg?:number): ClaimsVoz|null` (HS256, exp = agora+120).
- Produces: `credencialTurn(uid:number, segredo:string, agoraSeg?:number): {username:string; credential:string}` (username `${exp}:${uid}`, exp = agora+3600, credential = base64(HMAC-SHA1(segredo, username))).
- Produces: `montarDadosEntrada(id:number, token:string, turn:{username;credential}): DadosEntrada` com `ice: [{urls:['stun:voz.prestarecondominios.com.br:3478']},{urls:['turn:voz.prestarecondominios.com.br:3478?transport=udp','turn:voz.prestarecondominios.com.br:3478?transport=tcp'], username, credential}]`.

- [ ] **Step 1: Testes** — `sugerirRamais`: `[{1,'106','A'},{2,'106','B'},{3,'201','A'}]` → 1 e 2 `{sugestao:null, conflito:true}`, 3 `{sugestao:'201', conflito:false}`; apto `'Apto 12-B'` → `'12'`; ramal gravado `'1106'` colidindo com outro gravado → ambos `conflito:true`. `facialAtendeBloco('["A"]','Bloco A')===true`, `('["A"]','B')===false`, `(null,'B')===true`. Token: assina e verifica; expirado (agora+121) → null; segredo errado → null. TURN: username `'${agora+3600}:7'`, credential determinística.
- [ ] **Step 2:** Rodar `npx jest -c apps/api/jest.config.cts apps/api/src/app/interfone` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar → PASS. Commit.

### Task A3: Push de chamada (VoIP iOS, dados Android, comum)

**Files:**
- Modify: `API/card-ao-vivo/apns.client.ts` (+ spec), `API/auth/mobile-auth.controller.ts` (L~918), `API/auth/mobile-auth.service.ts` (`updateFcmToken`)
- Create: `API/interfone/interfone-push.service.ts`, `API/interfone/interfone-push.service.spec.ts`

**Interfaces:**
- Produces: `ApnsClient.enviar(token, corpo, prioridade, opcoes?:{topico?:string; tipo?:'liveactivity'|'voip'}): Promise<RespostaApns>` — sem `opcoes` mantém exatamente os cabeçalhos de hoje (Live Activity).
- Produces: `updateFcmToken(..., cardVersao?, voipToken?:string|null, interfoneVersao?:number)`; o controller aceita `voip_token` e `interfone_versao` no body (mesma validação de hex 16–200; inteiro 0–99).
- Produces: `InterfonePushService.tocar(idChamada:number, idsUsuarios:number[], dados:{tipo;unidade;portao;condominio}): Promise<{tocou:number; semApp:number}>` — por aparelho: iOS com `voip_token` e `interfone_versao>=1` → VoIP push `{id, tipo, unidade, portao, condominio}`; Android com `interfone_versao>=1` → `notifications.enviarDados(token, {type:'interfone_chamada', ...})`; demais → `notifications.enviarParaAparelho(token, 'Visitante chamando no portão', 'Atualize o app para atender pelo celular.', {type:'interfone_perdida', id})`. Usuários com `interfone_receber=0` são excluídos antes.
- Produces: `InterfonePushService.fim(idChamada, idsUsuarios)` (Android: dados `{type:'interfone_fim', id}`; iOS: nada — o app consulta o estado) e `perdida(idChamada, idsUsuarios, hora:string)` (push comum "Chamada perdida do portão às HH:MM").

- [ ] **Step 1: Testes** — `apns.client.spec`: com `{topico:'br.com.clickprestare.app.voip', tipo:'voip'}` os cabeçalhos são `apns-topic: br.com.clickprestare.app.voip` e `apns-push-type: voip`; sem opções, iguais aos de hoje. `interfone-push.service.spec` (prisma falso): 3 aparelhos (iOS v1 com voip, Android v1, Android v0) → 1 VoIP, 1 `enviarDados`, 1 `enviarParaAparelho`; usuário com `interfone_receber=0` não recebe nada; `tocar` devolve `{tocou:2, semApp:1}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (APNs: `new ApnsClient(carregarChave)` reaproveitando o carregador do card — extrair `carregarChaveApns()` para `card-ao-vivo/apns-chave.ts` e usar nos dois). **Step 4:** PASS. Commit.

### Task A4: Núcleo de chamadas (estado, quem toca, rotas internas)

**Files:**
- Create: `API/interfone/interfone.module.ts`, `API/interfone/interfone.service.ts`, `API/interfone/interfone-interno.controller.ts`, `API/interfone/voz-controle.client.ts`, `API/interfone/interfone.service.spec.ts`
- Modify: `API/app.module.ts` (import), `API/common/segredos-ssm.ts` (VOZ_* opcionais), `API/auditoria/*` (`AuditoriaAcao` += `'INTERFONE_ABRIR'`, `'INTERFONE_CONFIG'`)

**Interfaces:**
- Consumes: A1 models, A2 regras, A3 `InterfonePushService`.
- Produces: `InterfoneService.novaChamadaFacial(conta:string, numero:string): Promise<{ok:true; id:number; toque_s:number; monitores:string[]} | {ok:false; motivo:'nao_encontrado'|'indisponivel'|'limite'}>` — resolve `fac-<id>` → facial habilitado de condomínio com `contratado=1 && ativo=1` (senão `indisponivel`); limite 6/min por facial e 3 em 5 min por unidade (contar em `Interfone_Chamadas`); ramal → apartamento do condomínio com `facialAtendeBloco`; cria a chamada `chamando`; moradores = `users` com vínculo `Apartamentos_Users` na unidade e `vencimento` nulo ou ≥ hoje; `push.tocar(...)`; se ninguém tocou (`tocou===0`) chama `voz.portaria(id)` e grava `motivo_portaria='sem_app'`; dispara a foto (Task A6) sem esperar.
- Produces: `InterfoneService.evento(id, ev)` conforme o contrato: `atendida` grava `atendida_*`, estado `atendida`, manda `push.fim` aos outros e `interfone:fim` aos consoles; `toque_esgotado` → se `transferir=1` e há porteiro online → estado `portaria`, `motivo_portaria='nao_atendeu'` (mantém se já havia), emite `interfone:chamada` e devolve `{proximo:'portaria'}`, senão `{proximo:'encerrar'}`; `encerrada` grava resultado/duração, `push.fim`, `interfone:fim` e, se `nao_atendida` de facial, `push.perdida`.
- Produces: `InterfoneService.dadosParaServico(id)` (GET interno) e `contas()` (GET interno: faciais habilitados de condomínios contratados+ativos, `dtmf_modo` = `'info'` para Intelbras/Dahua, `'rfc4733'` demais; monitores ativos).
- Produces: `InterfoneService.registros(contas)` grava `interfone_registrado` (+`_em` quando passa a 1).
- Produces: `VozControleClient.portaria(id)`, `.dtmf(id, digitos)`, `.encerrar(id)` → `Promise<boolean>` (POST no controle com `x-voz-token`, timeout 5 s, nunca lança).
- Produces: `porteirosOnline(idCondominio): boolean` — via `RealtimeGateway` (sala por condomínio com sockets de porteiro); se o gateway não tiver salas por papel, acrescentar `join('portaria:<id_condominio>')` na conexão de token `tipo_sub==='funcionario_portaria'`.
- Produces: guarda `assertVozToken(header)` (timingSafeEqual com `VOZ_INTERNAL_TOKEN`, falha fechado).

- [ ] **Step 1: Testes** (prisma falso, push falso, voz falso, relógio fixo) — número sem unidade → `nao_encontrado`; módulo não contratado → `indisponivel`; 7ª chamada no mesmo minuto → `limite`; unidade com 2 moradores (1 com vínculo vencido) → `tocar` recebe só 1 id; `tocou===0` → `voz.portaria` chamado e `motivo_portaria='sem_app'`; `toque_esgotado` com `transferir=0` → `encerrar`; com porteiro online → `portaria` e evento emitido; `encerrada nao_atendida` de facial → `perdida` chamado; `atendida` duas vezes → a segunda não sobrescreve (retorna sem mudar).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar controller interno (`@Public()`, `@SkipThrottle()`, `assertVozToken`). **Step 4:** PASS + typecheck. Commit.

### Task A5: Rotas do app e da portaria (atender, recusar, abrir, ligar, histórico)

**Files:**
- Create: `API/interfone/interfone-app.controller.ts`, `API/interfone/interfone-portaria.controller.ts`, `API/interfone/interfone-acoes.spec.ts`
- Modify: `API/interfone/interfone.service.ts`, `API/facial/facial.service.ts` (`abrirDispositivoInterno` origem += `'interfone'`)

**Interfaces:**
- Consumes: A4.
- Produces: `atender(id, quem:{papel:'morador'|'portaria'; uid; nome}) : Promise<DadosEntrada>` — morador só se tem vínculo com a unidade e estado `chamando` (ou `portaria` → não); portaria só se estado `portaria` ou tipo `unidade_portaria` e é porteiro do condomínio; 409 `ja_atendida`/`encerrada`. **Não** marca atendida (quem marca é o evento do serviço quando a mídia entra); reserva por 15 s para o primeiro que pediu (coluna não necessária: cache em memória com `EstadoService`/Map) e devolve 409 `ja_atendida` a outro pedido nesse intervalo.
- Produces: `recusar(id, idUser)` — acrescenta em `recusas`; se todos os moradores que tocaram recusaram → `motivo_portaria='recusou'` e `voz.portaria(id)`.
- Produces: `abrir(id, quem)` — regras do Global Constraints; `facial.abrirDispositivoInterno(id_facial, {origem:'interfone', tipoPessoa:'visitante', nomePessoa:'Interfone '+unidade})`; se `ok:false` e `interfone_dtmf` → `voz.dtmf(id, dtmf)` (`como='dtmf'`); grava `porta_aberta_*`; auditoria `INTERFONE_ABRIR`. Permite repetir.
- Produces: `ligarPortaria(idUser, idApartamento)` (409 `portaria_indisponivel` sem porteiro online; 1 chamada ativa por usuário) e `ligarUnidade(porteiro, idApartamento)` (push `tocar` com `tipo:'portaria_unidade'`, `portao:'Portaria'`) → criam a chamada e devolvem `DadosEntrada` com `papel:'origem'`.
- Produces: `historico(idUser, idApartamento)`, `hoje(idCondominio)`, `estadoParaApp(id, idUser)`, `preferencia(get/put)`, `disponivel(idUser)`.

- [ ] **Step 1: Testes** — abrir por quem não atendeu → `{ok:false}` sem chamar `abrirDispositivoInterno`; abrir em chamada `encerrada` → recusado; abrir ok → `abrirDispositivoInterno(id_facial, ...)`; agente falhou + dtmf `'#1'` → `voz.dtmf(id,'#1')` e `porta_aberta_como='dtmf'`; dois `atender` seguidos de moradores diferentes → o segundo 409 `ja_atendida`; todos recusam → `voz.portaria` com `motivo_portaria='recusou'`; `ligarPortaria` sem porteiro → 409; morador sem vínculo → 403 em `atender`/`historico`.
- [ ] **Step 2–4:** FAIL → implementar (controllers com `UsuarioAppGuard` no app; `tipo_sub==='funcionario_portaria'` + `assertTenantStrict` no console) → PASS + typecheck. Commit.

### Task A6: Foto do visitante e retenção

**Files:**
- Create: `API/interfone/interfone-foto.service.ts` (+ spec)
- Modify: `API/interfone/interfone.service.ts`

**Interfaces:**
- Produces: `InterfoneFotoService.capturar(idChamada, device): Promise<void>` — `agent.enqueue(device.id,{type:'snapshot'})` (mesmo caminho da foto de cadastro; ver `FacialDeviceClientService` / `FabricantesService.capacidades.camera`); sucesso → `storage.uploadDataUrl(dataUrl, 'interfone')` → grava `foto`; falha → nada (log).
- Produces: `tickFotos(dias=90)` no padrão de `delivery-portao.service.ts` (`executarComLock(prisma,'interfone:fotos', ..., {intervaloMinimoMs: DIA_MS})`, `deleteUrl(foto, ['interfone'])`, `foto=null`), agendado em `onModuleInit` (pulado em `NODE_ENV==='test'`). `foto_url` nas respostas = `storage.assinarUrl(foto)`.

- [ ] **Step 1: Testes** — snapshot ok grava `foto`; agente offline não lança; `tickFotos` apaga só `created_at` < agora-90d.
- [ ] **Step 2–4:** FAIL → implementar → PASS. Commit.

### Task A7: Configuração do síndico e CRM

**Files:**
- Create: `API/interfone/interfone-sindico.controller.ts`, `API/interfone/interfone-config.service.ts` (+ spec), `API/crm/crm-interfone.controller.ts`
- Modify: `API/interfone/interfone.module.ts`, CRM module

**Interfaces:**
- Produces: rotas do síndico e CRM conforme o contrato. `PUT /ramais` rejeita ramal inválido ou duplicado (400 com a lista); `PUT /faciais/:id` valida blocos existentes no condomínio; `nova-senha` gera 24 caracteres `[A-Za-z0-9]` (`crypto.randomBytes`); senha gerada também na primeira vez que `habilitado` vira 1. CSV Intelbras: cabeçalho `Ramal;1° núm. chamado;Conta SIP;Tempo de ring;2° núm. chamado;Grupo agenda;Nome do bloco;Núm. andar` (separador `;`), uma linha por unidade dos blocos do facial com ramal: Ramal=`Bloco A · Apto 106`, 1º núm.=ramal, Conta SIP=`1`, Tempo de ring=toque_apto_s, andar = dígitos do apto sem os 2 últimos (vazio se <3 dígitos). `servidor='voz.prestarecondominios.com.br'`, `porta=5060`. Toda alteração → auditoria `INTERFONE_CONFIG`. Contratado=0 → rotas do síndico 403.

- [ ] **Step 1: Testes** — porteiro em `/config` → 403; não contratado → 403; ramal duplicado → 400; CSV de 2 unidades tem 3 linhas e o andar de `'106'` é `'1'`; `nova-senha` tem 24 caracteres; CRM sem `crm_admin` → 403.
- [ ] **Step 2–4:** FAIL → implementar → PASS + typecheck. Commit.

---

## Frente Voz (serviço + Asterisk) — branch `feat/interfone-voz`, pasta `click-cond-web/voz/`

### Task V1: Esqueleto, configuração de contas e sync

**Files:**
- Create: `voz/package.json` (`"type":"module"`, deps `ari-client`, `jsonwebtoken`; script `test` = `node --test test/`), `voz/src/config.js`, `voz/src/api.js`, `voz/src/contas.js`, `voz/test/contas.test.js`

**Interfaces:**
- Produces: `lerConfig(env): {apiBase, vozToken, tokenSecret, ariUrl, ariUser, ariPass, pjsipArquivo, controlePorta, certDir}` (falha se faltar segredo).
- Produces: `criarApi({apiBase, vozToken, fetch}): {contas(), novaChamada(conta,numero), chamada(id), evento(id,ev), registros(contas)}`.
- Produces: `renderizarPjsip(contas): string` — para cada facial/monitor: `[conta]` `type=endpoint` (`context=prestare-facial` ou `prestare-monitor`, `disallow=all`, `allow=ulaw,alaw,h264`, `dtmf_mode=<info|rfc4733>`, `direct_media=no`, `rtp_symmetric=yes`, `force_rport=yes`, `rewrite_contact=yes`, `auth=<conta>`, `aors=<conta>`), `type=auth` (`auth_type=userpass`), `type=aor` (`max_contacts=1`, `remove_existing=yes`, `qualify_frequency=30`). Ordem estável (por conta) para comparar.
- Produces: `sincronizar({api, escrever, recarregar})` — renderiza, só escreve e roda `module reload res_pjsip.so` (via ARI `asterisk/modules/res_pjsip.so` PUT) quando mudou; a cada 60 s.

- [ ] Steps: teste de `renderizarPjsip` (2 contas → texto com `[fac-12]`, `dtmf_mode=info`, `max_contacts=1`; mesma entrada em outra ordem → mesmo texto) e de `sincronizar` (não recarrega se igual) → FAIL → implementar → PASS → commit.

### Task V2: Máquina de estados da chamada (pura)

**Files:** Create `voz/src/chamada.js`, `voz/test/chamada.test.js`

**Interfaces:**
- Produces: `criarChamada({id, tipo, toqueS, toquePortariaS, maxConversaS=180, relogio}) ` com métodos que devolvem **ações** (lista de objetos) em vez de executar: `iniciar()` → `[{acao:'tocar_origem'}, {acao:'agendar', nome:'toque', s:toqueS}, ...monitores→{acao:'ligar_monitor', conta}]`; `entrou({papel, uid, canal})` → primeiro: `[{acao:'atender_origem'},{acao:'ponte', canais},{acao:'cancelar_toques'},{acao:'evento', evento:'atendida', papel, uid},{acao:'agendar', nome:'aviso', s:150},{acao:'agendar', nome:'fim', s:180}]`; segundo: `[{acao:'recusar_canal', canal}]`; `monitorAtendeu(conta, canal)` = `entrou({papel:'monitor'})`; `expirou('toque')` → `[{acao:'evento', evento:'toque_esgotado'}]`; `resposta('portaria'|'encerrar')` → portaria: `[{acao:'agendar', nome:'toque_portaria', s:toquePortariaS}]` (estado `portaria`), encerrar: `[{acao:'tocar_mensagem', som:'ninguem-atendeu'},{acao:'desligar_tudo'},{acao:'evento', evento:'encerrada', resultado:'nao_atendida'}]`; `expirou('toque_portaria')` → idem encerrar; `origemDesligou()` → `cancelada` se não atendida, senão resultado conforme quem atendeu; `participanteDesligou()` após atendida → encerra; `forcarPortaria()` (controle) → como `resposta('portaria')` com estado `portaria`; `expirou('aviso')` → `[{acao:'tocar_mensagem_ponte', som:'beep'}]`.
- Estados `chamando|portaria|atendida|encerrada`; ações depois de `encerrada` → `[]`. Para `tipo==='unidade_portaria'` o estado inicial é `portaria` e `toque_esgotado` encerra direto.

- [ ] Steps: testes cobrindo cada transição acima, incluindo dois `entrou` seguidos, `origemDesligou` durante toque (resultado `cancelada`), `expirou('toque')` depois de atendida (→ `[]`) → FAIL → implementar → PASS → commit.

### Task V3: Adaptador ARI e roteamento de canais

**Files:** Create `voz/src/ari.js`, `voz/src/servico.js`, `voz/src/index.js`, `voz/test/servico.test.js` (ARI falso)

**Interfaces:**
- Consumes: V1 `api`, V2 `criarChamada`, `verificarTokenVoz` (copiar `token-voz` da Task A2 em JS: `voz/src/token.js` com o mesmo teste de vetores).
- Produces: `criarServico({ari, api, segredo, relogio})` que trata `StasisStart` pelos `args` do dialplan:
  - `['facial', conta, numero]` → `api.novaChamada`; `ok:false` → `tocar_mensagem` (`apto-nao-encontrado`|`servico-indisponivel`|`aguarde-para-chamar`) e desliga; ok → cria chamada (`toquePortariaS` vem de `api.chamada(id)`), executa ações.
  - `['entrar', token]` → `verificarTokenVoz`; inválido → desliga; `papel==='origem'` → é a ponta que originou (console/app ligando): cria a chamada com `api.chamada(cid)`, toca de volta (ringing) e aguarda; senão `entrou(...)`.
  - `['monitor', conta]` (canal originado ao monitor que atendeu) → `monitorAtendeu`.
- Executor de ações: `tocar_origem`→`channel.ring()`; `atender_origem`→`answer()`; `ponte`→`bridges.create({type:'mixing'})` + `addChannel`; `ligar_monitor`→`channels.originate({endpoint:'PJSIP/'+conta, app:'prestare', appArgs:'monitor,'+conta, timeout:toqueS})`; `agendar`→ `setTimeout` (cancelável); `evento`→`api.evento` (resposta de `toque_esgotado` volta para `resposta(...)`); `tocar_mensagem`→`answer()`+`play({media:'sound:prestare/'+som})` e esperar `PlaybackFinished`; `desligar_tudo`→`hangup` de todos os canais da chamada.
- `ChannelDestroyed`/`StasisEnd` da origem → `origemDesligou`; do participante → `participanteDesligou`.
- `index.js` sobe ARI (`ari-client` connect com retry a cada 5 s), o sync da V1 e o controle da V4; a cada 60 s envia `api.registros` lendo `GET /ari/endpoints/PJSIP` (estado `online` = registrado).

- [ ] Steps: testes com ARI falso (objetos com `jest`-like stubs feitos à mão): facial com número inválido toca `sound:prestare/apto-nao-encontrado` e desliga sem criar chamada; token expirado desliga; fluxo completo facial → `entrar` morador → ponte criada com 2 canais e `api.evento('atendida')`; origem desliga durante toque → `api.evento(...,{evento:'encerrada', resultado:'cancelada'})` → FAIL → implementar → PASS → commit.

### Task V4: Controle HTTPS

**Files:** Create `voz/src/controle.js`, `voz/test/controle.test.js`

**Interfaces:**
- Produces: servidor `https` (cert/chave de `/etc/letsencrypt/live/voz.prestarecondominios.com.br/`) em `controlePorta` (443): `POST /controle/chamadas/:id/portaria|dtmf|encerrar` com `x-voz-token` (timingSafeEqual; sem token → 401) → `servico.forcarPortaria(id)` / `servico.dtmf(id, digitos)` (`channels.sendDTMF` na origem, `dtmf` só `[0-9*#]{1,10}`) / `servico.encerrar(id)`; chamada desconhecida → 404 `{ok:false}`. `GET /controle/saude` → 200 `{ok:true, ari:boolean}` sem token.
- [ ] Steps: testes com `http` (sem TLS no teste, injetar servidor) para 401, 404, dígitos inválidos 400, ok 200 → FAIL → implementar → PASS → commit.

### Task V5: Asterisk, coturn e implantação

**Files:**
- Create: `voz/asterisk/pjsip.conf` (transports `udp` e `tcp` 0.0.0.0:5060 com `external_media_address`/`external_signaling_address=54.21.36.213`, `local_net=172.31.0.0/16`; `wss` transport; `#include pjsip_prestare.conf`; endpoint `anonymous` com `context=prestare-entrar`, `webrtc=yes`, `allow=ulaw,alaw,opus,h264`, `max_video_streams=1`), `voz/asterisk/extensions.conf` (`[prestare-facial] exten => _X.,1,Stasis(prestare,facial,${CHANNEL(endpoint)},${EXTEN})`; `[prestare-entrar] exten => entrar,1,Stasis(prestare,entrar,${PJSIP_HEADER(read,X-Prestare-Token)})`; `[prestare-monitor]` → `Hangup()`), `voz/asterisk/http.conf` (TLS 8089 com o cert do certbot; HTTP ARI só em 127.0.0.1:8088), `voz/asterisk/ari.conf` (usuário `prestare`, senha de `VOZ_ARI_SENHA`), `voz/asterisk/rtp.conf` (10000–20000, `icesupport=yes`, `stunaddr` vazio), `voz/asterisk/modules.conf` (autoload, `noload` de chan_sip se existir), `voz/coturn/turnserver.conf` (`use-auth-secret`, `static-auth-secret` do ambiente, `realm=voz.prestarecondominios.com.br`, `listening-port=3478`, `min-port=50000`, `max-port=50999`, `external-ip=54.21.36.213`, `no-cli`, `fingerprint`), `voz/deploy/instalar.sh` (copia configs, substitui segredos lidos do SSM `/prestare/voz/*`, `npm ci --omit=dev`, systemd `prestare-voz.service`, `systemctl restart asterisk coturn prestare-voz`, renova cert com hook que recarrega asterisk), `voz/deploy/prestare-voz.service`, `.github/workflows/deploy-voz.yml` (push em `main` com paths `click-cond-web/voz/**`: tar → `s3://prestare-arquivos-850401152034/deploy/voz/voz-<sha>.tgz` → `aws ssm send-command` na instância `i-0bdd877976ff40bf6` rodando `instalar.sh <sha>` → espera e falha se o comando falhar; depois `curl https://voz.prestarecondominios.com.br/controle/saude`).
- [ ] Steps: `bash -n` nos scripts; teste `voz/test/configs.test.js` que lê os `.conf` e confere as linhas-chave (contexto `prestare-entrar` com `X-Prestare-Token`, `max_contacts` vem só do render, faixa RTP 10000–20000, `use-auth-secret`) → commit. A execução na EC2 é a Task I1 (controlador).

### Task V6: Sons em português

**Files:** Create `voz/sons/README.md` (como gerar), script `voz/deploy/gerar-sons.sh` (Amazon Polly voz `Camila`, `--output-format pcm --sample-rate 8000` → `sox` para `ulaw` em `/usr/share/asterisk/sounds/pt_BR/prestare/` e link em `sounds/prestare/`).
Textos: `apto-nao-encontrado` = "Apartamento não encontrado. Confira o número e tente de novo."; `servico-indisponivel` = "O interfone está indisponível no momento."; `ninguem-atendeu` = "Ninguém atendeu. Tente novamente mais tarde."; `aguarde-para-chamar` = "Aguarde um pouco para chamar novamente."; `beep` = tom curto (sox `synth 0.2 sine 1000`).
- [ ] Steps: script com `bash -n`; commit. Execução na I1.

---

## Frente Console e CRM — branch `feat/interfone-web`

### Task W1: Serviço de interfone, cliente SIP e store

**Files:**
- Create: `WEB/interfone/interfone.api.ts`, `WEB/interfone/sip-voz.ts`, `WEB/interfone/interfone.store.ts`, `WEB/interfone/interfone.testing.ts`, `WEB/interfone/interfone.store.spec.ts`
- Modify: `click-cond-web/package.json` (dep `jssip`), `WEB/shared/realtime.service.ts` (expor `on(evento, cb)` se não existir)

**Interfaces:**
- Produces: `InterfoneApi` (root) com os métodos do contrato "Console" e "Síndico" (Observables).
- Produces: `SipVoz.entrar(d: DadosEntrada, video: HTMLVideoElement, audio: HTMLAudioElement): Promise<SessaoVoz>` (JsSIP `UA` sem registro — `register:false`, socket `d.wss`; `ua.call(d.sip_uri, {extraHeaders:['X-Prestare-Token: '+d.token], pcConfig:{iceServers:d.ice}, mediaConstraints:{audio:true, video:false}, rtcOfferConstraints:{offerToReceiveAudio:true, offerToReceiveVideo:true}})`; `SessaoVoz {encerrar(); mudo(b); estado: 'conectando'|'em_chamada'|'encerrada'; aoEncerrar(cb)}`.
- Produces: `InterfoneStore` (root, signals): `tocando = signal<ChamadaConsole[]>([])`, `emChamada = signal<ChamadaConsole|null>(null)`, `ativo = signal(false)`; `iniciar()` assina `interfone:chamada` / `interfone:fim` do `RealtimeService` (gravando em signals), `atender(id)`, `encerrar()`, `abrir()`, `ligar(idApartamento)`. Toque: `new Audio('/assets/interfone/toque.mp3')` em loop enquanto `tocando().length>0`.
- [ ] Steps: testes do store com stubs (evento `interfone:chamada` → `tocando()` tem 1; `interfone:fim` do mesmo id → vazio; `atender` chama `InterfoneApi.atender` e `SipVoz.entrar` e move para `emChamada`) → FAIL → implementar → PASS (`npx jest -c apps/portaria-web/jest.config.cts interfone`) → commit.

### Task W2: Painel de chamada na portaria e botão Ligar

**Files:**
- Create: `WEB/interfone/painel-chamada.component.ts` (+ spec), `WEB/interfone/ligar-unidade.component.ts`, `WEB/interfone/chamadas-hoje.component.ts`, `public/assets/interfone/toque.mp3` (tom gerado por sox, 2 s)
- Modify: shell (montar `app-painel-chamada` fixo quando porteiro e módulo ativo), `WEB/dashboard/dashboard-page.component.*` (seção "Interfone": `app-ligar-unidade` com busca de unidade + `app-chamadas-hoje`)

**Interfaces:** Consumes W1. Painel Prestare Dark: foto (se houver), unidade, motivo ("Morador não atendeu" / "Morador recusou" / "Ninguém da unidade recebe chamadas" / "Morador ligando"), botões ATENDER / ABRIR PORTÃO (só chamada de facial atendida) / ENCERRAR, `<video>` do facial, contador. Aviso no topo se o navegador negou microfone ou se o socket caiu ("Você não vai receber chamadas do interfone").
- [ ] Steps: spec do painel (chamada tocando mostra ATENDER e o motivo; em chamada de facial mostra ABRIR PORTÃO; chamada `unidade_portaria` não mostra ABRIR) → FAIL → implementar → PASS → `npx tsc -p apps/portaria-web/tsconfig.app.json --noEmit` → commit.

### Task W3: Aba Interfone em Configurações (síndico) e toggle no CRM

**Files:**
- Create: `WEB/configuracoes/interfone/interfone-config.component.ts` (+ html, spec), `click-cond-web/apps/crm-web/src/app/crm/tabs/crm-interfone.component.ts` (+ html) e serviço
- Modify: `WEB/configuracoes/configuracoes-page.component.*` (aba `'interfone'` só se `GET /interfone/config` → `contratado`), rotas/abas do CRM

**Interfaces:** Seções: Módulo (liga/desliga, tempos, transferir), Faciais (habilitar, blocos, DTMF, dados para o instalador com copiar, status Registrado/Não registrado, baixar lista telefônica, nova senha com confirmação), Ramais (tabela com sugestão e conflito em destaque, salvar), Monitores IP (lista, adicionar, remover, dados de registro). CRM: tabela de clientes com checkbox Contratado (`confirm()` ao ligar, toast).
- [ ] Steps: spec (não contratado → aba some; conflito de ramal aparece destacado e bloqueia salvar) → FAIL → implementar → PASS + tsc → commit.

---

## Frente App (Flutter) — branch `feat/interfone-app-mobile`

### Task M1: Dependências, permissões e registro do aparelho

**Files:**
- Modify: `APP/pubspec.yaml` (`flutter_callkit_incoming`, `sip_ua`, `flutter_webrtc` — versões estáveis atuais compatíveis com Flutter 3.41.9), `APP/android/app/src/main/AndroidManifest.xml` (`USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`, `MANAGE_OWN_CALLS`, `WAKE_LOCK`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT`, `CAMERA` não), `APP/ios/Runner/Info.plist` (`UIBackgroundModes` = `voip`, `audio`, `remote-notification`; `NSMicrophoneUsageDescription` = "O Prestare usa o microfone para você conversar com quem chama no interfone e no assistente por voz."), `APP/ios/Runner/AppDelegate.swift` (PushKit: `PKPushRegistry` voip; `didUpdate` → canal; `didReceiveIncomingPushWith` → `SwiftFlutterCallkitIncomingPlugin.sharedInstance?.showCallkitIncoming(..., fromPushKit: true)` **sempre**, depois `completion()`), `APP/lib/services/firebase_service.dart` (`_registrarNoServidor`: `voip_token` e `'interfone_versao': 1`)
- Create: `APP/lib/services/interfone/interfone_api.dart`, `APP/test/interfone/interfone_api_test.dart`

**Interfaces:**
- Produces: `InterfoneApi` (estático, usa `ApiClient`/`ApiConfig.buildUri`): `disponivel() → Future<bool>`, `estado(int id) → Future<EstadoChamada?>`, `atender(int id) → Future<DadosEntrada?>` (null em 409), `recusar(int id)`, `abrir(int id) → Future<({bool ok, String? motivo})>`, `ligarPortaria(int idApartamento) → Future<DadosEntrada?>`, `historico(int idApartamento)`, `preferencia()`/`definirPreferencia(bool)`; modelos `EstadoChamada`, `DadosEntrada` (`fromJson` do contrato).
- [ ] Steps: teste com `ApiClient.client` falso (409 em atender → null; JSON do contrato → modelos) → FAIL → implementar → PASS (`flutter test test/interfone`) → `flutter analyze --no-fatal-infos --no-fatal-warnings` → commit.

### Task M2: Chamada entrando (tela nativa, estado, encerrar)

**Files:**
- Create: `APP/lib/services/interfone/interfone_chamadas.dart`, `APP/test/interfone/interfone_chamadas_test.dart`
- Modify: `APP/lib/services/firebase_service.dart` (background e foreground: `type=='interfone_chamada'` → `InterfoneChamadas.mostrarEntrando(data)`; `interfone_fim` → `encerrarTela(id)`; `interfone_perdida` → notificação comum já existente), `APP/lib/main.dart` (iniciar listeners de `FlutterCallkitIncoming.onEvent`)

**Interfaces:**
- Produces: `InterfoneChamadas.mostrarEntrando(Map<String,dynamic> data)` (`CallKitParams` com `id` = uuid determinístico do id da chamada, `nameCaller` = portão, `handle` = unidade, `appName:'Prestare'`, `duration: 60000`, Android `isShowFullLockedScreen:true`, `ringtonePath:'system_ringtone_default'`, `backgroundColor:'#0B0F14'`; extra `{id}`); enquanto toca, consulta `InterfoneApi.estado(id)` a cada 2 s e fecha a tela (`endCall`) se `estado != 'chamando'` ou `atendida_por_mim==false && estado=='atendida'`; evento `actionCallAccept` → abre `TelaChamada(id)` pelo `NavigationService.navigatorKey`; `actionCallDecline` → `InterfoneApi.recusar(id)`.
- Produces: helper puro `bool deveFecharTela(EstadoChamada e)` (testável).
- [ ] Steps: teste de `deveFecharTela` (chamando → false; atendida por outro → true; encerrada → true; portaria → true) → FAIL → implementar → PASS → commit.

### Task M3: Tela da chamada (WebRTC/SIP, abrir) e Ligar para a portaria

**Files:**
- Create: `APP/lib/pages/shared/interfone/tela_chamada.dart`, `APP/lib/services/interfone/sip_voz.dart`, `APP/lib/pages/shared/interfone/historico_interfone.dart`, `APP/test/interfone/tela_chamada_test.dart`
- Modify: home/menu do morador (botão "Ligar para a portaria" e "Interfone" no histórico quando `disponivel()`), página de configurações (switch "Receber chamadas do portão")

**Interfaces:**
- Produces: `SipVoz.entrar(DadosEntrada d, {required RTCVideoRenderer video}) → Future<SessaoVoz>` (`sip_ua` `SIPUAHelper` sem registro: `UaSettings` com `webSocketUrl=d.wss`, `register=false`, `iceServers=d.ice`, `transportType=TransportType.WS`; `helper.call(d.sip_uri, voiceOnly:false, mediaStream: áudio só)` com cabeçalho `X-Prestare-Token`; vídeo só de recebimento); `SessaoVoz { encerrar(); mudo(bool); altoFalante(bool); Stream<String> estado }`.
- Produces: `TelaChamada({required int id, DadosEntrada? jaConectado})` — Prestare Dark: vídeo em cima (placeholder com a foto enquanto conecta), unidade e portão, cronômetro, botões MUDO, ALTO-FALANTE, ABRIR PORTÃO (só `tipo=='facial_unidade'`), ENCERRAR; ao abrir chama `atender` (null → "Já atendida em outro aparelho" e fecha); ABRIR mostra "Portão aberto" ou "Não foi possível abrir: <motivo>"; ao sair encerra a sessão e `FlutterCallkitIncoming.endCall`. Permissão de microfone pedida antes de conectar (negada → mensagem e sai).
- [ ] Steps: widget test com `SipVoz` e `InterfoneApi` falsos (ABRIR só aparece para `facial_unidade`; 409 mostra a mensagem) → FAIL → implementar → PASS → `flutter analyze` → `flutter build apk --debug --target-platform android-x64` ok → commit.

---

## Frente Agente — depois da bancada (28/11)

### Task G1: Configuração automática do SS 3532 (condicional)

Só começa com o SS 3532 ligado e a descoberta, na bancada, dos nomes de configuração (`configManager.cgi?action=getConfig&name=SIP` e da lista telefônica). Se o aparelho não aceitar por essa interface, a tarefa vira "não suportado" e fica a configuração manual (CSV + dados na tela).
**Files:** `agent/src/drivers/dahua-facial.js` (`configurarInterfone(device, {servidor, porta, conta, senha, contatos})`), `API/facial/agent-bridge.service.ts` (`AgentCommandType` += `'interfone_config'`, fator 5/3), `API/interfone/interfone-config.service.ts` (enfileira ao habilitar/alterar ramais/blocos), `agent/harness/mock-device.js`, `agent/test/drivers-dahua-facial.test.js`, `agent/src/versao.js`.

---

## Integração, implantação e testes de ponta a ponta (controlador)

### Task I1: Servidor de voz no ar
- [ ] Parâmetros SSM `/prestare/voz/VOZ_TOKEN_SECRET`, `VOZ_INTERNAL_TOKEN`, `VOZ_TURN_SECRET`, `VOZ_ARI_SENHA` (SecureString, 32+ caracteres aleatórios) e os mesmos três primeiros para a API (prefixo lido pelo `segredos-ssm.ts`); papel da EC2 ganha `ssm:GetParameter` em `/prestare/voz/*`.
- [ ] `certbot certonly --standalone -d voz.prestarecondominios.com.br` via SSM; hook de renovação.
- [ ] Gerar os sons (V6) no CloudShell com Polly e enviar ao S3 `deploy/voz/sons/`.
- [ ] Primeiro deploy (V5) por SSM; `asterisk -rx "pjsip show transports"` mostra udp/tcp/wss; `curl https://voz.prestarecondominios.com.br/controle/saude` → `{"ok":true,"ari":true}`.

### Task I2: Publicar API, console e SQL
- [ ] SQL `2026-11-27-interfone.sql` no RDS (CloudShell + túnel), depois `-verificacao.sql` só com `OK`.
- [ ] Juntar `feat/interfone-api` e `feat/interfone-web` em `feat/interfone-app`; suítes verdes (`npx nx test @org/api`, `npx jest -c apps/portaria-web/jest.config.cts`, typecheck API, `tsc` web); revisão final; push em `main` e `master`; conferir "Versão esperada/no ambiente" do `deploy-api.yml` e o Amplify.
- [ ] Ligar o módulo só no condomínio 1 (Boa Vista): `interfone_contratado=1`, `interfone_ativo=1`; ramal do Apto 106 Bloco A; dispositivo de teste `TESTE CLAUDE Facial Interfone` (tipo facial, inativo para acesso) habilitado para o interfone.

### Task I3: Ponta a ponta sem facial
- [ ] Facial simulado: `pjsua` (ou `baresip`) na própria EC2 registrando como `fac-<id>` e discando o ramal, com vídeo de arquivo; ou canal `Local` que entra em `prestare-facial` com a conta do dispositivo de teste.
- [ ] App no emulador Android (`flutter build apk --debug --target-platform android-x64`, `adb install`), logado como morador do 106: toca com app fechado, atende, vídeo/áudio, ABRIR responde, encerrar; recusar → console toca; ligar para a portaria; porteiro liga para a unidade.
- [ ] Console no Chrome (logado como porteiro e como síndico): painel, atender, abrir, encerrar, aba Interfone (ramais, faciais, monitores), CRM toggle.

### Task I4: Bancada com SS 3532 (28/11)
- [ ] Cadastrar o SS 3532, registrar na central (manual ou G1), lista telefônica, discar o 106, conferir vídeo H.264, abrir pelo agente e por DTMF, transferência, tempos, limites.
