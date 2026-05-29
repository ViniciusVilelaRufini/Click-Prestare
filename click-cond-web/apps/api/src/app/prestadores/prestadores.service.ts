import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

export interface CreatePrestadorDto {
  nome: string;
  telefone?: string;
  categorias?: string;
  id_condominio: number;
  foto_pessoa?: string;
  foto_documento?: string;
}

@Injectable()
export class PrestadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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
      orderBy: { nome: 'asc' },
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return { id, nome: 'Prestador Exemplo', telefone: '(11) 99999-9999', categorias: 'Geral', id_condominio: 1 };
    }

    const p = await this.prisma.prestadores_servico.findUnique({ where: { id: Number(id) } });
    if (!p) throw new NotFoundException(`Prestador ${id} não encontrado`);
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
      return this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: {
          telefone: dto.telefone ?? existing.telefone,
          categorias: dto.categorias ?? existing.categorias,
          foto_pessoa: fotoPes ?? existing.foto_pessoa,
          foto_documento: fotoDoc ?? existing.foto_documento,
        },
      });
    }

    return this.prisma.prestadores_servico.create({
      data: {
        nome: dto.nome,
        telefone: dto.telefone ?? null,
        categorias: dto.categorias ?? null,
        id_condominio: dto.id_condominio,
        foto_pessoa: fotoPes,
        foto_documento: fotoDoc,
      },
    });
  }

  async update(id: number, dto: Partial<CreatePrestadorDto>) {
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    try {
      return await this.prisma.prestadores_servico.update({
        where: { id: Number(id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.categorias !== undefined && { categorias: dto.categorias }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
        },
      });
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    try {
      await this.prisma.prestadores_servico.delete({ where: { id: Number(id) } });
      return { success: true };
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }
}