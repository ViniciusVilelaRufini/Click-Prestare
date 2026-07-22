import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import * as bcrypt from 'bcrypt';

export interface CreatePrestadorDto {
  nome: string;
  telefone?: string;
  email?: string | null;
  senha?: string | null;
  hasPortariaAccess?: boolean;
  categorias?: string;
  id_condominio: number;
  id_apartamento?: number;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  dias_semana?: string;
}

@Injectable()
export class PrestadoresService {
  private readonly logger = new Logger(PrestadoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly tenant: TenantAccessService,
  ) {}

  /** Empurra (ou remove) o rosto do prestador nos terminais faciais, sem bloquear a resposta. */
  private fireFacialSync(idPrestador: number) {
    this.facial
      .syncPrestadorServico(idPrestador)
      .catch((err) =>
        this.logger.warn(
          `Sync facial prestador ${idPrestador} falhou: ${err?.message ?? err}`,
        ),
      );
  }

  private async resolveFoto(value: string | undefined | null): Promise<string | null> {
    if (!value) return value ?? null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'prestadores')) ?? null;
    }
    return value;
  }

  async findAll(idCondominio: number, search?: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      const mocks = [
        { id: 601, nome: 'Eletricista 24h - João da Silva', telefone: '(11) 95555-4444', categorias: 'Elétrica, Instalações', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
        { id: 602, nome: 'Desentupidora e Encanador Rápido', telefone: '(11) 94444-3333', categorias: 'Hidráulica, Esgoto', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
        { id: 603, nome: 'Refrigeração Ar Condicionado (Marcos)', telefone: '(11) 93333-2222', categorias: 'Climatização, Limpeza', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter((p) => p.nome.toLowerCase().includes(s) || (p.categorias && p.categorias.toLowerCase().includes(s)));
      }
      return mocks;
    }

    const prestadores = await this.prisma.prestadores_servico.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { telefone: { contains: search } },
                { categorias: { contains: search } },
              ],
            }
          : {}),
      },
      include: { apartamento: { select: { bloco: true, apto: true } } },
      orderBy: { nome: 'asc' },
    });

    const portariaLogins = await this.prisma.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCondominio), ativo: 1 },
      select: { login: true },
    });
    const loginSet = new Set(portariaLogins.map((f) => f.login.toLowerCase().trim()));

    return prestadores.map((p) => ({
      ...p,
      hasPortariaAccess: p.email ? loginSet.has(p.email.toLowerCase().trim()) : false,
    }));
  }

  async findOne(id: number, idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { id, nome: 'Prestador Exemplo', telefone: '(11) 99999-9999', categorias: 'Geral', id_condominio: 1, hasPortariaAccess: false };
    }

    const p = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
    if (!p) throw new NotFoundException(`Prestador ${id} não encontrado`);
    // TenantAccessService cobre tanto o caso web (idCondominio da URL, no
    // JWT) quanto o mobile (token sem id_condominio, resolve via banco) —
    // sem isso, o app conseguia ler/editar/apagar prestador de outro condomínio.
    await this.tenant.assertEntidade(p.id_condominio, user, `prestador #${id}`);

    const hasPortariaAccess = p.email
      ? await this.prisma.funcionarios_Portaria.findFirst({
          where: { login: p.email, id_condominio: p.id_condominio, ativo: 1 },
          select: { id: true },
        }).then((res) => !!res)
      : false;

    return { ...p, hasPortariaAccess };
  }

  async create(dto: CreatePrestadorDto, user?: JwtPayload) {
    await this.tenant.assertCondominio(dto.id_condominio, user);
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        nome: dto.nome,
        telefone: dto.telefone ?? null,
        email: dto.email ?? null,
        categorias: dto.categorias ?? null,
        id_condominio: dto.id_condominio,
        foto_pessoa: dto.foto_pessoa ?? null,
        foto_documento: dto.foto_documento ?? null,
        dias_semana: dto.dias_semana ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    if (dto.email && dto.hasPortariaAccess) {
      const conflito = await this.prisma.funcionarios_Portaria.findFirst({
        where: { login: dto.email.trim() },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe um funcionário com este e-mail.');
      }
    }

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
    const fotoDoc = await this.resolveFoto(dto.foto_documento);

    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });

    let criado;
    if (existing) {
      criado = await this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: {
          telefone: dto.telefone ?? existing.telefone,
          email: dto.email !== undefined ? (dto.email ? dto.email.trim() : null) : existing.email,
          categorias: dto.categorias ?? existing.categorias,
          id_apartamento: dto.id_apartamento ?? existing.id_apartamento,
          foto_pessoa: fotoPes ?? existing.foto_pessoa,
          foto_documento: fotoDoc ?? existing.foto_documento,
          dias_semana: dto.dias_semana !== undefined ? dto.dias_semana : existing.dias_semana,
        },
      });
    } else {
      criado = await this.prisma.prestadores_servico.create({
        data: {
          nome: dto.nome,
          telefone: dto.telefone ?? null,
          email: dto.email ? dto.email.trim() : null,
          categorias: dto.categorias ?? null,
          id_condominio: dto.id_condominio,
          id_apartamento: dto.id_apartamento ?? null,
          foto_pessoa: fotoPes,
          foto_documento: fotoDoc,
          dias_semana: dto.dias_semana ?? null,
        },
      });
    }

    if (dto.hasPortariaAccess && dto.email) {
      const senhaInicial = dto.senha || '123456';
      const hash = await bcrypt.hash(senhaInicial, 12);
      await this.prisma.funcionarios_Portaria.create({
        data: {
          nome: dto.nome,
          login: dto.email.trim(),
          password: hash,
          email: dto.email.trim(),
          telefone: dto.telefone ?? null,
          turno: 'Geral',
          ativo: 1,
          id_condominio: dto.id_condominio,
        },
      });
    }

    this.fireFacialSync(criado.id);
    return criado;
  }

  async update(id: number, dto: Partial<CreatePrestadorDto>, idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    // Carrega e valida tenant antes de qualquer escrita (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, email: true, nome: true, telefone: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);

    if (dto.email && dto.hasPortariaAccess) {
      const conflito = await this.prisma.funcionarios_Portaria.findFirst({
        where: { login: dto.email.trim(), NOT: { login: atual.email || '' } },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe outro funcionário com este e-mail.');
      }
    }

    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    try {
      const atualizado = await this.prisma.prestadores_servico.update({
        where: { id: Number(id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.email !== undefined && { email: dto.email ? dto.email.trim() : null }),
          ...(dto.categorias !== undefined && { categorias: dto.categorias }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: dto.id_apartamento }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(dto.dias_semana !== undefined && { dias_semana: dto.dias_semana }),
        },
      });

      const emailParaLogin = dto.email ? dto.email.trim() : (atualizado.email ?? '');

      if (dto.hasPortariaAccess && emailParaLogin) {
        const loginsParaBuscar = [atual.email, emailParaLogin].filter(Boolean) as string[];
        const atualPortaria = await this.prisma.funcionarios_Portaria.findFirst({
          where: { login: { in: loginsParaBuscar }, id_condominio: atualizado.id_condominio },
        });

        const hash = dto.senha ? await bcrypt.hash(dto.senha, 12) : undefined;

        if (atualPortaria) {
          await this.prisma.funcionarios_Portaria.update({
            where: { id: atualPortaria.id },
            data: {
              nome: dto.nome ?? atualPortaria.nome,
              login: emailParaLogin,
              email: emailParaLogin,
              telefone: dto.telefone ?? atualPortaria.telefone,
              ativo: 1,
              ...(hash && { password: hash }),
            },
          });
        } else {
          const senhaInicial = dto.senha || '123456';
          const newHash = await bcrypt.hash(senhaInicial, 12);
          await this.prisma.funcionarios_Portaria.create({
            data: {
              nome: dto.nome ?? atualizado.nome,
              login: emailParaLogin,
              password: newHash,
              email: emailParaLogin,
              telefone: dto.telefone ?? atualizado.telefone ?? null,
              turno: 'Geral',
              ativo: 1,
              id_condominio: atualizado.id_condominio,
            },
          });
        }
      } else {
        if (dto.hasPortariaAccess === false || (dto.email === null && atual.email)) {
          const emailParaRemover = atual.email || emailParaLogin;
          if (emailParaRemover) {
            await this.prisma.funcionarios_Portaria.deleteMany({
              where: { login: emailParaRemover, id_condominio: atual.id_condominio },
            });
          }
        }
      }

      this.fireFacialSync(atualizado.id);
      return atualizado;
    } catch (e) {
      throw e instanceof BadRequestException ? e : new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }

  async clearFoto(id: number, campo: 'pessoa' | 'documento', idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);
    return this.prisma.prestadores_servico.update({
      where: { id: Number(id) },
      data: campo === 'pessoa' ? { foto_pessoa: null } : { foto_documento: null },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
  }

  async remove(id: number, idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida tenant antes de deletar (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, face_id: true, email: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);

    // Remove o rosto dos terminais faciais antes de apagar o cadastro, senão
    // ficaria um rosto órfão abrindo a porta sem dono no banco.
    if (atual.face_id) {
      await this.facial
        .unsyncPrestadorServico(Number(id), atual.face_id, atual.id_condominio)
        .catch((err) =>
          this.logger.warn(
            `Unsync facial prestador ${id} falhou: ${err?.message ?? err}`,
          ),
        );
    }

    if (atual.email) {
      await this.prisma.funcionarios_Portaria.deleteMany({
        where: { login: atual.email, id_condominio: atual.id_condominio },
      }).catch((err) =>
        this.logger.warn(`Falha ao remover acesso portaria do prestador ${id}: ${err.message}`),
      );
    }

    try {
      await this.prisma.prestadores_servico.delete({ where: { id: Number(id) } });
      return { success: true };
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }
}