# Entregador: autoatendimento no portão — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O entregador lê um QR fixo no portão, informa a unidade e tira uma selfie; o morador responde pelo card ao vivo; autorizado, aquele portão abre uma vez, e foto, portão e horários ficam no atendimento de delivery.

**Architecture:** Cada página aberta pelo entregador é um *pedido de portão* (`DeliveryPedidosPortao`) ligado a um `DeliveryAtendimentos`. Um serviço novo dentro do módulo de delivery (`delivery/portao/`) cuida de pedido, presença, abertura e saída; o `DeliveryService` ganha transições feitas pelo sistema e um gancho que avisa o serviço do portão quando o status muda. A abertura usa o método compartilhado `FacialService.abrirDispositivoInterno`. A página do entregador é uma rota pública da portaria-web, no padrão de `convite/:token`.

**Tech Stack:** NestJS + Prisma (MySQL) em `click-cond-web/apps/api`; Angular standalone em `click-cond-web/apps/portaria-web`; Flutter em `click-cond-app/click-cond-app` (extensão iOS `ios/CardPortaria`, notificação Android em `lib/services/card_ao_vivo`).

**Spec:** `docs/superpowers/specs/2026-11-13-entregador-autoatendimento-portao-design.md` (ler inteiro antes de qualquer tarefa). Relacionado: `docs/superpowers/specs/2026-11-13-card-ao-vivo-delivery-design.md`.

**Base:** worktree `C:/w/acesso`, branch `feat/acesso-celular` (de `origin/master`, 1241eb15). A ideia 1 (QR dinâmico) é implementada antes, no mesmo branch. Todos os números de linha abaixo são deste worktree, antes da ideia 1; se ela deslocou algo, localizar pelo nome.

## Global Constraints

- Produção é o NestJS. Nada neste plano toca o Express de dev.
- Schema muda por SQL manual idempotente (`prisma/manual_2026-11_delivery_pedidos_portao.sql`), aplicado no RDS **antes** do push. Não usar `prisma migrate` nem `db push`.
- Todo `POST` chamado pelo app ou pela página pública leva `@HttpCode(200)`.
- Rota pública: `@Public()` + `@SkipAudit()` + `@Throttle({ medium: {...} })` (os throttlers chamam-se `short` e `medium`; `default` não existe).
- A página pública e suas respostas **nunca** contêm nome, telefone ou qualquer dado de morador, nem a foto do entregador.
- Foto vai para o bucket privado com prefixo `delivery-portao/`; só é devolvida sob a chave `foto` (o `ArquivosPrivadosInterceptor` assina essa chave).
- O portão que abre é sempre o `id_device` do pedido cuja selfie o morador viu.
- Opção por condomínio desligada por padrão.
- Card e telas: estritamente Prestare Dark (classes `ps-*`, `app-bg`, `bg-graphite-*` na web; tema e widgets existentes no app).
- O card dos deliveries comuns não muda (RECUSAR / AUTORIZAR).
- **A API e a web têm de funcionar de ponta a ponta com o app já publicado.** As tarefas do app (Bloco D) são as últimas e nada antes depende delas.
- Valores fixos do desenho: pedido expira em **5 min**; "sem resposta" na página aos **60 s**; janela de abertura **3 min**; presença **10 s**; saída até **30 min** após a entrada; cancelamento sem resposta em **2 h**; foto apagada em **90 dias**.
- Commits em português, no formato do repositório (`feat(delivery): …`), terminando com a linha `Co-Authored-By` definida pela sessão.
- Testes da API: em `click-cond-web`, `npx jest -c apps/api/jest.config.cts <padrão>`. Web: `npx jest -c apps/portaria-web/jest.config.cts <padrão>`. App: em `click-cond-app/click-cond-app`, `flutter test <arquivo>`.

## Review Focus

1. **Dois entregadores pedem a mesma unidade no mesmo segundo.** Só um pedido nasce; o outro recebe 409. (Teste na Tarefa 6.)
2. **O morador responde "Liberar entrada" depois de o pedido expirar.** O atendimento vai a `AUTORIZADA`, nada abre, nenhuma janela é criada. (Tarefa 6.)
3. **A abertura falha (agente fora).** A página vê a falha e pode tentar de novo até o fim da janela; depois da janela, não. (Tarefa 6.)
4. **Horário que atravessa a meia-noite** (`22:00`–`06:00`) e relógio do servidor em UTC. (Tarefa 2.)
5. **Selfie que não é imagem, vazia ou enorme, e unidade de outro condomínio.** 400 sem gravar nada. (Tarefa 6.)

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `click-cond-web/prisma/schema.prisma` | modelo `DeliveryPedidosPortao`; colunas novas em `DeliveryAtendimentos`, `Facial_Devices`, `Condominios` |
| `click-cond-web/prisma/manual_2026-11_delivery_pedidos_portao.sql` | o mesmo, idempotente |
| `apps/api/src/app/delivery/portao/portao-regras.ts` | constantes de prazo e funções puras (horário, situação da página, token) |
| `apps/api/src/app/delivery/portao/delivery-portao.service.ts` | pedido, consulta, abertura, saída, gancho de status, rotina |
| `apps/api/src/app/delivery/portao/entrega-publico.controller.ts` | rotas públicas `entrega/publico/…` |
| `apps/api/src/app/delivery/portao/entrega-config.controller.ts` | rotas de síndico: QR do portão e opção do condomínio |
| `apps/api/src/app/delivery/delivery.service.ts` | chegada pelo autoatendimento, transições do sistema, gancho, "vou buscar", pedido nas listas |
| `apps/api/src/app/card-ao-vivo/{delivery-conteudo,conteudo,card-ao-vivo.service}.ts` | card para vários usuários, selfie do pedido, variante do portão |
| `apps/api/src/app/facial/facial.service.ts` | `abrirDispositivoInterno` |
| `apps/portaria-web/src/app/entrega/entrega-page.component.ts` | página do entregador |
| `apps/portaria-web/src/app/terminais-faciais/*` | QR de entregas do aparelho e folha de impressão |
| `apps/portaria-web/src/app/delivery/*` | selfie e portão na fila, detalhe e histórico; painel da opção |
| `click-cond-app/click-cond-app/lib/{models,controllers,pages/shared/delivery,services/card_ao_vivo}` e `ios/CardPortaria` | respostas e variante do card |

Caminhos da API e da web abaixo são relativos a `click-cond-web/`.

---

## Bloco A — Banco

### Task 1: Schema e SQL manual

**Files:**
- Modify: `prisma/schema.prisma` (`DeliveryAtendimentos` 1100-1132; `Facial_Devices` 1403-1448; `Condominios` 207, junto de `cobranca_auto_whats`; modelo novo depois de `DeliveryEventos`)
- Create: `prisma/manual_2026-11_delivery_pedidos_portao.sql`

**Interfaces:**
- Produces (nomes Prisma usados pelas tarefas seguintes):
  - `DeliveryPedidosPortao { id Int @id @default(autoincrement()); id_atendimento Int; id_device Int; nome String @db.VarChar(80); plataforma String? @db.VarChar(40); foto String? @db.VarChar(500); token_hash String @unique @db.VarChar(64); status String @default("pendente") @db.VarChar(20); visto_em DateTime?; liberado_ate DateTime?; aberto_em DateTime?; saida_aberta_em DateTime?; falha_abertura_em DateTime?; criado_em DateTime @default(now()); expira_em DateTime }` — todos `@db.DateTime(0)`, `@@map("delivery_pedidos_portao")`, relações `atendimento` (`onDelete: Cascade`, map `fk_delivery_pedido_atendimento`) e `device` (`Facial_Devices`, `onDelete: Restrict`, map `fk_delivery_pedido_device`), índices `(id_atendimento)`, `(id_device, criado_em)`, `(status, expira_em)`.
  - `DeliveryAtendimentos`: `origem String @default("portaria") @db.VarChar(20)`; `id_pedido_portao Int?` (coluna simples, **sem** relação nem chave estrangeira, para não criar referência circular); `id_morador_user Int?` e `morador Users?`; relação `pedidosPortao DeliveryPedidosPortao[]`.
  - `Facial_Devices`: `token_entrega String? @unique(map: "un_facdev_token_entrega") @db.VarChar(64)`; relação `pedidosPortao DeliveryPedidosPortao[]`.
  - `Condominios`: `delivery_autoatendimento Boolean @default(false)`; `delivery_auto_inicio String? @db.VarChar(5)`; `delivery_auto_fim String? @db.VarChar(5)` (`HH:MM`; os dois nulos = dia inteiro).

