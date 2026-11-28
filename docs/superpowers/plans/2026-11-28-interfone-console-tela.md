# Tela Interfone do console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a página `/interfone` do console (números do dia, filtro, linhas legíveis, status do console) e
adicionar Ligar de volta, Foto ampliada, Unidades frequentes e Dias anteriores.

**Architecture:** A API ganha `id_apartamento` e `porta_aberta_por_nome` no item do console e a rota
`GET /interfone/portaria/dia?data=AAAA-MM-DD` (mesma consulta de `hoje`, outro dia). No console, contas e filtros
viram funções puras em `interfone-lista.ts`; `chamadas-hoje` passa a ter números-filtro, seletor de data e modal de
foto; `ligar-unidade` ganha frequentes; a página ganha o selo de estado. `store.hoje` não muda de papel.

**Tech Stack:** NestJS + Prisma (Jest com banco falso), Angular 20 standalone + signals (Jest), Tailwind + classes `ps-*`.

**Spec:** `docs/superpowers/specs/2026-11-28-interfone-console-tela-design.md`

## Global Constraints

- Limite de dias anteriores: hoje até 30 dias para trás (`HISTORICO_DIAS` = 30, já existe na API).
- Só classes do tema Prestare Dark (`ps-*`), claro e escuro.
- Textos em pt-BR; rótulos: "Total", "Atendidas", "Sem resposta", "Falhas", "Portões abertos".
- Grupos de resultado: atendida = `atendida_morador|atendida_portaria`; sem_resposta = `nao_atendida|recusada|cancelada`;
  falha = `falha`; andamento = `null`.
- `store.hoje` continua sendo só hoje (reconcilia o toque).
- Testes: `npx jest <arquivo>` dentro de `click-cond-web/apps/api` e `click-cond-web/apps/portaria-web`.

## Review Focus

- Data de outro dia com virada às 21h–23h59 em Brasília: o intervalo do dia é de Brasília, não UTC → teste em Task 1.
- Chamada sem unidade (`id_apartamento` null): sem botão Ligar e fora de frequentes → testes nas Tasks 2 e 3.
- Ligar de volta enquanto já há chamada/discagem: botão desabilitado como no painel Ligar → teste na Task 3.
- Voltar para hoje depois de ver outro dia: lista volta a ser a ao vivo (`store.hoje`) → teste na Task 3.
- Filtro ativo que zera a lista: mensagem "Nenhuma chamada neste filtro." e não "Nenhuma chamada hoje." → Task 3.

---

### Task 1: API — campos novos e rota `dia`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone-acoes.service.ts` (`hoje`, novo `dia`)
- Modify: `click-cond-web/apps/api/src/app/interfone/interfone-portaria.controller.ts`
- Test: `interfone-acoes.spec.ts`, `interfone-controllers.spec.ts`

**Interfaces:**
- Produces: `dia(idCondominio: number, data: string): Promise<ItemConsole[]>` onde
  `ItemConsole = ItemHistorico & { unidade: string; estado: string; id_apartamento: number | null; porta_aberta_por_nome: string | null }`;
  `hoje()` devolve o mesmo `ItemConsole[]`. Rota `GET interfone/portaria/dia?data=AAAA-MM-DD`.

- [ ] Teste `hoje` passa a esperar `id_apartamento: 100` e `porta_aberta_por_nome: null`.
- [ ] Teste `dia`: com AGORA = 27/11/2026 14:05 Brasília, `dia(1,'2026-11-27')` traz a chamada; `'2026-11-26'` → `[]`;
  `'2026-11-28'` (futuro), `'2026-10-27'` (31 dias), `'27/11/2026'`, `'2026-02-30'` → `BadRequestException` (status 400);
  `'2026-10-28'` (30 dias) → resolve; condomínio desligado → 403.
- [ ] Teste do controller: `c.dia(PORTEIRO, '2026-11-27')` chama `acoes.dia(1, '2026-11-27')`; morador → erro "porteiro".
- [ ] Implementar: consulta compartilhada `chamadasDoDia(idCondominio, instante)` usando
  `intervaloHojeBrasilia(instante)`; `dia` valida `/^\d{4}-\d{2}-\d{2}$/`, monta o instante do meio-dia UTC da data,
  confere que o dia de Brasília gerado bate com a string (rejeita 30/02) e que está entre hoje-30 e hoje (dias de
  calendário de Brasília). Mensagem 400: "Escolha uma data de hoje até 30 dias atrás."
- [ ] Rodar `npx jest src/app/interfone` → PASS. Commit.

