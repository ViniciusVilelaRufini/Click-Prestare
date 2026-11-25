import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as xlsx from 'xlsx';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { pessoasMigrationEnabled } from '../common/pessoas-migration.util';
import { resolverInfoVisitantesPorIdAcessoFacial } from '../common/acesso-facial-visitante-lookup.util';
import { csvCelula, linhaCsv } from '../common/csv.util';
import {
  mascararDocumento,
  redigirDetalhesAuditoriaCsv,
  rotuloAcaoAuditoria,
  rotuloModuloAuditoria,
} from './auditoria-rotulos.util';
import { autorOcorrencia } from '../ocorrencias/autor-ocorrencia.util';
import { formatarApto } from '../common/formatar-apto.util';
import { normalizarBloco, rotuloBloco } from '../common/rotulo-bloco.util';
import { AuditoriaService, type AuditoriaAutorTipo } from '../auditoria/auditoria.service';
import { ocorrenciaSolucionada as solucionada } from '../common/status-ocorrencia.util';
import {
  FiltroEspinha,
  FonteEvento,
  LinhaEspinha,
  montarSqlEspinha,
  montarSqlTotal,
  resolverPeriodoEventos,
} from './eventos-espinha';
import { cabecalhoMarca, fileteMarca, PDF_COR, temaPdf, travarAcessosPdf } from './pdf-tema';
import {
  ehDespesaNoLivroCaixa,
  ehTaxaCondominialDeApto,
  lancamentoPago,
  nomeFaturaDeApto,
  lancamentoRenegociado,
  valorNoLivroCaixa,
} from '../financeiro/livro-caixa-criterio.util';

/** Quem exporta o log de auditoria (vai para o rastro EXPORT). */
export interface SolicitanteExportAuditoria {
  nome?: string;
  email?: string;
  autor_id?: number | null;
  autor_tipo?: AuditoriaAutorTipo | null;
}

/** Opções do relatório financeiro. Todas opcionais: o app publicado não manda nenhuma. */
export interface OpcoesRelatorioFinanceiro {
  /** Reinclui as taxas condominiais apto a apto (padrão: fora, como no Livro Caixa). */
  incluirTaxasCondominiais?: boolean;
}

/**
 * Módulos do log que só o síndico lê: os detalhes trazem valores, nomes e
 * telefone de cobrança (sigilo financeiro / LGPD).
 *
 * `auth` entra porque as linhas de LOGIN/LOGIN_FALHA trazem o login digitado e
 * o IP de outras contas, inclusive tentativas contra a conta do síndico. As
 * duas grafias aparecem porque um service antigo grava `AUTH` em maiúsculas e a
 * comparação do `notIn` depende da colação da coluna.
 */
const MODULOS_AUDITORIA_SIGILOSOS = ['financeiro', 'crm', 'crm-condominio', 'superlogica', 'auth', 'AUTH'];

/**
 * Linhas que carregam o texto da ocorrência (descricao/detalhes). O funcionário do app sem a flag
 * `ocorrencias` não as lê (TenantAccessService.recorteOcorrenciasPrivadas).
 */
const MODULOS_AUDITORIA_OCORRENCIAS = ['ocorrencias'];

/**
 * Módulos que a tela oferece como um assunto só, mas que os services gravam
 * com nomes vizinhos. Filtrar por igualdade perdia essas linhas.
 */
const GRUPOS_MODULO_AUDITORIA: Record<string, string[]> = {
  visitantes: ['visitantes', 'visitas', 'pessoas'],
  facial: ['facial', 'facial-health', 'dispositivos'],
  auth: ['auth', 'AUTH'],
  credenciais: ['credenciais', 'wallet'],
  delivery: ['delivery', 'entrega'],
};

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