- [ ] **Step 1: Alterar o schema** conforme Interfaces.
- [ ] **Step 2: Escrever o SQL manual.** `CREATE TABLE IF NOT EXISTS delivery_pedidos_portao` (InnoDB, utf8mb4). Para cada coluna nova e para o `MODIFY id_morador_user INT NULL`, usar o padrão de `prisma/manual_2026-09_delivery_dados_entregador.sql` (consulta a `information_schema.COLUMNS` + `PREPARE`). O `MODIFY` é seguro repetido. O índice único de `token_entrega` também condicionado por `information_schema.STATISTICS`. O arquivo tem de rodar duas vezes sem erro.
- [ ] **Step 3: Verificar.** `npx prisma validate --schema=prisma/schema.prisma` → "valid"; `npx prisma generate --schema=prisma/schema.prisma` → sem erro; `npx nx typecheck api` → sem erros (o `id_morador_user` nulo pode acusar pontos em `delivery.service.ts` e `card-ao-vivo.service.ts`: nesta tarefa, resolver só com guarda de nulo que preserve o comportamento atual).
- [ ] **Step 4: Rodar a suíte de delivery e card.** `npx jest -c apps/api/jest.config.cts delivery card-ao-vivo` → PASS.
- [ ] **Step 5: Commit** — `feat(delivery): tabelas e colunas do autoatendimento no portão`.

---

## Bloco B — API

### Task 2: Regras puras do pedido

**Files:**
- Create: `apps/api/src/app/delivery/portao/portao-regras.ts`
- Test: `apps/api/src/app/delivery/portao/portao-regras.spec.ts`

**Interfaces:**
- Produces:

```ts
export const PEDIDO_EXPIRA_MS = 5 * 60_000;
export const SEM_RESPOSTA_MS = 60_000;
export const JANELA_ABERTURA_MS = 3 * 60_000;
export const PRESENCA_MS = 10_000;
export const SAIDA_MS = 30 * 60_000;
export const CANCELA_SEM_RESPOSTA_MS = 2 * 3_600_000;
export const CONCLUI_SEM_PORTEIRO_MS = 2 * 3_600_000;
export const FOTO_RETENCAO_DIAS = 90;
export const MAX_PEDIDOS_PORTAO_10MIN = 20;
export const MAX_FOTO_BYTES = 2 * 1024 * 1024; // em base64
export const FOTO_MIME = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export type StatusPedido = 'pendente' | 'liberado' | 'vou_buscar' | 'recusado' | 'expirado';
export type SituacaoPagina =
  | 'aguardando' | 'sem_resposta' | 'liberado' | 'liberado_portaria'
  | 'aberto' | 'vou_buscar' | 'recusado' | 'expirado';
export interface PedidoRegra {
  status: StatusPedido; criado_em: Date; expira_em: Date;
  liberado_ate: Date | null; aberto_em: Date | null; saida_aberta_em: Date | null;
}
export interface EstadoPedido {
  situacao: SituacaoPagina; pode_abrir: boolean; pode_sair: boolean; liberado_ate: string | null;
}
/** `HH:MM` no fuso de Brasília (-03:00 fixo, como `DeliveryService.periodo`). */
export function dentroDoHorario(inicio: string | null, fim: string | null, agora: Date): boolean;
export function horarioValido(v: unknown): v is string; // /^([01]\d|2[0-3]):[0-5]\d$/
export function estadoDoPedido(p: PedidoRegra, agora: Date): EstadoPedido;
export function novoToken(): string;            // randomBytes(32) em hex
export function hashToken(token: string): string; // sha256 em hex
```

Regras de `estadoDoPedido`, na ordem:

| Condição | `situacao` | `pode_abrir` | `pode_sair` |
|---|---|---|---|
| `pendente` e `agora >= expira_em` | `expirado` | não | não |
| `pendente` e `agora - criado_em >= 60 s` | `sem_resposta` | não | não |
| `pendente` | `aguardando` | não | não |
| `liberado` e `aberto_em` | `aberto` | não | `!saida_aberta_em && agora <= aberto_em + 30 min` |
| `liberado`, sem `aberto_em`, `liberado_ate` nulo | `liberado_portaria` | não | não |
| `liberado`, sem `aberto_em`, `agora <= liberado_ate` | `liberado` | sim | não |
| `liberado`, sem `aberto_em`, `agora > liberado_ate` | `expirado` | não | não |
| `vou_buscar` / `recusado` / `expirado` | o próprio | não | não |

- [ ] **Step 1: Escrever os testes que falham**

