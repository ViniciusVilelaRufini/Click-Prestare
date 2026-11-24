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
/**
 * Estado em que a chegada pelo portão reaproveita o atendimento da unidade:
 * só o aviso ainda não chegado. CHEGOU/AGUARDANDO_AUTORIZACAO sem pedido de
 * portão é a portaria atendendo: o pedido do portão é recusado.
 */
const REAPROVEITA_NA_CHEGADA: readonly DeliveryStatus[] = ['AGENDADA'];
/** Aviso AGENDADA só é reaproveitado pelo portão se criado há no máximo isto... */
const AVISO_REAPROVEITA_MS = 24 * 3_600_000;
/** ...e, com previsão de chegada, se o entregador chegou até isto antes ou depois dela. */
const PREVISAO_TOLERANCIA_MS = 6 * 3_600_000;
const EM_ATENDIMENTO: readonly DeliveryStatus[] = ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'];
const MSG_PORTARIA_ATENDENDO = 'A portaria já está atendendo uma entrega para esta unidade. Procure a portaria.';
/** Transições que só o sistema faz (rotina do autoatendimento): ninguém responde, ele cancela. */
const TRANSICOES_DO_SISTEMA: Partial<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  CHEGOU: ['CANCELADA'],
  AGUARDANDO_AUTORIZACAO: ['CANCELADA'],
};
/** Aviso AGENDADA sem chegada é cancelado este tempo depois da previsão (ou da criação, sem previsão). */
export const AVISO_SEM_CHEGADA_MS = 24 * 3_600_000;
export const MOTIVO_SEM_CHEGADA = 'Sem chegada';
/**
 * Avisos cancelados por passada da rotina (5 min). Pequeno de propósito: o
 * primeiro tick depois do deploy pega o acumulado e não pode segurar o lock
 * da rotina por minutos; o resto sai nas passadas seguintes.
 */
export const LOTE_SEM_CHEGADA = 50;
/**
 * Atendimento da portaria (sem pedido de portão) parado este tempo é
 * encerrado pela rotina: AUTORIZADA/RETIRADA_NA_PORTARIA → CONCLUIDA;
 * CHEGOU/AGUARDANDO_AUTORIZACAO → CANCELADA com motivo "Sem resposta".
 */
export const PARADO_PORTARIA_MS = 24 * 3_600_000;
export const MOTIVO_PARADO_SEM_RESPOSTA = 'Sem resposta';
export const MSG_ENCERRADO_AUTOMATICAMENTE = 'Encerrado automaticamente';
/** Status do atendimento da portaria parado → para onde a rotina o leva. */
const DESTINO_PARADO_PORTARIA: Partial<Record<DeliveryStatus, { status: DeliveryStatus; mensagem: string }>> = {
  CHEGOU: { status: 'CANCELADA', mensagem: MOTIVO_PARADO_SEM_RESPOSTA },
  AGUARDANDO_AUTORIZACAO: { status: 'CANCELADA', mensagem: MOTIVO_PARADO_SEM_RESPOSTA },
  AUTORIZADA: { status: 'CONCLUIDA', mensagem: MSG_ENCERRADO_AUTOMATICAMENTE },
  RETIRADA_NA_PORTARIA: { status: 'CONCLUIDA', mensagem: MSG_ENCERRADO_AUTOMATICAMENTE },
};
const MSG_JA_TEM_PEDIDO = 'Este atendimento já tem um pedido de portão.';
const MSG_ENTREGADOR_SAIU = 'O entregador não está mais no portão.';
const AUTOR_AUTOATENDIMENTO = 'Autoatendimento';
const AUTOR_SISTEMA = 'Sistema';

/** O pedido de portão mais recente do atendimento, nas listas (sem ids). */
const PEDIDO_PORTAO_NA_LISTA = {
  orderBy: [{ criado_em: 'desc' }, { id: 'desc' }],
  take: 1,
  select: {
    nome: true,
    plataforma: true,
    foto: true,
    status: true,
    aberto_em: true,
    saida_aberta_em: true,
    device: { select: { nome: true } },
  },
} as const;

/** `foto` sai sob a chave que o ArquivosPrivadosInterceptor assina. */
function pedidoNaLista(pedidos: any[] | undefined) {
  const p = pedidos?.[0];
  if (!p) return null;
  return {
    nome: p.nome,
    plataforma: p.plataforma ?? null,
    foto: p.foto ?? null,
    status: p.status,
    portao: p.device?.nome ?? null,
    aberto_em: p.aberto_em ?? null,
    saida_aberta_em: p.saida_aberta_em ?? null,
  };
}

/**
 * Avisado depois de toda mudança de status gravada (autoatendimento no
 * portão: libera, recusa ou abre o pedido). Implementado pelo
 * DeliveryPortaoService, que se registra; a dependência é de mão única.
 */
export interface GanchoPortao {
  /** Chamado depois de toda mudança de status gravada. Nunca deve lançar. */
  aoMudarStatus(atendimento: { id: number; origem: string; id_pedido_portao: number | null }, statusNovo: DeliveryStatus, quem: QuemMudou): Promise<void>;
}

