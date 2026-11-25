import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import { avisarMoradoresDoCondominio } from './avisar-moradores.util';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';

/** Texto sem espaços nas pontas; vazio/só espaços → 400 com a mensagem dada. */
function textoObrigatorio(valor: unknown, mensagem: string): string {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new BadRequestException(mensagem);
  return texto;
}

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
  private async notificarMoradores(idCondominio: number, titulo: string, id: number, idAutor: number | null) {
    await avisarMoradoresDoCondominio(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      idCondominio,
      {
        titulo: 'Novo comunicado',
        corpo: titulo,
        data: { type: 'comunicado', id: String(id) },
        // O síndico que publica e mora no condomínio não recebe o próprio aviso.
        excluirUserId: idAutor,
      },
    );
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

  /**
   * O que o console pode oferecer a quem está logado — a mesma regra das rotas
   * de escrita (assertStaff + flag `comunicados` do funcionário do app), para a
   * tela não mostrar Novo/Editar/Excluir que vão dar 403. Porteiro de
   * login/senha: só leitura.
   */
  async acesso(idCondominio: number, user?: JwtPayload): Promise<{ gerenciar: boolean }> {
    await this.tenant.assertCondominio(idCondominio, user);
    try {
      assertStaff(user, 'gerenciar comunicados');
      await this.tenant.assertPermissaoFuncionario(idCondominio, 'comunicados', user);
      return { gerenciar: true };
    } catch (e) {
      if (e instanceof ForbiddenException) return { gerenciar: false };
      throw e;
    }
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
    // Sem título nada é gravado nem notificado (antes um Salvar vazio
    // empurrava "Novo comunicado" em branco para todos os moradores).
    const titulo = textoObrigatorio(dto.titulo, 'Informe o título do comunicado.');
    // Descrição é opcional (a portaria-web manda '' quando vazia): grava null.
    const descricao = String(dto.descricao ?? '').trim() || null;
    const criado = await this.prisma.comunicados.create({
      data: {
        titulo,
        descricao,
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
    void this.notificarMoradores(dto.id_condominio, criado.titulo, criado.id, idUsuarioDoToken(operador));
    return criado;
  }

  async update(id: number, dto: Partial<CreateComunicadoDto>, operador?: JwtPayload) {
    assertStaff(operador, 'editar comunicado');
    const antes = await this.prisma.comunicados.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException(`Comunicado ${id} não encontrado`);
    await this.tenant.assertEntidade(antes.id_condominio, operador, `comunicado #${id}`);
    await this.tenant.assertPermissaoFuncionario(antes.id_condominio, 'comunicados', operador);
    // Só valida o que veio no corpo; o que veio é gravado já sem as pontas.
    const titulo =
      dto.titulo !== undefined ? textoObrigatorio(dto.titulo, 'Informe o título do comunicado.') : undefined;
    const descricao =
      dto.descricao !== undefined
        ? String(dto.descricao ?? '').trim() || null
        : undefined;

    try {
      const atualizado = await this.prisma.comunicados.update({
        where: { id },
        data: {
          ...(titulo !== undefined && { titulo }),
          ...(descricao !== undefined && { descricao }),
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
