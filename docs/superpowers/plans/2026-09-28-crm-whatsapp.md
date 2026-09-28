# CRM — Caixa de WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber e responder o WhatsApp comercial (+55 17 99660-8148, Cloud API) dentro do CRM, com cada conversa ligada a um lead.

**Architecture:** Webhook público no NestJS (assinatura HMAC do Meta) grava conversas/mensagens no MySQL; controller do CRM lista, marca como lidas e envia pela Graph API; aba Angular nova faz polling de 10s.

**Tech Stack:** NestJS 11, Prisma 6 (MySQL), Angular (standalone + signals + Tailwind), Jest.

**Spec:** `docs/superpowers/specs/2026-09-28-crm-whatsapp-design.md`

## Global Constraints

- Monorepo em `click-cond-web/`; todos os caminhos abaixo são relativos a ele.
- `DATABASE_URL` do `.env` é **produção**: SQL manual aplicado antes do push; nunca `prisma db push`/`migrate`.
- Segredos nunca no código nem no chat; ficam cifrados em `crm_config` (via `MarketingSegredosService`).
- CI roda `npx nx typecheck api` (estrito: sem imports não usados).
- Testes: `npx jest -c apps/api/jest.config.cts apps/api/src/app/whatsapp`.
- Graph API versão `v25.0`; phone id `1356887267509002`; WABA `1804931620699472`.
- Janela de resposta livre: 24h desde a última mensagem do cliente.
- Junção com lead: clique `Clique no WhatsApp%` sem número, nos últimos 30 min.
- Push em `master` **e** `main`.

---

### Task 1: Dados, corpo bruto e segredos

**Files:**
- Create: `prisma/manual_2026-09_crm_whatsapp.sql`
- Modify: `prisma/schema.prisma` (após `model Crm_Leads`, e back-relation dentro dele)
- Modify: `apps/api/src/main.ts:47` (json com `verify`)
- Modify: `apps/api/src/app/marketing/marketing-segredos.service.ts:5`
- Modify: `apps/api/src/app/marketing/marketing.module.ts:22` (exportar segredos)

**Interfaces:**
- Produces: models Prisma `crm_WhatsApp_Conversas` / `crm_WhatsApp_Mensagens`; `req.rawBody: Buffer` nas rotas `/api/public/whatsapp/*`; `SegredoMarketing` inclui `'WA_ACCESS_TOKEN' | 'WA_APP_SECRET' | 'WA_VERIFY_TOKEN'`; `MarketingModule` exporta `MarketingSegredosService`.

- [ ] **Step 1: SQL manual**

```sql
CREATE TABLE crm_whatsapp_conversas (
  id INT NOT NULL AUTO_INCREMENT,
  wa_id VARCHAR(20) NOT NULL,
  nome_perfil VARCHAR(120) NULL,
  lead_id INT NULL,
  ultima_msg_em DATETIME NOT NULL,
  ultima_do_cliente_em DATETIME NULL,
  nao_lidas INT NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_wa_conversas_wa_id (wa_id),
  KEY idx_crm_wa_conversas_ultima (ultima_msg_em),
  CONSTRAINT fk_crm_wa_conversas_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_whatsapp_mensagens (
  id INT NOT NULL AUTO_INCREMENT,
  conversa_id INT NOT NULL,
  wamid VARCHAR(191) NOT NULL,
  direcao VARCHAR(10) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  texto TEXT NOT NULL,
  status VARCHAR(12) NOT NULL,
  erro VARCHAR(500) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_wa_mensagens_wamid (wamid),
  KEY idx_crm_wa_mensagens_conversa (conversa_id, criado_em),
  CONSTRAINT fk_crm_wa_mensagens_conversa FOREIGN KEY (conversa_id) REFERENCES crm_whatsapp_conversas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Prisma** — dentro de `model Crm_Leads` adicionar `conversas_whatsapp Crm_WhatsApp_Conversas[]`; depois dele:

```prisma
model Crm_WhatsApp_Conversas {
  id                   Int                      @id @default(autoincrement())
  wa_id                String                   @unique(map: "uq_crm_wa_conversas_wa_id") @db.VarChar(20)
  nome_perfil          String?                  @db.VarChar(120)
  lead_id              Int?
  lead                 Crm_Leads?               @relation(fields: [lead_id], references: [id], onDelete: SetNull, map: "fk_crm_wa_conversas_lead")
  ultima_msg_em        DateTime                 @db.DateTime(0)
  ultima_do_cliente_em DateTime?                @db.DateTime(0)
  nao_lidas            Int                      @default(0)
  criado_em            DateTime                 @default(now()) @db.DateTime(0)
  mensagens            Crm_WhatsApp_Mensagens[]

  @@index([ultima_msg_em], map: "idx_crm_wa_conversas_ultima")
  @@index([lead_id], map: "fk_crm_wa_conversas_lead")
  @@map("crm_whatsapp_conversas")
}

model Crm_WhatsApp_Mensagens {
  id          Int                    @id @default(autoincrement())
  conversa_id Int
  conversa    Crm_WhatsApp_Conversas @relation(fields: [conversa_id], references: [id], onDelete: Cascade, map: "fk_crm_wa_mensagens_conversa")
  wamid       String                 @unique(map: "uq_crm_wa_mensagens_wamid") @db.VarChar(191)
  direcao     String                 @db.VarChar(10)
  tipo        String                 @db.VarChar(20)
  texto       String                 @db.Text
  status      String                 @db.VarChar(12)
  erro        String?                @db.VarChar(500)
  criado_em   DateTime               @default(now()) @db.DateTime(0)

  @@index([conversa_id, criado_em], map: "idx_crm_wa_mensagens_conversa")
  @@map("crm_whatsapp_mensagens")
}
```

Run: `npx prisma generate` — Expected: sucesso.

- [ ] **Step 3: Corpo bruto** em `main.ts`, trocar `app.use(json({ limit: '50mb' }));` por:

```ts
  // O webhook do WhatsApp valida a assinatura HMAC sobre o corpo exato
  // recebido; só essas rotas guardam a cópia bruta.
  app.use(
    json({
      limit: '50mb',
      verify: (req: any, _res, buf) => {
        if (req.originalUrl?.startsWith('/api/public/whatsapp')) req.rawBody = buf;
      },
    }),
  );