```ts
const d = (iso: string) => new Date(iso);
it('horário comum, servidor em UTC', () => {
  expect(dentroDoHorario('07:00', '23:00', d('2026-11-14T09:59:00Z'))).toBe(false); // 06:59 BRT
  expect(dentroDoHorario('07:00', '23:00', d('2026-11-14T10:00:00Z'))).toBe(true);  // 07:00 BRT
  expect(dentroDoHorario('07:00', '23:00', d('2026-11-15T02:00:00Z'))).toBe(false); // 23:00 BRT (fim exclusivo)
});
it('horário que atravessa a meia-noite', () => {
  expect(dentroDoHorario('22:00', '06:00', d('2026-11-14T05:00:00Z'))).toBe(true);  // 02:00 BRT
  expect(dentroDoHorario('22:00', '06:00', d('2026-11-14T15:00:00Z'))).toBe(false); // 12:00 BRT
});
it('sem horário, ou início igual ao fim, vale o dia inteiro', () => {
  expect(dentroDoHorario(null, null, d('2026-11-14T05:00:00Z'))).toBe(true);
  expect(dentroDoHorario('08:00', '08:00', d('2026-11-14T05:00:00Z'))).toBe(true);
});
it('estado: cada linha da tabela', () => { /* um expect por linha, com datas fixas */ });
it('hashToken é sha256 hex de 64 caracteres e novoToken tem 64 hex', () => { /* … */ });
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts portao-regras` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** as funções puras conforme Interfaces e a tabela.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(delivery): regras do pedido de portão`.

### Task 3: Abertura decidida pela nuvem (`abrirDispositivoInterno`)

**Files:**
- Modify: `apps/api/src/app/facial/facial.service.ts` (perto de `triggerDevice`, 1818, e de `registrarEvento`, 1979)
- Test: `apps/api/src/app/facial/abrir-dispositivo-interno.spec.ts`

**Interfaces:**
- Consumes: `this.client.triggerRelay(this.toConfig(device))` (`facial-device-client.service.ts:435`, não olha o tipo do aparelho); `this.registrarEvento(device, {...})` (1979); `this.getDevice(id)` (1028).
- Produces, método **público** de `FacialService`:

```ts
abrirDispositivoInterno(
  idDevice: number,
  ctx: {
    origem: 'credencial_qr' | 'delivery_portao';
    tipoPessoa: string;
    idPessoa?: number | null;
    nomePessoa: string;
    credencial?: string | null;
  },
): Promise<{ ok: boolean; erro?: string }>
```

Grava `face_id = ctx.credencial ?? ctx.origem`, `evento = 'acionado_auto'` quando abre e `'falha_acionamento'` quando não. Nunca lança: aparelho inexistente ou inativo devolve `{ ok: false, erro }`.

- [ ] **Step 1: Ver o que a ideia 1 deixou.** `grep -n "abrirDispositivoInterno\|abrirPorDecisaoDaNuvem" apps/api/src/app/facial/facial.service.ts`.
  - Existe `abrirDispositivoInterno` público com a assinatura acima → conferir os testes desta tarefa contra ele e pular para o Step 4.
  - Existe só `private abrirPorDecisaoDaNuvem(device, contexto)` (nome que o plano da ideia 1 usa na tarefa condicionada à bancada) → criar `abrirDispositivoInterno` como a porta pública, carregando o aparelho e delegando a ele.
  - Não existe nenhum → criar `abrirDispositivoInterno` conforme Interfaces.
- [ ] **Step 2: Escrever os testes que falham** (com `triggerRelay` e `prisma.acessos_Facial.create` falsos):

```ts
it('aparelho do tipo facial abre e grava acionado_auto com o nome informado');
it('falha do relé devolve ok:false e grava falha_acionamento');
it('aparelho inativo ou inexistente não chama o relé e devolve ok:false');
it('face_id recebe ctx.credencial; sem credencial, recebe ctx.origem');
it('triggerDevice continua recusando aparelho do tipo facial');
```

- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** `npx jest -c apps/api/jest.config.cts abrir-dispositivo-interno` → PASS; `npx jest -c apps/api/jest.config.cts apps/api/src/app/facial` → PASS.
- [ ] **Step 5: Commit** — `feat(facial): abertura interna decidida pela nuvem`.

### Task 4: Card para vários moradores, com a selfie e a variante do portão

**Files:**
- Modify: `apps/api/src/app/card-ao-vivo/conteudo.ts` (`ConteudoCard`, 48-65)
- Modify: `apps/api/src/app/card-ao-vivo/delivery-conteudo.ts` (`AtendimentoCard` 22-37, `conteudoDelivery` 69-94, `alertaDelivery` 97-108)
- Modify: `apps/api/src/app/card-ao-vivo/card-ao-vivo.service.ts` (`abrirDelivery` 186-206, `atualizarDelivery` 213-247)
- Test: `apps/api/src/app/card-ao-vivo/delivery-conteudo.spec.ts`, `apps/api/src/app/card-ao-vivo/card-ao-vivo.delivery.spec.ts`

**Interfaces:**
- Produces:
  - `ConteudoCard.portao?: boolean` e `AtendimentoCard.portao?: boolean` — presente (e `true`) só quando o atendimento tem pedido de portão `pendente`. Ausente nos outros casos, para o push dos deliveries comuns sair idêntico ao de hoje.
  - `conteudoDelivery`: copia `portao` só na fase `aguardando`.
  - `alertaDelivery(fase, c: Pick<ConteudoCard, 'nome' | 'tipo' | 'portao'>)`: na fase `aguardando` com `portao`, devolve `{ titulo: 'Entregador no portão', corpo: `${c.tipo} pede para entrar.` }`. Os demais textos não mudam.
  - `abrirDelivery(a: AtendimentoCard, idUser: number | number[], opts?)` e `atualizarDelivery(a, idUser: number | number[], opts)` — a lista vai inteira para `idsUsuarios`; lista vazia não abre nada.
  - `encerrarDeOutros(origem: OrigemPedido, id: number, idUserQueFica: number): Promise<void>` — encerra na hora (dismissal 0) as linhas abertas daquele pedido que não são do usuário informado.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('delivery comum: o conteúdo não tem a chave portao', …);
it('pedido de portão pendente: fase aguardando leva portao:true; fase autorizado não', …);
it('alerta do portão: título "Entregador no portão", corpo "Carlos · iFood pede para entrar."', …);
it('abrirDelivery com [7, 9] abre nos aparelhos dos dois usuários', …);
it('abrirDelivery com lista vazia não envia nada', …);
it('encerrarDeOutros(delivery, 5, 7) encerra a linha do usuário 9 e mantém a do 7', …);
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts delivery-conteudo card-ao-vivo.delivery` → os novos FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** `npx jest -c apps/api/jest.config.cts card-ao-vivo` → PASS (inclusive os antigos).
- [ ] **Step 5: Commit** — `feat(card-ao-vivo): card do delivery para vários moradores e variante do portão`.

### Task 5: `DeliveryService` aceita o autoatendimento

**Files:**
- Modify: `apps/api/src/app/delivery/delivery.service.ts` (`TRANSICOES` 36-45; `listarAtendimentos` 160-242; `atualizarStatus` 244-338; `registrarEvento` 462-464; `avisarMorador` 473-525; `atendimentoParaCard` 528-551)
- Test: `apps/api/src/app/delivery/delivery.autoatendimento.spec.ts`

**Interfaces:**
- Consumes: Tarefa 1 (colunas), Tarefa 4 (`abrirDelivery`/`atualizarDelivery` com lista, `encerrarDeOutros`, `AtendimentoCard.portao`).
- Produces, métodos públicos de `DeliveryService`:

```ts
export interface GanchoPortao {
  /** Chamado depois de toda mudança de status gravada. Nunca deve lançar. */
  aoMudarStatus(
    atendimento: { id: number; origem: string; id_pedido_portao: number | null },
    statusNovo: DeliveryStatus,
    quem: { idUser: number | null; operador: boolean; sistema: boolean },
  ): Promise<void>;
}
registrarGanchoPortao(g: GanchoPortao): void;

/** Reaproveita o atendimento mais recente da unidade em AGENDADA, CHEGOU ou
 *  AGUARDANDO_AUTORIZACAO; senão cria um com origem 'autoatendimento' e sem dono.
 *  Em qualquer caso deixa o atendimento em AGUARDANDO_AUTORIZACAO. */
registrarChegadaAutoatendimento(d: {
  idCondominio: number; idApartamento: number; nomeEntregador: string; plataforma: string | null;
}): Promise<{ id: number; criado: boolean }>;

/** Grava o pedido ativo e abre o card, uma vez, já na fase de autorização. */
vincularPedidoPortao(idAtendimento: number, idPedido: number): Promise<void>;

/** Transição feita pelo sistema (autor "Sistema"). false = o status já tinha mudado. */
transicionarPeloSistema(idAtendimento: number, statusNovo: DeliveryStatus, mensagem: string): Promise<boolean>;
```

Regras:

- **Eventos do sistema.** `registrarEvento` passa a aceitar autor sem usuário (`id_usuario_autor` nulo, `autor_nome` "Autoatendimento" na chegada e "Sistema" nas transições da rotina).
- **Chegada.** Atendimento reaproveitado em `AGENDADA` grava dois eventos (`CHEGOU`, `AGUARDANDO_AUTORIZACAO`) e `chegou_em`; em `CHEGOU`, um evento; já em `AGUARDANDO_AUTORIZACAO`, nenhum. Atendimento novo: `origem: 'autoatendimento'`, `id_morador_user: null`, `modo_entrega: 'UNIDADE'`, `estabelecimento: plataforma`, `nome_entregador`, os dois eventos. Nome do entregador só é preenchido no reaproveitado se estava vazio.
- **Transições do sistema.** Além de `TRANSICOES`, o sistema (e só ele) pode levar `CHEGOU` e `AGUARDANDO_AUTORIZACAO` a `CANCELADA`. `CANCELADA` pelo sistema usa a `mensagem` como `motivo`. Depois de gravar, chama `avisarMorador` (o card acompanha) e o gancho com `sistema: true`.
- **Destinatários.** Com `id_morador_user` preenchido, tudo como hoje. Com ele nulo, o card e a notificação comum vão para todos os `Apartamentos_Users` do apartamento, e `notificarOutrosDaUnidade` não roda.
- **Card.** `atendimentoParaCard` lê o pedido ativo (`id_pedido_portao`): quando existe, `entregadorNome`, `entregadorPlataforma` e `fotoEntregador` vêm dele; `portao = (pedido.status === 'pendente')`.
- **`atualizarStatus`:**
  - `respostaDoMorador` também aceita `RETIRADA_NA_PORTARIA`, **somente** se o atendimento tem pedido ativo `pendente`.
  - Resposta de morador em atendimento sem dono grava `id_morador_user` = quem respondeu, no mesmo `updateMany`, e depois chama `cardAoVivo.encerrarDeOutros('delivery', id, idUser)`.
  - `CANCELADA` por morador em atendimento sem dono → `ForbiddenException` (mensagem atual).
  - A exigência "Identifique o entregador antes de autorizar" (280-282) não vale para `origem === 'autoatendimento'`.
  - Depois da transação e antes do aviso, chama o gancho com `{ idUser, operador: isOperador(user), sistema: false }`; erro do gancho vira `logger.warn`.
