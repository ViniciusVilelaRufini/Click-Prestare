# Bloqueadores de onboarding — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a implantação do primeiro condomínio pagante funcionar sem truques: síndico entregue pelo CRM, cadastro e carga de moradores confiáveis, avisos honestos de falha, e o CRM sem mexer na cobrança dos moradores.

**Architecture:** Correções pontuais na API NestJS (`click-cond-web/apps/api`), no console (`apps/portaria-web`) e no CRM (`apps/crm-web`). Uma única migração SQL manual (o RDS não roda `prisma migrate`). Nenhuma versão nova do app Flutter: o app já trata resposta não-200.

**Tech Stack:** NestJS + Prisma (MySQL 8), Angular (Jest via Nx), Jest na API.

**Spec:** este documento. O diagnóstico vem de três leituras de código feitas em 17/11/2026 sobre `origin/master` = `513aeb8c`; as linhas citadas são desse commit.

## Diagnóstico e decisões (a "spec")

| # | Problema confirmado | Decisão |
|---|---|---|
| 1 | CRM: se o e-mail do síndico já existe, `criar` recusa e manda "vincular depois", mas não há rota; a edição descarta os dados do síndico em silêncio e diz "sucesso"; o switch "Criar acesso do síndico" nasce desligado | Nova rota "vincular síndico". E-mail existente: **vincula direto** a conta existente. **Um síndico por condomínio**: vincular outro remove o vínculo de síndico do anterior (a conta dele continua). Switch nasce ligado |
| 2 | Autocadastro do síndico grava `Condominios.ativo=0`, igual a "desativado no CRM": síndico vê "suspenso", CRM conta como churn | Coluna `Condominios.aprovado_em`. Pendente = `ativo=0 AND aprovado_em IS NULL`. Texto: "Seu condomínio está em análise. Avisaremos quando o acesso for liberado." Estágio CRM `pendente`, fora do churn |
| 3 | `normalizarBloco` só tira "bloco"; importação e criação de **unidades** comparam texto exato | "Quadra" e "Torre" contam como prefixo de bloco; "Lote", "Casa", "Apto", "Apartamento", "Unidade" como prefixo de unidade. Unidade duplicada é recusada (create) ou ignorada com motivo (import) |
| 4 | Tela Terminais Faciais mostra "Aguardando envio" para quem não aceitou a biometria; aceite só sobe o rosto em 30–60 min | Status `aguardando_aceite` na tela de terminais, sem distinguir recusa (dado sensível). Aceite dispara `syncMorador` na hora |
| 5 | `create` de morador procura conta só por `email`; colisão de `login` ou `cpf` vira "(P2002)" genérico | Procurar por `email OR login`; P2002 vira mensagem clara; CPF de outra conta é **recusado** |
| 6 | `sendCredentials` e `create` disparam o e-mail sem esperar; tela sempre diz sucesso | Esperar o envio. Em `sendCredentials`, falha = 503 e desfaz `senha_alterada_em`. Em `create`/import, o morador fica cadastrado e a resposta avisa que o e-mail não saiu |
| 7 | CRM grava plano e mensalidade da Prestare em `valor_condominio`/`categoria_padrao`/`dia_vencimento` (cobrança dos moradores); switches do CRM ligam `recorrencia_ativa` e `cobranca_auto_whats` | CRM só escreve `Assinaturas_Condominios` + `Condominios.vencimento`. Switches **saem do CRM** |
| Extra | `getCondominioById` devolve "Condomínio Demo" (saldo R$ 15.500) com HTTP 200 em qualquer erro; `registerCondominio` devolve sucesso falso | Sem mock: erro vira 503 (404 se o condomínio sumiu); `registerCondominio` falha de verdade |

## Global Constraints

