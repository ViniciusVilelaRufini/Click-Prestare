import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { executarComLock } from '../common/lock-distribuido';
import { OpenAiAdsClient } from './openai-ads.client';
import { MarketingSegredosService } from './marketing-segredos.service';

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
const JANELA_CONVERSAO_MS = 30 * 24 * 60 * 60 * 1000;
const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;

/** Lead do Google confirmado no WhatsApp, no formato que o upload offline do Google Ads aceita. */
export interface ConversaoGoogleOffline {
  gclid: string;
  /** `yyyy-MM-dd HH:mm:ss-03:00` — sempre o `criado_em` do lead, para o reenvio diário ser duplicata descartada. */
  conversao_em: string;
}

function horaGoogleBrt(d: Date): string {
  return new Date(d.getTime() - OFFSET_BRT_MS).toISOString().slice(0, 19).replace('T', ' ') + '-03:00';
}

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
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  return {
    campanha_id: String(r.campanha_id).slice(0, 64),
    campanha_nome: String(r.campanha_nome ?? r.campanha_id).slice(0, 200),
    dia: String(r.dia),
    impressoes: clamp(Math.round(n(r.impressoes)), 0, 2_000_000_000),
    cliques: clamp(Math.round(n(r.cliques)), 0, 2_000_000_000),
    gasto: clamp(n(r.gasto), 0, 1e9),
    conversoes: clamp(n(r.conversoes), 0, 1e9),
  };
}

@Injectable()
export class MarketingAdsService implements OnModuleInit {
  private readonly logger = new Logger(MarketingAdsService.name);
  private openAiRodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiAdsClient,
    private readonly segredos: MarketingSegredosService,
  ) {}

  onModuleInit() {
    // OpenAI Ads: sincroniza de hora em hora os últimos 7 dias (números do dia
    // corrente e de ontem ainda mudam). Upsert torna a repetição inofensiva.
    setInterval(() => void executarComLock(this.prisma, 'marketing:openai', () => this.tickOpenAi(), { intervaloMinimoMs: 60 * 60 * 1000 }), 60 * 60 * 1000).unref?.();
    setTimeout(() => void executarComLock(this.prisma, 'marketing:openai', () => this.tickOpenAi(), { intervaloMinimoMs: 60 * 60 * 1000 }), 2 * 60 * 1000).unref?.();
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
    if (!tokenConfere(token, await this.segredos.obter('ADS_INGEST_TOKEN'))) throw new UnauthorizedException();
    const rows = (body as any)?.rows;
    if (!Array.isArray(rows) || rows.length > 5000) throw new BadRequestException('Corpo inválido.');
    const linhas = rows.map(linhaValida);
    return { gravadas: await this.upsert('google', linhas) };
  }

  /**
   * Leads de anúncio do Google que confirmaram no WhatsApp nos últimos 30 dias.
   * Lido diariamente pelo Google Ads Script, que sobe cada um como conversão offline.
   */
  async conversoesGoogle(token: string | undefined, agora: Date = new Date()): Promise<ConversaoGoogleOffline[]> {
    if (!tokenConfere(token, await this.segredos.obter('ADS_INGEST_TOKEN'))) throw new UnauthorizedException();
    const desde = new Date(agora.getTime() - JANELA_CONVERSAO_MS);
    const leads = await this.prisma.crm_Leads.findMany({
      where: { origem: 'google', gclid: { not: null }, criado_em: { gte: desde } },
      select: { id: true, origem: true, gclid: true, criado_em: true },
      orderBy: { criado_em: 'asc' },
    });
    const candidatos = leads.filter((l) => l.origem === 'google' && l.gclid?.trim() && l.criado_em >= desde);
    if (!candidatos.length) return [];
    const conversas = await this.prisma.crm_WhatsApp_Conversas.findMany({
      where: { conversao_lead_id: { in: candidatos.map((l) => l.id) } },
      select: { conversao_lead_id: true },
    });
    const confirmados = new Set(conversas.map((c) => c.conversao_lead_id));
    return candidatos
      .filter((l) => confirmados.has(l.id))
      .map((l) => ({ gclid: l.gclid!.trim(), conversao_em: horaGoogleBrt(l.criado_em) }));
  }

  async sincronizarOpenAi(): Promise<number> {
    if (!(await this.openai.estaConfigurado())) {
      this.logger.warn('OPENAI_ADS_API_KEY ausente — sync da OpenAI Ads desligado');
      return 0;
    }
    const linhas = await this.openai.buscarDiario(7);
    return this.upsert('openai', linhas.filter((l) => DIA.test(l.dia) && l.campanha_id));
  }
}
