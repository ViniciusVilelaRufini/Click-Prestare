# Portaria autônoma — Entrega 1 (central humana) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Condomínios com central contratada passam a ter a chamada não atendida, o "0 = portaria" do facial e o pânico do Guarita atendidos por operadores da Prestare numa área Central multi-condomínio, com pedido de autorização ao morador que abre o portão uma vez.

**Architecture:** A API decide o destino (`local` ou `central`) por agenda do condomínio com salvaguarda de presença; o Socket.IO ganha adaptador Redis para funcionar com várias instâncias e uma sala `central`; o serviço `voz` aceita o papel `central` e o tipo `facial_portaria`; o console web ganha a área `/central` com login próprio; o app ganha a tela do pedido do portão. Tudo desligado por padrão (`central_contratada = 0`).

**Tech Stack:** NestJS + Prisma (MySQL/RDS), Socket.IO 4 + `@socket.io/redis-adapter` + `redis` (ElastiCache Serverless Valkey), Angular zoneless (signals) + JsSIP, Node (ari-client) no `voz`, Flutter.

**Spec:** `docs/superpowers/specs/2026-11-28-portaria-autonoma-design.md` (seções 1, 2, 4, 5, 5b, 6, 6b e "Pedido do portão").

## Global Constraints

- Tudo desligado por padrão: sem `Condominios.central_contratada = 1` o comportamento é idêntico ao de hoje.
- `central_contratada` só liga no CRM com `interfone_contratado = 1`; chamada só flui com `interfone_ativo = 1`.
- Sem faixas na agenda = `local`; hora sempre de Brasília (`America/Sao_Paulo`).
- Em horário `central` com porteiro conectado: toca nos dois; primeiro a atender leva.
- Com `central_contratada = 1`, transferir quando ninguém atende é sempre ligado (o ajuste do síndico fica travado: "incluído no contrato da central").
- Operador vê só: condomínio, portão, unidade, primeiro nome dos moradores, convites/entregas esperados hoje, `instrucao_entregas`, estado do pedido. Nunca telefone, documento, e-mail.
- Operador abre portão só com motivo obrigatório; auditoria com operador e condomínio.
- Pedido do portão: não cria visitante, não libera PIN nem rosto; autorizar abre o portão do facial da chamada **uma vez**, se a chamada está ativa ou terminou há ≤ 5 min.
- `interfone_numero_portaria` padrão `'0'`.
- SQL aditivo em `click-cond-web/prisma/sql/2026-11-28-portaria-autonoma.sql` + `-verificacao.sql`, aplicado no RDS antes do deploy.
- Textos em pt-BR; visual Prestare Dark do console; mensagens de commit em pt-BR com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Publicar em `main` e `master`; ligar só no Boa Vista (id 1). App: Android no emulador; iPhone só compila (sem TestFlight).

## Review Focus

1. API com 2 instâncias: chamada criada numa instância, operador conectado na outra → precisa tocar (adaptador Redis; `centralOnline`/`porteirosOnline` via `fetchSockets`). Teste: Task 2 (unidade) + Task 13 (verificação com 2 instâncias).
2. Agenda cruzando a meia-noite (22:00–24:00 + 00:00–06:00): 23:59 e 00:00 são `central`, 06:00 é `local`. Teste: Task 3.
3. Token de operador usado nas rotas de condomínio (`interfone/portaria/*`, telas do síndico) → 403; token de porteiro nas rotas `central/*` → 403. Teste: Task 6.
4. Pedido autorizado duas vezes, depois de 5 min, ou por morador de outra unidade → não abre (403/409). Teste: Task 8.
5. Porteiro do prédio e operador atendem a mesma chamada ao mesmo tempo → só um vence; o outro recebe 409 `atendida_por_outro`. Teste: Task 7.

---

### Task 1: Banco — SQL aditivo e Prisma

**Files:**
- Create: `click-cond-web/prisma/sql/2026-11-28-portaria-autonoma.sql`, `click-cond-web/prisma/sql/2026-11-28-portaria-autonoma-verificacao.sql`
- Modify: `click-cond-web/prisma/schema.prisma` (`Condominios` ~330, `Interfone_Chamadas` ~2342, novos models)