- Todo texto ao usuário em pt-BR com acentuação correta.
- Nada de gravar em `Condominios.valor_condominio`, `categoria_padrao`, `dia_vencimento`, `recorrencia_ativa`, `cobranca_auto_whats` a partir do CRM.
- SQL manual em `click-cond-web/prisma/sql/2026-11-17-onboarding.sql` + `2026-11-17-onboarding-verificacao.sql`, idempotente, aplicado no RDS **antes** do push (CloudShell + `tunel.sh`), refletido no `schema.prisma` com `npx prisma generate`.
- Rodar testes a partir de `C:/w/onb/click-cond-web`: API `npx jest -c apps/api/jest.config.cts <caminho>`; front `npx jest -c apps/<app>/jest.config.cts <caminho>`.
- Base verde em 17/11: API 559 suítes / 5.778 testes; portaria-web verde. Nenhuma tarefa termina com teste vermelho.
- Commits pequenos, mensagem em português no padrão `fix(<área>): …`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Síndico vinculado que já é morador do mesmo condomínio: precisa continuar entrando como morador e passar a entrar como síndico (`is_sindico=1` sem apagar o vínculo de morador). Teste na Task 7.
2. Importação com 200 linhas e SMTP fora: a importação termina, cadastra todos e lista quem ficou sem e-mail, sem estourar o tempo da requisição (envio com limite de 4 simultâneos). Teste na Task 2.
3. Condomínio desativado no CRM **depois** de aprovado continua mostrando "suspenso", não "em análise". Teste na Task 5.
4. Planilha com "Bloco 1" e unidade "101" contra cadastro "1"/"Apto 101": casa como a mesma unidade; "Bloco 10" não casa com "Bloco 1". Teste na Task 4.
5. Morador revoga a biometria depois de aceitar: tela de terminais mostra `aguardando_aceite`/revogado, e o aceite novo dispara o envio. Teste na Task 6.

---

### Task 1: Sem "Condomínio Demo" nem sucesso falso

**Files:**
- Modify: `apps/api/src/app/auth/mobile-auth.service.ts:2725-2792` (`getCondominioById`), `:2794-2851` (`registerCondominio`)
- Test: `apps/api/src/app/auth/get-condominio.tenant.spec.ts`, novo `apps/api/src/app/auth/register-condominio-falha.spec.ts`

