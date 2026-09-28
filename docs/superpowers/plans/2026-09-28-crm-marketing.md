# CRM Marketing (leads + Google Ads + OpenAI Ads) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Marketing" no CRM mostrando investimento, leads, custo por lead e contratos fechados por canal, com os leads do formulário da landing gravados e acompanhados por status.

**Architecture:** Duas tabelas Prisma novas (`Crm_Leads`, `Crm_Anuncios_Diario`). Módulo NestJS `marketing` com endpoints públicos (lead da landing, ingest do Google Ads Script por token), job horário que puxa a OpenAI Ads API, e endpoints `/crm/marketing/*` sob `CrmAdminGuard`. Nova aba Angular standalone em `crm-web`. A landing faz `fetch(..., {keepalive:true})` antes de abrir o WhatsApp.

**Tech Stack:** NestJS 10 + Prisma (MySQL) + Jest/SWC; Angular standalone + signals + Tailwind; HTML estático da landing.

**Spec:** `docs/superpowers/specs/2026-09-28-crm-marketing-design.md`

## Global Constraints

- Raiz do código: `click-cond-web/` (todos os caminhos abaixo são relativos a ela).
- Prefixo global da API: `/api`. Produção: `https://api.prestarecondominios.com.br`.
- Endpoints públicos usam `@Public()` de `apps/api/src/app/auth/public.decorator` e `@Throttle({ medium: { limit, ttl } })`.
- Rotas do CRM usam `@UseGuards(CrmAdminGuard)` de `apps/api/src/app/crm/crm-admin.guard`.
- Jobs: padrão `onModuleInit` + `setInterval` + flag de "rodando" (ver `crm-faturas.service.ts:28-45`). Sem `@nestjs/schedule`.
- Testes da API: Jest com `process.env.TZ='UTC'`; rodar `npx nx test api --testFile=<arquivo>`.
- Env novos: `ADS_INGEST_TOKEN`, `OPENAI_ADS_API_KEY`. Sem a chave, o job loga aviso e não roda.
- Origem do lead: `gclid`→`google`, `oppref`→`openai`, `utm_source` = `instagram` (case-insensitive)→`instagram`, senão `organico`. Prioridade nessa ordem.
- Status do lead: `novo` | `em_contato` | `proposta` | `fechado` | `perdido`.
- Migração: SQL aplicado direto no banco de produção **antes** do push (padrão do projeto; `DATABASE_URL` do `.env` é produção).
- Idioma de UI e mensagens: pt-BR.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` (+ cópias `deploy-api-aws/prisma/`, `eb-package/prisma/` se versionadas) | models `Crm_Leads`, `Crm_Anuncios_Diario` |
| `prisma/migrations-manual/2026-09-28-crm-marketing.sql` | SQL para aplicar no banco |
| `apps/api/src/app/marketing/lead-origem.ts` | função pura `derivarOrigem` + `validarLead` |
| `apps/api/src/app/marketing/marketing-leads.service.ts` | criar/listar/atualizar leads |
| `apps/api/src/app/marketing/marketing-ads.service.ts` | upsert diário, ingest Google, job OpenAI |
| `apps/api/src/app/marketing/openai-ads.client.ts` | chamadas HTTP à OpenAI Ads API |
| `apps/api/src/app/marketing/marketing-resumo.service.ts` | KPIs, por canal, série diária, frescor |
| `apps/api/src/app/marketing/marketing-public.controller.ts` | `POST /public/leads`, `POST /public/ads/google` |
| `apps/api/src/app/marketing/marketing-crm.controller.ts` | `GET/PATCH /crm/marketing/*` |
| `apps/api/src/app/marketing/marketing.module.ts` | módulo; registrado em `app.module.ts` |
| `apps/crm-web/src/app/crm/marketing.service.ts` | client HTTP + tipos |
| `apps/crm-web/src/app/crm/tabs/crm-marketing.component.{ts,html}` | aba |
| `apps/portaria-web/public/sobre/index.html` | captura de origem + envio do lead |
| `docs/marketing/google-ads-script.js` | script a instalar na conta Google Ads |

---

### Task 1: Schema e SQL

**Files:**
- Modify: `prisma/schema.prisma` (final do arquivo)
- Create: `prisma/migrations-manual/2026-09-28-crm-marketing.sql`

**Interfaces:**
- Produces: models Prisma `Crm_Leads` (delegate `prisma.crm_Leads`) e `Crm_Anuncios_Diario` (delegate `prisma.crm_Anuncios_Diario`), enums `Crm_LeadOrigem`, `Crm_LeadStatus`, `Crm_AdsPlataforma`.

- [ ] **Step 1: Adicionar models ao schema**

```prisma
enum Crm_LeadOrigem {
  google
  openai
  instagram
  organico
}

enum Crm_LeadStatus {
  novo
  em_contato
  proposta
  fechado
  perdido
}

enum Crm_AdsPlataforma {
  google
  openai
}

model Crm_Leads {
  id           Int            @id @default(autoincrement())
  nome         String         @db.VarChar(120)
  condominio   String         @db.VarChar(160)
  unidades     String         @db.VarChar(60)
  whatsapp     String         @db.VarChar(20)
  origem       Crm_LeadOrigem
  gclid        String?        @db.VarChar(255)
  oppref       String?        @db.VarChar(255)
  utm_source   String?        @db.VarChar(120)
  utm_medium   String?        @db.VarChar(120)
  utm_campaign String?        @db.VarChar(120)
  pagina       String?        @db.VarChar(255)
  status       Crm_LeadStatus @default(novo)
  observacao   String?        @db.Text
  status_em    DateTime?      @db.DateTime(0)
  criado_em    DateTime       @default(now()) @db.DateTime(0)

  @@index([criado_em], map: "idx_crm_leads_criado")
  @@index([status], map: "idx_crm_leads_status")
  @@map("crm_leads")
}

model Crm_Anuncios_Diario {
  id            Int               @id @default(autoincrement())
  plataforma    Crm_AdsPlataforma
  campanha_id   String            @db.VarChar(64)
  campanha_nome String            @db.VarChar(200)
  dia           DateTime          @db.Date
  impressoes    Int               @default(0)
  cliques       Int               @default(0)
  gasto         Decimal           @default(0) @db.Decimal(12, 2)
  conversoes    Decimal           @default(0) @db.Decimal(10, 2)
  atualizado_em DateTime          @updatedAt @db.DateTime(0)

  @@unique([plataforma, campanha_id, dia], map: "uq_crm_anuncios_dia")
  @@map("crm_anuncios_diario")
}
```

- [ ] **Step 2: Escrever o SQL equivalente**

```sql
CREATE TABLE IF NOT EXISTS crm_leads (
  id INT NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  condominio VARCHAR(160) NOT NULL,
  unidades VARCHAR(60) NOT NULL,
  whatsapp VARCHAR(20) NOT NULL,
  origem ENUM('google','openai','instagram','organico') NOT NULL,
  gclid VARCHAR(255) NULL,
  oppref VARCHAR(255) NULL,
  utm_source VARCHAR(120) NULL,
  utm_medium VARCHAR(120) NULL,
  utm_campaign VARCHAR(120) NULL,
  pagina VARCHAR(255) NULL,
  status ENUM('novo','em_contato','proposta','fechado','perdido') NOT NULL DEFAULT 'novo',
  observacao TEXT NULL,
  status_em DATETIME NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_crm_leads_criado (criado_em),
  INDEX idx_crm_leads_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_anuncios_diario (
  id INT NOT NULL AUTO_INCREMENT,
  plataforma ENUM('google','openai') NOT NULL,
  campanha_id VARCHAR(64) NOT NULL,
  campanha_nome VARCHAR(200) NOT NULL,
  dia DATE NOT NULL,
  impressoes INT NOT NULL DEFAULT 0,
  cliques INT NOT NULL DEFAULT 0,
  gasto DECIMAL(12,2) NOT NULL DEFAULT 0,
  conversoes DECIMAL(10,2) NOT NULL DEFAULT 0,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_anuncios_dia (plataforma, campanha_id, dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 3: Gerar client e validar**

Run: `npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" e client gerado sem erro.

- [ ] **Step 4: Copiar para as cópias do schema se existirem no git**

Run: `git ls-files deploy-api-aws/prisma/schema.prisma eb-package/prisma/schema.prisma`
Se listar, repetir o Step 1 nesses arquivos.

- [ ] **Step 5: Commit**

```bash
git add prisma/ apps/api/src/app/prisma/generated
git commit -m "feat(crm-marketing): tabelas crm_leads e crm_anuncios_diario"
```

(Aplicação do SQL em produção fica para a Task 9, antes do push.)

---

### Task 2: Origem e validação do lead (funções puras)

**Files:**
- Create: `apps/api/src/app/marketing/lead-origem.ts`
- Test: `apps/api/src/app/marketing/lead-origem.spec.ts`

**Interfaces:**
- Produces:
  - `type LeadOrigem = 'google' | 'openai' | 'instagram' | 'organico'`
  - `derivarOrigem(p: { gclid?: string|null; oppref?: string|null; utm_source?: string|null }): LeadOrigem`
  - `interface LeadEntrada { nome; condominio; unidades; whatsapp; gclid?; oppref?; utm_source?; utm_medium?; utm_campaign?; pagina? }` (todos `string`, opcionais `string | undefined`)
  - `validarLead(body: unknown): LeadEntrada` — lança `BadRequestException` com mensagem pt-BR.

- [ ] **Step 1: Teste**

```ts
import { BadRequestException } from '@nestjs/common';
import { derivarOrigem, validarLead } from './lead-origem';

describe('derivarOrigem', () => {
  it('gclid vence tudo', () => {
    expect(derivarOrigem({ gclid: 'x', oppref: 'y', utm_source: 'instagram' })).toBe('google');
  });
  it('oppref vira openai', () => expect(derivarOrigem({ oppref: 'y' })).toBe('openai'));
  it('utm instagram, sem diferenciar maiúsculas', () =>
    expect(derivarOrigem({ utm_source: 'Instagram' })).toBe('instagram'));
  it('sem nada é orgânico', () => expect(derivarOrigem({})).toBe('organico'));
  it('string vazia não conta', () => expect(derivarOrigem({ gclid: '  ' })).toBe('organico'));
});

describe('validarLead', () => {
  const ok = { nome: 'Ana', condominio: 'Ed. Sol', unidades: '40', whatsapp: '(17) 99999-0000' };

  it('normaliza whatsapp para dígitos e apara textos', () => {
    const r = validarLead({ ...ok, nome: '  Ana  ' });
    expect(r.whatsapp).toBe('17999990000');
    expect(r.nome).toBe('Ana');
  });
  it('rejeita whatsapp curto', () =>
    expect(() => validarLead({ ...ok, whatsapp: '123' })).toThrow(BadRequestException));
  it('rejeita campo obrigatório vazio', () =>
    expect(() => validarLead({ ...ok, condominio: '' })).toThrow(BadRequestException));
  it('corta campos longos em vez de falhar', () => {
    const r = validarLead({ ...ok, nome: 'a'.repeat(300), gclid: 'g'.repeat(400) });
    expect(r.nome.length).toBe(120);
    expect(r.gclid!.length).toBe(255);
  });
  it('rejeita corpo que não é objeto', () =>
    expect(() => validarLead(null)).toThrow(BadRequestException));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx nx test api --testFile=lead-origem.spec.ts`
Expected: FAIL "Cannot find module './lead-origem'"

- [ ] **Step 3: Implementar**

```ts
import { BadRequestException } from '@nestjs/common';

export type LeadOrigem = 'google' | 'openai' | 'instagram' | 'organico';

export interface LeadEntrada {
  nome: string;
  condominio: string;
  unidades: string;
  whatsapp: string;
  gclid?: string;
  oppref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  pagina?: string;
}

const temValor = (v?: string | null) => !!v && v.trim().length > 0;

export function derivarOrigem(p: { gclid?: string | null; oppref?: string | null; utm_source?: string | null }): LeadOrigem {
  if (temValor(p.gclid)) return 'google';
  if (temValor(p.oppref)) return 'openai';
  if (temValor(p.utm_source) && p.utm_source!.trim().toLowerCase() === 'instagram') return 'instagram';
  return 'organico';
}

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function opcional(v: unknown, max: number): string | undefined {
  const t = texto(v, max);
  return t ? t : undefined;
}

export function validarLead(body: unknown): LeadEntrada {
  if (!body || typeof body !== 'object') throw new BadRequestException('Dados do pedido inválidos.');
  const b = body as Record<string, unknown>;
  const nome = texto(b.nome, 120);
  const condominio = texto(b.condominio, 160);
  const unidades = texto(b.unidades, 60);
  const whatsapp = texto(b.whatsapp, 40).replace(/\D/g, '');
  if (!nome || !condominio || !unidades) throw new BadRequestException('Preencha nome, condomínio e unidades.');
  if (whatsapp.length < 10 || whatsapp.length > 13) throw new BadRequestException('WhatsApp inválido.');
  return {
    nome,
    condominio,
    unidades,
    whatsapp,
    gclid: opcional(b.gclid, 255),
    oppref: opcional(b.oppref, 255),
    utm_source: opcional(b.utm_source, 120),
    utm_medium: opcional(b.utm_medium, 120),
    utm_campaign: opcional(b.utm_campaign, 120),
    pagina: opcional(b.pagina, 255),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx nx test api --testFile=lead-origem.spec.ts`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/marketing/lead-origem.ts apps/api/src/app/marketing/lead-origem.spec.ts
git commit -m "feat(crm-marketing): origem e validacao do lead"
```

---

### Task 3: Serviço de leads + endpoint público + rotas CRM de leads + módulo

**Files:**
- Create: `apps/api/src/app/marketing/marketing-leads.service.ts`
- Create: `apps/api/src/app/marketing/marketing-public.controller.ts`
- Create: `apps/api/src/app/marketing/marketing-crm.controller.ts`
- Create: `apps/api/src/app/marketing/marketing.module.ts`
- Modify: `apps/api/src/app/app.module.ts` (adicionar `MarketingModule` em `imports`)
- Test: `apps/api/src/app/marketing/marketing-leads.service.spec.ts`

**Interfaces:**
- Consumes: `validarLead`, `derivarOrigem`, `LeadEntrada` (Task 2); `prisma.crm_Leads` (Task 1).
- Produces:
  - `MarketingLeadsService.criar(body: unknown): Promise<void>`
  - `MarketingLeadsService.listar(f: { status?: string; origem?: string; de?: Date; ate?: Date }): Promise<LeadDto[]>`
  - `MarketingLeadsService.atualizar(id: number, p: { status?: string; observacao?: string }): Promise<LeadDto>`
  - `interface LeadDto { id: number; nome: string; condominio: string; unidades: string; whatsapp: string; origem: LeadOrigem; status: LeadStatus; observacao: string | null; criadoEm: string; statusEm: string | null }`
  - `type LeadStatus = 'novo' | 'em_contato' | 'proposta' | 'fechado' | 'perdido'`
  - `MarketingModule` (exporta os services para as Tasks 4 e 5 adicionarem providers).
  - Rotas: `POST /api/public/leads` (204), `GET /api/crm/marketing/leads`, `PATCH /api/crm/marketing/leads/:id`.

- [ ] **Step 1: Teste do serviço**

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketingLeadsService } from './marketing-leads.service';

function montar(existente: any = null) {
  const prisma: any = {
    crm_Leads: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => existente),
      update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
    },
  };
  return { prisma, svc: new MarketingLeadsService(prisma) };
}

const base = { nome: 'Ana', condominio: 'Ed. Sol', unidades: '40', whatsapp: '17999990000' };

describe('MarketingLeadsService', () => {
  it('grava lead com origem derivada do gclid', async () => {
    const { prisma, svc } = montar();
    await svc.criar({ ...base, gclid: 'abc' });
    expect(prisma.crm_Leads.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origem: 'google', gclid: 'abc', whatsapp: '17999990000' }),
    });
  });

  it('rejeita lead inválido sem gravar', async () => {
    const { prisma, svc } = montar();
    await expect(svc.criar({ ...base, whatsapp: '1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.crm_Leads.create).not.toHaveBeenCalled();
  });

  it('atualizar muda status e carimba status_em', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { status: 'proposta' });
    const data = prisma.crm_Leads.update.mock.calls[0][0].data;
    expect(data.status).toBe('proposta');
    expect(data.status_em).toBeInstanceOf(Date);
  });

  it('atualizar só observação não mexe em status_em', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { prisma, svc } = montar(lead);
    await svc.atualizar(5, { observacao: 'ligar segunda' });
    expect(prisma.crm_Leads.update.mock.calls[0][0].data).toEqual({ observacao: 'ligar segunda' });
  });

  it('status inválido é rejeitado', async () => {
    const lead = { id: 5, ...base, origem: 'google', status: 'novo', observacao: null, criado_em: new Date(), status_em: null };
    const { svc } = montar(lead);
    await expect(svc.atualizar(5, { status: 'ganho' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lead inexistente dá 404', async () => {
    const { svc } = montar(null);
    await expect(svc.atualizar(9, { status: 'novo' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx nx test api --testFile=marketing-leads.service.spec.ts`
Expected: FAIL (módulo não encontrado)

- [ ] **Step 3: Implementar o serviço**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { derivarOrigem, LeadOrigem, validarLead } from './lead-origem';

export type LeadStatus = 'novo' | 'em_contato' | 'proposta' | 'fechado' | 'perdido';
export const LEAD_STATUS: LeadStatus[] = ['novo', 'em_contato', 'proposta', 'fechado', 'perdido'];
const ORIGENS: LeadOrigem[] = ['google', 'openai', 'instagram', 'organico'];

export interface LeadDto {
  id: number;
  nome: string;
  condominio: string;
  unidades: string;
  whatsapp: string;
  origem: LeadOrigem;
  status: LeadStatus;
  observacao: string | null;
  criadoEm: string;
  statusEm: string | null;
}

function paraDto(l: any): LeadDto {
  return {
    id: l.id,
    nome: l.nome,
    condominio: l.condominio,
    unidades: l.unidades,
    whatsapp: l.whatsapp,
    origem: l.origem,
    status: l.status,
    observacao: l.observacao ?? null,
    criadoEm: new Date(l.criado_em).toISOString(),
    statusEm: l.status_em ? new Date(l.status_em).toISOString() : null,
  };
}

@Injectable()
export class MarketingLeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(body: unknown): Promise<void> {
    const lead = validarLead(body);
    await this.prisma.crm_Leads.create({
      data: { ...lead, origem: derivarOrigem(lead) },
    });
  }

  async listar(f: { status?: string; origem?: string; de?: Date; ate?: Date }): Promise<LeadDto[]> {
    const where: any = {};
    if (f.status && (LEAD_STATUS as string[]).includes(f.status)) where.status = f.status;
    if (f.origem && (ORIGENS as string[]).includes(f.origem)) where.origem = f.origem;
    if (f.de || f.ate) where.criado_em = { ...(f.de ? { gte: f.de } : {}), ...(f.ate ? { lte: f.ate } : {}) };
    const rows = await this.prisma.crm_Leads.findMany({ where, orderBy: { criado_em: 'desc' }, take: 500 });
    return rows.map(paraDto);
  }

  async atualizar(id: number, p: { status?: string; observacao?: string }): Promise<LeadDto> {
    const atual = await this.prisma.crm_Leads.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Lead não encontrado.');
    const data: any = {};
    if (p.status !== undefined) {
      if (!(LEAD_STATUS as string[]).includes(p.status)) throw new BadRequestException('Status inválido.');
      if (p.status !== atual.status) {
        data.status = p.status;
        data.status_em = new Date();
      }
    }
    if (p.observacao !== undefined) data.observacao = String(p.observacao).slice(0, 5000);
    const salvo = await this.prisma.crm_Leads.update({ where: { id }, data });
    return paraDto(salvo);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx nx test api --testFile=marketing-leads.service.spec.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Controllers e módulo**

`marketing-public.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { MarketingLeadsService } from './marketing-leads.service';

/**
 * Entradas públicas de marketing. Sem login: o formulário da landing (/sobre)
 * e o Google Ads Script chamam de fora. O lead tem throttle; o ingest de
 * anúncios (Task 4) exige token.
 */
