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
