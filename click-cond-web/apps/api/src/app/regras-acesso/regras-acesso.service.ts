import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRegraAcessoDto {
  nome: string;
  descricao?: string;
  permitir_morador: number;
  permitir_visitante: number;
  permitir_prestador: number;
  permitir_funcionario: number;
  sentido?: string;
  hora_inicio?: string;
  hora_fim?: string;
  ativo: number;
  dispositivosIds: number[]; // Array de IDs de dispositivos vinculados
}

@Injectable()
export class RegrasAcessoService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(idCondominio: number) {
    if (!this.prisma.isConnected) {
      return [
        {
          id: 1,
          id_condominio: idCondominio,
          nome: 'Regra Padrão - Acesso Social',
          descricao: 'Permite moradores e visitantes nos dispositivos sociais',
          permitir_morador: 1,
          permitir_visitante: 1,
          permitir_prestador: 0,
          permitir_funcionario: 1,
          sentido: 'ambos',
          hora_inicio: null,
          hora_fim: null,
          ativo: 1,
          dispositivos: [{ id_dispositivo: 1 }],
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
    }

    return this.prisma.regras_Acesso.findMany({
      where: { id_condominio: Number(idCondominio) },
      include: {
        dispositivos: {
          select: {
            id_dispositivo: true,
            dispositivo: {
              select: {
                id: true,
                nome: true,
                tipo: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return {
        id,
        id_condominio: 1,
        nome: 'Regra Padrão - Acesso Social',
        descricao: 'Permite moradores e visitantes nos dispositivos sociais',
        permitir_morador: 1,
        permitir_visitante: 1,
        permitir_prestador: 0,
        permitir_funcionario: 1,
        sentido: 'ambos',
        hora_inicio: null,
        hora_fim: null,
        ativo: 1,
        dispositivos: [{ id_dispositivo: 1 }],
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    const regra = await this.prisma.regras_Acesso.findUnique({
      where: { id: Number(id) },
      include: {
        dispositivos: {
          select: {
            id_dispositivo: true,
            dispositivo: {
              select: {
                id: true,
                nome: true,
                tipo: true,
              },
            },
          },
        },
      },
    });

    if (!regra) {
      throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    }

    return regra;
  }

  async create(idCondominio: number, dto: CreateRegraAcessoDto) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        id_condominio: idCondominio,
        ...dto,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    // Criar a regra e os vínculos N:N com os dispositivos em uma única transação
    return this.prisma.regras_Acesso.create({
      data: {
        id_condominio: Number(idCondominio),
        nome: dto.nome,
        descricao: dto.descricao ?? null,
        permitir_morador: Number(dto.permitir_morador) || 0,
        permitir_visitante: Number(dto.permitir_visitante) || 0,
        permitir_prestador: Number(dto.permitir_prestador) || 0,
        permitir_funcionario: Number(dto.permitir_funcionario) || 0,
        sentido: dto.sentido ?? 'ambos',
        hora_inicio: dto.hora_inicio || null,
        hora_fim: dto.hora_fim || null,
        ativo: Number(dto.ativo) !== undefined ? Number(dto.ativo) : 1,
        dispositivos: {
          create: (dto.dispositivosIds || []).map((dispId) => ({
            id_dispositivo: Number(dispId),
          })),
        },
      },
      include: {
        dispositivos: true,
      },
    });
  }

  async update(id: number, dto: Partial<CreateRegraAcessoDto>) {
    if (!this.prisma.isConnected) {
      return { id, ...dto };
    }

    const regraExistente = await this.prisma.regras_Acesso.findUnique({
      where: { id: Number(id) },
    });

    if (!regraExistente) {
      throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    }

    // Se novos dispositivosIds foram passados, removemos os antigos e inserimos os novos
    if (dto.dispositivosIds !== undefined) {
      await this.prisma.regras_Dispositivos.deleteMany({
        where: { id_regra: Number(id) },
      });
    }

    return this.prisma.regras_Acesso.update({
      where: { id: Number(id) },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        ...(dto.permitir_morador !== undefined && { permitir_morador: Number(dto.permitir_morador) }),
        ...(dto.permitir_visitante !== undefined && { permitir_visitante: Number(dto.permitir_visitante) }),
        ...(dto.permitir_prestador !== undefined && { permitir_prestador: Number(dto.permitir_prestador) }),
        ...(dto.permitir_funcionario !== undefined && { permitir_funcionario: Number(dto.permitir_funcionario) }),
        ...(dto.sentido !== undefined && { sentido: dto.sentido }),
        ...(dto.hora_inicio !== undefined && { hora_inicio: dto.hora_inicio || null }),
        ...(dto.hora_fim !== undefined && { hora_fim: dto.hora_fim || null }),
        ...(dto.ativo !== undefined && { ativo: Number(dto.ativo) }),
        ...(dto.dispositivosIds !== undefined && {
          dispositivos: {
            create: dto.dispositivosIds.map((dispId) => ({
              id_dispositivo: Number(dispId),
            })),
          },
        }),
      },
      include: {
        dispositivos: true,
      },
    });
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) {
      return { success: true };
    }

    try {
      // Devido ao onDelete: Cascade no Schema, deletar a regra já limpa a tabela intermediária
      await this.prisma.regras_Acesso.delete({
        where: { id: Number(id) },
      });
      return { success: true };
    } catch {
      throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    }
  }
}
