import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export type OcorrenciaStatus = 'Pendente' | 'Ciente' | 'Solucionado';

export interface CreateOcorrenciaDto {
  descricao: string;
  tipo: number;
  anexos?: string;
  id_condominio: number;
  user?: number;
}

@Injectable()
export class OcorrenciasService {
  private readonly logger = new Logger(OcorrenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  listCategorias() {
    return this.prisma.ocorrencias_Categorias.findMany({
      orderBy: { prioridade: 'asc' },
    });
  }

  // ----- Categorias CRUD (mini-helpdesk: nome, prioridade, SLA em horas) -----
  async createCategoria(data: { nome: string; prioridade?: number; sla_horas?: number | null }) {
    return this.prisma.ocorrencias_Categorias.create({
      data: {
        nome: data.nome,
        prioridade: data.prioridade ?? 0,
        sla_horas: data.sla_horas ?? null,
      },
    });
  }

  async updateCategoria(id: number, data: { nome?: string; prioridade?: number; sla_horas?: number | null }) {
    try {
      return await this.prisma.ocorrencias_Categorias.update({
        where: { id },
        data: {
          ...(data.nome !== undefined ? { nome: data.nome } : {}),
          ...(data.prioridade !== undefined ? { prioridade: data.prioridade } : {}),
          ...(data.sla_horas !== undefined ? { sla_horas: data.sla_horas } : {}),
        },
      });
    } catch {
      throw new NotFoundException(`Categoria ${id} não encontrada`);
    }
  }

  async removeCategoria(id: number) {
    try {
      await this.prisma.ocorrencias_Categorias.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Categoria ${id} não encontrada`);
    }
  }

  /** Resolve nome (Users.name) para uma lista de ids de responsável. */
  private async responsavelNomes(ids: number[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((v): v is number => v != null))];
    if (uniq.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name ?? '']));
  }

  /**
   * Funcionários (porteiros) do condomínio que podem ser responsáveis por
   * ocorrências. Retorna id_user (Users.id, usado no push) + nome.
   */
  async listFuncionariosAtribuiveis(idCondominio: number) {
    const reais = await this.prisma.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCondominio), ativo: 1 },
      orderBy: { nome: 'asc' },
    });
    const logins = reais.map((f) => f.login).filter(Boolean) as string[];
    if (logins.length === 0) return [];
    const users = await this.prisma.users.findMany({
      where: { login: { in: logins } },
      select: { id: true, login: true },
    });
    const idMap = new Map(users.map((u) => [u.login, u.id]));
    return reais
      .map((f) => ({
        id_user: f.login ? idMap.get(f.login) ?? null : null,
        nome: f.nome ?? '',
        funcao: f.turno ? `Porteiro ${f.turno}` : 'Porteiro',
      }))
      .filter((f) => f.id_user != null);
  }

  async findAll(idCondominio: number, status?: string) {
    const list = await this.prisma.ocorrencias.findMany({
      where: {
        id_condominio: idCondominio,
        ...(status ? { status } : {}),
      },
      include: {
        categoria: { select: { nome: true, sla_horas: true } },
        criadoPor: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    const nomes = await this.responsavelNomes(list.map((o) => o.id_responsavel));
    return list.map((o) => ({
      id: o.id,
      descricao: o.descricao,
      anexos: o.anexos,
      status: o.status,
      resposta: o.resposta,
      resposta_at: o.resposta_at,
      tipo: o.tipo,
      tipoNome: o.categoria?.nome ?? null,
      sla_horas: o.categoria?.sla_horas ?? null,
      prazo: o.prazo,
      id_responsavel: o.id_responsavel,
      responsavelNome: o.id_responsavel ? nomes.get(o.id_responsavel) ?? null : null,
      criadoPorNome: o.criadoPor?.name ?? 'Morador',
      created_at: o.created_at,
      publica: o.publica,
    }));
  }

  async findOne(id: number) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: {
        categoria: { select: { nome: true, sla_horas: true } },
        criadoPor: { select: { name: true } },
      },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    const nomes = await this.responsavelNomes([o.id_responsavel]);
    return {
      ...o,
      tipoNome: o.categoria?.nome ?? null,
      sla_horas: o.categoria?.sla_horas ?? null,
      responsavelNome: o.id_responsavel ? nomes.get(o.id_responsavel) ?? null : null,
      criadoPorNome: o.criadoPor?.name ?? 'Morador',
    };
  }

  async create(dto: CreateOcorrenciaDto) {
    // Normaliza tipo: app Flutter pode enviar como string mas schema eh Int.
    const tipoNum = dto.tipo != null ? Number(dto.tipo) : null;

    // SLA: se a categoria tem sla_horas, o prazo = agora + sla_horas.
    let prazo: Date | null = null;
    if (tipoNum != null) {
      const cat = await this.prisma.ocorrencias_Categorias.findUnique({
        where: { id: tipoNum },
        select: { sla_horas: true },
      });
      if (cat?.sla_horas != null) {
        prazo = new Date(Date.now() + cat.sla_horas * 3600 * 1000);
      }
    }

    try {
      return await this.prisma.ocorrencias.create({
        data: {
          descricao: dto.descricao,
          anexos: dto.anexos ?? null,
          tipo: tipoNum,
          status: 'Pendente',
          id_condominio: dto.id_condominio,
          user: dto.user ?? null,
          prazo,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[ocorrencias.create] Falha: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel registrar a ocorrencia. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
  }

  async updateStatus(id: number, status: OcorrenciaStatus) {
    try {
      return await this.prisma.ocorrencias.update({
        where: { id },
        data: { status },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  async updatePublica(id: number, publica: boolean) {
    try {
      return await this.prisma.ocorrencias.update({
        where: { id },
        data: { publica },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  async updateResposta(id: number, resposta: string) {
    try {
      return await this.prisma.ocorrencias.update({
        where: { id },
        data: {
          resposta,
          resposta_at: new Date(),
        },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.ocorrencias.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  /**
   * Atribui a ocorrência a um funcionário (Users.id) e dispara push a ele.
   * idResponsavel = null desatribui.
   */
  async atribuir(id: number, idResponsavel: number | null) {
    let updated;
    try {
      updated = await this.prisma.ocorrencias.update({
        where: { id },
        data: { id_responsavel: idResponsavel },
        include: { categoria: { select: { nome: true } } },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }

    if (idResponsavel != null) {
      try {
        const resp = await this.prisma.users.findUnique({
          where: { id: idResponsavel },
          select: { fcm_token: true },
        });
        if (resp?.fcm_token) {
          const cat = updated.categoria?.nome ? ` (${updated.categoria.nome})` : '';
          await this.notifications.sendPushNotification(
            resp.fcm_token,
            'Ocorrência atribuída a você',
            `Você é o responsável pela ocorrência #${id}${cat}.`,
            { id: id.toString(), type: 'ocorrencia_atribuida' },
          );
        }
      } catch (e) {
        this.logger.error(`[ocorrencias.atribuir] push falhou: ${e?.message ?? e}`);
      }
    }

    return updated;
  }

  async listMessages(idOcorrencia: number) {
    return this.prisma.ocorrenciaMensagens.findMany({
      where: { id_ocorrencia: idOcorrencia },
      include: {
        usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async createMessage(idOcorrencia: number, idUsuario: number, mensagem: string) {
    const msg = await this.prisma.ocorrenciaMensagens.create({
      data: {
        id_ocorrencia: idOcorrencia,
        id_usuario: idUsuario,
        mensagem,
      },
      include: {
        usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
      },
    });

    try {
      await this.sendChatNotification(idOcorrencia, idUsuario, mensagem);
    } catch (e) {
      console.error('Error sending chat notification:', e);
    }

    return msg;
  }

  private async sendChatNotification(idOcorrencia: number, idUsuarioSender: number, mensagem: string) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOcorrencia },
      include: {
        criadoPor: { select: { id: true, name: true, fcm_token: true } },
      },
    });
    if (!o) return;

    const sender = await this.prisma.users.findUnique({
      where: { id: idUsuarioSender },
      select: { name: true, is_sindico: true },
    });
    const senderName = sender?.name || 'Sistema';

    if (sender?.is_sindico === 1) {
      if (o.criadoPor?.fcm_token) {
        await this.notifications.sendPushNotification(
          o.criadoPor.fcm_token,
          'Nova mensagem na sua Ocorrência',
          `${senderName}: ${mensagem}`,
          { id: idOcorrencia.toString(), type: 'ocorrencia_chat' },
        );
      }
    } else {
      const sindicos = await this.prisma.users.findMany({
        where: {
          is_sindico: 1,
          sindicosCondominios: {
            some: { id_condominio: o.id_condominio },
          },
          fcm_token: { not: null },
        },
        select: { fcm_token: true },
      });

      for (const s of sindicos) {
        if (s.fcm_token) {
          await this.notifications.sendPushNotification(
            s.fcm_token,
            `Nova mensagem na Ocorrência #${idOcorrencia}`,
            `${senderName}: ${mensagem}`,
            { id: idOcorrencia.toString(), type: 'ocorrencia_chat' },
          );
        }
      }
    }
  }
}