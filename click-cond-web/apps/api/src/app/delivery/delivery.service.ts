import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { isOperador } from '../auth/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  AtualizarEntregadorDto,
  AtualizarStatusDeliveryDto,
  CriarDeliveryDto,
  CriarEntregadorDto,
} from './dto/delivery.dto';

export type DeliveryStatus =
  | 'AGENDADA'
  | 'CHEGOU'
  | 'AGUARDANDO_AUTORIZACAO'
  | 'AUTORIZADA'
  | 'RETIRADA_NA_PORTARIA'
  | 'CONCLUIDA'
  | 'CANCELADA'
  | 'RECUSADA';

const TRANSICOES: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  AGENDADA: ['CHEGOU', 'CANCELADA'],
  CHEGOU: ['AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AGUARDANDO_AUTORIZACAO: ['AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AUTORIZADA: ['CONCLUIDA'],
  RETIRADA_NA_PORTARIA: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
  RECUSADA: [],
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantAccessService,
  ) {}

  async criarAviso(dto: CriarDeliveryDto, user: JwtPayload) {
    const idCondominio = Number(dto.id_condominio);
    const idApartamento = Number(dto.id_apartamento);
    const idMorador = this.idUsuario(user);
    await this.tenant.assertCondominio(idCondominio, user);
    await this.assertApartamentoDoMorador(idApartamento, idCondominio, idMorador);

    const atendimento = await (this.prisma as any).deliveryAtendimentos.create({
      data: {
        id_condominio: idCondominio,
        id_apartamento: idApartamento,
        id_morador_user: idMorador,
        estabelecimento: dto.estabelecimento?.trim() || null,
        previsao_em: dto.previsao_em ? new Date(dto.previsao_em) : null,
        observacao_morador: dto.observacao_morador?.trim() || null,
        nome_entregador: dto.nome_entregador?.trim() || null,
        telefone_entregador: dto.telefone_entregador?.trim() || null,
        modo_entrega: dto.modo_entrega === 'PORTARIA' ? 'PORTARIA' : 'UNIDADE',
        status: 'AGENDADA',
      },
    });
    await this.registrarEvento(this.prisma, atendimento.id, null, 'AGENDADA', user);
    return atendimento;
  }

  async listarAtendimentos(idCondominio: number, status: string | undefined, user: JwtPayload) {
    await this.tenant.assertCondominio(Number(idCondominio), user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (status) where.status = status;
    const operador = isOperador(user);
    if (!operador) where.id_morador_user = this.idUsuario(user);
    return (this.prisma as any).deliveryAtendimentos.findMany({
      where,
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
        entregador: operador
          ? true
          : { select: { nome: true, telefone: true, plataforma: true } },
        eventos: operador
          ? { orderBy: { created_at: 'asc' } }
          : {
              select: { status_novo: true, mensagem: true, created_at: true },
              orderBy: { created_at: 'asc' },
            },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async atualizarStatus(id: number, dto: AtualizarStatusDeliveryDto, user: JwtPayload) {
    const atendimento = await (this.prisma as any).deliveryAtendimentos.findUnique({ where: { id: Number(id) } });
    if (!atendimento) throw new NotFoundException(`Atendimento de delivery ${id} não encontrado`);
    await this.tenant.assertEntidade(atendimento.id_condominio, user, `atendimento de delivery #${id}`);

    const statusNovo = dto.status as DeliveryStatus;
    const statusAtual = atendimento.status as DeliveryStatus;
    if (!TRANSICOES[statusAtual]?.includes(statusNovo)) {
      throw new ConflictException(`Transição inválida: ${statusAtual} para ${dto.status}.`);
    }
    if (['RECUSADA', 'CANCELADA'].includes(statusNovo) && !dto.motivo?.trim()) {
      throw new BadRequestException(`${statusNovo} exige motivo.`);
    }
    if (statusNovo === 'CANCELADA' && atendimento.id_morador_user !== this.idUsuario(user) && !isOperador(user)) {
      throw new ForbiddenException('Somente o morador solicitante pode cancelar este aviso.');
    }
    if (statusNovo !== 'CANCELADA' && !isOperador(user)) {
      throw new ForbiddenException('Apenas a portaria pode atualizar este atendimento.');
    }

    const idEntregador = dto.id_entregador === undefined ? atendimento.id_entregador : Number(dto.id_entregador);
    if (dto.id_entregador !== undefined) await this.assertEntregadorDoCondominio(idEntregador, atendimento.id_condominio);
    if (statusNovo === 'AUTORIZADA' && idEntregador) {
      const entregador = await this.assertEntregadorDoCondominio(idEntregador, atendimento.id_condominio);
      if (entregador.status === 'BLOQUEADO') {
        throw new ConflictException('Entregador bloqueado não pode ser autorizado.');
      }
    }

    const agora = new Date();
    const data: any = {
      status: statusNovo,
      ...(dto.id_entregador !== undefined && { id_entregador: idEntregador }),
      ...(dto.motivo?.trim() && { motivo: dto.motivo.trim() }),
      ...(statusNovo === 'CHEGOU' && { chegou_em: agora }),
      ...(statusNovo === 'AUTORIZADA' && { autorizado_em: agora }),
      ...(statusNovo === 'CONCLUIDA' && { concluido_em: agora }),
      ...(statusNovo === 'CANCELADA' && { cancelado_em: agora }),
      ...(statusNovo === 'RECUSADA' && { recusado_em: agora }),
    };
    const atualizado = await (this.prisma as any).$transaction(async (tx: any) => {
      const registro = await tx.deliveryAtendimentos.update({ where: { id: Number(id) }, data });
      await this.registrarEvento(tx, registro.id, statusAtual, statusNovo, user, dto.observacao ?? dto.motivo);
      return registro;
    });
    if (['CHEGOU', 'AUTORIZADA', 'CONCLUIDA'].includes(statusNovo)) {
      await this.notificarMorador(
        atualizado.id_apartamento,
        atualizado.id_morador_user,
        statusNovo,
        atualizado.id,
      );
    }
    return atualizado;
  }

  async listarEntregadores(idCondominio: number, busca: string | undefined, user: JwtPayload) {
    this.assertOperador(user, 'listar entregadores');
    await this.tenant.assertCondominio(Number(idCondominio), user);
    return (this.prisma as any).deliveryEntregadores.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(busca?.trim() && { OR: [{ nome: { contains: busca.trim() } }, { telefone: { contains: busca.trim() } }, { veiculos: { some: { placa: { contains: this.normalizarPlaca(busca) } } } }] }),
      },
      include: { veiculos: true },
      orderBy: { nome: 'asc' },
    });
  }

  async criarEntregador(dto: CriarEntregadorDto, user: JwtPayload) {
    this.assertOperador(user, 'cadastrar entregador');
    if (!dto.nome?.trim()) throw new BadRequestException('Nome do entregador é obrigatório.');
    await this.tenant.assertCondominio(Number(dto.id_condominio), user);
    const entregador = await (this.prisma as any).deliveryEntregadores.create({
      data: {
        id_condominio: Number(dto.id_condominio), nome: dto.nome.trim(), telefone: dto.telefone?.trim() || null,
        documento: dto.documento?.trim() || null, plataforma: dto.plataforma?.trim() || null, foto: dto.foto || null,
      },
    });
    if (dto.veiculo) await this.criarVeiculo(entregador.id, entregador.id_condominio, dto.veiculo);
    return entregador;
  }

  async atualizarEntregador(id: number, dto: AtualizarEntregadorDto, user: JwtPayload) {
    this.assertOperador(user, 'atualizar entregador');
    const entregador = await (this.prisma as any).deliveryEntregadores.findUnique({ where: { id: Number(id) } });
    if (!entregador) throw new NotFoundException(`Entregador ${id} não encontrado`);
    await this.tenant.assertEntidade(entregador.id_condominio, user, `entregador #${id}`);
    if (dto.status === 'BLOQUEADO' && !dto.motivo_bloqueio?.trim()) {
      throw new BadRequestException('Bloqueio exige motivo.');
    }
    return (this.prisma as any).deliveryEntregadores.update({
      where: { id: Number(id) },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome.trim() }), ...(dto.telefone !== undefined && { telefone: dto.telefone.trim() || null }),
        ...(dto.documento !== undefined && { documento: dto.documento.trim() || null }), ...(dto.plataforma !== undefined && { plataforma: dto.plataforma.trim() || null }),
        ...(dto.foto !== undefined && { foto: dto.foto || null }), ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.status === 'BLOQUEADO' && { motivo_bloqueio: dto.motivo_bloqueio!.trim() }), ...(dto.status === 'ATIVO' && { motivo_bloqueio: null }),
      },
    });
  }

  private async assertApartamentoDoMorador(idApartamento: number, idCondominio: number, idMorador: number) {
    const apartamento = await this.prisma.apartamentos.findUnique({ where: { id: idApartamento }, select: { id_condominio: true } });
    if (!apartamento || apartamento.id_condominio !== idCondominio) throw new ForbiddenException('Apartamento não pertence ao condomínio informado.');
    const vinculo = await this.prisma.apartamentos_Users.findFirst({ where: { id_apto: idApartamento, id_user: idMorador }, select: { id: true } });
    if (!vinculo) throw new ForbiddenException('Morador não possui vínculo com este apartamento.');
  }

  private async assertEntregadorDoCondominio(idEntregador: number, idCondominio: number) {
    const entregador = await (this.prisma as any).deliveryEntregadores.findUnique({ where: { id: idEntregador } });
    if (!entregador || entregador.id_condominio !== idCondominio) throw new ForbiddenException('Entregador não pertence ao condomínio deste atendimento.');
    return entregador;
  }

  private async registrarEvento(db: any, idAtendimento: number, anterior: DeliveryStatus | null, novo: DeliveryStatus, user: JwtPayload, mensagem?: string) {
    return db.deliveryEventos.create({ data: { id_atendimento: idAtendimento, status_anterior: anterior, status_novo: novo, id_usuario_autor: this.idUsuario(user), autor_nome: user.nome ?? user.user?.name ?? null, mensagem: mensagem?.trim() || null } });
  }

  private async notificarMorador(idApartamento: number, idMorador: number, status: DeliveryStatus, idAtendimento: number) {
    const vinculo = await this.prisma.apartamentos_Users.findFirst({ where: { id_apto: idApartamento, id_user: idMorador }, include: { user: { select: { fcm_token: true } } } });
    const mensagens: Partial<Record<DeliveryStatus, string>> = { CHEGOU: 'Seu entregador chegou à portaria.', AUTORIZADA: 'Sua entrega foi autorizada.', CONCLUIDA: 'Sua entrega foi concluída.' };
    await this.notifications.sendPushNotification(vinculo?.user?.fcm_token ?? '', 'Delivery', mensagens[status] ?? 'Atualização no seu atendimento.', { id_delivery: String(idAtendimento), status });
  }

  private async criarVeiculo(idEntregador: number, idCondominio: number, veiculo: { tipo?: string; placa?: string; modelo?: string; cor?: string }) {
    try {
      return await (this.prisma as any).deliveryVeiculos.create({ data: { id_entregador: idEntregador, id_condominio: idCondominio, tipo: veiculo.tipo?.trim() || null, placa: veiculo.placa ? this.normalizarPlaca(veiculo.placa) : null, modelo: veiculo.modelo?.trim() || null, cor: veiculo.cor?.trim() || null } });
    } catch (erro: any) {
      if (erro?.code === 'P2002') throw new ConflictException('Placa já cadastrada neste condomínio.');
      throw erro;
    }
  }

  private normalizarPlaca(placa: string) { return placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  private idUsuario(user: JwtPayload) { const id = Number(user?.user?.id ?? user?.sub); if (!id) throw new ForbiddenException('Sessão sem usuário válido.'); return id; }
  private assertOperador(user: JwtPayload, contexto: string) { if (!isOperador(user)) throw new ForbiddenException(`Acesso negado: ${contexto} exige operador.`); }
}
