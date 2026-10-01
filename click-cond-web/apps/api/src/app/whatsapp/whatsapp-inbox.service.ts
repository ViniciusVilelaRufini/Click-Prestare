import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ArquivoWhatsapp, WhatsappGraphClient } from './whatsapp-graph.client';
import { EntradaWa, janelaAberta, StatusWa, statusAvanca } from './whatsapp-puro';
import { decidirAutomacao } from './whatsapp-automacao';
import { WhatsappConfigService } from './whatsapp-config.service';
import { MarketingConversionsService } from '../marketing/marketing-conversions.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { TipoMidiaSaida, validarMidiaSaida } from './whatsapp-media.validation';

const JUNCAO_MS = 30 * 60 * 1000;
/** Webhook reenviado depois de uma queda não dispara resposta automática atrasada. */
const AUTO_ATRASO_MAX_MS = 10 * 60 * 1000;
const LEASE_IMPORTACAO_MS = 10 * 60 * 1000;

function normalizarWhatsapp(numero: string | null | undefined): string {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

/** Modelo aprovado no Meta para o primeiro contato com um lead (texto espelhado para o histórico). */
export const MODELO_PRIMEIRO_CONTATO = {
  nome: 'primeiro_contato_orcamento',
  texto:
    'Olá! Aqui é a Prestare Gestão. Recebemos seu interesse em controle de acesso e portaria digital para o condomínio. Podemos conversar para montar um orçamento?',
};

export interface ConversaDto {
  id: number; waId: string; nome: string; leadId: number | null; ultimaMsgEm: string;
  ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean;
}
export interface MensagemDto {
  id: number; direcao: 'entrada' | 'saida'; tipo: string; texto: string; status: string; erro: string | null; criadoEm: string;
  mediaChave: string | null; mediaMime: string | null; mediaNome: string | null; mediaTamanho: number | null; mediaStatus: string | null;
}

export class RangeMidiaInvalido extends Error {
  constructor(readonly total: number) { super('Intervalo de mídia inválido'); }
}

function msgDto(m: any): MensagemDto {
  return {
    id: m.id, direcao: m.direcao, tipo: m.tipo, texto: m.texto, status: m.status, erro: m.erro ?? null, criadoEm: new Date(m.criado_em).toISOString(),
    mediaChave: m.media_chave ?? null, mediaMime: m.media_mime ?? null, mediaNome: m.media_nome ?? null,
    mediaTamanho: m.media_tamanho ?? null, mediaStatus: m.media_status ?? null,
  };
}

@Injectable()
export class WhatsappInboxService {
  private readonly logger = new Logger(WhatsappInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsappGraphClient,
    @Optional() private readonly config?: WhatsappConfigService,
    @Optional() private readonly conversions?: MarketingConversionsService,
    @Optional() private readonly media?: WhatsappMediaService,
  ) {}

  async registrarEntrada(m: EntradaWa): Promise<void> {
    const existente = await this.prisma.crm_WhatsApp_Mensagens.findUnique({ where: { wamid: m.wamid } });
    if (existente) {
      if (m.mediaId && this.media && this.importacaoReivindicavel(existente.media_status)) {
        const claim = await this.prisma.crm_WhatsApp_Mensagens.updateMany({
          where: { wamid: m.wamid, media_status: existente.media_status }, data: { media_status: this.novaLeaseImportacao() },
        });
        if (claim.count === 1) await this.importarMidia(m);
      }
      return;
    }
    let conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { wa_id: m.waId } });
    const conversaNova = !conversa;
    const leadDoFormulario = await this.encontrarLeadDoFormulario(m);
    if (!conversa) {
      const leadId = await this.ligarLead(m, leadDoFormulario);
      conversa = await this.prisma.crm_WhatsApp_Conversas.create({
        data: { wa_id: m.waId, nome_perfil: m.nomePerfil ?? null, lead_id: leadId, ultima_msg_em: m.em },
      });
    } else if (leadDoFormulario && conversa.lead_id !== leadDoFormulario.id) {
      conversa = await this.prisma.crm_WhatsApp_Conversas.update({
        where: { id: conversa.id }, data: { lead_id: leadDoFormulario.id },
      });
    }
    await this.prisma.crm_WhatsApp_Mensagens.create({
      data: {
        conversa_id: conversa.id, wamid: m.wamid, direcao: 'entrada', tipo: m.tipo, texto: m.texto, status: 'recebida', criado_em: m.em,
        ...(m.mediaId ? { media_mime: m.mime ?? null, media_nome: m.nome ?? null, media_status: 'pendente' } : {}),
      },
    });
    if (m.mediaId && this.media) {
      const claim = await this.prisma.crm_WhatsApp_Mensagens.updateMany({
        where: { wamid: m.wamid, media_status: 'pendente' }, data: { media_status: this.novaLeaseImportacao() },
      });
      if (claim.count === 1) await this.importarMidia(m);
    }
    await this.prisma.crm_WhatsApp_Conversas.update({
      where: { id: conversa.id },
      data: {
        ultima_msg_em: m.em, ultima_do_cliente_em: m.em, nao_lidas: { increment: 1 },
        ...(m.nomePerfil ? { nome_perfil: m.nomePerfil } : {}),
      },
    });
    // A atualização condicional é o marcador durável e atômico: somente uma
    // mensagem pode confirmar cada lead nesta conversa, inclusive em webhooks simultâneos.
    const marcacao = conversa.lead_id && this.conversions
      ? await this.prisma.crm_WhatsApp_Conversas.updateMany({
        where: {
          id: conversa.id,
          OR: [{ conversao_lead_id: null }, { conversao_lead_id: { not: conversa.lead_id } }],
        },
        data: { conversao_lead_id: conversa.lead_id },
      })
      : { count: 0 };
    if (marcacao.count === 1 && conversa.lead_id && this.conversions) {
      const lead = await this.prisma.crm_Leads.findUnique({ where: { id: conversa.lead_id } });
      if (lead) await this.conversions.confirmarLeadWhatsApp({ wamid: m.wamid, em: m.em, lead }).catch((e) =>
        this.logger.error(`Conversão confirmada falhou (${m.wamid}): ${e?.message ?? e}`),
      );
    }
    await this.responderAutomatico(conversa.id, m.waId, conversaNova, m.em).catch((e) =>
      this.logger.error(`Resposta automática falhou (${m.wamid}): ${e?.message ?? e}`),
    );
  }

  private async responderAutomatico(conversaId: number, waId: string, conversaNova: boolean, em: Date): Promise<void> {
    if (!this.config) return;
    const agora = new Date();
    if (agora.getTime() - em.getTime() > AUTO_ATRASO_MAX_MS) return;
    const cfg = await this.config.automacoes();
    const ultimaFora = await this.prisma.crm_WhatsApp_Mensagens.findFirst({
      where: { conversa_id: conversaId, tipo: 'auto_fora_horario' },
      orderBy: { criado_em: 'desc' },
    });
    const d = decidirAutomacao({
      cfg, conversaNova, agora, ultimaForaHorarioEm: ultimaFora ? new Date(ultimaFora.criado_em) : null,
    });
    if (d) await this.enviarRegistrando(conversaId, waId, d.texto, d.tipo);
  }

  /** Envia texto livre e grava no histórico (falha do Graph vira mensagem 'falhou', sem exceção). */
  private async enviarRegistrando(conversaId: number, waId: string, texto: string, tipo: string): Promise<MensagemDto> {
    const agora = new Date();
    let wamid: string;
    let status = 'enviada';
    let erro: string | null = null;
    try {
      wamid = await this.graph.enviarTexto(waId, texto);
    } catch (e: any) {
      wamid = `falha-${randomUUID()}`;
      status = 'falhou';
      erro = String(e?.message ?? e).slice(0, 500);
    }
    const m = await this.prisma.crm_WhatsApp_Mensagens.create({
      data: { conversa_id: conversaId, wamid, direcao: 'saida', tipo, texto, status, erro, criado_em: agora },
    });
    await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversaId }, data: { ultima_msg_em: agora } });
    return msgDto(m);
  }

  /** Clique no botão do site nos últimos 30 min sem conversa → mesmo lead (mantém a origem do anúncio). */
  private async encontrarLeadDoFormulario(m: EntradaWa): Promise<any | null> {
    const inicioJanela = new Date(m.em.getTime() - JUNCAO_MS);
    const leadsRecentes = await this.prisma.crm_Leads.findMany({
      where: { criado_em: { gte: inicioJanela, lte: m.em } },
      orderBy: { criado_em: 'desc' },
    });
    return leadsRecentes
      .sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime())
      .find((lead) => normalizarWhatsapp(lead.whatsapp) === normalizarWhatsapp(m.waId)) ?? null;
  }

  private async importarMidia(m: EntradaWa): Promise<void> {
    if (!m.mediaId || !this.media) return;
    try {
      const guardada = await this.media.guardarEntrada({ wamid: m.wamid, tipo: m.tipo, mediaId: m.mediaId });
      await this.prisma.crm_WhatsApp_Mensagens.update({
        where: { wamid: m.wamid },
        data: {
          media_chave: guardada.chave, media_mime: guardada.mime ?? m.mime ?? null, media_nome: guardada.nome ?? m.nome ?? null,
          media_tamanho: guardada.tamanho, media_status: guardada.status,
        },
      });
    } catch (e: any) {
      const msgErro = String(e?.message ?? e).slice(0, 500);
      await this.prisma.crm_WhatsApp_Mensagens.update({ where: { wamid: m.wamid }, data: { media_status: 'falhou', erro: msgErro } });
      this.logger.error(`Armazenamento de mídia falhou (${m.wamid}): ${msgErro}`);
    }
  }

  private novaLeaseImportacao(): string {
    return `importando-${Math.floor(Date.now() / 1000).toString(36)}`;
  }

  private importacaoReivindicavel(status: string | null | undefined): boolean {
    if (['pendente', 'falhou', 'indisponivel', 'importando'].includes(status ?? '')) return true;
    const match = /^importando-([0-9a-z]+)$/.exec(status ?? '');
    if (!match) return false;
    const inicio = parseInt(match[1], 36) * 1000;
    return Number.isSafeInteger(inicio) && Date.now() - inicio >= LEASE_IMPORTACAO_MS;
  }

  private async ligarLead(m: EntradaWa, leadDoFormulario?: any | null): Promise<number> {
    const nome = (m.nomePerfil || `WhatsApp ${m.waId}`).slice(0, 120);
    const inicioJanela = new Date(m.em.getTime() - JUNCAO_MS);
    if (leadDoFormulario) return leadDoFormulario.id;
    const clique = await this.prisma.crm_Leads.findFirst({
      where: {
        nome: { startsWith: 'Clique no WhatsApp' }, whatsapp: '',
        criado_em: { gte: inicioJanela }, conversas_whatsapp: { none: {} },
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
    return this.enviarRegistrando(conversaId, conversa.wa_id, corpo, 'text');
  }

  async enviarMidia(
    conversaId: number,
    entrada: { tipo: TipoMidiaSaida; arquivo: ArquivoWhatsapp; legenda?: string },
  ): Promise<MensagemDto> {
    const conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { id: conversaId } });
    if (!conversa) throw new NotFoundException('Conversa não encontrada.');
    validarMidiaSaida({ tipo: entrada.tipo, ...entrada.arquivo });
    if (!janelaAberta(conversa.ultima_do_cliente_em ? new Date(conversa.ultima_do_cliente_em) : null)) {
      throw new ConflictException('Janela de 24h fechada: o cliente precisa mandar mensagem primeiro.');
    }
    const legenda = typeof entrada.legenda === 'string' ? entrada.legenda.trim().slice(0, 4096) : '';
    const texto = legenda || `[${entrada.tipo} enviada]`;
    const agora = new Date();
    let wamid: string;
    let status = 'enviada';
    let erro: string | null = null;
    let guardada: any = null;
    try {
      if (this.media) {
        try {
          guardada = await this.media.guardarSaida({
            referencia: `saida-${randomUUID()}`,
            tipo: entrada.tipo,
            arquivo: entrada.arquivo,
          });
        } catch (erroStorage: any) {
          this.logger.warn(`Armazenamento privado de saída falhou: ${erroStorage?.message}`);
        }
      }
      wamid = await this.graph.enviarMidia({
        para: conversa.wa_id,
        tipo: entrada.tipo,
        arquivo: entrada.arquivo,
        ...(legenda ? { legenda } : {}),
      });
    } catch (e: any) {
      wamid = `falha-${randomUUID()}`;
      status = 'falhou';
      erro = String(e?.message ?? e).slice(0, 500);
    }
    let m: any;
    try {
      m = await this.prisma.crm_WhatsApp_Mensagens.create({
        data: {
          conversa_id: conversaId,
          wamid,
          direcao: 'saida',
          tipo: entrada.tipo,
          texto,
          status,
          erro,
          criado_em: agora,
          media_chave: guardada?.chave ?? null,
          media_mime: guardada?.mime ?? entrada.arquivo.mimetype,
          media_nome: guardada?.nome ?? entrada.arquivo.originalname.slice(0, 255),
          media_tamanho: guardada?.tamanho ?? entrada.arquivo.buffer.length,
          media_status: status === 'enviada' ? (guardada?.chave ? 'enviada' : 'indisponivel') : 'falhou',
        },
      });
    } catch (e) {
      if (guardada?.chave && this.media) await this.media.apagar(guardada.chave).catch((erro) =>
        this.logger.error(`Limpeza de mídia de saída falhou (${guardada.chave}): ${erro?.message ?? erro}`),
      );
      throw e;
    }
    await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversaId }, data: { ultima_msg_em: agora } });
    return msgDto(m);
  }

  async abrirMidia(mensagemId: number, range?: string) {
    const mensagem = await this.prisma.crm_WhatsApp_Mensagens.findUnique({ where: { id: mensagemId } });
    if (!mensagem?.media_chave) throw new NotFoundException('Mídia não encontrada.');
    if (!this.media) throw new NotFoundException('Armazenamento de mídia indisponível.');
    const total = Number(mensagem.media_tamanho);
    const intervalo = this.intervalo(range, total);
    if (range && !intervalo) throw new RangeMidiaInvalido(total);
    return this.media.abrir(mensagem.media_chave, intervalo ?? undefined);
  }

  private intervalo(range: string | undefined, total: number): { inicio: number; fim: number } | null {
    if (!range) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || !Number.isSafeInteger(total) || total <= 0) return null;
    const [, inicioValor, fimValor] = match;
    if (!inicioValor && !fimValor) return null;
    const inicio = inicioValor ? Number(inicioValor) : Math.max(0, total - Number(fimValor));
    const fim = fimValor && inicioValor ? Math.min(Number(fimValor), total - 1) : total - 1;
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio < 0 || inicio > fim || inicio >= total) return null;
    return { inicio, fim };
  }

  /** Abre (ou reaproveita) a conversa do lead e envia o modelo de primeiro contato. */
  async iniciarConversa(leadId: number): Promise<{ conversaId: number; mensagem: MensagemDto }> {
    const lead = await this.prisma.crm_Leads.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    let waId = String(lead.whatsapp ?? '').replace(/\D/g, '');
    if (!waId) throw new BadRequestException('Lead sem número de WhatsApp.');
    if (!waId.startsWith('55')) waId = `55${waId}`;
    const agora = new Date();
    let conversa = await this.prisma.crm_WhatsApp_Conversas.findUnique({ where: { wa_id: waId } });
    if (!conversa) {
      conversa = await this.prisma.crm_WhatsApp_Conversas.create({
        data: { wa_id: waId, nome_perfil: lead.nome.slice(0, 120), lead_id: lead.id, ultima_msg_em: agora },
      });
    } else if (!conversa.lead_id) {
      conversa = await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversa.id }, data: { lead_id: lead.id } });
    }
    let wamid: string;
    let status = 'enviada';
    let erro: string | null = null;
    try {
      wamid = await this.graph.enviarModelo(waId, MODELO_PRIMEIRO_CONTATO.nome);
    } catch (e: any) {
      wamid = `falha-${randomUUID()}`;
      status = 'falhou';
      erro = String(e?.message ?? e).slice(0, 500);
    }
    const m = await this.prisma.crm_WhatsApp_Mensagens.create({
      data: { conversa_id: conversa.id, wamid, direcao: 'saida', tipo: 'template', texto: MODELO_PRIMEIRO_CONTATO.texto, status, erro, criado_em: agora },
    });
    await this.prisma.crm_WhatsApp_Conversas.update({ where: { id: conversa.id }, data: { ultima_msg_em: agora } });
    return { conversaId: conversa.id, mensagem: msgDto(m) };
  }

  async naoLidas(): Promise<{ total: number }> {
    const r = await this.prisma.crm_WhatsApp_Conversas.aggregate({ _sum: { nao_lidas: true } });
    return { total: r._sum.nao_lidas ?? 0 };
  }
}
