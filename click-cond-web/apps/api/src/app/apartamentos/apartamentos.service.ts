import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateApartamentoDto {
  bloco?: string;
  apto: string;
  fracao?: string;
  id_condominio: number;
}

@Injectable()
export class ApartamentosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(idCondominio: number, search?: string) {
    if (!this.prisma.isConnected) {
      const mocks = [
        { id: 1, bloco: 'A', apto: '101', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 3 },
        { id: 2, bloco: 'A', apto: '102', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 2 },
        { id: 3, bloco: 'A', apto: '201', fracao: '0.0125', id_condominio: Number(idCondominio), qtdMoradores: 4 },
        { id: 4, bloco: 'B', apto: '101', fracao: '0.0150', id_condominio: Number(idCondominio), qtdMoradores: 1 },
        { id: 5, bloco: 'B', apto: '102', fracao: '0.0150', id_condominio: Number(idCondominio), qtdMoradores: 5 },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter((a) => a.apto.includes(s) || a.bloco.toLowerCase().includes(s));
      }
      return mocks;
    }

    const list = await this.prisma.apartamentos.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { apto: { contains: search } },
                { bloco: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { users: true } },
      },
    });

    list.sort((a, b) => {
      if (a.bloco === b.bloco) {
        return (a.apto ?? '').localeCompare(b.apto ?? '', 'pt', { numeric: true });
      }
      return (a.bloco ?? '').localeCompare(b.bloco ?? '');
    });

    return list.map((a) => ({
      id: a.id,
      bloco: a.bloco,
      apto: a.apto,
      fracao: a.fracao,
      id_condominio: a.id_condominio,
      qtdMoradores: a._count.users,
    }));
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return { id, bloco: 'A', apto: '101', fracao: null, id_condominio: 1, qtdMoradores: 2 };
    }

    const a = await this.prisma.apartamentos.findUnique({ where: { id: Number(id) } });
    if (!a) throw new NotFoundException(`Apartamento ${id} não encontrado`);
    return a;
  }

  async create(dto: CreateApartamentoDto) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        bloco: dto.bloco ?? null,
        apto: dto.apto,
        fracao: dto.fracao ?? null,
        id_condominio: dto.id_condominio,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    return this.prisma.apartamentos.create({
      data: {
        bloco: dto.bloco ?? null,
        apto: dto.apto,
        fracao: dto.fracao ?? null,
        id_condominio: dto.id_condominio,
      },
    });
  }

  async update(id: number, dto: Partial<CreateApartamentoDto>) {
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    try {
      return await this.prisma.apartamentos.update({
        where: { id: Number(id) },
        data: {
          ...(dto.bloco !== undefined && { bloco: dto.bloco }),
          ...(dto.apto !== undefined && { apto: dto.apto }),
          ...(dto.fracao !== undefined && { fracao: dto.fracao }),
        },
      });
    } catch {
      throw new NotFoundException(`Apartamento ${id} não encontrado`);
    }
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    try {
      await this.prisma.apartamentos.delete({ where: { id: Number(id) } });
      return { success: true };
    } catch {
      throw new NotFoundException(`Apartamento ${id} não encontrado`);
    }
  }

  async importBulk(idCondominio: number, linhas: any[]) {
    const criados = [];
    for (const item of linhas) {
      const apto = item.apto?.toString() || item.lote?.toString();
      if (!apto) continue;
      const bloco = item.bloco?.toString() || item.quadra?.toString() || null;
      const fracao = item.fracao?.toString() || null;

      try {
        if (this.prisma.isConnected) {
          const existing = await this.prisma.apartamentos.findFirst({
            where: {
              id_condominio: Number(idCondominio),
              apto,
              bloco,
            },
          });
          if (existing) continue;

          const novo = await this.prisma.apartamentos.create({
            data: {
              bloco,
              apto,
              fracao,
              id_condominio: Number(idCondominio),
            },
          });
          criados.push(novo);
        } else {
          criados.push({
            id: Date.now() + Math.random(),
            bloco,
            apto,
            fracao,
            id_condominio: Number(idCondominio),
          });
        }
      } catch (err: any) {
        console.log('Erro ao importar apartamento:', apto, err?.message);
      }
    }
    return { ok: true, total: criados.length, criados };
  }
}