**Interfaces:**
- Produces (Prisma):
  - `Condominios`: `central_contratada Int @default(0) @db.TinyInt`, `ia_portao_ativa Int @default(0) @db.TinyInt`, `instrucao_entregas String? @db.Text`, `interfone_numero_portaria String @default("0") @db.VarChar(8)`.
  - `Portaria_Agenda { id Int @id @default(autoincrement()); id_condominio Int; dia_semana Int @db.TinyInt /*0=domingo*/; inicio String @db.Char(5) /*HH:MM*/; fim String @db.Char(5) /*HH:MM ou 24:00*/; destino String @db.VarChar(8) /*local|central*/; created_at DateTime @default(now()) }` + FK `Condominios` ON DELETE CASCADE + índice `(id_condominio, dia_semana)`.
  - `Central_Operadores { id; nome VarChar(120); email VarChar(190) @unique; senha_hash VarChar(100); trocar_senha Int @default(1) @db.TinyInt; ativo Int @default(1) @db.TinyInt; cred VarChar(32) /*carimbo: troca ao mudar senha/desativar*/; ultimo_acesso DateTime?; created_at }`.
  - `Interfone_Pedidos { id; id_chamada Int; id_condominio Int; id_apartamento Int; nome_falado VarChar(120); motivo VarChar(255)?; tipo VarChar(10) /*visita|entrega|servico|outro*/; origem VarChar(10) /*central|ia*/; foto VarChar(255)?; estado VarChar(10) @default("pendente") /*pendente|autorizado|negado|expirado*/; mensagem VarChar(120)?; respondido_por_id Int?; respondido_por_nome VarChar(120)?; respondido_em DateTime?; created_at }` + FKs (chamada CASCADE, condomínio CASCADE, apartamento CASCADE) + índices `(id_chamada)`, `(id_apartamento, created_at)`.
  - `Interfone_Chamadas`: `id_operador_central Int?`, `ia_resumo String? @db.Text`, `ia_transcricao String? @db.MediumText`. `tipo` passa a aceitar `facial_portaria`; `atendida_por_tipo` aceita `central`; `resultado` aceita `atendida_central` (só comentários; colunas VarChar já comportam).

- [ ] **Step 1:** Escrever o SQL idempotente no padrão de `prisma/sql/2026-11-27-interfone.sql` (cada `ALTER`/`CREATE` guardado por consulta ao `information_schema` via `PREPARE`), e o `-verificacao.sql` no padrão `UNION ALL ... 'OK'|'FALTA'` cobrindo cada coluna/tabela nova.
- [ ] **Step 2:** Atualizar `schema.prisma` com os campos acima e rodar `npx prisma validate` e `npx prisma generate` (em `click-cond-web`). Esperado: sem erros.
- [ ] **Step 3:** `npx tsc -p apps/api/tsconfig.app.json --noEmit`. Esperado: exit 0.
- [ ] **Step 4:** Commit `feat(portaria-autonoma): tabelas e colunas da central (SQL aditivo + prisma)`.

---

### Task 2: Tempo real — adaptador Redis, sala `central` e papel do operador

**Files:**
- Modify: `click-cond-web/apps/api/src/app/realtime/realtime.gateway.ts` (94–154), `click-cond-web/apps/api/src/app/auth/jwt-payload.interface.ts`, `click-cond-web/package.json` (deps `@socket.io/redis-adapter`, `redis`)
- Create: `click-cond-web/apps/api/src/app/realtime/redis-adapter.ts`
- Test: `click-cond-web/apps/api/src/app/realtime/realtime.gateway.spec.ts` (criar ou estender)

**Interfaces:**
- Produces:
  - `JwtPayload.papel?: 'operador_central'`.
  - `export const SALA_CENTRAL = 'central'`.
  - `RealtimeGateway.emitirCentral(evento: string, dados: unknown): void`.
  - `RealtimeGateway.centralOnline(): Promise<boolean>` (via `this.server.in(SALA_CENTRAL).fetchSockets()`, nunca lança).
  - `criarAdaptadorRedis(url: string | undefined): Promise<ReturnType<typeof createAdapter> | null>` em `redis-adapter.ts`: `null` quando `REDIS_URL` vazio; senão `createClient({ url })` (aceita `rediss://`), `duplicate()`, `connect()` nos dois, `createAdapter(pub, sub)`. Erro de conexão: loga e devolve `null` (fica em memória, como hoje).
  - `afterInit(server)` aplica o adaptador quando não for `null`.

- [ ] **Step 1: testes que falham**
  - `operador_central sem id_condominio conecta e entra na sala central` (payload `{sub:7, papel:'operador_central', cred:'x'}` → `client.join('central')`, sem `disconnect`).
  - `token sem id_condominio e sem papel continua desconectado`.
  - `porteiro continua entrando em condominio:<id> e portaria:<id>` (regressão).
  - `centralOnline usa fetchSockets da sala central e devolve false em erro`.
  - `criarAdaptadorRedis(undefined) devolve null`; `criarAdaptadorRedis('rediss://x') com createClient simulado devolve adaptador`.
- [ ] **Step 2:** Rodar `npx jest -c apps/api/jest.config.cts apps/api/src/app/realtime` → FAIL.
- [ ] **Step 3:** Implementar. A conferência de token (`conferir`) continua passando por `JwtStrategy.validate` (Task 6 ensina o `validate` a tratar `papel: 'operador_central'`). Atualizar o comentário do arquivo (não assume mais réplica única).
- [ ] **Step 4:** Testes → PASS; `tsc --noEmit` → 0.
- [ ] **Step 5:** Commit `feat(realtime): adaptador Redis opcional e sala central do operador`.

---

### Task 3: Destino da portaria (agenda + salvaguarda)

**Files:**
- Create: `click-cond-web/apps/api/src/app/interfone/destino-portaria.ts`, `.../destino-portaria.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone.service.ts` (novo método)

