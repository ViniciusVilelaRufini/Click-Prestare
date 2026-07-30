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
    // Fora do relatório: conta pessoal do morador (tipo 'D' com id_usuario —
    // água, luz, internet que ele lança para si no app). É dado privado dele,
    // não movimento do condomínio, e saía no XLSX/PDF do síndico.
    const where: any = {
      id_condominio: idCondominio,
      NOT: { AND: [{ tipo: 'D' }, { id_usuario: { not: null } }] },
    };
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
    page = 1,
    pageSize = 50,
  ) {
    if (!this.prisma.isConnected) {
      return { items: [], total: 0, page, pageSize };
    }

    const where = this.buildAuditWhere(idCondominio, modulo, dataInicio, dataFim);
    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const safePage = Math.max(page, 1);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page: safePage, pageSize: safeSize };
  }

  /**
   * Export CSV do log filtrado. Ignora paginação — exporta tudo que bate
   * com o filtro até um teto seguro (10k linhas) para não estourar memória.
   * Pra exports maiores, o operador deve filtrar por data primeiro.
   */
  async exportAuditoriaCsv(
    idCondominio: number,
    modulo?: string,
    dataInicio?: string,
    dataFim?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!this.prisma.isConnected) {
      return { buffer: Buffer.from('Data\n'), filename: 'auditoria_vazia.csv' };
    }

    const where = this.buildAuditWhere(idCondominio, modulo, dataInicio, dataFim);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 10_000,
    });

    const header = ['Data', 'Usuário', 'E-mail', 'Ação', 'Módulo', 'Entidade', 'Descrição', 'IP', 'Detalhes'];
    const lines = [header.map(this.csvEscape).join(',')];

    for (const r of rows) {
      lines.push(
        [
          r.created_at?.toISOString() ?? '',
          r.usuario_nome ?? '',
          r.usuario_email ?? '',
          r.acao ?? '',
          r.modulo ?? '',
          r.entidade_id != null ? String(r.entidade_id) : '',
          r.descricao ?? '',
          r.ip ?? '',
          r.detalhes ?? '',
        ]
          .map(this.csvEscape)
          .join(','),
      );
    }

    // BOM para o Excel abrir UTF-8 sem corromper acento.
    const csv = '﻿' + lines.join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(csv, 'utf8'),
      filename: `auditoria_${idCondominio}_${stamp}.csv`,
    };
  }

  private buildAuditWhere(
    idCondominio: number,
    modulo?: string,
    dataInicio?: string,
    dataFim?: string,
  ) {
    const where: any = { id_condominio: idCondominio };
    if (modulo && modulo !== 'todos') where.modulo = modulo;
    if (dataInicio || dataFim) {
      where.created_at = {
        ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
        ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
      };
    }
    return where;
  }

  private csvEscape(value: string): string {
    if (value == null) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  async getEventos(
    idCondominio: number,
    dataInicio?: string,
    dataFim?: string,
    page = 1,
    pageSize = 50,
    search?: string,
  ) {
    if (!this.prisma.isConnected) {
      return { items: [], total: 0, page, pageSize };
    }

    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const safePage = Math.max(page, 1);

    const dateFilter = (dataInicio || dataFim) ? {
      ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
      ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
    } : null;

    const limitPerSource = 2000;

    const [entradasVisitantes, saidasVisitantes, encomendas, ocorrencias, acessosFacial, auditLogs, devicesInfo] = await Promise.all([
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          NOT: { data_entrada: null },
          ...(dateFilter ? { data_entrada: dateFilter } : {}),
          ...(search ? {
            OR: [
              { nome: { contains: search } },
              { doc_identificacao: { contains: search } }
            ]
          } : {})
        },
        orderBy: { data_entrada: 'desc' },
        take: limitPerSource,
        include: {
          apartamento: { select: { bloco: true, apto: true } },
          criadoPor: { select: { name: true } },
        },
      }),
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          NOT: { data_saida: null },
          ...(dateFilter ? { data_saida: dateFilter } : {}),
          ...(search ? {
            OR: [
              { nome: { contains: search } },
              { doc_identificacao: { contains: search } }
            ]
          } : {})
        },
        orderBy: { data_saida: 'desc' },
        take: limitPerSource,
        include: {
          apartamento: { select: { bloco: true, apto: true } },
          criadoPor: { select: { name: true } },
        },
      }),
      this.prisma.encomendas.findMany({
        where: {
          id_condominio: idCondominio,
          ...(dateFilter ? { recebido_em: dateFilter } : {}),
          // `destinatario_nome` NAO EXISTE no modelo Encomendas — o Prisma
          // rejeita campo desconhecido, entao buscar no relatorio de eventos
          // estourava em runtime. O destinatario e identificado por apto/bloco,
          // e quem entregou fica em `recebido_de`.
          ...(search ? {
            OR: [
              { descricao: { contains: search } },
              { destinatario_apto: { contains: search } },
              { recebido_de: { contains: search } },
            ]
          } : {})
        },
        orderBy: { recebido_em: 'desc' },
        take: limitPerSource,
        include: {
          recebidoPor: { select: { name: true } },
          entreguePor: { select: { name: true } },
        },
      }),
      this.prisma.ocorrencias.findMany({
        where: {
          id_condominio: idCondominio,
          ...(dateFilter ? { created_at: dateFilter } : {}),
          ...(search ? { descricao: { contains: search } } : {})
        },
        orderBy: { created_at: 'desc' },
        take: limitPerSource,
        include: {
          criadoPor: { select: { name: true } },
          categoria: { select: { nome: true } },
        },
      }),
      this.prisma.acessos_Facial.findMany({
        where: {
          id_condominio: idCondominio,
          ...(dateFilter ? { timestamp: dateFilter } : {}),
          ...(search ? { nome_pessoa: { contains: search } } : {})
        },
        orderBy: { timestamp: 'desc' },
        take: limitPerSource,
      }),
      this.prisma.auditLog.findMany({
        where: {
          id_condominio: idCondominio,
          modulo: 'dispositivos',
          ...(dateFilter ? { created_at: dateFilter } : {}),
          ...(search ? { descricao: { contains: search } } : {})
        },
        orderBy: { created_at: 'desc' },
        take: limitPerSource,
      }),
      this.prisma.facial_Devices.findMany({
        where: { id_condominio: idCondominio },
        select: { id: true, nome: true },
      }),
    ]);

    const deviceById = new Map(devicesInfo.map((d) => [d.id, d.nome]));

    const ultimosEventos: any[] = [];

    const DEDUP_WINDOW_MS = 15_000;
    const facialKeys = new Set<string>();
    for (const a of acessosFacial) {
      if (a.tipo_pessoa !== 'visitante' && a.tipo_pessoa !== 'prestador') continue;
      const bucket = Math.floor(a.timestamp.getTime() / DEDUP_WINDOW_MS);
      facialKeys.add(`${a.id_pessoa}:${a.evento}:${bucket}`);
      facialKeys.add(`${a.id_pessoa}:${a.evento}:${bucket - 1}`);
      facialKeys.add(`${a.id_pessoa}:${a.evento}:${bucket + 1}`);
    }

    const isDuplicadoFacial = (idVisitante: number, evento: 'entrada' | 'saida', ts: Date | null) => {
      if (!ts) return false;
      const bucket = Math.floor(ts.getTime() / DEDUP_WINDOW_MS);
      return facialKeys.has(`${idVisitante}:${evento}:${bucket}`);
    };

    // 1. Map Visitantes Entradas
    for (const v of entradasVisitantes) {
      if (!v.data_entrada) continue;
      if (isDuplicadoFacial(v.id, 'entrada', v.data_entrada)) continue;
      const aptoStr = v.apartamento ? `Apto ${v.apartamento.apto}${v.apartamento.bloco ?? ''}` : '';
      ultimosEventos.push({
        id: `visitante-ent-${v.id}`,
        tipo: v.is_prestador === 1 ? 'Prestador' : 'Visitante',
        descricao: `${v.nome} entrou — ${aptoStr}`.trim(),
        quando: v.data_entrada.toISOString(),
        direcao: 'entrada',
        detalhes: {
          id: v.id,
          nome: v.nome,
          documento: v.doc_identificacao || 'Não informado',
          blocoApto: aptoStr || 'Não informado',
          tipoPessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
          dataEntrada: v.data_entrada ? v.data_entrada.toISOString() : undefined,
          dataSaida: v.data_saida ? v.data_saida.toISOString() : undefined,
          status: v.data_saida ? 'Saída registrada' : 'No local',
          autorizadoPor: v.criadoPor?.name || 'Morador',
          fotoPessoa: v.foto_pessoa || undefined,
          fotoDocumento: v.foto_documento || undefined,
          metodoLiberacao: 'pin',
          metodoLabel: 'PIN / Manual',
        },
      });
    }

    // 2. Map Visitantes Saídas
    for (const v of saidasVisitantes) {
      if (!v.data_saida) continue;
      if (isDuplicadoFacial(v.id, 'saida', v.data_saida)) continue;
      const aptoStr = v.apartamento ? `Apto ${v.apartamento.apto}${v.apartamento.bloco ?? ''}` : '';
      ultimosEventos.push({
        id: `visitante-sai-${v.id}`,
        tipo: v.is_prestador === 1 ? 'Prestador' : 'Visitante',
        descricao: `${v.nome} saiu — ${aptoStr}`.trim(),
        quando: v.data_saida.toISOString(),
        direcao: 'saida',
        detalhes: {
          id: v.id,
          nome: v.nome,
          documento: v.doc_identificacao || 'Não informado',
          blocoApto: aptoStr || 'Não informado',
          tipoPessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
          dataEntrada: v.data_entrada ? v.data_entrada.toISOString() : undefined,
          dataSaida: v.data_saida.toISOString(),
          status: 'Saiu',
          autorizadoPor: v.criadoPor?.name || 'Morador',
          fotoPessoa: v.foto_pessoa || undefined,
          fotoDocumento: v.foto_documento || undefined,
          metodoLiberacao: 'pin',
          metodoLabel: 'PIN / Manual',
        },
      });
    }

    // 3. Map Encomendas
    for (const e of encomendas) {
      const aptoStr = `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`;
      ultimosEventos.push({
        id: `encomenda-${e.id}`,
        tipo: 'Encomenda',
        descricao: `${e.descricao} — ${aptoStr}`,
        quando: e.recebido_em.toISOString(),
        detalhes: {
          id: e.id,
          // Nao ha nome de destinatario no modelo: a encomenda e endereçada a
          // uma UNIDADE. `e.destinatario_nome` e `e.entregador_nome` nao
          // existem — vinham como undefined, deixando as colunas vazias no
          // relatorio e "Courier" fixo em todas as linhas.
          nome: aptoStr,
          blocoApto: aptoStr,
          recebidoDe: e.recebido_de || 'Courier',
          dataEntrada: e.recebido_em.toISOString(),
          status: e.status,
          recebidoPor: e.recebidoPor?.name || 'Sistema',
          retiradoPor: e.entreguePor?.name || undefined,
        },
      });
    }

    // 4. Map Ocorrências
    for (const o of ocorrencias) {
      ultimosEventos.push({
        id: `ocorrencia-${o.id}`,
        tipo: 'Ocorrência',
        descricao: o.descricao ?? '—',
        quando: o.created_at.toISOString(),
        detalhes: {
          id: o.id,
          nome: o.categoria?.nome || 'Geral',
          descricao: o.descricao || 'Sem descrição',
          status: o.status,
          dataEntrada: o.created_at.toISOString(),
          autorizadoPor: o.criadoPor?.name || 'Morador',
          resposta: o.resposta || undefined,
          dataSaida: o.resposta_at ? o.resposta_at.toISOString() : undefined,
        },
      });
    }

    // 5. Map Dispositivos (AuditLog)
    for (const a of auditLogs) {
      const isOffline = a.acao === 'OFFLINE';
      ultimosEventos.push({
        id: `dispositivo-${a.id}`,
        tipo: 'Ocorrência',
        descricao: a.descricao,
        quando: a.created_at.toISOString(),
        direcao: isOffline ? 'saida' : 'entrada',
        detalhes: {
          id: a.id,
          nome: 'Dispositivos',
          descricao: a.descricao,
          status: isOffline ? 'Offline' : 'Resolvido',
          dataEntrada: a.created_at.toISOString(),
          autorizadoPor: 'Monitor de Dispositivos',
        },
      });
    }

    // 6. Map Acessos Faciais
    if (acessosFacial.length > 0) {
      const idsMorador = acessosFacial
        .filter((a) => a.tipo_pessoa === 'morador')
        .map((a) => a.id_pessoa)
        .filter((id): id is number => id !== null);
      const idsVisitante = acessosFacial
        .filter((a) => a.tipo_pessoa === 'visitante' || a.tipo_pessoa === 'prestador')
        .map((a) => a.id_pessoa)
        .filter((id): id is number => id !== null);
      const idsFuncionario = acessosFacial
        .filter((a) => a.tipo_pessoa === 'funcionario')
        .map((a) => a.id_pessoa)
        .filter((id): id is number => id !== null);

      const [moradoresInfo, visitantesInfo, funcionariosInfo] = await Promise.all([
        idsMorador.length > 0
          ? this.prisma.moradores.findMany({
              where: { id: { in: idsMorador } },
              select: {
                id: true,
                foto_pessoa: true,
                bloco: true,
                apartamento: true,
                user: { select: { photo: true } },
              },
            })
          : Promise.resolve([]),
        idsVisitante.length > 0
          ? this.prisma.visitantes.findMany({
              where: { id: { in: idsVisitante } },
              select: {
                id: true,
                foto_pessoa: true,
                doc_identificacao: true,
                apartamento: { select: { bloco: true, apto: true } },
              },
            })
          : Promise.resolve([]),
        idsFuncionario.length > 0
          ? this.prisma.prestadores_servico.findMany({
              where: { id: { in: idsFuncionario } },
              select: {
                id: true,
                foto_pessoa: true,
                apartamento: { select: { bloco: true, apto: true } },
              },
            })
          : Promise.resolve([]),
      ]);

      const moradorById = new Map(moradoresInfo.map((m) => [m.id, m]));
      const visitanteById = new Map(visitantesInfo.map((v) => [v.id, v]));
      const funcionarioById = new Map(funcionariosInfo.map((f) => [f.id, f]));

      for (const a of acessosFacial) {
        const confiancaPct = a.confianca != null ? ` · ${Math.round(a.confianca * 100)}%` : '';
        const acao =
          a.evento === 'saida' ? 'saiu' :
          a.evento === 'negado' ? 'tentou acesso (negado)' :
          a.evento === 'acionado_manual' ? 'acionou manualmente' :
          a.evento === 'falha_acionamento' ? 'tentou acionar (falhou)' :
          'entrou';

        const dispLabel = labelDispositivo(a.tipo_dispositivo);
        const dispMetodoLabel = labelMetodoDispositivo(a.tipo_dispositivo);

        let foto: string | undefined;
        let aptoStr = '';
        let documento: string | undefined;

        // `id_pessoa` e opcional no registro de acesso; sem ele nao ha quem
        // procurar nos mapas.
        const idPessoa = a.id_pessoa ?? -1;
        if (a.tipo_pessoa === 'morador') {
          const m = moradorById.get(idPessoa);
          foto = m?.foto_pessoa ?? m?.user?.photo ?? undefined;
          if (m?.bloco || m?.apartamento) {
            aptoStr = `Apto ${m?.apartamento ?? ''}${m?.bloco ?? ''}`.trim();
          }
        } else if (a.tipo_pessoa === 'visitante' || a.tipo_pessoa === 'prestador') {
          const v = visitanteById.get(idPessoa);
          foto = v?.foto_pessoa ?? undefined;
          documento = v?.doc_identificacao ?? undefined;
          if (v?.apartamento) {
            aptoStr = `Apto ${v.apartamento.apto ?? ''}${v.apartamento.bloco ?? ''}`.trim();
          }
        } else if (a.tipo_pessoa === 'funcionario') {
          const f = funcionarioById.get(idPessoa);
          foto = f?.foto_pessoa ?? undefined;
          if (f?.apartamento) {
            aptoStr = `Apto ${f.apartamento.apto ?? ''}${f.apartamento.bloco ?? ''}`.trim();
          }
        }

        const terminalNome = deviceById.get(a.id_device) ?? `Terminal #${a.id_device}`;

        ultimosEventos.push({
          id: `facial-access-${a.id}`,
          tipo: 'Acesso Facial',
          descricao: `${a.nome_pessoa.toUpperCase()} ${acao} ${dispLabel} "${terminalNome}"${confiancaPct}`,
          quando: a.timestamp.toISOString(),
          direcao: a.evento === 'saida' ? 'saida' : a.evento === 'negado' ? 'bloqueado' : 'entrada',
          detalhes: {
            id: a.id,
            nome: a.nome_pessoa,
            documento,
            blocoApto: aptoStr,
            tipoPessoa: a.tipo_pessoa,
            fotoPessoa: foto,
            metodoLiberacao: a.tipo_dispositivo,
            metodoLabel: dispMetodoLabel,
            terminalNome,
            confianca: a.confianca ?? undefined,
            dataEntrada: a.timestamp.toISOString(),
          },
        });
      }
    }

    const sorted = ultimosEventos.sort(
      (a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime()
    );

    const total = sorted.length;
    const pageItems = sorted.slice((safePage - 1) * safeSize, safePage * safeSize);

    return {
      items: pageItems,
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }
}

function labelDispositivo(tipo?: string | null): string {
  switch (tipo) {
    case 'catraca': return 'catraca';
    case 'botoeira': return 'botoeira';
    case 'tag_reader': return 'leitor de tag RFID';
    case 'qrcode_reader': return 'leitor de QR Code';
    case 'lpr': return 'câmera LPR';
    case 'facial':
    default: return 'terminal facial';
  }
}

function labelMetodoDispositivo(tipo?: string | null): string {
  switch (tipo) {
    case 'catraca': return 'Catraca Eletrônica';
    case 'botoeira': return 'Botoeira';
    case 'tag_reader': return 'Leitor de Tag RFID';
    case 'qrcode_reader': return 'Leitor de QR Code';
    case 'lpr': return 'Câmera LPR';
    case 'facial':
    default: return 'Terminal Facial';
  }
}