- [ ] **Step 1: Testes que falham** — em `get-condominio.tenant.spec.ts`: `it('falha do banco vira 503, nunca o condomínio demo')` com `prisma.condominios.findUnique` rejeitando → `await expect(...).rejects.toBeInstanceOf(ServiceUnavailableException)` e o resultado nunca contém `'Condomínio Demo'`; `it('falha do financeiro vira 503')` com `financeiro.getAll` rejeitando; `it('condomínio inexistente vira 404')` com `findUnique` → `null` → `NotFoundException`. Em `register-condominio-falha.spec.ts`: `it('erro do banco não devolve success:true')` → rejeita com `ServiceUnavailableException`.
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/auth/get-condominio.tenant.spec.ts apps/api/src/app/auth/register-condominio-falha.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** — remover `mockCond` e os ramos `!isConnected` mortos de `getCondominioById`, `getInfosCondominio` (2868-2879) e `getAddressCondominio` (2902+); `catch` faz `this.logger.error(...)` e lança `new ServiceUnavailableException('Não foi possível carregar o condomínio agora. Tente de novo em instantes.')`; `!c` lança `NotFoundException('Condomínio não encontrado.')`. `registerCondominio`: remover o retorno `{ success: true, id: Date.now() }`; erro lança `ServiceUnavailableException('Não foi possível cadastrar o condomínio agora. Tente de novo.')`.
- [ ] **Step 4: Rodar a pasta auth** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/auth` → PASS (ajustar specs antigas que esperavam o mock).
- [ ] **Step 5: Commit** — `fix(api): erro ao carregar condomínio vira 503 em vez do condomínio demo`.

### Task 2: Envio de acesso honesto (bloqueador 6)

**Files:**
- Modify: `apps/api/src/app/moradores/moradores.service.ts` (`fireWelcomeEmail` 259-269, `sendCredentials` 1795-1954, `create` ~1297, `importBulk` 2052-2149); `apps/api/src/app/auth/mobile-auth.service.ts` (~3216-3222, envio do link)
- Modify: `apps/portaria-web/src/app/moradores/moradores-page.component.ts` (593, 734-738 e resultado da importação), `apps/portaria-web/src/app/apartamentos/apartamentos-page.component.ts:274`
- Test: `apps/api/src/app/moradores/moradores-credentials.spec.ts`, `moradores-enviar-acesso-link.spec.ts`, novo `moradores-email-falhou.spec.ts`; `apps/portaria-web/src/app/moradores/moradores-page.enviar-acesso.spec.ts`

**Interfaces:**
- Produces: `MobileAuthService.enviarLinkDefinirSenhaOperador(idUser: number): Promise<void>` (espera o envio e propaga o erro; o "Esqueci a senha" público continua com `setImmediate`).
- Produces: resposta de `create` ganha `credenciais_enviadas: boolean` e `aviso_email?: string`; `importBulk` ganha a lista `sem_email: Array<{ linha: number; nome: string }>`.

- [ ] **Step 1: Testes que falham** — `sendCredentials`: com `mail.sendWelcomeMorador` em `mockRejectedValue(new Error('smtp'))` → rejeita com `ServiceUnavailableException` cuja mensagem é `'Não conseguimos enviar o e-mail agora. O morador ainda não tem acesso; tente de novo.'`; `users.update` chamado de novo restaurando `senha_alterada_em` ao valor anterior; nenhuma auditoria "Reenviou credenciais". Modo link: envio rejeitado → mesmo 503. `create` com `sendCredentials:true` e envio rejeitado → resolve com `credenciais_enviadas:false` e `aviso_email` = `'Morador cadastrado, mas o e-mail de acesso não saiu. Use "Enviar acesso" para tentar de novo.'`. `importBulk` com 3 linhas e envio falhando na 2ª → as 3 cadastradas e `sem_email` = `[{ linha: 2, … }]`. Front: resposta `credenciais_enviadas:false` mostra `toast.warning(aviso_email)`, não `success`.
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/moradores` e `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/moradores` → FAIL nos novos.
- [ ] **Step 3: Implementar** — trocar `fireWelcomeEmail` por `await` dentro de try/catch nos três caminhos; na importação usar o limitador existente `common/limitar-concorrencia.ts` com 4 envios simultâneos; sem provedor de e-mail configurado o comportamento é o mesmo da falha.
- [ ] **Step 4: Rodar e ver passar** — os dois comandos do Step 2 → PASS.
- [ ] **Step 5: Commit** — `fix(moradores): "acesso enviado" só quando o e-mail sai de verdade`.

### Task 3: Cadastro manual com e-mail ou CPF já usados (bloqueador 5)

**Files:**
- Modify: `apps/api/src/app/moradores/moradores.service.ts:1169-1171` (busca da conta), `:1284-1291` (catch)
- Test: `apps/api/src/app/moradores/moradores-conta-existente.spec.ts`

- [ ] **Step 1: Testes que falham** — `it('acha a conta pelo login quando o email da conta é outro')`: `users.findFirst` chamado com `where: { OR: [{ email }, { login: email }] }` e nenhum `users.create`. `it('P2002 em login/email vira mensagem clara')`: erro Prisma `{ code:'P2002', meta:{ target:'user_login' } }` → `ConflictException('Já existe outro usuário com este e-mail.')`. `it('CPF de outra conta é recusado')`: `meta.target:'uni_cpf'` → `ConflictException('Este CPF já pertence a outra conta.')`.
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/moradores/moradores-conta-existente.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** — mesma busca `OR` usada em `importBulk` (2115-2117); no catch, mapear por `String(err.meta?.target)` contendo `login`/`email` ou `cpf`.
- [ ] **Step 4: Rodar a pasta moradores** → PASS.
- [ ] **Step 5: Commit** — `fix(moradores): cadastro manual reconhece a conta pelo login e explica e-mail/CPF repetidos`.

### Task 4: Unidade igual não duplica (bloqueador 3)