**Interfaces:**
- Produces:
  - `export type DestinoPortaria = 'local' | 'central'`.
  - `export interface FaixaAgenda { dia_semana: number; inicio: string; fim: string; destino: DestinoPortaria }`.
  - `export function agoraEmBrasilia(agora: Date): { diaSemana: number; minutos: number }` (via `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ... })`).
  - `export function decidirDestino(centralContratada: boolean, faixas: FaixaAgenda[], momento: { diaSemana: number; minutos: number }, porteiroOnline: boolean): DestinoPortaria` — regras da spec seção 1 (sem contrato → local; faixa central → central; senão sem porteiro → central; senão local). Faixa vale quando `inicio <= minutos < fim` (`24:00` = 1440).
  - `export function validarAgenda(faixas: FaixaAgenda[]): string | null` — erro em pt-BR para HH:MM inválido, `inicio >= fim`, sobreposição no mesmo dia, `destino` fora de `local|central`.
  - `InterfoneService.destinoPortaria(idCondominio: number, agora = new Date()): Promise<DestinoPortaria>` (lê `central_contratada`, faixas do dia, `porteirosOnline`).

- [ ] **Step 1: testes que falham** (`destino-portaria.spec.ts`)
  - `sem central contratada é sempre local` (mesmo com faixa central e sem porteiro).
  - `faixa central vence porteiro online`.
  - `faixa local com porteiro online fica local`; `faixa local sem porteiro vira central (salvaguarda)`.
  - `sem faixas, contratada e sem porteiro → central`; `sem faixas com porteiro → local`.
  - `meia-noite`: faixas dom `22:00–24:00 central` e seg `00:00–06:00 central`; dom 23:59 → central, seg 00:00 → central, seg 06:00 com porteiro → local.
  - `agoraEmBrasilia(new Date('2026-11-29T02:30:00Z'))` → `{ diaSemana: 6, minutos: 1410 }` (sábado 23:30).
  - `validarAgenda` rejeita `'25:00'`, `inicio==fim`, sobreposição `08:00–12:00` com `11:00–13:00`.
- [ ] **Step 2:** `npx jest ... destino-portaria` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(interfone): destino da portaria por agenda com salvaguarda`.

---

### Task 4: Roteamento da chamada não atendida e `facial_portaria` na API

**Files:**
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone.service.ts` (`novaChamadaFacial` 273, `transferirSemApp` 389, `toqueEsgotado` 454, `emitirChamadaPortaria` 481, `avaliarRecusas` 662, `carregar` 738, `RESULTADOS` 38, `PAPEIS_ATENDE` 41, `nomeDe` 704)
- Test: `click-cond-web/apps/api/src/app/interfone/interfone.service.spec.ts`

**Interfaces:**
- Consumes: `destinoPortaria` (Task 3), `emitirCentral`/`centralOnline` (Task 2).
- Produces:
  - `RESULTADOS` += `'atendida_central'`; `PAPEIS_ATENDE` += `'central'`.
  - `NovaChamadaFacial` ok ganha `tipo: 'facial_unidade' | 'facial_portaria'` e `estado: 'chamando' | 'portaria'`.
  - `private async encaminharSemResposta(c: ChamadaCarregada, motivo: MotivoPortaria): Promise<'portaria' | 'encerrar'>` usado por `transferirSemApp`, `toqueEsgotado` e `avaliarRecusas`:
    - `local`: regra de hoje (`interfone_transferir === 1 && porteirosOnline`).
    - `central`: ignora `interfone_transferir`; se `porteirosOnline` emite na sala do prédio **e** sempre emite `emitirCentral('interfone:chamada', ChamadaCentralEvento)`; se ninguém online (nem porteiro nem `centralOnline`) → `'encerrar'` e loga `[central] sem_operador condominio=<id> chamada=<id>` (formato EMF de métrica `CentralSemOperador` no namespace `Prestare/Interfone`).
  - `export interface ChamadaCentralEvento { id; tipo; unidade; motivo: string | null; morador_nome: string | null; foto_url: string | null; id_condominio: number; condominio: string; portao: string | null; criada_em: string }`.
  - `MotivoPortaria` += `'portaria'` (visitante discou a portaria).
  - `novaChamadaFacial`: antes de `ramalValido`, se `numero === condominio.interfone_numero_portaria` → cria `tipo:'facial_portaria', estado:'portaria', motivo_portaria:'portaria'`, sem apartamento; destino `local` exige porteiro online, `central` exige porteiro ou operador online; ninguém → `{ok:false, motivo:'indisponivel'}`; senão emite como acima e devolve `{ok:true, tipo:'facial_portaria', estado:'portaria', toque_s: 0, monitores: []}`.
  - `nomeDe('central', uid)` → `central_Operadores.nome`.
  - `carregar` passa a trazer `condominio.central_contratada`, `condominio.interfone_numero_portaria`, `condominio.nome`.