/** Auditoria em CSV: horário de Brasília com segundos (o log é de segundos). */
const formatDateTimeSegundos = (d: Date | null | undefined): string => {
  if (!d) return '';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const LIMITE_CSV_AUDITORIA = 10_000;

const formatDateOnly = (d: Date | null | undefined): string => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/**
 * Coluna @db.Date (`data`, `data_vencimento`): o Prisma devolve meia-noite
 * UTC, que em America/Sao_Paulo é o dia anterior — o vencimento 20/11 saía
 * como 19/11. Formata em UTC; nulo: '-'.
 */
const formatDiaDb = (d: Date | null | undefined): string => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
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

/** Quem baixou: autor do token (`autorDoToken`) e IP da requisição. */
export interface SolicitanteRelatorio {
  nome?: string;
  email?: string;
  autor_id?: number | null;
  autor_tipo?: AuditoriaAutorTipo | null;
  ip?: string;
}

@Injectable()
export class RelatoriosService {
  constructor(
    private readonly prisma: PrismaService,
    // Opcional: vários specs instanciam o service só com o prisma.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /**
   * Gera o relatório e deixa o rastro do download (LGPD): tipo, formato, filtros, linhas, autor e IP.
   * O `AuditInterceptor` ignora GET, então o registro tem que sair daqui.
   */
  async generate(
    idCondominio: number,
    tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    formato: 'pdf' | 'xlsx',
    dataInicio?: string,
    dataFim?: string,
    bloco?: string,
    apto?: string,
    opcoes: OpcoesRelatorioFinanceiro = {},
    solicitante?: SolicitanteRelatorio,
  ): Promise<{ buffer: Buffer; mime: string; filename: string }> {
    const contagem = { linhas: 0 };
    const arquivo = await this.montarRelatorio(
      idCondominio, tipo, formato, dataInicio, dataFim, bloco, apto, opcoes, contagem,
    );
    await this.registrarDownloadRelatorio(idCondominio, solicitante, {
      tipo,
      formato,
      dataInicio,
      dataFim,
      bloco: bloco?.trim() || undefined,
      apto: apto?.trim() || undefined,
      incluirTaxasCondominiais: opcoes.incluirTaxasCondominiais === true,
    }, contagem.linhas);
    return arquivo;
  }

  /** Nunca derruba o download: se o registro falhar, só loga. */
  private async registrarDownloadRelatorio(
    idCondominio: number,
    solicitante: SolicitanteRelatorio | undefined,
    filtros: Record<string, unknown>,
    linhas: number,
  ): Promise<void> {
    const tipo = String(filtros['tipo']);
    const formato = String(filtros['formato']);
    try {
      if (this.auditoria) {
        await this.auditoria.registrar({
          id_condominio: idCondominio,
          usuario_nome: solicitante?.nome || 'Operador',
          usuario_email: solicitante?.email,
          autor_id: solicitante?.autor_id ?? null,
          autor_tipo: solicitante?.autor_tipo ?? null,
          acao: 'EXPORT',
          modulo: 'relatorios',
          descricao: `Download do relatório de ${tipo} em ${formato} (${linhas} linhas)`,
          detalhes: { filtros, linhas },
          ip: solicitante?.ip,
        });
      }
    } catch (e) {
      console.error('[RelatoriosService] Falha ao registrar o download do relatório:', e);
    }
  }

  private async montarRelatorio(
    idCondominio: number,
    tipo: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro',
    formato: 'pdf' | 'xlsx',
    dataInicio: string | undefined,
    dataFim: string | undefined,
    bloco: string | undefined,
    apto: string | undefined,
    opcoes: OpcoesRelatorioFinanceiro,
    contagem: { linhas: number },
  ): Promise<{ buffer: Buffer; mime: string; filename: string }> {
    const condominio = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { nome: true },
    });
    const nomeCondo = condominio?.nome || 'Condomínio';

    const cleanBloco = bloco?.trim() || undefined;
    const cleanApto = apto?.trim() || undefined;
    const blocoLabel = rotuloBloco(cleanBloco);
    const aptoLabel = cleanApto ? (/^apto/i.test(cleanApto) ? cleanApto : `Apto ${cleanApto}`) : '';
    const unidadeDesc = (cleanBloco || cleanApto)
      ? [blocoLabel, aptoLabel].filter(Boolean).join(' - ')
      : null;
    const fileSuffix = unidadeDesc ? `_${unidadeDesc.replace(/[^a-zA-Z0-9]/g, '_')}` : '';

    const dateFilter = (dataInicio || dataFim) ? {
      ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
      ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
    } : null;

    if (tipo === 'visitantes') {
      const migrado = pessoasMigrationEnabled(this.prisma);
      // Só visitantes: prestador tem a tela e o relatório dele (o dashboard e
      // a tela de Visitantes também separam). No migrado vale o tipo atual da
      // Pessoa, como no cartão do dashboard.
      const where: any = migrado
        ? { id_condominio: idCondominio, pessoa: { tipo_pessoa: 'visitante' } }
        : { id_condominio: idCondominio, is_prestador: { not: 1 } };
      if (dateFilter) {
        where.OR = [
          { created_at: dateFilter },
          { data_entrada: dateFilter },
          { data_saida: dateFilter },
          { data_hora_inicio: dateFilter },
        ];
      }
      if (cleanBloco || cleanApto) {
        where.apartamento = {
          ...(cleanBloco ? { bloco: { equals: cleanBloco } } : {}),
          ...(cleanApto ? { apto: { equals: cleanApto } } : {}),
        };
      }

      const listRaw = migrado
        ? await this.prisma.visitas.findMany({
            where,
            include: {
              pessoa: true,
              apartamento: { select: { bloco: true, apto: true } },
              criadoPor: { select: { name: true } },
            },
            orderBy: { created_at: 'desc' },
          })
        : await this.prisma.visitantes.findMany({
            where,
            include: {
              apartamento: { select: { bloco: true, apto: true } },
              criadoPor: { select: { name: true } },
            },
            orderBy: { created_at: 'desc' },
          });
      // No caminho migrado, achata `pessoa` de volta pro formato que o resto
      // deste bloco já espera (nome/doc_identificacao na raiz).
      const list = listRaw.map((v: any) =>
        v.pessoa
          ? { ...v, nome: v.pessoa.nome, doc_identificacao: v.pessoa.doc_identificacao }
          : v,
      );

      contagem.linhas = list.length;
      const excelData = list.map((v) => ({
        Nome: v.nome,
        Documento: v.doc_identificacao || 'Não informado',
        Apartamento: v.apartamento ? formatarApto(v.apartamento.apto, v.apartamento.bloco) || 'Não informado' : 'Não informado',
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
          filename: `relatorio_visitantes${fileSuffix}_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Visitantes - ${nomeCondo}`,
          unidade: unidadeDesc,
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
                v.apartamento ? formatarApto(v.apartamento.apto, v.apartamento.bloco) || '-' : '-',
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
          filename: `relatorio_visitantes${fileSuffix}_${getTimestamp()}.pdf`,
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
      if (cleanBloco) {
        where.destinatario_bloco = { equals: cleanBloco };
      }
      if (cleanApto) {
        where.destinatario_apto = { equals: cleanApto };
      }

      const list = await this.prisma.encomendas.findMany({
        where,
        include: {
          recebidoPor: { select: { name: true } },
          entreguePor: { select: { name: true } },
        },
        orderBy: { recebido_em: 'desc' },
      });

      contagem.linhas = list.length;
      const excelData = list.map((e) => ({
        Descrição: e.descricao,
        Destinatário: formatarApto(e.destinatario_apto, e.destinatario_bloco) || '-',
        Remetente: e.recebido_de || 'Não informado',
        // `Esperando`: o morador só avisou, ainda não chegou na portaria.
        Recebido: (e.status || '').toLowerCase() === 'esperando' ? '-' : formatDateTime(e.recebido_em),
        Retirado: e.retirado_em ? formatDateTime(e.retirado_em) : 'Aguardando',
        Status: e.status,
        'Recebido Por': e.recebidoPor?.name || 'Sistema',
      }));

      if (formato === 'xlsx') {
        const buffer = this.generateExcel(excelData, 'Encomendas');
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `relatorio_encomendas${fileSuffix}_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Encomendas - ${nomeCondo}`,
          unidade: unidadeDesc,
          periodo: this.formatPeriod(dataInicio, dataFim),
          metrics: [
            { label: 'Total de Encomendas', value: list.length.toString() },
            { label: 'Aguardando Retirada', value: list.filter((e) => e.status === 'Aguardando').length.toString() },
            // A retirada grava 'Retirada' (encomendas.service); 'Entregue' é grafia antiga.
            {
              label: 'Retiradas',
              value: list.filter((e) => e.status === 'Retirada' || e.status === 'Entregue').length.toString(),
            },
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
                formatarApto(e.destinatario_apto, e.destinatario_bloco) || '-',
                (e.status || '').toLowerCase() === 'esperando' ? '-' : formatDateTime(e.recebido_em),
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
          filename: `relatorio_encomendas${fileSuffix}_${getTimestamp()}.pdf`,
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
      if (cleanBloco || cleanApto) {
        where.criadoPor = {
          apartamentosUsers: {
            some: {
              apartamento: {
                ...(cleanBloco ? { bloco: { equals: cleanBloco } } : {}),
                ...(cleanApto ? { apto: { equals: cleanApto } } : {}),
              },
            },
          },
        };
      }

      const list = await this.prisma.ocorrencias.findMany({
        where,
        include: {
          criadoPor: { select: { name: true } },
          categoria: { select: { nome: true } },
          funcionarioPortaria: { select: { nome: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      contagem.linhas = list.length;
      const excelData = list.map((o) => ({
        Categoria: o.categoria?.nome || 'Geral',
        Descrição: o.descricao || 'Sem descrição',
        Status: o.status,
        Criado: formatDateTime(o.created_at),
        'Criado Por': autorOcorrencia(o.criadoPor?.name, o.categoria?.nome, o.origem, o.funcionarioPortaria?.nome),
        Resposta: o.resposta || 'Sem resposta',
        'Respondido Em': o.resposta_at ? formatDateTime(o.resposta_at) : '-',
      }));

      if (formato === 'xlsx') {
        const buffer = this.generateExcel(excelData, 'Ocorrências');
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `relatorio_ocorrencias${fileSuffix}_${getTimestamp()}.xlsx`,
        };
      } else {
        const buffer = await this.generatePdf({
          headerText: `Relatório de Ocorrências - ${nomeCondo}`,
          unidade: unidadeDesc,
          periodo: this.formatPeriod(dataInicio, dataFim),
          metrics: [
            { label: 'Total Registrado', value: list.length.toString() },
            // Mesma conta do cartão do dashboard: aberta = não solucionada
            // (Pendente e Ciente); resolvida em qualquer grafia gravada.
            { label: 'Abertas', value: list.filter((o) => !solucionada(o.status)).length.toString() },
            { label: 'Resolvidas', value: list.filter((o) => solucionada(o.status)).length.toString() },
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
                autorOcorrencia(o.criadoPor?.name, o.categoria?.nome, o.origem, o.funcionarioPortaria?.nome),
              ]),
            ],
          },
        });
        return {
          buffer,
          mime: 'application/pdf',
          filename: `relatorio_ocorrencias${fileSuffix}_${getTimestamp()}.pdf`,
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
    if (dataInicio || dataFim) {
      // Competência, como no Livro Caixa: data do pagamento; sem ela, o
      // vencimento. Com `created_at OU data OU vencimento` o lançamento pago
      // num mês e vencido no outro entrava nos dois relatórios. `data` e
      // `data_vencimento` são @db.Date (meia-noite UTC): o limite em -03:00
      // deixava o primeiro dia do período de fora.
      const dia = {
        ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000Z`) } : {}),
        ...(dataFim ? { lte: new Date(`${dataFim}T00:00:00.000Z`) } : {}),
      };
      where.OR = [
        { data: dia },
        { data: null, data_vencimento: dia },
      ];
    }

    const listBruta = await this.prisma.financeiro.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    // Mesmo recorte do Livro Caixa (financeiro/livro-caixa-criterio.util), para
    // o Balanço daqui fechar com o Saldo de lá no mesmo mês:
    //  - a dívida renegociada num acordo sai (a Inadimplência também a tira);
    //    as parcelas do acordo ficam;
    //  - as taxas condominiais apto a apto ficam fora, salvo com o interruptor.
    //    Com unidade escolhida no filtro (apto, ou só o bloco) elas entram: o
    //    relatório de uma unidade existe justamente para mostrar as cobranças dela.
    const soBloco = !!cleanBloco && !cleanApto;
    const incluirTaxas = opcoes.incluirTaxasCondominiais === true || !!cleanApto || soBloco;
    const aptosDoCondominio =
      incluirTaxas && !soBloco
        ? []
        : await this.prisma.apartamentos.findMany({
            where: { id_condominio: idCondominio },
            select: { apto: true, bloco: true },
          });
    let list = listBruta.filter(
      (f) => !lancamentoRenegociado(f) && (incluirTaxas || !ehTaxaCondominialDeApto(f, aptosDoCondominio)),
    );

    if (cleanApto) {
      list = list.filter((f) => {
        const text = `${f.nome || ''} ${f.descricao || ''}`;
        const matchApto = new RegExp(`\\b(?:Apto|Apartamento)?\\s*${cleanApto}\\b`, 'i').test(text);
        if (!matchApto) return false;
        if (cleanBloco) {
          return new RegExp(`\\b(?:Bloco)?\\s*${cleanBloco}\\b`, 'i').test(text);
        }
        return true;
      });
    } else if (soBloco) {
      // Só o bloco (o app manda `bloco` sem `apto`): lançamentos das unidades
      // DESTE condomínio naquele bloco, reconhecidos pelo nome da cobrança
      // como na Inadimplência ("Apto X Bloco Y - ..."). Lançamento geral do
      // condomínio não pertence a bloco nenhum e fica de fora (dito no PDF).
      const chave = normalizarBloco(cleanBloco);
      const aptosDoBloco = aptosDoCondominio.filter((a) => normalizarBloco(a.bloco) === chave);
      list = list.filter((f) => aptosDoBloco.some((a) => nomeFaturaDeApto(f.nome, a.apto, a.bloco)));
    }

    // Totais como no Livro Caixa: só o que está pago entra em receitas,
    // despesas e balanço. O que não foi pago no período aparece à parte.
    let totalReceitas = 0;
    let totalDespesas = 0;
    let aReceber = 0;
    let aPagar = 0;
    for (const f of list) {
      const v = Math.abs(valorNoLivroCaixa(f));
      const despesa = ehDespesaNoLivroCaixa(f);
      if (lancamentoPago(f)) {
        if (despesa) totalDespesas += v;
        else totalReceitas += v;
      } else if (despesa) aPagar += v;
      else aReceber += v;
    }
    const balanco = totalReceitas - totalDespesas;
    const EM_ABERTO = 'em aberto com vencimento no período';
    const resumo = [
      { label: 'Receitas pagas', valor: totalReceitas },
      { label: 'Despesas pagas', valor: totalDespesas },
      { label: 'Balanço Geral', valor: balanco, legenda: 'receitas pagas - despesas pagas' },
      { label: 'A receber', valor: aReceber, legenda: EM_ABERTO },
      { label: 'A pagar', valor: aPagar, legenda: EM_ABERTO },
    ];
    // O documento diz o que conta: quem baixa pelo app (sem o interruptor) vê
    // a arrecadação sumir e o balanço negativo, e precisa saber por quê.
    const notas = [
      'Totais consideram apenas lançamentos pagos, como no Livro Caixa.',
      ...(incluirTaxas
        ? []
        : [
            "Não inclui as taxas condominiais por unidade. Para incluí-las, gere o relatório pelo console com a opção 'Incluir taxas condominiais por unidade'.",
          ]),
      ...(soBloco
        ? ['Filtro por bloco: só os lançamentos das unidades do bloco; lançamentos gerais do condomínio não entram.']
        : []),
    ];
    const arred = (n: number) => Math.round(n * 100) / 100;

    contagem.linhas = list.length;
    const excelData = list.map((f) => {
      const v = valorNoLivroCaixa(f);
      return {
        Nome: f.nome || '-',
        Tipo: ehDespesaNoLivroCaixa(f) ? 'Despesa' : 'Receita',
        Valor: v,
        Vencimento: formatDiaDb(f.data_vencimento),
        // O período é pela data do pagamento (competência): ela precisa aparecer.
        // Só no lançamento pago: `data` também vem preenchida no que não foi pago.
        'Pago em': f.pago === 1 ? formatDiaDb(f.data) : '-',
        Categoria: f.categoria || 'Geral',
        Status: f.status || (f.pago === 1 ? 'Pago' : 'Pendente'),
        Pagamento: f.forma_pagamento || '-',
      };
    });

    if (formato === 'xlsx') {
      const buffer = this.generateExcel(excelData, 'Financeiro', [
        {
          nome: 'Resumo',
          dados: [
            ...resumo.map((m) => ({ Indicador: m.legenda ? `${m.label} (${m.legenda})` : m.label, Valor: arred(m.valor) })),
            ...notas.map((n) => ({ Indicador: n, Valor: null })),
          ],
        },
      ]);
      return {
        buffer,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `relatorio_financeiro${fileSuffix}_${getTimestamp()}.xlsx`,
      };
    } else {
      const buffer = await this.generatePdf({
        headerText: `Relatório Financeiro - ${nomeCondo}`,
        unidade: unidadeDesc,
        periodo: this.formatPeriod(dataInicio, dataFim),
        metrics: resumo.map((m) => ({ label: m.label, value: `R$ ${m.valor.toFixed(2)}`, legenda: m.legenda })),
        notas,
        table: {
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Descrição', 'Tipo', 'Valor', 'Vencimento', 'Pago em', 'Categoria', 'Status'].map((h) => ({
              text: h,
              style: 'tableHeader',
            })),
            ...list.map((f) => {
              const v = valorNoLivroCaixa(f);
              const valStr = v < 0 ? `-R$ ${(-v).toFixed(2)}` : `R$ ${v.toFixed(2)}`;
              return [
                f.nome || '-',
                ehDespesaNoLivroCaixa(f) ? 'Despesa' : 'Receita',
                valStr,
                formatDiaDb(f.data_vencimento),
                f.pago === 1 ? formatDiaDb(f.data) : '-',
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
        filename: `relatorio_financeiro${fileSuffix}_${getTimestamp()}.pdf`,
      };
    }
  }

  private generateExcel(data: any[], sheetName: string, abasExtras: { nome: string; dados: any[] }[] = []): Buffer {
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
    for (const aba of abasExtras) {
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(aba.dados), aba.nome);
    }
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private async generatePdf(params: {
    headerText: string;
    periodo: string;
    unidade?: string | null;
    metrics: { label: string; value: string; legenda?: string }[];
    /** Linhas de explicação logo abaixo do cabeçalho (o que os totais contam). */
    notas?: string[];
    table: { widths: any[]; body: any[][] };
  }): Promise<Buffer> {
    // Visual Prestare Dark na versão para papel (ver pdf-tema.ts).
    const tema = temaPdf();
    const rotulo = { font: tema.display, fontSize: 8, characterSpacing: 1.6, color: PDF_COR.subtle };

    const docDefinition: TDocumentDefinitions = {
      defaultStyle: {
        font: tema.texto,
        color: PDF_COR.texto,
      },
      content: [
        cabecalhoMarca('Relatório'),
        fileteMarca(10),
        { text: params.headerText.toUpperCase(), style: 'header' },
        ...(params.unidade
          ? [{ text: [{ text: 'UNIDADE  ', ...rotulo }, { text: params.unidade, bold: true, color: PDF_COR.tinta }], style: 'subheader' }]
          : []),
        { text: [{ text: 'PERÍODO  ', ...rotulo }, { text: params.periodo }], style: 'subheader' },
        { text: [{ text: 'GERADO EM  ', ...rotulo }, { text: getGeradoEmStr() }], style: 'meta' },
        ...(params.notas ?? []).map((n, i, todas) => ({
          text: n,
          fontSize: 9,
          color: PDF_COR.muted,
          margin: [0, 0, 0, i === todas.length - 1 ? 12 : 3] as [number, number, number, number],
        })),

        // Cards de métricas
        {
          table: {
            widths: params.metrics.map(() => '*'),
            body: [
              params.metrics.map((m) => ({
                fillColor: PDF_COR.painel,
                stack: [
                  { text: m.label.toUpperCase(), ...rotulo },
                  {
                    text: m.value,
                    font: tema.displayLeve,
                    // Cinco cartões não comportam o valor em 26 pt.
                    fontSize: params.metrics.length > 3 ? 16 : 26,
                    lineHeight: 0.95,
                    color: PDF_COR.tinta,
                    margin: [0, 4, 0, 0],
                  },
                  ...(m.legenda ? [{ text: m.legenda, fontSize: 7, color: PDF_COR.subtle, margin: [0, 3, 0, 0] }] : []),
                ],
                margin: [12, 10, 12, 8],
              })),
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 2 : 1),
            vLineWidth: () => 1,
            hLineColor: (i: number) => (i === 0 ? PDF_COR.marca : PDF_COR.linha),
            vLineColor: () => PDF_COR.linha,
          },
          margin: [0, 0, 0, 18],
        },

        // Tabela de registros
        {
          table: {
            headerRows: 1,
            widths: params.table.widths,
            body: params.table.body.map((row, rIdx) =>
              row.map((cell) => {
                if (rIdx === 0) {
                  // Cabeçalho em caixa alta, como os rótulos do console.
                  return cell && typeof cell.text === 'string' ? { ...cell, text: cell.text.toUpperCase() } : cell;
                }
                return {
                  text: cell,
                  style: 'tableCell',
                  fillColor: rIdx % 2 === 0 ? PDF_COR.zebra : PDF_COR.papel,
                };
              })
            ),
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => PDF_COR.linha,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
        },
      ],
      footer: (currentPage, pageCount) => {
        return {
          columns: [
            {
              text: [
                { text: 'PRESTARE CONDOMÍNIOS', font: tema.display, characterSpacing: 1.2, color: PDF_COR.muted },
                { text: '  ·  prestarecondominios.com.br' },
              ],
              alignment: 'left',
              fontSize: 8,
              color: PDF_COR.subtle,
            },
            {
              text: `PÁGINA ${currentPage} DE ${pageCount}`,
              alignment: 'right',
              font: tema.display,
              fontSize: 8,
              characterSpacing: 1.2,
              color: PDF_COR.subtle,
            },
          ],
          margin: [40, 20, 40, 0],
        };
      },
      styles: {
        header: {
          font: tema.display,
          fontSize: 22,
          characterSpacing: 0.8,
          color: PDF_COR.tinta,
          margin: [0, 14, 0, 6],
        },
        subheader: {
          fontSize: 10,
          color: PDF_COR.muted,
          margin: [0, 3, 0, 0],
        },
        meta: {
          fontSize: 9,
          color: PDF_COR.subtle,
          margin: [0, 3, 0, 16],
        },
        tableHeader: {
          font: tema.display,
          fontSize: 9,
          characterSpacing: 1.2,
          color: PDF_COR.papel,
          fillColor: PDF_COR.tinta,
          margin: [6, 7],
        },
        tableCell: {
          fontSize: 9,
          color: PDF_COR.texto,
          margin: [6, 5],
        },
      },
      pageMargins: [40, 40, 40, 60],
    };

    pdfmake.setFonts(tema.fontes);
    travarAcessosPdf(pdfmake);
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
    /** Só o síndico lê os módulos sigilosos; na dúvida, ficam de fora. */
    verSigilosos = false,
    /** Funcionário do app sem a flag `ocorrencias`: as linhas desse módulo ficam de fora. */
    ocultarOcorrencias = false,
  ) {
    if (!this.prisma.isConnected) {
      return { items: [], total: 0, page, pageSize };
    }

    const where = this.buildAuditWhere(idCondominio, modulo, dataInicio, dataFim, verSigilosos, ocultarOcorrencias);
    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const safePage = Math.max(page, 1);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        // `created_at` tem precisão de segundos: sem o id a ordem empata e a página repete/pula linhas.
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
    solicitante?: SolicitanteExportAuditoria,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!this.prisma.isConnected) {
      return { buffer: Buffer.from('Data\n'), filename: 'auditoria_vazia.csv' };
    }

    // Export é exclusivo do síndico (assertSindico no controller): vê tudo.
    const where = this.buildAuditWhere(idCondominio, modulo, dataInicio, dataFim, true);
    const lidas = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: LIMITE_CSV_AUDITORIA + 1, // a linha extra só denuncia que há mais do que o teto
    });
    const truncado = lidas.length > LIMITE_CSV_AUDITORIA;
    const rows = truncado ? lidas.slice(0, LIMITE_CSV_AUDITORIA) : lidas;

    const header = ['Data', 'Usuário', 'E-mail', 'Ação', 'Módulo', 'Entidade', 'Descrição', 'IP', 'Detalhes'];
    // `;`: o Excel em pt-BR abre CSV com vírgula com tudo numa coluna só.
    const lines = [linhaCsv(header)];

    for (const r of rows) {
      lines.push(
        linhaCsv([
          formatDateTimeSegundos(r.created_at),
          r.usuario_nome ?? '',
          r.usuario_email ?? '',
          rotuloAcaoAuditoria(r.acao),
          rotuloModuloAuditoria(r.modulo),
          r.entidade_id != null ? String(r.entidade_id) : '',
          r.descricao ?? '',
          r.ip ?? '',
          // Linhas antigas trazem o PIN (`codigoAcesso`) e o CPF inteiro: a tela os esconde, o CSV também.
          redigirDetalhesAuditoriaCsv(r.detalhes),
        ]),
      );
    }

    if (truncado) {
      lines.push(
        csvCelula(
          `ATENÇÃO: exportação truncada em ${LIMITE_CSV_AUDITORIA} linhas; há registros mais antigos. Filtre por data para exportar o restante.`,
        ),
      );
    }

    await this.registrarExportAuditoria(idCondominio, solicitante, { modulo, dataInicio, dataFim }, rows.length);

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
    verSigilosos = false,
    ocultarOcorrencias = false,
  ) {
    const where: any = { id_condominio: idCondominio };
    const ocultos = [
      ...(verSigilosos ? [] : MODULOS_AUDITORIA_SIGILOSOS),
      ...(ocultarOcorrencias ? MODULOS_AUDITORIA_OCORRENCIAS : []),
    ];
    const pedido = typeof modulo === 'string' ? modulo.trim() : '';
    // Mesma régua da colação do MySQL (sem caixa, sem acento): `ocorrências` é `ocorrencias`.
    const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const chave = normalizar(pedido);
    if (pedido && chave !== 'todos') {
      if (ocultos.some((o) => normalizar(o) === chave)) {
        // Pedir um módulo que este papel não lê: lista vazia, não erro.
        where.modulo = { in: [] };
      } else if (GRUPOS_MODULO_AUDITORIA[chave]) {
        where.modulo = { in: GRUPOS_MODULO_AUDITORIA[chave] };
      } else if (ocultos.length) {
        // A exclusão vai junto do filtro para o banco compará-la com a mesma colação do pedido.
        where.AND = [{ modulo: pedido }, { modulo: { notIn: ocultos } }];
      } else {
        where.modulo = pedido;
      }
    } else if (ocultos.length) {
      where.modulo = { notIn: ocultos };
    }
    if (dataInicio || dataFim) {
      where.created_at = {
        ...(dataInicio ? { gte: new Date(`${dataInicio}T00:00:00.000-03:00`) } : {}),
        ...(dataFim ? { lte: new Date(`${dataFim}T23:59:59.999-03:00`) } : {}),
      };
    }
    return where;
  }

  /**
   * Rastro do export do log (quem, filtros, quantas linhas) — mesmo padrão do
   * export LGPD em condominios-export.service.ts. Nunca derruba o export.
   */
  private async registrarExportAuditoria(
    idCondominio: number,
    solicitante: SolicitanteExportAuditoria | undefined,
    filtros: { modulo?: string; dataInicio?: string; dataFim?: string },
    linhas: number,
  ): Promise<void> {
    const usuario_nome = solicitante?.nome || 'Síndico';
    const descricao = `Exportação do log de auditoria em CSV (${linhas} linhas)`;
    const detalhes = {
      filtros: {
        modulo: filtros.modulo ?? null,
        dataInicio: filtros.dataInicio ?? null,
        dataFim: filtros.dataFim ?? null,
      },
      linhas,
    };
    try {
      if (this.auditoria) {
        // Preferido: resolve o IP pelo contexto da requisição.
        await this.auditoria.registrar({
          id_condominio: idCondominio,
          usuario_nome,
          usuario_email: solicitante?.email,
          autor_id: solicitante?.autor_id ?? null,
          autor_tipo: solicitante?.autor_tipo ?? null,
          acao: 'EXPORT',
          modulo: 'auditoria',
          descricao,
          detalhes,
        });
      } else if (this.prisma?.auditLog?.create) {
        await this.prisma.auditLog.create({
          data: {
            id_condominio: idCondominio,
            usuario_nome,
            usuario_email: solicitante?.email ?? null,
            autor_id: solicitante?.autor_id ?? null,
            autor_tipo: solicitante?.autor_tipo ?? null,
            acao: 'EXPORT',
            modulo: 'auditoria',
            descricao,
            detalhes: JSON.stringify(detalhes),
          },
        });
      }
    } catch (e) {
      console.error('[RelatoriosService] Falha ao registrar o export da auditoria:', e);
    }
  }


  /**
   * Log de Eventos: linha do tempo de 6 fontes, paginada no banco.
   *
   * 1. `consultarEspinhaEventos` resolve a página em SQL (UNION ALL ordenado
   *    e limitado) e devolve só (fonte, id), mais o total.
   * 2. `hidratarEventos` busca os relacionamentos/fotos apenas desses ids.
   *
   * Não há teto de histórico: `truncado` é sempre `false` (o campo fica no
   * contrato porque a tela ainda o lê).
   */
  async getEventos(
    idCondominio: number,
    dataInicio?: string,
    dataFim?: string,
    page = 1,
    pageSize = 50,
    search?: string,
    ocorrenciasSoPublicasOuDe: number | null = null,
  ) {
    // Documento sempre só com os 4 últimos dígitos, para qualquer papel (a tela não tem "revelar").
    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const safePage = Math.max(page, 1);
    const periodoAplicado = resolverPeriodoEventos(dataInicio, dataFim);
    const periodo = {
      dataInicio: periodoAplicado.dataInicio,
      dataFim: periodoAplicado.dataFim,
      padrao: periodoAplicado.padrao,
    };

    if (!this.prisma.isConnected) {
      return { items: [], total: 0, page, pageSize, truncado: false, periodo };
    }

    const migrado = pessoasMigrationEnabled(this.prisma);
    const { linhas, total } = await this.consultarEspinhaEventos({
      idCondominio,
      inicio: periodoAplicado.inicio,
      fimExclusivo: periodoAplicado.fimExclusivo,
      search,
      migrado,
      limit: safeSize,
      offset: (safePage - 1) * safeSize,
      ocorrenciasSoPublicasOuDe,
    });

    const items = await this.hidratarEventos(idCondominio, linhas, migrado);

    return {
      items,
      total,
      page: safePage,
      pageSize: safeSize,
      truncado: false,
      periodo,
    };
  }

  /** Página (fonte, id) já ordenada + total — ver eventos-espinha.ts. */
  protected async consultarEspinhaEventos(
    filtro: FiltroEspinha,
  ): Promise<{ linhas: LinhaEspinha[]; total: number }> {
    const [linhas, contagens] = await Promise.all([
      this.prisma.$queryRaw<Array<{ fonte: FonteEvento; id: number | bigint }>>(montarSqlEspinha(filtro)),
      this.prisma.$queryRaw<Array<{ fonte: string; n: number | bigint }>>(montarSqlTotal(filtro)),
    ]);
    return {
      linhas: linhas.map((l) => ({ fonte: l.fonte, id: Number(l.id) })),
      // COUNT(*) chega como BigInt no MySQL.
      total: contagens.reduce((soma, c) => soma + Number(c.n), 0),
    };
  }

  /**
   * Monta os itens da página na ordem da espinha, consultando só os ids dela.
   * Linha que sumiu entre a espinha e a hidratação (excluída no meio) é
   * simplesmente omitida.
   */
  private async hidratarEventos(
    idCondominio: number,
    linhas: LinhaEspinha[],
    migrado: boolean,
  ): Promise<any[]> {
    if (linhas.length === 0) return [];
    const doc = (d: string | null | undefined): string | undefined => mascararDocumento(d);

    const idsDe = (...fontes: FonteEvento[]) => [
      ...new Set(linhas.filter((l) => fontes.includes(l.fonte)).map((l) => l.id)),
    ];
    const idsVisita = idsDe('visita_entrada', 'visita_saida');
    const idsEncomenda = idsDe('encomenda');
    const idsOcorrencia = idsDe('ocorrencia');
    const idsDispositivo = idsDe('dispositivo');
    const idsFacial = idsDe('facial');
    const nada = Promise.resolve([] as any[]);

    const [visitasRaw, encomendas, ocorrencias, auditLogs, acessosFacial]: any[][] = await Promise.all([
      idsVisita.length === 0
        ? nada
        : migrado
          ? this.prisma.visitas.findMany({
              where: { id: { in: idsVisita }, id_condominio: idCondominio },
              include: {
                // Só o que o feed usa — `foto_documento` não sai do banco.
                pessoa: { select: { id: true, nome: true, doc_identificacao: true, foto_pessoa: true } },
                apartamento: { select: { bloco: true, apto: true } },
                criadoPor: { select: { name: true } },
              },
            })
          : this.prisma.visitantes.findMany({
              where: { id: { in: idsVisita }, id_condominio: idCondominio },
              include: {
                apartamento: { select: { bloco: true, apto: true } },
                criadoPor: { select: { name: true } },
              },
            }),
      idsEncomenda.length === 0
        ? nada
        : this.prisma.encomendas.findMany({
            where: { id: { in: idsEncomenda }, id_condominio: idCondominio },
            include: {
              recebidoPor: { select: { name: true } },
              entreguePor: { select: { name: true } },
            },
          }),
      idsOcorrencia.length === 0
        ? nada
        : this.prisma.ocorrencias.findMany({
            where: { id: { in: idsOcorrencia }, id_condominio: idCondominio },
            include: {
              criadoPor: { select: { name: true } },
              categoria: { select: { nome: true } },
              funcionarioPortaria: { select: { nome: true } },
            },
          }),
      idsDispositivo.length === 0
        ? nada
        : this.prisma.auditLog.findMany({
            where: { id: { in: idsDispositivo }, id_condominio: idCondominio, modulo: 'dispositivos' },
          }),
      idsFacial.length === 0
        ? nada
        : this.prisma.acessos_Facial.findMany({
            where: { id: { in: idsFacial }, id_condominio: idCondominio },
          }),
    ]);

    // No caminho migrado, achata `pessoa` de volta pro formato que o resto
    // deste método já espera (nome/doc_identificacao na raiz) — mesma
    // convenção usada nas outras leituras migradas.
    const flatVisitaRow = (v: any) =>
      v.pessoa
        ? { ...v, nome: v.pessoa.nome, doc_identificacao: v.pessoa.doc_identificacao, foto_pessoa: v.pessoa.foto_pessoa }
        : v;

    const porChave = new Map<string, any>();

    // 1 e 2. Visitantes — entrada e saída da MESMA visita podem cair na mesma
    // página; a espinha diz qual das duas (ou ambas) montar. A deduplicação
    // contra o facial já foi feita na espinha (ver eventos-espinha.ts).
    for (const v of visitasRaw.map(flatVisitaRow)) {
      const aptoStr = v.apartamento ? formatarApto(v.apartamento.apto, v.apartamento.bloco) : '';
      if (v.data_entrada) {
        porChave.set(`visita_entrada:${v.id}`, {
          id: `visitante-ent-${v.id}`,
          tipo: v.is_prestador === 1 ? 'Prestador' : 'Visitante',
          descricao: `${v.nome} entrou — ${aptoStr}`.trim(),
          quando: v.data_entrada.toISOString(),
          direcao: 'entrada',
          detalhes: {
            id: v.id,
            nome: v.nome,
            documento: doc(v.doc_identificacao) || 'Não informado',
            blocoApto: aptoStr || 'Não informado',
            tipoPessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
            dataEntrada: v.data_entrada ? v.data_entrada.toISOString() : undefined,
            dataSaida: v.data_saida ? v.data_saida.toISOString() : undefined,
            status: v.data_saida ? 'Saída registrada' : 'No local',
            autorizadoPor: v.criadoPor?.name || 'Morador',
            fotoPessoa: v.foto_pessoa || undefined,
            metodoLiberacao: 'pin',
            metodoLabel: 'PIN / Manual',
          },
        });
      }
      if (v.data_saida) {
        porChave.set(`visita_saida:${v.id}`, {
          id: `visitante-sai-${v.id}`,
          tipo: v.is_prestador === 1 ? 'Prestador' : 'Visitante',
          descricao: `${v.nome} saiu — ${aptoStr}`.trim(),
          quando: v.data_saida.toISOString(),
          direcao: 'saida',
          detalhes: {
            id: v.id,
            nome: v.nome,
            documento: doc(v.doc_identificacao) || 'Não informado',
            blocoApto: aptoStr || 'Não informado',
            tipoPessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
            dataEntrada: v.data_entrada ? v.data_entrada.toISOString() : undefined,
            dataSaida: v.data_saida.toISOString(),
            status: 'Saiu',
            autorizadoPor: v.criadoPor?.name || 'Morador',
            fotoPessoa: v.foto_pessoa || undefined,
            metodoLiberacao: 'pin',
            metodoLabel: 'PIN / Manual',
          },
        });
      }
    }

    // 3. Encomendas
    for (const e of encomendas) {
      const aptoStr = formatarApto(e.destinatario_apto, e.destinatario_bloco);
      porChave.set(`encomenda:${e.id}`, {
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
          // `Esperando` = o morador só avisou; ainda não chegou na portaria,
          // então não há data de recebimento a mostrar.
          dataEntrada: (e.status || '').toLowerCase() === 'esperando'
            ? null
            : e.recebido_em.toISOString(),
          status: e.status,
          recebidoPor: e.recebidoPor?.name || 'Sistema',
          retiradoPor: e.entreguePor?.name || undefined,
        },
      });
    }

    // 4. Ocorrências
    for (const o of ocorrencias) {
      porChave.set(`ocorrencia:${o.id}`, {
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
          autorizadoPor: autorOcorrencia(o.criadoPor?.name, o.categoria?.nome, o.origem, o.funcionarioPortaria?.nome),
          resposta: o.resposta || undefined,
          dataSaida: o.resposta_at ? o.resposta_at.toISOString() : undefined,
        },
      });
    }

    // 5. Dispositivos (AuditLog)
    for (const a of auditLogs) {
      const isOffline = a.acao === 'OFFLINE';
      porChave.set(`dispositivo:${a.id}`, {
        id: `dispositivo-${a.id}`,
        // Status de aparelho não é ocorrência: tipo próprio (card/cor no front).
        tipo: 'Dispositivo',
        descricao: a.descricao,
        quando: a.created_at.toISOString(),
        // Evento de status de dispositivo (não é entrada/saída de pessoa):
        // selo próprio Offline/Online, ver shared/direcao-label.util.ts.
        direcao: isOffline ? 'offline' : 'online',
        detalhes: {
          id: a.id,
          // O monitor grava o nome do aparelho em usuario_nome (é quem "fala" no registro).
          nome: a.usuario_nome || 'Dispositivo',
          terminalNome: a.usuario_nome || undefined,
          descricao: a.descricao,
          status: isOffline ? 'Offline' : 'Online',
          dataEntrada: a.created_at.toISOString(),
          autorizadoPor: 'Monitor de Dispositivos',
          ip: a.ip || undefined,
        },
      });
    }

    // 6. Acessos Faciais
    if (acessosFacial.length > 0) {
      const idsPessoaDe = (...tipos: string[]): number[] => [
        ...new Set<number>(
          acessosFacial
            .filter((a) => tipos.includes(a.tipo_pessoa))
            .map((a) => a.id_pessoa)
            .filter((id) => id !== null && id !== undefined),
        ),
      ];
      const idsMorador = idsPessoaDe('morador');
      const idsVisitante = idsPessoaDe('visitante', 'prestador');
      const idsFuncionario = idsPessoaDe('funcionario');
      const idsDevice = [...new Set<number>(acessosFacial.map((a) => a.id_device))];

      const [moradoresInfo, visitanteById, funcionariosInfo, devicesInfo] = await Promise.all([
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
        migrado
          ? resolverInfoVisitantesPorIdAcessoFacial(this.prisma, idsVisitante, idCondominio)
          : idsVisitante.length > 0
            ? this.prisma.visitantes.findMany({
                where: { id: { in: idsVisitante }, id_condominio: idCondominio },
                select: {
                  id: true,
                  foto_pessoa: true,
                  doc_identificacao: true,
                  apartamento: { select: { bloco: true, apto: true } },
                },
              }).then((rows) => new Map(rows.map((v) => [v.id, v])))
            : Promise.resolve(new Map()),
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
        this.prisma.facial_Devices.findMany({
          where: { id_condominio: idCondominio, id: { in: idsDevice } },
          select: { id: true, nome: true, ip: true },
        }),
      ]);

      const moradorById = new Map(moradoresInfo.map((m) => [m.id, m]));
      const funcionarioById = new Map(funcionariosInfo.map((f) => [f.id, f]));
      const deviceById = new Map(devicesInfo.map((d) => [d.id, d.nome]));
      const deviceIpById = new Map(devicesInfo.map((d) => [d.id, d.ip]));

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
            aptoStr = formatarApto(m?.apartamento, m?.bloco);
          }
        } else if (a.tipo_pessoa === 'visitante' || a.tipo_pessoa === 'prestador') {
          const v = visitanteById.get(idPessoa);
          foto = v?.foto_pessoa ?? undefined;
          documento = doc(v?.doc_identificacao);
          if (v?.apartamento) {
            aptoStr = formatarApto(v.apartamento.apto, v.apartamento.bloco);
          }
        } else if (a.tipo_pessoa === 'funcionario') {
          const f = funcionarioById.get(idPessoa);
          foto = f?.foto_pessoa ?? undefined;
          if (f?.apartamento) {
            aptoStr = formatarApto(f.apartamento.apto, f.apartamento.bloco);
          }
        }

        const terminalNome = deviceById.get(a.id_device) ?? `Terminal #${a.id_device}`;
        const terminalIp = deviceIpById.get(a.id_device) ?? undefined;

        porChave.set(`facial:${a.id}`, {
          id: `facial-access-${a.id}`,
          tipo: 'Acesso Facial',
          descricao: `${a.nome_pessoa.toUpperCase()} ${acao} ${dispLabel} "${terminalNome}"${confiancaPct}`,
          quando: a.timestamp.toISOString(),
          direcao: direcaoDoEventoFacial(a.evento),
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
            terminalIp,
            confianca: a.confianca ?? undefined,
            dataEntrada: a.timestamp.toISOString(),
          },
        });
      }
    }

    // A ordem (e o que entra) é a da espinha; a hidratação só preenche.
    return linhas
      .map((l) => porChave.get(`${l.fonte}:${l.id}`))
      .filter((item) => item !== undefined);
  }
}

/**
 * Direção do item de acesso facial no Log de Eventos. Abertura manual pelo
 * porteiro e falha ao acionar o relé não são entrada de ninguém.
 */
function direcaoDoEventoFacial(evento?: string | null): 'entrada' | 'saida' | 'bloqueado' | 'manual' | 'falha' {
  switch (evento) {
    case 'saida': return 'saida';
    case 'negado': return 'bloqueado';
    case 'acionado_manual': return 'manual';
    case 'falha_acionamento': return 'falha';
    default: return 'entrada';
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
