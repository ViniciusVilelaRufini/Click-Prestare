# Delivery no console — Redesenho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar e redesenhar a tela `/delivery` do console (portaria-web) e dar à API escopos de listagem e um resumo por período.

**Architecture:** API NestJS ganha `escopo/de/ate` opcionais em `GET /delivery` (só operador; sem escopo = comportamento atual) e `GET /delivery/resumo`. No front, a página vira um casco que provê um `DeliveryStore` (signals) consumido por componentes de aba (`fila/`, `entregadores/`, `historico/`) e por peças compartilhadas (`shared/`).

**Tech Stack:** NestJS + Prisma (MySQL), Angular 21 standalone (signals, `input()`, `@if/@for`), Tailwind 3 (`darkMode: 'class'`), Jest (jest-preset-angular), Playwright MCP para verificação visual.

**Spec:** `docs/superpowers/specs/2026-10-04-delivery-redesign-design.md`

## Global Constraints

- Sem `escopo`, `GET /delivery` responde exatamente como hoje (o app Flutter do morador depende disso). Para não-operador, `escopo/de/ate` são ignorados.
- Terminais: `CONCLUIDA`, `CANCELADA`, `RECUSADA`. Histórico: `take: 500`, `created_at desc`. Padrão sem datas: últimos 30 dias (fim = hoje, início = hoje − 29 dias). `ate` inclusivo até 23:59:59.999. Datas `YYYY-MM-DD`, fuso fixo `-03:00`.
- `escopo` inválido → `400`; `/resumo` para não-operador → `403`.
- Nenhuma mudança de schema/migração.
- Front: só tokens do tema (`bg-graphite-200`, `bg-graphite`, `border-white/10`, `text-white`, `text-slate-*`, `accent`). Cores de status sempre em par claro/escuro: `text-<cor>-700 dark:text-<cor>-300` etc. Proibido: `bg-slate-50`, `indigo-*`, `bg-slate-800`.
- Templates novos usam `@if/@for`, não `*ngIf/*ngFor`.
- Rótulos de status em caixa de frase com acento (tabela do spec). Textos ao usuário em pt-BR.
- Atualização automática da fila: 20 s, só com aba Fila ativa e `document.visibilityState === 'visible'`. Tempo de espera fica âmbar acima de 10 min para `CHEGOU`/`AGUARDANDO_AUTORIZACAO`.
- Comandos rodam a partir de `click-cond-web/`. Testes API: `npx jest -c apps/api/jest.config.cts apps/api/src/app/delivery`. Testes front: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push/deploy só com confirmação do usuário (Task 10).

---

### Task 1: API — escopos em `GET /delivery`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/delivery/delivery.service.ts` (constantes no topo, `listarAtendimentos` ~linha 104, helper privado novo `periodo`)
- Modify: `click-cond-web/apps/api/src/app/delivery/delivery.controller.ts` (`listar`)
- Test: `click-cond-web/apps/api/src/app/delivery/delivery.service.spec.ts`

**Interfaces:**
- Produces: `listarAtendimentos(idCondominio: number, status: string | undefined, user: JwtPayload, filtro?: { escopo?: string; de?: string; ate?: string })`; `private periodo(de?: string, ate?: string): { de: string; ate: string; gte: Date; lte: Date }`; constante `TERMINAIS`.

- [ ] **Step 1: Testes falhando** — acrescentar ao final do `describe` em `delivery.service.spec.ts`:

```ts
  describe('escopos da listagem operacional', () => {
    afterEach(() => jest.useRealTimers());

    it('escopo=ativos exclui terminais', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro, { escopo: 'ativos' });
      const { where } = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(where.AND).toEqual([{ status: { notIn: ['CONCLUIDA', 'CANCELADA', 'RECUSADA'] } }]);
      expect(where.created_at).toBeUndefined();
    });

    it('escopo=historico usa últimos 30 dias, ate inclusivo e limite de 500', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-04T15:00:00Z'));
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico' });
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual([{ status: { in: ['CONCLUIDA', 'CANCELADA', 'RECUSADA'] } }]);
      expect(args.where.created_at).toEqual({
        gte: new Date('2026-09-05T00:00:00-03:00'),
        lte: new Date('2026-10-04T23:59:59.999-03:00'),
      });
      expect(args.take).toBe(500);
    });

    it('escopo=historico respeita de/ate informados', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, sindico, { escopo: 'historico', de: '2026-10-01', ate: '2026-10-02' });
      expect(prisma.deliveryAtendimentos.findMany.mock.calls[0][0].where.created_at).toEqual({
        gte: new Date('2026-10-01T00:00:00-03:00'),
        lte: new Date('2026-10-02T23:59:59.999-03:00'),
      });
    });

    it('rejeita escopo inválido e datas malformadas', async () => {
      const { service } = montar();
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'tudo' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico', de: '01/10/2026' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(service.listarAtendimentos(1, undefined, porteiro, { escopo: 'historico', de: '2026-10-05', ate: '2026-10-01' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('morador ignora escopo e mantém o formato atual', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, morador, { escopo: 'tudo' });
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ id_condominio: 1, id_morador_user: 10 });
      expect(args.take).toBeUndefined();
    });

    it('sem escopo o operador recebe a listagem de sempre', async () => {
      const { service, prisma } = montar();
      await service.listarAtendimentos(1, undefined, porteiro);
      const args = prisma.deliveryAtendimentos.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ id_condominio: 1 });
      expect(args.take).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/api/jest.config.cts apps/api/src/app/delivery/delivery.service.spec.ts -t "escopos"`
Expected: FAIL (`where.AND` undefined / promise não rejeita).

- [ ] **Step 3: Implementar no service**

Logo abaixo de `TRANSICOES`:

```ts
const TERMINAIS: readonly DeliveryStatus[] = ['CONCLUIDA', 'CANCELADA', 'RECUSADA'];
const LIMITE_HISTORICO = 500;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
```

Substituir o início de `listarAtendimentos` até o `return` do ramo operador por:

```ts
  async listarAtendimentos(
    idCondominio: number,
    status: string | undefined,
    user: JwtPayload,
    filtro: { escopo?: string; de?: string; ate?: string } = {},
  ) {
    await this.tenant.assertCondominio(Number(idCondominio), user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (status) where.status = status;
    const operador = isOperador(user);
    if (!operador) where.id_morador_user = this.idUsuario(user);
    if (operador) {
      let take: number | undefined;
      if (filtro.escopo === 'ativos') {
        where.AND = [{ status: { notIn: [...TERMINAIS] } }];
      } else if (filtro.escopo === 'historico') {
        const { gte, lte } = this.periodo(filtro.de, filtro.ate);
        where.AND = [{ status: { in: [...TERMINAIS] } }];
        where.created_at = { gte, lte };
        take = LIMITE_HISTORICO;
      } else if (filtro.escopo !== undefined && filtro.escopo !== '') {
        throw new BadRequestException('escopo deve ser "ativos" ou "historico".');
      }
      return (this.prisma as any).deliveryAtendimentos.findMany({
        where,
        include: {
          apartamento: { select: { id: true, bloco: true, apto: true } },
          entregador: { include: { veiculos: true } },
          eventos: { orderBy: { created_at: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        ...(take ? { take } : {}),
      });
    }
```

(o ramo do morador abaixo permanece igual). Junto dos helpers privados no fim da classe:

```ts
  /** Intervalo em datas locais (America/Sao_Paulo, -03:00 fixo); padrão: últimos 30 dias. */
  private periodo(de?: string, ate?: string) {
    if ((de && !DATA_ISO.test(de)) || (ate && !DATA_ISO.test(ate))) {
      throw new BadRequestException('Datas devem estar no formato AAAA-MM-DD.');
    }
    const hojeLocal = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const fim = ate || hojeLocal;
    const inicio = de || new Date(Date.parse(`${fim}T00:00:00Z`) - 29 * DIA_MS).toISOString().slice(0, 10);
    const gte = new Date(`${inicio}T00:00:00-03:00`);
    const lte = new Date(`${fim}T23:59:59.999-03:00`);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) {
      throw new BadRequestException('Período inválido.');
    }
    return { de: inicio, ate: fim, gte, lte };
  }
```

- [ ] **Step 4: Controller** — substituir `listar`:

```ts
  @Get()
  listar(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @Query('status') status: string | undefined,
    @ReqUser() user: JwtPayload,
    @Query('escopo') escopo?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.listarAtendimentos(idCondominio, status, user, { escopo, de, ate });
  }
```

- [ ] **Step 5: Rodar todos os testes do módulo**