### Task 2: Console — tipos, cliente e funções puras

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/interfone/interfone.api.ts` (tipos + `dia`)
- Create: `click-cond-web/apps/portaria-web/src/app/interfone/interfone-lista.ts`
- Test: `interfone-lista.spec.ts`; ajustar `interfone.testing.ts` (HOJE com os campos novos, stub `dia`)

**Interfaces:**
- Produces:
  - `ChamadaHoje` + `id_apartamento: number | null`, `porta_aberta_por_nome: string | null`;
    `InterfoneApi.dia(data: string): Observable<ChamadaHoje[]>`.
  - `type GrupoResultado = 'atendida' | 'sem_resposta' | 'falha' | 'andamento'`; `grupo(c): GrupoResultado`.
  - `type FiltroChamadas = 'todas' | 'atendidas' | 'sem_resposta' | 'falhas' | 'portoes'`;
    `filtrar(lista, f): ChamadaHoje[]`.
  - `contar(lista): Record<FiltroChamadas, number>`.
  - `frequentes(lista, max = 5): { id_apartamento: number; unidade: string; total: number }[]` (ordem: total desc,
    depois a chamada mais recente primeiro; ignora `id_apartamento` null).
  - `dataLocal(d: Date): string` (AAAA-MM-DD no fuso do navegador) e `limitesData(hoje: Date): { min: string; max: string }` (30 dias).
- [ ] Testes de cada função com uma lista de 6 chamadas cobrindo os 6 resultados, um `null`, uma sem unidade e duas da mesma unidade.
- [ ] Implementar, rodar `npx jest src/app/interfone/interfone-lista.spec.ts` → PASS. Commit.

### Task 3: Lista de chamadas — números, filtro, linhas, ligar de volta, foto, dias anteriores

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/interfone/chamadas-hoje.component.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/interfone/foto-chamada.component.ts` (modal)
- Test: `chamadas-hoje.component.spec.ts` (novo), `foto-chamada.component.spec.ts`

**Interfaces:**
- Consumes: Task 2; `InterfoneStore.hoje/ligar/emChamada/discando/atendendo`.
- Produces: `<app-chamadas-hoje />` sem inputs (o `alturaLivre` sai; a página é o único uso).
  `<app-foto-chamada [chamada]="c" (fechar)="…" />`.
- [ ] Testes: 5 cartões com as contagens; clicar "Falhas" mostra só falhas e marca `aria-pressed`; clicar de novo volta
  a "todas"; filtro sem itens → "Nenhuma chamada neste filtro."; linha mostra etiqueta do grupo e "Portão aberto por X";
  botão Ligar chama `store.ligar(100, 'Bloco A · Apto 106')` e fica desabilitado com `emChamada` preenchido; sem
  `id_apartamento` não há botão; clicar na foto abre o modal, Esc fecha; mudar a data chama `api.dia('2026-11-20')`,
  mostra a faixa "Vendo 20/11" e os itens do dia; "Voltar para hoje" volta para `store.hoje`; falha em `dia` → aviso
  "Não foi possível carregar as chamadas desse dia.".
- [ ] Implementar com `ps-kpis` clicáveis (padrão de `delivery-fila`), `ps-tag` + `ps-dot-ok|warn|danger`,
  `input type=date` com `min/max` de `limitesData`, `ps-scrim`/`ps-modal` no modal. Lista com altura da tela.
- [ ] Rodar os specs → PASS. Commit.

### Task 4: Ligar — unidades frequentes

**Files:** Modify `ligar-unidade.component.ts`; Test `ligar-unidade.component.spec.ts`
- [ ] Testes: busca vazia + `store.hoje` com chamadas → seção "Mais chamadas hoje" com até 5 unidades e contagem;
  "Ligar" chama `store.ligar`; sem chamadas → dica "Digite o bloco ou o número do apartamento."; com busca digitada a
  seção some.
- [ ] Implementar com `frequentes(store.hoje())`. Rodar spec → PASS. Commit.

### Task 5: Página — selo de estado e layout

**Files:** Modify `interfone-page.component.ts`; Test `interfone-page.component.spec.ts`
- [ ] Testes: `semChamadas()` null e `somBloqueado()` false → "Pronto para receber chamadas"; `somBloqueado()` true →
  texto de som bloqueado com botão "Ativar som" que chama `store.ativarSom()`;
  `semChamadas()` com texto → mostra o texto em tom de alerta.
- [ ] Implementar no `ps-phead`; layout `lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`. Rodar spec → PASS. Commit.

### Task 6: Verificação

- [ ] `npx jest src/app/interfone` (api e portaria-web) e `npx tsc -p tsconfig.app.json --noEmit` / build do portaria-web → sem erro.
- [ ] Revisão do branch inteiro por um revisor novo; corrigir o que for real.
- [ ] Publicar (master e main, conforme o fluxo do projeto) e conferir a tela em produção.