**Files:**
- Modify: `apps/api/src/app/common/rotulo-bloco.util.ts`, `apps/api/src/app/moradores/moradores.service.ts:127-130`, `apps/api/src/app/apartamentos/apartamentos.service.ts` (`create` 132-178, `importBulk` 433-470)
- Modify: `apps/portaria-web/src/app/apartamentos/apartamentos-page.component.ts:61-71`, `apps/portaria-web/src/app/veiculos/veiculos-page.component.ts:842`
- Test: novo `apps/api/src/app/common/rotulo-bloco.util.spec.ts`, novo `apps/api/src/app/apartamentos/apartamentos-duplicada.spec.ts`, `apps/api/src/app/moradores/moradores-importacao.spec.ts`

**Interfaces:**
- Produces: `normalizarBloco(bloco)` (passa a tirar `bloco|quadra|torre`), `normalizarApto(apto: string | null | undefined): string` (tira `lote|casa|apto|apartamento|unidade`, espaços e zeros à esquerda de números) e `chaveUnidade(bloco, apto): string`, todos exportados de `common/rotulo-bloco.util.ts`. `moradores.service.ts` passa a importar `chaveUnidade` daí.

- [ ] **Step 1: Testes que falham** — `normalizarBloco('Quadra A') === 'a'`, `normalizarBloco('Torre 2') === '2'`, `normalizarBloco('Bloco 10') !== normalizarBloco('Bloco 1')`; `normalizarApto('Lote 12') === '12'`, `normalizarApto('Apto 101') === '101'`, `normalizarApto('0101') === '101'`; `chaveUnidade('Bloco 1','Apto 101') === chaveUnidade('1','101')`. Apartamentos: `create` com `{bloco:'Bloco A', apto:'101'}` existindo `{bloco:'A', apto:'101'}` → `ConflictException('Essa unidade já existe (A 101).')`; `importBulk` com a mesma linha → não cria e devolve em `ignorados` com motivo `'Unidade já cadastrada'`. Moradores: linha "Quadra A"/"Lote 12" casa com unidade "A"/"12".
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/common/rotulo-bloco.util.spec.ts apps/api/src/app/apartamentos apps/api/src/app/moradores/moradores-importacao.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** — `create` e `importBulk` de apartamentos carregam `{ id, bloco, apto }` do condomínio uma vez e comparam por `chaveUnidade`. Front: agrupar por `rotuloBloco(a.bloco)` do `shared/bloco-label.util.ts`; em veículos usar `rotuloBloco(d.bloco)`.
- [ ] **Step 4: Rodar API e portaria-web** — comando do Step 2 + `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/apartamentos apps/portaria-web/src/app/veiculos` → PASS.
- [ ] **Step 5: Commit** — `fix(unidades): "Quadra A", "Lote 12" e "Bloco A" não duplicam unidades`.

### Task 5: Autocadastro "em análise", não "suspenso" (bloqueador 2) + migração SQL

**Files:**
- Create: `click-cond-web/prisma/sql/2026-11-17-onboarding.sql`, `click-cond-web/prisma/sql/2026-11-17-onboarding-verificacao.sql`
- Modify: `prisma/schema.prisma` (model `Condominios`, ~220; model `Sindicos_Condominios`, 367-378)
- Modify: `apps/api/src/app/auth/mobile-auth.service.ts` (249-255, `registerCondominio` ~2831), `apps/api/src/app/auth/auth.service.ts:414`, `apps/api/src/app/crm/crm-condominios.service.ts` (`reativar` ~547), `apps/api/src/app/crm/crm.service.ts` (22, 514-546, 771-781, 850-862, 1072)
- Modify: `apps/crm-web/src/app/crm/crm.service.ts:7`, `apps/crm-web/src/app/crm/crm-format.ts:26,38`, `apps/crm-web/src/app/crm/tabs/crm-clientes.component.ts:43-49`
- Test: `apps/api/src/app/auth/condominio-inativo.spec.ts`, `auth/condominio-autocadastro-pendente.spec.ts`, novo `apps/api/src/app/crm/crm-estagio.spec.ts`

**Interfaces:**
- Produces: coluna `Condominios.aprovado_em DateTime?` e `@@unique([id_user, id_condominio])` em `Sindicos_Condominios` (usado pela Task 7). `EstagioCrm` passa a ser `'pendente' | 'lead' | 'trial' | 'ativo' | 'em_atraso' | 'churn'`.