- **Listas.** As duas consultas de `listarAtendimentos` passam a trazer o pedido mais recente como `pedido_portao: { nome, plataforma, foto, status, portao, aberto_em, saida_aberta_em } | null` (`portao` = `device.nome`), mais `origem`. A do morador não devolve ids. `proprio` é falso quando não há dono.

- [ ] **Step 1: Escrever os testes que falham** (mesmo estilo de `delivery.service.spec.ts`, com Prisma falso):

```ts
it('chegada sem atendimento aberto cria um de origem autoatendimento, sem dono, em AGUARDANDO_AUTORIZACAO, com 2 eventos de autor "Autoatendimento"');
it('chegada reaproveita o aviso AGENDADA do morador e mantém o dono');
it('vincularPedidoPortao abre o card uma vez, para todos os vínculos quando não há dono');
it('vincularPedidoPortao abre o card só para o dono quando há dono');
it('morador responde RETIRADA_NA_PORTARIA com pedido pendente: aceito');
it('morador responde RETIRADA_NA_PORTARIA sem pedido de portão: 403, como hoje');
it('primeira resposta em atendimento sem dono grava o dono e encerra o card dos outros');
it('portaria autoriza atendimento de autoatendimento sem entregador cadastrado');
it('portaria continua exigindo entregador em atendimento de origem portaria');
it('sistema cancela AGUARDANDO_AUTORIZACAO com motivo e autor "Sistema"; usuário comum não consegue');
it('transicionarPeloSistema devolve false quando o status já mudou');
it('gancho recebe (atendimento, statusNovo, quem) depois de cada mudança; erro do gancho não derruba a resposta');
it('lista do operador traz pedido_portao com foto e nome do portão; a do morador não traz ids');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts delivery.autoatendimento` → FAIL.
- [ ] **Step 3: Implementar** conforme Regras.
- [ ] **Step 4: Rodar e ver passar.** `npx jest -c apps/api/jest.config.cts delivery` → PASS (os 890 linhas de testes antigos continuam verdes).
- [ ] **Step 5: Commit** — `feat(delivery): atendimento criado pelo autoatendimento e resposta "vou buscar"`.

### Task 6: `DeliveryPortaoService` — pedido, presença, abertura e saída

**Files:**
- Create: `apps/api/src/app/delivery/portao/delivery-portao.service.ts`
- Modify: `apps/api/src/app/common/storage/storage.service.ts` (constante nova junto de `PREFIXOS_FOTO_CONVITE`, 50)
- Modify: `apps/api/src/app/delivery/delivery.module.ts` (importar `FacialModule`; registrar o serviço)
- Test: `apps/api/src/app/delivery/portao/delivery-portao.service.spec.ts`

**Interfaces:**
- Consumes: Tarefa 2 (regras), Tarefa 3 (`FacialService.abrirDispositivoInterno`), Tarefa 5 (`registrarChegadaAutoatendimento`, `vincularPedidoPortao`, `transicionarPeloSistema`, `registrarGanchoPortao`, `GanchoPortao`); `StorageService.uploadDataUrl(dataUrl, 'delivery-portao')`; `comLock(prisma, nome, fn)` de `common/lock-distribuido.ts`.
- Produces:

```ts
export const PREFIXOS_FOTO_PEDIDO_PORTAO: readonly string[] = ['delivery-portao/']; // em storage.service.ts

export interface PortaoPublico {
  condominio: string; portao: string;
  disponivel: boolean; motivo?: 'desligado' | 'fora_horario';
  horario?: { inicio: string; fim: string };
  unidades: { id: number; bloco: string | null; apto: string | null }[]; // vazio quando indisponível
}
@Injectable()
export class DeliveryPortaoService implements GanchoPortao, OnModuleInit, OnModuleDestroy {
  agora: () => number; // público para os testes
  lerPortao(token: string): Promise<PortaoPublico>;
  criarPedido(token: string, d: { id_apartamento: number; nome: string; plataforma?: string; foto: string }):
    Promise<EstadoPedido & { pedido: string }>;
  consultar(token: string, tokenPedido: string): Promise<EstadoPedido & { falha_abertura: boolean }>;
  abrir(token: string, tokenPedido: string): Promise<EstadoPedido & { abriu: boolean }>;
  sair(token: string, tokenPedido: string): Promise<EstadoPedido & { abriu: boolean }>;
  aoMudarStatus(...): Promise<void>; // GanchoPortao
}
```

O construtor (ou `onModuleInit`) chama `delivery.registrarGanchoPortao(this)`. A dependência é de mão única: este serviço injeta o `DeliveryService`; o contrário é só o gancho.

Mensagens exatas:

| Caso | Erro |
|---|---|
| Token do portão desconhecido, aparelho inativo ou condomínio inativo | `NotFoundException('QR de entregas indisponível.')` |
| Opção desligada ou fora do horário, em `criarPedido` | `ForbiddenException('Autoatendimento de entregas indisponível agora.')` |
| Unidade não é do condomínio do aparelho | `BadRequestException('Unidade inválida.')` |
| Nome com menos de 2 ou mais de 80 caracteres | `BadRequestException('Informe seu nome.')` |
| Foto ausente | `BadRequestException('Envie uma foto do seu rosto.')` |
| Foto fora de `FOTO_MIME` | `BadRequestException('Envie uma foto em JPEG, PNG ou WebP.')` |
| Foto acima de `MAX_FOTO_BYTES` | `BadRequestException('Foto muito grande. Tente novamente.')` |
| Unidade com pedido `pendente` não vencido | `ConflictException('Já há uma entrega aguardando esta unidade. Tente em alguns minutos.')` |
| Mais de `MAX_PEDIDOS_PORTAO_10MIN` pedidos no portão em 10 min | `HttpException('Muitos pedidos neste portão. Aguarde alguns minutos.', 429)` |
| Token do pedido desconhecido, ou de outro portão | `NotFoundException('Pedido não encontrado.')` |

Regras:

- `lerPortao`: lista as unidades do condomínio ordenadas por bloco e apto (ordenação numérica `pt-BR`, como `listarUnidadesMorador`), só `id`, `bloco`, `apto`.
- `criarPedido`, dentro de `comLock(prisma, \`delivery-portao:apto:${id}\`, …)`: valida tudo antes de gravar; marca como `expirado` os pedidos `pendente` vencidos da unidade; se sobrar `pendente`, 409; sobe a foto; chama `registrarChegadaAutoatendimento`; cria o pedido (`expira_em = agora + 5 min`, `visto_em = agora`, `token_hash = hashToken(token)`); chama `vincularPedidoPortao`. Devolve o token em claro uma única vez. Se o upload devolver `null`, 400 "Envie uma foto em JPEG, PNG ou WebP." e nada é gravado.
- `consultar`: atualiza `visto_em`; se `pendente` e vencido, grava `expirado`; devolve `estadoDoPedido` e `falha_abertura` (`falha_abertura_em` preenchido e `aberto_em` nulo).
- `aoMudarStatus`, só quando o atendimento tem `id_pedido_portao`:
  - `AUTORIZADA` por **morador**, pedido `pendente` e não vencido → `status: 'liberado'`, `liberado_ate = agora + 3 min`; se `agora - visto_em <= 10 s`, chama a abertura (abaixo).
  - `AUTORIZADA` por morador, pedido vencido → nada (fica `expirado`).
  - `AUTORIZADA` por **operador** → `status: 'liberado'`, `liberado_ate` nulo. A nuvem não abre.
  - `RETIRADA_NA_PORTARIA` → `vou_buscar`. `RECUSADA` ou `CANCELADA` → `recusado`.