- [ ] **Step 1: testes que falham**
  - `central_contratada=0: toque esgotado segue a regra de hoje` (regressão com `interfone_transferir=0` → encerrar).
  - `destino central com interfone_transferir=0 transfere mesmo assim e emite na sala central`.
  - `destino central com porteiro online emite nas duas salas`.
  - `destino central sem ninguém online encerra e registra sem_operador`.
  - `todos recusaram em condomínio central vai para a central` (`avaliarRecusas`).
  - `discar o número da portaria cria facial_portaria em estado portaria sem apartamento`.
  - `número da portaria sem ninguém online responde indisponivel`.
  - `ramal comum continua facial_unidade` (regressão).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npx jest -c apps/api/jest.config.cts apps/api/src/app/interfone` → PASS (todas as suítes do interfone).
- [ ] **Step 5:** Commit `feat(interfone): chamada sem resposta e "0 = portaria" seguem o destino (local ou central)`.

---

### Task 5: Serviço `voz` — papel `central` e tipo `facial_portaria`

**Files:**
- Modify: `click-cond-web/voz/src/token.js` (13), `click-cond-web/voz/src/chamada.js` (`TIPOS`, `PODE_ENTRAR` ~63, `RESULTADO_POR_PAPEL`), `click-cond-web/voz/src/servico.js` (`facial` 329–380), `click-cond-web/apps/api/src/app/interfone/token-voz.ts` (19, 43)
- Test: `click-cond-web/voz/test/chamada.test.js`, `voz/test/servico.test.js`, `voz/test/token.test.js`, `apps/api/src/app/interfone/token-voz.spec.ts`

**Interfaces:**
- Produces:
  - `PapelVoz` / `PAPEIS` (API e `voz/src/token.js`) += `'central'`.
  - `chamada.js`: `TIPOS` += `facial_portaria` (nasce em `portaria`, origem = canal do facial, como `unidade_portaria` mas com vídeo e `atender_origem` ao entrar); `PODE_ENTRAR.central = 'portaria'`; `RESULTADO_POR_PAPEL.central = 'atendida_central'`.
  - `servico.facial` usa `dados.tipo` da API (não fixa mais `'facial_unidade'`); para `facial_portaria` inicia direto em `portaria` com `toquePortariaS`.

- [ ] **Step 1: testes que falham**
  - `token com papel central é aceito`; `papel desconhecido continua recusado`.
  - `facial_portaria nasce em portaria e só aceita central ou portaria`; `morador não entra em facial_portaria`.
  - `central atendendo grava atendida_central`.
  - `facial() com resposta tipo facial_portaria não toca morador e agenda toque_portaria`.
- [ ] **Step 2:** `cd click-cond-web/voz && npm test` → FAIL. API: `npx jest ... token-voz` → FAIL.
- [ ] **Step 3:** Implementar. **Step 4:** PASS nos dois.
- [ ] **Step 5:** Commit `feat(voz): papel central e chamada facial → portaria`.

---

### Task 6: Login do operador da central (API)

**Files:**
- Create: `click-cond-web/apps/api/src/app/central/central.module.ts`, `central-auth.controller.ts`, `central-auth.service.ts`, `central-auth.service.spec.ts`, `operador.util.ts`
- Modify: `click-cond-web/apps/api/src/app/auth/jwt.strategy.ts` (`validate` 70), `click-cond-web/apps/api/src/app/auth/tenant.guard.ts`, `click-cond-web/apps/api/src/app/app.module.ts` (importar `CentralModule`)

**Interfaces:**
- Produces:
  - `POST central/auth/login {email, senha}` (`@Public`, throttle 5/min) → `{ desafio: string, email_mascarado: string }` quando senha confere (código de 6 dígitos por e-mail, 10 min, 5 tentativas), 401 genérico caso contrário.
  - `POST central/auth/verificar {desafio, codigo}` → `{ access_token, nome, trocar_senha: boolean }`. Token: `{ sub: operador.id, nome, papel: 'operador_central', cred }`, validade 12 h.
  - `POST central/auth/senha {senha_atual, senha_nova}` (token de operador) → troca, zera `trocar_senha`, troca `cred`.
  - Código guardado no estado compartilhado já usado pelo `AuthService` (`mfa-console:` → usar prefixo `mfa-central:`); envio pelo mesmo serviço de e-mail que o `MfaService` usa.
  - `export function operadorDoToken(user: JwtPayload): { uid: number; nome: string }` — lança 403 se `papel !== 'operador_central'`.
  - `JwtStrategy.validate`: `papel === 'operador_central'` → `operadorAtivo(sub, cred)` (`ativo = 1` e `cred` igual; cache 30 s, como `porteiroAtivo`).
  - `TenantGuard`: deixa passar token de operador (ele não tem `id_condominio`); as rotas de condomínio continuam protegidas por `requireTenant`/`idFuncionarioPortariaDoToken`, que recusam o operador.

- [ ] **Step 1: testes que falham**
  - `login com senha certa cria desafio e manda e-mail`; `senha errada e e-mail inexistente dão o mesmo 401`; `operador inativo dá 401`.
  - `verificar com código certo devolve token com papel operador_central e sem id_condominio`; `6ª tentativa errada invalida o desafio`.
  - `validate recusa operador desativado ou com cred trocado`.
  - **Review Focus 3:** `token de operador em GET interfone/portaria/hoje → 403`; `token de porteiro em GET central/fila → 403` (este segundo fica pronto na Task 7; aqui testar `operadorDoToken` com token de porteiro → 403).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (hash com `bcrypt`, mesmo custo do resto da API). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(central): login do operador com código por e-mail`.

