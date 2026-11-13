import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService, ehFuncionarioDoApp } from '../auth/tenant-access.service';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { assertStaff, isOperador } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { hojeBrasilia } from '../common/hora-brasilia.util';
import { assertApartamentoGravavel, ehMoradorMobile } from '../common/apartamento-gravavel.util';

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
    if (ehMoradorMobile(user)) {
      // O recorte do morador vem dos vínculos dele, não do `id_apto` do cliente:
      // omitindo o parâmetro, a lista trazia as mudanças do prédio inteiro.
      const { userId, aptos } = await this.aptosDoMorador(Number(idCondominio), user!);
      const alvo = idApto && aptos.includes(Number(idApto)) ? [Number(idApto)] : aptos;
      where.OR = [{ user: userId }, ...(alvo.length ? [{ id_apartamento: { in: alvo } }] : [])];
    } else if (idApto && Number(idApto) > 0) {
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
    if (ehMoradorMobile(user)) {
      const { userId, aptos } = await this.aptosDoMorador(m.id_condominio, user!);
      if (m.user !== userId && !aptos.includes(m.id_apartamento)) {
        throw new ForbiddenException('Acesso negado: esta mudança não é de um apartamento seu.');
      }
    }
    return this.flatten(m);
  }

  /** Users.id do morador e os apartamentos dele neste condomínio. */
  private async aptosDoMorador(idCondominio: number, user: JwtPayload) {
    const userId = idUsuarioDoToken(user);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: userId, apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_apto: true },
    });
    return { userId, aptos: [...new Set(vinculos.map((v) => v.id_apto))] };
  }

  async create(dto: {
    data: string | null;
    hora_inicio: string | null;
    id_apartamento: number;
    id_condominio: number;
    user?: number | null;
  }, requester?: JwtPayload) {
    await this.tenant.assertCondominio(dto.id_condominio, requester);
    const idApartamento = Number(dto.id_apartamento);
    if (!Number.isInteger(idApartamento) || idApartamento <= 0) {
      throw new BadRequestException('Apartamento não informado.');
    }
    // Do condomínio informado e, para morador, um apartamento dele.
    await assertApartamentoGravavel(this.prisma as any, idApartamento, Number(dto.id_condominio), requester);
    // Agendar mudança para uma unidade qualquer é a área `agendar_mudanca` (mesma flag de
    // update/remove/updateStatus). O funcionário que mora na unidade agenda a própria sem ela.
    if (ehFuncionarioDoApp(requester)) {
      const idUser = idUsuarioDoToken(requester);
      const moraNaUnidade = idUser
        ? await this.prisma.apartamentos_Users.findFirst({
            where: { id_user: idUser, id_apto: idApartamento },
            select: { id_apto: true },
          })
        : null;
      if (!moraNaUnidade) {
        await this.tenant.assertPermissaoFuncionario(Number(dto.id_condominio), 'agendar_mudanca', requester);
      }
    }
    return this.prisma.mudancas.create({
      data: {
        data: dto.data ? new Date(dto.data) : null,
        hora_inicio: dto.hora_inicio ? new Date(`1970-01-01T${dto.hora_inicio}:00`) : null,
        id_apartamento: idApartamento,
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
    const atual = await this.prisma.mudancas.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, user: true, status: true, data: true, hora_inicio: true, id_apartamento: true },
    });
    if (!atual) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `mudança #${id}`);
    // Token sem Users.id (porteiro do console) nunca é o dono.
    const callerId = idUsuarioDoToken(user);
    if (callerId === null || atual.user !== callerId) {
      assertStaff(user, 'editar mudança de outro morador');
      // Mesma flag do updateStatus: gerir mudança alheia é "agendar mudança".
      await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'agendar_mudanca', user);
    }
    if (dto.id_apartamento !== undefined) {
      await assertApartamentoGravavel(this.prisma as any, Number(dto.id_apartamento), atual.id_condominio, user);
    }
    // A aprovação vale para o dia, a hora e a unidade que a equipe viu: o
    // morador que remarca uma mudança aprovada (ou recusada) a devolve à fila.
    const voltaAPendente = !isOperador(user) && atual.status !== 'pendente' && this.remarcou(atual, dto);
    try {
      return await this.prisma.mudancas.update({
        where: { id: Number(id) },
        data: {
          ...(voltaAPendente && { status: 'pendente', motivo_recusa: null }),
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
    const atual = await this.prisma.mudancas.findUnique({ where: { id: Number(id) }, select: { id_condominio: true, data: true } });
    if (!atual) throw new NotFoundException(`Mudança ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `mudança #${id}`);
    // assertStaff só garante "não é morador": sem isto, funcionário com a flag
    // desligada pelo síndico ainda liberava elevador e portaria.
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'agendar_mudanca', user);
    // Aprovar libera elevador e portaria: não faz sentido para um dia que já
    // passou (coluna @db.Date, comparada com o "hoje" de Brasília). Recusar
    // continua permitido para limpar a fila.
    if (isAccept && atual.data && new Date(atual.data) < hojeBrasilia()) {
      throw new BadRequestException('Não é possível aprovar uma mudança com data passada.');
    }
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
    const callerId = idUsuarioDoToken(user);
    if (callerId === null || atual.user !== callerId) {
      assertStaff(user, 'remover mudança de outro morador');
      await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'agendar_mudanca', user);
    }
    try {
      await this.prisma.mudancas.delete({ where: { id: Number(id) } });
    } catch {
      throw new NotFoundException(`Mudança ${id} não encontrada`);
    }
  }

  /**
   * Data, hora ou unidade diferentes das gravadas. Comparadas como o app as
   * lê (`flatten`): data em AAAA-MM-DD e hora em HH:MM, ambas em UTC.
   */
  private remarcou(
    atual: { data: Date | null; hora_inicio: Date | null; id_apartamento: number | null },
    dto: Partial<{ data: string | null; hora_inicio: string | null; id_apartamento: number }>,
  ): boolean {
    const dia = (v: Date | string | null | undefined) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
    };
    const hora = (v: Date | null | undefined) => (v ? new Date(v).toISOString().substring(11, 16) : null);
    if (dto.data !== undefined && dia(dto.data) !== dia(atual.data)) return true;
    if (dto.hora_inicio !== undefined && (dto.hora_inicio ? dto.hora_inicio.slice(0, 5) : null) !== hora(atual.hora_inicio)) {
      return true;
    }
    return dto.id_apartamento !== undefined && Number(dto.id_apartamento) !== atual.id_apartamento;
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
