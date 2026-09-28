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
    // Honeypot: campo "site" é invisível para gente e só bots de spam
    // preenchem. Ignora silenciosamente (sem 400, sem gravar) para não
    // ensinar o bot a se adaptar.
    if (body && typeof body === 'object' && typeof (body as any).site === 'string' && (body as any).site.trim()) {
      return;
    }
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
    if (p.observacao !== undefined) {
      const texto = p.observacao == null ? '' : String(p.observacao).trim().slice(0, 5000);
      data.observacao = texto ? texto : null;
    }
    const salvo = await this.prisma.crm_Leads.update({ where: { id }, data });
    return paraDto(salvo);
  }
}