---

### Task 7: API da central (fila, atender, abrir com motivo, contexto, ligar, histórico, alertas)

**Files:**
- Create: `click-cond-web/apps/api/src/app/central/central.controller.ts`, `central.service.ts`, `central.service.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone-acoes.service.ts` (`Quem` 49, `atender` 115, `abrir` 177, `encerrarPortaria` 238, `ligarUnidade` 300), `click-cond-web/apps/api/src/app/guarita/guarita-eventos.service.ts` (`criarAlerta` 258, construtor 77)

**Interfaces:**
- Consumes: `operadorDoToken` (Task 6), `emitirCentral`/`centralOnline` (Task 2), `destinoPortaria` (Task 3). (O pedido ao morador entra na Task 8.)
- Produces:
  - `QuemCentral { papel: 'central'; uid: number; nome: string }`; `Quem = QuemMorador | QuemPortaria | QuemCentral`.
  - `acoes.atender` aceita `central` em estado `portaria` para tipos `facial_unidade | facial_portaria | unidade_portaria`, só em condomínio com `central_contratada = 1`; grava `id_operador_central`.
  - `acoes.abrir(id, quem, motivo?: { codigo: MotivoAbertura; detalhe?: string })`: para `central`, motivo obrigatório (`400 motivo_obrigatorio`), `detalhe` obrigatório quando `codigo === 'outro'`; tipos com portão: `facial_unidade` e `facial_portaria`. Auditoria `INTERFONE_ABRIR` com `autor_tipo: 'operador_central'`, `id_condominio` e o motivo.
  - `export const MOTIVOS_ABERTURA = ['visitante_identificado', 'entrega', 'prestador', 'morador_sem_acesso', 'emergencia', 'outro'] as const`.
  - Rotas (`@Controller('central')`, todas com `operadorDoToken`):
    - `GET condominios` → `{ id, nome, destino: DestinoPortaria }[]` (só `central_contratada = 1`).
    - `GET fila` → `ChamadaCentralEvento[]` (estado `portaria` nos condomínios da central).
    - `POST chamadas/:id/atender` → `DadosEntrada` (papel voz `central`).
    - `POST chamadas/:id/abrir {codigo, detalhe?}`; `POST chamadas/:id/encerrar`.
    - `GET chamadas/:id/contexto` → `{ condominio, portao, unidade, moradores: string[] /*primeiro nome*/, esperados_hoje: { nome: string; horario: string | null; tipo: 'convite' | 'entrega' }[], instrucao_entregas: string | null }` (a Task 8 acrescenta `pedido`).
    - `POST ligar {id_apartamento}` → `DadosEntrada` (reusa `ligarUnidade` com `QuemCentral`).
    - `GET historico?data=AAAA-MM-DD` → chamadas atendidas pela central no dia (todas as unidades da central), com `condominio`.
    - `GET alertas?pendentes=1` → `Guarita_Alertas` dos condomínios da central (com `condominio`); `POST alertas/:id/visto` grava `visto_em` e `visto_por = 'Central: <nome>'`.
  - Guarita: `criarAlerta` passa a emitir `alerta:novo` `{ id, id_condominio, condominio, tipo, descricao, created_at }` para `portaria:<id>` e, se `central_contratada`, para a sala `central` (injetar `RealtimeGateway` com `@Optional()`).

