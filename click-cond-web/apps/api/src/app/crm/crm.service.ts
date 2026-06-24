import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CRM — visão comercial (condomínios = clientes da Click Prestare) integrada
 * com indicadores operacionais de cada conta.
 *
 * A fonte da "assinatura" é, em ordem de prioridade:
 *   1. Assinaturas_Condominios (registro mais recente por data_fim)
 *   2. Condominios.valor_condominio + Condominios.vencimento (recorrência interna)
 *
 * Como o restante do código, este service cai em dados mock quando o Prisma
 * está offline (sem DATABASE_URL), para o portal funcionar em dev.
 */

export type EstagioCrm = 'lead' | 'trial' | 'ativo' | 'em_atraso' | 'churn';
export type StatusPagamento = 'em_dia' | 'vencendo' | 'atrasado' | 'sem_cobranca';

// --- Motor de risco de churn (sinais operacionais do controle de acesso) ---
export type RiscoNivel = 'alto' | 'medio' | 'baixo';
export interface RiscoMotivo {
  tipo: 'offline' | 'inatividade' | 'suporte';
  texto: string;
  severidade: 'alta' | 'media' | 'baixa';
}
export interface RiscoChurn {
  nivel: RiscoNivel;
  score: number; // 0-100 — quanto maior, maior o risco
  motivos: RiscoMotivo[];
}

export interface CrmContato {
  nome: string;
  email: string | null;
  telefone: string | null;
  papel: string;
}

export interface CrmClienteResumo {
  id: number;
  nome: string;
  identificacao: string | null;
  photo: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  estagio: EstagioCrm;
  plano: string | null;
  mrr: number;
  vencimento: string | null;
  diasParaVencer: number | null;
  statusPagamento: StatusPagamento;
  contatoPrincipal: CrmContato | null;
  healthScore: number;
  riscoChurn: RiscoChurn;
  // Operacional
  totalApartamentos: number;
  totalMoradores: number;
  ocorrenciasPendentes: number;
  visitantesAtivos: number;
  acessos30d: number;
  ultimaAtividade: string | null;
  clienteDesde: string | null;
  totalPorteiros: number;
  totalFuncionarios: number;
  dispositivosFaciais: number;
  dispositivosOffline: number;
  moradoresComFace: number;
  moradoresComTag: number;
  encomendasAguardando: number;
  encomendasRecebidas30d: number;
  comunicados30d: number;
  reservasAreas30d: number;
  recorrenciaAtiva: boolean;
  cobrancaAutoWhats: boolean;
  prestadoresCadastrados: number;
  assembleiasAgendadas: number;
}

