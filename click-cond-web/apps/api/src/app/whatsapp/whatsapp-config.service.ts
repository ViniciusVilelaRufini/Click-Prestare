import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigAutomacoes, normalizarConfig } from './whatsapp-automacao';

const CHAVE = 'WA_AUTOMACOES';
const ATALHO = /^[a-z0-9_-]{1,40}$/;

export interface RespostaDto { id: number; atalho: string; titulo: string; texto: string; ordem: number }

function respostaValida(b: any): { atalho: string; titulo: string; texto: string; ordem: number } {
  const atalho = String(b?.atalho ?? '').trim().toLowerCase().replace(/^\//, '');
  const titulo = String(b?.titulo ?? '').trim().slice(0, 80);
  const texto = String(b?.texto ?? '').trim().slice(0, 4096);
  if (!ATALHO.test(atalho)) throw new BadRequestException('Atalho inválido: use letras minúsculas, números, - ou _.');
  if (!titulo || !texto) throw new BadRequestException('Preencha título e texto.');
  const ordem = Number.isInteger(b?.ordem) ? b.ordem : 0;
  return { atalho, titulo, texto, ordem };
}

/** Configuração das automações (em crm_config) e respostas rápidas do WhatsApp. */
@Injectable()
export class WhatsappConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async automacoes(): Promise<ConfigAutomacoes> {
    const row = await this.prisma.crm_Config.findUnique({ where: { chave: CHAVE } });
    let bruto: unknown = null;
    try { bruto = row ? JSON.parse(row.valor) : null; } catch { bruto = null; }
    return normalizarConfig(bruto);
  }

  async salvarAutomacoes(body: unknown): Promise<ConfigAutomacoes> {
    const cfg = normalizarConfig(body);
    const valor = JSON.stringify(cfg);
    await this.prisma.crm_Config.upsert({ where: { chave: CHAVE }, create: { chave: CHAVE, valor }, update: { valor } });
    return cfg;
  }

  async respostas(): Promise<RespostaDto[]> {
    return this.prisma.crm_WhatsApp_Respostas.findMany({
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      select: { id: true, atalho: true, titulo: true, texto: true, ordem: true },
    });
  }

  async criarResposta(body: unknown): Promise<RespostaDto> {
    const data = respostaValida(body);
    try {
      return await this.prisma.crm_WhatsApp_Respostas.create({ data, select: { id: true, atalho: true, titulo: true, texto: true, ordem: true } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Já existe uma resposta com esse atalho.');
      throw e;
    }
  }

  async editarResposta(id: number, body: unknown): Promise<RespostaDto> {
    const data = respostaValida(body);
    try {
      return await this.prisma.crm_WhatsApp_Respostas.update({ where: { id }, data, select: { id: true, atalho: true, titulo: true, texto: true, ordem: true } });
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException('Resposta não encontrada.');
      if (e?.code === 'P2002') throw new ConflictException('Já existe uma resposta com esse atalho.');
      throw e;
    }
  }

  async excluirResposta(id: number): Promise<void> {
    const r = await this.prisma.crm_WhatsApp_Respostas.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Resposta não encontrada.');
  }
}
