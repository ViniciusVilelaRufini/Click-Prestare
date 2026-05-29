import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  listCategorias() {
    return this.prisma.ocorrencias_Categorias.findMany({
      orderBy: { prioridade: 'asc' },
    });
  }

  async findAll(idCondominio: number, status?: string) {
    const list = await this.prisma.ocorrencias.findMany({
      where: {
        id_condominio: idCondominio,
        ...(status ? { status } : {}),
      },
      include: {
        categoria: { select: { nome: true } },
        criadoPor: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return list.map((o) => ({
      id: o.id,
      descricao: o.descricao,
      anexos: o.anexos,
      status: o.status,
      resposta: o.resposta,
      resposta_at: o.resposta_at,
      tipo: o.tipo,
      tipoNome: o.categoria?.nome ?? null,
      criadoPorNome: o.criadoPor?.name ?? 'Morador',
      created_at: o.created_at,
    }));
  }

  async findOne(id: number) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: {
        categoria: { select: { nome: true } },
        criadoPor: { select: { name: true } },
      },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    return { ...o, tipoNome: o.categoria?.nome ?? null, criadoPorNome: o.criadoPor?.name ?? 'Morador' };
  }

  create(dto: CreateOcorrenciaDto) {
    return this.prisma.ocorrencias.create({
      data: {
        descricao: dto.descricao,
        anexos: dto.anexos ?? null,
        tipo: dto.tipo,
        status: 'Pendente',
        id_condominio: dto.id_condominio,
        user: dto.user ?? null,
      },
    });
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

  async remove(id: number) {
    try {
      await this.prisma.ocorrencias.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
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