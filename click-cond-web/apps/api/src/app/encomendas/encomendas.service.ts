import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface CreateEncomendaDto {
  descricao: string;
  destinatario_apto: string;
  destinatario_bloco?: string;
  recebido_de?: string;
  foto_volume?: string;
  id_condominio: number;
}

@Injectable()
export class EncomendasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Contexto rico para auditoria de uma encomenda: descrição, destinatário
   * (apto/bloco), remetente, status e quem retirou (se aplicável).
   *
   * Permite responder no painel: "que pacote era, pra qual apartamento,
   * quem retirou e quando".
   */
  private async carregarContextoEncomenda(idEncomenda: number) {
    const e = await this.prisma.encomendas.findUnique({
      where: { id: idEncomenda },
      include: {
        recebidoPor: { select: { id: true, name: true } },
        entreguePor: { select: { id: true, name: true } },
      },
    });
    if (!e) return null;

    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

    const aptoLabel = e.destinatario_bloco
      ? `Bloco ${e.destinatario_bloco}, Apto ${e.destinatario_apto}`
      : `Apto ${e.destinatario_apto}`;

    return {
      encomenda: {
        id: e.id,
        descricao: e.descricao,
        status: e.status,
        remetente: e.recebido_de,
        temFoto: !!e.foto_volume,
      },
      destinatario: {
        apto: e.destinatario_apto,
        bloco: e.destinatario_bloco,
        label: aptoLabel,
      },
      recebimento: {
        em: fmtDate(e.recebido_em as any),
        por: e.recebidoPor ? { id: e.recebidoPor.id, nome: e.recebidoPor.name } : null,
      },
      retirada: e.retirado_em
        ? {
            em: fmtDate(e.retirado_em as any),
            por: e.retirado_por,
            documento: e.retirado_doc,
            entreguePor: e.entreguePor ? { id: e.entreguePor.id, nome: e.entreguePor.name } : null,
            comAssinatura: !!e.retirado_assinatura,
            comFoto: !!e.retirado_foto,
          }
        : null,
    };
  }

  async findAll(idCondominio: number, status?: string) {
    if (!this.prisma.isConnected) {
      const mocks = [
        {
          id: 401,
          descricao: 'Pacote Mercado Livre - Caixa Média',
          destinatario_apto: '102',
          destinatario_bloco: 'A',
          recebido_de: 'Correios / Sedex',
          recebido_em: new Date(),
          retirado_em: null,
          retirado_por: null,
          status: 'Aguardando',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 402,
          descricao: 'Envelope Documentos - Sedex 10',
          destinatario_apto: '304',
          destinatario_bloco: 'B',
          recebido_de: 'Loggi Transportes',
          recebido_em: new Date(Date.now() - 7200000),
          retirado_em: null,
          retirado_por: null,
          status: 'Aguardando',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(Date.now() - 7200000),
          updated_at: new Date(Date.now() - 7200000),
        },
        {
          id: 403,
          descricao: 'Caixa Amazon Prime - Eletrônicos',
          destinatario_apto: '501',
          destinatario_bloco: 'A',
          recebido_de: 'Amazon Logistics',
          recebido_em: new Date(Date.now() - 86400000),
          retirado_em: new Date(Date.now() - 10000000),
          retirado_por: 'Fernanda Lima (Titular)',
          status: 'Retirada',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(Date.now() - 86400000),
          updated_at: new Date(Date.now() - 10000000),
        },
      ];

      if (status) {
        return mocks.filter((m) => m.status === status);
      }
      return mocks;
    }

    return this.prisma.encomendas.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(status ? { status } : {}),
      },
      orderBy: { recebido_em: 'desc' },
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return {
        id,
        descricao: 'Pacote de Demonstração',
        destinatario_apto: '100',
        destinatario_bloco: 'A',
        recebido_de: 'Correios',
        recebido_em: new Date(),
        retirado_em: null,
        retirado_por: null,
        status: 'Aguardando',
        id_condominio: 1,
      };
    }

    const e = await this.prisma.encomendas.findUnique({ where: { id: Number(id) } });
    if (!e) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    return e;
  }

  async create(dto: CreateEncomendaDto, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        descricao: dto.descricao,
        destinatario_apto: dto.destinatario_apto,
        destinatario_bloco: dto.destinatario_bloco ?? null,
        recebido_de: dto.recebido_de ?? null,
        foto_volume: dto.foto_volume ?? null,
        status: 'Aguardando',
        id_condominio: dto.id_condominio,
        recebido_em: new Date(),
        retirado_em: null,
        retirado_por: null,
        recebido_por_user: null,
        entregue_por_user: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    let fotoUrl: string | null = dto.foto_volume ?? null;
    if (this.storage.isDataUrl(fotoUrl)) {
      fotoUrl = (await this.storage.uploadDataUrl(fotoUrl, 'encomendas')) ?? null;
    }

    const encomenda = await this.prisma.encomendas.create({
      data: {
        descricao: dto.descricao,
        destinatario_apto: dto.destinatario_apto,
        destinatario_bloco: dto.destinatario_bloco ?? null,
        recebido_de: dto.recebido_de ?? null,
        foto_volume: fotoUrl,
        status: 'Aguardando',
        id_condominio: dto.id_condominio,
        notificado: 1,
        notificado_em: new Date(),
      },
    });

    // Notificar moradores do apartamento
    try {
      const moradores = await this.prisma.users.findMany({
        where: {
          moradores: {
            some: {
              id_condominio: dto.id_condominio,
              apartamento: dto.destinatario_apto,
              ...(dto.destinatario_bloco ? { bloco: dto.destinatario_bloco } : {}),
            },
          },
          fcm_token: { not: null },
          notif_encomendas: 1,
        },
        select: { fcm_token: true, name: true },
      });

      for (const morador of moradores) {
        if (morador.fcm_token) {
          await this.notifications.sendPushNotification(
            morador.fcm_token,
            'Nova Encomenda!',
            `Uma encomenda (${dto.descricao}) chegou para o seu apartamento.`,
            { id: encomenda.id.toString(), type: 'encomenda' },
          );
        }
      }
    } catch (error) {
      console.error('Falha ao notificar moradores:', error);
    }

    const ctx = await this.carregarContextoEncomenda(encomenda.id);
    await this.auditoria.registrar({
      id_condominio: encomenda.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'encomendas',
      entidade_id: encomenda.id,
      descricao: `Encomenda registrada para ${ctx?.destinatario.label ?? 'apto'}: "${encomenda.descricao}"`,
      detalhes: ctx ?? undefined,
    });

    return encomenda;
  }

  async retirar(
    id: number,
    retiradoPor: string,
    retiradoDoc?: string,
    retiradoAssinatura?: string,
    retiradoFoto?: string,
    operador?: JwtPayload,
  ) {
    if (!this.prisma.isConnected) {
      return {
        success: true,
        id,
        retirado_por: retiradoPor,
        retirado_doc: retiradoDoc,
        retirado_assinatura: retiradoAssinatura,
        retirado_foto: retiradoFoto,
        status: 'Retirada',
      };
    }

    let assinaturaUrl: string | null = retiradoAssinatura ?? null;
    if (assinaturaUrl && this.storage.isDataUrl(assinaturaUrl)) {
      const uploaded = await this.storage.uploadDataUrl(assinaturaUrl, 'encomendas');
      if (uploaded) {
        assinaturaUrl = uploaded;
      }
    }

    let fotoUrl: string | null = retiradoFoto ?? null;
    if (fotoUrl && this.storage.isDataUrl(fotoUrl)) {
      const uploaded = await this.storage.uploadDataUrl(fotoUrl, 'encomendas');
      if (uploaded) {
        fotoUrl = uploaded;
      }
    }

    try {
      const atualizada = await this.prisma.encomendas.update({
        where: { id: Number(id) },
        data: {
          retirado_em: new Date(),
          retirado_por: retiradoPor,
          retirado_doc: retiradoDoc ?? null,
          retirado_assinatura: assinaturaUrl,
          retirado_foto: fotoUrl,
          status: 'Retirada',
          entregue_por_user: operador?.sub ?? null,
        },
      });

      const ctx = await this.carregarContextoEncomenda(atualizada.id);
      await this.auditoria.registrar({
        id_condominio: atualizada.id_condominio,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'RETIRADA',
        modulo: 'encomendas',
        entidade_id: atualizada.id,
        descricao: `Entregou "${atualizada.descricao}" para ${retiradoPor} (${ctx?.destinatario.label ?? 'apto'})`,
        detalhes: ctx ?? undefined,
      });

      return atualizada;
    } catch {
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }

  async notificar(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { success: true, id, notificado: 1, notificado_em: new Date() };
    }

    try {
      const e = await this.prisma.encomendas.update({
        where: { id: Number(id) },
        data: {
          notificado: 1,
          notificado_em: new Date(),
        },
      });

      try {
        const moradores = await this.prisma.users.findMany({
          where: {
            moradores: {
              some: {
                id_condominio: e.id_condominio,
                apartamento: e.destinatario_apto,
                ...(e.destinatario_bloco ? { bloco: e.destinatario_bloco } : {}),
              },
            },
            fcm_token: { not: null },
            notif_encomendas: 1,
          },
          select: { fcm_token: true },
        });

        for (const morador of moradores) {
          if (morador.fcm_token) {
            await this.notifications.sendPushNotification(
              morador.fcm_token,
              'Aviso de Encomenda Pendente!',
              `Você tem uma encomenda pendente (${e.descricao}) aguardando retirada.`,
              { id: e.id.toString(), type: 'encomenda' },
            );
          }
        }
      } catch (err) {
        console.error('Falha ao reenviar notificação:', err);
      }

      const ctx = await this.carregarContextoEncomenda(e.id);
      await this.auditoria.registrar({
        id_condominio: e.id_condominio,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'STATUS',
        modulo: 'encomendas',
        entidade_id: e.id,
        descricao: `Reenviou notificação de "${e.descricao}" para ${ctx?.destinatario.label ?? 'apto'}`,
        detalhes: ctx ?? undefined,
      });

      return e;
    } catch {
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }

  async remove(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };
    // Carrega contexto + id_condominio ANTES de deletar — depois sumiu.
    const existing = await this.prisma.encomendas.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    const ctx = await this.carregarContextoEncomenda(Number(id));
    try {
      await this.prisma.encomendas.delete({ where: { id: Number(id) } });
      if (existing && ctx) {
        await this.auditoria.registrar({
          id_condominio: existing.id_condominio,
          usuario_nome: operador?.nome ?? 'Portaria',
          acao: 'DELETE',
          modulo: 'encomendas',
          entidade_id: Number(id),
          descricao: `Removeu encomenda "${ctx.encomenda.descricao}" (${ctx.destinatario.label})`,
          detalhes: ctx,
        });
      }
      return { success: true };
    } catch {
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }
}