```

- [ ] **Step 4: Segredos** — em `marketing-segredos.service.ts`:

```ts
export type SegredoMarketing =
  | 'ADS_INGEST_TOKEN'
  | 'OPENAI_ADS_API_KEY'
  | 'WA_ACCESS_TOKEN'
  | 'WA_APP_SECRET'
  | 'WA_VERIFY_TOKEN';
```

e em `marketing.module.ts`: `exports: [MarketingLeadsService, MarketingSegredosService],`.

- [ ] **Step 5: Verificar** — `npx nx typecheck api` → sucesso; `npx jest -c apps/api/jest.config.cts apps/api/src/app/marketing` → tudo passa.

- [ ] **Step 6: Commit** — `git add prisma apps/api/src/main.ts apps/api/src/app/marketing && git commit -m "feat(whatsapp): tabelas, corpo bruto do webhook e segredos"`

---

### Task 2: Funções puras (assinatura, parser, janela)

**Files:**
- Create: `apps/api/src/app/whatsapp/whatsapp-puro.ts`
- Test: `apps/api/src/app/whatsapp/whatsapp-puro.spec.ts`

**Interfaces:**
- Produces:
  - `assinaturaValida(corpo: Buffer | undefined, cabecalho: string | undefined, segredo: string | undefined): boolean`
  - `interface EntradaWa { wamid: string; waId: string; nomePerfil?: string; tipo: string; texto: string; em: Date }`
  - `interface StatusWa { wamid: string; status: 'enviada' | 'entregue' | 'lida' | 'falhou'; erro?: string }`
  - `interpretarWebhook(body: unknown): { mensagens: EntradaWa[]; status: StatusWa[] }`
  - `janelaAberta(ultimaDoCliente: Date | null, agora?: Date): boolean`
  - `statusAvanca(atual: string, novo: string): boolean`

- [ ] **Step 1: Testes**

```ts
import { createHmac } from 'crypto';
import { assinaturaValida, interpretarWebhook, janelaAberta, statusAvanca } from './whatsapp-puro';

describe('assinaturaValida', () => {
  const corpo = Buffer.from('{"a":1}');
  const assinar = (s: string) => 'sha256=' + createHmac('sha256', s).update(corpo).digest('hex');
  it('aceita HMAC correto', () => expect(assinaturaValida(corpo, assinar('seg'), 'seg')).toBe(true));
  it('recusa segredo errado', () => expect(assinaturaValida(corpo, assinar('outro'), 'seg')).toBe(false));
  it('recusa sem cabeçalho, corpo ou segredo', () => {
    expect(assinaturaValida(corpo, undefined, 'seg')).toBe(false);
    expect(assinaturaValida(undefined, assinar('seg'), 'seg')).toBe(false);
    expect(assinaturaValida(corpo, assinar('seg'), undefined)).toBe(false);
  });
});

describe('interpretarWebhook', () => {
  const env = (value: any) => ({ entry: [{ changes: [{ field: 'messages', value }] }] });
  it('texto com nome do perfil', () => {
    const r = interpretarWebhook(env({
      contacts: [{ wa_id: '5521999369814', profile: { name: 'Ana' } }],
      messages: [{ from: '5521999369814', id: 'wamid.1', timestamp: '1790600000', type: 'text', text: { body: 'Oi' } }],
    }));
    expect(r.mensagens).toEqual([{ wamid: 'wamid.1', waId: '5521999369814', nomePerfil: 'Ana', tipo: 'text', texto: 'Oi', em: new Date(1790600000 * 1000) }]);
  });
  it('mídia vira marcador', () => {
    const r = interpretarWebhook(env({ messages: [{ from: '55', id: 'w2', timestamp: '1', type: 'audio', audio: {} }] }));
    expect(r.mensagens[0].texto).toBe('[áudio recebido]');
  });
  it('status traduzido, com erro', () => {
    const r = interpretarWebhook(env({ statuses: [
      { id: 'w3', status: 'delivered' },
      { id: 'w4', status: 'failed', errors: [{ title: 'Re-engagement message' }] },
    ] }));
    expect(r.status).toEqual([{ wamid: 'w3', status: 'entregue' }, { wamid: 'w4', status: 'falhou', erro: 'Re-engagement message' }]);
  });
  it('corpo estranho não quebra', () => expect(interpretarWebhook(null)).toEqual({ mensagens: [], status: [] }));
});

describe('janelaAberta', () => {
  const agora = new Date('2026-09-28T12:00:00Z');
  it('23h atrás aberta', () => expect(janelaAberta(new Date('2026-09-27T13:00:00Z'), agora)).toBe(true));
  it('25h atrás fechada', () => expect(janelaAberta(new Date('2026-09-27T11:00:00Z'), agora)).toBe(false));
  it('sem mensagem do cliente fechada', () => expect(janelaAberta(null, agora)).toBe(false));
});

describe('statusAvanca', () => {
  it('só para frente', () => {
    expect(statusAvanca('enviada', 'entregue')).toBe(true);
    expect(statusAvanca('lida', 'entregue')).toBe(false);
    expect(statusAvanca('lida', 'falhou')).toBe(false);
    expect(statusAvanca('enviada', 'falhou')).toBe(true);
  });
});
```

- [ ] **Step 2:** Run `npx jest -c apps/api/jest.config.cts apps/api/src/app/whatsapp` → FAIL (módulo não existe).

- [ ] **Step 3: Implementação**

```ts
import { createHmac, timingSafeEqual } from 'crypto';

export interface EntradaWa { wamid: string; waId: string; nomePerfil?: string; tipo: string; texto: string; em: Date }
export interface StatusWa { wamid: string; status: 'enviada' | 'entregue' | 'lida' | 'falhou'; erro?: string }

