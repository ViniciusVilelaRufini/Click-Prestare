import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as xlsx from 'xlsx';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

const pdfmake = require('pdfmake');

const formatDateTime = (d: Date | null | undefined): string => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateOnly = (d: Date | null | undefined): string => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const getTimestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const getGeradoEmStr = (): string => {
  const d = new Date();
  const dateStr = d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr} às ${timeStr}`;
};

@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    idCondominio: number,
    tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    formato: 'pdf' | 'xlsx',
    dataInicio?: string,
    dataFim?: string
  ): Promise<{ buffer: Buffer; mime: string; filename: string }> {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });
    const nomeCondo = condominio?.nome || 'Condomínio';

    const dateFilter = (dataInicio || dataFim) ? {
      ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
      ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
    } : null;

    if (tipo === 'visitantes') {
      const where: any = { id_condominio: idCondominio };
      if (dateFilter) {
        where.OR = [
          { created_at: dateFilter },
          { data_entrada: dateFilter },
          { data_saida: dateFilter },
          { data_hora_inicio: dateFilter },
        ];
      }

      const list = await this.prisma.visitantes.findMany({
        where,
        include: {
          apartamento: { select: { bloco: true, apto: true } },
          criadoPor: { select: { name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      const excelData = list.map((v) => ({
        Nome: v.nome,
        Documento: v.doc_identificacao || 'Não informado',
        Apartamento: v.apartamento ? `${v.apartamento.apto}${v.apartamento.bloco ?? ''}` : 'Não informado',
        Entrada: v.data_entrada ? formatDateTime(v.data_entrada) : 'Pendente',
        Saída: v.data_entrada ? (v.data_saida ? formatDateTime(v.data_saida) : 'No local') : '-',
        'Autorizado Por': v.criadoPor?.name || 'Morador',
        Criado: formatDateTime(v.created_at),
      }));

      if (formato === 'xlsx') {
        const buffer = this.generateExcel(excelData, 'Visitantes');
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `relatorio_visitantes_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Visitantes - ${nomeCondo}`,
          periodo: this.formatPeriod(dataInicio, dataFim),
          metrics: [
            { label: 'Total de Visitantes', value: list.length.toString() },
            { label: 'Atualmente no Local', value: list.filter((v) => v.data_entrada && !v.data_saida).length.toString() },
          ],
          table: {
            widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              ['Nome', 'Documento', 'Apto', 'Entrada', 'Saída', 'Autorizado Por'].map((h) => ({
                text: h,
                style: 'tableHeader',
              })),
              ...list.map((v) => [
                v.nome,
                v.doc_identificacao || '-',
                v.apartamento ? `${v.apartamento.apto}${v.apartamento.bloco ?? ''}` : '-',
                v.data_entrada ? formatDateTime(v.data_entrada) : '-',
                v.data_entrada ? (v.data_saida ? formatDateTime(v.data_saida) : 'No local') : '-',
                v.criadoPor?.name || 'Morador',
              ]),
            ],
          },
        });
        return {
          buffer,
          mime: 'application/pdf',
          filename: `relatorio_visitantes_${getTimestamp()}.pdf`,
        };
      }
    }

    if (tipo === 'encomendas') {
      const where: any = { id_condominio: idCondominio };
      if (dateFilter) {
        where.OR = [
          { recebido_em: dateFilter },
          { retirado_em: dateFilter },
        ];
      }

      const list = await this.prisma.encomendas.findMany({
        where,
        include: {
          recebidoPor: { select: { name: true } },
          entreguePor: { select: { name: true } },
        },
        orderBy: { recebido_em: 'desc' },
      });

      const excelData = list.map((e) => ({
        Descrição: e.descricao,
        Destinatário: `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`,
        Remetente: e.recebido_de || 'Não informado',
        Recebido: formatDateTime(e.recebido_em),
        Retirado: e.retirado_em ? formatDateTime(e.retirado_em) : 'Aguardando',
        Status: e.status,
        'Recebido Por': e.recebidoPor?.name || 'Sistema',
      }));

      if (formato === 'xlsx') {
        const buffer = this.generateExcel(excelData, 'Encomendas');
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `relatorio_encomendas_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Encomendas - ${nomeCondo}`,
          periodo: this.formatPeriod(dataInicio, dataFim),
          metrics: [
            { label: 'Total de Encomendas', value: list.length.toString() },
            { label: 'Aguardando Retirada', value: list.filter((e) => e.status === 'Aguardando').length.toString() },
            { label: 'Entregues', value: list.filter((e) => e.status === 'Entregue').length.toString() },
          ],
          table: {
            widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              ['Descrição', 'Destinatário', 'Recebido Em', 'Retirado Em', 'Status', 'Recebido Por'].map((h) => ({
                text: h,
                style: 'tableHeader',
              })),
              ...list.map((e) => [
                e.descricao,
                `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`,
                formatDateTime(e.recebido_em),
                e.retirado_em ? formatDateTime(e.retirado_em) : 'Aguardando',
                e.status,
                e.recebidoPor?.name || 'Sistema',
              ]),
            ],
          },
        });
        return {
          buffer,
          mime: 'application/pdf',
          filename: `relatorio_encomendas_${getTimestamp()}.pdf`,
        };
      }
    }

    if (tipo === 'ocorrencias') {
      const where: any = { id_condominio: idCondominio };
      if (dateFilter) {
        where.OR = [
          { created_at: dateFilter },
          { resposta_at: dateFilter },
        ];
      }

      const list = await this.prisma.ocorrencias.findMany({
        where,
        include: {
          criadoPor: { select: { name: true } },
          categoria: { select: { nome: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      const excelData = list.map((o) => ({
        Categoria: o.categoria?.nome || 'Geral',
        Descrição: o.descricao || 'Sem descrição',
        Status: o.status,
        Criado: formatDateTime(o.created_at),
        'Criado Por': o.criadoPor?.name || 'Morador',
        Resposta: o.resposta || 'Sem resposta',
        'Respondido Em': o.resposta_at ? formatDateTime(o.resposta_at) : '-',
      }));

      if (formato === 'xlsx') {
        const buffer = this.generateExcel(excelData, 'Ocorrências');
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `relatorio_ocorrencias_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Ocorrências - ${nomeCondo}`,
          periodo: this.formatPeriod(dataInicio, dataFim),
          metrics: [
            { label: 'Total Registrado', value: list.length.toString() },
            { label: 'Ocorrências Pendentes', value: list.filter((o) => o.status === 'Pendente').length.toString() },
            { label: 'Resolvidas', value: list.filter((o) => o.status === 'Resolvido').length.toString() },
          ],
          table: {
            widths: ['auto', '*', 'auto', 'auto', 'auto'],
            body: [
              ['Categoria', 'Descrição', 'Criado Em', 'Status', 'Criado Por'].map((h) => ({
                text: h,
                style: 'tableHeader',
              })),
              ...list.map((o) => [
                o.categoria?.nome || 'Geral',
                o.descricao || '-',
                formatDateTime(o.created_at),
                o.status,
                o.criadoPor?.name || 'Morador',
              ]),
            ],
          },
        });
        return {
          buffer,
          mime: 'application/pdf',
          filename: `relatorio_ocorrencias_${getTimestamp()}.pdf`,
        };
      }
    }

    // Financeiro
    const where: any = { id_condominio: idCondominio };
    if (dateFilter) {
      where.OR = [
        { created_at: dateFilter },
        { data: dateFilter },
        { data_vencimento: dateFilter },
      ];
    }

    const list = await this.prisma.financeiro.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    const excelData = list.map((f) => {
      const isRevenue = f.tipo?.toUpperCase() === 'C';
      const rawVal = Math.abs(f.valor ? Number(f.valor) : 0);
      return {
        Nome: f.nome || '-',
        Tipo: isRevenue ? 'Receita' : 'Despesa',
        Valor: isRevenue ? rawVal : -rawVal,
        Vencimento: f.data_vencimento ? formatDateOnly(f.data_vencimento) : '-',
        Categoria: f.categoria || 'Geral',
        Status: f.status || (f.pago === 1 ? 'Pago' : 'Pendente'),
        Pagamento: f.forma_pagamento || '-',
      };
    });

    if (formato === 'xlsx') {
      const buffer = this.generateExcel(excelData, 'Financeiro');
      return {
        buffer,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `relatorio_financeiro_${getTimestamp()}.xlsx`,
      };
    } else {
      const totalReceitas = list
        .filter((f) => f.tipo?.toUpperCase() === 'C')
        .reduce((sum, f) => sum + Math.abs(f.valor ? Number(f.valor) : 0), 0);
      const totalDespesas = list
        .filter((f) => f.tipo?.toUpperCase() === 'D')
        .reduce((sum, f) => sum + Math.abs(f.valor ? Number(f.valor) : 0), 0);

      const buffer = await this.generatePdf({
        headerText: `Relatório Financeiro - ${nomeCondo}`,
        periodo: this.formatPeriod(dataInicio, dataFim),
        metrics: [
          { label: 'Total Receitas', value: `R$ ${totalReceitas.toFixed(2)}` },
          { label: 'Total Despesas', value: `R$ ${totalDespesas.toFixed(2)}` },
          { label: 'Balanço Geral', value: `R$ ${(totalReceitas - totalDespesas).toFixed(2)}` },
        ],
        table: {
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Descrição', 'Tipo', 'Valor', 'Vencimento', 'Categoria', 'Status'].map((h) => ({
              text: h,
              style: 'tableHeader',
            })),
            ...list.map((f) => {
              const isRevenue = f.tipo?.toUpperCase() === 'C';
              const rawVal = Math.abs(f.valor ? Number(f.valor) : 0);
              const valStr = isRevenue ? `R$ ${rawVal.toFixed(2)}` : `-R$ ${rawVal.toFixed(2)}`;
              return [
                f.nome || '-',
                isRevenue ? 'Receita' : 'Despesa',
                valStr,
                f.data_vencimento ? formatDateOnly(f.data_vencimento) : '-',
                f.categoria || '-',
                f.status || (f.pago === 1 ? 'Pago' : 'Pendente'),
              ];
            }),
          ],
        },
      });
      return {
        buffer,
        mime: 'application/pdf',
        filename: `relatorio_financeiro_${getTimestamp()}.pdf`,
      };
    }
  }

  private generateExcel(data: any[], sheetName: string): Buffer {
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private async generatePdf(params: {
    headerText: string;
    periodo: string;
    metrics: { label: string; value: string }[];
    table: { widths: any[]; body: any[][] };
  }): Promise<Buffer> {
    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };

    const docDefinition: TDocumentDefinitions = {
      defaultStyle: {
        font: 'Helvetica',
      },
      content: [
        // Cabeçalho Premium
        { text: params.headerText, style: 'header' },
        { text: `Período: ${params.periodo}`, style: 'subheader' },
        { text: `Gerado em: ${getGeradoEmStr()}`, style: 'meta' },
        { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1.5, lineColor: '#E2E8F0' }] },
        { text: '', margin: [0, 15] },

        // Cards de métricas
        {
          table: {
            widths: params.metrics.map(() => '*'),
            body: [
              params.metrics.map((m) => ({
                fillColor: '#F8FAFC',
                borderColor: ['#E2E8F0', '#E2E8F0', '#E2E8F0', '#E2E8F0'],
                stack: [
                  { text: m.label.toUpperCase(), fontSize: 8, color: '#64748B', bold: true },
                  { text: m.value, fontSize: 16, color: '#0F172A', bold: true, margin: [0, 4, 0, 0] },
                ],
                margin: [12, 10],
              })),
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#E2E8F0',
            vLineColor: () => '#E2E8F0',
          },
        },
        { text: '', margin: [0, 15] },

        // Tabela de registros
        {
          table: {
            headerRows: 1,
            widths: params.table.widths,
            body: params.table.body.map((row, rIdx) =>
              row.map((cell) => {
                if (rIdx === 0) return cell; // Se for o header, mantém o estilo do header
                return {
                  text: cell,
                  style: 'tableCell',
                  fillColor: rIdx % 2 === 0 ? '#F8FAFC' : '#FFFFFF',
                };
              })
            ),
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0,
            hLineColor: () => '#E2E8F0',
          },
        },
      ],
      footer: (currentPage, pageCount) => {
        return {
          columns: [
            { text: 'Gerado pelo Sistema Click com Prestare', alignment: 'left', fontSize: 8, color: '#94A3B8' },
            { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right', fontSize: 8, color: '#94A3B8' },
          ],
          margin: [40, 15, 40, 0],
        };
      },
      styles: {
        header: {
          fontSize: 20,
          bold: true,
          color: '#0F172A',
        },
        subheader: {
          fontSize: 11,
          color: '#475569',
          margin: [0, 4, 0, 0],
        },
        meta: {
          fontSize: 9,
          color: '#94A3B8',
          margin: [0, 2, 0, 8],
        },
        tableHeader: {
          fontSize: 10,
          bold: true,
          color: '#FFFFFF',
          fillColor: '#0F172A',
          margin: [6, 8],
        },
        tableCell: {
          fontSize: 9,
          color: '#334155',
          margin: [6, 6],
        },
      },
      pageMargins: [40, 40, 40, 60],
    };

    pdfmake.setFonts(fonts);
    const doc = pdfmake.createPdf(docDefinition);
    return await doc.getBuffer();
  }

  private formatPeriod(start?: string, end?: string): string {
    if (!start && !end) return 'Todo o histórico';
    const s = start ? formatDateOnly(new Date(`${start}T00:00:00.000-03:00`)) : 'Início';
    const e = end ? formatDateOnly(new Date(`${end}T00:00:00.000-03:00`)) : 'Hoje';
    return `${s} até ${e}`;
  }

  async getAuditoria(
    idCondominio: number,
    modulo?: string,
    dataInicio?: string,
    dataFim?: string,
    take = 200,
  ) {
    if (!this.prisma.isConnected) {
      return [];
    }

    const where: any = { id_condominio: idCondominio };

    if (modulo && modulo !== 'todos') {
      where.modulo = modulo;
    }

    if (dataInicio || dataFim) {
      where.created_at = {
        ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
        ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
      };
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take,
    });
  }
}