@Controller('public')
export class MarketingPublicController {
  constructor(private readonly leads: MarketingLeadsService) {}

  @Public()
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  @HttpCode(204)
  async criarLead(@Body() body: unknown): Promise<void> {
    await this.leads.criar(body);
  }
}
```

`marketing-crm.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingLeadsService } from './marketing-leads.service';

function data(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

@Controller('crm/marketing')
@UseGuards(CrmAdminGuard)
export class MarketingCrmController {
  constructor(private readonly leads: MarketingLeadsService) {}

  @Get('leads')
  listar(@Query('status') status?: string, @Query('origem') origem?: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.leads.listar({ status, origem, de: data(de), ate: data(ate) });
  }

  @Patch('leads/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string; observacao?: string }) {
    return this.leads.atualizar(id, body ?? {});
  }
}
```

`marketing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingLeadsService } from './marketing-leads.service';
import { MarketingPublicController } from './marketing-public.controller';
import { MarketingCrmController } from './marketing-crm.controller';

@Module({
  imports: [CrmModule],
  controllers: [MarketingPublicController, MarketingCrmController],
  providers: [MarketingLeadsService, CrmAdminGuard],
})
export class MarketingModule {}
```

Em `apps/api/src/app/app.module.ts`, importar `MarketingModule` de `./marketing/marketing.module` e adicioná-lo ao array `imports` ao lado de `CrmModule`.

Nota: `CrmAdminGuard` depende de `PrismaService` (global). Se o build reclamar de dependência do guard, conferir o construtor em `crm/crm-admin.guard.ts` e importar o que ele pede.

- [ ] **Step 6: Build**

Run: `npx nx build api`
Expected: build sem erro.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app/marketing apps/api/src/app/app.module.ts
git commit -m "feat(crm-marketing): leads da landing (endpoint publico + rotas CRM)"
```

