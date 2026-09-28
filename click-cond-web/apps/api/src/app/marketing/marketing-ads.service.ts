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