- Abertura (usada pelo gancho e por `abrir`): reserva com `updateMany({ where: { id, status: 'liberado', aberto_em: null, liberado_ate: { gte: agora } }, data: { aberto_em: agora } })`; só com `count === 1` chama `abrirDispositivoInterno(pedido.id_device, { origem: 'delivery_portao', tipoPessoa: 'entregador', idPessoa: null, nomePessoa: pedido.nome, credencial: \`delivery:${id_atendimento}\` })`. Se voltar `ok: false`, desfaz (`aberto_em: null`, `falha_abertura_em: agora`) para permitir nova tentativa dentro da janela.
- `sair`: reserva com `updateMany` exigindo `aberto_em` preenchido, `saida_aberta_em` nulo e `aberto_em >= agora - 30 min`; abre o mesmo `id_device`; falha desfaz a reserva. Abriu → `transicionarPeloSistema(id_atendimento, 'CONCLUIDA', 'Concluído na saída do entregador')`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('lerPortao devolve só id, bloco e apto das unidades, e nenhuma outra chave');
it('lerPortao com a opção desligada: disponivel false, motivo "desligado", unidades vazias');
it('lerPortao fora do horário: motivo "fora_horario" e o horário configurado');
it('criarPedido grava pedido pendente, sobe a foto em delivery-portao e devolve o token (64 hex) uma vez');
it('criarPedido: a resposta não contém foto, nome de morador nem id de usuário');
it('segundo pedido para a mesma unidade com um pendente: 409 e nada gravado');
it('dois criarPedido simultâneos para a mesma unidade: um 200 e um 409');            // Review Focus 1
it('pedido pendente vencido não bloqueia: o novo entra no mesmo atendimento e o card reabre');
it('unidade de outro condomínio, nome vazio, foto vazia, foto text/html, foto de 3 MB: 400 e nada gravado'); // RF 5
it('21º pedido no mesmo portão em 10 min: 429');
it('morador libera com a página presente (visto há 3 s): abre o id_device do pedido uma vez');
it('morador libera com a página ausente (visto há 40 s): não abre; consultar devolve pode_abrir true');
it('abrir dentro da janela abre uma vez; a segunda chamada devolve abriu:false');
it('abrir depois de liberado_ate: abriu false, situacao "expirado"');
it('abertura falha: abriu false, falha_abertura true, e nova tentativa dentro da janela abre'); // RF 3
it('morador libera pedido já vencido: nada abre e liberado_ate continua nulo');        // RF 2
it('operador autoriza: situacao "liberado_portaria" e a nuvem não abre');
it('vou buscar: situacao "vou_buscar"; recusa: "recusado"');
it('sair abre o mesmo aparelho uma vez, até 30 min após a entrada, e conclui o atendimento');
it('token de pedido de outro portão, ou inexistente: 404');
it('a abertura sempre usa o id_device do pedido, mesmo com outro portão no token da URL');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts delivery-portao.service` → FAIL.
- [ ] **Step 3: Implementar** conforme Regras. Sem rotina ainda (Tarefa 8).
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS; `npx nx typecheck api` → sem erros (confirma que `DeliveryModule` importar `FacialModule` não criou ciclo; se criar, usar `forwardRef` nos dois lados).
- [ ] **Step 5: Commit** — `feat(delivery): pedido de portão com presença, abertura única e saída`.

### Task 7: Rotas públicas e rotas do síndico

**Files:**
- Create: `apps/api/src/app/delivery/portao/entrega-publico.controller.ts`
- Create: `apps/api/src/app/delivery/portao/entrega-config.controller.ts`
- Modify: `apps/api/src/app/delivery/delivery.module.ts` (os dois controllers)
- Modify: `apps/api/src/app/delivery/portao/delivery-portao.service.ts` (métodos de configuração)
- Test: `apps/api/src/app/delivery/portao/entrega-rotas.spec.ts`

**Interfaces:**
- Consumes: Tarefa 6; `assertTenantStrict`, `assertSindicoEstrito` (`auth/tenant.util.ts`); `TenantAccessService.assertCondominio`; `FacialService.getDevice`; `process.env.CONVITE_BASE_URL` com o mesmo padrão de `convites.service.ts:268-271`.
- Produces:

| Rota | Proteção | Corpo | Resposta |
|---|---|---|---|
| `GET entrega/publico/:token` | pública | — | `PortaoPublico` |
| `POST entrega/publico/:token` | pública, `@Throttle({ medium: { limit: 5, ttl: 600_000 } })` | `{ id_apartamento, nome, plataforma?, foto }` | `EstadoPedido & { pedido }` |
| `GET entrega/publico/:token/pedido/:pedido` | pública | — | `EstadoPedido & { falha_abertura }` |
| `POST entrega/publico/:token/pedido/:pedido/abrir` | pública, `@Throttle({ medium: { limit: 10, ttl: 60_000 } })` | — | `EstadoPedido & { abriu }` |
| `POST entrega/publico/:token/pedido/:pedido/sair` | pública, mesmo limite | — | `EstadoPedido & { abriu }` |
| `GET entrega/config?id_condominio=` | JWT global, operador | — | `{ habilitado: boolean; inicio: string \| null; fim: string \| null }` |
| `PUT entrega/config` | síndico estrito | `{ id_condominio, habilitado, inicio, fim }` | o mesmo |
| `POST entrega/portao/:idDevice/token` | síndico estrito | — | `{ token: string; url: string }` |
| `DELETE entrega/portao/:idDevice/token` | síndico estrito | — | `{ ok: true }` |

Métodos novos do serviço: `lerConfig(idCondominio)`, `salvarConfig(idCondominio, { habilitado, inicio, fim })`, `gerarTokenPortao(idDevice)`, `removerTokenPortao(idDevice)`.

Regras:

- As três rotas públicas levam `@SkipAudit()`, `@Public()` e `@HttpCode(200)` nos `POST`. O corpo é tipo inline, como no convite: ler só os quatro campos, ignorar o resto.
- `salvarConfig`: `inicio` e `fim` ou os dois nulos, ou os dois válidos por `horarioValido`; senão `BadRequestException('Horário inválido. Use HH:MM.')`.
- `gerarTokenPortao`: `randomBytes(24)` em hex (48 caracteres); aceita aparelho de qualquer tipo que abra (`botoeira`, `catraca`, `facial`), recusa os demais com `BadRequestException('Este tipo de aparelho não abre portão.')`; trocar o token invalida a folha antiga. `url` = `<base>/entrega/<token>`.
- `listDevices` já devolve a linha inteira do aparelho, então `token_entrega` chega à tela sem mudança no `FacialService`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('as cinco rotas públicas têm @Public, @SkipAudit e os POST respondem 200');
it('POST do pedido ignora campos extras do corpo (id_condominio, status)');
it('nenhuma resposta pública contém as chaves foto, id_morador_user, nome_morador, telefone'); // varre o JSON recursivamente
it('PUT config exige síndico; porteiro recebe 403');
it('PUT config com inicio sem fim, ou "25:00": 400 "Horário inválido. Use HH:MM."');
it('gerar token em leitor de tag: 400; em botoeira: token de 48 hex e url terminando em /entrega/<token>');
it('gerar de novo troca o token; o antigo passa a dar 404 em GET entrega/publico/:token');
it('síndico de outro condomínio não gera token nem altera config');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts entrega-rotas` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS; `npx nx typecheck api` → sem erros.
- [ ] **Step 5: Commit** — `feat(delivery): rotas públicas do portão e configuração do síndico`.

