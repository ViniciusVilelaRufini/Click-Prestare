import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CardAoVivoService } from '../card-ao-vivo/card-ao-vivo.service';
import { AtendimentoCard, mensagemDelivery } from '../card-ao-vivo/delivery-conteudo';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { isOperador } from '../auth/tenant.util';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { parseLocalTimeToUTCNullable } from '../visitantes/visitantes.service';
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

const TERMINAIS: readonly DeliveryStatus[] = ['CONCLUIDA', 'CANCELADA', 'RECUSADA'];
const LIMITE_HISTORICO = 500;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
/** Recusados/cancelados continuam na fila da portaria por este tempo, com o desfecho. */
export const TERMINAIS_NA_FILA_MS = 2 * 3_600_000;
/** Quanto a resposta do PATCH espera pelo aviso ao morador (card + notificação). */
export const TETO_AVISO_MS = 2_000;

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantAccessService,
    private readonly storage: StorageService,
    @Optional() private readonly cardAoVivo?: CardAoVivoService,
  ) {}

  async criarAviso(dto: CriarDeliveryDto, user: JwtPayload) {
    const idCondominio = Number(dto.id_condominio);
    const idApartamento = Number(dto.id_apartamento);
    const idMorador = this.idUsuario(user);
    await this.tenant.assertCondominio(idCondominio, user);
    await this.assertApartamentoDoMorador(idApartamento, idCondominio, idMorador);

    const atendimento = await (this.prisma as any).$transaction(async (tx: any) => {
      const atendimento = await tx.deliveryAtendimentos.create({
        data: {
          id_condominio: idCondominio,
          id_apartamento: idApartamento,
          id_morador_user: idMorador,
          estabelecimento: dto.estabelecimento?.trim() || null,
          // O app manda a hora local sem fuso ("…T19:00:00.000"): é Brasília,
          // não UTC (o console mostrava 3 h adiantado).
          previsao_em: parseLocalTimeToUTCNullable(dto.previsao_em),
          observacao_morador: dto.observacao_morador?.trim() || null,
          nome_entregador: dto.nome_entregador?.trim() || null,
          telefone_entregador: dto.telefone_entregador?.trim() || null,
          modo_entrega: dto.modo_entrega === 'PORTARIA' ? 'PORTARIA' : 'UNIDADE',
          status: 'AGENDADA',
        },
      });
      await this.registrarEvento(tx, atendimento.id, null, 'AGENDADA', user);
      return atendimento;
    });
    return this.paraMorador(atendimento);
  }

  async listarUnidadesMorador(idCondominio: number, user: JwtPayload) {
    const condominio = Number(idCondominio);
    const idMorador = this.idUsuario(user);
    await this.tenant.assertCondominio(condominio, user);
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: {
        id_user: idMorador,
        apartamento: { id_condominio: condominio },
      },
      select: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
    });
    const unidades = new Map<number, { id: number; bloco: string | null; apto: string | null }>();
    for (const vinculo of vinculos) {
      unidades.set(vinculo.apartamento.id, {
        id: vinculo.apartamento.id,
        bloco: vinculo.apartamento.bloco,
        apto: vinculo.apartamento.apto,
      });
    }
    return [...unidades.values()].sort((a, b) => {
      const bloco = (a.bloco ?? '').localeCompare(b.bloco ?? '', 'pt-BR', { numeric: true });
      return bloco || (a.apto ?? '').localeCompare(b.apto ?? '', 'pt-BR', { numeric: true });
    });
  }

  async resumo(idCondominio: number, de: string | undefined, ate: string | undefined, user: JwtPayload) {
    this.assertOperador(user, 'resumo de delivery');
    await this.tenant.assertCondominio(Number(idCondominio), user);
    const periodo = this.periodo(de, ate);
    const base = { id_condominio: Number(idCondominio) };
    const noPeriodo = { gte: periodo.gte, lte: periodo.lte };
    const db = (this.prisma as any).deliveryAtendimentos;
    const [ativosBrutos, terminaisBrutos, concluidos] = await Promise.all([
      db.groupBy({ by: ['status'], where: { ...base, status: { notIn: [...TERMINAIS] } }, _count: { _all: true } }),
      db.groupBy({ by: ['status'], where: { ...base, status: { in: [...TERMINAIS] }, created_at: noPeriodo }, _count: { _all: true } }),
      db.findMany({
        where: { ...base, status: 'CONCLUIDA', created_at: noPeriodo, chegou_em: { not: null }, concluido_em: { not: null } },
        select: { chegou_em: true, concluido_em: true },
      }),
    ]);
    const contar = (linhas: { status: string; _count: { _all: number } }[], status: readonly string[]) =>
      Object.fromEntries(status.map((s) => [s, linhas.find((l) => l.status === s)?._count._all ?? 0]));
    const ativos = contar(ativosBrutos, ['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA']);
    const terminais = contar(terminaisBrutos, TERMINAIS);
    const duracoes = (concluidos as { chegou_em: Date; concluido_em: Date }[])
      .map((a) => (new Date(a.concluido_em).getTime() - new Date(a.chegou_em).getTime()) / 60_000)
      .filter((min) => min >= 0);
    const media = duracoes.length ? duracoes.reduce((s, m) => s + m, 0) / duracoes.length : null;
    return {
      ativos,
      periodo: {
        de: periodo.de,
        ate: periodo.ate,
        CONCLUIDA: terminais.CONCLUIDA,
        CANCELADA: terminais.CANCELADA,
        RECUSADA: terminais.RECUSADA,
        total: terminais.CONCLUIDA + terminais.CANCELADA + terminais.RECUSADA,
      },
      tempo_medio_atendimento_min: media === null ? null : Math.round(media * 10) / 10,
    };
  }

  async listarAtendimentos(
    idCondominio: number,
    status: string | undefined,
    user: JwtPayload,
    filtro: { escopo?: string; de?: string; ate?: string } = {},
  ) {
    await this.tenant.assertCondominio(Number(idCondominio), user);
    const where: any = { id_condominio: Number(idCondominio) };
    if (status) where.status = status;
    const operador = isOperador(user);
    const idMorador = operador ? null : this.idUsuario(user);
    if (idMorador) {
      // Os próprios avisos em qualquer status; os de outros moradores da
      // unidade só quando já pedem ação ou tiveram desfecho (o agendado alheio
      // não é dele para cancelar).
      where.OR = [
        { id_morador_user: idMorador },
        { status: { not: 'AGENDADA' }, apartamento: { users: { some: { id_user: idMorador } } } },
      ];
    }
    if (operador) {
      let take: number | undefined;
      if (filtro.escopo === 'ativos') {
        // Recusa/cancelamento recentes ficam na fila com o desfecho, sem sumir em silêncio.
        const desde = new Date(Date.now() - TERMINAIS_NA_FILA_MS);
        where.AND = [{
          OR: [
            { status: { notIn: [...TERMINAIS] } },
            { status: 'RECUSADA', recusado_em: { gte: desde } },
            { status: 'CANCELADA', cancelado_em: { gte: desde } },
          ],
        }];
      } else if (filtro.escopo === 'historico') {
        const { gte, lte } = this.periodo(filtro.de, filtro.ate);
        where.AND = [{ status: { in: [...TERMINAIS] } }];
        where.created_at = { gte, lte };
        take = LIMITE_HISTORICO;
      } else if (filtro.escopo !== undefined && filtro.escopo !== '') {
        throw new BadRequestException('escopo deve ser "ativos" ou "historico".');
      }
      return (this.prisma as any).deliveryAtendimentos.findMany({
        where,
        include: {
          apartamento: { select: { id: true, bloco: true, apto: true } },
          entregador: { include: { veiculos: true } },
          eventos: { orderBy: { created_at: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        ...(take ? { take } : {}),
      });
    }
    const lista = await (this.prisma as any).deliveryAtendimentos.findMany({
      where,
      select: {
        id: true,
        id_morador_user: true,
        estabelecimento: true,
        previsao_em: true,
        observacao_morador: true,
        nome_entregador: true,
        telefone_entregador: true,
        status: true,
        modo_entrega: true,
        chegou_em: true,
        autorizado_em: true,
        concluido_em: true,
        cancelado_em: true,
        recusado_em: true,
        motivo: true,
        created_at: true,
        updated_at: true,
        apartamento: { select: { bloco: true, apto: true } },
        entregador: { select: { nome: true, telefone: true, plataforma: true } },
        eventos: {
          select: { status_novo: true, mensagem: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    // `proprio`: este morador criou o aviso (só ele cancela). O id de quem criou não sai.
    return (lista as any[]).map(({ id_morador_user, ...a }) => ({ ...a, proprio: id_morador_user === idMorador }));
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
    if (statusNovo === 'CANCELADA' && !isOperador(user) && atendimento.id_morador_user !== this.idUsuario(user)) {
      throw new ForbiddenException('Somente o morador solicitante pode cancelar este aviso.');
    }
    // Quem abriu o aviso ou outro morador com vínculo na unidade responde ao
    // pedido de autorização da portaria (autorizar ou recusar). Qualquer
    // outra mudança é da portaria.
    const respostaDoMorador =
      !isOperador(user) &&
      statusAtual === 'AGUARDANDO_AUTORIZACAO' &&
      ['AUTORIZADA', 'RECUSADA'].includes(statusNovo) &&
      (atendimento.id_morador_user === this.idUsuario(user) ||
        (await this.temVinculoNaUnidade(atendimento.id_apartamento, this.idUsuario(user))));
    if (statusNovo !== 'CANCELADA' && !isOperador(user) && !respostaDoMorador) {
      throw new ForbiddenException('Apenas a portaria pode atualizar este atendimento.');
    }
    if (respostaDoMorador && dto.id_entregador !== undefined) {
      throw new ForbiddenException('Apenas a portaria identifica o entregador.');
    }

    const idEntregador = dto.id_entregador === undefined ? atendimento.id_entregador : Number(dto.id_entregador);
    if (dto.id_entregador !== undefined) await this.assertEntregadorDoCondominio(idEntregador, atendimento.id_condominio);
    // A autorização do próprio morador vale mesmo antes de a portaria
    // identificar o entregador; a da portaria continua exigindo.
    if (statusNovo === 'AUTORIZADA' && !idEntregador && !respostaDoMorador) {
      throw new BadRequestException('Identifique o entregador antes de autorizar o atendimento.');
    }
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
      const alteracao = await tx.deliveryAtendimentos.updateMany({
        where: { id: Number(id), status: statusAtual },
        data,
      });
      if (alteracao.count !== 1) {
        throw new ConflictException('O atendimento foi alterado por outra operação. Recarregue a fila e tente novamente.');
      }
      const registro = await tx.deliveryAtendimentos.findUnique({ where: { id: Number(id) } });
      if (!registro) throw new NotFoundException(`Atendimento de delivery ${id} não encontrado`);
      await this.registrarEvento(tx, registro.id, statusAtual, statusNovo, user, dto.observacao ?? dto.motivo);
      return registro;
    });
    // Recusada e retirada na portaria também mudam o que o morador precisa
    // fazer (buscar lá embaixo / saber que não vem) — ficavam sem aviso.
    // Quem respondeu foi o próprio morador: não há o que avisar a ele.
    // O aviso (card ao vivo + notificação) espera no máximo TETO_AVISO_MS: o
    // clique do porteiro e o botão do card do morador não podem ficar presos
    // em foto/APNs lentos. Passado o teto, ele segue em segundo plano.
    // Outro morador da unidade respondeu: quem criou o aviso precisa saber quem foi.
    const respondeuOProprioCriador = !isOperador(user) && atendimento.id_morador_user === this.idUsuario(user);
    const outroRespondeu = respostaDoMorador && !respondeuOProprioCriador
      ? (user.nome ?? user.user?.name ?? '').toString().trim() || 'Outro morador da unidade'
      : null;
    const aviso = this.avisarMorador(atualizado, statusNovo, !isOperador(user), respostaDoMorador, dto.motivo, outroRespondeu).catch((e: any) =>
      this.logger.warn(`Aviso do delivery ${atualizado.id}: ${e?.message ?? e}`),
    );
    let teto: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      aviso,
      new Promise<void>((r) => {
        teto = setTimeout(r, TETO_AVISO_MS);
        (teto as any)?.unref?.();
      }),
    ]);
    if (teto) clearTimeout(teto);
    if (!isOperador(user)) return this.paraMorador(atualizado);
    // Pedido de autorização: a portaria precisa saber se alguém pode receber
    // (com 0, a tela manda interfonar em vez de esperar sem prazo).
    if (statusNovo === 'AGUARDANDO_AUTORIZACAO') {
      const avisados = await this.alcancaveisNaUnidade(atualizado.id_apartamento, atualizado.id_morador_user);
      if (avisados !== null) return { ...atualizado, avisados };
    }
    return atualizado;
  }

  /**
   * Quantas pessoas podem receber o pedido de autorização: os moradores da
   * unidade com aparelho registrado (Users.fcm_token) e o criador do aviso,
   * que recebe o card mesmo desvinculado e pode responder. Cada pessoa conta
   * uma vez. Falha na contagem → null (a resposta sai sem o campo).
   */
  private async alcancaveisNaUnidade(idApartamento: number, idCriador: number): Promise<number | null> {
    try {
      const vinculos = await this.prisma.apartamentos_Users.findMany({
        where: { id_apto: idApartamento },
        select: { id_user: true, user: { select: { fcm_token: true } } },
      });
      const ids = new Set<number>();
      for (const v of vinculos as any[]) if (v.user?.fcm_token) ids.add(v.id_user);
      if (idCriador && !ids.has(idCriador)) {
        const criador = await this.prisma.users.findUnique({ where: { id: idCriador }, select: { fcm_token: true } });
        if (criador?.fcm_token) ids.add(idCriador);
      }
      return ids.size;
    } catch (e: any) {
      this.logger.warn(`Contagem de quem recebe o pedido do delivery: ${e?.message ?? e}`);
      return null;
    }
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
    // Entregador novo não tem foto gravada: URL do bucket nunca é dele.
    await this.storage.exigirArquivoDoRegistro(dto.foto, []);
    return (this.prisma as any).$transaction(async (tx: any) => {
      const entregador = await tx.deliveryEntregadores.create({
        data: {
          id_condominio: Number(dto.id_condominio), nome: dto.nome.trim(), telefone: dto.telefone?.trim() || null,
          documento: dto.documento?.trim() || null, plataforma: dto.plataforma?.trim() || null, foto: dto.foto || null,
        },
      });
      const veiculo = dto.veiculo
        ? await this.criarVeiculo(tx, entregador.id, entregador.id_condominio, dto.veiculo)
        : null;
      return { ...entregador, veiculos: veiculo ? [veiculo] : [] };
    });
  }

  async atualizarEntregador(id: number, dto: AtualizarEntregadorDto, user: JwtPayload) {
    this.assertGestorEntregadores(user);
    const entregador = await (this.prisma as any).deliveryEntregadores.findUnique({
      where: { id: Number(id) },
      include: { veiculos: true },
    });
    if (!entregador) throw new NotFoundException(`Entregador ${id} não encontrado`);
    await this.tenant.assertEntidade(entregador.id_condominio, user, `entregador #${id}`);
    if (dto.status === 'BLOQUEADO' && !dto.motivo_bloqueio?.trim()) {
      throw new BadRequestException('Bloqueio exige motivo.');
    }
    await this.storage.exigirArquivoDoRegistro(dto.foto, [entregador.foto]);
    try {
      return await (this.prisma as any).$transaction(async (tx: any) => {
        await tx.deliveryEntregadores.update({
          where: { id: Number(id) },
          data: {
            ...(dto.nome !== undefined && { nome: dto.nome.trim() }), ...(dto.telefone !== undefined && { telefone: dto.telefone.trim() || null }),
            ...(dto.documento !== undefined && { documento: dto.documento.trim() || null }), ...(dto.plataforma !== undefined && { plataforma: dto.plataforma.trim() || null }),
            ...(dto.foto !== undefined && { foto: dto.foto || null }), ...(dto.status !== undefined && { status: dto.status }),
            ...(dto.status === 'BLOQUEADO' && { motivo_bloqueio: dto.motivo_bloqueio!.trim() }), ...(dto.status === 'ATIVO' && { motivo_bloqueio: null }),
          },
        });

        if (dto.veiculo === null) {
          await tx.deliveryVeiculos.deleteMany({ where: { id_entregador: Number(id) } });
        } else if (dto.veiculo !== undefined) {
          const atual = entregador.veiculos?.[0];
          if (atual) {
            await tx.deliveryVeiculos.update({
              where: { id: atual.id },
              data: {
                tipo: dto.veiculo.tipo?.trim() || null,
                placa: dto.veiculo.placa ? this.normalizarPlaca(dto.veiculo.placa) : null,
                modelo: dto.veiculo.modelo?.trim() || null,
                cor: dto.veiculo.cor?.trim() || null,
              },
            });
          } else {
            await this.criarVeiculo(tx, Number(id), entregador.id_condominio, dto.veiculo);
          }
        }

        return tx.deliveryEntregadores.findUnique({
          where: { id: Number(id) },
          include: { veiculos: true },
        });
      });
    } catch (erro: any) {
      if (erro instanceof ConflictException) throw erro;
      if (erro?.code === 'P2002') throw new ConflictException('Placa já cadastrada neste condomínio.');
      throw erro;
    }
  }

  // Simplificação intencional: Brasília fixa em -03:00 (o país não usa horário de verão desde 2019).
  /** Intervalo em datas locais (America/Sao_Paulo, -03:00 fixo); padrão: últimos 30 dias. */
  private periodo(de?: string, ate?: string) {
    for (const s of [de, ate]) {
      if (!s) continue;
      const d = new Date(`${s}T00:00:00Z`);
      if (!DATA_ISO.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw new BadRequestException('Datas devem estar no formato AAAA-MM-DD.');
      }
    }
    const hojeLocal = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const fim = ate || hojeLocal;
    const inicio = de || new Date(Date.parse(`${fim}T00:00:00Z`) - 29 * DIA_MS).toISOString().slice(0, 10);
    const gte = new Date(`${inicio}T00:00:00-03:00`);
    const lte = new Date(`${fim}T23:59:59.999-03:00`);
    if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) {
      throw new BadRequestException('Período inválido.');
    }
    return { de: inicio, ate: fim, gte, lte };
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
    return db.deliveryEventos.create({ data: { id_atendimento: idAtendimento, status_anterior: anterior, status_novo: novo, id_usuario_autor: idUsuarioDoToken(user), autor_nome: user.nome ?? user.user?.name ?? null, mensagem: mensagem?.trim() || null } });
  }

  /**
   * Avisa o morador da mudança: card ao vivo (spec
   * 2026-11-13-card-ao-vivo-delivery) e, para quem não tem o card, a
   * notificação de hoje. CHEGOU abre o card, que já manda a notificação de
   * hoje aos aparelhos sem card. O card é melhor esforço: falhou, segue a
   * notificação de hoje.
   */
  private async avisarMorador(
    registro: any,
    statusNovo: DeliveryStatus,
    acaoDoMorador: boolean,
    respostaDoMorador: boolean,
    motivo?: string,
    /** Nome do outro morador que respondeu ao pedido (null: foi o criador ou a portaria). */
    outroRespondeu: string | null = null,
  ) {
    const notificavel =
      !respostaDoMorador &&
      (['CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'CONCLUIDA', 'RECUSADA', 'RETIRADA_NA_PORTARIA'].includes(statusNovo) ||
        // Cancelamento pela portaria; o do próprio morador não volta a ele.
        (statusNovo === 'CANCELADA' && !acaoDoMorador));
    let cobertos = new Set<string>();
    let viaCard = false;
    if (this.cardAoVivo) {
      try {
        const atendimento = await this.atendimentoParaCard(registro.id);
        if (statusNovo === 'CHEGOU') {
          await this.cardAoVivo.abrirDelivery(atendimento, registro.id_morador_user);
          viaCard = true;
        } else {
          // "Você" no card vale pela unidade: outro morador respondendo também conta.
          const r = await this.cardAoVivo.atualizarDelivery(atendimento, registro.id_morador_user, {
            voceRespondeu: acaoDoMorador,
          });
          cobertos = r.cobertos;
          // Card reaberto: ele mesmo já avisou quem não tem card.
          viaCard = !!r.abriu;
        }
      } catch (e: any) {
        this.logger.warn(`Card ao vivo do delivery ${registro.id}: ${e?.message ?? e}`);
      }
    }
    // Pedido de autorização: os outros moradores da unidade também podem responder.
    if (statusNovo === 'AGUARDANDO_AUTORIZACAO') {
      await this.notificarOutrosDaUnidade(registro.id_apartamento, registro.id_morador_user, registro.id).catch((e: any) =>
        this.logger.warn(`Aviso do delivery ${registro.id} aos outros moradores: ${e?.message ?? e}`),
      );
    }
    // Resposta de outro morador: quem criou recebe a notificação dizendo quem
    // respondeu, mesmo com card (o card só diz "Você", pela unidade).
    if (outroRespondeu) {
      const texto = statusNovo === 'AUTORIZADA'
        ? `${outroRespondeu} autorizou a subida do entregador.`
        : `${outroRespondeu} recusou a entrega.`;
      await this.notificarMorador(registro.id_apartamento, registro.id_morador_user, statusNovo, registro.id, motivo, new Set(), texto);
      return;
    }
    if (!notificavel || viaCard) return;
    await this.notificarMorador(registro.id_apartamento, registro.id_morador_user, statusNovo, registro.id, motivo, cobertos);
  }

  /** O atendimento no formato do card (unidade e entregador com a foto). */
  private async atendimentoParaCard(id: number): Promise<AtendimentoCard> {
    const a = await (this.prisma as any).deliveryAtendimentos.findUnique({
      where: { id: Number(id) },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        entregador: { select: { nome: true, plataforma: true, foto: true } },
      },
    });
    return {
      id: a.id,
      status: a.status,
      estabelecimento: a.estabelecimento ?? null,
      chegou_em: a.chegou_em ?? null,
      autorizado_em: a.autorizado_em ?? null,
      recusado_em: a.recusado_em ?? null,
      concluido_em: a.concluido_em ?? null,
      motivo: a.motivo ?? null,
      bloco: a.apartamento?.bloco ?? null,
      apto: a.apartamento?.apto ?? null,
      entregadorNome: a.entregador?.nome ?? a.nome_entregador ?? null,
      entregadorPlataforma: a.entregador?.plataforma ?? null,
      fotoEntregador: a.entregador?.foto ?? null,
    };
  }

  /** A notificação de hoje; não vai ao aparelho que já acompanha pelo card (`cobertos`). */
  private async notificarMorador(
    idApartamento: number,
    idMorador: number,
    status: DeliveryStatus,
    idAtendimento: number,
    motivo?: string,
    cobertos: Set<string> = new Set(),
    texto?: string,
  ) {
    const vinculo = await this.prisma.apartamentos_Users.findFirst({ where: { id_apto: idApartamento, id_user: idMorador }, include: { user: { select: { fcm_token: true } } } });
    const token = vinculo?.user?.fcm_token ?? '';
    if (token && cobertos.has(token)) return;
    await this.notifications.sendPushNotification(token, 'Delivery', texto ?? mensagemDelivery(status, motivo), { id_delivery: String(idAtendimento), status });
  }

  /** A notificação de hoje do pedido de autorização aos outros moradores da unidade (um token por usuário). */
  private async notificarOutrosDaUnidade(idApartamento: number, idCriador: number, idAtendimento: number) {
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: idApartamento },
      select: { id_user: true, user: { select: { fcm_token: true } } },
    });
    const doCriador = (vinculos as any[]).find((v) => v.id_user === idCriador)?.user?.fcm_token;
    const tokens = new Set<string>();
    for (const v of vinculos as any[]) {
      const token = v.user?.fcm_token;
      if (v.id_user === idCriador || !token || token === doCriador) continue;
      tokens.add(token);
    }
    const status: DeliveryStatus = 'AGUARDANDO_AUTORIZACAO';
    for (const token of tokens) {
      await this.notifications.sendPushNotification(token, 'Delivery', mensagemDelivery(status), { id_delivery: String(idAtendimento), status });
    }
  }

  private async temVinculoNaUnidade(idApartamento: number, idUser: number) {
    const vinculo = await this.prisma.apartamentos_Users.findFirst({ where: { id_apto: idApartamento, id_user: idUser }, select: { id: true } });
    return !!vinculo;
  }

  private async criarVeiculo(db: any, idEntregador: number, idCondominio: number, veiculo: { tipo?: string; placa?: string; modelo?: string; cor?: string }) {
    try {
      return await db.deliveryVeiculos.create({ data: { id_entregador: idEntregador, id_condominio: idCondominio, tipo: veiculo.tipo?.trim() || null, placa: veiculo.placa ? this.normalizarPlaca(veiculo.placa) : null, modelo: veiculo.modelo?.trim() || null, cor: veiculo.cor?.trim() || null } });
    } catch (erro: any) {
      if (erro?.code === 'P2002') throw new ConflictException('Placa já cadastrada neste condomínio.');
      throw erro;
    }
  }

  private normalizarPlaca(placa: string) { return placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  private paraMorador(atendimento: any) {
    const {
      id_condominio: _idCondominio,
      id_apartamento: _idApartamento,
      id_morador_user: _idMorador,
      id_entregador: _idEntregador,
      ...seguro
    } = atendimento;
    return seguro;
  }
  private idUsuario(user: JwtPayload) { const id = idUsuarioDoToken(user); if (!id) throw new ForbiddenException('Sessão sem usuário válido.'); return id; }
  private assertOperador(user: JwtPayload, contexto: string) { if (!isOperador(user)) throw new ForbiddenException(`Acesso negado: ${contexto} exige operador.`); }
  private assertGestorEntregadores(user: JwtPayload) {
    const papel = String(user?.typeAccess ?? user?.user?.typeAccess ?? user?.role ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const turno = String(user?.turno ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const papeisGestores = ['sindico', 'admin', 'administrador', 'superadmin', 'crm_admin'];
    if (!papeisGestores.includes(papel) && !papeisGestores.includes(turno)) {
      throw new ForbiddenException('Acesso negado: gerir entregadores exige síndico ou administrador.');
    }
  }
}
