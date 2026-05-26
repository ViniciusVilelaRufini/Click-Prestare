import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  visitantesAtivos: number;
  prestadoresAtivos: number;
  ocorrenciasPendentes: number;
  encomendasAguardando: number;
  comunicadosRecentes: number;
  totalApartamentos: number;
  totalMoradores: number;
  ultimosEventos: {
    tipo: string;
    descricao: string;
    quando: string;
    detalhes: {
      id: number;
      nome?: string;
      documento?: string;
      blocoApto?: string;
      dataEntrada?: string;
      dataSaida?: string;
      autorizadoPor?: string;
      status?: string;
      recebidoDe?: string;
      retiradoPor?: string;
      recebidoPor?: string;
      descricao?: string;
      resposta?: string;
    };
  }[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(idCondominio: number): Promise<DashboardSummary> {
    const agora = new Date();

    if (!this.prisma.isConnected) {
      return {
        visitantesAtivos: 2,
        prestadoresAtivos: 3,
        ocorrenciasPendentes: 1,
        encomendasAguardando: 2,
        comunicadosRecentes: 0,
        totalApartamentos: 5,
        totalMoradores: 10,
        ultimosEventos: [
          {
            tipo: 'Visitante',
            descricao: 'Carlos Eduardo Pereira entrou — Apto 101A',
            quando: agora.toISOString(),
            detalhes: {
              id: 101,
              nome: 'Carlos Eduardo Pereira',
              documento: 'RG 45.123.890-X',
              blocoApto: 'Apto 101A',
              dataEntrada: agora.toISOString(),
              status: 'No local',
              autorizadoPor: 'Morador',
            }
          },
          {
            tipo: 'Encomenda',
            descricao: 'Pacote Mercado Livre - Caixa Média — Apto 102A',
            quando: agora.toISOString(),
            detalhes: {
              id: 401,
              nome: 'Pacote Mercado Livre - Caixa Média',
              blocoApto: 'Apto 102A',
              recebidoDe: 'Correios / Sedex',
              status: 'Aguardando',
              dataEntrada: agora.toISOString(),
              recebidoPor: 'Sistema',
            }
          }
        ]
      };
    }

    const seteDiasAtras = new Date(agora.getTime() - 7 * 86400_000);

    const [
      visitantesAtivos,
      prestadoresAtivos,
      ocorrenciasPendentes,
      encomendasAguardando,
      comunicadosRecentes,
      totalApartamentos,
      totalMoradores,
      ultVisitantes,
      ultEncomendas,
      ultOcorrencias,
    ] = await Promise.all([
      // Visitantes ainda no condomínio: entrada registrada mas sem saída registrada, e is_visitante = 1 (ou is_prestador = 0)
      this.prisma.visitantes.count({
        where: {
          id_condominio: idCondominio,
          is_visitante: 1,
          NOT: { data_entrada: null },
          data_saida: null,
        },
      }),
      // Prestadores de serviço cadastrados
      this.prisma.prestadores_servico.count({
        where: {
          id_condominio: idCondominio,
        },
      }),
      this.prisma.ocorrencias.count({
        where: { id_condominio: idCondominio, status: 'Pendente' },
      }),
      this.prisma.encomendas.count({
        where: { id_condominio: idCondominio, status: 'Aguardando' },
      }),
      this.prisma.comunicados.count({
        where: { id_condominio: idCondominio, created_at: { gte: seteDiasAtras } },
      }),
      this.prisma.apartamentos.count({ where: { id_condominio: idCondominio } }),
      this.prisma.moradores.count({ where: { id_condominio: idCondominio } }),
      this.prisma.visitantes.findMany({
        where: { id_condominio: idCondominio },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          apartamento: { select: { bloco: true, apto: true } },
          criadoPor: { select: { name: true } },
        },
      }),
      this.prisma.encomendas.findMany({
        where: { id_condominio: idCondominio },
        orderBy: { recebido_em: 'desc' },
        take: 5,
        include: {
          recebidoPor: { select: { name: true } },
          entreguePor: { select: { name: true } },
        },
      }),
      this.prisma.ocorrencias.findMany({
        where: { id_condominio: idCondominio },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          criadoPor: { select: { name: true } },
          categoria: { select: { nome: true } },
        },
      }),
    ]);

    const ultimosEventos: DashboardSummary['ultimosEventos'] = [];
    for (const v of ultVisitantes) {
      const aptoStr = v.apartamento
        ? `Apto ${v.apartamento.apto}${v.apartamento.bloco ?? ''}`
        : '';
      const dataEvento = v.data_entrada || v.created_at;
      ultimosEventos.push({
        tipo: 'Visitante',
        descricao: `${v.nome} entrou — ${aptoStr}`.trim(),
        quando: dataEvento.toISOString(),
        detalhes: {
          id: v.id,
          nome: v.nome,
          documento: v.doc_identificacao || 'Não informado',
          blocoApto: aptoStr || 'Não informado',
          dataEntrada: v.data_entrada ? v.data_entrada.toISOString() : undefined,
          dataSaida: v.data_saida ? v.data_saida.toISOString() : undefined,
          status: v.data_saida ? 'Saída registrada' : (v.data_entrada ? 'No local' : 'Autorizado'),
          autorizadoPor: v.criadoPor?.name || 'Morador',
        },
      });
    }

    for (const e of ultEncomendas) {
      const aptoStr = `Apto ${e.destinatario_apto}${e.destinatario_bloco ?? ''}`;
      ultimosEventos.push({
        tipo: 'Encomenda',
        descricao: `${e.descricao} — ${aptoStr}`,
        quando: e.recebido_em.toISOString(),
        detalhes: {
          id: e.id,
          nome: e.descricao,
          blocoApto: aptoStr,
          recebidoDe: e.recebido_de || 'Não informado',
          status: e.status,
          dataEntrada: e.recebido_em.toISOString(),
          dataSaida: e.retirado_em ? e.retirado_em.toISOString() : undefined,
          retiradoPor: e.retirado_por || undefined,
          recebidoPor: e.recebidoPor?.name || 'Sistema',
          autorizadoPor: e.entreguePor?.name || undefined,
        },
      });
    }

    for (const o of ultOcorrencias) {
      ultimosEventos.push({
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

    const sortedEvents = ultimosEventos
      .sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime())
      .slice(0, 10);

    return {
      visitantesAtivos,
      prestadoresAtivos,
      ocorrenciasPendentes,
      encomendasAguardando,
      comunicadosRecentes,
      totalApartamentos,
      totalMoradores,
      ultimosEventos: sortedEvents,
    };
  }
}
