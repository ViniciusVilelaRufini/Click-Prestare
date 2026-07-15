import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateApartamentoDto {
  bloco?: string;
  apto: string;
  fracao?: string;
  qtd_vagas?: number;
  id_condominio: number;
}

@Injectable()
export class ApartamentosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rejeita unidades inválidas/fantasma no cadastro. "Apto 000 Bloco
   * Condominio" já entrou uma vez no banco e recebeu cobrança do job de
   * recorrência, poluindo a inadimplência — esta validação impede repetir.
   */
  private assertAptoValido(apto?: string | null, bloco?: string | null) {
    const aptoNorm = (apto ?? '').trim();
    const blocoNorm = (bloco ?? '').trim().toLowerCase();
    if (!aptoNorm) {
      throw new BadRequestException('Informe o número do apartamento.');
    }
    if (/^0+$/.test(aptoNorm)) {
      throw new BadRequestException(`"${aptoNorm}" não é um número de apartamento válido.`);
    }
    if (blocoNorm === 'condominio' || blocoNorm === 'condomínio') {
      throw new BadRequestException('"Condomínio" não pode ser usado como nome de bloco — informe o bloco real da unidade.');
    }
  }

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
        users: { select: { id_user: true } },
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
      qtd_vagas: a.qtd_vagas ?? 0,
      id_condominio: a.id_condominio,
      // Contagem canônica = usuários distintos vinculados (Apartamentos_Users), igual ao modal/app.
      qtdMoradores: new Set(a.users.map((u) => u.id_user)).size,
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
    this.assertAptoValido(dto.apto, dto.bloco);
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
        qtd_vagas: Number(dto.qtd_vagas) || 0,
        id_condominio: dto.id_condominio,
      },
    });
  }

  async update(id: number, dto: Partial<CreateApartamentoDto>) {
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    // Valida o estado FINAL da unidade (campo enviado ou valor atual) —
    // impede transformar uma unidade válida em fantasma via update parcial.
    if (dto.apto !== undefined || dto.bloco !== undefined) {
      const atual = await this.prisma.apartamentos.findUnique({
        where: { id: Number(id) },
        select: { apto: true, bloco: true },
      });
      if (!atual) throw new NotFoundException(`Apartamento ${id} não encontrado`);
      this.assertAptoValido(dto.apto ?? atual.apto, dto.bloco ?? atual.bloco);
    }

    try {
      return await this.prisma.apartamentos.update({
        where: { id: Number(id) },
        data: {
          ...(dto.bloco !== undefined && { bloco: dto.bloco }),
          ...(dto.apto !== undefined && { apto: dto.apto }),
          ...(dto.fracao !== undefined && { fracao: dto.fracao }),
          ...(dto.qtd_vagas !== undefined && { qtd_vagas: Number(dto.qtd_vagas) || 0 }),
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
    const ignorados: { apto: string; bloco: string | null; motivo: string }[] = [];
    for (const item of linhas) {
      const apto = item.apto?.toString() || item.lote?.toString();
      if (!apto) continue;
      const bloco = item.bloco?.toString() || item.quadra?.toString() || null;
      const fracao = item.fracao?.toString() || null;

      // Import em massa não aborta por uma linha inválida — pula e reporta.
      try {
        this.assertAptoValido(apto, bloco);
      } catch (err: any) {
        ignorados.push({ apto, bloco, motivo: err?.message ?? 'Unidade inválida' });
        continue;
      }

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
    return { ok: true, total: criados.length, criados, ignorados };
  }
}