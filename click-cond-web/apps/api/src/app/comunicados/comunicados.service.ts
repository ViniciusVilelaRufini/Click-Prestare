import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';

export interface CreateComunicadoDto {
  titulo: string;
  descricao?: string;
  id_condominio: number;
}

@Injectable()
export class ComunicadosService {
  private readonly logger = new Logger(ComunicadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tenant: TenantAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Push "Novo comunicado" para os moradores do condomínio que deixaram a
   * preferência ligada. Fire-and-forget: falha no FCM não desfaz a publicação.
   */
  private async notificarMoradores(idCondominio: number, titulo: string, id: number) {
    try {
      const users = await this.prisma.users.findMany({
        where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: idCondominio } } },
        select: { fcm_token: true },
      });
      for (const u of users) {
        await this.notifications.sendPushNotification(u.fcm_token!, 'Novo comunicado', titulo, {
          type: 'comunicado',
          id: String(id),
        });
      }
    } catch (e: any) {
      this.logger.error(`[comunicados.push] ${e?.message ?? e}`);
    }
  }

  /**
   * Contexto rico de comunicado: título, autor, data, tamanho da descrição.
   * Responde no painel: "que comunicado foi publicado, por quem, para qual
   * condomínio, com que conteúdo".
   */
  private async carregarContextoComunicado(idComunicado: number) {
    const c = await this.prisma.comunicados.findUnique({
      where: { id: idComunicado },
      include: { criadoPor: { select: { id: true, name: true, email: true } } },
    });
    if (!c) return null;

    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null;

    return {
      comunicado: {
        id: c.id,
        titulo: c.titulo,
        descricao: c.descricao,
        tamanhoConteudo: c.descricao?.length ?? 0,
      },
      autor: c.criadoPor
        ? { id: c.criadoPor.id, nome: c.criadoPor.name, email: c.criadoPor.email }
        : null,
      publicado: {
        em: fmtDate(c.created_at as any),
        atualizadoEm: fmtDate(c.updated_at as any),
      },
    };
  }

  async findAll(idCondominio: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    return this.prisma.comunicados.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number, user?: JwtPayload) {
    const c = await this.prisma.comunicados.findUnique({ where: { id } });
    if (!c) throw new NotFoundException(`Comunicado ${id} não encontrado`);
    await this.tenant.assertEntidade(c.id_condominio, user, `comunicado #${id}`);
    return c;
  }

  async create(dto: CreateComunicadoDto, operador?: JwtPayload) {
    assertStaff(operador, 'publicar comunicado');
    await this.tenant.assertCondominio(dto.id_condominio, operador);
    // assertStaff so garante "nao e morador": publicar comunicado e comunicacao
    // oficial do condominio, e a flag existe para o sindico controlar isso.
    await this.tenant.assertPermissaoFuncionario(dto.id_condominio, 'comunicados', operador);
    const criado = await this.prisma.comunicados.create({
      data: {
        titulo: dto.titulo,
        descricao: dto.descricao ?? null,
        id_condominio: dto.id_condominio,
        user: operador?.sub ?? null,
      },
    });
    const ctx = await this.carregarContextoComunicado(criado.id);
    await this.auditoria.registrar({
      id_condominio: dto.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'comunicados',
      entidade_id: criado.id,
      descricao: `Publicou comunicado "${criado.titulo}"`,
      detalhes: ctx ?? undefined,
    });
    void this.notificarMoradores(dto.id_condominio, criado.titulo, criado.id);
    return criado;
  }

  async update(id: number, dto: Partial<CreateComunicadoDto>, operador?: JwtPayload) {
    assertStaff(operador, 'editar comunicado');
    const antes = await this.prisma.comunicados.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException(`Comunicado ${id} não encontrado`);
    await this.tenant.assertEntidade(antes.id_condominio, operador, `comunicado #${id}`);
    await this.tenant.assertPermissaoFuncionario(antes.id_condominio, 'comunicados', operador);

    try {
      const atualizado = await this.prisma.comunicados.update({
        where: { id },
        data: {
          ...(dto.titulo !== undefined && { titulo: dto.titulo }),
          ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        },
      });

      // Diff: registra titulo e tamanho do conteúdo (não o conteúdo inteiro
      // pra não inflar o log com megabytes de HTML).
      const changes: Record<string, any> = {};
      if (dto.titulo !== undefined && antes.titulo !== atualizado.titulo) {
        changes['titulo'] = { de: antes.titulo, para: atualizado.titulo };
      }
      if (dto.descricao !== undefined && antes.descricao !== atualizado.descricao) {
        changes['descricao_tamanho'] = {
          de: antes.descricao?.length ?? 0,
          para: atualizado.descricao?.length ?? 0,
        };
      }

      const ctx = await this.carregarContextoComunicado(atualizado.id);
      await this.auditoria.registrar({
        id_condominio: atualizado.id_condominio,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'UPDATE',
        modulo: 'comunicados',
        entidade_id: atualizado.id,
        descricao: `Editou comunicado "${atualizado.titulo}"`,
        detalhes: { contexto: ctx, changes },
      });

      return atualizado;
    } catch {
      throw new NotFoundException(`Comunicado ${id} não encontrado`);
    }
  }

  async remove(id: number, operador?: JwtPayload) {
    assertStaff(operador, 'remover comunicado');
    const ctx = await this.carregarContextoComunicado(id);
    const existing = await this.prisma.comunicados.findUnique({
      where: { id },
      select: { id_condominio: true, titulo: true },
    });
    if (!existing) throw new NotFoundException(`Comunicado ${id} não encontrado`);
    await this.tenant.assertEntidade(existing.id_condominio, operador, `comunicado #${id}`);
    await this.tenant.assertPermissaoFuncionario(existing.id_condominio, 'comunicados', operador);
    try {
      await this.prisma.comunicados.delete({ where: { id } });
      if (existing) {
        await this.auditoria.registrar({
          id_condominio: existing.id_condominio,
          usuario_nome: operador?.nome ?? 'Portaria',
          acao: 'DELETE',
          modulo: 'comunicados',
          entidade_id: id,
          descricao: `Removeu comunicado "${existing.titulo}"`,
          detalhes: ctx ?? undefined,
        });
      }
    } catch {
      throw new NotFoundException(`Comunicado ${id} não encontrado`);
    }
  }
}