export interface CrmOverview {
  totalClientes: number;
  clientesAtivos: number;
  mrrTotal: number;
  arrTotal: number;
  ticketMedio: number;
  emAtraso: { quantidade: number; valor: number };
  vencendo7d: { quantidade: number; valor: number };
  novos30d: number;
  churn: number;
  taxaChurn: number;
  porEstagio: Record<EstagioCrm, number>;
  porPlano: { plano: string; clientes: number; mrr: number }[];
  topClientes: { id: number; nome: string; mrr: number; healthScore: number }[];
  alertas: {
    id: number;
    nome: string;
    tipo: 'vencimento' | 'atraso' | 'health' | 'inativo' | 'offline' | 'inatividade' | 'suporte';
    mensagem: string;
    severidade: 'alta' | 'media' | 'baixa';
  }[];
}

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  private _mockClientesDb: CrmClienteResumo[] | null = null;

  private calcularMrr(plano: string | null, totalApartamentos: number, ativo = true): number {
    if (!ativo || !plano || plano === 'Sem plano') return 0;
    if (plano === 'Essencial') return 149 + totalApartamentos * 2.00;
    if (plano === 'Profissional') return 297 + totalApartamentos * 2.80;
    if (plano === 'Elite') return 497 + totalApartamentos * 3.80;
    return 0;
  }

  // ----------------------------------------------------------------------------
  // API pública
  // ----------------------------------------------------------------------------

  async clientes(): Promise<CrmClienteResumo[]> {
    if (!this.prisma.isConnected) {
      if (!this._mockClientesDb) {
        this._mockClientesDb = this.mockClientes();
      }
      return this._mockClientesDb;
    }
    const condominios = await this.prisma.condominios.findMany({
      include: { enderecoRel: true },
      orderBy: { nome: 'asc' },
    });
    return Promise.all(condominios.map((c) => this.montarCliente(c)));
  }

  async overview(): Promise<CrmOverview> {
    const clientes = await this.clientes();
    return this.montarOverview(clientes);
  }

  async cliente(id: number): Promise<CrmClienteResumo | null> {
    const clientes = await this.clientes();
    return clientes.find((c) => c.id === id) ?? null;
  }

  async atualizarCliente(id: number, data: any): Promise<CrmClienteResumo | null> {
    if (!this.prisma.isConnected) {
      // Mock update
      console.log('📝 CRM em modo mock: simulação de atualização recebida para condomínio', id, data);
      if (!this._mockClientesDb) {
        this._mockClientesDb = this.mockClientes();
      }
      const idx = this._mockClientesDb.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const c = this._mockClientesDb[idx];
        const plano = data.plano !== undefined ? data.plano : c.plano;
        const totalApartamentos = data.totalApartamentos !== undefined ? Number(data.totalApartamentos) : c.totalApartamentos;
        const mrr = this.calcularMrr(plano, totalApartamentos, c.ativo);

        this._mockClientesDb[idx] = {
          ...c,
          nome: data.nome !== undefined ? data.nome : c.nome,
          identificacao: data.identificacao !== undefined ? data.identificacao : c.identificacao,
          plano,
          totalApartamentos,
          mrr,
          vencimento: data.vencimento !== undefined ? (data.vencimento ? new Date(data.vencimento).toISOString() : null) : c.vencimento,
          recorrenciaAtiva: data.recorrenciaAtiva !== undefined ? !!data.recorrenciaAtiva : c.recorrenciaAtiva,
          cobrancaAutoWhats: data.cobrancaAutoWhats !== undefined ? !!data.cobrancaAutoWhats : c.cobrancaAutoWhats,
          contatoPrincipal: {
            nome: data.sindicoNome !== undefined ? data.sindicoNome : (c.contatoPrincipal?.nome ?? ''),
            email: data.sindicoEmail !== undefined ? data.sindicoEmail : (c.contatoPrincipal?.email ?? null),
            telefone: data.sindicoTelefone !== undefined ? data.sindicoTelefone : (c.contatoPrincipal?.telefone ?? null),
            papel: 'Síndico',
          }
        };
        return this._mockClientesDb[idx];
      }
      return null;
    }

    const {
      nome,
      identificacao,
      recorrenciaAtiva,
      cobrancaAutoWhats,
      totalApartamentos,
      mrr,
      plano,
      vencimento,
      sindicoNome,
      sindicoEmail,
      sindicoTelefone
    } = data;

    const cond = await this.prisma.condominios.findUnique({ where: { id } });
    if (!cond) return null;

    // 1. Atualiza condomínio
    await this.prisma.condominios.update({
      where: { id },
      data: {
        nome: nome !== undefined ? nome : undefined,
        identificacao: identificacao !== undefined ? identificacao : undefined,
        recorrencia_ativa: recorrenciaAtiva !== undefined ? !!recorrenciaAtiva : undefined,
        cobranca_auto_whats: cobrancaAutoWhats !== undefined ? !!cobrancaAutoWhats : undefined,
        valor_condominio: mrr !== undefined ? this.toNumber(mrr) : undefined,
        categoria_padrao: plano !== undefined ? plano : undefined,
        vencimento: vencimento !== undefined ? (vencimento ? new Date(vencimento) : null) : undefined,
      }
    });

    // 2. Atualiza ou cria assinatura
    if (plano !== undefined || mrr !== undefined || vencimento !== undefined) {
      const assinatura = await this.prisma.assinaturas_Condominios.findFirst({
        where: { id_condominio: id },
        orderBy: [{ data_fim: 'desc' }, { id: 'desc' }]
      });

      if (assinatura) {
        await this.prisma.assinaturas_Condominios.update({
          where: { id: assinatura.id },
          data: {
            plano: plano !== undefined ? plano : undefined,
            valor: mrr !== undefined ? this.toNumber(mrr) : undefined,
            data_fim: vencimento !== undefined ? (vencimento ? new Date(vencimento) : null) : undefined,
          }
        });
      } else {
        await this.prisma.assinaturas_Condominios.create({
          data: {
            id_condominio: id,
            plano: plano ?? 'Sem plano',
            valor: mrr !== undefined ? this.toNumber(mrr) : 0,
            data_ini: new Date(),
            data_fim: vencimento ? new Date(vencimento) : new Date(Date.now() + 365*24*3600*1000),
            email_user: sindicoEmail ?? 'sindico@clickprestare.com.br',
            plataforma: 'CRM',
            codigo: 'CRM-MANUAL',
            dias: 365,
          }
        });
      }
    }

    // 3. Atualiza síndico e usuário associado
    const vinculos = await this.prisma.sindicos_Condominios.findMany({ where: { id_condominio: id } });
    if (vinculos.length > 0) {
      const idUser = vinculos[0].id_user;
      const sindico = await this.prisma.sindicos.findFirst({ where: { id_user: idUser } });
      if (sindico) {
        await this.prisma.sindicos.update({
          where: { id: sindico.id },
          data: {
            name: sindicoNome !== undefined ? sindicoNome : undefined,
            email: sindicoEmail !== undefined ? sindicoEmail : undefined,
            phone: sindicoTelefone !== undefined ? sindicoTelefone : undefined,
          }
        });
      }
      await this.prisma.users.update({
        where: { id: idUser },
        data: {
          name: sindicoNome !== undefined ? sindicoNome : undefined,
          email: sindicoEmail !== undefined ? sindicoEmail : undefined,
          phone: sindicoTelefone !== undefined ? sindicoTelefone : undefined,
        }
      });
    }

    return this.cliente(id);
  }

  async exportarClienteCsv(id: number): Promise<string | null> {
    const c = await this.cliente(id);
    if (!c) return null;

    const headers = ['Indicador', 'Valor'];
    const rows = [
      ['ID Condominio', c.id],
      ['Nome', c.nome],
      ['CNPJ / Identificacao', c.identificacao ?? '—'],
      ['Cidade', c.cidade ?? '—'],
      ['UF', c.uf ?? '—'],
      ['Estagio CRM', c.estagio],
      ['Plano de Assinatura', c.plano ?? '—'],
      ['MRR (Recorrencia)', `R$ ${c.mrr}`],
      ['Vencimento', c.vencimento ? new Date(c.vencimento).toLocaleDateString('pt-BR') : '—'],
      ['Saude da Conta (Health Score)', `${c.healthScore}/100`],
      ['Recorrencia Automatica', c.recorrenciaAtiva ? 'Ativa' : 'Inativa'],
      ['Regua WhatsApp', c.cobrancaAutoWhats ? 'Ativa' : 'Inativa'],
      ['Sindico Nome', c.contatoPrincipal?.nome ?? '—'],
      ['Sindico Email', c.contatoPrincipal?.email ?? '—'],
      ['Sindico Telefone', c.contatoPrincipal?.telefone ?? '—'],
      ['Apartamentos', c.totalApartamentos],
      ['Moradores', c.totalMoradores],
      ['Moradores com Face', c.moradoresComFace],
      ['Moradores com RFID Tag', c.moradoresComTag],
      ['Porteiros Ativos', c.totalPorteiros],
      ['Funcionarios Condominio', c.totalFuncionarios],
      ['Terminais Faciais', c.dispositivosFaciais],
      ['Terminais Offline', c.dispositivosOffline],
      ['Acessos Faciais (30d)', c.acessos30d],
      ['Encomendas Aguardando', c.encomendasAguardando],
      ['Encomendas Recebidas (30d)', c.encomendasRecebidas30d],
      ['Comunicados Enviados (30d)', c.comunicados30d],
      ['Reservas de Areas (30d)', c.reservasAreas30d],
      ['Prestadores de Servico Cadastrados', c.prestadoresCadastrados],
      ['Assembleias Agendadas', c.assembleiasAgendadas],
      ['Cliente Desde', c.clienteDesde ? new Date(c.clienteDesde).toLocaleDateString('pt-BR') : '—'],
      ['Ultima Atividade', c.ultimaAtividade ? new Date(c.ultimaAtividade).toLocaleString('pt-BR') : '—'],
    ];

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    return csvContent;
  }

  async healthCheck(): Promise<{
    connected: boolean;
    mode: 'live' | 'mock';
    totalCondominios: number;
    serverTime: string;
    dbLatencyMs: number;
  }> {
    const serverTime = new Date().toISOString();

    if (!this.prisma.isConnected) {
      const mockCount = this._mockClientesDb?.length ?? 5;
      return {
        connected: false,
        mode: 'mock',
        totalCondominios: mockCount,
        serverTime,
        dbLatencyMs: -1,
      };
    }

    // Medir latência do banco com um SELECT simples
    const start = Date.now();
    let totalCondominios = 0;
    try {
      totalCondominios = await this.prisma.condominios.count();
    } catch {
      totalCondominios = 0;
    }
    const dbLatencyMs = Date.now() - start;

    return {
      connected: true,
      mode: 'live',
      totalCondominios,
      serverTime,
      dbLatencyMs,
    };
  }

  // ----------------------------------------------------------------------------
  // Montagem de um cliente (condomínio) — comercial + operacional
  // ----------------------------------------------------------------------------

  private async montarCliente(c: any): Promise<CrmClienteResumo> {
    const idCond = c.id;
    const agora = new Date();
    const inicioMes30 = new Date(agora.getTime() - 30 * 24 * 3600 * 1000);

    const [
      assinatura,
      vinculosSindico,
      aptosCount,
      totalMoradores,
      ocorrenciasPendentes,
      visitantesAtivos,
      acessos30d,
      ultimoAcesso,
      totalPorteiros,
      totalFuncionarios,
      dispositivosFaciais,
      dispositivosRows,
      moradoresComFace,
      moradoresComTag,
      encomendasAguardando,
      encomendasRecebidas30d,
      comunicados30d,
      reservasAreas30d,
      prestadoresCadastrados,
      assembleiasAgendadas,
    ] = await Promise.all([
      this.prisma.assinaturas_Condominios
        .findFirst({ where: { id_condominio: idCond }, orderBy: [{ data_fim: 'desc' }, { id: 'desc' }] })
        .catch(() => null),
      this.prisma.sindicos_Condominios
        .findMany({ where: { id_condominio: idCond } })
        .catch(() => [] as any[]),
      this.prisma.apartamentos.count({ where: { id_condominio: idCond } }).catch(() => 0),
      this.prisma.moradores.count({ where: { id_condominio: idCond } }).catch(() => 0),
      this.prisma.ocorrencias
        .count({ where: { id_condominio: idCond, status: 'Pendente' } })
        .catch(() => 0),
      this.prisma.visitantes
        .count({ where: { id_condominio: idCond, data_entrada: { not: null }, data_saida: null } })
        .catch(() => 0),
      this.prisma.acessos_Facial
        .count({ where: { id_condominio: idCond, created_at: { gte: inicioMes30 } } })
        .catch(() => 0),
      this.prisma.acessos_Facial
        .findFirst({ where: { id_condominio: idCond }, orderBy: { created_at: 'desc' } })
        .catch(() => null),
      this.prisma.funcionarios_Portaria
        .count({ where: { id_condominio: idCond, ativo: 1 } })
        .catch(() => 0),
      this.prisma.funcionarios
        .count({ where: { id_condominio: idCond } })
        .catch(() => 0),
      this.prisma.facial_Devices
        .count({ where: { id_condominio: idCond, ativo: 1 } })
        .catch(() => 0),
      // Terminais ativos com a última sincronização — para calcular offline + duração real
      this.prisma.facial_Devices
        .findMany({ where: { id_condominio: idCond, ativo: 1 }, select: { ultima_sincr: true } })
        .catch(() => [] as { ultima_sincr: Date | null }[]),
      this.prisma.moradores
        .count({ where: { id_condominio: idCond, face_id: { not: null } } })
        .catch(() => 0),
      this.prisma.moradores
        .count({ where: { id_condominio: idCond, tag_rfid: { not: null } } })
        .catch(() => 0),
      this.prisma.encomendas
        .count({ where: { id_condominio: idCond, status: 'Aguardando' } })
        .catch(() => 0),
      this.prisma.encomendas
        .count({ where: { id_condominio: idCond, recebido_em: { gte: inicioMes30 } } })
        .catch(() => 0),
      this.prisma.comunicados
        .count({ where: { id_condominio: idCond, created_at: { gte: inicioMes30 } } })
        .catch(() => 0),
      this.prisma.areas_Sociais_Agendamentos
        .count({ where: { area: { id_condominio: idCond }, data: { gte: inicioMes30 } } })
        .catch(() => 0),
      this.prisma.prestadores_servico
        .count({ where: { id_condominio: idCond } })
        .catch(() => 0),
      this.prisma.assembleias
        .count({ where: { id_condominio: idCond, data: { gte: agora } } })
        .catch(() => 0),
    ]);

    const contato = await this.resolverContato(vinculosSindico);

    // Comercial
    const plano = assinatura?.plano ?? (this.toNumber(c.valor_condominio) > 0 ? c.categoria_padrao : null);
    const totalApartamentos = aptosCount || 0;
    const ativo = c.ativo === 1 || c.ativo === true;
    const mrr = this.calcularMrr(plano, totalApartamentos, ativo);
    const vencimentoDate: Date | null = assinatura?.data_fim ?? c.vencimento ?? null;
    const diasParaVencer = vencimentoDate
      ? Math.ceil((new Date(vencimentoDate).getTime() - agora.getTime()) / (24 * 3600 * 1000))
      : null;

    const statusPagamento: StatusPagamento =
      mrr <= 0
        ? 'sem_cobranca'
        : diasParaVencer === null
          ? 'sem_cobranca'
          : diasParaVencer < 0
            ? 'atrasado'
            : diasParaVencer <= 7
              ? 'vencendo'
              : 'em_dia';

    const clienteDesde: Date | null = c.created_at ?? null;
    const emTrial =
      clienteDesde && !assinatura && ativo
        ? (agora.getTime() - new Date(clienteDesde).getTime()) / (24 * 3600 * 1000) <= 45
        : false;

    const estagio: EstagioCrm = !ativo
      ? 'churn'
      : statusPagamento === 'atrasado'
        ? 'em_atraso'
        : emTrial
          ? 'trial'
          : mrr <= 0
            ? 'lead'
            : 'ativo';

    const ultimaAtividade: Date | null = ultimoAcesso?.created_at ?? null;

    const healthScore = this.calcularHealth({
      ativo,
      statusPagamento,
      totalMoradores,
      ocorrenciasPendentes,
      acessos30d,
      ultimaAtividade,
      agora,
    });

    // Terminais offline + duração (mesmo limiar de 10min usado antes)
    const OFFLINE_MS = 10 * 60 * 1000;
    const offlineDevices = (dispositivosRows ?? []).filter(
      (d) => !d.ultima_sincr || agora.getTime() - new Date(d.ultima_sincr).getTime() > OFFLINE_MS,
    );
    const dispositivosOffline = offlineDevices.length;
    const maxOfflineDias = offlineDevices.reduce((max, d) => {
      if (!d.ultima_sincr) return Math.max(max, 999); // nunca sincronizou
      const dias = (agora.getTime() - new Date(d.ultima_sincr).getTime()) / (24 * 3600 * 1000);
      return Math.max(max, dias);
    }, 0);

    const riscoChurn = this.calcularRiscoChurn({
      ativo,
      dispositivosOffline,
      maxOfflineDias,
      dispositivosFaciais,
      ultimaAtividade,
      ocorrenciasPendentes,
      agora,
    });

    return {
      id: idCond,
      nome: c.nome,
      identificacao: c.identificacao ?? null,
      photo: c.photo ?? null,
      cidade: c.enderecoRel?.cidade ?? null,
      uf: c.enderecoRel?.uf ?? null,
      ativo,
      estagio,
      plano,
      mrr,
      vencimento: vencimentoDate ? new Date(vencimentoDate).toISOString() : null,
      diasParaVencer,
      statusPagamento,
      contatoPrincipal: contato,
      healthScore,
      riscoChurn,
      totalApartamentos,
      totalMoradores,
      ocorrenciasPendentes,
      visitantesAtivos,
      acessos30d,
      ultimaAtividade: ultimaAtividade ? new Date(ultimaAtividade).toISOString() : null,
      clienteDesde: clienteDesde ? new Date(clienteDesde).toISOString() : null,
      totalPorteiros,
      totalFuncionarios,
      dispositivosFaciais,
      dispositivosOffline,
      moradoresComFace,
      moradoresComTag,
      encomendasAguardando,
      encomendasRecebidas30d,
      comunicados30d,
      reservasAreas30d,
      recorrenciaAtiva: c.recorrencia_ativa === true || c.recorrencia_ativa === 1,
      cobrancaAutoWhats: c.cobranca_auto_whats === true || c.cobranca_auto_whats === 1,
      prestadoresCadastrados,
      assembleiasAgendadas,
    };
  }

  private async resolverContato(vinculos: any[]): Promise<CrmContato | null> {
    if (!vinculos?.length) return null;
    const idUser = vinculos[0].id_user;
    const sindico = await this.prisma.sindicos
      .findFirst({ where: { id_user: idUser }, orderBy: { id: 'asc' } })
      .catch(() => null);
    if (!sindico) return null;
    return {
      nome: sindico.name,
      email: sindico.email ?? null,
      telefone: sindico.phone ?? null,
      papel: 'Síndico',
    };
  }

  private calcularHealth(p: {
    ativo: boolean;
    statusPagamento: StatusPagamento;
    totalMoradores: number;
    ocorrenciasPendentes: number;
    acessos30d: number;
    ultimaAtividade: Date | null;
    agora: Date;
  }): number {
    if (!p.ativo) return 0;
    let score = 50;

    // Pagamento (peso alto)
    if (p.statusPagamento === 'em_dia') score += 20;
    else if (p.statusPagamento === 'vencendo') score += 8;
    else if (p.statusPagamento === 'atrasado') score -= 25;

    // Adoção / uso
    if (p.totalMoradores > 0) score += 10;
    if (p.acessos30d >= 100) score += 15;
    else if (p.acessos30d >= 20) score += 10;
    else if (p.acessos30d >= 1) score += 5;
    else score -= 10;

    // Recência de atividade
    if (p.ultimaAtividade) {
      const dias = (p.agora.getTime() - new Date(p.ultimaAtividade).getTime()) / (24 * 3600 * 1000);
      if (dias <= 3) score += 10;
      else if (dias <= 14) score += 5;
      else if (dias > 45) score -= 15;
    }

    // Atrito operacional
    if (p.ocorrenciasPendentes >= 10) score -= 10;
    else if (p.ocorrenciasPendentes >= 5) score -= 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Risco de churn a partir de sinais operacionais do controle de acesso.
   * Foco: dispositivos offline e inatividade/suporte (limiares tunáveis).
   * score 0-100 (maior = mais risco); nivel = alto ≥45 | medio ≥20 | baixo.
   */
  private calcularRiscoChurn(p: {
    ativo: boolean;
    dispositivosOffline: number;
    maxOfflineDias: number;
    dispositivosFaciais: number;
    ultimaAtividade: Date | null;
    ocorrenciasPendentes: number;
    agora: Date;
  }): RiscoChurn {
    if (!p.ativo) return { nivel: 'baixo', score: 0, motivos: [] };

    const motivos: RiscoMotivo[] = [];
    let score = 0;

    // 1) Dispositivos offline (terminal "não funcionando" na percepção do cliente)
    if (p.dispositivosOffline > 0) {
      const nunca = p.maxOfflineDias >= 900;
      const dias = Math.floor(p.maxOfflineDias);
      if (nunca || p.maxOfflineDias >= 3) {
        score += 45;
        motivos.push({
          tipo: 'offline',
          severidade: 'alta',
          texto: nunca
            ? `${p.dispositivosOffline} terminal(is) nunca sincronizaram`
            : `${p.dispositivosOffline} terminal(is) offline há ${dias} dia(s)`,
        });
      } else {
        score += 20;
        motivos.push({
          tipo: 'offline',
          severidade: 'media',
          texto: `${p.dispositivosOffline} terminal(is) offline recentemente`,
        });
      }
    }

    // 2) Inatividade — sem acessos registrados (conta "morta")
    if (p.ultimaAtividade) {
      const dias = Math.floor((p.agora.getTime() - new Date(p.ultimaAtividade).getTime()) / (24 * 3600 * 1000));
      if (dias >= 14) {
        score += 40;
        motivos.push({ tipo: 'inatividade', severidade: 'alta', texto: `Sem nenhum acesso há ${dias} dias` });
      } else if (dias >= 7) {
        score += 20;
        motivos.push({ tipo: 'inatividade', severidade: 'media', texto: `Acessos rarefeitos (último há ${dias} dias)` });
      }
    } else if (p.dispositivosFaciais > 0) {
      // Tem hardware instalado mas nenhum acesso jamais registrado
      score += 30;
      motivos.push({ tipo: 'inatividade', severidade: 'alta', texto: 'Hardware instalado sem nenhum acesso registrado' });
    }

    // 3) Backlog de suporte (ocorrências pendentes acumulando)
    if (p.ocorrenciasPendentes >= 10) {
      score += 25;
      motivos.push({ tipo: 'suporte', severidade: 'alta', texto: `${p.ocorrenciasPendentes} ocorrências pendentes acumuladas` });
    } else if (p.ocorrenciasPendentes >= 5) {
      score += 12;
      motivos.push({ tipo: 'suporte', severidade: 'media', texto: `${p.ocorrenciasPendentes} ocorrências pendentes` });
    }

    score = Math.min(100, score);
    const nivel: RiscoNivel = score >= 45 ? 'alto' : score >= 20 ? 'medio' : 'baixo';
    return { nivel, score, motivos };
  }

  // ----------------------------------------------------------------------------
  // Overview (KPIs agregados)
  // ----------------------------------------------------------------------------

  private montarOverview(clientes: CrmClienteResumo[]): CrmOverview {
    const agora = new Date();
    const mes30 = new Date(agora.getTime() - 30 * 24 * 3600 * 1000);

    const ativos = clientes.filter((c) => c.ativo);
    const mrrTotal = ativos.reduce((s, c) => s + c.mrr, 0);
    const pagantes = ativos.filter((c) => c.mrr > 0);

    const atraso = clientes.filter((c) => c.statusPagamento === 'atrasado');
    const vencendo = clientes.filter((c) => c.statusPagamento === 'vencendo');
    const novos30 = clientes.filter((c) => c.clienteDesde && new Date(c.clienteDesde) >= mes30);
    const churn = clientes.filter((c) => c.estagio === 'churn');

    const porEstagio: Record<EstagioCrm, number> = {
      lead: 0,
      trial: 0,
      ativo: 0,
      em_atraso: 0,
      churn: 0,
    };
    clientes.forEach((c) => (porEstagio[c.estagio] += 1));

    const planosMap = new Map<string, { clientes: number; mrr: number }>();
    ativos.forEach((c) => {
      const key = c.plano ?? 'Sem plano';
      const cur = planosMap.get(key) ?? { clientes: 0, mrr: 0 };
      cur.clientes += 1;
      cur.mrr += c.mrr;
      planosMap.set(key, cur);
    });
    const porPlano = [...planosMap.entries()]
      .map(([plano, v]) => ({ plano, ...v }))
      .sort((a, b) => b.mrr - a.mrr);

    const topClientes = [...clientes]
      .sort((a, b) => b.mrr - a.mrr)
      .slice(0, 5)
      .map((c) => ({ id: c.id, nome: c.nome, mrr: c.mrr, healthScore: c.healthScore }));

    const alertas: CrmOverview['alertas'] = [];
    atraso.forEach((c) =>
      alertas.push({
        id: c.id,
        nome: c.nome,
        tipo: 'atraso',
        mensagem: `Pagamento atrasado há ${Math.abs(c.diasParaVencer ?? 0)} dia(s)`,
        severidade: 'alta',
      }),
    );
    vencendo.forEach((c) =>
      alertas.push({
        id: c.id,
        nome: c.nome,
        tipo: 'vencimento',
        mensagem: `Vence em ${c.diasParaVencer} dia(s)`,
        severidade: 'media',
      }),
    );
    clientes
      .filter((c) => c.ativo && c.healthScore < 40)
      .forEach((c) =>
        alertas.push({
          id: c.id,
          nome: c.nome,
          tipo: 'health',
          mensagem: `Health score baixo (${c.healthScore})`,
          severidade: 'media',
        }),
      );

    // Radar de Risco: motivos operacionais (offline / inatividade / suporte)
    clientes
      .filter((c) => c.ativo && c.riscoChurn.nivel !== 'baixo')
      .forEach((c) => {
        const top = c.riscoChurn.motivos[0];
        if (top) {
          alertas.push({
            id: c.id,
            nome: c.nome,
            tipo: top.tipo,
            mensagem: top.texto,
            severidade: top.severidade,
          });
        }
      });

    const severidadeOrdem = { alta: 0, media: 1, baixa: 2 };
    alertas.sort((a, b) => severidadeOrdem[a.severidade] - severidadeOrdem[b.severidade]);

    const baseChurn = ativos.length + churn.length;

    return {
      totalClientes: clientes.length,
      clientesAtivos: ativos.length,
      mrrTotal,
      arrTotal: mrrTotal * 12,
      ticketMedio: pagantes.length ? mrrTotal / pagantes.length : 0,
      emAtraso: { quantidade: atraso.length, valor: atraso.reduce((s, c) => s + c.mrr, 0) },
      vencendo7d: { quantidade: vencendo.length, valor: vencendo.reduce((s, c) => s + c.mrr, 0) },
      novos30d: novos30.length,
      churn: churn.length,
      taxaChurn: baseChurn ? Math.round((churn.length / baseChurn) * 1000) / 10 : 0,
      porEstagio,
      porPlano,
      topClientes,
      alertas: alertas.slice(0, 12),
    };
  }

  // ----------------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------------

  private toNumber(v: any): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    // Prisma Decimal
    if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // ----------------------------------------------------------------------------
  // Mock (Prisma offline)
  // ----------------------------------------------------------------------------

  private mockClientes(): CrmClienteResumo[] {
    const hoje = new Date();
    const iso = (d: Date) => d.toISOString();
    const add = (dias: number) => new Date(hoje.getTime() + dias * 24 * 3600 * 1000);

    const base: Partial<CrmClienteResumo>[] = [
      {
        id: 1,
        nome: 'Residencial Jardim das Flores',
        identificacao: 'CNPJ 12.345.678/0001-90',
        cidade: 'São Paulo',
        uf: 'SP',
        ativo: true,
        plano: 'Profissional',
        mrr: 890,
        vencimento: iso(add(18)),
        diasParaVencer: 18,
        statusPagamento: 'em_dia',
        contatoPrincipal: { nome: 'Marcos Andrade', email: 'sindico@jardimflores.com', telefone: '(11) 99876-5432', papel: 'Síndico' },
        totalApartamentos: 120,
        totalMoradores: 312,
        ocorrenciasPendentes: 2,
        visitantesAtivos: 5,
        acessos30d: 1840,
        ultimaAtividade: iso(add(0)),
        clienteDesde: iso(add(-420)),
        totalPorteiros: 4,
        totalFuncionarios: 8,
        dispositivosFaciais: 3,
        dispositivosOffline: 0,
        moradoresComFace: 210,
        moradoresComTag: 180,
        encomendasAguardando: 3,
        encomendasRecebidas30d: 45,
        comunicados30d: 6,
        reservasAreas30d: 12,
        recorrenciaAtiva: true,
        cobrancaAutoWhats: true,
        prestadoresCadastrados: 24,
        assembleiasAgendadas: 1,
      },
      {
        id: 2,
        nome: 'Edifício Costa Verde',
        identificacao: 'CNPJ 98.765.432/0001-10',
        cidade: 'Rio de Janeiro',
        uf: 'RJ',
        ativo: true,
        plano: 'Elite',
        mrr: 1650,
        vencimento: iso(add(4)),
        diasParaVencer: 4,
        statusPagamento: 'vencendo',
        contatoPrincipal: { nome: 'Patrícia Lemos', email: 'gestao@costaverde.com', telefone: '(21) 98123-4455', papel: 'Síndico' },
        totalApartamentos: 240,
        totalMoradores: 690,
        ocorrenciasPendentes: 7,
        visitantesAtivos: 12,
        acessos30d: 4120,
        ultimaAtividade: iso(add(0)),
        clienteDesde: iso(add(-900)),
        totalPorteiros: 6,
        totalFuncionarios: 12,
        dispositivosFaciais: 5,
        dispositivosOffline: 1,
        moradoresComFace: 520,
        moradoresComTag: 480,
        encomendasAguardando: 8,
        encomendasRecebidas30d: 120,
        comunicados30d: 10,
        reservasAreas30d: 34,
        recorrenciaAtiva: true,
        cobrancaAutoWhats: false,
        prestadoresCadastrados: 56,
        assembleiasAgendadas: 0,
      },
      {
        id: 3,
        nome: 'Condomínio Parque dos Pássaros',
        identificacao: 'CNPJ 45.111.222/0001-33',
        cidade: 'Curitiba',
        uf: 'PR',
        ativo: true,
        plano: 'Profissional',
        mrr: 890,
        vencimento: iso(add(-6)),
        diasParaVencer: -6,
        statusPagamento: 'atrasado',
        contatoPrincipal: { nome: 'Roberto Tavares', email: 'sindico@parquepassaros.com', telefone: '(41) 99555-1212', papel: 'Síndico' },
        totalApartamentos: 80,
        totalMoradores: 198,
        ocorrenciasPendentes: 11,
        visitantesAtivos: 1,
        acessos30d: 320,
        ultimaAtividade: iso(add(-9)),
        clienteDesde: iso(add(-260)),
        totalPorteiros: 3,
        totalFuncionarios: 5,
        dispositivosFaciais: 2,
        dispositivosOffline: 0,
        moradoresComFace: 95,
        moradoresComTag: 120,
        encomendasAguardando: 1,
        encomendasRecebidas30d: 18,
        comunicados30d: 2,
        reservasAreas30d: 8,
        recorrenciaAtiva: true,
        cobrancaAutoWhats: true,
        prestadoresCadastrados: 12,
        assembleiasAgendadas: 0,
      },
      {
        id: 4,
        nome: 'Villa Toscana Residence',
        identificacao: 'CNPJ 77.888.999/0001-55',
        cidade: 'Belo Horizonte',
        uf: 'MG',
        ativo: true,
        plano: 'Essencial',
        mrr: 0,
        vencimento: iso(add(33)),
        diasParaVencer: 33,
        statusPagamento: 'sem_cobranca',
        contatoPrincipal: { nome: 'Juliana Reis', email: 'contato@villatoscana.com', telefone: '(31) 98777-3322', papel: 'Síndico' },
        totalApartamentos: 60,
        totalMoradores: 140,
        ocorrenciasPendentes: 1,
        visitantesAtivos: 3,
        acessos30d: 95,
        ultimaAtividade: iso(add(-1)),
        clienteDesde: iso(add(-20)),
        totalPorteiros: 2,
        totalFuncionarios: 3,
        dispositivosFaciais: 1,
        dispositivosOffline: 0,
        moradoresComFace: 45,
        moradoresComTag: 70,
        encomendasAguardando: 0,
        encomendasRecebidas30d: 8,
        comunicados30d: 1,
        reservasAreas30d: 3,
        recorrenciaAtiva: false,
        cobrancaAutoWhats: false,
        prestadoresCadastrados: 5,
        assembleiasAgendadas: 1,
      },
      {
        id: 5,
        nome: 'Solar das Acácias',
        identificacao: 'CNPJ 33.444.555/0001-66',
        cidade: 'Porto Alegre',
        uf: 'RS',
        ativo: false,
        plano: 'Profissional',
        mrr: 0,
        vencimento: iso(add(-75)),
        diasParaVencer: -75,
        statusPagamento: 'atrasado',
        contatoPrincipal: { nome: 'Fernando Klein', email: 'sindico@solaracacias.com', telefone: '(51) 99444-8899', papel: 'Síndico' },
        totalApartamentos: 48,
        totalMoradores: 0,
        ocorrenciasPendentes: 0,
        visitantesAtivos: 0,
        acessos30d: 0,
        ultimaAtividade: iso(add(-80)),
        clienteDesde: iso(add(-540)),
        totalPorteiros: 0,
        totalFuncionarios: 0,
        dispositivosFaciais: 0,
        dispositivosOffline: 0,
        moradoresComFace: 0,
        moradoresComTag: 0,
        encomendasAguardando: 0,
        encomendasRecebidas30d: 0,
        comunicados30d: 0,
        reservasAreas30d: 0,
        recorrenciaAtiva: false,
        cobrancaAutoWhats: false,
        prestadoresCadastrados: 0,
        assembleiasAgendadas: 0,
      },
    ];

    return base.map((b) => {
      const computedMrr = this.calcularMrr(b.plano!, b.totalApartamentos!, b.ativo!);
      const estagio: EstagioCrm = !b.ativo
        ? 'churn'
        : b.statusPagamento === 'atrasado'
          ? 'em_atraso'
          : b.statusPagamento === 'sem_cobranca'
            ? 'trial'
            : computedMrr <= 0
              ? 'lead'
              : 'ativo';
      const health = this.calcularHealth({
        ativo: !!b.ativo,
        statusPagamento: b.statusPagamento as StatusPagamento,
        totalMoradores: b.totalMoradores!,
        ocorrenciasPendentes: b.ocorrenciasPendentes!,
        acessos30d: b.acessos30d!,
        ultimaAtividade: b.ultimaAtividade ? new Date(b.ultimaAtividade) : null,
        agora: hoje,
      });
      const riscoChurn = this.calcularRiscoChurn({
        ativo: !!b.ativo,
        dispositivosOffline: b.dispositivosOffline ?? 0,
        // Sem timestamps no mock: estima duração para o offline aparecer no Radar (dev)
        maxOfflineDias: (b.dispositivosOffline ?? 0) > 0 ? 5 : 0,
        dispositivosFaciais: b.dispositivosFaciais ?? 0,
        ultimaAtividade: b.ultimaAtividade ? new Date(b.ultimaAtividade) : null,
        ocorrenciasPendentes: b.ocorrenciasPendentes!,
        agora: hoje,
      });
      return { photo: null, estagio, healthScore: health, riscoChurn, ...b, mrr: computedMrr } as CrmClienteResumo;
    });
  }
}