- [ ] **Step 1: SQL** — `onboarding.sql`, idempotente (checar `information_schema` antes de cada ALTER): `ALTER TABLE Condominios ADD COLUMN aprovado_em DATETIME NULL`; `UPDATE Condominios SET aprovado_em = COALESCE(created_at, NOW()) WHERE ativo = 1 AND aprovado_em IS NULL`; apagar duplicatas de `Sindicos_Condominios` mantendo o menor `id`; `ALTER TABLE Sindicos_Condominios ADD UNIQUE KEY uq_sindico_condominio (id_user, id_condominio)`. `onboarding-verificacao.sql`: a coluna existe, contagem de `ativo=1 AND aprovado_em IS NULL` = 0, o índice existe, zero duplicatas. Atualizar `schema.prisma` e rodar `npx prisma generate`.
- [ ] **Step 2: Testes que falham** — login de síndico/morador com todos os vínculos `ativo:0, aprovado_em:null` → `UnauthorizedException('Seu condomínio está em análise. Avisaremos quando o acesso for liberado.')`; com `ativo:0, aprovado_em: Date` → continua `'O acesso deste condomínio está suspenso. Fale com a administração.'`; console (`auth.service.ts`) com o mesmo texto de "em análise"; `registerCondominio` grava `aprovado_em: null`; `reativar` grava `aprovado_em` quando nulo e não sobrescreve quando já existe. CRM: condomínio `ativo:0, aprovado_em:null` tem `estagio:'pendente'`, não entra em `churn` nem em `taxaChurn`, e entra em `porEstagio.pendente`.
- [ ] **Step 3: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/auth/condominio-inativo.spec.ts apps/api/src/app/auth/condominio-autocadastro-pendente.spec.ts apps/api/src/app/crm/crm-estagio.spec.ts` → FAIL.
- [ ] **Step 4: Implementar** — os selects de vínculo passam a trazer `aprovado_em`; `recusarSeSoCondominiosInativos` escolhe a mensagem. crm-web: rótulo `pendente: 'Em análise'` com `badge-warning` e opção no filtro.
- [ ] **Step 5: Rodar API (auth, crm) e `npx jest -c apps/crm-web/jest.config.cts`** → PASS.
- [ ] **Step 6: Commit** — `fix(autocadastro): condomínio novo fica "em análise", não suspenso nem churn`.

### Task 6: Facial aguardando aceite visível e envio na hora (bloqueador 4)

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts` (`getSyncStatus` 4878-4929, `listSyncPessoas` 4946-5000, `statusPessoa`/`motivoSync` 5010-5027), `apps/api/src/app/consentimentos/consentimentos.service.ts:120-157`
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.component.ts` (540, 1235), `apps/portaria-web/src/app/moradores/moradores-page.component.html:700-711`
- Test: `apps/api/src/app/facial/facial.sync-pessoas.spec.ts`, `apps/api/src/app/consentimentos/consentimentos.spec.ts`, `apps/portaria-web/src/app/moradores/moradores-page.ficha.spec.ts`

**Interfaces:**
- Produces: `statusPessoa` pode devolver `'aguardando_aceite'`; motivo `'Aguardando o morador autorizar a biometria no app.'`; `getSyncStatus` ganha o contador `aguardando_aceite` e tira essas pessoas de `pending`.

- [ ] **Step 1: Testes que falham** — morador sem consentimento de biometria (ou último `aceito=0`) aparece com `status:'aguardando_aceite'` e o motivo acima, para "não respondeu" e "recusou" igualmente; não soma em `pending`. `registrar(user, { privacidade:true, biometria:true })` chama `facial.syncMorador(idMorador)` para cada morador do usuário sem esperar o envio (falha do sync é só log). Ficha: com `aguardando_aceite_biometria:true` e `face_sync_status:'pending'`, o selo mostrado é "Aguardando aceite (no app)".
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/facial/facial.sync-pessoas.spec.ts apps/api/src/app/consentimentos` e o spec da ficha → FAIL.
- [ ] **Step 3: Implementar** — `listSyncPessoas` inclui `id_user` e reaproveita a consulta de `moradores.service.ts:454-505` (extrair para um método de `ConsentimentosService` se for preciso compartilhar, `biometriaAutorizadaPorUsuario(ids: number[]): Promise<Map<number, boolean>>`). Front: rótulo e cor próprios para `aguardando_aceite`.
- [ ] **Step 4: Rodar API (facial, consentimentos, moradores) e portaria-web** → PASS.
- [ ] **Step 5: Commit** — `fix(facial): terminais mostram quem espera o aceite e o aceite já envia o rosto`.