---

### Task 4: Anúncios diários — upsert, ingest do Google, job da OpenAI

**Files:**
- Create: `apps/api/src/app/marketing/openai-ads.client.ts`
- Create: `apps/api/src/app/marketing/marketing-ads.service.ts`
- Modify: `apps/api/src/app/marketing/marketing-public.controller.ts` (rota `ads/google`)
- Modify: `apps/api/src/app/marketing/marketing.module.ts` (providers)
- Test: `apps/api/src/app/marketing/marketing-ads.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.crm_Anuncios_Diario` (Task 1).
- Produces:
  - `interface LinhaAnuncio { campanha_id: string; campanha_nome: string; dia: string /* YYYY-MM-DD */; impressoes: number; cliques: number; gasto: number; conversoes: number }`
  - `MarketingAdsService.upsert(plataforma: 'google'|'openai', linhas: LinhaAnuncio[]): Promise<number>` (retorna linhas gravadas)
  - `MarketingAdsService.ingestGoogle(token: string | undefined, body: unknown): Promise<{ gravadas: number }>` — 401 se token não bate; 400 se corpo inválido.
  - `MarketingAdsService.sincronizarOpenAi(): Promise<number>`
  - `OpenAiAdsClient.buscarDiario(de: string, ate: string): Promise<LinhaAnuncio[]>` (`estaConfigurado(): boolean`)
  - Rota: `POST /api/public/ads/google` com header `X-Ingest-Token`.

- [ ] **Step 1: Teste**

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MarketingAdsService } from './marketing-ads.service';

function montar(env: Record<string, string | undefined> = { ADS_INGEST_TOKEN: 'segredo' }) {
  const prisma: any = { crm_Anuncios_Diario: { upsert: jest.fn(async () => ({})) } };
  const openai: any = { estaConfigurado: jest.fn(() => true), buscarDiario: jest.fn(async () => []) };
  const svc = new MarketingAdsService(prisma, openai);
  const antigo = { ...process.env };
  Object.assign(process.env, env);
  return { prisma, openai, svc, restaurar: () => { process.env = antigo; } };
}

const linha = { campanha_id: '24298071745', campanha_nome: 'Prestare', dia: '2026-09-27', impressoes: 10, cliques: 2, gasto: 7.5, conversoes: 1 };