### Task 8: Rotina — expirar, cancelar, concluir e apagar fotos

**Files:**
- Modify: `apps/api/src/app/delivery/portao/delivery-portao.service.ts` (`onModuleInit`, `onModuleDestroy`, `tick`, `tickFotos`)
- Test: `apps/api/src/app/delivery/portao/delivery-portao.rotina.spec.ts`

**Interfaces:**
- Consumes: `executarComLock` (`common/lock-distribuido.ts:174`); `DeliveryService.transicionarPeloSistema`; `StorageService.deleteUrl(url, PREFIXOS_FOTO_PEDIDO_PORTAO)`; constantes da Tarefa 2.
- Produces: `tick(): Promise<void>` e `tickFotos(dias = FOTO_RETENCAO_DIAS): Promise<number>`, públicos para teste.

Regras:

- Agendamento no padrão de `card-ao-vivo.service.ts:146-153` e `convites.service.ts`: nada em `NODE_ENV === 'test'`; `tick` a cada 5 minutos com `executarComLock(prisma, 'delivery-portao:tick', …)`; `tickFotos` uma vez por dia com `executarComLock(prisma, 'delivery-portao:fotos', …, { intervaloMinimoMs: 24 * 60 * 60 * 1000 })`; timers com `unref`.
- `tick`, nesta ordem:
  1. pedidos `pendente` com `expira_em <= agora` → `expirado`;
  2. atendimentos `origem = 'autoatendimento'` em `CHEGOU` ou `AGUARDANDO_AUTORIZACAO` com `chegou_em <= agora - 2 h` → `CANCELADA`, mensagem `'Sem resposta do morador'`. Avisos de `origem = 'portaria'` não são tocados;
  3. atendimentos `AUTORIZADA` cujo pedido tem `aberto_em <= agora - 30 min` → `CONCLUIDA`, `'Concluído automaticamente após a entrada'`;
  4. atendimentos `origem = 'autoatendimento'` em `AUTORIZADA` sem abertura, ou em `RETIRADA_NA_PORTARIA`, com `updated_at <= agora - 2 h` → `CONCLUIDA`, `'Encerrado automaticamente'`.
- `tickFotos`: pedidos com `criado_em` anterior a 90 dias e `foto` preenchida, em lotes de 500: apaga do bucket e zera `foto`. Falha em um arquivo não interrompe o lote.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('pedido pendente vencido vira expirado; o não vencido fica');
it('autoatendimento sem resposta há 2h01 é cancelado com "Sem resposta do morador"; há 1h59 não');
it('aviso AGENDADA/CHEGOU de origem portaria nunca é cancelado pela rotina');
it('atendimento aberto há 31 min é concluído; há 29 min não');
it('autoatendimento AUTORIZADA sem abertura e RETIRADA_NA_PORTARIA há 2h01 são concluídos');
it('tickFotos apaga só dentro de delivery-portao/, zera a coluna e segue após falha de um arquivo');
it('um erro num atendimento não impede os seguintes');
```

- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts delivery-portao.rotina` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** `npx jest -c apps/api/jest.config.cts delivery card-ao-vivo facial` → PASS; `npx nx typecheck api` → sem erros; `npx nx build api` → concluído.
- [ ] **Step 5: Commit** — `feat(delivery): rotina do autoatendimento no portão`.

---

## Bloco C — Portaria-web

### Task 9: QR de entregas na tela de terminais

**Files:**
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais.service.ts`
- Modify: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.component.ts` e `.html`
- Create: `apps/portaria-web/src/app/terminais-faciais/folha-qr-entregas.ts` (monta a folha de impressão)
- Test: `apps/portaria-web/src/app/terminais-faciais/terminais-faciais-page.qr-entregas.spec.ts`

**Interfaces:**
- Consumes: `POST entrega/portao/:idDevice/token`, `DELETE entrega/portao/:idDevice/token` (Tarefa 7); `token_entrega` na linha do aparelho; a biblioteca de QR que a ideia 1 instalou (`qrcode-generator`, conferir em `package.json`; se não estiver, `npm install qrcode-generator` em `click-cond-web`). **Não** usar `api.qrserver.com`.
- Produces: `gerarTokenEntrega(idDevice): Observable<{ token: string; url: string }>`, `removerTokenEntrega(idDevice): Observable<{ ok: true }>`; `htmlDaFolha(d: { condominio: string; portao: string; svgQr: string }): string`.

Comportamento:

- Só aparelhos `botoeira`, `catraca` e `facial` mostram a ação, e só para síndico.
- Sem token: botão "Gerar QR de entregas". Com token: "Imprimir QR de entregas", "Gerar novo" (com confirmação: "O QR impresso deixa de valer. Continuar?") e "Desligar".
- A folha (A5, fundo branco, texto preto, para colar no portão): título "Entregas", linha "Aponte a câmera aqui", o QR com pelo menos 60 mm, nome do condomínio e nome do portão. Abre em janela nova e chama a impressão.

- [ ] **Step 1: Escrever os testes que falham:** aparelho `tag_reader` não mostra a ação; porteiro não vê a ação; "Gerar" chama a rota e passa a mostrar "Imprimir"; "Gerar novo" só chama a rota depois da confirmação; `htmlDaFolha` contém "Entregas", "Aponte a câmera aqui", o condomínio, o portão e o SVG recebido, e não contém `qrserver`.
- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/portaria-web/jest.config.cts qr-entregas` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** `npx jest -c apps/portaria-web/jest.config.cts terminais-faciais` → PASS.
- [ ] **Step 5: Commit** — `feat(portaria-web): QR de entregas do portão`.

### Task 10: Página pública do entregador

**Files:**
- Create: `apps/portaria-web/src/app/entrega/entrega-page.component.ts`
- Modify: `apps/portaria-web/src/app/app.routes.ts` (rota `entrega/:token`, ao lado de `convite/:token`, linha 61, fora do bloco autenticado)
- Test: `apps/portaria-web/src/app/entrega/entrega-page.component.spec.ts`

**Interfaces:**
- Consumes: as cinco rotas públicas (Tarefa 7), via `HttpClient` e `API_BASE` (`shared/api.config`), como `convite-page.component.ts`; a redução de foto dessa mesma página (linhas 244-263), com lado maior de 800 px e JPEG 0.8.
- Produces: componente standalone `EntregaPageComponent`, seletor `app-entrega-page`.

Comportamento e textos exatos:

| Momento | Tela |
|---|---|
| Carregando | o mesmo indicador do convite |
| Token inválido (404) | "Este QR não vale mais. Procure a portaria." |
| `motivo: 'desligado'` | "O autoatendimento de entregas está desligado. Procure a portaria." |
| `motivo: 'fora_horario'` | "O autoatendimento de entregas funciona das HH:MM às HH:MM." |
| Formulário | condomínio e portão no topo; seletores de bloco e de apartamento (só números); "Seu nome"; "Plataforma" (iFood, Mercado Livre, Outra); botão "Tirar foto" com `capture="user"`; aviso "Sua foto será mostrada ao morador e guardada pelo condomínio por 90 dias."; botão "Pedir entrada" desabilitado até haver unidade, nome e foto |
| `aguardando` | "Aguardando o morador" |
| `sem_resposta` | "Sem resposta" + "Procure a portaria ou use o interfone." (continua consultando) |
| `liberado` | "Liberado" + botão "Abrir portão" |
| `aberto` | "Portão aberto. Pode entrar." + botão "Abrir para sair" quando `pode_sair` |
| `liberado_portaria` | "Liberado pela portaria. Aguarde a abertura." |
| `vou_buscar` | "O morador vai buscar na portaria" |
| `recusado` | "Não autorizado" |
| `expirado` | "O pedido expirou." + botão "Tentar de novo" (volta ao formulário) |
| `falha_abertura` ou `abriu: false` | "Não foi possível abrir, procure a portaria" (o botão continua enquanto `pode_abrir`) |
| 409 no envio | a mensagem da API |

- Consulta a cada 3 segundos enquanto a situação não é final (`vou_buscar`, `recusado`, `expirado`, ou `aberto` sem `pode_sair`); para ao sair da página.
- Guarda o token do pedido em `localStorage`, chave `prestare.entrega.<token do portão>`; ao abrir a página com a chave presente, consulta antes de mostrar o formulário, e apaga a chave em 404 ou situação final. `localStorage` indisponível não quebra a página.
- Visual: `app-bg`, `ps-panel`, `ps-h1`, `ps-btn`, marca no topo como no convite. Nenhum dado de morador aparece, porque a API não devolve.

- [ ] **Step 1: Escrever os testes que falham:** cada linha da tabela vira um teste de texto; o formulário não envia sem foto; o envio manda exatamente `{ id_apartamento, nome, plataforma, foto }`; a página retoma o pedido guardado sem mostrar o formulário; a consulta para em situação final; `localStorage` que lança não derruba a página.
- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/portaria-web/jest.config.cts entrega-page` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS; `npx nx build portaria-web` → concluído.
- [ ] **Step 5: Commit** — `feat(portaria-web): página do entregador no portão`.