const JANELA_MS = 24 * 60 * 60 * 1000;

export function assinaturaValida(corpo: Buffer | undefined, cabecalho: string | undefined, segredo: string | undefined): boolean {
  if (!corpo || !cabecalho || !segredo) return false;
  const esperado = Buffer.from('sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex'));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

const MARCADORES: Record<string, string> = {
  image: '[imagem recebida]', audio: '[áudio recebido]', video: '[vídeo recebido]',
  document: '[documento recebido]', sticker: '[figurinha recebida]', location: '[localização recebida]',
  contacts: '[contato recebido]',
};

function textoDe(m: any): string {
  if (m?.type === 'text') return String(m.text?.body ?? '');
  if (m?.type === 'button') return String(m.button?.text ?? '');
  if (m?.type === 'interactive') return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[resposta interativa]');
  return MARCADORES[m?.type] ?? `[${m?.type ?? 'mensagem'} recebida]`;
}

const STATUS: Record<string, StatusWa['status']> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

export function interpretarWebhook(body: unknown): { mensagens: EntradaWa[]; status: StatusWa[] } {
  const mensagens: EntradaWa[] = [];
  const status: StatusWa[] = [];
  const entries = Array.isArray((body as any)?.entry) ? (body as any).entry : [];
  for (const e of entries) {
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      const v = c?.value ?? {};
      const nomes = new Map<string, string>();
      for (const ct of Array.isArray(v.contacts) ? v.contacts : []) if (ct?.wa_id) nomes.set(String(ct.wa_id), String(ct.profile?.name ?? ''));
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (!m?.id || !m?.from) continue;
        const waId = String(m.from).replace(/\D/g, '');
        const nome = nomes.get(waId);
        mensagens.push({
          wamid: String(m.id), waId, ...(nome ? { nomePerfil: nome } : {}), tipo: String(m.type ?? 'desconhecido'),
          texto: textoDe(m), em: new Date(Number(m.timestamp) * 1000),
        });
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const st = STATUS[s?.status];
        if (!s?.id || !st) continue;
        const erro = s.errors?.[0]?.title ?? s.errors?.[0]?.message;
        status.push({ wamid: String(s.id), status: st, ...(st === 'falhou' && erro ? { erro: String(erro).slice(0, 500) } : {}) });
      }
    }
  }
  return { mensagens, status };
}

export function janelaAberta(ultimaDoCliente: Date | null, agora = new Date()): boolean {
  return !!ultimaDoCliente && agora.getTime() - ultimaDoCliente.getTime() < JANELA_MS;
}

const ORDEM: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

export function statusAvanca(atual: string, novo: string): boolean {
  if (novo === 'falhou') return atual === 'enviada';
  return (ORDEM[novo] ?? 0) > (ORDEM[atual] ?? 0);
}
```

- [ ] **Step 4:** Run jest → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(whatsapp): assinatura, parser do webhook e janela de 24h"`

---

### Task 3: Cliente da Graph API

**Files:**
- Create: `apps/api/src/app/whatsapp/whatsapp-graph.client.ts`
- Test: `apps/api/src/app/whatsapp/whatsapp-graph.client.spec.ts`

**Interfaces:**
- Consumes: `MarketingSegredosService.obter('WA_ACCESS_TOKEN')`.
- Produces: `class WhatsappGraphClient { enviarTexto(para: string, texto: string): Promise<string /* wamid */>; marcarLida(wamid: string): Promise<void> }` — `enviarTexto` lança `Error(mensagem do Graph)` em falha.

- [ ] **Step 1: Testes**

```ts
import { WhatsappGraphClient } from './whatsapp-graph.client';

describe('WhatsappGraphClient', () => {
  const segredos = { obter: jest.fn(async () => 'tok') } as any;
  afterEach(() => jest.restoreAllMocks());

  it('envia texto e devolve o wamid', async () => {
    const f = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) } as any);
    await expect(new WhatsappGraphClient(segredos).enviarTexto('5517999', 'Olá')).resolves.toBe('wamid.X');
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://graph.facebook.com/v25.0/1356887267509002/messages');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', to: '5517999', type: 'text', text: { body: 'Olá', preview_url: false } });
  });

  it('erro do Graph vira exceção com a mensagem', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Janela expirada' } }) } as any);
    await expect(new WhatsappGraphClient(segredos).enviarTexto('55', 'x')).rejects.toThrow('Janela expirada');
  });

  it('sem token não chama a API', async () => {
    const f = jest.spyOn(global, 'fetch' as any);
    await expect(new WhatsappGraphClient({ obter: async () => undefined } as any).enviarTexto('55', 'x')).rejects.toThrow('WA_ACCESS_TOKEN');
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** jest → FAIL.
- [ ] **Step 3: Implementação**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { MarketingSegredosService } from '../marketing/marketing-segredos.service';

const PHONE_ID = process.env.WA_PHONE_ID || '1356887267509002';
const BASE = `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`;

@Injectable()
export class WhatsappGraphClient {
  private readonly logger = new Logger(WhatsappGraphClient.name);

  constructor(private readonly segredos: MarketingSegredosService) {}

  private async post(corpo: object): Promise<any> {
    const token = await this.segredos.obter('WA_ACCESS_TOKEN');
    if (!token) throw new Error('WA_ACCESS_TOKEN não configurado');
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    });
    const json: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
    return json;
  }

  async enviarTexto(para: string, texto: string): Promise<string> {
    const json = await this.post({ to: para, type: 'text', text: { body: texto, preview_url: false } });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('Graph API não devolveu o id da mensagem');
    return String(id);
  }

  async marcarLida(wamid: string): Promise<void> {
    try {
      await this.post({ status: 'read', message_id: wamid });
    } catch (e: any) {
      this.logger.warn(`Falha ao marcar ${wamid} como lida: ${e?.message}`);
    }
  }
}
```

