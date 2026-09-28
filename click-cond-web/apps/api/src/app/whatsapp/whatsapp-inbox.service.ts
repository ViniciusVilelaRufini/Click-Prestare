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
