import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';

export interface CreatePrestadorDto {
  nome: string;
  telefone?: string;
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

  async findAll(idCondominio: number, search?: string) {
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

    return this.prisma.prestadores_servico.findMany({
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
  }

  /**
   * Garante que o prestador pertence ao condomínio da URL. O TenantGuard só
   * valida o :idCondominio do path contra o JWT, mas NÃO impede que o :id
   * do prestador seja de outro condomínio — IDOR. Quando idCondominioUrl é
   * informado, exigimos que o registro carregado seja desse condomínio.
   */
  private assertTenant(condDoRegistro: number, idCondominioUrl?: number, id?: number) {
    if (idCondominioUrl != null && condDoRegistro !== Number(idCondominioUrl)) {
      // 404 (não 403) para não revelar que o id existe em outro condomínio.
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }

  async findOne(id: number, idCondominio?: number) {
    if (!this.prisma.isConnected) {
      return { id, nome: 'Prestador Exemplo', telefone: '(11) 99999-9999', categorias: 'Geral', id_condominio: 1 };
    }

    const p = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
    if (!p) throw new NotFoundException(`Prestador ${id} não encontrado`);
    this.assertTenant(p.id_condominio, idCondominio, id);
    return p;
  }

  async create(dto: CreatePrestadorDto) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        nome: dto.nome,
        telefone: dto.telefone ?? null,
        categorias: dto.categorias ?? null,
        id_condominio: dto.id_condominio,
        foto_pessoa: dto.foto_pessoa ?? null,
        foto_documento: dto.foto_documento ?? null,
        dias_semana: dto.dias_semana ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
    const fotoDoc = await this.resolveFoto(dto.foto_documento);

    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });

    if (existing) {
      const atualizado = await this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: {
          telefone: dto.telefone ?? existing.telefone,
          categorias: dto.categorias ?? existing.categorias,
          id_apartamento: dto.id_apartamento ?? existing.id_apartamento,
          foto_pessoa: fotoPes ?? existing.foto_pessoa,
          foto_documento: fotoDoc ?? existing.foto_documento,
          dias_semana: dto.dias_semana !== undefined ? dto.dias_semana : existing.dias_semana,
        },
      });
      this.fireFacialSync(atualizado.id);
      return atualizado;
    }

    const criado = await this.prisma.prestadores_servico.create({
      data: {
        nome: dto.nome,
        telefone: dto.telefone ?? null,
        categorias: dto.categorias ?? null,
        id_condominio: dto.id_condominio,
        id_apartamento: dto.id_apartamento ?? null,
        foto_pessoa: fotoPes,
        foto_documento: fotoDoc,
        dias_semana: dto.dias_semana ?? null,
      },
    });
    this.fireFacialSync(criado.id);
    return criado;
  }

  async update(id: number, dto: Partial<CreatePrestadorDto>, idCondominio?: number) {
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    // Carrega e valida tenant antes de qualquer escrita (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    this.assertTenant(atual.id_condominio, idCondominio, id);

    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    try {
      const atualizado = await this.prisma.prestadores_servico.update({
        where: { id: Number(id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.categorias !== undefined && { categorias: dto.categorias }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: dto.id_apartamento }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(dto.dias_semana !== undefined && { dias_semana: dto.dias_semana }),
        },
      });
      this.fireFacialSync(atualizado.id);
      return atualizado;
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }

  async clearFoto(id: number, campo: 'pessoa' | 'documento', idCondominio?: number) {
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    this.assertTenant(atual.id_condominio, idCondominio, id);
    return this.prisma.prestadores_servico.update({
      where: { id: Number(id) },
      data: campo === 'pessoa' ? { foto_pessoa: null } : { foto_documento: null },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
  }

  async remove(id: number, idCondominio?: number) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida tenant antes de deletar (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, face_id: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    this.assertTenant(atual.id_condominio, idCondominio, id);

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

    try {
      await this.prisma.prestadores_servico.delete({ where: { id: Number(id) } });
      return { success: true };
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }
}