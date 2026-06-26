import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { FacialService } from '../facial/facial.service';

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
  private readonly logger = new Logger(RegrasAcessoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly facial: FacialService,
  ) {}

  /**
   * Reaplica fisicamente as regras: re-sincroniza os rostos do condomínio
   * (cadastra quem a categoria permite, REMOVE quem não permite do aparelho).
   * Roda em background — mudar a regra não fica esperando o hardware. Sem isso,
   * a regra só valeria como auditoria (a porta abriria mesmo "negado").
   */
  private reaplicarRegras(idCondominio: number) {
    this.facial
      .syncAllForCondominio(idCondominio, { onlyPending: false })
      .catch((err) =>
        this.logger.warn(
          `Re-sync facial após mudança de regra (condomínio ${idCondominio}) falhou: ${err?.message ?? err}`,
        ),
      );
  }

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

  async findOne(id: number, idCondominio?: number) {
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

    if (idCondominio !== undefined && regra.id_condominio !== idCondominio) {
      throw new ForbiddenException(`Regra #${id} não pertence a este condomínio`);
    }

    return regra;
  }

  async create(idCondominio: number, dto: CreateRegraAcessoDto, operador?: JwtPayload) {
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
    const criada = await this.prisma.regras_Acesso.create({
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

    await this.auditoria.registrar({
      id_condominio: Number(idCondominio),
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'RULE_CHANGE',
      modulo: 'regras-acesso',
      entidade_id: criada.id,
      descricao: `Criou regra "${criada.nome}"`,
      detalhes: {
        sentido: criada.sentido,
        horario: { inicio: criada.hora_inicio, fim: criada.hora_fim },
        permite: {
          morador: criada.permitir_morador === 1,
          visitante: criada.permitir_visitante === 1,
          prestador: criada.permitir_prestador === 1,
          funcionario: criada.permitir_funcionario === 1,
        },
        ativo: criada.ativo === 1,
      },
    });
    this.reaplicarRegras(Number(idCondominio));
    return criada;
  }

  async update(id: number, dto: Partial<CreateRegraAcessoDto>, idCondominio?: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { id, ...dto };
    }

    const regraExistente = await this.prisma.regras_Acesso.findUnique({
      where: { id: Number(id) },
    });

    if (!regraExistente) {
      throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    }

    if (idCondominio !== undefined && regraExistente.id_condominio !== idCondominio) {
      throw new ForbiddenException(`Regra #${id} não pertence a este condomínio`);
    }

    // Se novos dispositivosIds foram passados, removemos os antigos e inserimos os novos
    if (dto.dispositivosIds !== undefined) {
      await this.prisma.regras_Dispositivos.deleteMany({
        where: { id_regra: Number(id) },
      });
    }

    const atualizada = await this.prisma.regras_Acesso.update({
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

    // Diff dos campos sensíveis para o log.
    const diff: Record<string, any> = {};
    for (const k of ['nome', 'sentido', 'hora_inicio', 'hora_fim', 'ativo',
                     'permitir_morador', 'permitir_visitante',
                     'permitir_prestador', 'permitir_funcionario'] as const) {
      if (dto[k] !== undefined && (regraExistente as any)[k] !== (atualizada as any)[k]) {
        diff[k] = { de: (regraExistente as any)[k], para: (atualizada as any)[k] };
      }
    }
    if (dto.dispositivosIds !== undefined) diff['dispositivos'] = dto.dispositivosIds;

    await this.auditoria.registrar({
      id_condominio: atualizada.id_condominio,
      usuario_nome: operador?.nome ?? 'sistema',
      acao: 'RULE_CHANGE',
      modulo: 'regras-acesso',
      entidade_id: id,
      descricao: `Alterou regra "${atualizada.nome}"`,
      detalhes: { changes: diff },
    });
    this.reaplicarRegras(atualizada.id_condominio);
    return atualizada;
  }

  async remove(id: number, idCondominio?: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { success: true };
    }

    const regra = await this.prisma.regras_Acesso.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, nome: true },
    });
    if (!regra) throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    if (idCondominio !== undefined && regra.id_condominio !== idCondominio) {
      throw new ForbiddenException(`Regra #${id} não pertence a este condomínio`);
    }

    try {
      // Devido ao onDelete: Cascade no Schema, deletar a regra já limpa a tabela intermediária
      await this.prisma.regras_Acesso.delete({
        where: { id: Number(id) },
      });
      await this.auditoria.registrar({
        id_condominio: regra.id_condominio,
        usuario_nome: operador?.nome ?? 'sistema',
        acao: 'RULE_CHANGE',
        modulo: 'regras-acesso',
        entidade_id: id,
        descricao: `Removeu regra "${regra.nome}"`,
      });
      this.reaplicarRegras(regra.id_condominio);
      return { success: true };
    } catch {
      throw new NotFoundException(`Regra de acesso #${id} não encontrada`);
    }
  }
}