- [ ] **Step 1: testes que falham** (`central.service.spec.ts` + acréscimos em `interfone-acoes.spec.ts`)
  - `operador atende chamada em estado portaria de condomínio da central`; `condomínio sem central → 403`.
  - **Review Focus 5:** `porteiro e operador atendem ao mesmo tempo: um vence, o outro recebe 409 atendida_por_outro`.
  - `abrir pela central sem motivo → 400`; `motivo outro sem detalhe → 400`; `abrir com motivo grava auditoria com operador e condomínio`.
  - `abrir funciona em facial_portaria`.
  - `contexto não traz telefone, e-mail nem documento` (assert nas chaves).
  - `fila só traz condomínios com central contratada`.
  - `alerta do Guarita emite alerta:novo na sala central quando contratada e só na portaria quando não`.
  - `token de porteiro em GET central/fila → 403` (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npx jest -c apps/api/jest.config.cts apps/api/src/app/central apps/api/src/app/interfone apps/api/src/app/guarita` → PASS.
- [ ] **Step 5:** Commit `feat(central): fila multi-condomínio, atender, abrir com motivo, contexto e alertas`.

---

### Task 8: Pedido do portão (API + push)

**Files:**
- Create: `click-cond-web/apps/api/src/app/interfone/interfone-pedidos.service.ts`, `.../interfone-pedidos.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/central/central.controller.ts`, `central.service.ts` (rota do pedido e campo `pedido` no contexto)
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone-push.service.ts`, `click-cond-web/apps/api/src/app/interfone/interfone-app.controller.ts`, `click-cond-web/apps/api/src/app/interfone/interfone.module.ts`, `click-cond-web/apps/api/src/app/interfone/interfone-acoes.service.ts`

**Interfaces:**
- Produces:
  - `export type DecisaoPedido = 'autorizar' | 'negar'`; `export const MENSAGENS_RAPIDAS = ['Já desço', 'Deixe na portaria', 'Volte mais tarde'] as const`.
  - `export interface PedidoResumo { id; estado: 'pendente' | 'autorizado' | 'negado' | 'expirado'; nome_falado; motivo: string | null; tipo; mensagem: string | null; respondido_por_nome: string | null; respondido_em: string | null; portao_aberto: boolean }`.
  - `InterfonePedidosService.criar(entrada: { idChamada: number; idApartamento: number; nome: string; motivo?: string; tipo: 'visita' | 'entrega' | 'servico' | 'outro'; origem: 'central' | 'ia' }): Promise<PedidoResumo>` — copia a `foto` da chamada; push `interfone_pedido` `{ type:'interfone_pedido', id, id_chamada, unidade, condominio, portao, nome, motivo, tipo, foto_url }` aos moradores da unidade (mesma lista de `moradoresDaUnidade`); emite `interfone:pedido` (PedidoResumo + `id_chamada`, `id_condominio`) nas salas da portaria e central.
  - `InterfonePedidosService.responder(idPedido: number, idUser: number, decisao: DecisaoPedido, mensagem?: string): Promise<PedidoResumo>` — só morador vinculado à unidade (`403`); só `pendente` (`409 pedido_respondido`); expira se a chamada terminou há mais de 5 min (`409 pedido_expirado`, grava `expirado`); `mensagem` ≤ 120 caracteres; `autorizar` chama `acoes.abrirPorPedido(idChamada, morador)` uma única vez.
  - `InterfoneAcoesService.abrirPorPedido(idChamada: number, morador: { uid: number; nome: string }): Promise<{ ok: boolean; motivo?: string }>` — mesmo caminho físico do `abrir` (agente → relé, DTMF de reserva), sem exigir que o morador tenha atendido; grava `porta_aberta_como` e auditoria "aberto por autorização do morador <nome> (pedido do interfone)".
  - Rotas do app: `GET interfone/pedidos/:id` → `PedidoResumo`; `POST interfone/pedidos/:id/responder {decisao, mensagem?}`.
  - Rota da central (em `central.controller.ts`, Task 7): `POST central/chamadas/:id/pedido {nome, motivo?, tipo, id_apartamento?}` → `PedidoResumo` (para `facial_portaria` o operador escolhe a unidade; `origem: 'central'`). O `contexto` da central passa a trazer `pedido: PedidoResumo | null` (o último da chamada).
  - `InterfonePushService.pedido(...)` e `pedidoFim(idPedido, ids)` (`type:'interfone_pedido_fim'`, fecha a tela nos outros celulares).

- [ ] **Step 1: testes que falham** (`interfone-pedidos.spec.ts`)
  - `criar manda push aos moradores da unidade e emite interfone:pedido`.
  - `autorizar abre o portão uma vez e marca autorizado`.
  - **Review Focus 4:** `autorizar de novo → 409 pedido_respondido sem abrir`; `autorizar 6 min depois do fim da chamada → 409 pedido_expirado sem abrir`; `morador de outra unidade → 403`.
  - `negar com mensagem rápida grava a mensagem e não abre`.
  - `pedido não cria registro em Pessoas/Visitas nem libera PIN` (assert que esses models não são chamados).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS (suítes do interfone).
- [ ] **Step 5:** Commit `feat(interfone): pedido do portão — morador autoriza e o portão abre uma vez`.

---

### Task 9: Configuração — CRM e console do síndico

**Files:**
- Modify (API): `click-cond-web/apps/api/src/app/crm/crm-interfone.controller.ts`, `click-cond-web/apps/api/src/app/interfone/interfone-config.service.ts` (`clientesCrm` 446, `definirContratado` 454, config do síndico)
- Create (API): `click-cond-web/apps/api/src/app/crm/crm-central.controller.ts` (operadores)
- Modify (CRM): `click-cond-web/apps/crm-web/src/app/crm/tabs/crm-interfone.component.ts/.html`, `click-cond-web/apps/crm-web/src/app/crm/interfone.service.ts`
- Create (CRM): `click-cond-web/apps/crm-web/src/app/crm/tabs/crm-central-operadores.component.ts`
- Modify (console): `click-cond-web/apps/portaria-web/src/app/configuracoes/interfone/interfone-config.component.ts/.html`, `click-cond-web/apps/portaria-web/src/app/interfone/interfone.api.ts`
- Tests: specs ao lado de cada arquivo alterado.

**Interfaces:**
- Produces (API, `CrmAdminGuard`):
  - `GET crm/interfone/clientes` passa a devolver `{ id, nome, contratado, central_contratada, ia_portao_ativa, numero_portaria, instrucao_entregas }`.
  - `POST crm/interfone/clientes/:id/central {ligado}` (`400 interfone_nao_contratado` se `interfone_contratado = 0`); `POST .../ia {ligado}` (guarda a coluna; a IA só age na Entrega 2); `PUT .../portaria {numero_portaria, instrucao_entregas}` (`numero_portaria` 1–8 dígitos e diferente de todo ramal do condomínio, senão `400 numero_conflita_ramal`).
  - `GET/PUT crm/interfone/clientes/:id/agenda` (`FaixaAgenda[]`, valida com `validarAgenda`).
  - `GET crm/central/operadores`; `POST crm/central/operadores {nome, email}` → `{ id, senha_temporaria }` (12 caracteres aleatórios, mostrada uma vez, `trocar_senha = 1`); `POST .../:id/ativo {ligado}`; `POST .../:id/nova-senha` → `{ senha_temporaria }`. Desativar ou nova senha troca `cred`.
  - Config do síndico (`GET interfone/config`) passa a trazer `central_contratada` e a agenda (só leitura); com central contratada o `PUT` ignora `interfone_transferir` e devolve `transferir: true, transferir_travado: true`.
- Produces (UI):
  - CRM aba Interfone: por cliente, chaves "Central contratada" e "IA no portão (Entrega 2)", número da portaria, instruções de entrega, editor de agenda (lista de faixas por dia com destino; botão "Copiar para dias úteis").
  - CRM nova aba "Operadores da central": lista, criar (mostra a senha temporária uma vez com botão copiar), ativar/desativar, nova senha.
  - Console do síndico (Configurações → Interfone): bloco "Central Prestare" só leitura com a agenda; chave "Transferir para a portaria" travada com o texto "incluído no contrato da central".

- [ ] **Step 1: testes que falham** — API: `central exige interfone contratado`, `numero_portaria igual a um ramal é recusado`, `agenda sobreposta é recusada`, `criar operador devolve senha temporária uma vez e grava hash`, `síndico não consegue desligar transferir com central contratada`. CRM/console: specs de componente para exibir as chaves e travar o "transferir".
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS (`npx jest -c apps/api/jest.config.cts apps/api/src/app/crm apps/api/src/app/interfone`, `npx jest -c apps/crm-web/jest.config.cts`, `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/configuracoes`).
- [ ] **Step 5:** Commit `feat(crm): central contratada, agenda, número da portaria e operadores`.

---

### Task 10: Console — área `/central`

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/central/` com `central-auth.service.ts`, `central.guard.ts`, `central-login-page.component.ts`, `central-api.ts`, `central-realtime.service.ts`, `central.store.ts`, `central-page.component.ts`, `central-fila.component.ts`, `central-atendimento.component.ts`, `central-alertas.component.ts`, `central-historico.component.ts`, `central-trocar-senha.component.ts` + specs
- Modify: `click-cond-web/apps/portaria-web/src/app/app.routes.ts` (rotas `/central/login` e `/central` fora do shell do condomínio), `docs/operacao/amplify-regras.json` (`central|central\/login` na regra SPA)

**Interfaces:**
- Consumes: rotas da Task 6/7/8; `SipVoz.entrar(d, video, audio)` (existente, `interfone/sip-voz.ts`); `filtrarSdpParaCentral` (existente).
- Produces:
  - `CentralAuthService` com chave própria no `localStorage` (`central_token`), `login(email, senha)`, `verificar(desafio, codigo)`, `trocarSenha(atual, nova)`, `logout()`, signal `operador`.
  - `centralGuard`: sem `central_token` válido → `/central/login`; `trocar_senha` → tela de troca.
  - `CentralRealtimeService`: Socket.IO em `/api/socket.io` com o `central_token`; eventos `interfone:chamada`, `interfone:fim`, `interfone:pedido`, `alerta:novo`.
  - `CentralStore` (signals): `fila` (mais antiga primeiro, remove em `interfone:fim`), `emChamada`, `contexto`, `alertasAbertos`, `somAlerta` (toca até "visto"), `atender(id)`, `abrir(codigo, detalhe?)`, `encerrar()`, `pedirAutorizacao(nome, motivo, tipo, idApartamento?)`, `ligar(idCondominio, idApartamento)`, `marcarVisto(idAlerta)`.
  - Tela: coluna esquerda fila + alertas; centro a chamada (vídeo, áudio, mudo, Abrir portão com escolha de motivo, Encerrar); direita o contexto (moradores, esperados hoje, instruções, pedido com estado e mensagem do morador ao vivo); abas Histórico e Ligar (escolhe condomínio → busca unidade).

- [ ] **Step 1: testes que falham** — `CentralStore`: `fila ordena pela mais antiga e remove no fim`, `alerta de pânico liga som até marcarVisto`, `abrir sem motivo não chama a API`, `pedido atualiza o contexto ao receber interfone:pedido`; `centralGuard` manda para login sem token; `regra SPA casa /central e /central/login` (estender `seo-auditoria.spec.ts`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (visual Prestare Dark, componentes `ps-*` do console). **Step 4:** PASS na suíte inteira do console (`npx jest -c apps/portaria-web/jest.config.cts`) e `npx tsc -p apps/portaria-web/tsconfig.app.json --noEmit`.
- [ ] **Step 5:** Commit `feat(console): área Central para os operadores da Prestare`.

---

### Task 11: App — tela do pedido do portão

**Files:**
- Create: `click-cond-app/click-cond-app/lib/pages/shared/interfone/pedido_portao.dart`, `click-cond-app/click-cond-app/test/pedido_portao_test.dart`
- Modify: `click-cond-app/click-cond-app/lib/services/firebase_service.dart` (`tratarPushDoInterfone` ~526, abertura pelo aviso ~286), `click-cond-app/click-cond-app/lib/services/interfone/interfone_api.dart`, `click-cond-app/click-cond-app/pubspec.yaml` (versão +1)

**Interfaces:**
- Consumes: `GET interfone/pedidos/:id`, `POST interfone/pedidos/:id/responder` (Task 8); push `interfone_pedido` / `interfone_pedido_fim`.
- Produces:
  - `InterfoneApi.pedido(int id): Future<PedidoPortao>`; `InterfoneApi.responderPedido(int id, String decisao, {String? mensagem}): Future<PedidoPortao>`.
  - `PedidoPortaoPage` (rota aberta pelo push e pelo toque na notificação): foto, "Na portaria: <nome>", motivo, tipo, portão e condomínio; botões **Autorizar** (amarelo, "Abre o portão uma vez") e **Negar**; chips com `Já desço`, `Deixe na portaria`, `Volte mais tarde` e campo de texto (≤ 120); estado final ("Portão aberto", "Negado", "Expirado", "Respondido por <nome>"). Fecha sozinha em `interfone_pedido_fim`.

- [ ] **Step 1: testes que falham** (`pedido_portao_test.dart`): `mostra nome e motivo e chama responder com autorizar`, `chip "Já desço" selecionado vai como mensagem junto da decisão tocada depois`, `estado expirado desabilita os botões`, `interfone_pedido_fim fecha a tela`.
- [ ] **Step 2:** `flutter test test/pedido_portao_test.dart` → FAIL. **Step 3:** Implementar (visual Prestare Dark do app). **Step 4:** PASS; `flutter analyze` sem erros novos; `flutter build apk --debug --target-platform android-x64` → APK gerado.
- [ ] **Step 5:** Commit `feat(app): tela do pedido do portão`.

---

### Task 12: Revisão integrada e build do iPhone (sem publicar)

**Files:** nenhum novo além de ajustes de revisão.

- [ ] **Step 1:** Rodar todas as suítes: API (`npx jest -c apps/api/jest.config.cts`), console, CRM, `voz` (`npm test`), app (`flutter test`). Esperado: verde.
- [ ] **Step 2:** iPhone: disparar o workflow do iOS só com compilação (se o workflow não tiver opção sem upload, adicionar entrada `publicar` com padrão `true` e rodar com `false`). Esperado: build verde, nenhum upload ao TestFlight.
- [ ] **Step 3:** Commit dos ajustes, se houver.

---

### Task 13: Infra, publicação e bancada

- [ ] **Step 1: ElastiCache.** Criar **ElastiCache Serverless (Valkey)** `prestare-realtime` em `sa-east-1`, nas subnets privadas da VPC do EB; security group novo aceitando `6379` só do SG das instâncias do EB. Conferir o tamanho atual das variáveis do EB (limite de 4096 caracteres; ver memória "env 4096") antes de acrescentar `REDIS_URL=rediss://<endpoint>:6379`.
- [ ] **Step 2: SQL.** Aplicar `2026-11-28-portaria-autonoma.sql` no RDS pelo CloudShell (`~/tunel.sh` + `mysql_prestare`) e rodar o `-verificacao.sql`. Esperado: tudo `OK`.
- [ ] **Step 3: Amplify.** Acrescentar `central|central\/login` à regra SPA (backup antes, só a regra SPA, mesmo procedimento de 28/11).
- [ ] **Step 4: Publicar.** Push em `main` e `master`; acompanhar `deploy-api.yml` (versão conferida pelo passo "Verify deployed version"), `deploy-voz.yml`, Amplify e o CRM. Esperado: tudo verde e `GET /api/health` 200.
- [ ] **Step 5: Duas instâncias (Review Focus 1).** Subir temporariamente o EB para 2 instâncias, conectar um operador e criar chamadas até cair na outra instância; a chamada precisa tocar na Central. Voltar o mínimo ao valor anterior.
- [ ] **Step 6: Ligar só no Boa Vista (id 1)** pelo CRM: central contratada, agenda `central` 24h, número da portaria `0`, instrução de entrega. Criar o operador do dono pelo CRM (a senha temporária aparece para ele; o primeiro login e a troca de senha são dele).
- [ ] **Step 7: Bancada** (facial SS 3530 + emulador + Central no Chrome):
  1. Digitar `0` no facial → toca na Central → operador atende, vê vídeo, pede autorização para o Bloco A 106 → app mostra o pedido → Autorizar → portão abre uma vez.
  2. Digitar `1106` e não atender no app → depois de 30 s toca na Central → abrir com motivo "visitante identificado" → auditoria registra.
  3. Agenda `local` com porteiro logado → toca no console do prédio (comportamento de hoje); porteiro sai → próxima chamada cai na Central (salvaguarda).
  4. Pânico de teste do Guarita (se o equipamento estiver na bancada) → alerta toca na Central até "visto".
- [ ] **Step 8:** Atualizar o roteiro `docs/operacao/interfone-roteiro-bancada-ss3532.md` com a Central e registrar na memória do projeto.