export interface QuemMudou {
  idUser: number | null;
  operador: boolean;
  sistema: boolean;
  /** Morador que respondeu tem vínculo ATUAL com a unidade (só então a nuvem abre o portão). */
  vinculoAtual?: boolean;
}

/** Autor do evento: o usuário do token, ou o sistema (sem usuário). */
type AutorEvento = JwtPayload | { sistema: string };

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  private ganchoPortao?: GanchoPortao;
  /** Público para os testes; em produção é Date.now (prazos do pedido de portão e do aviso reaproveitado). */
  agora: () => number = () => Date.now();

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
    const previsao = this.previsao(dto.previsao_em);

    const atendimento = await (this.prisma as any).$transaction(async (tx: any) => {
      const atendimento = await tx.deliveryAtendimentos.create({
        data: {
          id_condominio: idCondominio,
          id_apartamento: idApartamento,
          id_morador_user: idMorador,
          estabelecimento: dto.estabelecimento?.trim() || null,
          // O app manda a hora local sem fuso ("…T19:00:00.000"): é Brasília,
          // não UTC (o console mostrava 3 h adiantado).
          previsao_em: previsao,
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

  /**
   * Previsão informada pelo morador: data/hora ISO (com ou sem fuso; sem
   * fuso = Brasília). Texto que não é data → 400 (antes virava "agora").
   */
  private previsao(valor: string | null | undefined): Date | null {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const texto = String(valor).trim();
    const formato = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
    const d = formato.test(texto) ? parseLocalTimeToUTCNullable(texto) : null;
    if (!d || Number.isNaN(d.getTime())) {
      throw new BadRequestException('Previsão de chegada inválida: use data e hora (AAAA-MM-DDTHH:mm).');
    }
    return d;
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
      const linhas = await (this.prisma as any).deliveryAtendimentos.findMany({
        where,
        include: {
          apartamento: { select: { id: true, bloco: true, apto: true } },
          entregador: { include: { veiculos: true } },
          eventos: { orderBy: { created_at: 'asc' } },
          pedidosPortao: PEDIDO_PORTAO_NA_LISTA,
        },
        orderBy: { created_at: 'desc' },
        ...(take ? { take } : {}),
      });
      return (linhas as any[]).map(({ pedidosPortao, ...a }) => ({ ...a, pedido_portao: pedidoNaLista(pedidosPortao) }));
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
        origem: true,
        created_at: true,
        updated_at: true,
        apartamento: { select: { bloco: true, apto: true } },
        entregador: { select: { nome: true, telefone: true, plataforma: true } },
        eventos: {
          select: { status_novo: true, mensagem: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
        pedidosPortao: PEDIDO_PORTAO_NA_LISTA,
      },
      orderBy: { created_at: 'desc' },
    });
    // `proprio`: este morador criou o aviso (só ele cancela; sem dono, ninguém). O id de quem criou não sai.
    return (lista as any[]).map(({ id_morador_user, pedidosPortao, ...a }) => ({
      ...a,
      pedido_portao: pedidoNaLista(pedidosPortao),
      proprio: id_morador_user != null && id_morador_user === idMorador,
    }));
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
    // outra mudança é da portaria. Pedido do entregador no portão ainda
    // pendente: o morador também pode responder "vou buscar".
    const pedido = await this.pedidoAtivo(atendimento.id_pedido_portao);
    // Pedido do portão deste atendimento que venceu (marcado ou só pelo prazo):
    // o entregador não está mais lá para liberar ou mandar descer.
    const pedidoVencido =
      !!pedido &&
      statusAtual === 'AGUARDANDO_AUTORIZACAO' &&
      Number(pedido.id_atendimento) === Number(atendimento.id) &&
      (pedido.status === 'expirado' ||
        (pedido.status === 'pendente' && this.agora() >= new Date(pedido.expira_em).getTime()));
    const respostasDoMorador: DeliveryStatus[] =
      pedido?.status === 'pendente' || pedidoVencido
        ? ['AUTORIZADA', 'RECUSADA', 'RETIRADA_NA_PORTARIA']
        : ['AUTORIZADA', 'RECUSADA'];
    // Quem responde como morador decide-se pelo vínculo com a unidade, não
    // pelo papel: síndico ou funcionário que mora na unidade e responde pelo
    // app (token sem condomínio) é morador (a nuvem abre o portão). No
    // console, ou identificando o entregador, continua sendo a portaria.
    const operador = isOperador(user);
    const idUser = idUsuarioDoToken(user);
    const pedeComoMorador =
      statusAtual === 'AGUARDANDO_AUTORIZACAO' &&
      respostasDoMorador.includes(statusNovo) &&
      (!operador || (!user?.id_condominio && dto.id_entregador === undefined));
    // Morador sem Users.id continua caindo no 403 de sessão do idUsuario.
    const podeComoMorador = pedeComoMorador && (!operador || idUser != null);
    const ehDono = podeComoMorador && atendimento.id_morador_user === this.idUsuario(user);
    /** Vínculo ATUAL com a unidade: só com ele a nuvem abre o portão (o dono que se mudou não abre). */
    const vinculoAtual =
      podeComoMorador && (await this.temVinculoNaUnidade(atendimento.id_apartamento, this.idUsuario(user)));
    const respostaDoMorador = ehDono || vinculoAtual;
    if (pedidoVencido && respostaDoMorador && (statusNovo === 'AUTORIZADA' || statusNovo === 'RETIRADA_NA_PORTARIA')) {
      // Nada muda no atendimento; o pedido fica vencido e o card vai ao
      // estado final (o Android fecha o card no 409).
      await (this.prisma as any).deliveryPedidosPortao
        .updateMany({ where: { id: pedido.id, status: 'pendente' }, data: { status: 'expirado' } })
        .catch((e: any) => this.logger.warn(`Pedido de portão ${pedido.id} vencido: ${e?.message ?? e}`));
      await this.comTeto(this.aoVencerPedidoPortao(atendimento.id));
      throw new ConflictException(MSG_ENTREGADOR_SAIU);
    }
    /** Agiu como morador (resposta da unidade, ou o morador cancelando o próprio aviso). */
    const comoMorador = respostaDoMorador || !operador;
    // Atendimento do autoatendimento sem dono: quem responde primeiro vira o dono.
    const semDono = atendimento.id_morador_user == null;
    if (statusNovo !== 'CANCELADA' && !isOperador(user) && !respostaDoMorador) {
      throw new ForbiddenException('Apenas a portaria pode atualizar este atendimento.');
    }
    if (respostaDoMorador && dto.id_entregador !== undefined) {
      throw new ForbiddenException('Apenas a portaria identifica o entregador.');
    }

    const idEntregador = dto.id_entregador === undefined ? atendimento.id_entregador : Number(dto.id_entregador);
    if (dto.id_entregador !== undefined) await this.assertEntregadorDoCondominio(idEntregador, atendimento.id_condominio);
    // A autorização do próprio morador vale mesmo antes de a portaria
    // identificar o entregador; a da portaria continua exigindo, menos no
    // autoatendimento (nome e selfie vêm do pedido do portão).
    if (statusNovo === 'AUTORIZADA' && !idEntregador && !respostaDoMorador && atendimento.origem !== 'autoatendimento') {
      throw new BadRequestException('Identifique o entregador antes de autorizar o atendimento.');
    }
    if (statusNovo === 'AUTORIZADA' && idEntregador) {
      const entregador = await this.assertEntregadorDoCondominio(idEntregador, atendimento.id_condominio);
      if (entregador.status === 'BLOQUEADO') {
        throw new ConflictException('Entregador bloqueado não pode ser autorizado.');
      }
    }

    // Aviso "Na portaria" sem pedido do portão: o "Autorizar" do morador deixa
    // a entrega na portaria (ninguém sobe). Pedido do portão e respostas da
    // portaria continuam como estão.
    const statusGravado: DeliveryStatus =
      statusNovo === 'AUTORIZADA' &&
      respostaDoMorador &&
      atendimento.modo_entrega === 'PORTARIA' &&
      atendimento.id_pedido_portao == null
        ? 'RETIRADA_NA_PORTARIA'
        : statusNovo;

    const agora = new Date();
    const data: any = {
      status: statusGravado,
      ...(dto.id_entregador !== undefined && { id_entregador: idEntregador }),
      ...(dto.motivo?.trim() && { motivo: dto.motivo.trim() }),
      ...(statusGravado === 'CHEGOU' && { chegou_em: agora }),
      ...(statusGravado === 'AUTORIZADA' && { autorizado_em: agora }),
      ...(statusGravado === 'CONCLUIDA' && { concluido_em: agora }),
      ...(statusGravado === 'CANCELADA' && { cancelado_em: agora }),
      ...(statusGravado === 'RECUSADA' && { recusado_em: agora }),
      ...(respostaDoMorador && semDono && { id_morador_user: this.idUsuario(user) }),
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
      await this.registrarEvento(tx, registro.id, statusAtual, statusGravado, user, dto.observacao ?? dto.motivo);
      return registro;
    });
    // Recusada e retirada na portaria também mudam o que o morador precisa
    // fazer (buscar lá embaixo / saber que não vem) — ficavam sem aviso.
    // Quem respondeu foi o próprio morador: não há o que avisar a ele.
    // O aviso (card ao vivo + notificação) espera no máximo TETO_AVISO_MS: o
    // clique do porteiro e o botão do card do morador não podem ficar presos
    // em foto/APNs lentos. Passado o teto, ele segue em segundo plano.
    // Outro morador da unidade respondeu: quem criou o aviso precisa saber quem foi.
    // Sem dono, quem respondeu acabou de virar o dono: não há a quem contar.
    const respondeuOProprioCriador =
      comoMorador && (semDono || atendimento.id_morador_user === this.idUsuario(user));
    const outroRespondeu = respostaDoMorador && !respondeuOProprioCriador
      ? (user.nome ?? user.user?.name ?? '').toString().trim() || 'Outro morador da unidade'
      : null;
    // Portão: libera, abre ou avisa a página do entregador (antes do aviso ao morador).
    const gancho = this.chamarGancho(atualizado, statusGravado, {
      idUser,
      // Respondeu pela unidade (mesmo sendo síndico/funcionário): é o morador; a nuvem abre.
      operador: operador && !respostaDoMorador,
      sistema: false,
      vinculoAtual: respostaDoMorador && vinculoAtual,
    });
    const aviso = (async () => {
      // O card dos outros moradores fecha antes de o do novo dono mudar de fase.
      if (respostaDoMorador && semDono && this.cardAoVivo) {
        await this.cardAoVivo.encerrarDeOutros('delivery', atualizado.id, this.idUsuario(user)).catch((e: any) =>
          this.logger.warn(`Card ao vivo do delivery ${atualizado.id} (outros moradores): ${e?.message ?? e}`),
        );
      }
      await this.avisarMorador(atualizado, statusGravado, comoMorador, respostaDoMorador, dto.motivo, outroRespondeu);
    })().catch((e: any) => this.logger.warn(`Aviso do delivery ${atualizado.id}: ${e?.message ?? e}`));
    await this.comTeto(Promise.all([gancho, aviso]));
    if (!isOperador(user)) return this.paraMorador(atualizado);
    // Pedido de autorização: a portaria precisa saber se alguém pode receber
    // (com 0, a tela manda interfonar em vez de esperar sem prazo).
    if (statusGravado === 'AGUARDANDO_AUTORIZACAO') {
      const avisados = await this.aparelhosAvisados(atualizado.id, atualizado.id_apartamento);
      if (avisados !== null) return { ...atualizado, avisados };
    }
    return atualizado;
  }

  // ─────────────────────────── autoatendimento no portão

  registrarGanchoPortao(g: GanchoPortao): void {
    this.ganchoPortao = g;
  }

  /**
   * Entregador pediu entrada pelo QR do portão. Reaproveita o aviso AGENDADA
   * mais recente da unidade que nunca teve pedido de portão; senão cria um de
   * origem 'autoatendimento', sem dono. Em qualquer caso deixa o atendimento
   * em AGUARDANDO_AUTORIZACAO. A portaria atendendo a unidade (CHEGOU ou
   * AGUARDANDO_AUTORIZACAO sem pedido de portão) → 409.
   *
   * `criarPedido`, quando dado, grava o pedido de portão na MESMA transação
   * e o liga ao atendimento (um pedido por atendimento, para sempre): quem
   * chama já está dentro do lock da unidade. Não avisa ninguém:
   * `vincularPedidoPortao` abre o card, uma vez, já com o pedido (selfie).
   */
  async registrarChegadaAutoatendimento<P extends { id: number }>(
    d: {
      idCondominio: number;
      idApartamento: number;
      nomeEntregador: string;
      plataforma: string | null;
    },
    criarPedido?: (tx: any, idAtendimento: number) => Promise<P>,
  ): Promise<{ id: number; criado: boolean; pedido: P | null }> {
    const db = (this.prisma as any).deliveryAtendimentos;
    const nome = d.nomeEntregador.trim() || null;
    await this.assertPortariaNaoAtendendo(d.idCondominio, d.idApartamento);
    const agoraMs = this.agora();
    // Corrida com a portaria/morador mudando o mesmo atendimento: relê e tenta de novo.
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const aberto = await db.findFirst({
        where: {
          id_condominio: d.idCondominio,
          id_apartamento: d.idApartamento,
          status: { in: [...REAPROVEITA_NA_CHEGADA] },
          // Atendimento que já teve pedido de portão nunca recebe outro.
          id_pedido_portao: null,
          pedidosPortao: { none: {} },
          // Aviso esquecido não recebe o entregador de hoje: criado há no
          // máximo 24 h e, com previsão de chegada, dentro de ±6 h dela.
          created_at: { gte: new Date(agoraMs - AVISO_REAPROVEITA_MS) },
          OR: [
            { previsao_em: null },
            { previsao_em: { gte: new Date(agoraMs - PREVISAO_TOLERANCIA_MS), lte: new Date(agoraMs + PREVISAO_TOLERANCIA_MS) } },
          ],
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });
      if (!aberto) break;
      const atual = aberto.status as DeliveryStatus;
      const agora = new Date();
      const gravou = await (this.prisma as any).$transaction(async (tx: any) => {
        const r = await tx.deliveryAtendimentos.updateMany({
          where: { id: aberto.id, status: atual, id_pedido_portao: null },
          data: {
            status: 'AGUARDANDO_AUTORIZACAO',
            chegou_em: agora,
            ...(!aberto.nome_entregador && nome ? { nome_entregador: nome } : {}),
          },
        });
        if (r.count !== 1) return null;
        const autor = { sistema: AUTOR_AUTOATENDIMENTO };
        await this.registrarEvento(tx, aberto.id, 'AGENDADA', 'CHEGOU', autor);
        await this.registrarEvento(tx, aberto.id, 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', autor);
        return { pedido: await this.ligarPedidoPortao(tx, aberto.id, criarPedido) };
      });
      if (gravou) return { id: aberto.id, criado: false, pedido: gravou.pedido };
    }

    const criado = await (this.prisma as any).$transaction(async (tx: any) => {
      const a = await tx.deliveryAtendimentos.create({
        data: {
          id_condominio: d.idCondominio,
          id_apartamento: d.idApartamento,
          id_morador_user: null,
          origem: 'autoatendimento',
          estabelecimento: d.plataforma?.trim() || null,
          nome_entregador: nome,
          modo_entrega: 'UNIDADE',
          status: 'AGUARDANDO_AUTORIZACAO',
          chegou_em: new Date(),
        },
      });
      const autor = { sistema: AUTOR_AUTOATENDIMENTO };
      await this.registrarEvento(tx, a.id, null, 'CHEGOU', autor);
      await this.registrarEvento(tx, a.id, 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', autor);
      return { a, pedido: await this.ligarPedidoPortao(tx, a.id, criarPedido) };
    });
    return { id: criado.a.id, criado: true, pedido: criado.pedido };
  }

  /**
   * A portaria já atende a unidade (atendimento CHEGOU/AGUARDANDO_AUTORIZACAO
   * que não veio do portão): o pedido do portão não entra nele → 409.
   */
  async assertPortariaNaoAtendendo(idCondominio: number, idApartamento: number): Promise<void> {
    const atendendo = await (this.prisma as any).deliveryAtendimentos.findFirst({
      where: {
        id_condominio: idCondominio,
        id_apartamento: idApartamento,
        status: { in: [...EM_ATENDIMENTO] },
        id_pedido_portao: null,
      },
      select: { id: true },
    });
    if (atendendo) throw new ConflictException(MSG_PORTARIA_ATENDENDO);
  }

  /** Cria o pedido (se pedido) e o liga ao atendimento, só se ele ainda não tiver um. */
  private async ligarPedidoPortao<P extends { id: number }>(
    tx: any,
    idAtendimento: number,
    criarPedido?: (tx: any, idAtendimento: number) => Promise<P>,
  ): Promise<P | null> {
    if (!criarPedido) return null;
    const pedido = await criarPedido(tx, idAtendimento);
    const ligado = await tx.deliveryAtendimentos.updateMany({
      where: { id: idAtendimento, id_pedido_portao: null },
      data: { id_pedido_portao: pedido.id },
    });
    if (ligado.count !== 1) throw new ConflictException(MSG_JA_TEM_PEDIDO);
    return pedido;
  }

  /**
   * Garante o pedido de portão do atendimento e abre o card, uma vez, já na
   * fase de autorização (com a selfie). O pedido de um atendimento nunca é
   * trocado: já ligado a outro → 409. O card vai a todos os vínculos atuais
   * da unidade, com ou sem dono (aviso reaproveitado). O aviso espera no
   * máximo TETO_AVISO_MS (a página do entregador não fica presa no APNs).
   */
  async vincularPedidoPortao(idAtendimento: number, idPedido: number): Promise<void> {
    const db = (this.prisma as any).deliveryAtendimentos;
    const id = Number(idAtendimento);
    const antes = await db.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException(`Atendimento de delivery ${id} não encontrado`);
    if (antes.id_pedido_portao == null) {
      const r = await db.updateMany({ where: { id, id_pedido_portao: null }, data: { id_pedido_portao: Number(idPedido) } });
      if (r.count !== 1) throw new ConflictException(MSG_JA_TEM_PEDIDO);
    } else if (Number(antes.id_pedido_portao) !== Number(idPedido)) {
      throw new ConflictException(MSG_JA_TEM_PEDIDO);
    }
    const registro = await db.findUnique({ where: { id } });
    const aviso = (async () => {
      let viaCard = false;
      if (this.cardAoVivo) {
        try {
          // Todos os vínculos ATUAIS, também no aviso reaproveitado: quem
          // pode liberar vê a selfie (o dono que se mudou não recebe).
          const destinos = await this.vinculosDaUnidade(registro.id_apartamento);
          await this.cardAoVivo.abrirDelivery(await this.atendimentoParaCard(registro.id), destinos);
          viaCard = true;
        } catch (e: any) {
          this.logger.warn(`Card ao vivo do delivery ${registro.id} (portão): ${e?.message ?? e}`);
        }
      }
      // Sem card: a notificação de hoje a todos os vínculos da unidade.
      if (!viaCard) await this.notificarMorador(registro.id_apartamento, null, 'AGUARDANDO_AUTORIZACAO', registro.id);
    })().catch((e: any) => this.logger.warn(`Aviso do delivery ${registro.id} (portão): ${e?.message ?? e}`));
    await this.comTeto(aviso);
  }

  /**
   * Transição feita pelo sistema (autor "Sistema"): as de TRANSICOES e, só
   * aqui, CHEGOU/AGUARDANDO_AUTORIZACAO → CANCELADA. CANCELADA usa a
   * `mensagem` como motivo. Devolve false quando o status já tinha mudado
   * (ou a transição não existe). O card acompanha; cancelamento pelo sistema
   * não manda a notificação comum ("cancelado pela portaria" seria falso).
   */
  async transicionarPeloSistema(
    idAtendimento: number,
    statusNovo: DeliveryStatus,
    mensagem: string,
    opcoes: {
      /** Só transiciona a partir deste status (o atendimento pode ter mudado depois da consulta da rotina). */
      somenteDe?: DeliveryStatus;
      /** Não espera o card/aviso (nem o teto): a rotina em lote não fica presa no APNs/FCM. */
      semEsperarAviso?: boolean;
      /**
       * Não manda a notificação comum (o card ainda acompanha até o fim). A
       * rotina das 24 h usa: "Sua entrega foi concluída." um dia depois só confunde.
       */
      semNotificacaoComum?: boolean;
    } = {},
  ): Promise<boolean> {
    const { somenteDe } = opcoes;
    const atendimento = await (this.prisma as any).deliveryAtendimentos.findUnique({ where: { id: Number(idAtendimento) } });
    if (!atendimento) return false;
    const statusAtual = atendimento.status as DeliveryStatus;
    if (somenteDe && statusAtual !== somenteDe) return false;
    const permitida =
      TRANSICOES[statusAtual]?.includes(statusNovo) || TRANSICOES_DO_SISTEMA[statusAtual]?.includes(statusNovo);
    if (!permitida) return false;
    const agora = new Date();
    const data: any = {
      status: statusNovo,
      ...(statusNovo === 'CANCELADA' && { motivo: mensagem, cancelado_em: agora }),
      ...(statusNovo === 'CONCLUIDA' && { concluido_em: agora }),
      ...(statusNovo === 'AUTORIZADA' && { autorizado_em: agora }),
      ...(statusNovo === 'RECUSADA' && { motivo: mensagem, recusado_em: agora }),
    };
    const atualizado = await (this.prisma as any).$transaction(async (tx: any) => {
      const r = await tx.deliveryAtendimentos.updateMany({ where: { id: atendimento.id, status: statusAtual }, data });
      if (r.count !== 1) return null;
      await this.registrarEvento(tx, atendimento.id, statusAtual, statusNovo, { sistema: AUTOR_SISTEMA }, mensagem);
      return tx.deliveryAtendimentos.findUnique({ where: { id: atendimento.id } });
    });
    if (!atualizado) return false;
    const gancho = this.chamarGancho(atualizado, statusNovo, { idUser: null, operador: false, sistema: true });
    const aviso = this.avisarMorador(atualizado, statusNovo, false, false, data.motivo, null, {
      semNotificacaoComum: statusNovo === 'CANCELADA' || !!opcoes.semNotificacaoComum,
    }).catch((e: any) => this.logger.warn(`Aviso do delivery ${atualizado.id}: ${e?.message ?? e}`));
    // Ambos nunca rejeitam; em lote seguem em segundo plano.
    if (!opcoes.semEsperarAviso) await this.comTeto(Promise.all([gancho, aviso]));
    return true;
  }

  /**
   * Aviso do morador (AGENDADA) cujo entregador não chegou: CANCELADA com
   * motivo "Sem chegada" 24 h depois da previsão ou, sem previsão, da
   * criação. Chamado pela rotina periódica do delivery (DeliveryPortaoService.tick).
   * Pelo sistema: entra na linha do tempo e não manda a notificação comum de
   * cancelamento. Os demais status não são encerrados aqui (o atendimento da
   * portaria parado é de encerrarParadosDaPortaria). Devolve quantos
   * cancelou; um que falha não impede os outros.
   */
  async cancelarAvisosSemChegada(): Promise<number> {
    const corte = new Date(this.agora() - AVISO_SEM_CHEGADA_MS);
    const lista = (await (this.prisma as any).deliveryAtendimentos.findMany({
      // Status primeiro: AGENDADA é um conjunto pequeno (a própria rotina o
      // esvazia), e o índice da tabela (id_condominio, status, created_at)
      // tem o status logo depois do condomínio.
      where: {
        status: 'AGENDADA',
        OR: [{ previsao_em: { lte: corte } }, { previsao_em: null, created_at: { lte: corte } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: LOTE_SEM_CHEGADA,
    })) as { id: number }[];
    let cancelados = 0;
    for (const a of lista) {
      try {
        const ok = await this.transicionarPeloSistema(a.id, 'CANCELADA', MOTIVO_SEM_CHEGADA, {
          somenteDe: 'AGENDADA',
          semEsperarAviso: true,
        });
        if (ok) cancelados++;
      } catch (e: any) {
        this.logger.warn(`Aviso de delivery ${a.id} sem chegada: ${e?.message ?? e}`);
      }
    }
    return cancelados;
  }

  /**
   * Atendimento da portaria (sem pedido de portão) parado há PARADO_PORTARIA_MS
   * (pelo updated_at): AUTORIZADA/RETIRADA_NA_PORTARIA → CONCLUIDA
   * ("Encerrado automaticamente"); CHEGOU/AGUARDANDO_AUTORIZACAO → CANCELADA
   * com motivo "Sem resposta". Com pedido de portão valem as regras de 2 h do
   * portão; AGENDADA é de cancelarAvisosSemChegada. Chamado pela rotina
   * periódica (DeliveryPortaoService.tick), em lote, sem esperar card/aviso.
   * Sem a notificação comum (o card vai ao estado final). Devolve quantos mudaram; um que falha não impede os outros.
   */
  async encerrarParadosDaPortaria(): Promise<number> {
    const corte = new Date(this.agora() - PARADO_PORTARIA_MS);
    const lista = (await (this.prisma as any).deliveryAtendimentos.findMany({
      where: {
        id_pedido_portao: null,
        status: { in: Object.keys(DESTINO_PARADO_PORTARIA) },
        updated_at: { lte: corte },
      },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
      take: LOTE_SEM_CHEGADA,
    })) as { id: number; status: DeliveryStatus }[];
    let mudados = 0;
    for (const a of lista) {
      const destino = DESTINO_PARADO_PORTARIA[a.status];
      if (!destino) continue;
      try {
        const ok = await this.transicionarPeloSistema(a.id, destino.status, destino.mensagem, {
          somenteDe: a.status,
          semEsperarAviso: true,
          semNotificacaoComum: true,
        });
        if (ok) mudados++;
      } catch (e: any) {
        this.logger.warn(`Delivery ${a.id} parado na portaria: ${e?.message ?? e}`);
      }
    }
    return mudados;
  }

  /**
   * O pedido de portão do atendimento venceu sem resposta (rotina, consulta
   * da página, pedido novo da unidade ou resposta tarde do morador): o card
   * que pede a liberação vai ao estado final "Entregador não esperou" e
   * encerra. Melhor esforço; nunca rejeita.
   */
  async aoVencerPedidoPortao(idAtendimento: number): Promise<void> {
    if (!this.cardAoVivo) return;
    try {
      await this.cardAoVivo.entregadorNaoEsperou(await this.atendimentoParaCard(Number(idAtendimento)));
    } catch (e: any) {
      this.logger.warn(`Card ao vivo do delivery ${idAtendimento} (pedido vencido): ${e?.message ?? e}`);
    }
  }

  /** Chama o gancho do portão, se houver; nunca rejeita. */
  private async chamarGancho(registro: any, statusNovo: DeliveryStatus, quem: QuemMudou): Promise<void> {
    if (!this.ganchoPortao) return;
    try {
      await this.ganchoPortao.aoMudarStatus(
        { id: registro.id, origem: registro.origem ?? 'portaria', id_pedido_portao: registro.id_pedido_portao ?? null },
        statusNovo,
        quem,
      );
    } catch (e: any) {
      this.logger.warn(`Gancho do portão no delivery ${registro.id}: ${e?.message ?? e}`);
    }
  }

  /** Espera `p` no máximo TETO_AVISO_MS; passado o teto, ele segue em segundo plano. */
  private async comTeto(p: Promise<unknown>): Promise<void> {
    let teto: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      p,
      new Promise<void>((r) => {
        teto = setTimeout(r, TETO_AVISO_MS);
        (teto as any)?.unref?.();
      }),
    ]);
    if (teto) clearTimeout(teto);
  }

  /** Users.id de todos os vínculos do apartamento (qualquer tipo), sem repetir. */
  private async vinculosDaUnidade(idApartamento: number): Promise<number[]> {
    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: idApartamento },
      select: { id_user: true },
    });
    return [...new Set((vinculos as any[]).map((v) => v.id_user).filter((id) => !!id))];
  }

  /** Pedido de portão ativo do atendimento (ou null). */
  private async pedidoAtivo(idPedido: number | null | undefined): Promise<any | null> {
    if (!idPedido) return null;
    return (this.prisma as any).deliveryPedidosPortao.findUnique({ where: { id: Number(idPedido) } });
  }

  /**
   * Quantos aparelhos (tokens distintos) receberam o pedido de autorização:
   * os dos moradores com vínculo na unidade — o criador incluído só se ainda
   * tiver vínculo — e os que estão com o card do atendimento aberto (inclui
   * o criador desvinculado que acompanha pelo card). Contado depois do aviso
   * (que espera no máximo TETO_AVISO_MS). Falha na contagem → null (a
   * resposta sai sem o campo).
   */
  private async aparelhosAvisados(idAtendimento: number, idApartamento: number): Promise<number | null> {
    try {
      const vinculos = await this.prisma.apartamentos_Users.findMany({
        where: { id_apto: idApartamento },
        select: { id_user: true, user: { select: { fcm_token: true } } },
      });
      const tokens = new Set<string>();
      for (const v of vinculos as any[]) if (v.user?.fcm_token) tokens.add(v.user.fcm_token);
      if (this.cardAoVivo) {
        const cards = await (this.prisma as any).cards_Ao_Vivo.findMany({
          where: { origem: 'delivery', id_pedido: Number(idAtendimento), encerrado_em: null },
          select: { fcm_token: true },
        });
        for (const c of cards as any[]) if (c.fcm_token) tokens.add(c.fcm_token);
      }
      return tokens.size;
    } catch (e: any) {
      this.logger.warn(`Contagem de quem recebeu o pedido do delivery: ${e?.message ?? e}`);
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

  private async registrarEvento(db: any, idAtendimento: number, anterior: DeliveryStatus | null, novo: DeliveryStatus, autor: AutorEvento, mensagem?: string) {
    const sistema = 'sistema' in autor ? autor.sistema : null;
    const user = autor as JwtPayload;
    return db.deliveryEventos.create({
      data: {
        id_atendimento: idAtendimento,
        status_anterior: anterior,
        status_novo: novo,
        id_usuario_autor: sistema ? null : idUsuarioDoToken(user),
        autor_nome: sistema ?? user.nome ?? user.user?.name ?? null,
        mensagem: mensagem?.trim() || null,
      },
    });
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
    opts: { semNotificacaoComum?: boolean } = {},
  ) {
    const notificavel =
      !opts.semNotificacaoComum &&
      !respostaDoMorador &&
      (['CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'CONCLUIDA', 'RECUSADA', 'RETIRADA_NA_PORTARIA'].includes(statusNovo) ||
        // Cancelamento pela portaria; o do próprio morador não volta a ele.
        (statusNovo === 'CANCELADA' && !acaoDoMorador));
    // Sem dono (autoatendimento do portão): o card acompanha em todos os vínculos.
    const dono: number | null = registro.id_morador_user ?? null;
    let cobertos = new Set<string>();
    let viaCard = false;
    if (this.cardAoVivo) {
      try {
        const atendimento = await this.atendimentoParaCard(registro.id);
        // Só vínculos ATUAIS (o dono que se mudou não recebe o card). Com dono,
        // o card vai só a ele, também no pedido do portão: os cards dos outros
        // foram fechados quando ele respondeu e não reabrem.
        const vinculos = await this.vinculosDaUnidade(registro.id_apartamento);
        const destinos: number | number[] | null = dono ? (vinculos.includes(dono) ? dono : null) : vinculos.length ? vinculos : null;
        if (destinos === null) {
          // sem destino: nada a abrir; o aviso comum (que também confere o vínculo) segue abaixo
        } else if (statusNovo === 'CHEGOU') {
          await this.cardAoVivo.abrirDelivery(atendimento, destinos);
          viaCard = true;
        } else {
          // "Você" no card vale pela unidade: outro morador respondendo também conta.
          const r = await this.cardAoVivo.atualizarDelivery(atendimento, destinos, {
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
    // Sem dono, todos já foram avisados acima.
    if (statusNovo === 'AGUARDANDO_AUTORIZACAO' && dono) {
      await this.notificarOutrosDaUnidade(registro.id_apartamento, dono, registro.id).catch((e: any) =>
        this.logger.warn(`Aviso do delivery ${registro.id} aos outros moradores: ${e?.message ?? e}`),
      );
    }
    // Resposta de outro morador: quem criou recebe a notificação dizendo quem
    // respondeu, mesmo com card (o card só diz "Você", pela unidade).
    if (outroRespondeu && dono) {
      const texto = statusNovo === 'AUTORIZADA'
        ? `${outroRespondeu} autorizou a subida do entregador.`
        : statusNovo === 'RETIRADA_NA_PORTARIA'
          ? `${outroRespondeu} vai buscar a entrega na portaria.`
          : `${outroRespondeu} recusou a entrega.`;
      await this.notificarMorador(registro.id_apartamento, dono, statusNovo, registro.id, motivo, new Set(), texto);
      return;
    }
    if (!notificavel || viaCard) return;
    await this.notificarMorador(registro.id_apartamento, dono, statusNovo, registro.id, motivo, cobertos);
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
    // Pedido do entregador no portão: nome, plataforma e selfie vêm dele.
    const pedido = await this.pedidoAtivo(a.id_pedido_portao);
    if (pedido) {
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
        entregadorNome: pedido.nome ?? null,
        entregadorPlataforma: pedido.plataforma ?? null,
        fotoEntregador: pedido.foto ?? null,
        portao: pedido.status === 'pendente',
      };
    }
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
    /** null = atendimento sem dono (autoatendimento): todos os vínculos da unidade. */
    idMorador: number | null,
    status: DeliveryStatus,
    idAtendimento: number,
    motivo?: string,
    cobertos: Set<string> = new Set(),
    texto?: string,
  ) {
    if (idMorador == null) {
      const vinculos = await this.prisma.apartamentos_Users.findMany({
        where: { id_apto: idApartamento },
        select: { id_user: true, user: { select: { fcm_token: true } } },
      });
      const tokens = new Set<string>();
      for (const v of vinculos as any[]) if (v.user?.fcm_token && !cobertos.has(v.user.fcm_token)) tokens.add(v.user.fcm_token);
      for (const token of tokens) {
        await this.notifications.sendPushNotification(token, 'Delivery', texto ?? mensagemDelivery(status, motivo), { id_delivery: String(idAtendimento), status });
      }
      return;
    }
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
      id_pedido_portao: _idPedidoPortao,
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