describe('MarketingAdsService', () => {
  it('upsert usa a chave única e converte o dia para Date UTC', async () => {
    const { prisma, svc, restaurar } = montar();
    await svc.upsert('google', [linha]);
    const arg = prisma.crm_Anuncios_Diario.upsert.mock.calls[0][0];
    expect(arg.where.plataforma_campanha_id_dia).toEqual({
      plataforma: 'google', campanha_id: '24298071745', dia: new Date('2026-09-27T00:00:00.000Z'),
    });
    expect(arg.update).toEqual(expect.objectContaining({ impressoes: 10, cliques: 2, gasto: 7.5, conversoes: 1 }));
    restaurar();
  });

  it('ingestGoogle rejeita token errado', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('errado', { rows: [linha] })).rejects.toBeInstanceOf(UnauthorizedException);
    restaurar();
  });

  it('ingestGoogle rejeita quando o servidor não tem token configurado', async () => {
    const { svc, restaurar } = montar({ ADS_INGEST_TOKEN: '' });
    await expect(svc.ingestGoogle('', { rows: [linha] })).rejects.toBeInstanceOf(UnauthorizedException);
    restaurar();
  });

  it('ingestGoogle rejeita linha com dia inválido', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('segredo', { rows: [{ ...linha, dia: '27/09' }] })).rejects.toBeInstanceOf(BadRequestException);
    restaurar();
  });

  it('ingestGoogle grava e conta', async () => {
    const { svc, restaurar } = montar();
    await expect(svc.ingestGoogle('segredo', { rows: [linha, { ...linha, dia: '2026-09-26' }] })).resolves.toEqual({ gravadas: 2 });
    restaurar();
  });

  it('sincronizarOpenAi não chama a API sem chave', async () => {
    const { openai, svc, restaurar } = montar();
    openai.estaConfigurado.mockReturnValue(false);
    await expect(svc.sincronizarOpenAi()).resolves.toBe(0);
    expect(openai.buscarDiario).not.toHaveBeenCalled();
    restaurar();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx nx test api --testFile=marketing-ads.service.spec.ts`
Expected: FAIL (módulo não encontrado)

- [ ] **Step 3: Cliente OpenAI Ads**

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { LinhaAnuncio } from './marketing-ads.service';

const BASE = 'https://api.ads.openai.com/v1';

/**
 * Leitura da OpenAI Ads API (developers.openai.com/ads). Chave criada em
 * Ads Manager → Configurações; fica em OPENAI_ADS_API_KEY.
 * Insights: GET /ad_account/insights (impressões, cliques, gasto por campanha/dia).
 * Conversões: POST /conversions/insights.
 */
@Injectable()
export class OpenAiAdsClient {
  private readonly logger = new Logger(OpenAiAdsClient.name);

  estaConfigurado(): boolean {
    return !!process.env.OPENAI_ADS_API_KEY;
  }

  private headers() {
    return { Authorization: `Bearer ${process.env.OPENAI_ADS_API_KEY}`, 'Content-Type': 'application/json' };
  }

  async buscarDiario(de: string, ate: string): Promise<LinhaAnuncio[]> {
    const range = JSON.stringify({ since: de, until: ate });
    const qs = new URLSearchParams();
    qs.set('aggregation_level', 'campaign');
    qs.set('time_granularity', 'daily');
    qs.append('time_ranges[]', range);
    for (const f of ['campaign_id', 'campaign_name', 'impressions', 'clicks', 'spend']) qs.append('fields[]', f);
    qs.set('limit', '2000');

    const r = await fetch(`${BASE}/ad_account/insights?${qs}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`OpenAI Ads insights ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const insights: any = await r.json();

    const c = await fetch(`${BASE}/conversions/insights`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ aggregation_level: 'campaign', time_ranges: [{ since: de, until: ate }], time_granularity: 'daily', group_by_entity: false }),
    });
    const conv: any = c.ok ? await c.json() : { data: [] };
    if (!c.ok) this.logger.warn(`OpenAI Ads conversões ${c.status}; seguindo sem conversões`);

    const convPor = new Map<string, number>();
    for (const row of conv.data ?? []) {
      const k = `${row.campaign_id ?? row.entity_id ?? ''}|${String(row.date ?? row.date_start ?? '').slice(0, 10)}`;
      convPor.set(k, Number(row.conversions ?? 0));
    }

    return (insights.data ?? []).map((row: any) => {
      const dia = String(row.date ?? row.date_start ?? '').slice(0, 10);
      const id = String(row.campaign_id ?? row.id ?? '');
      return {
        campanha_id: id,
        campanha_nome: String(row.campaign_name ?? row.name ?? id),
        dia,
        impressoes: Number(row.impressions ?? 0),
        cliques: Number(row.clicks ?? 0),
        gasto: Number(row.spend ?? 0),
        conversoes: convPor.get(`${id}|${dia}`) ?? 0,
      };
    });
  }
}
```

(Nota para quem executa: os nomes exatos dos campos da resposta — `date` vs `date_start`, `campaign_id` — devem ser confirmados na primeira chamada real na Task 9, Step 4; o código aceita os dois formatos mais prováveis.)

- [ ] **Step 4: Serviço de anúncios**

```ts
import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiAdsClient } from './openai-ads.client';

export interface LinhaAnuncio {
  campanha_id: string;
  campanha_nome: string;
  dia: string;
  impressoes: number;
  cliques: number;
  gasto: number;
  conversoes: number;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function tokenConfere(recebido: string | undefined, esperado: string | undefined): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function linhaValida(r: any): LinhaAnuncio {
  if (!r || typeof r !== 'object' || !DIA.test(String(r.dia)) || !r.campanha_id) {
    throw new BadRequestException('Linha de anúncio inválida.');
  }
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    campanha_id: String(r.campanha_id).slice(0, 64),
    campanha_nome: String(r.campanha_nome ?? r.campanha_id).slice(0, 200),
    dia: String(r.dia),
    impressoes: Math.round(n(r.impressoes)),
    cliques: Math.round(n(r.cliques)),
    gasto: n(r.gasto),
    conversoes: n(r.conversoes),
  };
}

function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class MarketingAdsService implements OnModuleInit {
  private readonly logger = new Logger(MarketingAdsService.name);
  private openAiRodando = false;

  constructor(private readonly prisma: PrismaService, private readonly openai: OpenAiAdsClient) {}

  onModuleInit() {
    // OpenAI Ads: sincroniza de hora em hora os últimos 7 dias (números do dia
    // corrente e de ontem ainda mudam). Upsert torna a repetição inofensiva.
    setInterval(() => this.tickOpenAi(), 60 * 60 * 1000);
    setTimeout(() => this.tickOpenAi(), 2 * 60 * 1000);
  }

  private async tickOpenAi() {
    if (this.openAiRodando) return;
    this.openAiRodando = true;
    try {
      await this.sincronizarOpenAi();
    } catch (err: any) {
      this.logger.error(`Sync OpenAI Ads falhou: ${err?.message ?? err}`);
    } finally {
      this.openAiRodando = false;
    }
  }

  async upsert(plataforma: 'google' | 'openai', linhas: LinhaAnuncio[]): Promise<number> {
    for (const l of linhas) {
      const dia = new Date(`${l.dia}T00:00:00.000Z`);
      const valores = {
        campanha_nome: l.campanha_nome,
        impressoes: l.impressoes,
        cliques: l.cliques,
        gasto: l.gasto,
        conversoes: l.conversoes,
      };
      await this.prisma.crm_Anuncios_Diario.upsert({
        where: { plataforma_campanha_id_dia: { plataforma, campanha_id: l.campanha_id, dia } },
        create: { plataforma, campanha_id: l.campanha_id, dia, ...valores },
        update: valores,
      });
    }
    return linhas.length;
  }

  async ingestGoogle(token: string | undefined, body: unknown): Promise<{ gravadas: number }> {
    if (!tokenConfere(token, process.env.ADS_INGEST_TOKEN)) throw new UnauthorizedException();
    const rows = (body as any)?.rows;
    if (!Array.isArray(rows) || rows.length > 5000) throw new BadRequestException('Corpo inválido.');
    const linhas = rows.map(linhaValida);
    return { gravadas: await this.upsert('google', linhas) };
  }

  async sincronizarOpenAi(): Promise<number> {
    if (!this.openai.estaConfigurado()) {
      this.logger.warn('OPENAI_ADS_API_KEY ausente — sync da OpenAI Ads desligado');
      return 0;
    }
    const ate = new Date();
    const de = new Date(ate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const linhas = await this.openai.buscarDiario(isoDia(de), isoDia(ate));
    return this.upsert('openai', linhas.filter((l) => DIA.test(l.dia) && l.campanha_id));
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx nx test api --testFile=marketing-ads.service.spec.ts`
Expected: PASS (6 testes)

- [ ] **Step 6: Rota de ingest e providers**

Em `marketing-public.controller.ts`, injetar `MarketingAdsService` e acrescentar:

```ts
  @Public()
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post('ads/google')
  ingestGoogle(@Headers('x-ingest-token') token: string | undefined, @Body() body: unknown) {
    return this.ads.ingestGoogle(token, body);
  }
```

(importar `Headers` de `@nestjs/common` e `MarketingAdsService`; construtor passa a ser `constructor(private readonly leads: MarketingLeadsService, private readonly ads: MarketingAdsService) {}`).

Em `marketing.module.ts`, adicionar `MarketingAdsService` e `OpenAiAdsClient` em `providers`.

- [ ] **Step 7: Build**

Run: `npx nx build api`
Expected: sem erro.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/app/marketing
git commit -m "feat(crm-marketing): ingest do Google Ads Script e sync da OpenAI Ads"
```

---

### Task 5: Resumo para o painel

**Files:**
- Create: `apps/api/src/app/marketing/marketing-resumo.service.ts`
- Modify: `apps/api/src/app/marketing/marketing-crm.controller.ts` (`GET resumo`)
- Modify: `apps/api/src/app/marketing/marketing.module.ts`
- Test: `apps/api/src/app/marketing/marketing-resumo.service.spec.ts`

**Interfaces:**
- Consumes: tabelas das Tasks 1/3/4.
- Produces:
  - `MarketingResumoService.resumo(de: Date, ate: Date): Promise<ResumoMarketing>`
  - ```ts
    interface CanalResumo { canal: 'google' | 'openai' | 'instagram' | 'organico'; impressoes: number | null; cliques: number | null; ctr: number | null; gasto: number | null; conversoesPlataforma: number | null; leads: number; custoPorLead: number | null; fechados: number }
    interface ResumoMarketing {
      periodo: { de: string; ate: string };
      investimento: number; leads: number; custoPorLead: number | null; fechados: number; custoPorContrato: number | null;
      canais: CanalResumo[];
      diario: { dia: string; gasto: number; leads: number }[];
      frescor: { google: string | null; openai: string | null };
    }
    ```
  - Rota: `GET /api/crm/marketing/resumo?de=YYYY-MM-DD&ate=YYYY-MM-DD` (padrão: últimos 30 dias).

- [ ] **Step 1: Teste**

```ts
import { MarketingResumoService } from './marketing-resumo.service';

function montar(ads: any[], leads: any[]) {
  const prisma: any = {
    crm_Anuncios_Diario: {
      findMany: jest.fn(async () => ads),
      aggregate: jest.fn(async ({ where }: any) => ({
        _max: { atualizado_em: ads.filter((a) => a.plataforma === where.plataforma).length ? new Date('2026-09-27T10:00:00Z') : null },
      })),
    },
    crm_Leads: { findMany: jest.fn(async () => leads) },
  };
  return new MarketingResumoService(prisma);
}

const de = new Date('2026-09-01T00:00:00Z');
const ate = new Date('2026-09-30T23:59:59Z');

describe('MarketingResumoService', () => {
  it('soma por canal e calcula custo por lead e por contrato', async () => {
    const svc = montar(
      [
        { plataforma: 'google', dia: new Date('2026-09-10'), impressoes: 100, cliques: 10, gasto: 40, conversoes: 2 },
        { plataforma: 'google', dia: new Date('2026-09-11'), impressoes: 100, cliques: 10, gasto: 60, conversoes: 1 },
        { plataforma: 'openai', dia: new Date('2026-09-10'), impressoes: 50, cliques: 0, gasto: 0, conversoes: 0 },
      ],
      [
        { origem: 'google', status: 'fechado', criado_em: new Date('2026-09-10T12:00:00Z') },
        { origem: 'google', status: 'novo', criado_em: new Date('2026-09-11T12:00:00Z') },
        { origem: 'organico', status: 'novo', criado_em: new Date('2026-09-11T13:00:00Z') },
      ],
    );
    const r = await svc.resumo(de, ate);
    expect(r.investimento).toBe(100);
    expect(r.leads).toBe(3);
    expect(r.custoPorLead).toBeCloseTo(33.33, 2);
    expect(r.fechados).toBe(1);
    expect(r.custoPorContrato).toBe(100);
    const g = r.canais.find((c) => c.canal === 'google')!;
    expect(g).toEqual(expect.objectContaining({ impressoes: 200, cliques: 20, gasto: 100, leads: 2, custoPorLead: 50, fechados: 1 }));
    expect(g.ctr).toBeCloseTo(0.1);
    const o = r.canais.find((c) => c.canal === 'openai')!;
    expect(o.custoPorLead).toBeNull();
    const org = r.canais.find((c) => c.canal === 'organico')!;
    expect(org.gasto).toBeNull();
    expect(r.diario.find((d) => d.dia === '2026-09-11')).toEqual({ dia: '2026-09-11', gasto: 60, leads: 2 });
    expect(r.frescor.google).toBe('2026-09-27T10:00:00.000Z');
  });

  it('sem leads nem gasto não divide por zero', async () => {
    const r = await montar([], []).resumo(de, ate);
    expect(r.custoPorLead).toBeNull();
    expect(r.custoPorContrato).toBeNull();
    expect(r.frescor).toEqual({ google: null, openai: null });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx nx test api --testFile=marketing-resumo.service.spec.ts`
Expected: FAIL (módulo não encontrado)

- [ ] **Step 3: Implementar**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Canal = 'google' | 'openai' | 'instagram' | 'organico';
const CANAIS: Canal[] = ['google', 'openai', 'instagram', 'organico'];
const PAGOS: Canal[] = ['google', 'openai'];

export interface CanalResumo {
  canal: Canal;
  impressoes: number | null;
  cliques: number | null;
  ctr: number | null;
  gasto: number | null;
  conversoesPlataforma: number | null;
  leads: number;
  custoPorLead: number | null;
  fechados: number;
}

export interface ResumoMarketing {
  periodo: { de: string; ate: string };
  investimento: number;
  leads: number;
  custoPorLead: number | null;
  fechados: number;
  custoPorContrato: number | null;
  canais: CanalResumo[];
  diario: { dia: string; gasto: number; leads: number }[];
  frescor: { google: string | null; openai: string | null };
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const dia = (d: Date) => new Date(d).toISOString().slice(0, 10);

@Injectable()
export class MarketingResumoService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(de: Date, ate: Date): Promise<ResumoMarketing> {
    const deDia = new Date(`${dia(de)}T00:00:00.000Z`);
    const ateDia = new Date(`${dia(ate)}T00:00:00.000Z`);
    const [ads, leads, fg, fo] = await Promise.all([
      this.prisma.crm_Anuncios_Diario.findMany({ where: { dia: { gte: deDia, lte: ateDia } } }),
      this.prisma.crm_Leads.findMany({ where: { criado_em: { gte: de, lte: ate } }, select: { origem: true, status: true, criado_em: true } }),
      this.prisma.crm_Anuncios_Diario.aggregate({ where: { plataforma: 'google' }, _max: { atualizado_em: true } }),
      this.prisma.crm_Anuncios_Diario.aggregate({ where: { plataforma: 'openai' }, _max: { atualizado_em: true } }),
    ]);

    const canais: CanalResumo[] = CANAIS.map((canal) => {
      const doCanal = leads.filter((l: any) => l.origem === canal);
      const fechados = doCanal.filter((l: any) => l.status === 'fechado').length;
      if (!PAGOS.includes(canal)) {
        return { canal, impressoes: null, cliques: null, ctr: null, gasto: null, conversoesPlataforma: null, leads: doCanal.length, custoPorLead: null, fechados };
      }
      const linhas = ads.filter((a: any) => a.plataforma === canal);
      const impressoes = linhas.reduce((s: number, a: any) => s + Number(a.impressoes), 0);
      const cliques = linhas.reduce((s: number, a: any) => s + Number(a.cliques), 0);
      const gasto = linhas.reduce((s: number, a: any) => s + Number(a.gasto), 0);
      const conversoes = linhas.reduce((s: number, a: any) => s + Number(a.conversoes), 0);
      return {
        canal, impressoes, cliques, ctr: div(cliques, impressoes), gasto, conversoesPlataforma: conversoes,
        leads: doCanal.length, custoPorLead: div(gasto, doCanal.length), fechados,
      };
    });

    const investimento = canais.reduce((s, c) => s + (c.gasto ?? 0), 0);
    const fechados = leads.filter((l: any) => l.status === 'fechado').length;

    const porDia = new Map<string, { gasto: number; leads: number }>();
    for (const a of ads as any[]) {
      const k = dia(a.dia);
      const v = porDia.get(k) ?? { gasto: 0, leads: 0 };
      v.gasto += Number(a.gasto);
      porDia.set(k, v);
    }
    for (const l of leads as any[]) {
      const k = dia(l.criado_em);
      const v = porDia.get(k) ?? { gasto: 0, leads: 0 };
      v.leads += 1;
      porDia.set(k, v);
    }

    return {
      periodo: { de: dia(de), ate: dia(ate) },
      investimento,
      leads: leads.length,
      custoPorLead: div(investimento, leads.length),
      fechados,
      custoPorContrato: div(investimento, fechados),
      canais,
      diario: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ dia: d, ...v })),
      frescor: {
        google: fg._max.atualizado_em ? new Date(fg._max.atualizado_em).toISOString() : null,
        openai: fo._max.atualizado_em ? new Date(fo._max.atualizado_em).toISOString() : null,
      },
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx nx test api --testFile=marketing-resumo.service.spec.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Rota e provider**

Em `marketing-crm.controller.ts`, injetar `MarketingResumoService` (construtor: `constructor(private readonly leads: MarketingLeadsService, private readonly resumoSvc: MarketingResumoService) {}`) e acrescentar:

```ts
  @Get('resumo')
  resumo(@Query('de') de?: string, @Query('ate') ate?: string) {
    const fim = data(ate) ?? new Date();
    const inicio = data(de) ?? new Date(fim.getTime() - 29 * 24 * 60 * 60 * 1000);
    fim.setUTCHours(23, 59, 59, 999);
    return this.resumoSvc.resumo(inicio, fim);
  }
```

Adicionar `MarketingResumoService` em `providers` do módulo.

- [ ] **Step 6: Build + todos os testes do módulo**

Run: `npx nx build api && npx nx test api --testPathPattern=marketing`
Expected: build ok; 4 suítes PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app/marketing
git commit -m "feat(crm-marketing): resumo de investimento, leads e custo por canal"
```

---

### Task 6: Landing grava o lead

**Files:**
- Modify: `apps/portaria-web/public/sobre/index.html` (bloco `<script>` do `<head>` com `psConversaoOrcamento`; método `enviar`)

**Interfaces:**
- Consumes: `POST https://api.prestarecondominios.com.br/api/public/leads` (Task 3). CORS já libera `https://www.prestarecondominios.com.br` (`apps/api/src/app/common/cors-origins.ts`).
- Produces: `window.psRegistrarLead(dados: {nome, condominio, unidades, whatsapp}): void`.

- [ ] **Step 1: Captura de origem e envio**

No `<script>` do head (logo após `window.psConversaoOrcamento = ...`), adicionar:

```js
  // Origem do lead: parâmetros dos anúncios guardados na chegada, para não se
  // perderem se a pessoa navegar pela página antes de pedir orçamento.
  (function () {
    try {
      var q = new URLSearchParams(location.search);
      var chaves = ['gclid', 'oppref', 'utm_source', 'utm_medium', 'utm_campaign'];
      var salvo = JSON.parse(sessionStorage.getItem('psOrigem') || '{}');
      chaves.forEach(function (k) { if (q.get(k)) salvo[k] = q.get(k); });
      sessionStorage.setItem('psOrigem', JSON.stringify(salvo));
    } catch (e) {}
  })();
  window.psRegistrarLead = function (dados) {
    try {
      var origem = {};
      try { origem = JSON.parse(sessionStorage.getItem('psOrigem') || '{}'); } catch (e) {}
      var api = location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://api.prestarecondominios.com.br';
      // keepalive: a requisição sobrevive à abertura do WhatsApp em outra aba.
      fetch(api + '/api/public/leads', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, dados, origem, { pagina: location.pathname })),
      }).catch(function () {});
    } catch (e) {}
  };
```

- [ ] **Step 2: Chamar no envio do formulário**

Em `enviar`, logo antes de `if (window.psConversaoOrcamento) window.psConversaoOrcamento();`:

```js
    if (window.psRegistrarLead) window.psRegistrarLead({
      nome: String(f.get("nome") || ""),
      condominio: String(f.get("condominio") || ""),
      unidades: unidadesBruto,
      whatsapp: String(f.get("contato") || ""),
    });
```

- [ ] **Step 3: Teste manual local**

Subir a API local (`npx nx serve api`) e servir a pasta: `cd apps/portaria-web/public && python -m http.server 8765`. Abrir `http://localhost:8765/sobre/?gclid=teste`, enviar o formulário.
Expected: aba de rede mostra `POST http://localhost:3000/api/public/leads` → 204; `SELECT origem FROM crm_leads ORDER BY id DESC LIMIT 1` → `google` (só se a API local apontar para um banco de teste; se `DATABASE_URL` for produção, pular a checagem de banco e apagar o registro de teste depois).

- [ ] **Step 4: Commit**

```bash
git add apps/portaria-web/public/sobre/index.html
git commit -m "feat(sobre): grava pedido de orcamento no CRM com a origem do anuncio"
```

---

### Task 7: Google Ads Script

**Files:**
- Create: `docs/marketing/google-ads-script.js`

**Interfaces:**
- Consumes: `POST /api/public/ads/google` com `X-Ingest-Token` e `{ rows: LinhaAnuncio[] }` (Task 4).

- [ ] **Step 1: Escrever o script**

```js
/**
 * Prestare — envia os números das campanhas para o CRM (aba Marketing).
 * Instalar em Google Ads → Ferramentas → Ações em massa → Scripts → +,
 * colar este arquivo, preencher TOKEN, autorizar e agendar "Diariamente".
 * Envia os últimos 7 dias (o upsert no CRM torna o reenvio inofensivo).
 */
var URL = 'https://api.prestarecondominios.com.br/api/public/ads/google';
var TOKEN = 'COLE_AQUI_O_ADS_INGEST_TOKEN';

function main() {
  var query =
    'SELECT campaign.id, campaign.name, segments.date, metrics.impressions, ' +
    'metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM campaign WHERE segments.date DURING LAST_7_DAYS';
  var rows = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      campanha_id: String(r.campaign.id),
      campanha_nome: r.campaign.name,
      dia: r.segments.date,
      impressoes: Number(r.metrics.impressions || 0),
      cliques: Number(r.metrics.clicks || 0),
      gasto: Number(r.metrics.costMicros || 0) / 1e6,
      conversoes: Number(r.metrics.conversions || 0),
    });
  }
  var resp = UrlFetchApp.fetch(URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Ingest-Token': TOKEN },
    payload: JSON.stringify({ rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log('CRM respondeu ' + resp.getResponseCode() + ': ' + resp.getContentText());
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/marketing/google-ads-script.js
git commit -m "docs(marketing): Google Ads Script que alimenta o CRM"
```

---

### Task 8: Aba Marketing no CRM

**Files:**
- Create: `apps/crm-web/src/app/crm/marketing.service.ts`
- Create: `apps/crm-web/src/app/crm/tabs/crm-marketing.component.ts`
- Create: `apps/crm-web/src/app/crm/tabs/crm-marketing.component.html`
- Modify: `apps/crm-web/src/app/app.routes.ts` (filho `marketing` de `painel`)
- Modify: `apps/crm-web/src/app/crm/crm-page.component.ts` (item em `navItens`, depois de `relatorios`)

**Interfaces:**
- Consumes: `GET /api/crm/marketing/resumo`, `GET /api/crm/marketing/leads`, `PATCH /api/crm/marketing/leads/:id` (Tasks 3 e 5). Tipos espelham `ResumoMarketing`, `CanalResumo`, `LeadDto`.
- Produces: rota `/painel/marketing`.

- [ ] **Step 1: Serviço HTTP**

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

export type Canal = 'google' | 'openai' | 'instagram' | 'organico';
export type LeadStatus = 'novo' | 'em_contato' | 'proposta' | 'fechado' | 'perdido';

export interface CanalResumo {
  canal: Canal; impressoes: number | null; cliques: number | null; ctr: number | null; gasto: number | null;
  conversoesPlataforma: number | null; leads: number; custoPorLead: number | null; fechados: number;
}
export interface ResumoMarketing {
  periodo: { de: string; ate: string };
  investimento: number; leads: number; custoPorLead: number | null; fechados: number; custoPorContrato: number | null;
  canais: CanalResumo[];
  diario: { dia: string; gasto: number; leads: number }[];
  frescor: { google: string | null; openai: string | null };
}
export interface Lead {
  id: number; nome: string; condominio: string; unidades: string; whatsapp: string; origem: Canal;
  status: LeadStatus; observacao: string | null; criadoEm: string; statusEm: string | null;
}

@Injectable({ providedIn: 'root' })
export class MarketingApi {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/marketing`;

  resumo(de: string, ate: string): Observable<ResumoMarketing> {
    return this.http.get<ResumoMarketing>(`${this.base}/resumo`, { params: { de, ate } });
  }
  leads(f: { de: string; ate: string; status?: string; origem?: string }): Observable<Lead[]> {
    const params: Record<string, string> = { de: f.de, ate: f.ate };
    if (f.status) params['status'] = f.status;
    if (f.origem) params['origem'] = f.origem;
    return this.http.get<Lead[]>(`${this.base}/leads`, { params });
  }
  atualizar(id: number, p: { status?: LeadStatus; observacao?: string }): Observable<Lead> {
    return this.http.patch<Lead>(`${this.base}/leads/${id}`, p);
  }
}
```

- [ ] **Step 2: Componente**

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ToastService } from '../../shared/toast.service';
import { Canal, Lead, LeadStatus, MarketingApi, ResumoMarketing } from '../marketing.service';

type Periodo = '7d' | '30d' | 'mes' | 'custom';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Aba Marketing: quanto as campanhas custam, quantos pedidos de orçamento
 * geram e quantos viram contrato. Leads vêm do formulário da landing; números
 * de anúncio vêm do Google Ads Script (diário) e da OpenAI Ads API (horário).
 */
@Component({
  selector: 'crm-marketing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-marketing.component.html',
})
export class CrmMarketingComponent implements OnInit {
  private api = inject(MarketingApi);
  private toast = inject(ToastService);

  readonly periodo = signal<Periodo>('30d');
  readonly de = signal(iso(new Date(Date.now() - 29 * 864e5)));
  readonly ate = signal(iso(new Date()));
  readonly filtroStatus = signal<'' | LeadStatus>('');
  readonly filtroOrigem = signal<'' | Canal>('');

  readonly carregando = signal(false);
  readonly resumo = signal<ResumoMarketing | null>(null);
  readonly leads = signal<Lead[]>([]);
  readonly selecionado = signal<Lead | null>(null);
  observacaoEdit = '';
  readonly salvando = signal(false);

  readonly statusOpcoes: { valor: LeadStatus; label: string }[] = [
    { valor: 'novo', label: 'Novo' },
    { valor: 'em_contato', label: 'Em contato' },
    { valor: 'proposta', label: 'Proposta enviada' },
    { valor: 'fechado', label: 'Fechado' },
    { valor: 'perdido', label: 'Perdido' },
  ];
  readonly canalLabel: Record<Canal, string> = { google: 'Google Ads', openai: 'OpenAI Ads', instagram: 'Instagram', organico: 'Orgânico' };
  readonly canalCor: Record<Canal, string> = {
    google: 'bg-blue-50 text-blue-700', openai: 'bg-emerald-50 text-emerald-700',
    instagram: 'bg-pink-50 text-pink-700', organico: 'bg-slate-100 text-slate-600',
  };

  readonly maxDiario = computed(() => {
    const d = this.resumo()?.diario ?? [];
    return { gasto: Math.max(1, ...d.map((x) => x.gasto)), leads: Math.max(1, ...d.map((x) => x.leads)) };
  });

  readonly avisosFrescor = computed(() => {
    const f = this.resumo()?.frescor;
    if (!f) return [];
    const limite = Date.now() - 36 * 3600e3;
    const out: string[] = [];
    if (!f.google || Date.parse(f.google) < limite) out.push('Google Ads sem atualização há mais de 36 h — confira o script na conta.');
    if (!f.openai || Date.parse(f.openai) < limite) out.push('OpenAI Ads sem atualização há mais de 36 h — confira OPENAI_ADS_API_KEY.');
    return out;
  });

  ngOnInit() {
    this.carregar();
  }

  escolherPeriodo(p: Periodo) {
    this.periodo.set(p);
    const hoje = new Date();
    if (p === '7d') this.de.set(iso(new Date(Date.now() - 6 * 864e5)));
    if (p === '30d') this.de.set(iso(new Date(Date.now() - 29 * 864e5)));
    if (p === 'mes') this.de.set(iso(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))));
    if (p !== 'custom') this.ate.set(iso(hoje));
    if (p !== 'custom') this.carregar();
  }

  carregar() {
    this.carregando.set(true);
    forkJoin({
      resumo: this.api.resumo(this.de(), this.ate()),
      leads: this.api.leads({ de: this.de(), ate: `${this.ate()}T23:59:59`, status: this.filtroStatus() || undefined, origem: this.filtroOrigem() || undefined }),
    }).subscribe({
      next: ({ resumo, leads }) => {
        this.resumo.set(resumo);
        this.leads.set(leads);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.toast.error?.('Não foi possível carregar o marketing.');
      },
    });
  }

  abrir(l: Lead) {
    this.selecionado.set(l);
    this.observacaoEdit = l.observacao ?? '';
  }

  fechar() {
    this.selecionado.set(null);
  }

  salvar(p: { status?: LeadStatus; observacao?: string }) {
    const l = this.selecionado();
    if (!l) return;
    this.salvando.set(true);
    this.api.atualizar(l.id, p).subscribe({
      next: (novo) => {
        this.leads.update((ls) => ls.map((x) => (x.id === novo.id ? novo : x)));
        this.selecionado.set(novo);
        this.salvando.set(false);
        this.carregarResumo();
      },
      error: () => {
        this.salvando.set(false);
        this.toast.error?.('Não foi possível salvar o lead.');
      },
    });
  }

  private carregarResumo() {
    this.api.resumo(this.de(), this.ate()).subscribe((r) => this.resumo.set(r));
  }

  linkWhatsapp(l: Lead): string {
    const num = l.whatsapp.startsWith('55') ? l.whatsapp : `55${l.whatsapp}`;
    const msg = `Olá, ${l.nome}! Aqui é da Prestare Gestão, sobre o orçamento do ${l.condominio}.`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  statusLabel(s: LeadStatus) {
    return this.statusOpcoes.find((o) => o.valor === s)?.label ?? s;
  }

  brl(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  num(v: number | null | undefined): string {
    return v == null ? '—' : v.toLocaleString('pt-BR');
  }

  pct(v: number | null | undefined): string {
    return v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`;
  }

  tempo(isoStr: string | null | undefined): string {
    if (!isoStr) return 'nunca';
    const h = Math.round((Date.now() - Date.parse(isoStr)) / 3600e3);
    return h < 1 ? 'há menos de 1 h' : `há ${h} h`;
  }
}
```

Antes de salvar, abrir `apps/crm-web/src/app/shared/toast.service.ts` e usar o nome real do método de erro (por exemplo `error`, `erro` ou `show(..., 'error')`), removendo o `?.`.

- [ ] **Step 3: Template**

```html
<div class="space-y-6">
  <!-- Período -->
  <div class="flex flex-wrap items-center gap-2">
    @for (p of [['7d','7 dias'],['30d','30 dias'],['mes','Mês atual'],['custom','Personalizado']]; track p[0]) {
      <button type="button" (click)="escolherPeriodo($any(p[0]))"
        class="rounded-full px-4 py-1.5 text-sm"
        [class]="periodo() === p[0] ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'">{{ p[1] }}</button>
    }
    @if (periodo() === 'custom') {
      <input type="date" class="rounded-lg border px-2 py-1 text-sm" [ngModel]="de()" (ngModelChange)="de.set($event)">
      <input type="date" class="rounded-lg border px-2 py-1 text-sm" [ngModel]="ate()" (ngModelChange)="ate.set($event)">
      <button type="button" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white" (click)="carregar()">Aplicar</button>
    }
  </div>

  @for (a of avisosFrescor(); track a) {
    <div class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{{ a }}</div>
  }

  <!-- KPIs -->
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-3xl bg-white p-6"><p class="text-sm text-slate-500">Investimento</p><p class="mt-2 text-3xl font-bold">{{ brl(resumo()?.investimento) }}</p><p class="mt-1 text-xs text-slate-400">Google + OpenAI no período</p></div>
    <div class="rounded-3xl bg-white p-6"><p class="text-sm text-slate-500">Leads</p><p class="mt-2 text-3xl font-bold">{{ num(resumo()?.leads) }}</p><p class="mt-1 text-xs text-slate-400">Pedidos de orçamento</p></div>
    <div class="rounded-3xl bg-white p-6"><p class="text-sm text-slate-500">Custo por lead</p><p class="mt-2 text-3xl font-bold">{{ brl(resumo()?.custoPorLead) }}</p><p class="mt-1 text-xs text-slate-400">Investimento ÷ leads</p></div>
    <div class="rounded-3xl bg-white p-6"><p class="text-sm text-slate-500">Contratos fechados</p><p class="mt-2 text-3xl font-bold">{{ num(resumo()?.fechados) }}</p><p class="mt-1 text-xs text-slate-400">Custo por contrato: {{ brl(resumo()?.custoPorContrato) }}</p></div>
  </div>

  <!-- Por canal -->
  <div class="rounded-3xl bg-white p-6">
    <h3 class="text-lg font-semibold">Por canal</h3>
    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[720px] text-sm">
        <thead class="text-left text-slate-500"><tr>
          <th class="py-2">Canal</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>Gasto</th><th>Leads</th><th>Custo/lead</th><th>Fechados</th>
        </tr></thead>
        <tbody>
          @for (c of resumo()?.canais ?? []; track c.canal) {
            <tr class="border-t">
              <td class="py-2"><span class="rounded-full px-2 py-0.5 text-xs" [class]="canalCor[c.canal]">{{ canalLabel[c.canal] }}</span></td>
              <td>{{ num(c.impressoes) }}</td><td>{{ num(c.cliques) }}</td><td>{{ pct(c.ctr) }}</td>
              <td>{{ brl(c.gasto) }}</td><td>{{ c.leads }}</td><td>{{ brl(c.custoPorLead) }}</td><td>{{ c.fechados }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  </div>

  <!-- Diário -->
  <div class="rounded-3xl bg-white p-6">
    <h3 class="text-lg font-semibold">Gasto e leads por dia</h3>
    @if ((resumo()?.diario ?? []).length === 0) {
      <p class="mt-4 text-sm text-slate-500">Sem dados no período.</p>
    } @else {
      <div class="mt-4 flex h-40 items-end gap-1 overflow-x-auto">
        @for (d of resumo()!.diario; track d.dia) {
          <div class="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-0.5" [title]="d.dia + ' · ' + brl(d.gasto) + ' · ' + d.leads + ' lead(s)'">
            <div class="w-full rounded-t bg-emerald-500" [style.height.%]="(d.leads / maxDiario().leads) * 45"></div>
            <div class="w-full rounded-t bg-slate-300" [style.height.%]="(d.gasto / maxDiario().gasto) * 55"></div>
          </div>
        }
      </div>
      <p class="mt-2 text-xs text-slate-500"><span class="inline-block h-2 w-2 rounded bg-slate-300"></span> gasto · <span class="inline-block h-2 w-2 rounded bg-emerald-500"></span> leads</p>
    }
  </div>

  <!-- Leads -->
  <div class="rounded-3xl bg-white p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg font-semibold">Leads</h3>
      <div class="flex gap-2">
        <select class="rounded-lg border px-2 py-1 text-sm" [ngModel]="filtroStatus()" (ngModelChange)="filtroStatus.set($event); carregar()">
          <option value="">Todos os status</option>
          @for (s of statusOpcoes; track s.valor) { <option [value]="s.valor">{{ s.label }}</option> }
        </select>
        <select class="rounded-lg border px-2 py-1 text-sm" [ngModel]="filtroOrigem()" (ngModelChange)="filtroOrigem.set($event); carregar()">
          <option value="">Todas as origens</option>
          <option value="google">Google Ads</option><option value="openai">OpenAI Ads</option>
          <option value="instagram">Instagram</option><option value="organico">Orgânico</option>
        </select>
      </div>
    </div>
    @if (leads().length === 0) {
      <p class="mt-4 text-sm text-slate-500">Nenhum pedido de orçamento no período.</p>
    } @else {
      <div class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm">
          <thead class="text-left text-slate-500"><tr><th class="py-2">Data</th><th>Nome</th><th>Condomínio</th><th>Unidades</th><th>Origem</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (l of leads(); track l.id) {
              <tr class="cursor-pointer border-t hover:bg-slate-50" [class.font-semibold]="l.status === 'novo'" (click)="abrir(l)">
                <td class="py-2">{{ l.criadoEm | date: 'dd/MM HH:mm' }}</td>
                <td>{{ l.nome }}</td><td>{{ l.condominio }}</td><td>{{ l.unidades }}</td>
                <td><span class="rounded-full px-2 py-0.5 text-xs" [class]="canalCor[l.origem]">{{ canalLabel[l.origem] }}</span></td>
                <td>{{ statusLabel(l.status) }}</td>
                <td><a [href]="linkWhatsapp(l)" target="_blank" rel="noopener" (click)="$event.stopPropagation()" class="text-emerald-700 hover:underline">WhatsApp</a></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  </div>

  <p class="text-xs text-slate-400">Google atualizado {{ tempo(resumo()?.frescor?.google) }} · OpenAI atualizado {{ tempo(resumo()?.frescor?.openai) }}</p>
</div>

<!-- Painel lateral do lead -->
@if (selecionado(); as l) {
  <div class="fixed inset-0 z-40 bg-black/30" (click)="fechar()"></div>
  <aside class="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
    <div class="flex items-start justify-between">
      <div><h3 class="text-xl font-semibold">{{ l.nome }}</h3><p class="text-sm text-slate-500">{{ l.condominio }} · {{ l.unidades }}</p></div>
      <button type="button" class="text-slate-400 hover:text-slate-700" (click)="fechar()" aria-label="Fechar">✕</button>
    </div>
    <dl class="mt-4 space-y-2 text-sm">
      <div><dt class="text-slate-500">WhatsApp</dt><dd><a [href]="linkWhatsapp(l)" target="_blank" rel="noopener" class="text-emerald-700 hover:underline">{{ l.whatsapp }}</a></dd></div>
      <div><dt class="text-slate-500">Origem</dt><dd>{{ canalLabel[l.origem] }}</dd></div>
      <div><dt class="text-slate-500">Recebido em</dt><dd>{{ l.criadoEm | date: 'dd/MM/yyyy HH:mm' }}</dd></div>
    </dl>
    <p class="mt-6 text-sm font-medium">Status</p>
    <div class="mt-2 flex flex-wrap gap-2">
      @for (s of statusOpcoes; track s.valor) {
        <button type="button" [disabled]="salvando()" (click)="salvar({ status: s.valor })"
          class="rounded-full px-3 py-1 text-sm"
          [class]="l.status === s.valor ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'">{{ s.label }}</button>
      }
    </div>
    <p class="mt-6 text-sm font-medium">Observação</p>
    <textarea class="mt-2 h-32 w-full rounded-xl border p-3 text-sm" [(ngModel)]="observacaoEdit"></textarea>
    <button type="button" class="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50" [disabled]="salvando()" (click)="salvar({ observacao: observacaoEdit })">Salvar observação</button>
  </aside>
}
```

(Se o projeto ainda não usa `@for`/`@if` — Angular < 17 —, trocar por `*ngFor`/`*ngIf`. Conferir em `crm-chamados.component.html`.)

- [ ] **Step 4: Rota e item de navegação**

Em `app.routes.ts`, depois do filho `relatorios`:

```ts
          {
            path: 'marketing',
            loadComponent: () => import('./crm/tabs/crm-marketing.component').then((m) => m.CrmMarketingComponent),
          },
```

Em `crm-page.component.ts`, depois do item `relatorios` em `navItens`:

```ts
    {
      rota: 'marketing',
      label: 'Marketing',
      labelCurto: 'Marketing',
      icone: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
    },
```

- [ ] **Step 5: Build do CRM**

Run: `npx nx build crm-web`
Expected: sem erro.

- [ ] **Step 6: Conferência visual**

Run: `npx nx serve crm-web` (proxy para a API local), entrar como admin, abrir `/painel/marketing`.
Expected: aba aparece no menu; KPIs, tabela por canal, gráfico e lista renderizam (vazios sem dados); clicar num lead abre o painel e trocar status persiste.

- [ ] **Step 7: Commit**

```bash
git add apps/crm-web/src/app
git commit -m "feat(crm-web): aba Marketing com leads, canais e custo por lead"
```

---

### Task 9: Produção — SQL, envs, deploy, script e verificação

**Files:** nenhum de código (operacional).

- [ ] **Step 1: Aplicar o SQL no banco de produção**

Com `DATABASE_URL` do `.env` (produção), executar `prisma/migrations-manual/2026-09-28-crm-marketing.sql` (ex.: `npx prisma db execute --file prisma/migrations-manual/2026-09-28-crm-marketing.sql --schema prisma/schema.prisma`).
Verificar: `SHOW TABLES LIKE 'crm_%'` lista `crm_leads` e `crm_anuncios_diario`.

- [ ] **Step 2: Variáveis no Elastic Beanstalk**

Gerar `ADS_INGEST_TOKEN` (`openssl rand -hex 24`) e configurar no ambiente da API junto com `OPENAI_ADS_API_KEY` (criada em ads.openai.com → Configurações). Atenção ao limite de 4096 caracteres das env vars do EB (update falha em silêncio) — conferir depois com `aws elasticbeanstalk describe-configuration-settings`.

- [ ] **Step 3: Merge e push**

Merge de `feat/crm-marketing` em `master`, push para `master` e `main`. Acompanhar `gh run list` até o deploy da API concluir (se colidirem, `gh workflow run deploy-api.yml`).

- [ ] **Step 4: Verificar**

- `curl -X POST https://api.prestarecondominios.com.br/api/public/ads/google -H 'X-Ingest-Token: errado' -H 'Content-Type: application/json' -d '{"rows":[]}'` → 401.
- Logs da API: "Sync OpenAI Ads" sem erro em ~2 min; conferir `SELECT * FROM crm_anuncios_diario WHERE plataforma='openai'` e ajustar nomes de campo no `OpenAiAdsClient` se vier vazio.
- Enviar um orçamento de teste pela landing com `?gclid=teste` → aparece no CRM como Google; depois marcar como "perdido".

- [ ] **Step 5: Instalar o Google Ads Script**

Google Ads → Ferramentas → Ações em massa → Scripts → novo; colar `docs/marketing/google-ads-script.js` com o token; autorizar; "Visualizar" (deve logar `CRM respondeu 200`); agendar diariamente.