### Task 11: Selfie e portão no console; opção do condomínio

**Files:**
- Modify: `apps/portaria-web/src/app/delivery/delivery.model.ts` (`DeliveryAtendimento`)
- Modify: `apps/portaria-web/src/app/delivery/delivery.store.ts` (`podeAutorizar`, 171-175; `atualizarStatus`, 181-185; `nomeEntregador`)
- Modify: `apps/portaria-web/src/app/delivery/delivery.service.ts` (config)
- Modify: `apps/portaria-web/src/app/delivery/fila/delivery-detalhe.component.html` e `.ts`, `fila/delivery-fila.component.html`, `historico/delivery-historico.component.html`
- Modify: `apps/portaria-web/src/app/delivery/delivery-page.component.ts` e `.html` (painel da opção)
- Test: `apps/portaria-web/src/app/delivery/delivery.store.spec.ts`, `fila/delivery-fila.component.spec.ts`, `delivery-page.component.spec.ts`

**Interfaces:**
- Consumes: `pedido_portao` e `origem` nas listas (Tarefa 5); `GET`/`PUT entrega/config` (Tarefa 7).
- Produces no modelo: `origem?: 'portaria' | 'autoatendimento'`; `pedido_portao?: { nome: string; plataforma?: string | null; foto?: string | null; status: string; portao: string; aberto_em?: string | null; saida_aberta_em?: string | null } | null`.

Comportamento:

- `podeAutorizar` devolve verdadeiro para `origem === 'autoatendimento'` sem entregador selecionado; com entregador selecionado e bloqueado, continua falso.
- `nomeEntregador` usa `pedido_portao.nome` quando não há entregador cadastrado.
- Detalhe: no bloco "Entregador", a selfie (120 px, `alt` "Foto do entregador"), a plataforma e a linha "No portão: <nome>"; com `aberto_em`, "Entrou às HH:MM" e, com `saida_aberta_em`, "Saiu às HH:MM". Sob o botão de autorizar de um atendimento de autoatendimento, o texto "Autorizar aqui não abre o portão pelo sistema. Abra pelo meio de sempre."
- Fila e histórico: selo "Autoatendimento" na linha e miniatura da selfie quando houver.
- Painel "Autoatendimento no portão", no topo da página de delivery, só para síndico: chave liga/desliga, horários de início e fim (os dois vazios = dia inteiro), botão "Salvar" e o texto "O entregador lê o QR no portão, tira uma foto e o morador decide. Gere o QR de cada portão em Terminais."

- [ ] **Step 1: Escrever os testes que falham:** `podeAutorizar` nos três casos; `nomeEntregador` com e sem pedido; detalhe mostra selfie, portão e o texto do aviso só em autoatendimento; fila mostra o selo; painel some para porteiro; "Salvar" envia `{ id_condominio, habilitado, inicio, fim }`; horário só com início mostra o erro devolvido pela API.
- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery` → os novos FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS; `npx nx build portaria-web` → concluído.
- [ ] **Step 5: Commit** — `feat(portaria-web): selfie do entregador na fila e opção de autoatendimento`.

**Ponto de parada para o teste na AWS.** Com os Blocos A, B e C publicados, o fluxo inteiro funciona com o app que já está nas lojas: o morador recebe o card normal com a selfie e AUTORIZAR vale como liberar entrada; "Vou buscar" ainda não aparece; RECUSAR funciona.

---

## Bloco D — App (por último; nada acima depende disto)

### Task 12: Tela de detalhe com selfie e as três respostas

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/models/delivery_model.dart`
- Modify: `click-cond-app/click-cond-app/lib/controllers/controller_delivery.dart` (junto de `apiResponderDelivery`, 152, e `apiResponderDeliveryPorId`, 183)
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/delivery/delivery_details_page.dart` (`_responder`, 35; botões, 108-148), `list_delivery.dart`
- Test: `test/delivery/delivery_model_test.dart`, `test/delivery/controller_delivery_test.dart`, `test/delivery/delivery_details_page_test.dart`

**Interfaces:**
- Consumes: `pedido_portao` na lista do morador (Tarefa 5); `PATCH delivery/:id` com `status: 'RETIRADA_NA_PORTARIA'`.
- Produces:
  - `class DeliveryPedidoPortao { final String nome; final String? plataforma; final String? foto; final String status; final String portao; bool get pendente => status == 'pendente'; factory DeliveryPedidoPortao.fromJson(Map<String, dynamic>) }` e `DeliveryModel.pedidoPortao` (nulo quando a API não manda).
  - `Future<DeliveryResult> apiVouBuscarDelivery(DeliveryModel delivery)` e `Future<DeliveryResult> apiVouBuscarDeliveryPorId(int id, {int? idCondominio})`.

Comportamento, só quando `pedidoPortao?.pendente == true` e o status é `AGUARDANDO_AUTORIZACAO`:

- Selfie do entregador no topo do cartão principal (com o estado de carregamento e de erro dos outros avatares do app), nome, plataforma e "No portão: <portão>".
- Botões, nesta ordem: "Liberar entrada" (primário), "Vou buscar" (secundário), "Recusar" (perigo, com o diálogo de motivo que já existe).
- Mensagens: "Entrada liberada.", "Avisamos o entregador que você vai buscar.", "Entrega recusada.".
- Nos demais deliveries a tela fica como está.

- [ ] **Step 1: Escrever os testes que falham:** `fromJson` com e sem `pedido_portao`; `apiVouBuscarDelivery` manda `PATCH` com `RETIRADA_NA_PORTARIA`; a tela mostra os três botões e a selfie só no caso do portão; a tela de um delivery comum continua com os dois botões de hoje.
- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/delivery` → os novos FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** `flutter test test/delivery` → PASS; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros.
- [ ] **Step 5: Commit** — `feat(app): liberar entrada, vou buscar e selfie do entregador`.

### Task 13: Variante do card no iPhone e no Android

**Files:**
- Modify: `click-cond-app/click-cond-app/ios/CardPortaria/CardPortariaAttributes.swift` (`ContentState`)
- Modify: `click-cond-app/click-cond-app/ios/CardPortaria/CardIntents.swift` (intent novo)
- Modify: `click-cond-app/click-cond-app/ios/CardPortaria/CardPortariaWidget.swift` (botões, 202-232)
- Modify: `click-cond-app/click-cond-app/lib/services/card_ao_vivo/card_android.dart` (ações, 28-29 e 191-195; tratador em segundo plano, 299-330), `textos_card.dart`
- Test: `test/card_ao_vivo/textos_card_test.dart`, `test/card_ao_vivo/resposta_e_link_card_test.dart`