### Task 7: Vincular síndico pelo CRM (bloqueador 1)

**Files:**
- Modify: `apps/api/src/app/crm/crm.controller.ts` (perto de 157-165), `apps/api/src/app/crm/crm-condominios.service.ts` (extrair 156-182; 266-272), `apps/api/src/app/crm/crm.service.ts:258-281`
- Modify: `apps/crm-web/src/app/crm/crm.service.ts` (~182-215), `apps/crm-web/src/app/crm/cliente/cliente-drawer.component.{ts,html}` (440-441, 192-210, modal no estilo de 986-1046), `apps/crm-web/src/app/crm/tabs/crm-clientes.component.ts:173,199`
- Test: novo `apps/api/src/app/crm/crm-vincular-sindico.spec.ts`, novo `apps/api/src/app/crm/crm-atualizar-cliente.spec.ts`, `apps/crm-web/src/app/crm/cliente/cliente-drawer.email-acesso.spec.ts` (modelo para o novo spec do drawer)

**Interfaces:**
- Consumes: `@@unique([id_user, id_condominio])` da Task 5.
- Produces: `POST /crm/clientes/:id/sindico` (guard `CrmAdminGuard`), body `{ nome: string; email: string; telefone?: string; documento?: string; substituirAtual?: boolean }`, resposta `{ id_user: number; contaExistente: boolean; senhaSindico?: string; anteriorRemovido?: { id_user: number; nome: string } }`. Serviço `CrmCondominiosService.vincularSindico(idCondominio: number, dto: VincularSindicoDto, operador: JwtPayload)`.