Run: `npx jest -c apps/api/jest.config.cts apps/api/src/app/delivery`
Expected: PASS (novos + antigos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app/delivery/delivery.service.ts apps/api/src/app/delivery/delivery.controller.ts apps/api/src/app/delivery/delivery.service.spec.ts
git commit -m "feat(delivery): escopos ativos/historico na listagem operacional"
```

---

### Task 2: API — `GET /delivery/resumo`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/delivery/delivery.service.ts` (método `resumo`)
- Modify: `click-cond-web/apps/api/src/app/delivery/delivery.controller.ts` (rota `resumo`, declarada antes de `@Patch(':id')`)
- Test: `click-cond-web/apps/api/src/app/delivery/delivery.service.spec.ts`

**Interfaces:**
- Consumes: `periodo`, `TERMINAIS`, `assertOperador` (Task 1 / existente).
- Produces: `resumo(idCondominio: number, de: string | undefined, ate: string | undefined, user: JwtPayload): Promise<{ ativos: Record<string, number>; periodo: { de: string; ate: string; CONCLUIDA: number; CANCELADA: number; RECUSADA: number; total: number }; tempo_medio_atendimento_min: number | null }>`

- [ ] **Step 1: Testes falhando**

```ts
  describe('resumo', () => {
    it('conta ativos, terminais do período e tempo médio', async () => {
      const { service, prisma } = montar();
      prisma.deliveryAtendimentos.groupBy = jest.fn()
        .mockResolvedValueOnce([{ status: 'CHEGOU', _count: { _all: 2 } }, { status: 'AGENDADA', _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ status: 'CONCLUIDA', _count: { _all: 3 } }, { status: 'RECUSADA', _count: { _all: 1 } }]);
      prisma.deliveryAtendimentos.findMany = jest.fn().mockResolvedValueOnce([
        { chegou_em: new Date('2026-10-01T10:00:00Z'), concluido_em: new Date('2026-10-01T10:05:00Z') },
        { chegou_em: new Date('2026-10-01T11:00:00Z'), concluido_em: new Date('2026-10-01T11:10:00Z') },
      ]);

      const resumo = await service.resumo(1, '2026-10-01', '2026-10-04', sindico);

      expect(resumo).toEqual({
        ativos: { AGENDADA: 1, CHEGOU: 2, AGUARDANDO_AUTORIZACAO: 0, AUTORIZADA: 0, RETIRADA_NA_PORTARIA: 0 },
        periodo: { de: '2026-10-01', ate: '2026-10-04', CONCLUIDA: 3, CANCELADA: 0, RECUSADA: 1, total: 4 },
        tempo_medio_atendimento_min: 7.5,
      });
      expect(prisma.deliveryAtendimentos.groupBy.mock.calls[1][0].where.created_at).toEqual({
        gte: new Date('2026-10-01T00:00:00-03:00'),
        lte: new Date('2026-10-04T23:59:59.999-03:00'),
      });
    });

    it('devolve tempo médio nulo sem concluídos com horários', async () => {
      const { service, prisma } = montar();
      prisma.deliveryAtendimentos.groupBy = jest.fn().mockResolvedValue([]);
      prisma.deliveryAtendimentos.findMany = jest.fn().mockResolvedValueOnce([]);
      const resumo = await service.resumo(1, undefined, undefined, porteiro);
      expect(resumo.tempo_medio_atendimento_min).toBeNull();
      expect(resumo.periodo.total).toBe(0);
    });

    it('nega resumo ao morador', async () => {
      const { service } = montar();
      await expect(service.resumo(1, undefined, undefined, morador)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/api/jest.config.cts apps/api/src/app/delivery/delivery.service.spec.ts -t "resumo"`
Expected: FAIL (`service.resumo is not a function`).

- [ ] **Step 3: Implementar** — depois de `listarAtendimentos`:

```ts
  async resumo(idCondominio: number, de: string | undefined, ate: string | undefined, user: JwtPayload) {
    this.assertOperador(user, 'resumo de delivery');
    await this.tenant.assertCondominio(Number(idCondominio), user);
    const periodo = this.periodo(de, ate);
    const base = { id_condominio: Number(idCondominio) };
    const noPeriodo = { gte: periodo.gte, lte: periodo.lte };
    const db = (this.prisma as any).deliveryAtendimentos;
    const [ativosBrutos, terminaisBrutos, concluidos] = await Promise.all([
      db.groupBy({ by: ['status'], where: { ...base, status: { notIn: [...TERMINAIS] } }, _count: { _all: true } }),
      db.groupBy({ by: ['status'], where: { ...base, status: { in: [...TERMINAIS] }, created_at: noPeriodo }, _count: { _all: true } }),
      db.findMany({
        where: { ...base, status: 'CONCLUIDA', created_at: noPeriodo, chegou_em: { not: null }, concluido_em: { not: null } },
        select: { chegou_em: true, concluido_em: true },
      }),
    ]);
    const contar = (linhas: { status: string; _count: { _all: number } }[], status: readonly string[]) =>
      Object.fromEntries(status.map((s) => [s, linhas.find((l) => l.status === s)?._count._all ?? 0]));
    const ativos = contar(ativosBrutos, ['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA']);
    const terminais = contar(terminaisBrutos, TERMINAIS);
    const duracoes = (concluidos as { chegou_em: Date; concluido_em: Date }[])
      .map((a) => (new Date(a.concluido_em).getTime() - new Date(a.chegou_em).getTime()) / 60_000)
      .filter((min) => min >= 0);
    const media = duracoes.length ? duracoes.reduce((s, m) => s + m, 0) / duracoes.length : null;
    return {
      ativos,
      periodo: {
        de: periodo.de,
        ate: periodo.ate,
        CONCLUIDA: terminais.CONCLUIDA,
        CANCELADA: terminais.CANCELADA,
        RECUSADA: terminais.RECUSADA,
        total: terminais.CONCLUIDA + terminais.CANCELADA + terminais.RECUSADA,
      },
      tempo_medio_atendimento_min: media === null ? null : Math.round(media * 10) / 10,
    };
  }
```

- [ ] **Step 4: Controller** — logo após `listarUnidades`:

```ts
  @Get('resumo')
  resumo(
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.resumo(idCondominio, de, ate, user);
  }
```

- [ ] **Step 5: Rodar testes do módulo + typecheck**

Run: `npx jest -c apps/api/jest.config.cts apps/api/src/app/delivery && npx tsc -p apps/api/tsconfig.app.json --noEmit`
Expected: PASS e tsc sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app/delivery
git commit -m "feat(delivery): endpoint de resumo por periodo com tempo medio"
```

---

### Task 3: Front — modelo, API client e utilitários puros

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/delivery/delivery.model.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/delivery/delivery.service.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/shared/delivery-status.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/shared/tempo.ts`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/shared/delivery-status.spec.ts`, `.../shared/tempo.spec.ts`

**Interfaces:**
- Produces (model): campos opcionais `chegou_em`, `autorizado_em`, `concluido_em`, `updated_at` em `DeliveryAtendimento`; `DeliveryResumo`.
- Produces (service): `listAtivos(): Observable<DeliveryAtendimento[]>`, `listHistorico(de: string, ate: string)`, `resumo(de: string, ate: string): Observable<DeliveryResumo>`.
- Produces (`delivery-status.ts`): `TERMINAIS`, `STATUS_CARDS`, `STATUS_FILTRO`, `PROXIMOS_STATUS`, `type TomStatus`, `CLASSES_TOM: Record<TomStatus, { texto: string; fundo: string; borda: string; ponto: string; anel: string }>`, `rotuloStatus(s)`, `tomStatus(s)`, `verboAcao(s)`, `organizarAcoes(proximos): { primaria: DeliveryStatus | null; secundarias: DeliveryStatus[]; recusar: boolean }`.
- Produces (`tempo.ts`): `inicioEspera(a)`, `minutosDesde(iso, agora)`, `textoEspera(min)`, `emAtencao(a, agora)`, `textoDuracao(min | null)`, `dataLocal(d)`, `intervaloPeriodo(p: PeriodoHistorico, agora): { de; ate }`, `type PeriodoHistorico = 'hoje' | '7d' | '30d'`.

- [ ] **Step 1: Testes falhando**

`shared/delivery-status.spec.ts`:

```ts
import { organizarAcoes, rotuloStatus, tomStatus, verboAcao, PROXIMOS_STATUS } from './delivery-status';

describe('delivery-status', () => {
  it('rotula em caixa de frase com acento', () => {
    expect(rotuloStatus('AGUARDANDO_AUTORIZACAO')).toBe('Aguardando autorização');
    expect(rotuloStatus('CONCLUIDA')).toBe('Concluída');
    expect(rotuloStatus('RETIRADA_NA_PORTARIA')).toBe('Retirada na portaria');
  });

  it('associa tons e verbos', () => {
    expect(tomStatus('CHEGOU')).toBe('amber');
    expect(tomStatus('RECUSADA')).toBe('red');
    expect(verboAcao('AUTORIZADA')).toBe('Autorizar subida');
    expect(verboAcao('AGUARDANDO_AUTORIZACAO')).toBe('Pedir autorização ao morador');
  });

  it('ordena ações: autorizar primária, recusar separada', () => {
    expect(organizarAcoes(PROXIMOS_STATUS.CHEGOU)).toEqual({
      primaria: 'AUTORIZADA',
      secundarias: ['AGUARDANDO_AUTORIZACAO', 'RETIRADA_NA_PORTARIA'],
      recusar: true,
    });
    expect(organizarAcoes(PROXIMOS_STATUS.AGENDADA)).toEqual({ primaria: 'CHEGOU', secundarias: [], recusar: false });
    expect(organizarAcoes(PROXIMOS_STATUS.CONCLUIDA)).toEqual({ primaria: null, secundarias: [], recusar: false });
  });

  it('portaria não cancela aviso agendado', () => {
    expect(PROXIMOS_STATUS.AGENDADA).not.toContain('CANCELADA');
  });
});
```

`shared/tempo.spec.ts`:

```ts
import { emAtencao, intervaloPeriodo, minutosDesde, textoDuracao, textoEspera } from './tempo';
import { DeliveryAtendimento } from '../delivery.model';

const agora = new Date('2026-10-04T12:30:00');
const base = { id: 1, modo_entrega: 'UNIDADE', apartamento: { id: 1, apto: '1' }, eventos: [] } as unknown as DeliveryAtendimento;

describe('tempo', () => {
  it('formata espera', () => {
    expect(textoEspera(0)).toBe('agora');
    expect(textoEspera(12)).toBe('há 12 min');
    expect(textoEspera(65)).toBe('há 1 h 05 min');
  });

  it('usa chegou_em antes de created_at', () => {
    const a = { ...base, status: 'CHEGOU', created_at: '2026-10-04T11:00:00', chegou_em: '2026-10-04T12:18:00' } as DeliveryAtendimento;
    expect(minutosDesde(a.chegou_em!, agora)).toBe(12);
    expect(emAtencao(a, agora)).toBe(true);
  });

  it('só alerta em Chegou/Aguardando acima de 10 min', () => {
    const recente = { ...base, status: 'CHEGOU', created_at: '2026-10-04T12:25:00' } as DeliveryAtendimento;
    const agendada = { ...base, status: 'AGENDADA', created_at: '2026-10-04T10:00:00' } as DeliveryAtendimento;
    expect(emAtencao(recente, agora)).toBe(false);
    expect(emAtencao(agendada, agora)).toBe(false);
  });

  it('formata duração média', () => {
    expect(textoDuracao(null)).toBe('—');
    expect(textoDuracao(7.5)).toBe('8 min');
    expect(textoDuracao(90)).toBe('1 h 30 min');
  });

  it('calcula intervalos locais', () => {
    expect(intervaloPeriodo('hoje', agora)).toEqual({ de: '2026-10-04', ate: '2026-10-04' });
    expect(intervaloPeriodo('7d', agora)).toEqual({ de: '2026-09-28', ate: '2026-10-04' });
    expect(intervaloPeriodo('30d', agora)).toEqual({ de: '2026-09-05', ate: '2026-10-04' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/shared`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`delivery.model.ts` — em `DeliveryAtendimento`, após `created_at: string;`:

```ts
  chegou_em?: string | null;
  autorizado_em?: string | null;
  concluido_em?: string | null;
  updated_at?: string | null;
```

e no fim do arquivo:

```ts
export interface DeliveryResumo {
  ativos: Partial<Record<DeliveryStatus, number>>;
  periodo: { de: string; ate: string; CONCLUIDA: number; CANCELADA: number; RECUSADA: number; total: number };
  tempo_medio_atendimento_min: number | null;
}
```

`delivery.service.ts` — adicionar `DeliveryResumo` ao import e ao `export type`, e os métodos:

```ts
  listAtivos(): Observable<DeliveryAtendimento[]> {
    const params = new HttpParams().set('id_condominio', this.idCondominio).set('escopo', 'ativos');
    return this.http.get<DeliveryAtendimento[]>(`${API_BASE}/delivery`, { params });
  }

  listHistorico(de: string, ate: string): Observable<DeliveryAtendimento[]> {
    const params = new HttpParams()
      .set('id_condominio', this.idCondominio).set('escopo', 'historico').set('de', de).set('ate', ate);
    return this.http.get<DeliveryAtendimento[]>(`${API_BASE}/delivery`, { params });
  }

  resumo(de: string, ate: string): Observable<DeliveryResumo> {
    const params = new HttpParams().set('id_condominio', this.idCondominio).set('de', de).set('ate', ate);
    return this.http.get<DeliveryResumo>(`${API_BASE}/delivery/resumo`, { params });
  }
```

`shared/delivery-status.ts`:

```ts
import { DeliveryStatus } from '../delivery.model';

export const TERMINAIS: readonly DeliveryStatus[] = ['CONCLUIDA', 'CANCELADA', 'RECUSADA'];
export const STATUS_CARDS: readonly DeliveryStatus[] = ['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA'];
export const STATUS_FILTRO: readonly DeliveryStatus[] = [...STATUS_CARDS, 'RETIRADA_NA_PORTARIA'];

export const PROXIMOS_STATUS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  AGENDADA: ['CHEGOU'],
  CHEGOU: ['AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AGUARDANDO_AUTORIZACAO: ['AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AUTORIZADA: ['CONCLUIDA'],
  RETIRADA_NA_PORTARIA: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
  RECUSADA: [],
};

export type TomStatus = 'slate' | 'amber' | 'sky' | 'emerald' | 'violet' | 'red';

const INFO: Record<DeliveryStatus, { rotulo: string; tom: TomStatus; verbo: string }> = {
  AGENDADA: { rotulo: 'Agendada', tom: 'slate', verbo: 'Agendar' },
  CHEGOU: { rotulo: 'Chegou', tom: 'amber', verbo: 'Registrar chegada' },
  AGUARDANDO_AUTORIZACAO: { rotulo: 'Aguardando autorização', tom: 'sky', verbo: 'Pedir autorização ao morador' },
  AUTORIZADA: { rotulo: 'Autorizada', tom: 'emerald', verbo: 'Autorizar subida' },
  RETIRADA_NA_PORTARIA: { rotulo: 'Retirada na portaria', tom: 'violet', verbo: 'Deixar na portaria' },
  CONCLUIDA: { rotulo: 'Concluída', tom: 'emerald', verbo: 'Concluir' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'slate', verbo: 'Cancelar' },
  RECUSADA: { rotulo: 'Recusada', tom: 'red', verbo: 'Recusar' },
};

// Strings completas para o Tailwind enxergar as classes no build.
export const CLASSES_TOM: Record<TomStatus, { texto: string; fundo: string; borda: string; ponto: string; anel: string }> = {
  slate: { texto: 'text-slate-600 dark:text-slate-300', fundo: 'bg-slate-500/10', borda: 'border-slate-500/30', ponto: 'bg-slate-400', anel: 'ring-slate-400/60' },
  amber: { texto: 'text-amber-700 dark:text-amber-300', fundo: 'bg-amber-500/10', borda: 'border-amber-500/30', ponto: 'bg-amber-500', anel: 'ring-amber-500/60' },
  sky: { texto: 'text-sky-700 dark:text-sky-300', fundo: 'bg-sky-500/10', borda: 'border-sky-500/30', ponto: 'bg-sky-500', anel: 'ring-sky-500/60' },
  emerald: { texto: 'text-emerald-700 dark:text-emerald-300', fundo: 'bg-emerald-500/10', borda: 'border-emerald-500/30', ponto: 'bg-emerald-500', anel: 'ring-emerald-500/60' },
  violet: { texto: 'text-violet-700 dark:text-violet-300', fundo: 'bg-violet-500/10', borda: 'border-violet-500/30', ponto: 'bg-violet-500', anel: 'ring-violet-500/60' },
  red: { texto: 'text-red-700 dark:text-red-300', fundo: 'bg-red-500/10', borda: 'border-red-500/30', ponto: 'bg-red-500', anel: 'ring-red-500/60' },
};

export const rotuloStatus = (s: DeliveryStatus): string => INFO[s]?.rotulo ?? s;
export const tomStatus = (s: DeliveryStatus): TomStatus => INFO[s]?.tom ?? 'slate';
export const verboAcao = (s: DeliveryStatus): string => INFO[s]?.verbo ?? rotuloStatus(s);
export const classesStatus = (s: DeliveryStatus) => CLASSES_TOM[tomStatus(s)];

export function organizarAcoes(proximos: readonly DeliveryStatus[]) {
  const recusar = proximos.includes('RECUSADA');
  const restantes = proximos.filter((s) => s !== 'RECUSADA');
  const primaria = restantes.includes('AUTORIZADA') ? 'AUTORIZADA' : restantes[0] ?? null;
  return { primaria, secundarias: restantes.filter((s) => s !== primaria), recusar };
}
```

`shared/tempo.ts`:

```ts
import { DeliveryAtendimento } from '../delivery.model';

export type PeriodoHistorico = 'hoje' | '7d' | '30d';
const LIMITE_ATENCAO_MIN = 10;
const pad = (n: number) => String(n).padStart(2, '0');

export const inicioEspera = (a: DeliveryAtendimento): string => a.chegou_em || a.created_at;

export function minutosDesde(iso: string, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000));
}

export function textoEspera(min: number): string {
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

export function emAtencao(a: DeliveryAtendimento, agora: Date): boolean {
  return ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'].includes(a.status)
    && minutosDesde(inicioEspera(a), agora) > LIMITE_ATENCAO_MIN;
}

export function textoDuracao(min: number | null): string {
  if (min === null || min === undefined) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${pad(total % 60)} min`;
}

export const dataLocal = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function intervaloPeriodo(p: PeriodoHistorico, agora: Date): { de: string; ate: string } {
  const dias = p === 'hoje' ? 0 : p === '7d' ? 6 : 29;
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - dias);
  return { de: dataLocal(inicio), ate: dataLocal(agora) };
}
```

Nota: `textoDuracao(90)` deve dar `'1 h 30 min'` — `pad(30)` = `'30'`. ✔

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/delivery/delivery.model.ts apps/portaria-web/src/app/delivery/delivery.service.ts apps/portaria-web/src/app/delivery/shared
git commit -m "feat(delivery-web): rotulos, tons e tempo de espera compartilhados"
```

---

### Task 4: Front — `DeliveryStore`

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/delivery.store.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/delivery.testing.ts` (fixtures `ATENDIMENTOS` e `DeliveryApiStub` para todos os specs)
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/delivery.store.spec.ts`

**Interfaces:**
- Consumes: `DeliveryApi.listAtivos/listEntregadores/atualizarStatus/criarEntregador/atualizarEntregador`, `AuthService.porteiroInfo()`, `PROXIMOS_STATUS`.
- Produces: `@Injectable() class DeliveryStore` com
  - signals: `aba: WritableSignal<'fila'|'entregadores'|'historico'>`, `ativos`, `entregadores`, `busca`, `filtroStatus: WritableSignal<DeliveryStatus | ''>`, `selecionado: WritableSignal<DeliveryAtendimento|null>`, `carregando`, `erro: WritableSignal<string|null>`, `entregadorSelecionadoId: WritableSignal<number|null>`, `motivo`, `entregadorEmEdicao: WritableSignal<DeliveryEntregador|null>`, `agora: WritableSignal<Date>`
  - computed: `fila`, `contadores`
  - campos: `novoEntregador: CriarEntregadorDelivery`, `motivoBloqueio: string`
  - métodos: `trocarAba(aba)`, `alternarFiltro(status)`, `contador(status): number`, `carregarFila(opts?: { silencioso?: boolean })`, `carregarEntregadores(busca?)`, `selecionar(a)`, `proximosStatus(a)`, `podeGerenciarEntregadores(): boolean`, `podeAutorizar(a): boolean`, `atualizarStatus(status)`, `iniciarCadastroNoAtendimento()`, `criarEntregador()`, `editarEntregador(e)`, `cancelarEdicao()`, `removerVeiculoEmEdicao()`, `salvarEntregador()`, `definirErro(error, fallback)`, `unidade(a)`, `nomeEntregador(a)`, `telefoneEntregador(a)`.

- [ ] **Step 1: Fixtures compartilhadas + teste falhando**

`delivery.testing.ts` (fixtures usadas por todos os specs de delivery; não é spec para não duplicar testes ao importar):

```ts
import { of } from 'rxjs';
import { DeliveryAtendimento, DeliveryEntregador } from './delivery.model';

export const ATENDIMENTOS: DeliveryAtendimento[] = [
  {
    id: 1, status: 'CHEGOU', estabelecimento: 'Pizzaria Central', modo_entrega: 'UNIDADE',
    apartamento: { id: 10, bloco: 'A', apto: '101' },
    entregador: { id: 20, nome: 'João Motoboy', telefone: '11999999999', status: 'BLOQUEADO', veiculos: [{ id: 1, placa: 'ABC1D23' }] },
    eventos: [{ id: 1, status_anterior: 'AGENDADA', status_novo: 'CHEGOU', created_at: '2026-09-27T12:00:00.000Z', autor_nome: 'Porteiro' }],
    created_at: '2026-09-27T11:30:00.000Z',
  },
  {
    id: 2, status: 'AGENDADA', estabelecimento: 'Mercado', nome_entregador: 'Maria Avulsa', telefone_entregador: '11888887777',
    modo_entrega: 'PORTARIA', apartamento: { id: 11, bloco: 'B', apto: '202' }, entregador: null, eventos: [],
    created_at: '2026-09-27T11:00:00.000Z',
  } as DeliveryAtendimento,
];

export class DeliveryApiStub {
  listAtivos = jest.fn(() => of(ATENDIMENTOS));
  listHistorico = jest.fn(() => of([] as DeliveryAtendimento[]));
  resumo = jest.fn();
  listEntregadores = jest.fn(() => of([] as DeliveryEntregador[]));
  atualizarStatus = jest.fn(() => of(ATENDIMENTOS[0]));
  criarEntregador = jest.fn();
  atualizarEntregador = jest.fn();
}
```

`delivery.store.spec.ts` (migra a lógica do spec antigo da página):

```ts
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { DeliveryApi } from './delivery.service';
import { DeliveryStore } from './delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from './delivery.testing';

describe('DeliveryStore', () => {
  let store: DeliveryStore;
  let api: DeliveryApiStub;
  let authInfo: any;

  beforeEach(() => {
    authInfo = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    TestBed.configureTestingModule({
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => authInfo } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    store = TestBed.inject(DeliveryStore);
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.carregarFila();
  });

  it('carrega só os ativos e conta por status', () => {
    expect(api.listAtivos).toHaveBeenCalled();
    expect(store.contador('CHEGOU')).toBe(1);
    expect(store.contador('AUTORIZADA')).toBe(0);
  });

  it('filtra por unidade, placa, nome e telefone avulsos', () => {
    store.busca.set('A 101');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.busca.set('abc-1d23');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.busca.set('Maria Avulsa');
    expect(store.fila()).toEqual([ATENDIMENTOS[1]]);
    store.busca.set('11 88888-7777');
    expect(store.fila()).toEqual([ATENDIMENTOS[1]]);
  });

  it('alterna filtro de status pelo card', () => {
    store.alternarFiltro('CHEGOU');
    expect(store.fila()).toEqual([ATENDIMENTOS[0]]);
    store.alternarFiltro('CHEGOU');
    expect(store.filtroStatus()).toBe('');
  });

  it('não autoriza com entregador bloqueado ou ausente', () => {
    store.selecionar(ATENDIMENTOS[0]);
    expect(store.podeAutorizar(ATENDIMENTOS[0])).toBe(false);
    const semEntregador = { ...ATENDIMENTOS[1], status: 'CHEGOU' as const };
    store.selecionar(semEntregador);
    expect(store.podeAutorizar(semEntregador)).toBe(false);
    store.atualizarStatus('AUTORIZADA');
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    expect(store.erro()).toBe('Identifique o entregador antes de autorizar.');
  });

  it('exige motivo para recusar', () => {
    store.selecionar(ATENDIMENTOS[0]);
    store.atualizarStatus('RECUSADA');
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    store.motivo.set('Pedido errado');
    store.atualizarStatus('RECUSADA');
    expect(api.atualizarStatus).toHaveBeenCalledWith(1, 'RECUSADA', { id_entregador: 20, motivo: 'Pedido errado' });
  });

  it('recarga silenciosa mantém o painel e o motivo digitado; erro não apaga a lista', () => {
    store.selecionar(ATENDIMENTOS[0]);
    store.motivo.set('rascunho');
    api.listAtivos.mockReturnValueOnce(throwError(() => ({ error: { message: 'offline' } })));
    store.carregarFila({ silencioso: true });
    expect(store.ativos()).toEqual(ATENDIMENTOS);
    expect(store.erro()).toBe('offline');
    store.carregarFila({ silencioso: true });
    expect(store.selecionado()?.id).toBe(1);
    expect(store.motivo()).toBe('rascunho');
  });

  it('mostra o veículo devolvido no cadastro e volta para a fila', () => {
    api.criarEntregador.mockReturnValue(of({ id: 31, nome: 'Maria Moto', status: 'ATIVO', veiculos: [{ id: 81, placa: 'XYZ9A87' }] }));
    store.aba.set('entregadores');
    store.novoEntregador.nome = 'Maria Moto';
    store.criarEntregador();
    expect(store.entregadores().find((e) => e.id === 31)?.veiculos).toEqual([expect.objectContaining({ placa: 'XYZ9A87' })]);
    expect(store.entregadorSelecionadoId()).toBe(31);
    expect(store.aba()).toBe('fila');
  });

  it('preserva veículos quando o PATCH não os devolve', () => {
    const entregador = ATENDIMENTOS[0].entregador!;
    store.entregadores.set([entregador]);
    store.editarEntregador(entregador);
    store.motivoBloqueio = 'Documento inválido';
    api.atualizarEntregador.mockReturnValue(of({ id: 20, nome: entregador.nome, status: 'BLOQUEADO' }));
    store.salvarEntregador();
    expect(store.entregadores()[0].veiculos).toEqual([{ id: 1, placa: 'ABC1D23' }]);
    expect(store.entregadorEmEdicao()).toBeNull();
  });

  it('envia correções do veículo ao salvar', () => {
    const entregador = ATENDIMENTOS[0].entregador!;
    store.entregadores.set([entregador]);
    store.editarEntregador(entregador);
    store.motivoBloqueio = 'Ocorrência confirmada';
    store.entregadorEmEdicao()!.veiculos[0] = { ...store.entregadorEmEdicao()!.veiculos[0], placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' };
    api.atualizarEntregador.mockReturnValue(of({ ...entregador, veiculos: [{ id: 1, placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' }] }));
    store.salvarEntregador();
    expect(api.atualizarEntregador).toHaveBeenCalledWith(20, expect.objectContaining({ veiculo: { placa: 'XYZ9A87', tipo: 'Moto', modelo: 'CG', cor: 'Preta' } }));
  });

  it('porteiro não gerencia entregadores', () => {
    authInfo = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    expect(store.podeGerenciarEntregadores()).toBe(false);
    store.editarEntregador(ATENDIMENTOS[0].entregador!);
    expect(store.entregadorEmEdicao()).toBeNull();
  });

  it('trocar de aba limpa o erro', () => {
    store.erro.set('falhou');
    store.trocarAba('entregadores');
    expect(store.erro()).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/delivery.store.spec.ts`
Expected: FAIL (`Cannot find module './delivery.store'`).

- [ ] **Step 3: Implementar `delivery.store.ts`**

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import {
  CriarEntregadorDelivery,
  DeliveryAtendimento,
  DeliveryEntregador,
  DeliveryStatus,
} from './delivery.model';
import { DeliveryApi } from './delivery.service';
import { PROXIMOS_STATUS } from './shared/delivery-status';

export type AbaDelivery = 'fila' | 'entregadores' | 'historico';

/** Estado da página de delivery; provido em `DeliveryPageComponent.providers`. */
@Injectable()
export class DeliveryStore {
  private readonly api = inject(DeliveryApi);
  private readonly auth = inject(AuthService);

  readonly aba = signal<AbaDelivery>('fila');
  readonly ativos = signal<DeliveryAtendimento[]>([]);
  readonly entregadores = signal<DeliveryEntregador[]>([]);
  readonly busca = signal('');
  readonly filtroStatus = signal<DeliveryStatus | ''>('');
  readonly selecionado = signal<DeliveryAtendimento | null>(null);
  readonly carregando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly entregadorSelecionadoId = signal<number | null>(null);
  readonly motivo = signal('');
  readonly entregadorEmEdicao = signal<DeliveryEntregador | null>(null);
  readonly agora = signal(new Date());

  novoEntregador: CriarEntregadorDelivery = this.novoEntregadorVazio();
  motivoBloqueio = '';

  readonly fila = computed(() => {
    const busca = this.normalizar(this.busca());
    const status = this.filtroStatus();
    return this.ativos().filter((a) => (!status || a.status === status) && this.correspondeBusca(a, busca));
  });

  readonly contadores = computed(() => {
    const contagem: Partial<Record<DeliveryStatus, number>> = {};
    for (const a of this.ativos()) contagem[a.status] = (contagem[a.status] ?? 0) + 1;
    return contagem;
  });

  contador(status: DeliveryStatus): number {
    return this.contadores()[status] ?? 0;
  }

  trocarAba(aba: AbaDelivery): void {
    this.erro.set(null);
    this.aba.set(aba);
  }

  alternarFiltro(status: DeliveryStatus): void {
    this.filtroStatus.update((atual) => (atual === status ? '' : status));
  }

  carregarFila(opts: { silencioso?: boolean } = {}): void {
    if (!opts.silencioso) this.carregando.set(true);
    this.api.listAtivos().subscribe({
      next: (lista) => {
        this.ativos.set(lista);
        this.agora.set(new Date());
        // Mantém o painel no mesmo atendimento com dados novos; some se saiu da fila.
        const aberto = this.selecionado();
        if (aberto) this.selecionado.set(lista.find((a) => a.id === aberto.id) ?? null);
        this.carregando.set(false);
      },
      error: (error) => this.definirErro(error, 'Não foi possível carregar a fila de delivery.'),
    });
  }

  carregarEntregadores(busca?: string): void {
    this.api.listEntregadores(busca).subscribe({
      next: (lista) => this.entregadores.set(lista),
      error: (error) => this.definirErro(error, 'Não foi possível carregar os entregadores.'),
    });
  }

  selecionar(a: DeliveryAtendimento): void {
    this.selecionado.set(a);
    this.entregadorSelecionadoId.set(a.entregador?.id ?? null);
    this.motivo.set('');
  }

  proximosStatus(a: DeliveryAtendimento): readonly DeliveryStatus[] {
    return PROXIMOS_STATUS[a.status] ?? [];
  }

  unidade(a: DeliveryAtendimento): string {
    return [a.apartamento.bloco, a.apartamento.apto].filter(Boolean).join(' ');
  }

  nomeEntregador(a: DeliveryAtendimento): string {
    return a.entregador?.nome?.trim() || a.nome_entregador?.trim() || 'Entregador ainda não identificado';
  }

  telefoneEntregador(a: DeliveryAtendimento): string | null {
    return a.entregador?.telefone?.trim() || a.telefone_entregador?.trim() || null;
  }

  podeGerenciarEntregadores(): boolean {
    const turno = this.normalizarPapel(this.auth.porteiroInfo()?.turno);
    return ['SINDICO', 'ADMIN', 'ADMINISTRADOR', 'SUPERADMIN'].includes(turno);
  }

  podeAutorizar(a: DeliveryAtendimento): boolean {
    const id = this.entregadorSelecionadoId() ?? a.entregador?.id;
    const entregador = this.entregadores().find((e) => e.id === id) ?? a.entregador;
    return !!entregador && entregador.status === 'ATIVO';
  }

  atualizarStatus(status: DeliveryStatus): void {
    const a = this.selecionado();
    if (!a || !this.proximosStatus(a).includes(status)) return;
    if (status === 'AUTORIZADA' && !this.podeAutorizar(a)) {
      const id = this.entregadorSelecionadoId() ?? a.entregador?.id;
      this.erro.set(id ? 'Entregador bloqueado não pode ser autorizado.' : 'Identifique o entregador antes de autorizar.');
      return;
    }
    const motivo = this.motivo().trim();
    if (status === 'RECUSADA' && !motivo) {
      this.erro.set('Informe o motivo da recusa.');
      return;
    }
    this.carregando.set(true);
    this.api.atualizarStatus(a.id, status, {
      id_entregador: this.entregadorSelecionadoId() ?? undefined,
      motivo: motivo || undefined,
    }).subscribe({
      next: () => {
        this.motivo.set('');
        this.erro.set(null);
        this.carregarFila();
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o atendimento.'),
    });
  }

  iniciarCadastroNoAtendimento(): void {
    this.novoEntregador = this.novoEntregadorVazio();
    this.entregadorEmEdicao.set(null);
    this.trocarAba('entregadores');
  }

  criarEntregador(): void {
    if (!this.novoEntregador.nome.trim()) {
      this.erro.set('Nome do entregador é obrigatório.');
      return;
    }
    this.api.criarEntregador(this.novoEntregador).subscribe({
      next: (resposta) => {
        const entregador: DeliveryEntregador = { ...resposta, veiculos: resposta.veiculos ?? [] };
        this.entregadores.update((lista) => [...lista, entregador].sort((x, y) => x.nome.localeCompare(y.nome)));
        this.entregadorSelecionadoId.set(entregador.id);
        this.novoEntregador = this.novoEntregadorVazio();
        this.trocarAba('fila');
      },
      error: (error) => this.definirErro(error, 'Não foi possível cadastrar o entregador.'),
    });
  }

  editarEntregador(e: DeliveryEntregador): void {
    if (!this.podeGerenciarEntregadores()) return;
    const veiculos = e.veiculos.length ? e.veiculos.map((v) => ({ ...v })) : [{ tipo: 'Moto', placa: '', modelo: '', cor: '' }];
    this.entregadorEmEdicao.set({ ...e, veiculos });
    this.motivoBloqueio = e.motivo_bloqueio ?? '';
  }

  cancelarEdicao(): void {
    this.entregadorEmEdicao.set(null);
    this.motivoBloqueio = '';
  }

  removerVeiculoEmEdicao(): void {
    const e = this.entregadorEmEdicao();
    if (e) e.veiculos = [{ tipo: '', placa: '', modelo: '', cor: '' }];
  }

  salvarEntregador(): void {
    const e = this.entregadorEmEdicao();
    if (!e) return;
    if (!this.podeGerenciarEntregadores()) {
      this.erro.set('Somente síndico ou administrador pode editar entregadores.');
      return;
    }
    if (e.status === 'BLOQUEADO' && !this.motivoBloqueio.trim()) {
      this.erro.set('Informe o motivo do bloqueio.');
      return;
    }
    const principal = e.veiculos[0];
    const temVeiculo = principal && [principal.placa, principal.tipo, principal.modelo, principal.cor].some((v) => !!v?.trim());
    this.api.atualizarEntregador(e.id, {
      nome: e.nome,
      telefone: e.telefone ?? undefined,
      documento: e.documento ?? undefined,
      plataforma: e.plataforma ?? undefined,
      status: e.status,
      motivo_bloqueio: e.status === 'BLOQUEADO' ? this.motivoBloqueio.trim() : undefined,
      veiculo: temVeiculo
        ? { placa: principal.placa ?? '', tipo: principal.tipo ?? '', modelo: principal.modelo ?? '', cor: principal.cor ?? '' }
        : null,
    }).subscribe({
      next: (atualizado) => {
        this.entregadores.update((lista) => lista.map((item) =>
          item.id === atualizado.id ? { ...atualizado, veiculos: atualizado.veiculos ?? item.veiculos ?? [] } : item,
        ));
        this.cancelarEdicao();
      },
      error: (error) => this.definirErro(error, 'Não foi possível atualizar o entregador.'),
    });
  }

  definirErro(error: unknown, fallback: string): void {
    const mensagem = (error as { error?: { message?: string } })?.error?.message
      ?? (error as { message?: string })?.message
      ?? fallback;
    this.erro.set(Array.isArray(mensagem) ? mensagem.join(', ') : mensagem);
    this.carregando.set(false);
  }

  private novoEntregadorVazio(): CriarEntregadorDelivery {
    return { nome: '', telefone: '', plataforma: '', veiculo: { placa: '', tipo: 'Moto', modelo: '', cor: '' } };
  }

  private normalizar(valor: string): string {
    return valor.toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '');
  }

  private normalizarPapel(valor: string | null | undefined): string {
    return (valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  }

  correspondeBusca(a: DeliveryAtendimento, buscaNormalizada: string): boolean {
    if (!buscaNormalizada) return true;
    const e = a.entregador;
    const valores = [
      `${a.apartamento.bloco ?? ''}${a.apartamento.apto}`,
      a.estabelecimento, a.nome_entregador, a.telefone_entregador, e?.nome, e?.telefone,
      ...((e?.veiculos ?? []).map((v) => v.placa)),
    ];
    return valores.some((v) => this.normalizar(v ?? '').includes(buscaNormalizada));
  }

  buscaNormalizada(texto: string): string {
    return this.normalizar(texto);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/delivery.store.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/delivery/delivery.store.ts apps/portaria-web/src/app/delivery/delivery.store.spec.ts apps/portaria-web/src/app/delivery/delivery.testing.ts
git commit -m "refactor(delivery-web): estado da pagina em DeliveryStore"
```

---

### Task 5: Front — selo de status e linha do tempo

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/shared/delivery-status-badge.component.ts`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/shared/delivery-timeline.component.ts`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/shared/delivery-shared.components.spec.ts`

**Interfaces:**
- Produces: `<app-delivery-status-badge [status]="DeliveryStatus" />`; `<app-delivery-timeline [eventos]="DeliveryEvento[]" />`.

- [ ] **Step 1: Teste falhando**

```ts
import { TestBed } from '@angular/core/testing';
import { DeliveryStatusBadgeComponent } from './delivery-status-badge.component';
import { DeliveryTimelineComponent } from './delivery-timeline.component';

describe('componentes compartilhados de delivery', () => {
  it('selo mostra rótulo amigável com a cor do status', () => {
    const fixture = TestBed.createComponent(DeliveryStatusBadgeComponent);
    fixture.componentRef.setInput('status', 'AGUARDANDO_AUTORIZACAO');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent?.trim()).toBe('Aguardando autorização');
    expect(el.querySelector('span')?.className).toContain('text-sky-700');
  });

  it('linha do tempo lista eventos com autor e mensagem; vazio orienta', () => {
    const fixture = TestBed.createComponent(DeliveryTimelineComponent);
    fixture.componentRef.setInput('eventos', [
      { id: 1, status_novo: 'CHEGOU', autor_nome: 'Porteiro', mensagem: 'No portão', created_at: '2026-10-04T12:00:00Z' },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Chegou');
    expect(fixture.nativeElement.textContent).toContain('Porteiro');
    expect(fixture.nativeElement.textContent).toContain('No portão');

    fixture.componentRef.setInput('eventos', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sem eventos registrados');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/shared/delivery-shared.components.spec.ts`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`delivery-status-badge.component.ts`:

```ts
import { Component, computed, input } from '@angular/core';
import { DeliveryStatus } from '../delivery.model';
import { classesStatus, rotuloStatus } from './delivery-status';

@Component({
  selector: 'app-delivery-status-badge',
  standalone: true,
  template: `<span [class]="'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ' + cls().fundo + ' ' + cls().borda + ' ' + cls().texto"><span [class]="'h-1.5 w-1.5 rounded-full ' + cls().ponto"></span>{{ rotulo() }}</span>`,
})
export class DeliveryStatusBadgeComponent {
  readonly status = input.required<DeliveryStatus>();
  readonly rotulo = computed(() => rotuloStatus(this.status()));
  readonly cls = computed(() => classesStatus(this.status()));
}
```

`delivery-timeline.component.ts`:

```ts
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeliveryEvento } from '../delivery.model';
import { classesStatus, rotuloStatus } from './delivery-status';

@Component({
  selector: 'app-delivery-timeline',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (eventos().length) {
      <ol class="relative ml-1.5 space-y-4 border-l border-white/10 pl-5">
        @for (evento of eventos(); track evento.id ?? $index) {
          <li class="relative">
            <span [class]="'absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-graphite-200 ' + cls(evento).ponto"></span>
            <p class="text-sm font-medium text-white">{{ rotulo(evento) }}</p>
            <p class="text-xs text-slate-400">{{ evento.autor_nome || 'Sistema' }} · {{ evento.created_at | date: 'dd/MM HH:mm' }}</p>
            @if (evento.mensagem) {
              <p class="mt-1 text-sm text-slate-300">{{ evento.mensagem }}</p>
            }
          </li>
        }
      </ol>
    } @else {
      <p class="text-sm text-slate-400">Sem eventos registrados.</p>
    }
  `,
})
export class DeliveryTimelineComponent {
  readonly eventos = input.required<DeliveryEvento[]>();
  rotulo = (e: DeliveryEvento) => rotuloStatus(e.status_novo);
  cls = (e: DeliveryEvento) => classesStatus(e.status_novo);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portaria-web/src/app/delivery/shared
git commit -m "feat(delivery-web): selo de status e linha do tempo"
```

---

### Task 6: Front — aba Fila (lista + painel de detalhe)

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/fila/delivery-fila.component.ts` + `.html`
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/fila/delivery-detalhe.component.ts` + `.html`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/fila/delivery-fila.component.spec.ts`

**Interfaces:**
- Consumes: `DeliveryStore` (Task 4), `STATUS_CARDS`, `STATUS_FILTRO`, `classesStatus`, `rotuloStatus`, `verboAcao`, `organizarAcoes` (Task 3), `inicioEspera`, `minutosDesde`, `textoEspera`, `emAtencao` (Task 3), badge/timeline (Task 5).
- Produces: `<app-delivery-fila />` (sem inputs), `<app-delivery-detalhe />` (sem inputs; lê `store.selecionado()`).

- [ ] **Step 1: Teste falhando** — `fila/delivery-fila.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from '../delivery.testing';
import { DeliveryFilaComponent } from './delivery-fila.component';

describe('DeliveryFilaComponent', () => {
  let store: DeliveryStore;

  function montar() {
    TestBed.configureTestingModule({
      imports: [DeliveryFilaComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    store = TestBed.inject(DeliveryStore);
    store.carregarFila();
    const fixture = TestBed.createComponent(DeliveryFilaComponent);
    fixture.detectChanges();
    return fixture;
  }

  const botaoCom = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(texto)) as HTMLButtonElement;

  it('lista a fila com rótulo amigável, unidade e modo; painel orienta sem seleção', () => {
    const el: HTMLElement = montar().nativeElement;
    expect(el.textContent).toContain('Pizzaria Central');
    expect(el.textContent).toContain('Maria Avulsa');
    expect(el.textContent).toContain('11888887777');
    expect(el.textContent).toContain('Bloco B 202');
    expect(el.textContent).toContain('Na portaria');
    expect(el.textContent).toContain('Selecione um atendimento');
  });

  it('card filtra e marca como ativo', () => {
    const fixture = montar();
    const card = botaoCom(fixture.nativeElement, 'Chegou');
    card.click();
    fixture.detectChanges();
    expect(store.filtroStatus()).toBe('CHEGOU');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).not.toContain('Mercado');
  });

  it('painel mostra linha do tempo e desabilita autorizar com entregador bloqueado', () => {
    const fixture = montar();
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Porteiro');
    expect(botaoCom(el, 'Autorizar subida').disabled).toBe(true);
    expect(el.textContent).toContain('Identifique um entregador ativo');
  });

  it('recusar abre motivo inline antes de enviar', () => {
    const fixture = montar();
    const api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    store.selecionar(ATENDIMENTOS[0]);
    fixture.detectChanges();
    botaoCom(fixture.nativeElement, 'Recusar').click();
    fixture.detectChanges();
    expect(api.atualizarStatus).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('input[name="motivoRecusa"]')).not.toBeNull();
    store.motivo.set('Pedido errado');
    botaoCom(fixture.nativeElement, 'Confirmar recusa').click();
    expect(api.atualizarStatus).toHaveBeenCalledWith(1, 'RECUSADA', expect.objectContaining({ motivo: 'Pedido errado' }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/fila`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: `fila/delivery-fila.component.ts`**

```ts
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryAtendimento, DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { STATUS_CARDS, STATUS_FILTRO, classesStatus, rotuloStatus } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { emAtencao, inicioEspera, minutosDesde, textoEspera } from '../shared/tempo';
import { DeliveryDetalheComponent } from './delivery-detalhe.component';

@Component({
  selector: 'app-delivery-fila',
  standalone: true,
  imports: [FormsModule, DeliveryStatusBadgeComponent, DeliveryDetalheComponent],
  templateUrl: './delivery-fila.component.html',
})
export class DeliveryFilaComponent {
  readonly store = inject(DeliveryStore);
  readonly cards = STATUS_CARDS;
  readonly opcoesFiltro = STATUS_FILTRO;
  readonly rotulo = rotuloStatus;
  readonly cls = classesStatus;

  espera(a: DeliveryAtendimento): string {
    return textoEspera(minutosDesde(inicioEspera(a), this.store.agora()));
  }

  atencao(a: DeliveryAtendimento): boolean {
    return emAtencao(a, this.store.agora());
  }

  modo(a: DeliveryAtendimento): string {
    return a.modo_entrega === 'PORTARIA' ? 'Na portaria' : 'Na unidade';
  }

  filtroAtivo(status: DeliveryStatus): boolean {
    return this.store.filtroStatus() === status;
  }
}
```

- [ ] **Step 4: `fila/delivery-fila.component.html`**

```html
<div class="space-y-5">
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    @for (status of cards; track status) {
      <button type="button" (click)="store.alternarFiltro(status)" [attr.aria-pressed]="filtroAtivo(status)"
        [class]="'group rounded-xl border bg-graphite-200 px-4 py-3 text-left transition hover:border-white/20 ' + (filtroAtivo(status) ? cls(status).borda + ' ring-2 ' + cls(status).anel : 'border-white/10')">
        <span class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <span [class]="'h-1.5 w-1.5 rounded-full ' + cls(status).ponto"></span>{{ rotulo(status) }}
        </span>
        <span [class]="'mt-1 block text-2xl font-bold tabular-nums leading-none ' + (store.contador(status) ? cls(status).texto : 'text-white')">{{ store.contador(status) }}</span>
      </button>
    }
  </div>

  <div class="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-graphite-200 p-3">
    <label class="min-w-[220px] flex-1">
      <span class="mb-1.5 block text-xs font-medium text-slate-400">Buscar</span>
      <span class="relative block">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"/></svg>
        <input class="w-full rounded-lg border border-white/10 bg-graphite py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-accent/60 focus:outline-none"
          [ngModel]="store.busca()" (ngModelChange)="store.busca.set($event)" placeholder="Unidade, nome, telefone ou placa — ex.: A 101 ou ABC1D23">
      </span>
    </label>
    <label class="w-full sm:w-56">
      <span class="mb-1.5 block text-xs font-medium text-slate-400">Status</span>
      <select class="w-full rounded-lg border border-white/10 bg-graphite px-3 py-2.5 text-sm text-white focus:border-accent/60 focus:outline-none"
        [ngModel]="store.filtroStatus()" (ngModelChange)="store.filtroStatus.set($event)">
        <option value="">Todos</option>
        @for (status of opcoesFiltro; track status) {
          <option [value]="status">{{ rotulo(status) }}</option>
        }
      </select>
    </label>
  </div>

  <div class="grid gap-4 lg:grid-cols-5">
    <section class="overflow-hidden rounded-2xl border border-white/10 bg-graphite-200 lg:col-span-3">
      <header class="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 class="text-sm font-semibold text-white">Fila ativa <span class="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">{{ store.fila().length }}</span></h2>
        @if (store.carregando()) {
          <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-label="Carregando"></span>
        }
      </header>

      @for (a of store.fila(); track a.id) {
        <button type="button" (click)="store.selecionar(a)"
          [class]="'flex w-full items-stretch gap-3 border-b border-white/5 px-4 py-3 text-left transition last:border-b-0 hover:bg-white/[0.03] ' + (store.selecionado()?.id === a.id ? 'bg-white/[0.05]' : '')">
          <span [class]="'w-1 shrink-0 rounded-full ' + cls(a.status).ponto"></span>
          <span class="min-w-0 flex-1">
            <span class="flex items-start justify-between gap-2">
              <strong class="truncate text-sm font-semibold text-white">{{ a.estabelecimento || 'Entrega sem estabelecimento' }}</strong>
              <app-delivery-status-badge [status]="a.status" />
            </span>
            <span class="mt-1 block truncate text-sm text-slate-300">{{ a.apartamento.bloco ? 'Bloco ' : '' }}{{ store.unidade(a) }} · {{ store.nomeEntregador(a) }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span [class]="atencao(a) ? 'font-medium text-amber-700 dark:text-amber-300' : ''">{{ espera(a) }}</span>
              <span>{{ modo(a) }}</span>
              @if (store.telefoneEntregador(a); as telefone) { <span>Tel. {{ telefone }}</span> }
            </span>
          </span>
        </button>
      } @empty {
        <div class="p-10 text-center">
          <p class="text-sm font-medium text-slate-300">Nenhuma entrega na fila</p>
          <p class="mt-1 text-xs text-slate-500">{{ store.busca() || store.filtroStatus() ? 'Ajuste a busca ou o filtro.' : 'Novos avisos dos moradores aparecem aqui automaticamente.' }}</p>
        </div>
      }
    </section>

    <div class="lg:col-span-2">
      <app-delivery-detalhe />
    </div>
  </div>
</div>
```

Nota: o teste espera `'Bloco B 202'` — a lista monta `'Bloco ' + unidade` quando há bloco (unidade = `"B 202"`).

- [ ] **Step 5: `fila/delivery-detalhe.component.ts`**

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { organizarAcoes, verboAcao } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';

@Component({
  selector: 'app-delivery-detalhe',
  standalone: true,
  imports: [FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-detalhe.component.html',
})
export class DeliveryDetalheComponent {
  readonly store = inject(DeliveryStore);
  readonly confirmandoRecusa = signal(false);
  readonly verbo = verboAcao;
  readonly acoes = computed(() => {
    const a = this.store.selecionado();
    return a ? organizarAcoes(this.store.proximosStatus(a)) : null;
  });

  desabilitada(status: DeliveryStatus): boolean {
    const a = this.store.selecionado();
    return this.store.carregando() || (status === 'AUTORIZADA' && !!a && !this.store.podeAutorizar(a));
  }

  executar(status: DeliveryStatus): void {
    this.store.atualizarStatus(status);
  }

  confirmarRecusa(): void {
    this.store.atualizarStatus('RECUSADA');
    if (!this.store.erro()) this.confirmandoRecusa.set(false);
  }

  fechar(): void {
    this.confirmandoRecusa.set(false);
    this.store.selecionado.set(null);
  }
}
```

- [ ] **Step 6: `fila/delivery-detalhe.component.html`**

```html
<aside class="rounded-2xl border border-white/10 bg-graphite-200 lg:sticky lg:top-6">
  @if (store.selecionado(); as a) {
    <header class="flex items-start justify-between gap-3 border-b border-white/10 p-4">
      <div class="min-w-0">
        <p class="text-xs text-slate-500">Atendimento #{{ a.id }}</p>
        <h2 class="truncate text-base font-semibold text-white">{{ a.estabelecimento || 'Entrega sem estabelecimento' }}</h2>
        <p class="mt-0.5 text-sm text-slate-400">{{ a.apartamento.bloco ? 'Bloco ' : '' }}{{ store.unidade(a) }} · {{ a.modo_entrega === 'PORTARIA' ? 'Deixar na portaria' : 'Entregar na unidade' }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <app-delivery-status-badge [status]="a.status" />
        <button type="button" (click)="fechar()" class="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Fechar painel">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </header>

    <div class="space-y-4 p-4">
      @if (a.observacao_morador) {
        <p class="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300"><span class="block text-xs text-slate-500">Observação do morador</span>{{ a.observacao_morador }}</p>
      }

      <div class="rounded-lg border border-white/10 bg-graphite p-3">
        <p class="text-xs text-slate-500">Entregador</p>
        <p class="text-sm font-medium text-white">{{ store.nomeEntregador(a) }}</p>
        @if (store.telefoneEntregador(a); as telefone) { <p class="text-xs text-slate-400">{{ telefone }}</p> }
        @if (a.entregador?.status === 'BLOQUEADO') {
          <p class="mt-1 text-xs font-medium text-red-700 dark:text-red-300">Bloqueado{{ a.entregador?.motivo_bloqueio ? ': ' + a.entregador?.motivo_bloqueio : '' }}</p>
        }
      </div>

      @if (acoes()?.primaria || acoes()?.secundarias?.length || acoes()?.recusar) {
        <label class="block">
          <span class="mb-1.5 block text-xs font-medium text-slate-400">Identificar entregador</span>
          <select class="w-full rounded-lg border border-white/10 bg-graphite px-3 py-2.5 text-sm text-white focus:border-accent/60 focus:outline-none"
            [ngModel]="store.entregadorSelecionadoId()" (ngModelChange)="store.entregadorSelecionadoId.set($event ? +$event : null)">
            <option [ngValue]="null">Não identificado</option>
            @for (e of store.entregadores(); track e.id) {
              <option [ngValue]="e.id">{{ e.nome }}{{ e.status === 'BLOQUEADO' ? ' (bloqueado)' : '' }}</option>
            }
          </select>
        </label>
        <button type="button" class="text-xs font-medium text-accent hover:underline dark:text-accent-400" (click)="store.iniciarCadastroNoAtendimento()">+ Cadastrar novo entregador</button>

        @if (!confirmandoRecusa()) {
          <div class="space-y-2">
            @if (acoes()?.primaria; as primaria) {
              <button type="button" (click)="executar(primaria)" [disabled]="desabilitada(primaria)"
                class="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40">{{ verbo(primaria) }}</button>
              @if (primaria === 'AUTORIZADA' && !store.podeAutorizar(a)) {
                <p class="text-xs text-slate-500">Identifique um entregador ativo para autorizar a subida.</p>
              }
            }
            @if (acoes()?.secundarias?.length) {
              <div class="grid gap-2 sm:grid-cols-2">
                @for (s of acoes()!.secundarias; track s) {
                  <button type="button" (click)="executar(s)" [disabled]="desabilitada(s)"
                    class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-40">{{ verbo(s) }}</button>
                }
              </div>
            }
            @if (acoes()?.recusar) {
              <button type="button" (click)="confirmandoRecusa.set(true)"
                class="w-full rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-500/10 dark:text-red-300">Recusar entrega</button>
            }
          </div>
        } @else {
          <div class="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <label class="block">
              <span class="mb-1.5 block text-xs font-medium text-red-700 dark:text-red-300">Motivo da recusa *</span>
              <input name="motivoRecusa" class="w-full rounded-lg border border-white/10 bg-graphite px-3 py-2 text-sm text-white focus:border-red-500/60 focus:outline-none"
                [ngModel]="store.motivo()" (ngModelChange)="store.motivo.set($event)" placeholder="Ex.: pedido não reconhecido pelo morador">
            </label>
            <div class="flex gap-2">
              <button type="button" (click)="confirmandoRecusa.set(false)" class="flex-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Voltar</button>
              <button type="button" (click)="confirmarRecusa()" [disabled]="store.carregando()" class="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">Confirmar recusa</button>
            </div>
          </div>
        }
      }

      <div class="border-t border-white/10 pt-4">
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Linha do tempo</h3>
        <app-delivery-timeline [eventos]="a.eventos" />
      </div>
    </div>
  } @else {
    <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
        <svg class="h-6 w-6 text-accent dark:text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>
      </div>
      <p class="text-sm font-medium text-slate-300">Selecione um atendimento</p>
      <p class="mt-1 text-xs text-slate-500">Os detalhes, as ações e a linha do tempo aparecem aqui.</p>
    </div>
  }
</aside>
```

Nota: o botão "Recusar entrega" contém "Recusar" (usado no teste). No teste de autorizar bloqueado, o texto de dica contém "Identifique um entregador ativo".

- [ ] **Step 7: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/fila`
Expected: PASS. Se `'Chegou'` casar com outro botão antes do card (ex.: item da lista com selo "Chegou"), os cards vêm primeiro no DOM, então `find` pega o card — manter a ordem do template.

- [ ] **Step 8: Commit**

```bash
git add apps/portaria-web/src/app/delivery/fila
git commit -m "feat(delivery-web): fila com cards-filtro, tempo de espera e painel fixo"
```

---

### Task 7: Front — aba Entregadores

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/entregadores/delivery-entregadores.component.ts` + `.html`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/entregadores/delivery-entregadores.component.spec.ts`

**Interfaces:**
- Consumes: `DeliveryStore` (`entregadores`, `carregarEntregadores`, `novoEntregador`, `criarEntregador`, `entregadorEmEdicao`, `editarEntregador`, `cancelarEdicao`, `salvarEntregador`, `motivoBloqueio`, `removerVeiculoEmEdicao`, `podeGerenciarEntregadores`).
- Produces: `<app-delivery-entregadores />`.

- [ ] **Step 1: Teste falhando**

```ts
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { ATENDIMENTOS, DeliveryApiStub } from '../delivery.testing';
import { DeliveryEntregadoresComponent } from './delivery-entregadores.component';

describe('DeliveryEntregadoresComponent', () => {
  function montar(turno: string) {
    TestBed.configureTestingModule({
      imports: [DeliveryEntregadoresComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    const store = TestBed.inject(DeliveryStore);
    store.entregadores.set([ATENDIMENTOS[0].entregador!]);
    const fixture = TestBed.createComponent(DeliveryEntregadoresComponent);
    fixture.detectChanges();
    return { fixture, store };
  }

  it('lista com selo de bloqueado e formulário de novo cadastro', () => {
    const { fixture } = montar('Síndico');
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('João Motoboy');
    expect(texto).toContain('Bloqueado');
    expect(texto).toContain('ABC1D23');
    expect(texto).toContain('Novo entregador');
  });

  it('síndico alterna o formulário para edição no mesmo lugar', () => {
    const { fixture, store } = montar('Síndico');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.includes('Editar'))!.click();
    fixture.detectChanges();
    expect(store.entregadorEmEdicao()?.id).toBe(20);
    expect(fixture.nativeElement.textContent).toContain('Editar entregador');
    expect(fixture.nativeElement.textContent).not.toContain('Novo entregador');
  });

  it('porteiro não vê edição', () => {
    const { fixture } = montar('Noturno');
    const botoes = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(botoes.some((b) => b.textContent?.includes('Editar'))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/entregadores`
Expected: FAIL.

- [ ] **Step 3: `delivery-entregadores.component.ts`**

```ts
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryStore } from '../delivery.store';

@Component({
  selector: 'app-delivery-entregadores',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './delivery-entregadores.component.html',
})
export class DeliveryEntregadoresComponent implements OnInit {
  readonly store = inject(DeliveryStore);
  readonly campo = 'w-full rounded-lg border border-white/10 bg-graphite px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent/60 focus:outline-none';

  ngOnInit(): void {
    if (!this.store.entregadores().length) this.store.carregarEntregadores();
  }
}
```

- [ ] **Step 4: `delivery-entregadores.component.html`**

```html
<div class="grid gap-4 lg:grid-cols-5">
  <section class="overflow-hidden rounded-2xl border border-white/10 bg-graphite-200 lg:col-span-3">
    <header class="space-y-3 border-b border-white/10 p-4">
      <h2 class="text-sm font-semibold text-white">Entregadores cadastrados <span class="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">{{ store.entregadores().length }}</span></h2>
      <input #pesquisa [class]="campo" placeholder="Pesquisar por nome, telefone ou placa" (input)="store.carregarEntregadores(pesquisa.value)">
    </header>
    @for (e of store.entregadores(); track e.id) {
      <div [class]="'flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3 last:border-b-0 ' + (store.entregadorEmEdicao()?.id === e.id ? 'bg-white/[0.05]' : '')">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent dark:text-accent-400">{{ e.nome.charAt(0).toUpperCase() }}</span>
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-sm font-medium text-white">
              <span class="truncate">{{ e.nome }}</span>
              @if (e.status === 'BLOQUEADO') {
                <span class="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">Bloqueado</span>
              }
            </p>
            <p class="truncate text-xs text-slate-400">{{ e.veiculos[0]?.placa || 'Sem placa' }}{{ e.telefone ? ' · ' + e.telefone : '' }}</p>
          </div>
        </div>
        @if (store.podeGerenciarEntregadores()) {
          <button type="button" (click)="store.editarEntregador(e)" class="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10">Editar</button>
        }
      </div>
    } @empty {
      <p class="p-10 text-center text-sm text-slate-400">Nenhum entregador encontrado.</p>
    }
  </section>

  <div class="lg:col-span-2">
    @if (store.entregadorEmEdicao(); as e) {
      <form class="space-y-3 rounded-2xl border border-accent/30 bg-graphite-200 p-5 lg:sticky lg:top-6" (ngSubmit)="store.salvarEntregador()">
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-white"><span class="h-5 w-1 rounded-full bg-accent"></span>Editar entregador</h2>
          <button type="button" (click)="store.cancelarEdicao()" class="text-xs text-slate-400 hover:text-white">Cancelar edição</button>
        </div>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Nome *</span><input required [class]="campo" [(ngModel)]="e.nome" name="editarNome"></label>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Telefone</span><input [class]="campo" [(ngModel)]="e.telefone" name="editarTelefone"></label>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Situação</span>
          <select [class]="campo" [(ngModel)]="e.status" name="editarStatus"><option value="ATIVO">Ativo</option><option value="BLOQUEADO">Bloqueado</option></select>
        </label>
        @if (e.status === 'BLOQUEADO') {
          <label class="block"><span class="mb-1.5 block text-xs font-medium text-red-700 dark:text-red-300">Motivo do bloqueio *</span><input required [class]="campo" [(ngModel)]="store.motivoBloqueio" name="motivoBloqueio"></label>
        }
        <fieldset class="rounded-lg border border-white/10 p-3">
          <legend class="px-1 text-xs font-semibold text-slate-400">Veículo</legend>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block"><span class="mb-1 block text-xs text-slate-500">Tipo</span><input [class]="campo" [(ngModel)]="e.veiculos[0].tipo" name="editarVeiculoTipo"></label>
            <label class="block"><span class="mb-1 block text-xs text-slate-500">Placa</span><input [class]="campo" [(ngModel)]="e.veiculos[0].placa" name="editarVeiculoPlaca"></label>
            <label class="block"><span class="mb-1 block text-xs text-slate-500">Modelo</span><input [class]="campo" [(ngModel)]="e.veiculos[0].modelo" name="editarVeiculoModelo"></label>
            <label class="block"><span class="mb-1 block text-xs text-slate-500">Cor</span><input [class]="campo" [(ngModel)]="e.veiculos[0].cor" name="editarVeiculoCor"></label>
          </div>
          <button type="button" class="mt-3 text-xs font-medium text-red-700 hover:underline dark:text-red-300" (click)="store.removerVeiculoEmEdicao()">Remover veículo</button>
        </fieldset>
        <button class="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600" type="submit">Salvar alterações</button>
      </form>
    } @else {
      <form class="space-y-3 rounded-2xl border border-white/10 bg-graphite-200 p-5 lg:sticky lg:top-6" (ngSubmit)="store.criarEntregador()">
        <h2 class="flex items-center gap-2 text-sm font-semibold text-white"><span class="h-5 w-1 rounded-full bg-accent"></span>Novo entregador</h2>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Nome *</span><input required [class]="campo" [(ngModel)]="store.novoEntregador.nome" name="novoNome"></label>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Telefone</span><input [class]="campo" [(ngModel)]="store.novoEntregador.telefone" name="novoTelefone"></label>
        <label class="block"><span class="mb-1.5 block text-xs font-medium text-slate-400">Placa</span><input [class]="campo" [(ngModel)]="store.novoEntregador.veiculo!.placa" name="novaPlaca" placeholder="ABC1D23"></label>
        <button class="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600" type="submit">Salvar entregador</button>
      </form>
    }
  </div>
</div>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/entregadores`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portaria-web/src/app/delivery/entregadores
git commit -m "feat(delivery-web): entregadores com edicao ao lado da lista"
```

---

### Task 8: Front — aba Histórico

**Files:**
- Create: `click-cond-web/apps/portaria-web/src/app/delivery/historico/delivery-historico.component.ts` + `.html`
- Test: `click-cond-web/apps/portaria-web/src/app/delivery/historico/delivery-historico.component.spec.ts`

**Interfaces:**
- Consumes: `DeliveryApi.listHistorico/resumo` (Task 3), `intervaloPeriodo`, `textoDuracao`, `PeriodoHistorico` (Task 3), `DeliveryStore.unidade/nomeEntregador/correspondeBusca/buscaNormalizada/definirErro` (Task 4), badge/timeline (Task 5).
- Produces: `<app-delivery-historico />`.

- [ ] **Step 1: Teste falhando**

```ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { DeliveryApi, DeliveryAtendimento } from '../delivery.service';
import { DeliveryStore } from '../delivery.store';
import { DeliveryApiStub } from '../delivery.testing';
import { DeliveryHistoricoComponent } from './delivery-historico.component';

const terminado = {
  id: 3, status: 'CONCLUIDA', estabelecimento: 'Farmácia Histórica', nome_entregador: 'Carlos Entregas',
  modo_entrega: 'UNIDADE', apartamento: { id: 12, bloco: 'C', apto: '303' }, entregador: null,
  eventos: [{ id: 30, status_novo: 'CONCLUIDA', created_at: '2026-10-03T10:30:00.000Z' }],
  created_at: '2026-10-03T10:00:00.000Z',
} as DeliveryAtendimento;

describe('DeliveryHistoricoComponent', () => {
  let api: DeliveryApiStub;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-04T12:00:00'));
    TestBed.configureTestingModule({
      imports: [DeliveryHistoricoComponent],
      providers: [
        DeliveryStore,
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1, turno: 'Síndico' }) } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    });
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    api.listHistorico.mockReturnValue(of([terminado]));
    api.resumo.mockReturnValue(of({
      ativos: {}, periodo: { de: '2026-09-28', ate: '2026-10-04', CONCLUIDA: 1, CANCELADA: 0, RECUSADA: 0, total: 1 },
      tempo_medio_atendimento_min: 7.5,
    }));
  });

  afterEach(() => jest.useRealTimers());

  it('carrega 7 dias por padrão e mostra resumo e lista', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    expect(api.listHistorico).toHaveBeenCalledWith('2026-09-28', '2026-10-04');
    expect(api.resumo).toHaveBeenCalledWith('2026-09-28', '2026-10-04');
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Farmácia Histórica');
    expect(texto).toContain('8 min');
    expect(texto).toContain('Concluídos');
  });

  it('troca de período recarrega com o novo intervalo', () => {
    const fixture = TestBed.createComponent(DeliveryHistoricoComponent);
    fixture.detectChanges();
    fixture.componentInstance.mudarPeriodo('hoje');
    expect(api.listHistorico).toHaveBeenLastCalledWith('2026-10-04', '2026-10-04');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/historico`
Expected: FAIL.

- [ ] **Step 3: `delivery-historico.component.ts`**

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryApi } from '../delivery.service';
import { DeliveryAtendimento, DeliveryResumo } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';
import { PeriodoHistorico, intervaloPeriodo, textoDuracao } from '../shared/tempo';

@Component({
  selector: 'app-delivery-historico',
  standalone: true,
  imports: [DatePipe, FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-historico.component.html',
})
export class DeliveryHistoricoComponent implements OnInit {
  private readonly api = inject(DeliveryApi);
  readonly store = inject(DeliveryStore);

  readonly periodos: { valor: PeriodoHistorico; rotulo: string }[] = [
    { valor: 'hoje', rotulo: 'Hoje' },
    { valor: '7d', rotulo: '7 dias' },
    { valor: '30d', rotulo: '30 dias' },
  ];
  readonly periodo = signal<PeriodoHistorico>('7d');
  readonly lista = signal<DeliveryAtendimento[]>([]);
  readonly resumo = signal<DeliveryResumo | null>(null);
  readonly busca = signal('');
  readonly selecionado = signal<DeliveryAtendimento | null>(null);
  readonly carregando = signal(false);
  readonly duracao = textoDuracao;

  readonly filtrados = computed(() => {
    const busca = this.store.buscaNormalizada(this.busca());
    return this.lista().filter((a) => this.store.correspondeBusca(a, busca));
  });

  ngOnInit(): void {
    this.carregar();
  }

  mudarPeriodo(p: PeriodoHistorico): void {
    this.periodo.set(p);
    this.selecionado.set(null);
    this.carregar();
  }

  carregar(): void {
    const { de, ate } = intervaloPeriodo(this.periodo(), new Date());
    this.carregando.set(true);
    this.api.listHistorico(de, ate).subscribe({
      next: (lista) => { this.lista.set(lista); this.carregando.set(false); },
      error: (error) => { this.carregando.set(false); this.store.definirErro(error, 'Não foi possível carregar o histórico.'); },
    });
    this.api.resumo(de, ate).subscribe({
      next: (resumo) => this.resumo.set(resumo),
      error: (error) => this.store.definirErro(error, 'Não foi possível carregar o resumo.'),
    });
  }
}
```

- [ ] **Step 4: `delivery-historico.component.html`**

```html
<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="text-base font-semibold text-white">Relatório do período</h2>
      <p class="text-sm text-slate-400">Atendimentos concluídos, recusados ou cancelados.</p>
    </div>
    <div class="flex w-fit items-center gap-1 rounded-xl border border-white/10 bg-graphite-200 p-1" role="group" aria-label="Período">
      @for (p of periodos; track p.valor) {
        <button type="button" (click)="mudarPeriodo(p.valor)" [attr.aria-pressed]="periodo() === p.valor"
          [class]="'rounded-lg px-3 py-1.5 text-xs font-medium transition ' + (periodo() === p.valor ? 'bg-accent text-white' : 'text-slate-400 hover:text-slate-200')">{{ p.rotulo }}</button>
      }
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="rounded-xl border border-white/10 bg-graphite-200 px-4 py-3">
      <p class="text-[11px] uppercase tracking-wider text-slate-400">Concluídos</p>
      <p class="mt-1 text-2xl font-bold tabular-nums leading-none text-emerald-700 dark:text-emerald-300">{{ resumo()?.periodo?.CONCLUIDA ?? 0 }}</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-graphite-200 px-4 py-3">
      <p class="text-[11px] uppercase tracking-wider text-slate-400">Recusados</p>
      <p class="mt-1 text-2xl font-bold tabular-nums leading-none text-red-700 dark:text-red-300">{{ resumo()?.periodo?.RECUSADA ?? 0 }}</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-graphite-200 px-4 py-3">
      <p class="text-[11px] uppercase tracking-wider text-slate-400">Cancelados</p>
      <p class="mt-1 text-2xl font-bold tabular-nums leading-none text-white">{{ resumo()?.periodo?.CANCELADA ?? 0 }}</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-graphite-200 px-4 py-3">
      <p class="text-[11px] uppercase tracking-wider text-slate-400">Tempo médio</p>
      <p class="mt-1 text-2xl font-bold tabular-nums leading-none text-white">{{ duracao(resumo()?.tempo_medio_atendimento_min ?? null) }}</p>
      <p class="mt-1 text-[11px] text-slate-500">da chegada à conclusão</p>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-5">
    <section class="overflow-hidden rounded-2xl border border-white/10 bg-graphite-200 lg:col-span-3">
      <header class="border-b border-white/10 p-4">
        <input class="w-full rounded-lg border border-white/10 bg-graphite px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent/60 focus:outline-none"
          [ngModel]="busca()" (ngModelChange)="busca.set($event)" placeholder="Buscar por unidade, estabelecimento, entregador, telefone ou placa">
      </header>
      @if (carregando()) {
        <div class="p-10 text-center"><span class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent"></span></div>
      } @else {
        @for (a of filtrados(); track a.id) {
          <button type="button" (click)="selecionado.set(a)"
            [class]="'block w-full border-b border-white/5 px-4 py-3 text-left transition last:border-b-0 hover:bg-white/[0.03] ' + (selecionado()?.id === a.id ? 'bg-white/[0.05]' : '')">
            <span class="flex items-start justify-between gap-2">
              <strong class="truncate text-sm font-semibold text-white">{{ a.estabelecimento || 'Entrega sem estabelecimento' }}</strong>
              <app-delivery-status-badge [status]="a.status" />
            </span>
            <span class="mt-1 block text-sm text-slate-300">{{ a.apartamento.bloco ? 'Bloco ' : '' }}{{ store.unidade(a) }} · {{ store.nomeEntregador(a) }}</span>
            <span class="mt-1 block text-xs text-slate-500">{{ a.created_at | date: 'dd/MM/yyyy HH:mm' }}</span>
          </button>
        } @empty {
          <p class="p-10 text-center text-sm text-slate-400">Nenhum atendimento encerrado neste período.</p>
        }
      }
    </section>

    <aside class="rounded-2xl border border-white/10 bg-graphite-200 p-4 lg:col-span-2 lg:sticky lg:top-6 lg:self-start">
      @if (selecionado(); as a) {
        <div class="mb-4 flex items-start justify-between gap-2">
          <div>
            <p class="text-xs text-slate-500">Atendimento #{{ a.id }}</p>
            <h3 class="text-sm font-semibold text-white">{{ a.apartamento.bloco ? 'Bloco ' : '' }}{{ store.unidade(a) }}</h3>
            @if (a.motivo) { <p class="mt-1 text-xs text-slate-400">Motivo: {{ a.motivo }}</p> }
          </div>
          <button type="button" (click)="selecionado.set(null)" class="text-xs text-slate-400 hover:text-white">Fechar</button>
        </div>
        <app-delivery-timeline [eventos]="a.eventos" />
      } @else {
        <p class="py-10 text-center text-sm text-slate-400">Selecione um atendimento para ver o ciclo completo.</p>
      }
    </aside>
  </div>
</div>
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/historico`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portaria-web/src/app/delivery/historico
git commit -m "feat(delivery-web): historico por periodo com resumo e tempo medio"
```

---

### Task 9: Front — casco da página, polling e remoção do template antigo

**Files:**
- Modify (reescrever): `click-cond-web/apps/portaria-web/src/app/delivery/delivery-page.component.ts`
- Modify (reescrever): `click-cond-web/apps/portaria-web/src/app/delivery/delivery-page.component.html`
- Modify (reescrever): `click-cond-web/apps/portaria-web/src/app/delivery/delivery-page.component.spec.ts`

**Interfaces:**
- Consumes: `DeliveryStore`, `DeliveryFilaComponent`, `DeliveryEntregadoresComponent`, `DeliveryHistoricoComponent`.
- Produces: `DeliveryPageComponent` (mesmo seletor `app-delivery-page`, mesma rota lazy).

- [ ] **Step 1: Reescrever o spec da página (falhando)**

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { appRoutes } from '../app.routes';
import { SidebarComponent } from '../shell/sidebar.component';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../shared/theme.service';
import { DeliveryApi } from './delivery.service';
import { DeliveryApiStub } from './delivery.testing';
import { DeliveryPageComponent } from './delivery-page.component';
import { DeliveryStore } from './delivery.store';

describe('DeliveryPageComponent', () => {
  let fixture: ComponentFixture<DeliveryPageComponent>;
  let authInfo: any;
  let api: DeliveryApiStub;

  beforeEach(async () => {
    jest.useFakeTimers();
    authInfo = { id_condominio: 1, nome: 'Síndico', turno: 'Síndico' };
    await TestBed.configureTestingModule({
      imports: [DeliveryPageComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: { porteiroInfo: () => authInfo } },
        { provide: ThemeService, useValue: { isLight: signal(false), toggleTheme: jest.fn() } },
        { provide: DeliveryApi, useClass: DeliveryApiStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DeliveryPageComponent);
    api = TestBed.inject(DeliveryApi) as unknown as DeliveryApiStub;
    fixture.detectChanges();
  });

  afterEach(() => jest.useRealTimers());

  const store = () => fixture.debugElement.injector.get(DeliveryStore);
  const aba = (texto: string) => (Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLButtonElement[])
    .find((b) => b.textContent?.includes(texto))!;

  it('inclui Delivery no menu e rota protegida no shell', () => {
    const rota = appRoutes
      .find((r) => r.children?.some((c) => c.path === 'delivery'))
      ?.children?.find((r) => r.path === 'delivery');
    const sidebar = TestBed.runInInjectionContext(() => new SidebarComponent());
    expect(rota?.loadComponent).toBeDefined();
    expect(sidebar.menu.flatMap((g) => g.items)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Delivery', path: '/delivery' })]),
    );
  });

  it('marca a aba ativa e troca o conteúdo', () => {
    expect(aba('Fila').getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Pizzaria Central');
    aba('Entregadores').click();
    fixture.detectChanges();
    expect(aba('Fila').getAttribute('aria-selected')).toBe('false');
    expect(aba('Entregadores').getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Novo entregador');
  });

  it('esconde histórico do porteiro', () => {
    authInfo = { id_condominio: 1, nome: 'Porteiro', turno: 'Noturno' };
    fixture.detectChanges();
    expect(aba('Histórico')).toBeUndefined();
  });

  it('atualiza a fila a cada 20 s só na aba Fila', () => {
    const chamadas = api.listAtivos.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    expect(api.listAtivos.mock.calls.length).toBe(chamadas + 1);
    store().trocarAba('entregadores');
    jest.advanceTimersByTime(20_000);
    expect(api.listAtivos.mock.calls.length).toBe(chamadas + 1);
  });

  it('mostra erro com botão de fechar', () => {
    store().erro.set('Falhou');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Falhou');
    (fixture.nativeElement.querySelector('[aria-label="Fechar aviso"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Falhou');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery/delivery-page.component.spec.ts`
Expected: FAIL (sem `role="tab"`, sem `DeliveryStore` no injector).

- [ ] **Step 3: `delivery-page.component.ts`**

```ts
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { DeliveryStore, AbaDelivery } from './delivery.store';
import { DeliveryFilaComponent } from './fila/delivery-fila.component';
import { DeliveryEntregadoresComponent } from './entregadores/delivery-entregadores.component';
import { DeliveryHistoricoComponent } from './historico/delivery-historico.component';

const INTERVALO_ATUALIZACAO_MS = 20_000;

@Component({
  selector: 'app-delivery-page',
  standalone: true,
  imports: [DeliveryFilaComponent, DeliveryEntregadoresComponent, DeliveryHistoricoComponent],
  providers: [DeliveryStore],
  templateUrl: './delivery-page.component.html',
})
export class DeliveryPageComponent implements OnInit {
  readonly store = inject(DeliveryStore);
  private readonly destroyRef = inject(DestroyRef);

  abas(): { id: AbaDelivery; rotulo: string }[] {
    const lista: { id: AbaDelivery; rotulo: string }[] = [
      { id: 'fila', rotulo: 'Fila' },
      { id: 'entregadores', rotulo: 'Entregadores' },
    ];
    if (this.store.podeGerenciarEntregadores()) lista.push({ id: 'historico', rotulo: 'Histórico e relatório' });
    return lista;
  }

  ngOnInit(): void {
    this.store.carregarFila();
    this.store.carregarEntregadores();
    const timer = setInterval(() => {
      if (this.store.aba() !== 'fila') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      this.store.carregarFila({ silencioso: true });
    }, INTERVALO_ATUALIZACAO_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }
}
```

- [ ] **Step 4: `delivery-page.component.html`**

```html
<div class="min-h-screen space-y-6 p-6 lg:p-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex items-start gap-4">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10">
        <svg class="h-5 w-5 text-accent dark:text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
        </svg>
      </div>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-white">Delivery</h1>
        <p class="mt-0.5 text-sm text-slate-400">Fila de entregas, entregadores e relatório do condomínio.</p>
      </div>
    </div>
    <div class="flex w-fit items-center gap-1 rounded-xl border border-white/10 bg-graphite-200 p-1" role="tablist" aria-label="Seções do delivery">
      @for (item of abas(); track item.id) {
        <button type="button" role="tab" [attr.aria-selected]="store.aba() === item.id" (click)="store.trocarAba(item.id)"
          [class]="'rounded-lg px-3.5 py-1.5 text-sm font-medium transition ' + (store.aba() === item.id ? 'bg-accent text-white shadow-sm' : 'text-slate-400 hover:text-slate-200')">
          {{ item.rotulo }}
          @if (item.id === 'fila' && store.ativos().length) {
            <span [class]="'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ' + (store.aba() === 'fila' ? 'bg-white/20' : 'bg-white/10')">{{ store.ativos().length }}</span>
          }
        </button>
      }
    </div>
  </div>

  @if (store.erro()) {
    <div role="alert" class="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
      <span>{{ store.erro() }}</span>
      <button type="button" aria-label="Fechar aviso" (click)="store.erro.set(null)" class="shrink-0 opacity-70 hover:opacity-100">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  }

  @switch (store.aba()) {
    @case ('fila') { <app-delivery-fila /> }
    @case ('entregadores') { <app-delivery-entregadores /> }
    @case ('historico') {
      @if (store.podeGerenciarEntregadores()) { <app-delivery-historico /> }
    }
  }
</div>
```

- [ ] **Step 5: Rodar todos os testes de delivery + build**

Run: `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery && npx nx build portaria-web`
Expected: PASS e build sem erros. Se `nx build` acusar budget, só registrar (não é deste escopo).

- [ ] **Step 6: Commit**

```bash
git add apps/portaria-web/src/app/delivery
git commit -m "feat(delivery-web): casco com abas ativas, aviso de erro e atualizacao automatica"
```

---

### Task 10: Verificação visual (Playwright) e deploy

**Files:** nenhum código novo, salvo correções encontradas na verificação (commitar cada uma).

- [ ] **Step 1: Subir API e console locais** (de `click-cond-web/`, em background):

`npx nx serve api` e `npx nx serve portaria-web` (o console usa `/api` com `proxy.conf.json` para `localhost:3000`). O `.env` aponta para o banco de produção (dados de teste) — só ler e mexer no atendimento "Teste Claude Farmacia".

- [ ] **Step 2: Playwright** — `browser_navigate` para `http://localhost:4200/delivery`, logar com o usuário de teste `suporte@clickprestarecondominios.com.br` (senha informada pelo usuário na sessão; não gravar em arquivo) e conferir, com `browser_take_screenshot` em 1440×900 e 400×860, nos temas escuro e claro (alternar pelo botão de tema do menu):
  - abas com estado ativo; cards coloridos; clique no card filtra;
  - item da fila com selo, "há X min", modo; painel vazio orienta;
  - selecionar o atendimento: ações com hierarquia, recusar abre motivo inline (clicar "Voltar", não confirmar);
  - aba Entregadores: Editar troca o formulário à direita;
  - aba Histórico: períodos, cards do resumo, tempo médio;
  - `browser_console_messages` sem erros; `browser_network_requests` mostra `escopo=ativos` e `/delivery/resumo` com 200.

- [ ] **Step 3: Corrigir o que aparecer**, rodar de novo `npx jest -c apps/portaria-web/jest.config.cts apps/portaria-web/src/app/delivery` e commitar.

- [ ] **Step 4: Deploy — perguntar ao usuário antes.** Com o ok: `git push origin master` e `git push origin master:main`; se os workflows colidirem, `gh workflow run deploy-api.yml`. Depois repetir o Step 2 em `https://www.prestarecondominios.com.br/delivery`.
