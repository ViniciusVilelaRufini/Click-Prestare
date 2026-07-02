import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmService } from './crm.service';

/**
 * Faturamento REAL da Click Prestare sobre os condomínios-clientes.
 *
 * Substitui as faturas simuladas que o crm-web computava no frontend
 * (3 meses sintéticos por cliente, baixa manual que só empurrava o
 * vencimento +30 dias). Agora cada fatura é uma linha em Crm_Faturas,
 * a baixa exige motivo + método e fica auditada, e os disparos de
 * WhatsApp são reais (Z-API) e historiados em Crm_Disparos.
 */
@Injectable()
export class CrmFaturasService implements OnModuleInit {
  private readonly logger = new Logger(CrmFaturasService.name);
  private gerarJobRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly notifications: NotificationsService,
    private readonly crm: CrmService,
  ) {}

  onModuleInit() {
    // Geração mensal: checa 1x/dia; no dia 1 gera as faturas do mês.
    // Idempotente (unique id_condominio+referencia), então rodar de novo
    // no mesmo dia não duplica nada.
    setInterval(() => this.tickGeracaoMensal(), 24 * 60 * 60 * 1000);
    setTimeout(() => this.tickGeracaoMensal(), 30 * 60 * 1000);
  }

  private async tickGeracaoMensal() {
    if (new Date().getDate() !== 1) return;
    if (this.gerarJobRunning) return;
    this.gerarJobRunning = true;
    try {
      await this.gerarFaturasDoMes();
    } catch (err: any) {
      this.logger.error(`Geração mensal de faturas CRM falhou: ${err?.message ?? err}`);
    } finally {
      this.gerarJobRunning = false;
    }
  }

  private referenciaAtual(): string {
    const hoje = new Date();
    return `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  }

  /**
   * Gera as faturas de uma referência (default: mês atual) para todos os
   * clientes ativos com MRR > 0. Valor vem da assinatura cadastrada
   * (Assinaturas_Condominios); sem assinatura, cai no MRR calculado por
   * plano/UH e a fatura é marcada `estimada`.
   */
  async gerarFaturasDoMes(referencia?: string, operador = 'Sistema CRM') {
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const ref = referencia ?? this.referenciaAtual();
    if (!/^\d{2}\/\d{4}$/.test(ref)) {
      throw new BadRequestException('Referência inválida — use o formato MM/YYYY.');
    }
    const [mesStr, anoStr] = ref.split('/');

    const clientes = await this.crm.clientes();
    const ativos = clientes.filter((c) => c.ativo && c.mrr > 0);

    let criadas = 0;
    for (const cliente of ativos) {
      const existe = await this.prisma.crm_Faturas.findFirst({
        where: { id_condominio: cliente.id, referencia: ref },
        select: { id: true },
      });
      if (existe) continue;

      const assinatura = await this.prisma.assinaturas_Condominios.findFirst({
        where: { id_condominio: cliente.id },
        orderBy: [{ data_fim: 'desc' }, { id: 'desc' }],
      });
      const valorAssinatura = assinatura?.valor ? Number(assinatura.valor) : 0;
      const estimada = valorAssinatura <= 0;
      const valor = estimada ? cliente.mrr : valorAssinatura;
      if (valor <= 0) continue;

      // Vencimento: dia do vencimento cadastrado dentro do mês de referência,
      // senão dia 10.
      const diaVenc = cliente.vencimento ? new Date(cliente.vencimento).getDate() : 10;
      const vencimento = new Date(Number(anoStr), Number(mesStr) - 1, Math.min(diaVenc, 28), 12, 0, 0);

      await this.prisma.crm_Faturas.create({
        data: {
          id_condominio: cliente.id,
          referencia: ref,
          valor,
          vencimento,
          status: 'pendente',
          estimada,
        },
      });
      criadas++;
    }

    if (criadas > 0) {
      await this.auditoria.registrar({
        id_condominio: 0,
        usuario_nome: operador,
        acao: 'CREATE',
        modulo: 'crm',
        entidade_id: undefined,
        descricao: `Gerou ${criadas} fatura(s) CRM da referência ${ref}`,
        detalhes: { referencia: ref, criadas, clientesAtivos: ativos.length },
      });
    }

    this.logger.log(`[gerarFaturasDoMes] Ref ${ref}: ${criadas} fatura(s) criada(s) de ${ativos.length} cliente(s) ativos.`);
    return { success: true, referencia: ref, criadas, clientesAtivos: ativos.length };
  }

  /** Lista faturas com nome do condomínio e status derivado (vencida). */
  async listarFaturas() {
    if (!this.prisma.isConnected) return [];

    const faturas = await this.prisma.crm_Faturas.findMany({
      orderBy: [{ vencimento: 'desc' }, { id: 'desc' }],
      take: 500,
    });

    const condIds = [...new Set(faturas.map((f) => f.id_condominio))];
    const conds = await this.prisma.condominios.findMany({
      where: { id: { in: condIds } },
      select: { id: true, nome: true },
    });
    const nomePorId = new Map(conds.map((c) => [c.id, c.nome]));

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    return faturas.map((f) => {
      let status = f.status;
      if (status === 'pendente' && f.vencimento && new Date(f.vencimento) < hoje) {
        status = 'vencida';
      }
      return {
        id: f.id,
        clienteId: f.id_condominio,
        condominio: nomePorId.get(f.id_condominio) ?? `Condomínio #${f.id_condominio}`,
        referencia: f.referencia,
        valor: Number(f.valor),
        vencimento: f.vencimento ? f.vencimento.toISOString() : null,
        status,
        metodoPagamento: f.metodo_pagamento,
        dataPagamento: f.data_pagamento ? f.data_pagamento.toISOString() : null,
        baixaPor: f.baixa_por,
        baixaMotivo: f.baixa_motivo,
        estimada: f.estimada,
      };
    });
  }

  /**
   * Baixa manual auditada. Motivo e método obrigatórios; avança o vencimento
   * da assinatura em 1 mês (mantém o statusPagamento do cliente coerente).
   */
  async baixarFatura(
    id: number,
    dados: { metodo?: string; motivo?: string; dataPagamento?: string; valorPago?: number },
    operador: string,
  ) {
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const fatura = await this.prisma.crm_Faturas.findUnique({ where: { id: Number(id) } });
    if (!fatura) throw new NotFoundException(`Fatura ${id} não encontrada`);
    if (fatura.status === 'paga') {
      return { success: true, alreadyPaid: true };
    }

    const metodo = dados.metodo?.trim();
    const motivo = dados.motivo?.trim();
    if (!metodo) throw new BadRequestException('Informe o método de pagamento (Pix, Boleto, Transferência...).');
    if (!motivo || motivo.length < 5) {
      throw new BadRequestException('Informe o motivo/justificativa da baixa manual (mínimo 5 caracteres).');
    }
    if (dados.valorPago !== undefined && Number(dados.valorPago) < Number(fatura.valor) - 0.01) {
      throw new BadRequestException(
        `Valor pago (R$ ${Number(dados.valorPago).toFixed(2)}) menor que o valor da fatura (R$ ${Number(fatura.valor).toFixed(2)}). ` +
        'Baixa parcial não é suportada — ajuste o valor da fatura antes.',
      );
    }

    const dataPagamento = dados.dataPagamento ? new Date(dados.dataPagamento) : new Date();
    if (Number.isNaN(dataPagamento.getTime()) || dataPagamento.getTime() > Date.now() + 24 * 3600 * 1000) {
      throw new BadRequestException('Data de pagamento inválida (não pode ser no futuro).');
    }

    await this.prisma.crm_Faturas.update({
      where: { id: fatura.id },
      data: {
        status: 'paga',
        metodo_pagamento: metodo,
        data_pagamento: dataPagamento,
        baixa_por: operador,
        baixa_motivo: motivo,
      },
    });

    // Avança vencimento da assinatura/condomínio em 1 mês a partir do
    // vencimento da fatura paga (comportamento que o CRM antigo simulava).
    const base = fatura.vencimento ? new Date(fatura.vencimento) : new Date();
    const novoVenc = new Date(base);
    novoVenc.setMonth(novoVenc.getMonth() + 1);
    try {
      const assinatura = await this.prisma.assinaturas_Condominios.findFirst({
        where: { id_condominio: fatura.id_condominio },
        orderBy: [{ data_fim: 'desc' }, { id: 'desc' }],
      });
      if (assinatura) {
        await this.prisma.assinaturas_Condominios.update({
          where: { id: assinatura.id },
          data: { data_fim: novoVenc },
        });
      }
      await this.prisma.condominios.update({
        where: { id: fatura.id_condominio },
        data: { vencimento: novoVenc },
      });
    } catch (err: any) {
      this.logger.warn(`[baixarFatura] Fatura ${id} paga, mas falhou ao avançar vencimento: ${err?.message ?? err}`);
    }

    await this.auditoria.registrar({
      id_condominio: fatura.id_condominio,
      usuario_nome: operador,
      acao: 'STATUS',
      modulo: 'crm',
      entidade_id: fatura.id,
      descricao: `Baixa manual de fatura CRM ${fatura.referencia} — R$ ${Number(fatura.valor).toFixed(2)} (${metodo})`,
      detalhes: {
        fatura: { id: fatura.id, referencia: fatura.referencia, valor: Number(fatura.valor) },
        metodo,
        motivo,
        dataPagamento: dataPagamento.toISOString(),
        novoVencimento: novoVenc.toISOString(),
      },
    });

    return { success: true, novoVencimento: novoVenc.toISOString() };
  }

  // ==========================================
  // Configurações persistidas (key-value)
  // ==========================================
  async getConfig(): Promise<Record<string, string>> {
    if (!this.prisma.isConnected) return {};
    const rows = await this.prisma.crm_Config.findMany();
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  }

  async setConfig(entries: Record<string, unknown>, operador: string) {
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };
    const chaves = Object.keys(entries ?? {});
    if (chaves.length === 0) throw new BadRequestException('Nenhuma configuração enviada.');

    for (const chave of chaves) {
      const valor = String(entries[chave] ?? '');
      await this.prisma.crm_Config.upsert({
        where: { chave },
        create: { chave, valor },
        update: { valor },
      });
    }

    await this.auditoria.registrar({
      id_condominio: 0,
      usuario_nome: operador,
      acao: 'UPDATE',
      modulo: 'crm',
      entidade_id: undefined,
      descricao: `Atualizou configurações do CRM (${chaves.join(', ')})`,
      detalhes: { chaves },
    });

    return { success: true };
  }

  /**
   * Status dos gateways — só informa SE estão configurados; os valores das
   * credenciais vivem em env no Railway e nunca são expostos ao frontend
   * (antes ficavam hardcoded fake no crm-page.component.ts).
   */
  gatewaysStatus() {
    return {
      openpix: !!process.env.OPENPIX_APP_ID,
      openpixWebhook: !!process.env.OPENPIX_WEBHOOK_TOKEN,
      asaasWebhook: !!process.env.ASAAS_WEBHOOK_TOKEN,
      zapi: !!(process.env.Z_API_INSTANCE_ID && process.env.Z_API_TOKEN),
    };
  }

  // ==========================================
  // Disparos WhatsApp reais (Z-API)
  // ==========================================
  async listarDisparos() {
    if (!this.prisma.isConnected) return [];
    const disparos = await this.prisma.crm_Disparos.findMany({
      orderBy: { id: 'desc' },
      take: 100,
    });
    const condIds = [...new Set(disparos.map((d) => d.id_condominio))];
    const conds = await this.prisma.condominios.findMany({
      where: { id: { in: condIds } },
      select: { id: true, nome: true },
    });
    const nomePorId = new Map(conds.map((c) => [c.id, c.nome]));
    return disparos.map((d) => ({
      id: d.id,
      condominio: nomePorId.get(d.id_condominio) ?? `#${d.id_condominio}`,
      idFatura: d.id_fatura,
      tipo: d.tipo,
      telefone: d.telefone,
      status: d.status,
      erro: d.erro_msg,
      data: d.created_at.toISOString(),
    }));
  }

  /** Cobra uma fatura via WhatsApp do síndico, usando o template salvo em Crm_Config. */
  async cobrarWhatsApp(faturaId: number, operador: string) {
    if (!this.prisma.isConnected) return { success: false, message: 'Sem conexão com banco' };

    const fatura = await this.prisma.crm_Faturas.findUnique({ where: { id: Number(faturaId) } });
    if (!fatura) throw new NotFoundException(`Fatura ${faturaId} não encontrada`);

    const cliente = await this.crm.cliente(fatura.id_condominio);
    const telefone = cliente?.contatoPrincipal?.telefone?.replace(/\D/g, '') ?? '';
    if (!telefone || telefone.length < 10) {
      throw new BadRequestException('Cliente sem telefone de síndico cadastrado — cadastre antes de cobrar por WhatsApp.');
    }

    const config = await this.getConfig();
    const template = config['template_cobranca'] ??
      'Olá, *{{sindico}}*! A fatura da Click Prestare do condomínio *{{condominio}}* ' +
      '(ref. {{referencia}}) no valor de {{valor}} vence em {{vencimento}}. Qualquer dúvida estamos à disposição!';

    const valorFmt = Number(fatura.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dados: Record<string, string> = {
      sindico: cliente?.contatoPrincipal?.nome ?? 'Síndico(a)',
      condominio: cliente?.nome ?? `#${fatura.id_condominio}`,
      referencia: fatura.referencia,
      valor: valorFmt,
      vencimento: fatura.vencimento ? new Date(fatura.vencimento).toLocaleDateString('pt-BR') : 'em aberto',
    };
    // Placeholder sem dado vira vazio — nunca deixa "{{variavel}}" cru na mensagem.
    const mensagem = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => dados[k] ?? '');

    let status = 'enviado';
    let erroMsg: string | null = null;
    try {
      const result = await this.notifications.sendWhatsApp(telefone, mensagem);
      if (!result) {
        status = 'falha';
        erroMsg = 'Z-API não configurada ou telefone inválido';
      }
    } catch (err: any) {
      status = 'falha';
      erroMsg = String(err?.message ?? err).slice(0, 500);
    }

    await this.prisma.crm_Disparos.create({
      data: {
        id_condominio: fatura.id_condominio,
        id_fatura: fatura.id,
        tipo: 'cobranca_manual',
        telefone,
        status,
        erro_msg: erroMsg,
        mensagem,
      },
    });

    await this.auditoria.registrar({
      id_condominio: fatura.id_condominio,
      usuario_nome: operador,
      acao: 'CREATE',
      modulo: 'crm',
      entidade_id: fatura.id,
      descricao: `Cobrança via WhatsApp da fatura ${fatura.referencia} — ${status}`,
      detalhes: { telefone, status, erro: erroMsg },
    });

    if (status === 'falha') {
      throw new BadRequestException(`Falha no envio do WhatsApp: ${erroMsg}`);
    }
    return { success: true };
  }
}
