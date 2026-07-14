const xlsx = require('xlsx');
const pdfmake = require('pdfmake');
const db = require('../database/DB_Relatorios');

// --- Formatação (mesma do NestJS, fuso America/Sao_Paulo) ------------------
function formatDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function formatDateOnly(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
function getTimestamp() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function getGeradoEmStr() {
  const d = new Date();
  const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${dateStr} às ${timeStr}`;
}
function formatPeriod(start, end) {
  if (!start && !end) return 'Todo o histórico';
  const s = start ? formatDateOnly(new Date(`${start}T00:00:00.000-03:00`)) : 'Início';
  const e = end ? formatDateOnly(new Date(`${end}T00:00:00.000-03:00`)) : 'Hoje';
  return `${s} até ${e}`;
}

function generateExcel(data, sheetName) {
  const ws = xlsx.utils.json_to_sheet(data);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function generatePdf({ headerText, periodo, metrics, table }) {
  const fonts = {
    Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  };
  const docDefinition = {
    defaultStyle: { font: 'Helvetica' },
    content: [
      { text: headerText, style: 'header' },
      { text: `Período: ${periodo}`, style: 'subheader' },
      { text: `Gerado em: ${getGeradoEmStr()}`, style: 'meta' },
      { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1.5, lineColor: '#E2E8F0' }] },
      { text: '', margin: [0, 15] },
      {
        table: {
          widths: metrics.map(() => '*'),
          body: [
            metrics.map((m) => ({
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
        layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0' },
      },
      { text: '', margin: [0, 15] },
      {
        table: {
          headerRows: 1,
          widths: table.widths,
          body: table.body.map((row, rIdx) =>
            row.map((cell) => {
              if (rIdx === 0) return cell;
              return { text: cell, style: 'tableCell', fillColor: rIdx % 2 === 0 ? '#F8FAFC' : '#FFFFFF' };
            })
          ),
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#E2E8F0' },
      },
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'Gerado pelo Sistema Click com Prestare', alignment: 'left', fontSize: 8, color: '#94A3B8' },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right', fontSize: 8, color: '#94A3B8' },
      ],
      margin: [40, 15, 40, 0],
    }),
    styles: {
      header: { fontSize: 20, bold: true, color: '#0F172A' },
      subheader: { fontSize: 11, color: '#475569', margin: [0, 4, 0, 0] },
      meta: { fontSize: 9, color: '#94A3B8', margin: [0, 2, 0, 8] },
      tableHeader: { fontSize: 10, bold: true, color: '#FFFFFF', fillColor: '#0F172A', margin: [6, 8] },
      tableCell: { fontSize: 9, color: '#334155', margin: [6, 6] },
    },
    pageMargins: [40, 40, 40, 60],
  };

  pdfmake.setFonts(fonts);
  const doc = pdfmake.createPdf(docDefinition);
  return await doc.getBuffer();
}

function apto(row) {
  if (!row.apto) return 'Não informado';
  return `${row.apto}${row.bloco ?? ''}`;
}

/**
 * Gera o relatório. Retorna { buffer, mime, filename }.
 */
async function generate(idCondominio, tipo, formato, dataInicio, dataFim) {
  const nomeCondo = await db.getCondominioNome(idCondominio);
  const start = dataInicio ? `${dataInicio} 00:00:00` : null;
  const end = dataFim ? `${dataFim} 23:59:59` : null;
  const periodo = formatPeriod(dataInicio, dataFim);

  if (tipo === 'visitantes') {
    const list = await db.getVisitantes(idCondominio, start, end);
    if (formato === 'xlsx') {
      const data = list.map((v) => ({
        Nome: v.nome,
        Documento: v.doc_identificacao || 'Não informado',
        Apartamento: apto(v),
        Entrada: v.data_entrada ? formatDateTime(v.data_entrada) : 'Pendente',
        'Saída': v.data_entrada ? (v.data_saida ? formatDateTime(v.data_saida) : 'No local') : '-',
        'Autorizado Por': v.criado_por || 'Morador',
        Criado: formatDateTime(v.created_at),
      }));
      return { buffer: generateExcel(data, 'Visitantes'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `relatorio_visitantes_${getTimestamp()}.xlsx` };
    }
    const buffer = await generatePdf({
      headerText: `Relatório de Visitantes - ${nomeCondo}`,
      periodo,
      metrics: [
        { label: 'Total de Visitantes', value: String(list.length) },
        { label: 'Atualmente no Local', value: String(list.filter((v) => v.data_entrada && !v.data_saida).length) },
      ],
      table: {
        widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
        body: [
          ['Nome', 'Documento', 'Apto', 'Entrada', 'Saída', 'Autorizado Por'].map((h) => ({ text: h, style: 'tableHeader' })),
          ...list.map((v) => [
            v.nome,
            v.doc_identificacao || '-',
            apto(v) === 'Não informado' ? '-' : apto(v),
            v.data_entrada ? formatDateTime(v.data_entrada) : '-',
            v.data_entrada ? (v.data_saida ? formatDateTime(v.data_saida) : 'No local') : '-',
            v.criado_por || 'Morador',
          ]),
        ],
      },
    });
    return { buffer, mime: 'application/pdf', filename: `relatorio_visitantes_${getTimestamp()}.pdf` };
  }

  if (tipo === 'encomendas') {
    const list = await db.getEncomendas(idCondominio, start, end);
    if (formato === 'xlsx') {
      const data = list.map((e) => ({
        'Descrição': e.descricao,
        'Destinatário': `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`,
        Remetente: e.recebido_de || 'Não informado',
        Recebido: formatDateTime(e.recebido_em),
        Retirado: e.retirado_em ? formatDateTime(e.retirado_em) : 'Aguardando',
        Status: e.status,
        'Recebido Por': e.recebido_por || 'Sistema',
      }));
      return { buffer: generateExcel(data, 'Encomendas'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `relatorio_encomendas_${getTimestamp()}.xlsx` };
    }
    const buffer = await generatePdf({
      headerText: `Relatório de Encomendas - ${nomeCondo}`,
      periodo,
      metrics: [
        { label: 'Total de Encomendas', value: String(list.length) },
        { label: 'Aguardando Retirada', value: String(list.filter((e) => e.status === 'Aguardando').length) },
        { label: 'Entregues', value: String(list.filter((e) => e.status === 'Entregue' || e.status === 'Retirada').length) },
      ],
      table: {
        widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
        body: [
          ['Descrição', 'Destinatário', 'Recebido Em', 'Retirado Em', 'Status', 'Recebido Por'].map((h) => ({ text: h, style: 'tableHeader' })),
          ...list.map((e) => [
            e.descricao,
            `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`,
            formatDateTime(e.recebido_em),
            e.retirado_em ? formatDateTime(e.retirado_em) : 'Aguardando',
            e.status,
            e.recebido_por || 'Sistema',
          ]),
        ],
      },
    });
    return { buffer, mime: 'application/pdf', filename: `relatorio_encomendas_${getTimestamp()}.pdf` };
  }

  if (tipo === 'ocorrencias') {
    const list = await db.getOcorrencias(idCondominio, start, end);
    if (formato === 'xlsx') {
      const data = list.map((o) => ({
        Categoria: o.categoria || 'Geral',
        'Descrição': o.descricao || 'Sem descrição',
        Status: o.status,
        Criado: formatDateTime(o.created_at),
        'Criado Por': o.criado_por || 'Morador',
        Resposta: o.resposta || 'Sem resposta',
        'Respondido Em': o.resposta_at ? formatDateTime(o.resposta_at) : '-',
      }));
      return { buffer: generateExcel(data, 'Ocorrências'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `relatorio_ocorrencias_${getTimestamp()}.xlsx` };
    }
    const buffer = await generatePdf({
      headerText: `Relatório de Ocorrências - ${nomeCondo}`,
      periodo,
      metrics: [
        { label: 'Total Registrado', value: String(list.length) },
        { label: 'Ocorrências Pendentes', value: String(list.filter((o) => o.status === 'Pendente').length) },
        { label: 'Resolvidas', value: String(list.filter((o) => o.status === 'Resolvido').length) },
      ],
      table: {
        widths: ['auto', '*', 'auto', 'auto', 'auto'],
        body: [
          ['Categoria', 'Descrição', 'Criado Em', 'Status', 'Criado Por'].map((h) => ({ text: h, style: 'tableHeader' })),
          ...list.map((o) => [
            o.categoria || 'Geral',
            o.descricao || '-',
            formatDateTime(o.created_at),
            o.status,
            o.criado_por || 'Morador',
          ]),
        ],
      },
    });
    return { buffer, mime: 'application/pdf', filename: `relatorio_ocorrencias_${getTimestamp()}.pdf` };
  }

  // Financeiro
  const list = await db.getFinanceiro(idCondominio, start, end);
  if (formato === 'xlsx') {
    const data = list.map((f) => {
      const isRevenue = (f.tipo || '').toUpperCase() === 'C';
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
    return { buffer: generateExcel(data, 'Financeiro'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `relatorio_financeiro_${getTimestamp()}.xlsx` };
  }
  const totalReceitas = list.filter((f) => (f.tipo || '').toUpperCase() === 'C').reduce((s, f) => s + Math.abs(f.valor ? Number(f.valor) : 0), 0);
  const totalDespesas = list.filter((f) => (f.tipo || '').toUpperCase() === 'D').reduce((s, f) => s + Math.abs(f.valor ? Number(f.valor) : 0), 0);
  const buffer = await generatePdf({
    headerText: `Relatório Financeiro - ${nomeCondo}`,
    periodo,
    metrics: [
      { label: 'Total Receitas', value: `R$ ${totalReceitas.toFixed(2)}` },
      { label: 'Total Despesas', value: `R$ ${totalDespesas.toFixed(2)}` },
      { label: 'Balanço Geral', value: `R$ ${(totalReceitas - totalDespesas).toFixed(2)}` },
    ],
    table: {
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Descrição', 'Tipo', 'Valor', 'Vencimento', 'Categoria', 'Status'].map((h) => ({ text: h, style: 'tableHeader' })),
        ...list.map((f) => {
          const isRevenue = (f.tipo || '').toUpperCase() === 'C';
          const rawVal = Math.abs(f.valor ? Number(f.valor) : 0);
          return [
            f.nome || '-',
            isRevenue ? 'Receita' : 'Despesa',
            isRevenue ? `R$ ${rawVal.toFixed(2)}` : `-R$ ${rawVal.toFixed(2)}`,
            f.data_vencimento ? formatDateOnly(f.data_vencimento) : '-',
            f.categoria || '-',
            f.status || (f.pago === 1 ? 'Pago' : 'Pendente'),
          ];
        }),
      ],
    },
  });
  return { buffer, mime: 'application/pdf', filename: `relatorio_financeiro_${getTimestamp()}.pdf` };
}

module.exports = { generate };