- [ ] **Step 4:** jest → PASS. **Step 5: Commit** — `feat(whatsapp): cliente da Graph API`

---

### Task 4: Serviço da caixa (entrada, status, lead, envio)

**Files:**
- Create: `apps/api/src/app/whatsapp/whatsapp-inbox.service.ts`
- Test: `apps/api/src/app/whatsapp/whatsapp-inbox.service.spec.ts`

**Interfaces:**
- Consumes: `EntradaWa`, `StatusWa`, `janelaAberta`, `statusAvanca` (Task 2); `WhatsappGraphClient` (Task 3); `PrismaService`.
- Produces:
  - `registrarEntrada(m: EntradaWa): Promise<void>`
  - `atualizarStatus(s: StatusWa): Promise<void>`
  - `listarConversas(): Promise<ConversaDto[]>`
  - `mensagens(conversaId: number): Promise<MensagemDto[]>` (zera `nao_lidas`, marca a última de entrada como lida no Meta)
  - `enviar(conversaId: number, texto: string): Promise<MensagemDto>` (404 conversa; 400 texto vazio/>4096; 409 janela fechada)
  - `naoLidas(): Promise<{ total: number }>`
  - `ConversaDto { id; waId; nome: string; leadId: number | null; ultimaMsgEm: string; ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean }`
  - `MensagemDto { id; direcao: 'entrada' | 'saida'; texto: string; status: string; erro: string | null; criadoEm: string }`

- [ ] **Step 1: Testes** (Prisma em memória simples)

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsappInboxService } from './whatsapp-inbox.service';

function montar() {
  const conversas: any[] = [];
  const msgs: any[] = [];
  const leads: any[] = [];
  const prisma: any = {
    crm_WhatsApp_Conversas: {
      findUnique: jest.fn(async ({ where }: any) => conversas.find((c) => (where.id ? c.id === where.id : c.wa_id === where.wa_id)) ?? null),
      create: jest.fn(async ({ data }: any) => { const c = { id: conversas.length + 1, nao_lidas: 0, lead_id: null, ...data }; conversas.push(c); return c; }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = conversas.find((x) => x.id === where.id);
        for (const [k, v] of Object.entries(data)) c[k] = (v as any)?.increment !== undefined ? c[k] + (v as any).increment : v;
        return c;
      }),
      findMany: jest.fn(async () => conversas),
      aggregate: jest.fn(async () => ({ _sum: { nao_lidas: conversas.reduce((s, c) => s + c.nao_lidas, 0) } })),
    },
    crm_WhatsApp_Mensagens: {
      findUnique: jest.fn(async ({ where }: any) => msgs.find((m) => m.wamid === where.wamid) ?? null),
      create: jest.fn(async ({ data }: any) => { const m = { id: msgs.length + 1, criado_em: new Date(), erro: null, ...data }; msgs.push(m); return m; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(msgs.find((m) => m.wamid === where.wamid), data)),
      findMany: jest.fn(async ({ where }: any) => msgs.filter((m) => m.conversa_id === where.conversa_id)),
      findFirst: jest.fn(async ({ where }: any) => msgs.filter((m) => m.conversa_id === where.conversa_id && m.direcao === 'entrada').pop() ?? null),
    },
    crm_Leads: {
      findFirst: jest.fn(async () => leads.find((l) => l.nome.startsWith('Clique no WhatsApp') && l.whatsapp === '') ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(leads.find((l) => l.id === where.id), data)),
      create: jest.fn(async ({ data }: any) => { const l = { id: leads.length + 1, ...data }; leads.push(l); return l; }),
    },
  };
  const graph = { enviarTexto: jest.fn(async () => 'wamid.saida'), marcarLida: jest.fn(async () => undefined) };
  return { conversas, msgs, leads, prisma, graph, svc: new WhatsappInboxService(prisma, graph as any) };
}

const entrada = (over: any = {}) => ({ wamid: 'w1', waId: '5521999369814', nomePerfil: 'Ana', tipo: 'text', texto: 'Oi', em: new Date(), ...over });

