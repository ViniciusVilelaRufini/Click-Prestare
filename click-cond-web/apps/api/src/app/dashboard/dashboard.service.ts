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
    direcao?: 'entrada' | 'saida';
    detalhes: {
      id: number;
      nome?: string;
      documento?: string;
      blocoApto?: string;
      tipoPessoa?: 'morador' | 'visitante' | 'prestador' | 'funcionario';
      dataEntrada?: string;
      dataSaida?: string;
      autorizadoPor?: string;
      status?: string;
      recebidoDe?: string;
      retiradoPor?: string;
      recebidoPor?: string;
      descricao?: string;
      resposta?: string;
      fotoPessoa?: string;
      fotoDocumento?: string;
      // Novos para Visitante / Acesso Facial
      metodoLiberacao?: 'facial' | 'pin' | 'manual';
      metodoLabel?: string;
      confianca?: number;
      terminalNome?: string;
      historicoAcessos?: {
        evento: 'entrada' | 'saida' | 'negado';
        timestamp: string;
        metodo: 'facial' | 'pin' | 'manual';
        metodoLabel: string;
        confianca?: number;
        terminalNome?: string;
      }[];
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
      ultEntradasVisitantes,
      ultSaidasVisitantes,
      ultEncomendas,
      ultOcorrencias,
      ultAcessosFacial,
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
      // Entradas recentes
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          NOT: { data_entrada: null },
        },
        orderBy: { data_entrada: 'desc' },
        take: 5,
        include: {
          apartamento: { select: { bloco: true, apto: true } },
          criadoPor: { select: { name: true } },
        },
      }),
      // Saídas recentes
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          NOT: { data_saida: null },
        },
        orderBy: { data_saida: 'desc' },
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
      // Acessos faciais recentes (terminal facial)
      this.prisma.acessos_Facial.findMany({
        where: { id_condominio: idCondominio },
        orderBy: { timestamp: 'desc' },
        take: 5,
      }),
    ]);

    const ultimosEventos: DashboardSummary['ultimosEventos'] = [];

    // Para deduplicar: se um visitante teve um acesso facial (entrada ou saída)
    // dentro de ±15s do data_entrada/data_saida, é o mesmo evento físico —
    // mostra só a versão "Acesso Facial" (mais informativa, tem confiança).
    const DEDUP_WINDOW_MS = 15_000;
    const facialKeys = new Set<string>();
    for (const a of ultAcessosFacial) {
      if (a.tipo_pessoa !== 'visitante') continue;
      // Arredonda timestamp pra janelas de 15s para gerar chave estável
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

    // Busca TODOS os acessos faciais dos visitantes que vão aparecer no
    // dashboard, para montar o histórico completo no modal de detalhes.
    const visitanteIds = [
      ...ultEntradasVisitantes.map((v) => v.id),
      ...ultSaidasVisitantes.map((v) => v.id),
    ];
    const uniqueVisitanteIds = Array.from(new Set(visitanteIds));

    const [todosAcessosFaciaisDosVisitantes, devicesInfo] = await Promise.all([
      uniqueVisitanteIds.length > 0
        ? this.prisma.acessos_Facial.findMany({
            where: {
              tipo_pessoa: 'visitante',
              id_pessoa: { in: uniqueVisitanteIds },
            },
            orderBy: { timestamp: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.facial_Devices.findMany({
        where: { id_condominio: idCondominio },
        select: { id: true, nome: true },
      }),
    ]);

    const deviceById = new Map(devicesInfo.map((d) => [d.id, d.nome]));

    // Agrupa acessos faciais por visitante
    type AcessoFacialRow = typeof todosAcessosFaciaisDosVisitantes[number];
    const facialPorVisitante = new Map<number, AcessoFacialRow[]>();
    for (const a of todosAcessosFaciaisDosVisitantes) {
      const list = facialPorVisitante.get(a.id_pessoa) ?? [];
      list.push(a);
      facialPorVisitante.set(a.id_pessoa, list);
    }

    // Decide se uma entrada/saída foi pelo terminal facial e devolve o registro
    const acessoFacialDe = (idVisitante: number, evento: 'entrada' | 'saida', ts: Date | null) => {
      if (!ts) return undefined;
      const acessos = facialPorVisitante.get(idVisitante);
      if (!acessos) return undefined;
      const tsMs = ts.getTime();
      return acessos.find(
        (a) => a.evento === evento && Math.abs(a.timestamp.getTime() - tsMs) <= DEDUP_WINDOW_MS,
      );
    };

    // Constrói o histórico cronológico de acessos do visitante
    const buildHistoricoAcessos = (v: {
      id: number;
      data_entrada: Date | null;
      data_saida: Date | null;
    }) => {
      const historico: NonNullable<DashboardSummary['ultimosEventos'][number]['detalhes']['historicoAcessos']> = [];

      // Entradas/Saídas por acesso facial (vem da tabela Acessos_Facial)
      const acessosFaciaisDoV = facialPorVisitante.get(v.id) ?? [];
      const faciaisVistos = new Set<number>();
      for (const a of acessosFaciaisDoV) {
        const evento = a.evento === 'saida' ? 'saida' : a.evento === 'negado' ? 'negado' : 'entrada';
        historico.push({
          evento,
          timestamp: a.timestamp.toISOString(),
          metodo: 'facial',
          metodoLabel: 'Terminal Facial',
          confianca: a.confianca ?? undefined,
          terminalNome: deviceById.get(a.id_device) ?? `Terminal #${a.id_device}`,
        });
        faciaisVistos.add(a.id);
      }

      // Se a data_entrada/data_saida do visitante NÃO coincide com nenhum
      // acesso facial, foi por PIN ou manual
      if (v.data_entrada && !acessoFacialDe(v.id, 'entrada', v.data_entrada)) {
        historico.push({
          evento: 'entrada',
          timestamp: v.data_entrada.toISOString(),
          metodo: 'pin',
          metodoLabel: 'PIN / Manual',
        });
      }
      if (v.data_saida && !acessoFacialDe(v.id, 'saida', v.data_saida)) {
        historico.push({
          evento: 'saida',
          timestamp: v.data_saida.toISOString(),
          metodo: 'pin',
          metodoLabel: 'PIN / Manual',
        });
      }

      // Ordena cronologicamente (mais recente primeiro)
      historico.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return historico;
    };

    // Mapear Entradas
    for (const v of ultEntradasVisitantes) {
      if (isDuplicadoFacial(v.id, 'entrada', v.data_entrada)) continue;
      const aptoStr = v.apartamento
        ? `Apto ${v.apartamento.apto}${v.apartamento.bloco ?? ''}`
        : '';
      const dataEvento = v.data_entrada || v.created_at;
      ultimosEventos.push({
        tipo: v.is_prestador === 1 ? 'Prestador' : 'Visitante',
        descricao: `${v.nome} entrou — ${aptoStr}`.trim(),
        quando: dataEvento.toISOString(),
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
          historicoAcessos: buildHistoricoAcessos(v),
        },
      });
    }

    // Mapear Saídas
    for (const v of ultSaidasVisitantes) {
      if (!v.data_saida) continue;
      if (isDuplicadoFacial(v.id, 'saida', v.data_saida)) continue;
      const aptoStr = v.apartamento
        ? `Apto ${v.apartamento.apto}${v.apartamento.bloco ?? ''}`
        : '';
      ultimosEventos.push({
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
          historicoAcessos: buildHistoricoAcessos(v),
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

    // Mapear Acessos faciais (terminal facial)
    // Pra cada acesso, busca a foto e o apto da pessoa (morador ou visitante)
    if (ultAcessosFacial.length > 0) {
      const idsMorador = ultAcessosFacial
        .filter((a) => a.tipo_pessoa === 'morador')
        .map((a) => a.id_pessoa);
      const idsVisitante = ultAcessosFacial
        .filter((a) => a.tipo_pessoa === 'visitante')
        .map((a) => a.id_pessoa);

      const [moradoresInfo, visitantesInfo] = await Promise.all([
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
      ]);

      const moradorById = new Map(moradoresInfo.map((m) => [m.id, m]));
      const visitanteById = new Map(visitantesInfo.map((v) => [v.id, v]));

      for (const a of ultAcessosFacial) {
        const confiancaPct = a.confianca != null ? ` · ${Math.round(a.confianca * 100)}%` : '';
        const acao = a.evento === 'saida' ? 'saiu' : a.evento === 'negado' ? 'tentou acesso (negado)' : 'entrou';

        let foto: string | undefined;
        let aptoStr = '';
        let documento: string | undefined;

        if (a.tipo_pessoa === 'morador') {
          const m = moradorById.get(a.id_pessoa);
          foto = m?.foto_pessoa ?? m?.user?.photo ?? undefined;
          if (m?.bloco || m?.apartamento) {
            aptoStr = `Apto ${m?.apartamento ?? ''}${m?.bloco ?? ''}`.trim();
          }
        } else if (a.tipo_pessoa === 'visitante') {
          const v = visitanteById.get(a.id_pessoa);
          foto = v?.foto_pessoa ?? undefined;
          documento = v?.doc_identificacao ?? undefined;
          if (v?.apartamento) {
            aptoStr = `Apto ${v.apartamento.apto ?? ''}${v.apartamento.bloco ?? ''}`.trim();
          }
        }

        const terminalNome = deviceById.get(a.id_device) ?? `Terminal #${a.id_device}`;
        // Se for visitante, monta o histórico completo dele
        let historicoAcessos:
          | DashboardSummary['ultimosEventos'][number]['detalhes']['historicoAcessos']
          | undefined;
        if (a.tipo_pessoa === 'visitante') {
          const v = visitanteById.get(a.id_pessoa);
          if (v) {
            // Para usar buildHistoricoAcessos precisamos das datas do visitante;
            // visitanteInfo aqui não tem data_entrada/data_saida — vamos buscar
            // direto dos acessos faciais agrupados
            const acessosV = facialPorVisitante.get(a.id_pessoa) ?? [];
            historicoAcessos = acessosV
              .map((row) => ({
                evento: (row.evento === 'saida'
                  ? 'saida'
                  : row.evento === 'negado'
                    ? 'negado'
                    : 'entrada') as 'entrada' | 'saida' | 'negado',
                timestamp: row.timestamp.toISOString(),
                metodo: 'facial' as const,
                metodoLabel: 'Terminal Facial',
                confianca: row.confianca ?? undefined,
                terminalNome: deviceById.get(row.id_device) ?? `Terminal #${row.id_device}`,
              }))
              .sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
          }
        }

        ultimosEventos.push({
          tipo: 'Acesso Facial',
          descricao: `${a.nome_pessoa} ${acao} pelo terminal facial${confiancaPct}`,
          quando: a.timestamp.toISOString(),
          direcao: a.evento === 'saida' ? 'saida' : a.evento === 'negado' ? 'negado' : 'entrada',
          detalhes: {
            id: a.id,
            nome: a.nome_pessoa,
            documento,
            blocoApto: aptoStr || undefined,
            tipoPessoa: a.tipo_pessoa as any,
            status: a.evento === 'entrada' ? 'Entrada via terminal facial' :
                    a.evento === 'saida' ? 'Saída via terminal facial' :
                    'Acesso negado',
            dataEntrada: a.evento === 'entrada' ? a.timestamp.toISOString() : undefined,
            dataSaida: a.evento === 'saida' ? a.timestamp.toISOString() : undefined,
            autorizadoPor: terminalNome,
            descricao: a.confianca != null
              ? `Reconhecido com ${Math.round(a.confianca * 100)}% de confiança`
              : undefined,
            fotoPessoa: foto,
            metodoLiberacao: 'facial',
            metodoLabel: 'Terminal Facial',
            confianca: a.confianca ?? undefined,
            terminalNome,
            historicoAcessos,
          },
        });
      }
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
