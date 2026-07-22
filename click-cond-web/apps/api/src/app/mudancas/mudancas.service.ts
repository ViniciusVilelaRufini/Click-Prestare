import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { assertStaff } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class MudancasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
  ) {}

  /** Lista todas as mudanças de um condomínio. Sindico vê tudo, morador vê só as do seu apto. */
  async findAll(idCondominio: number, idApto?: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (idApto && Number(idApto) > 0) {
      where.id_apartamento = Number(idApto);
    }

    const list = await this.prisma.mudancas.findMany({
      where,
      include: {
        apartamento: { select: { apto: true, bloco: true } },
        criadoPor: { select: { name: true } },
      },
      orderBy: [{ data: 'desc' }, { created_at: 'desc' }],
    });

    return list.map((m) => this.flatten(m));
  }

  async findOne(id: number, user?: JwtPayload) {
    const m = await this.prisma.mudancas.findUnique({
      where: { id: Number(id) },
      include: {
        apartamento: { select: { apto: true, bloco: true } },
      },
    });
    if (!m) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(m.id_condominio, user, `mudança #${id}`);
    return this.flatten(m);
  }

  async create(dto: {
    data: string | null;
    hora_inicio: string | null;
    id_apartamento: number;
    id_condominio: number;
    user?: number | null;
  }, requester?: JwtPayload) {
    await this.tenant.assertCondominio(dto.id_condominio, requester);
    return this.prisma.mudancas.create({
      data: {
        data: dto.data ? new Date(dto.data) : null,
        hora_inicio: dto.hora_inicio ? new Date(`1970-01-01T${dto.hora_inicio}:00`) : null,
        id_apartamento: Number(dto.id_apartamento),
        id_condominio: Number(dto.id_condominio),
        user: dto.user ?? null,
        status: 'pendente',
      },
    });
  }

  async update(
    id: number,
    dto: Partial<{
      data: string | null;
      hora_inicio: string | null;
      id_apartamento: number;
    }>,
    user?: JwtPayload,
  ) {
    const atual = await this.prisma.mudancas.findUnique({ where: { id: Number(id) }, select: { id_condominio: true, user: true } });
    if (!atual) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `mudança #${id}`);
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'editar mudança de outro morador');
    try {
      return await this.prisma.mudancas.update({
        where: { id: Number(id) },
        data: {
          ...(dto.data !== undefined && { data: dto.data ? new Date(dto.data) : null }),
          ...(dto.hora_inicio !== undefined && {
            hora_inicio: dto.hora_inicio ? new Date(`1970-01-01T${dto.hora_inicio}:00`) : null,
          }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: Number(dto.id_apartamento) }),
        },
      });
    } catch {
      throw new NotFoundException(`Mudança ${id} não encontrada`);
    }
  }

  async updateStatus(id: number, isAccept: boolean, motivo?: string, user?: JwtPayload) {
    assertStaff(user, 'aprovar ou recusar mudança');
    const atual = await this.prisma.mudancas.findUnique({ where: { id: Number(id) }, select: { id_condominio: true } });
    if (!atual) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `mudança #${id}`);
    try {
      return await this.prisma.mudancas.update({
        where: { id: Number(id) },
        data: {
          status: isAccept ? 'aprovada' : 'recusada',
          motivo_recusa: isAccept ? null : (motivo ?? null),
        },
      });
    } catch {
      throw new NotFoundException(`Mudança ${id} não encontrada`);
    }
  }

  async remove(id: number, user?: JwtPayload) {
    const atual = await this.prisma.mudancas.findUnique({ where: { id: Number(id) }, select: { id_condominio: true, user: true } });
    if (!atual) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `mudança #${id}`);
    const callerId = user?.user?.id ?? user?.sub;
    if (atual.user !== callerId) assertStaff(user, 'remover mudança de outro morador');
    try {
      await this.prisma.mudancas.delete({ where: { id: Number(id) } });
    } catch {
      throw new NotFoundException(`Mudança ${id} não encontrada`);
    }
  }

  /** Achata apartamento em apto / apto_bloco e formata as datas para string */
  private flatten(m: any) {
    const { apartamento, ...rest } = m;
    return {
      ...rest,
      data: m.data
        ? new Date(m.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
        : null,
      hora_inicio: m.hora_inicio
        ? new Date(m.hora_inicio).toISOString().substring(11, 16)
        : null,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
    };
  }
}