- [ ] **Step 1: Testes que falham** — e-mail novo: cria `Users`/`Sindicos`/vínculo e devolve `senhaSindico` (mesmo helper usado por `criar`); e-mail existente (inclusive morador do mesmo condomínio): não cria usuário, liga `is_sindico=1`, cria `Sindicos` se faltar, cria o vínculo, `contaExistente:true`, sem senha, e o vínculo de morador continua; já existe outro síndico e `substituirAtual` ausente → `ConflictException('Este condomínio já tem síndico (<nome>). Confirme a substituição.')`; com `substituirAtual:true` → remove só a linha de `Sindicos_Condominios` do anterior e devolve `anteriorRemovido`; mesmo síndico de novo → `ConflictException('Essa pessoa já é síndica deste condomínio.')`; e-mail de login da portaria → recusado como em `criar`; auditoria gravada. `atualizarCliente`: sem vínculo e com dados de síndico → `UnprocessableEntityException('Este condomínio ainda não tem síndico. Use "Vincular síndico".')`; troca de e-mail atualiza `email` e `login` juntos e recusa e-mail de outra conta com `ConflictException`; escolhe o vínculo com `orderBy: { id: 'asc' }`. E-mail sempre em minúsculas. Drawer: estado vazio mostra o botão "Vincular síndico"; resposta com `senhaSindico` abre o mesmo painel de senha única; 409 de substituição pergunta "Substituir <nome>?" e reenvia com `substituirAtual:true`.
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/crm` e `npx jest -c apps/crm-web/jest.config.cts apps/crm-web/src/app/crm/cliente` → FAIL.
- [ ] **Step 3: Implementar** — `comSindico: true` como padrão no formulário de novo cliente.
- [ ] **Step 4: Rodar os dois comandos** → PASS.
- [ ] **Step 5: Commit** — `feat(crm): vincular ou trocar o síndico de um condomínio`.

### Task 8: CRM só cuida da assinatura da Prestare (bloqueador 7)

**Files:**
- Modify: `apps/api/src/app/crm/crm-condominios.service.ts:138-146`, `apps/api/src/app/crm/crm.service.ts` (14-16, 212-223, 512)
- Modify: `apps/crm-web/src/app/crm/cliente/cliente-drawer.component.{html,ts}` (171-189: remover os switches), `apps/crm-web/src/app/crm/tabs/crm-clientes.component.html:353-368` (rótulos "Plano Prestare", "Mensalidade Prestare (R$)", "Vencimento da Prestare (dia)")
- Create: `click-cond-web/prisma/sql/2026-11-17-crm-cobranca-verificacao.sql` (só SELECT)
- Test: novo `apps/api/src/app/crm/crm-assinatura-prestare.spec.ts`, `crm-atualizar-cliente.spec.ts` da Task 7, `apps/api/src/app/financeiro/recorrencia-agenda.spec.ts` (regressão)

- [ ] **Step 1: Testes que falham** — `criar` com `{ plano:'Profissional', valorMensal:595, diaVencimento:10 }`: o `condominios.create` **não** recebe `valor_condominio`, `categoria_padrao` nem `dia_vencimento`; é criada `assinaturas_Condominios` com `plano:'Profissional'`, `valor:595`, `plataforma:'CRM'`, `codigo:'CRM-MANUAL'`, `data_ini` hoje e `data_fim` no próximo dia 10; `Condominios.vencimento` = `data_fim`. `atualizarCliente` com `{ mrr, plano, recorrenciaAtiva, cobrancaAutoWhats }`: `condominios.update` não recebe nenhum desses quatro campos de cobrança dos moradores. `montarCliente` com `valor_condominio:500` e sem assinatura → `plano:null`.
- [ ] **Step 2: Rodar e ver falhar** — `npx jest -c apps/api/jest.config.cts apps/api/src/app/crm` → FAIL.
- [ ] **Step 3: Implementar** — atualizar o comentário de 14-16. A verificação SQL lista condomínios com `categoria_padrao IN ('Essencial','Profissional','Elite','Sem plano')` ou `recorrencia_ativa=1` e lançamentos de `Financeiro` com essas categorias (o banco só tem dados de teste; o resultado vai no relatório, sem UPDATE automático).
- [ ] **Step 4: Rodar API (crm, financeiro) e crm-web** → PASS.
- [ ] **Step 5: Commit** — `fix(crm): plano da Prestare vai para a assinatura, não para a taxa dos moradores`.

### Task 9: Revisão, SQL no RDS, publicação e registro

- [ ] **Step 1: Suíte inteira** — `npx jest -c apps/api/jest.config.cts` (esperado: 559+ suítes, 0 falhas), `npx nx test portaria-web`, `npx nx test crm-web`, `npx nx build api`, `npx nx build portaria-web`, `npx nx build crm-web`.
- [ ] **Step 2: Revisão do branch inteiro** por um revisor novo (superpowers:requesting-code-review); corrigir o que for real.
- [ ] **Step 3: SQL no RDS** — conferir no CloudShell que a conta é 850401152034; `source tunel.sh`; aplicar `2026-11-17-onboarding.sql`; rodar `2026-11-17-onboarding-verificacao.sql` e `2026-11-17-crm-cobranca-verificacao.sql`; guardar a saída.
- [ ] **Step 4: Publicar** — merge em `master` e `main`, push nos dois; acompanhar o `deploy-api.yml` do `main` até o passo "Verify deployed version" verde; console e CRM pelo Amplify/Vercel.
- [ ] **Step 5: Conferência em produção** — smoke público (`C:/w/smoke`), login no console, abrir um condomínio no CRM e ver o botão "Vincular síndico".
- [ ] **Step 6: Registro** — atualizar a nota "Pendência - Preparação para o primeiro cliente" do vault (tabela de bloqueadores) e a memória `preparacao-primeiro-cliente-2026-11-13`.