describe('WhatsappInboxService', () => {
  it('primeira mensagem cria conversa e liga ao clique recente', async () => {
    const t = montar();
    t.leads.push({ id: 7, nome: 'Clique no WhatsApp (sem dados)', whatsapp: '', origem: 'google' });
    await t.svc.registrarEntrada(entrada());
    expect(t.conversas[0]).toMatchObject({ wa_id: '5521999369814', lead_id: 7, nao_lidas: 1 });
    expect(t.leads[0]).toMatchObject({ whatsapp: '5521999369814', nome: 'Ana' });
  });

  it('sem clique cria lead orgânico', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    expect(t.leads[0]).toMatchObject({ nome: 'Ana', whatsapp: '5521999369814', origem: 'organico' });
    expect(t.conversas[0].lead_id).toBe(1);
  });

  it('wamid repetido não duplica', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    await t.svc.registrarEntrada(entrada());
    expect(t.msgs).toHaveLength(1);
    expect(t.conversas[0].nao_lidas).toBe(1);
  });

  it('status só avança', async () => {
    const t = montar();
    t.msgs.push({ id: 1, wamid: 'ws', status: 'lida' });
    await t.svc.atualizarStatus({ wamid: 'ws', status: 'entregue' });
    expect(t.msgs[0].status).toBe('lida');
  });

  it('envio com janela aberta grava saída', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    const m = await t.svc.enviar(1, 'Olá!');
    expect(t.graph.enviarTexto).toHaveBeenCalledWith('5521999369814', 'Olá!');
    expect(m).toMatchObject({ direcao: 'saida', texto: 'Olá!', status: 'enviada' });
  });

  it('envio com janela fechada dá 409 e não chama a API', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada({ em: new Date(Date.now() - 25 * 3600 * 1000) }));
    await expect(t.svc.enviar(1, 'Oi')).rejects.toBeInstanceOf(ConflictException);
    expect(t.graph.enviarTexto).not.toHaveBeenCalled();
  });

  it('falha do Graph grava mensagem com status falhou', async () => {
    const t = montar();
    t.graph.enviarTexto.mockRejectedValueOnce(new Error('boom'));
    await t.svc.registrarEntrada(entrada());
    const m = await t.svc.enviar(1, 'Oi');
    expect(m).toMatchObject({ status: 'falhou', erro: 'boom' });
  });

  it('conversa inexistente dá 404', async () => {
    await expect(montar().svc.enviar(99, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('abrir mensagens zera não lidas', async () => {
    const t = montar();
    await t.svc.registrarEntrada(entrada());
    await t.svc.mensagens(1);
    expect(t.conversas[0].nao_lidas).toBe(0);
    expect(t.graph.marcarLida).toHaveBeenCalledWith('w1');
  });
});
```

- [ ] **Step 2:** jest → FAIL.
- [ ] **Step 3: Implementação**

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappGraphClient } from './whatsapp-graph.client';
import { EntradaWa, janelaAberta, StatusWa, statusAvanca } from './whatsapp-puro';

const JUNCAO_MS = 30 * 60 * 1000;

export interface ConversaDto {
  id: number; waId: string; nome: string; leadId: number | null; ultimaMsgEm: string;
  ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean;
}
export interface MensagemDto {
  id: number; direcao: 'entrada' | 'saida'; texto: string; status: string; erro: string | null; criadoEm: string;
}

function msgDto(m: any): MensagemDto {
  return { id: m.id, direcao: m.direcao, texto: m.texto, status: m.status, erro: m.erro ?? null, criadoEm: new Date(m.criado_em).toISOString() };
}

@Injectable()
export class WhatsappInboxService {
  constructor(private readonly prisma: PrismaService, private readonly graph: WhatsappGraphClient) {}

  async registrarEntrada(m: EntradaWa): Promise<void> {
    if (await this.prisma.crm_WhatsApp_Mensagens.findUnique({ where: { wamid: m.wamid } })) return;
    let conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { wa_id: m.waId } });
    if (!conversa) {
      const leadId = await this.ligarLead(m);
      conversa = await this.prisma.crm_WhatsApp_Conversas.create({
        data: { wa_id: m.waId, nome_perfil: m.nomePerfil ?? null, lead_id: leadId, ultima_msg_em: m.em },
      });
    }
    await this.prisma.crm_WhatsApp_Mensagens.create({
      data: { conversa_id: conversa.id, wamid: m.wamid, direcao: 'entrada', tipo: m.tipo, texto: m.texto, status: 'recebida', criado_em: m.em },
    });
    await this.prisma.crm_WhatsApp_Conversas.update({
      where: { id: conversa.id },
      data: {
        ultima_msg_em: m.em, ultima_do_cliente_em: m.em, nao_lidas: { increment: 1 },
        ...(m.nomePerfil ? { nome_perfil: m.nomePerfil } : {}),
      },
    });
  }

  /** Clique no botão do site nos últimos 30 min sem conversa → mesmo lead (mantém a origem do anúncio). */
  private async ligarLead(m: EntradaWa): Promise<number> {
    const nome = (m.nomePerfil || `WhatsApp ${m.waId}`).slice(0, 120);
    const clique = await this.prisma.crm_Leads.findFirst({
      where: {
        nome: { startsWith: 'Clique no WhatsApp' }, whatsapp: '',
        criado_em: { gte: new Date(m.em.getTime() - JUNCAO_MS) }, conversas_whatsapp: { none: {} },
      },
      orderBy: { criado_em: 'desc' },
    });
    if (clique) {
      await this.prisma.crm_Leads.update({ where: { id: clique.id }, data: { whatsapp: m.waId, nome } });
      return clique.id;
    }
    const novo = await this.prisma.crm_Leads.create({
      data: { nome, condominio: '—', unidades: '—', whatsapp: m.waId, origem: 'organico' },
    });
    return novo.id;
  }

  async atualizarStatus(s: StatusWa): Promise<void> {
    const msg = await this.prisma.crm_WhatsApp_Mensagens.findUnique({ where: { wamid: s.wamid } });
    if (!msg || !statusAvanca(msg.status, s.status)) return;
    await this.prisma.crm_WhatsApp_Mensagens.update({
      where: { wamid: s.wamid },
      data: { status: s.status, ...(s.erro ? { erro: s.erro } : {}) },
    });
  }

  async listarConversas(): Promise<ConversaDto[]> {
    const rows = await this.prisma.crm_WhatsApp_Conversas.findMany({
      orderBy: { ultima_msg_em: 'desc' }, take: 200,
      include: { mensagens: { orderBy: { criado_em: 'desc' }, take: 1 } },
    });
    return rows.map((c: any) => ({
      id: c.id, waId: c.wa_id, nome: c.nome_perfil || `+${c.wa_id}`, leadId: c.lead_id ?? null,
      ultimaMsgEm: new Date(c.ultima_msg_em).toISOString(),
      ultimaDoClienteEm: c.ultima_do_cliente_em ? new Date(c.ultima_do_cliente_em).toISOString() : null,
      naoLidas: c.nao_lidas, trecho: (c.mensagens?.[0]?.texto ?? '').slice(0, 80),
      janelaAberta: janelaAberta(c.ultima_do_cliente_em ? new Date(c.ultima_do_cliente_em) : null),
    }));
  }

  async mensagens(conversaId: number): Promise<MensagemDto[]> {
    const conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { id: conversaId } });
    if (!conversa) throw new NotFoundException('Conversa não encontrada.');
    const rows = await this.prisma.crm_WhatsApp_Mensagens.findMany({
      where: { conversa_id: conversaId }, orderBy: { criado_em: 'asc' }, take: 500,
    });
    if (conversa.nao_lidas > 0) {
      await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversaId }, data: { nao_lidas: 0 } });
      const ultima = await this.prisma.crm_WhatsApp_Mensagens.findFirst({
        where: { conversa_id: conversaId, direcao: 'entrada' }, orderBy: { criado_em: 'desc' },
      });
      if (ultima) await this.graph.marcarLida(ultima.wamid);
    }
    return rows.map(msgDto);
  }

  async enviar(conversaId: number, texto: string): Promise<MensagemDto> {
    const conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { id: conversaId } });
    if (!conversa) throw new NotFoundException('Conversa não encontrada.');
    const corpo = typeof texto === 'string' ? texto.trim() : '';
    if (!corpo || corpo.length > 4096) throw new BadRequestException('Mensagem vazia ou longa demais.');
    if (!janelaAberta(conversa.ultima_do_cliente_em ? new Date(conversa.ultima_do_cliente_em) : null)) {
      throw new ConflictException('Janela de 24h fechada: o cliente precisa mandar mensagem primeiro.');
    }
    const agora = new Date();
    let wamid: string;
    let status = 'enviada';
    let erro: string | null = null;
    try {
      wamid = await this.graph.enviarTexto(conversa.wa_id, corpo);
    } catch (e: any) {
      wamid = `falha-${randomUUID()}`;
      status = 'falhou';
      erro = String(e?.message ?? e).slice(0, 500);
    }
    const m = await this.prisma.crm_WhatsApp_Mensagens.create({
      data: { conversa_id: conversaId, wamid, direcao: 'saida', tipo: 'text', texto: corpo, status, erro, criado_em: agora },
    });
    await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversaId }, data: { ultima_msg_em: agora } });
    return msgDto(m);
  }

  async naoLidas(): Promise<{ total: number }> {
    const r = await this.prisma.crm_WhatsApp_Conversas.aggregate({ _sum: { nao_lidas: true } });
    return { total: r._sum.nao_lidas ?? 0 };
  }
}
```

- [ ] **Step 4:** jest → PASS; `npx nx typecheck api` → sucesso.
- [ ] **Step 5: Commit** — `feat(whatsapp): caixa de conversas com junção ao lead e janela de 24h`

---

### Task 5: Controllers e módulo

**Files:**
- Create: `apps/api/src/app/whatsapp/whatsapp-webhook.controller.ts`
- Create: `apps/api/src/app/whatsapp/whatsapp-crm.controller.ts`
- Create: `apps/api/src/app/whatsapp/whatsapp.module.ts`
- Modify: `apps/api/src/app/app.module.ts` (importar `WhatsappModule` ao lado de `MarketingModule`)
- Test: `apps/api/src/app/whatsapp/whatsapp-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `GET/POST /api/public/whatsapp/webhook`; `GET /api/crm/whatsapp/conversas`, `GET /api/crm/whatsapp/conversas/:id/mensagens`, `POST /api/crm/whatsapp/conversas/:id/mensagens` (`{ texto }`), `GET /api/crm/whatsapp/nao-lidas`.

- [ ] **Step 1: Testes**

```ts
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

function montar() {
  const segredos = { obter: jest.fn(async (n: string) => (n === 'WA_APP_SECRET' ? 'seg' : n === 'WA_VERIFY_TOKEN' ? 'vt' : undefined)) };
  const inbox = { registrarEntrada: jest.fn(async () => undefined), atualizarStatus: jest.fn(async () => undefined) };
  return { inbox, ctrl: new WhatsappWebhookController(segredos as any, inbox as any) };
}

describe('WhatsappWebhookController', () => {
  it('handshake devolve o challenge com token certo', async () => {
    await expect(montar().ctrl.verificar('subscribe', 'vt', '123')).resolves.toBe('123');
  });
  it('handshake com token errado dá 401', async () => {
    await expect(montar().ctrl.verificar('subscribe', 'x', '123')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('POST sem assinatura válida dá 401', async () => {
    const { ctrl } = montar();
    await expect(ctrl.receber({ rawBody: Buffer.from('{}'), body: {} } as any, 'sha256=00')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('POST assinado processa mensagens', async () => {
    const { ctrl, inbox } = montar();
    const body = { entry: [{ changes: [{ value: { messages: [{ from: '55', id: 'w', timestamp: '1', type: 'text', text: { body: 'Oi' } }] } }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + createHmac('sha256', 'seg').update(raw).digest('hex');
    await ctrl.receber({ rawBody: raw, body } as any, sig);
    expect(inbox.registrarEntrada).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2:** jest → FAIL.
- [ ] **Step 3: Implementação**

`whatsapp-webhook.controller.ts`:

```ts
import { Controller, Get, Header, Headers, HttpCode, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { MarketingSegredosService } from '../marketing/marketing-segredos.service';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { assinaturaValida, interpretarWebhook } from './whatsapp-puro';

@Controller('public/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly segredos: MarketingSegredosService, private readonly inbox: WhatsappInboxService) {}

  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  async verificar(@Query('hub.mode') modo: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') desafio: string) {
    const esperado = await this.segredos.obter('WA_VERIFY_TOKEN');
    if (modo !== 'subscribe' || !esperado || token !== esperado) throw new UnauthorizedException();
    return desafio;
  }

  @Post('webhook')
  @HttpCode(200)
  async receber(@Req() req: { rawBody?: Buffer; body: unknown }, @Headers('x-hub-signature-256') assinatura: string) {
    if (!assinaturaValida(req.rawBody, assinatura, await this.segredos.obter('WA_APP_SECRET'))) throw new UnauthorizedException();
    const { mensagens, status } = interpretarWebhook(req.body);
    // Sempre 200 após assinatura válida: erro de processamento vai para o log,
    // senão o Meta reenvia em loop e acaba desativando o webhook.
    for (const m of mensagens) await this.inbox.registrarEntrada(m).catch((e) => this.logger.error(`entrada ${m.wamid}: ${e?.message}`));
    for (const s of status) await this.inbox.atualizarStatus(s).catch((e) => this.logger.error(`status ${s.wamid}: ${e?.message}`));
    return 'ok';
  }
}
```

`whatsapp-crm.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { WhatsappInboxService } from './whatsapp-inbox.service';

@Controller('crm/whatsapp')
@UseGuards(CrmAdminGuard)
export class WhatsappCrmController {
  constructor(private readonly inbox: WhatsappInboxService) {}

  @Get('conversas')
  conversas() { return this.inbox.listarConversas(); }

  @Get('conversas/:id/mensagens')
  mensagens(@Param('id', ParseIntPipe) id: number) { return this.inbox.mensagens(id); }

  @Post('conversas/:id/mensagens')
  enviar(@Param('id', ParseIntPipe) id: number, @Body() body: { texto?: string }) {
    return this.inbox.enviar(id, body?.texto ?? '');
  }

  @Get('nao-lidas')
  naoLidas() { return this.inbox.naoLidas(); }
}
```

`whatsapp.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingModule } from '../marketing/marketing.module';
import { WhatsappCrmController } from './whatsapp-crm.controller';
import { WhatsappGraphClient } from './whatsapp-graph.client';
import { WhatsappInboxService } from './whatsapp-inbox.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [MarketingModule],
  controllers: [WhatsappWebhookController, WhatsappCrmController],
  providers: [WhatsappInboxService, WhatsappGraphClient, CrmAdminGuard],
})
export class WhatsappModule {}
```

`app.module.ts`: `import { WhatsappModule } from './whatsapp/whatsapp.module';` e adicionar `WhatsappModule,` logo após `MarketingModule,`.

- [ ] **Step 4:** jest (whatsapp + marketing) → PASS; `npx nx typecheck api` → sucesso.
- [ ] **Step 5: Commit** — `feat(whatsapp): webhook público e rotas do CRM`

---

### Task 6: Aba WhatsApp no CRM

**Files:**
- Create: `apps/crm-web/src/app/crm/whatsapp.service.ts`
- Create: `apps/crm-web/src/app/crm/tabs/crm-whatsapp.component.ts`
- Create: `apps/crm-web/src/app/crm/tabs/crm-whatsapp.component.html`
- Modify: `apps/crm-web/src/app/app.routes.ts` (rota `whatsapp` após `marketing`)
- Modify: `apps/crm-web/src/app/crm/crm-page.component.ts` (item de navegação + contador)
- Modify: `apps/crm-web/src/app/crm/crm-page.component.html:124,159` (badge)

**Interfaces:**
- Consumes: rotas da Task 5 (DTOs `ConversaDto`, `MensagemDto`).

- [ ] **Step 1: Serviço**

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

export interface Conversa {
  id: number; waId: string; nome: string; leadId: number | null; ultimaMsgEm: string;
  ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean;
}
export interface Mensagem { id: number; direcao: 'entrada' | 'saida'; texto: string; status: string; erro: string | null; criadoEm: string }

@Injectable({ providedIn: 'root' })
export class WhatsappApi {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/whatsapp`;

  conversas(): Observable<Conversa[]> { return this.http.get<Conversa[]>(`${this.base}/conversas`); }
  mensagens(id: number): Observable<Mensagem[]> { return this.http.get<Mensagem[]>(`${this.base}/conversas/${id}/mensagens`); }
  enviar(id: number, texto: string): Observable<Mensagem> { return this.http.post<Mensagem>(`${this.base}/conversas/${id}/mensagens`, { texto }); }
  naoLidas(): Observable<{ total: number }> { return this.http.get<{ total: number }>(`${this.base}/nao-lidas`); }
}
```

- [ ] **Step 2: Componente**

```ts
import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Conversa, Mensagem, WhatsappApi } from '../whatsapp.service';

@Component({
  selector: 'app-crm-whatsapp',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './crm-whatsapp.component.html',
})
export class CrmWhatsappComponent implements OnInit {
  private api = inject(WhatsappApi);
  private destroyRef = inject(DestroyRef);
  private fim = viewChild<ElementRef<HTMLElement>>('fim');

  conversas = signal<Conversa[]>([]);
  selecionadaId = signal<number | null>(null);
  mensagens = signal<Mensagem[]>([]);
  texto = '';
  enviando = signal(false);
  erro = signal<string | null>(null);
  selecionada = computed(() => this.conversas().find((c) => c.id === this.selecionadaId()) ?? null);

  ngOnInit() {
    this.carregarConversas();
    const t = setInterval(() => {
      this.carregarConversas();
      const id = this.selecionadaId();
      if (id) this.carregarMensagens(id, false);
    }, 10_000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  carregarConversas() {
    this.api.conversas().subscribe({ next: (c) => this.conversas.set(c), error: () => this.erro.set('Falha ao carregar conversas.') });
  }

  abrir(c: Conversa) {
    this.selecionadaId.set(c.id);
    this.erro.set(null);
    this.carregarMensagens(c.id, true);
  }

  private carregarMensagens(id: number, rolar: boolean) {
    this.api.mensagens(id).subscribe((m) => {
      const cresceu = m.length !== this.mensagens().length;
      this.mensagens.set(m);
      this.conversas.update((cs) => cs.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)));
      if (rolar || cresceu) setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end' }));
    });
  }

  enviar() {
    const id = this.selecionadaId();
    const texto = this.texto.trim();
    if (!id || !texto || this.enviando()) return;
    this.enviando.set(true);
    this.erro.set(null);
    this.api.enviar(id, texto).subscribe({
      next: (m) => {
        this.texto = '';
        this.mensagens.update((ms) => [...ms, m]);
        if (m.status === 'falhou') this.erro.set(`Não enviada: ${m.erro}`);
        this.enviando.set(false);
        setTimeout(() => this.fim()?.nativeElement.scrollIntoView({ block: 'end' }));
      },
      error: (e) => {
        this.erro.set(e?.error?.message ?? 'Falha ao enviar.');
        this.enviando.set(false);
      },
    });
  }

  marca(m: Mensagem): string {
    return m.status === 'lida' ? '✓✓ lida' : m.status === 'entregue' ? '✓✓' : m.status === 'enviada' ? '✓' : m.status === 'falhou' ? '⚠ falhou' : '';
  }
}
```

`crm-whatsapp.component.html`:

```html
<div class="grid h-[calc(100vh-10rem)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[320px_1fr]">
  <aside class="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r" [class.hidden]="selecionadaId() !== null" [class.md:flex]="true">
    <h2 class="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Conversas</h2>
    <ul class="min-h-0 flex-1 overflow-y-auto">
      @for (c of conversas(); track c.id) {
        <li>
          <button type="button" (click)="abrir(c)" class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50" [class.bg-emerald-50]="c.id === selecionadaId()">
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium">{{ c.nome }}</span>
                <span class="shrink-0 text-xs text-slate-500">{{ c.ultimaMsgEm | date: 'dd/MM HH:mm' }}</span>
              </div>
              <p class="truncate text-xs text-slate-500">{{ c.trecho }}</p>
            </div>
            @if (c.naoLidas > 0) {
              <span class="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{{ c.naoLidas }}</span>
            }
          </button>
        </li>
      } @empty {
        <li class="px-4 py-6 text-sm text-slate-500">Nenhuma conversa ainda. Quando alguém mandar mensagem para o WhatsApp comercial, ela aparece aqui.</li>
      }
    </ul>
  </aside>

  <section class="flex min-h-0 flex-col" [class.hidden]="selecionadaId() === null" [class.md:flex]="true">
    @if (selecionada(); as c) {
      <header class="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <button type="button" class="md:hidden text-sm text-emerald-700" (click)="selecionadaId.set(null)">‹ Voltar</button>
          <div>
            <div class="text-sm font-semibold">{{ c.nome }}</div>
            <div class="text-xs text-slate-500">+{{ c.waId }}</div>
          </div>
        </div>
        @if (c.leadId) {
          <a routerLink="../marketing" class="text-xs text-emerald-700 hover:underline">Ver lead</a>
        }
      </header>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-3">
        @for (m of mensagens(); track m.id) {
          <div class="flex" [class.justify-end]="m.direcao === 'saida'">
            <div class="max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm"
                 [class.bg-emerald-100]="m.direcao === 'saida'" [class.bg-white]="m.direcao === 'entrada'">
              {{ m.texto }}
              <div class="mt-1 text-right text-[11px] text-slate-500">
                {{ m.criadoEm | date: 'dd/MM HH:mm' }} @if (m.direcao === 'saida') { · {{ marca(m) }} }
              </div>
            </div>
          </div>
        }
        <div #fim></div>
      </div>
      @if (erro()) { <p class="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{{ erro() }}</p> }
      @if (c.janelaAberta) {
        <form class="flex gap-2 border-t border-slate-200 p-3" (submit)="$event.preventDefault(); enviar()">
          <textarea [(ngModel)]="texto" name="texto" rows="2" maxlength="4096" placeholder="Escreva a resposta…"
                    (keydown.enter)="$any($event).shiftKey || ($event.preventDefault(), enviar())"
                    class="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>
          <button type="submit" [disabled]="enviando() || !texto.trim()" class="rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Enviar</button>
        </form>
      } @else {
        <p class="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Janela de 24h fechada: pela regra do WhatsApp, só dá para responder depois que o cliente mandar uma nova mensagem.
        </p>
      }
    } @else {
      <div class="m-auto p-6 text-sm text-slate-500">Escolha uma conversa.</div>
    }
  </section>
</div>
```

- [ ] **Step 3: Rota** em `app.routes.ts`, após o bloco `marketing`:

```ts
          {
            path: 'whatsapp',
            loadComponent: () => import('./crm/tabs/crm-whatsapp.component').then((m) => m.CrmWhatsappComponent),
          },
```

- [ ] **Step 4: Navegação** — em `crm-page.component.ts`, após o item `marketing` do array `navItens`:

```ts
    {
      rota: 'whatsapp',
      label: 'WhatsApp',
      labelCurto: 'WhatsApp',
      icone: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
    },
```

e no componente: `private waApi = inject(WhatsappApi); naoLidasWa = signal(0);` com, no `ngOnInit` (criar se não existir) um `setInterval` de 30s (e chamada imediata) `this.waApi.naoLidas().subscribe({ next: (r) => this.naoLidasWa.set(r.total), error: () => {} })`, limpo em `DestroyRef.onDestroy`. No HTML, logo após `<span class="rail-tip">{{ item.label }}</span>` (linha ~124) e após `{{ item.labelCurto }}` (linha ~159):

```html
@if (item.rota === 'whatsapp' && naoLidasWa() > 0) {
  <span class="ml-1 rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">{{ naoLidasWa() }}</span>
}
```

- [ ] **Step 5:** `npx nx build crm-web` → sucesso.
- [ ] **Step 6: Commit** — `feat(crm-web): aba WhatsApp`

---

### Task 7: Produção (feito pelo agente principal, não por subagente)

- [ ] Aplicar `prisma/manual_2026-09_crm_whatsapp.sql` no banco de produção e conferir `SHOW TABLES LIKE 'crm_whatsapp%'`.
- [ ] Merge em `master` e push em `master` e `main`; acompanhar o deploy (`gh run list`; se colidir, `gh workflow run deploy-api.yml`).
- [ ] Meta: criar usuário do sistema admin, atribuir app e WABA, gerar token permanente; copiar o app secret; gerar verify token aleatório. Gravar os três cifrados em `crm_config` (`WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`).
- [ ] Meta: configurar webhook do app (URL `https://api.prestarecondominios.com.br/api/public/whatsapp/webhook`, verify token), assinar o campo `messages` e `POST /1804931620699472/subscribed_apps`.
- [ ] Ponta a ponta: usuário manda mensagem do celular pessoal → aparece no CRM → resposta pelo CRM chega no celular com ✓✓.
- [ ] Virar a landing `/sobre` de `5517992559990` para `5517996608148`, commit e push.
- [ ] Atualizar a memória `whatsapp-api-numero-pendente.md`.