**Interfaces:**
- Consumes: `portao` no estado do card (Tarefa 4); `apiVouBuscarDeliveryPorId` (Tarefa 12).
- Produces:
  - Swift: `var portao: Bool?` no `ContentState` (opcional: estado sem a chave continua decodificando); `struct VouBuscarCardIntent: LiveActivityIntent` com os mesmos parâmetros de `NegarCardIntent` (`idCartao`, `idPedido`, `origem`), que faz `PATCH delivery/<idPedido>` com `RETIRADA_NA_PORTARIA`, em segundo plano, sem pedir desbloqueio.
  - Dart: `static const acaoVouBuscar = 'vou_buscar';` em `CardAndroid`.

Comportamento, só com `portao == true` na fase `aguardando` do delivery:

- iPhone: botão esquerdo "VOU BUSCAR" (contorno, no lugar de RECUSAR, com `VouBuscarCardIntent`); botão direito "LIBERAR ENTRADA" (amarelo da marca, com o `AutorizarCardIntent` de hoje). Mesmas medidas, fonte e cantos retos dos botões atuais (`CardVisual.swift`, 296). Sem cor nova.
- Android: ações "VOU BUSCAR" (segundo plano, `cancelNotification: false`) e "LIBERAR ENTRADA" (abre o app, como AUTORIZAR hoje).
- Sem `portao`, o card é exatamente o de hoje nas duas plataformas.

- [ ] **Step 1: Escrever os testes que falham** (Dart): com `portao: true` os rótulos são "VOU BUSCAR" e "LIBERAR ENTRADA"; sem a chave, "RECUSAR" e "AUTORIZAR"; a ação `vou_buscar` em segundo plano chama `apiVouBuscarDeliveryPorId` com o id do pedido; estado sem `portao` continua sendo lido.
- [ ] **Step 2: Rodar e ver falhar.** `flutter test test/card_ao_vivo` → os novos FAIL.
- [ ] **Step 3: Implementar** Dart e Swift.
- [ ] **Step 4: Rodar e ver passar.** `flutter test test/card_ao_vivo` → PASS; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros. O Swift não compila nesta máquina: conferir à mão que `ContentState` continua `Codable` com o campo opcional e que o intent novo está no alvo `CardPortaria`; a compilação real acontece no pipeline do iOS.
- [ ] **Step 5: Commit** — `feat(app): card do portão com VOU BUSCAR e LIBERAR ENTRADA`.

---

## Bloco E — Fechamento

### Task 14: Verificação completa

**Files:**
- Create: `docs/operacao/autoatendimento-entregas-implantacao.md`

Conteúdo do guia, para quem implanta: ordem de publicação (SQL manual no RDS e conferência da tabela e das colunas → API e web → app depois); como ligar a opção e definir o horário; gerar e imprimir o QR de cada portão; o que o entregador vê; o que muda com e sem porteiro; a foto fica 90 dias; com o app antigo o morador vê AUTORIZAR e RECUSAR, e "Vou buscar" chega com o app novo; sem internet no condomínio ou com o agente fora, o portão não abre e a página manda procurar a portaria.

- [ ] **Step 1: Escrever o guia.**
- [ ] **Step 2: API.** Em `click-cond-web`: `npx nx typecheck api` → sem erros; `npx nx test api` → todos PASS; `npx nx build api` → concluído.
- [ ] **Step 3: Portaria-web.** `npx nx test portaria-web` → todos PASS; `npx nx build portaria-web` → concluído.
- [ ] **Step 4: App** (se o Bloco D foi executado). Em `click-cond-app/click-cond-app`: `flutter pub get`; `flutter analyze --no-fatal-infos --no-fatal-warnings` → sem erros; `flutter test` → todos PASS.
- [ ] **Step 5: Varredura de privacidade.** `grep -rn "qrserver" click-cond-web/apps/portaria-web/src/app/entrega click-cond-web/apps/portaria-web/src/app/terminais-faciais/folha-qr-entregas.ts` → vazio. Ler `entrega-publico.controller.ts` e os retornos de `lerPortao`, `criarPedido`, `consultar`, `abrir` e `sair` confirmando que nenhum devolve `foto`, usuário ou morador.
- [ ] **Step 6: Idempotência do SQL.** Ler `prisma/manual_2026-11_delivery_pedidos_portao.sql` de ponta a ponta confirmando que cada instrução é segura numa segunda execução (não executar contra banco algum nesta tarefa).
- [ ] **Step 7: Roteiro de ponta a ponta, sem o app novo** (para quem testar no ambiente publicado): ligar a opção num condomínio de teste; gerar o QR de um portão; abrir `/entrega/<token>` num celular; escolher a unidade, tirar a foto, pedir entrada; conferir o card ou a notificação no app do morador e a linha na fila da portaria-web com a selfie; AUTORIZAR; conferir "Liberado"/"Portão aberto" na página e o evento `acionado_auto` de tipo `entregador` em Acessos; "Abrir para sair"; conferir o atendimento concluído. Repetir recusando, e repetir deixando vencer os 5 minutos.
- [ ] **Step 8: Commit** — `docs(delivery): guia de implantação do autoatendimento de entregas`.

---

## Decisões tomadas neste plano (onde o desenho deixava ao implementador)

- **Estados da máquina:** a chegada pelo portão leva o atendimento direto a `AGUARDANDO_AUTORIZACAO`, com o card aberto uma vez só. O sistema ganha duas transições próprias (`CHEGOU` e `AGUARDANDO_AUTORIZACAO` → `CANCELADA`), que nenhum usuário pode fazer.
- **"Pedido ativo"** é a coluna `id_pedido_portao`, sem chave estrangeira, para não criar referência circular entre as duas tabelas.
- **Reaproveitamento:** o pedido entra no atendimento aberto mais recente da unidade em `AGENDADA`, `CHEGOU` ou `AGUARDANDO_AUTORIZACAO`, inclusive um que o porteiro já tenha registrado.
- **Corrida entre dois pedidos** resolvida com `comLock` por apartamento.
- **Abertura que falha** devolve a vez: o entregador pode tentar de novo até o fim dos 3 minutos.
- **Autorização do porteiro** marca o pedido como liberado sem janela, e a página diz "Liberado pela portaria. Aguarde a abertura."
- **Rotina** a cada 5 minutos (o desenho dizia horária): com uma hora, a conclusão dos 30 minutos poderia levar 90.
- **Atendimento do autoatendimento autorizado sem abertura, ou "vou buscar", sem porteiro:** concluído pelo sistema em 2 horas.
- **Limites:** 5 pedidos por IP a cada 10 minutos; 20 pedidos por portão a cada 10 minutos; 10 aberturas por IP por minuto.
- **Selfie:** reduzida no navegador a 800 px no lado maior, JPEG 0.8; a API recusa acima de 2 MB em base64.
- **Fotos vencidas:** rotina diária em lotes de 500, apagando só dentro de `delivery-portao/`.
- **Opção e horário** têm rotas próprias (`entrega/config`) e painel na página de delivery, porque a portaria-web não tem tela nem rota geral de configuração do condomínio.
- **Token do portão** em claro no banco (ele é público, está impresso no portão), 48 hex; o do pedido só como hash.
- **QR da folha** desenhado no navegador com a biblioteca da ideia 1, sem serviço de terceiro.
- **Variante do card** vai para todos os aparelhos como chave opcional `portao`; app antigo ignora a chave e mostra RECUSAR / AUTORIZAR.
- **Botões do card:** "VOU BUSCAR" ocupa o lugar de RECUSAR e "LIBERAR ENTRADA" o de AUTORIZAR, sem mudar medidas nem cores.
