import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { FacialService } from '../../facial/facial.service';
import { PREFIXOS_FOTO_PEDIDO_PORTAO, StorageService } from '../../common/storage/storage.service';
import { comLock, executarComLock } from '../../common/lock-distribuido';
import { DeliveryService, DeliveryStatus, GanchoPortao } from '../delivery.service';
import { TenantAccessService } from '../../auth/tenant-access.service';
import type { JwtPayload } from '../../auth/jwt-payload.interface';
import { assertOperador, assertSindicoEstrito, assertTenantStrict } from '../../auth/tenant.util';
import {
  CANCELA_SEM_RESPOSTA_MS,
  CONCLUI_SEM_PORTEIRO_MS,
  EstadoPedido,
  FOTO_RETENCAO_DIAS,
  horarioValido,
  FOTO_MIME,
  JANELA_ABERTURA_MS,
  MAX_FOTO_BYTES,
  MAX_PEDIDOS_PORTAO_10MIN,
  MAX_PEDIDOS_UNIDADE_HORA,
  PEDIDO_EXPIRA_MS,
  PRESENCA_MS,
  SAIDA_APOS_ENTRADA_MS,
  SAIDA_MS,
  TREGUA_UNIDADE_MS,
  dentroDoHorario,
  estadoDoPedido,
  hashToken,
  novoToken,
} from './portao-regras';
import { conferirSelfie } from './selfie';

/**
 * Autoatendimento de entregas no portão
 * (spec docs/superpowers/specs/2026-11-13-entregador-autoatendimento-portao-design.md).
 *
 * O entregador lê o QR fixo do portão (`Facial_Devices.token_entrega`),
 * escolhe a unidade, tira uma selfie e pede a entrada. Cada página aberta é
 * um pedido (`DeliveryPedidosPortao`), identificado pelo token que só a
 * página guarda (no banco, o hash). O morador responde pelo card; liberado,
 * abre o portão DO PEDIDO (`id_device`), uma vez, dentro da janela.
 *
 * Nada que sai daqui para a página tem nome, telefone ou id de morador, nem
 * a selfie.
 */

export interface PortaoPublico {
  condominio: string;
  portao: string;
  disponivel: boolean;
  motivo?: 'desligado' | 'fora_horario';
  horario?: { inicio: string; fim: string };
  /** Vazio quando indisponível. */
  unidades: { id: number; bloco: string | null; apto: string | null }[];
}

const MSG_PORTAO = 'QR de entregas indisponível.';
const MSG_INDISPONIVEL = 'Autoatendimento de entregas indisponível agora.';
const MSG_PEDIDO = 'Pedido não encontrado.';
const MSG_FORMATO = 'Envie uma foto em JPEG, PNG ou WebP.';
const JANELA_LIMITE_PORTAO_MS = 10 * 60_000;
const MSG_LIMITE_PORTAO = 'Muitos pedidos neste portão. Aguarde alguns minutos.';
const MSG_TREGUA = 'Esta unidade já recusou uma entrega há pouco. Procure a portaria.';
const MSG_TETO_UNIDADE = 'Muitas entregas para esta unidade agora. Procure a portaria.';
/** Token do QR do portão (48 hex no gerado; tolerante a tamanho, mas sem caracteres de caminho). */
const TOKEN_PORTAO = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_PEDIDO = /^[0-9a-f]{64}$/;
/** Aparelhos que abrem passagem (o leitor de tag/QR/placa só identifica). */
const TIPOS_QUE_ABREM = ['botoeira', 'catraca', 'facial'];
const BASE_URL_PADRAO = 'https://www.prestarecondominios.com.br';
const ROTINA_MS = 5 * 60_000;
const DIA_MS = 24 * 3_600_000;
/** O lock com intervaloMinimoMs garante uma passada por dia no cluster. */
const FOTOS_VERIFICA_MS = 3_600_000;
const LOTE_ROTINA = 200;
const LOTE_FOTOS = 500;

export interface ConfigEntrega {
  habilitado: boolean;
  inicio: string | null;
  fim: string | null;
}

function paraConfig(c: { delivery_autoatendimento: unknown; delivery_auto_inicio: string | null; delivery_auto_fim: string | null }): ConfigEntrega {
  return { habilitado: !!c.delivery_autoatendimento, inicio: c.delivery_auto_inicio ?? null, fim: c.delivery_auto_fim ?? null };
}

function idPositivo(v: unknown, msg: string): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(msg);
  return id;
}

/** Mesma base dos links públicos do convite e do passe. */
function baseUrlPublica(): string {
  return (process.env.CONVITE_BASE_URL ?? '').trim().replace(/\/+$/, '') || BASE_URL_PADRAO;
}

type Portao = {
  id: number;
  id_condominio: number;
  nome: string;
  condominio: {
    id: number;
    nome: string;
    delivery_autoatendimento: boolean;
    delivery_auto_inicio: string | null;
    delivery_auto_fim: string | null;
  };
};

@Injectable()
export class DeliveryPortaoService implements GanchoPortao, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryPortaoService.name);
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();
  private tickInterval?: ReturnType<typeof setInterval>;
  private fotosInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly facial: FacialService,
    private readonly storage: StorageService,
    private readonly tenant: TenantAccessService,
  ) {
    // Mão única: o DeliveryService só conhece o gancho.
    this.delivery.registrarGanchoPortao(this);
  }

  /**
   * Rotina no padrão da API (setInterval + executarComLock, uma instância
   * por vez): a cada 5 min (com uma hora, a conclusão dos 30 min poderia
   * levar 90) e as fotos uma vez por dia no cluster.
   */
  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.tickInterval = setInterval(
      () => void executarComLock(this.prisma, 'delivery-portao:tick', () => this.tick()),
      ROTINA_MS,
    );
    this.tickInterval.unref?.();
    this.fotosInterval = setInterval(
      () =>
        void executarComLock(this.prisma, 'delivery-portao:fotos', async () => void (await this.tickFotos()), {
          intervaloMinimoMs: DIA_MS,
        }),
      FOTOS_VERIFICA_MS,
    );
    this.fotosInterval.unref?.();
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.fotosInterval) clearInterval(this.fotosInterval);
  }

  /**
   * 1. pedido pendente vencido → expirado;
   * 2. autoatendimento sem resposta há 2 h → CANCELADA ("Sem resposta do morador");
   * 3. AUTORIZADA com o portão aberto há 30 min → CONCLUIDA;
   * 4. autoatendimento AUTORIZADA sem abertura, ou RETIRADA_NA_PORTARIA, parado há 2 h → CONCLUIDA.
   * Uma etapa (ou um atendimento) que falha não impede as outras.
   */
  async tick(): Promise<void> {
    const agora = this.agora();
    const db = (this.prisma as any).deliveryPedidosPortao;
    const atendimentos = (this.prisma as any).deliveryAtendimentos;

    await this.etapa('expirar pedidos', () =>
      db.updateMany({ where: { status: 'pendente', expira_em: { lte: new Date(agora) } }, data: { status: 'expirado' } }),
    );

    await this.etapa('cancelar sem resposta', async () => {
      const lista = await atendimentos.findMany({
        where: {
          origem: 'autoatendimento',
          status: { in: ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'] },
          chegou_em: { lte: new Date(agora - CANCELA_SEM_RESPOSTA_MS) },
        },
        select: { id: true },
        take: LOTE_ROTINA,
      });
      await this.transicionarCada(lista, 'CANCELADA', 'Sem resposta do morador');
    });

    await this.etapa('concluir após a entrada', async () => {
      const abertos = await db.findMany({
        where: { aberto_em: { lte: new Date(agora - SAIDA_MS) }, atendimento: { status: 'AUTORIZADA' } },
        select: { id_atendimento: true },
        take: LOTE_ROTINA,
      });
      const ids = [...new Set((abertos as any[]).map((p) => p.id_atendimento))].map((id) => ({ id }));
      await this.transicionarCada(ids, 'CONCLUIDA', 'Concluído automaticamente após a entrada');
    });

    await this.etapa('encerrar sem porteiro', async () => {
      const lista = await atendimentos.findMany({
        where: {
          origem: 'autoatendimento',
          status: { in: ['AUTORIZADA', 'RETIRADA_NA_PORTARIA'] },
          updated_at: { lte: new Date(agora - CONCLUI_SEM_PORTEIRO_MS) },
        },
        select: { id: true, status: true, pedidosPortao: { where: { aberto_em: { not: null } }, select: { id: true }, take: 1 } },
        take: LOTE_ROTINA,
      });
      // Autorizado com o portão aberto é da etapa anterior (30 min).
      const semAbertura = (lista as any[]).filter((a) => a.status !== 'AUTORIZADA' || !a.pedidosPortao?.length);
      await this.transicionarCada(semAbertura, 'CONCLUIDA', 'Encerrado automaticamente');
    });
  }

  /**
   * Selfies com mais de `dias`: apaga do bucket (só dentro de
   * delivery-portao/) e zera a coluna. Lotes de 500 por id; arquivo que falha
   * fica para a próxima passada e não interrompe o lote.
   */
  async tickFotos(dias = FOTO_RETENCAO_DIAS): Promise<number> {
    const limite = new Date(this.agora() - dias * DIA_MS);
    const db = (this.prisma as any).deliveryPedidosPortao;
    let cursor = 0;
    let apagadas = 0;
    for (;;) {
      const lote = await db.findMany({
        where: { id: { gt: cursor }, criado_em: { lt: limite }, foto: { not: null } },
        select: { id: true, foto: true },
        orderBy: { id: 'asc' },
        take: LOTE_FOTOS,
      });
      if (!lote.length) break;
      for (const p of lote as { id: number; foto: string }[]) {
        cursor = p.id;
        try {
          if (!(await this.storage.deleteUrl(p.foto, PREFIXOS_FOTO_PEDIDO_PORTAO))) continue;
          await db.update({ where: { id: p.id }, data: { foto: null } });
          apagadas++;
        } catch (e: any) {
          this.logger.warn(`Foto do pedido de portão ${p.id} não apagada: ${e?.message ?? e}`);
        }
      }
      if (lote.length < LOTE_FOTOS) break;
    }
    return apagadas;
  }

  private async etapa(nome: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e: any) {
      this.logger.warn(`Rotina do portão (${nome}): ${e?.message ?? e}`);
    }
  }

  private async transicionarCada(lista: { id: number }[], status: DeliveryStatus, mensagem: string) {
    for (const a of lista) {
      try {
        await this.delivery.transicionarPeloSistema(a.id, status, mensagem);
      } catch (e: any) {
        this.logger.warn(`Rotina do portão: delivery ${a.id} → ${status}: ${e?.message ?? e}`);
      }
    }
  }

  // ─────────────────────────────────────────── página pública

  async lerPortao(token: string): Promise<PortaoPublico> {
    const portao = await this.carregarPortao(token);
    const c = portao.condominio;
    const horario =
      c.delivery_auto_inicio && c.delivery_auto_fim ? { inicio: c.delivery_auto_inicio, fim: c.delivery_auto_fim } : null;
    const base = { condominio: c.nome, portao: portao.nome };
    const motivo = this.motivoIndisponivel(portao);
    if (motivo) {
      return { ...base, disponivel: false, motivo, ...(motivo === 'fora_horario' && horario ? { horario } : {}), unidades: [] };
    }
    const unidades = await this.prisma.apartamentos.findMany({
      where: { id_condominio: portao.id_condominio },
      select: { id: true, bloco: true, apto: true },
    });
    return {
      ...base,
      disponivel: true,
      ...(horario ? { horario } : {}),
      unidades: (unidades as any[])
        .map((u) => ({ id: u.id, bloco: u.bloco ?? null, apto: u.apto ?? null }))
        .sort((a, b) => {
          const bloco = (a.bloco ?? '').localeCompare(b.bloco ?? '', 'pt-BR', { numeric: true });
          return bloco || (a.apto ?? '').localeCompare(b.apto ?? '', 'pt-BR', { numeric: true });
        }),
    };
  }

  async criarPedido(
    token: string,
    d: { id_apartamento: unknown; nome: unknown; plataforma?: unknown; foto: unknown },
  ): Promise<EstadoPedido & { pedido: string }> {
    const portao = await this.carregarPortao(token);
    if (this.motivoIndisponivel(portao)) throw new ForbiddenException(MSG_INDISPONIVEL);

    // Tudo validado antes de gravar qualquer coisa.
    const idApartamento = Number(d?.id_apartamento);
    if (typeof d?.id_apartamento === 'boolean' || !Number.isInteger(idApartamento) || idApartamento <= 0) {
      throw new BadRequestException('Unidade inválida.');
    }
    const apto = await this.prisma.apartamentos.findUnique({ where: { id: idApartamento }, select: { id_condominio: true } });
    if (!apto || apto.id_condominio !== portao.id_condominio) throw new BadRequestException('Unidade inválida.');
    const nome = typeof d?.nome === 'string' ? d.nome.trim().replace(/\s+/g, ' ') : '';
    if (nome.length < 2 || nome.length > 80) throw new BadRequestException('Informe seu nome.');
    const plataforma = typeof d?.plataforma === 'string' ? d.plataforma.trim().slice(0, 40) || null : null;
    const foto = typeof d?.foto === 'string' ? d.foto.trim() : '';
    if (!foto || /^data:[^,]*,\s*$/.test(foto)) throw new BadRequestException('Envie uma foto do seu rosto.');
    if (!FOTO_MIME.test(foto)) throw new BadRequestException(MSG_FORMATO);
    if (foto.length > MAX_FOTO_BYTES) throw new BadRequestException('Foto muito grande. Tente novamente.');
    // O prefixo é só o que a página diz: os bytes são decodificados.
    const selfie = await conferirSelfie(foto);
    if (selfie === 'sem_conferencia') throw new ServiceUnavailableException('Não foi possível conferir a foto. Tente novamente.');
    if (selfie !== 'ok') throw new BadRequestException(MSG_FORMATO);

    const agora = new Date(this.agora());
    // Limite do portão contado no banco dentro do lock do portão (duas
    // instâncias não passam as duas com 19). Ordem fixa portão → unidade:
    // sem espera circular.
    const r = await comLock(
      this.prisma,
      `delivery-portao:portao:${portao.id}`,
      async () => {
        const recentes = await (this.prisma as any).deliveryPedidosPortao.count({
          where: { id_device: portao.id, criado_em: { gte: new Date(agora.getTime() - JANELA_LIMITE_PORTAO_MS) } },
        });
        if (recentes >= MAX_PEDIDOS_PORTAO_10MIN) throw new HttpException(MSG_LIMITE_PORTAO, 429);
        // Um pedido pendente por unidade: dois entregadores no mesmo segundo,
        // em duas instâncias da API, só um passa (o outro espera e vê o pendente).
        const u = await comLock(
          this.prisma,
          `delivery-portao:apto:${idApartamento}`,
          () => this.gravarPedido(portao, idApartamento, nome, plataforma, foto, agora),
          { esperaSegundos: 5, duracaoMaximaMs: 60_000 },
        );
        if (!u.obtido) throw new ConflictException('Já há uma entrega aguardando esta unidade. Tente em alguns minutos.');
        return u.valor;
      },
      { esperaSegundos: 10, duracaoMaximaMs: 90_000 },
    );
    if (!r.obtido) throw new HttpException(MSG_LIMITE_PORTAO, 429);
    const { pedido, tokenPedido } = r.valor;
    // Já ligado dentro do lock; aqui só abre o card (fora do lock: o APNs não segura a unidade).
    await this.delivery.vincularPedidoPortao(pedido.id_atendimento, pedido.id);
    // O token em claro sai uma única vez.
    return { ...estadoDoPedido(pedido, agora), pedido: tokenPedido };
  }

  private async gravarPedido(portao: Portao, idApartamento: number, nome: string, plataforma: string | null, foto: string, agora: Date) {
    const db = (this.prisma as any).deliveryPedidosPortao;
    // Vencido não bloqueia a unidade.
    await db.updateMany({
      where: { status: 'pendente', expira_em: { lte: agora }, atendimento: { id_apartamento: idApartamento } },
      data: { status: 'expirado' },
    });
    const pendente = await db.findFirst({
      where: { status: 'pendente', expira_em: { gt: agora }, atendimento: { id_apartamento: idApartamento } },
      select: { id: true },
    });
    if (pendente) throw new ConflictException('Já há uma entrega aguardando esta unidade. Tente em alguns minutos.');
    // Contados no banco, dentro do lock da unidade (vale com várias instâncias).
    const daUnidade = { atendimento: { id_apartamento: idApartamento } };
    const recusouHaPouco = await db.count({
      where: {
        ...daUnidade,
        status: { in: ['recusado', 'vou_buscar'] },
        respondido_em: { gte: new Date(agora.getTime() - TREGUA_UNIDADE_MS) },
      },
    });
    if (recusouHaPouco > 0) throw new HttpException(MSG_TREGUA, 429);
    const naHora = await db.count({ where: { ...daUnidade, criado_em: { gte: new Date(agora.getTime() - 3_600_000) } } });
    if (naHora >= MAX_PEDIDOS_UNIDADE_HORA) throw new HttpException(MSG_TETO_UNIDADE, 429);
    // Antes de subir a foto: a portaria atendendo a unidade recusa o pedido.
    await this.delivery.assertPortariaNaoAtendendo(portao.id_condominio, idApartamento);

    // Atendimentos da unidade ainda abertos cujo pedido de portão venceu sem
    // resposta: o pedido novo nunca entra neles (um pedido por atendimento);
    // eles são cancelados depois que o novo estiver gravado.
    const semResposta = (await (this.prisma as any).deliveryAtendimentos.findMany({
      where: {
        id_condominio: portao.id_condominio,
        id_apartamento: idApartamento,
        status: { in: ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'] },
        id_pedido_portao: { not: null },
      },
      select: { id: true },
    })) as { id: number }[];

    const url = await this.storage.uploadDataUrl(foto, 'delivery-portao');
    if (!url) throw new BadRequestException(MSG_FORMATO);
    // Storage fora devolve a própria data URL: não cabe na coluna e não é privado.
    if (url.startsWith('data:')) throw new ServiceUnavailableException('Não foi possível guardar a foto. Tente novamente.');
    const tokenPedido = novoToken();
    let chegada: { id: number; pedido: any };
    try {
      // Pedido criado e ligado ao atendimento na mesma transação, dentro do lock da unidade.
      chegada = await this.delivery.registrarChegadaAutoatendimento(
        { idCondominio: portao.id_condominio, idApartamento, nomeEntregador: nome, plataforma },
        (tx, idAtendimento) =>
          tx.deliveryPedidosPortao.create({
            data: {
              id_atendimento: idAtendimento,
              id_device: portao.id,
              nome,
              plataforma,
              foto: url,
              token_hash: hashToken(tokenPedido),
              status: 'pendente',
              visto_em: agora,
              criado_em: agora,
              expira_em: new Date(agora.getTime() + PEDIDO_EXPIRA_MS),
            },
          }),
      );
    } catch (e) {
      await this.storage.deleteUrl(url, PREFIXOS_FOTO_PEDIDO_PORTAO).catch(() => false);
      throw e;
    }
    for (const a of semResposta) {
      if (a.id === chegada.id) continue;
      await this.delivery
        .transicionarPeloSistema(a.id, 'CANCELADA', 'Sem resposta do morador')
        .catch((e: any) => this.logger.warn(`Cancelamento do delivery ${a.id} sem resposta: ${e?.message ?? e}`));
    }
    return { pedido: chegada.pedido, tokenPedido };
  }

  /** A página consulta a cada poucos segundos (é a presença do entregador). */
  async consultar(token: string, tokenPedido: string): Promise<EstadoPedido & { falha_abertura: boolean }> {
    const { portao, pedido } = await this.carregarPedido(token, tokenPedido);
    const agora = new Date(this.agora());
    const atual = await this.marcarVisto(pedido, agora);
    return { ...this.estadoPublico(portao, atual, agora), falha_abertura: !!atual.falha_abertura_em && !atual.aberto_em };
  }

  /** Botão "Abrir portão" (a página voltou depois de o morador liberar). */
  async abrir(token: string, tokenPedido: string): Promise<EstadoPedido & { abriu: boolean }> {
    const { portao, pedido } = await this.carregarPedido(token, tokenPedido);
    const agora = new Date(this.agora());
    await this.marcarVisto(pedido, agora);
    // Opção desligada ou fora do horário: nada abre dali em diante.
    if (this.motivoIndisponivel(portao)) throw new ForbiddenException(MSG_INDISPONIVEL);
    const abriu = await this.abrirEntrada(pedido, agora);
    const atual = await this.relerPedido(pedido.id);
    return { ...this.estadoPublico(portao, atual, agora), abriu };
  }

  /**
   * "Abrir para sair": uma vez, no mesmo aparelho, de 60 s a 30 min depois
   * da entrada CONFIRMADA (aberto_em). Conclui o atendimento.
   */
  async sair(token: string, tokenPedido: string): Promise<EstadoPedido & { abriu: boolean }> {
    const { portao, pedido } = await this.carregarPedido(token, tokenPedido);
    const agora = new Date(this.agora());
    await this.marcarVisto(pedido, agora);
    if (this.motivoIndisponivel(portao)) throw new ForbiddenException(MSG_INDISPONIVEL);
    const db = (this.prisma as any).deliveryPedidosPortao;
    const reserva = await db.updateMany({
      where: {
        id: pedido.id,
        status: 'liberado',
        aberto_em: { gte: new Date(agora.getTime() - SAIDA_MS), lte: new Date(agora.getTime() - SAIDA_APOS_ENTRADA_MS) },
        saida_aberta_em: null,
      },
      data: { saida_aberta_em: agora },
    });
    let abriu = false;
    if (reserva.count === 1) {
      const r = await this.facial.abrirDispositivoInterno(pedido.id_device, this.contextoAbertura(pedido));
      if (r.ok) {
        abriu = true;
        await this.delivery
          .transicionarPeloSistema(pedido.id_atendimento, 'CONCLUIDA', 'Concluído na saída do entregador')
          .catch((e: any) => this.logger.warn(`Conclusão do delivery ${pedido.id_atendimento} na saída: ${e?.message ?? e}`));
      } else {
        // Devolve a vez: o entregador pode tentar de novo.
        await db.update({ where: { id: pedido.id }, data: { saida_aberta_em: null, falha_abertura_em: agora } });
      }
    }
    const atual = await this.relerPedido(pedido.id);
    return { ...this.estadoPublico(portao, atual, agora), abriu };
  }

  /** Estado para a página; com a opção desligada ou fora do horário, nada a oferecer. */
  private estadoPublico(portao: Portao, pedido: any, agora: Date): EstadoPedido {
    const estado = estadoDoPedido(pedido, agora);
    return this.motivoIndisponivel(portao) ? { ...estado, pode_abrir: false, pode_sair: false } : estado;
  }

  // ─────────────────────────────────────────── configuração (síndico)

  async lerConfig(idCondominio: number, user: JwtPayload): Promise<ConfigEntrega> {
    const id = idPositivo(idCondominio, 'Condomínio inválido.');
    assertOperador(user, 'ler o autoatendimento de entregas');
    await this.tenant.assertCondominio(id, user);
    const c = await (this.prisma as any).condominios.findUnique({
      where: { id },
      select: { delivery_autoatendimento: true, delivery_auto_inicio: true, delivery_auto_fim: true },
    });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
    return paraConfig(c);
  }

  /** Liga/desliga e define o horário. Mexe em acesso físico: síndico pelo typeAccess. */
  async salvarConfig(
    idCondominio: number,
    d: { habilitado: unknown; inicio: unknown; fim: unknown },
    user: JwtPayload,
  ): Promise<ConfigEntrega> {
    const id = idPositivo(idCondominio, 'Condomínio inválido.');
    assertSindicoEstrito(user, 'alterar o autoatendimento de entregas');
    if (typeof d?.habilitado !== 'boolean') throw new BadRequestException('habilitado deve ser verdadeiro ou falso.');
    const semHorario = d.inicio == null && d.fim == null;
    if (!semHorario && !(horarioValido(d.inicio) && horarioValido(d.fim))) {
      throw new BadRequestException('Horário inválido. Use HH:MM.');
    }
    await this.tenant.assertCondominio(id, user);
    const c = await (this.prisma as any).condominios.update({
      where: { id },
      data: {
        delivery_autoatendimento: d.habilitado,
        delivery_auto_inicio: semHorario ? null : d.inicio,
        delivery_auto_fim: semHorario ? null : d.fim,
      },
      select: { delivery_autoatendimento: true, delivery_auto_inicio: true, delivery_auto_fim: true },
    });
    return paraConfig(c);
  }

  /**
   * Cria ou troca o token do QR de entregas do aparelho (trocar invalida a
   * folha antiga). Só aparelho que abre: botoeira, catraca ou o próprio
   * terminal facial.
   */
  async gerarTokenPortao(idDevice: number, user: JwtPayload): Promise<{ token: string; url: string }> {
    const device = await this.aparelhoDoSindico(idDevice, user, 'gerar o QR de entregas');
    if (!TIPOS_QUE_ABREM.includes(device.tipo)) throw new BadRequestException('Este tipo de aparelho não abre portão.');
    const token = randomBytes(24).toString('hex');
    await (this.prisma as any).facial_Devices.update({ where: { id: device.id }, data: { token_entrega: token } });
    // Na raiz, como o convite (`/?convite=`) e o passe (`/#passe=`): a
    // hospedagem da portaria-web (Amplify) não serve caminho profundo ao SPA.
    return { token, url: `${baseUrlPublica()}/?entrega=${token}` };
  }

  async removerTokenPortao(idDevice: number, user: JwtPayload): Promise<{ ok: true }> {
    const device = await this.aparelhoDoSindico(idDevice, user, 'desligar o QR de entregas');
    await (this.prisma as any).facial_Devices.update({ where: { id: device.id }, data: { token_entrega: null } });
    return { ok: true };
  }

  private async aparelhoDoSindico(idDevice: number, user: JwtPayload, contexto: string) {
    const id = idPositivo(idDevice, 'Aparelho inválido.');
    assertSindicoEstrito(user, contexto);
    const device = await (this.prisma as any).facial_Devices.findUnique({
      where: { id },
      select: { id: true, id_condominio: true, tipo: true },
    });
    if (!device) throw new NotFoundException(`Terminal ${id} não encontrado`);
    assertTenantStrict(device.id_condominio, user, `aparelho #${id}`);
    return device as { id: number; id_condominio: number; tipo: string };
  }

  // ─────────────────────────────────────────── gancho do DeliveryService

  async aoMudarStatus(
    atendimento: { id: number; origem: string; id_pedido_portao: number | null },
    statusNovo: DeliveryStatus,
    quem: { idUser: number | null; operador: boolean; sistema: boolean },
  ): Promise<void> {
    if (!atendimento.id_pedido_portao) return;
    try {
      const db = (this.prisma as any).deliveryPedidosPortao;
      const pedido = await db.findUnique({ where: { id: Number(atendimento.id_pedido_portao) } });
      // Só o pedido DESTE atendimento (o que o morador viu no card), e só pendente.
      if (!pedido || Number(pedido.id_atendimento) !== Number(atendimento.id) || pedido.status !== 'pendente') return;
      const agora = new Date(this.agora());
      const pendente = { id: pedido.id, status: 'pendente' };
      switch (statusNovo) {
        case 'AUTORIZADA': {
          if (quem.operador) {
            // Porteiro autorizou: ele abre pelo meio de sempre; a nuvem não abre.
            await db.updateMany({ where: pendente, data: { status: 'liberado', respondido_em: agora, liberado_ate: null } });
            return;
          }
          if (quem.sistema) return;
          if (agora.getTime() >= new Date(pedido.expira_em).getTime() || (await this.portaoIndisponivel(pedido.id_device))) {
            // Resposta tarde, ou a opção foi desligada / saiu do horário:
            // o atendimento fica AUTORIZADA, nada abre e não há janela.
            await db.updateMany({ where: pendente, data: { status: 'expirado' } });
            return;
          }
          const liberado = await db.updateMany({
            where: pendente,
            data: { status: 'liberado', respondido_em: agora, liberado_ate: new Date(agora.getTime() + JANELA_ABERTURA_MS) },
          });
          if (liberado.count !== 1) return;
          const visto = pedido.visto_em ? new Date(pedido.visto_em).getTime() : null;
          // Página presente: abre já. Ausente: o botão vale até liberado_ate.
          if (visto !== null && agora.getTime() - visto <= PRESENCA_MS) {
            await this.abrirEntrada({ ...pedido, status: 'liberado' }, agora);
          }
          return;
        }
        // respondido_em: começa a trégua da unidade (criarPedido).
        case 'RETIRADA_NA_PORTARIA':
          await db.updateMany({ where: pendente, data: { status: 'vou_buscar', respondido_em: agora } });
          return;
        case 'RECUSADA':
          await db.updateMany({ where: pendente, data: { status: 'recusado', respondido_em: agora } });
          return;
        case 'CANCELADA':
          // Cancelamento não é recusa da unidade: sem trégua.
          await db.updateMany({ where: pendente, data: { status: 'recusado' } });
          return;
        default:
          return;
      }
    } catch (e: any) {
      this.logger.warn(`Pedido de portão do delivery ${atendimento.id}: ${e?.message ?? e}`);
    }
  }

  // ─────────────────────────────────────────── internos

  /**
   * Reserva a abertura em `abrindo_em` (só um chamador passa) e aciona o
   * aparelho do pedido. `aberto_em` só é gravado com a confirmação do
   * aparelho: é dela que a saída depende. Falhou: desfaz a reserva e marca a
   * falha, para nova tentativa dentro da janela. Reserva presa (instância
   * caiu no meio) não é retomada: o entregador procura a portaria, e nunca
   * há duas entradas.
   */
  private async abrirEntrada(pedido: any, agora: Date): Promise<boolean> {
    const db = (this.prisma as any).deliveryPedidosPortao;
    const reserva = await db.updateMany({
      where: { id: pedido.id, status: 'liberado', aberto_em: null, abrindo_em: null, liberado_ate: { gte: agora } },
      data: { abrindo_em: agora },
    });
    if (reserva.count !== 1) return false;
    const r = await this.facial.abrirDispositivoInterno(pedido.id_device, this.contextoAbertura(pedido));
    if (r.ok) {
      await db
        .updateMany({
          where: { id: pedido.id, aberto_em: null },
          data: { aberto_em: new Date(this.agora()), abrindo_em: null, falha_abertura_em: null },
        })
        .catch((e: any) => this.logger.warn(`Entrada do pedido de portão ${pedido.id} não gravada: ${e?.message ?? e}`));
      return true;
    }
    await db.update({ where: { id: pedido.id }, data: { abrindo_em: null, falha_abertura_em: agora } });
    return false;
  }

  private contextoAbertura(pedido: any) {
    return {
      origem: 'delivery_portao' as const,
      tipoPessoa: 'entregador',
      idPessoa: null,
      nomePessoa: pedido.nome,
      credencial: `delivery:${pedido.id_atendimento}`,
    };
  }

  private async marcarVisto(pedido: any, agora: Date) {
    const db = (this.prisma as any).deliveryPedidosPortao;
    await db.update({ where: { id: pedido.id }, data: { visto_em: agora } });
    if (pedido.status === 'pendente' && agora.getTime() >= new Date(pedido.expira_em).getTime()) {
      await db.updateMany({ where: { id: pedido.id, status: 'pendente' }, data: { status: 'expirado' } });
    }
    return this.relerPedido(pedido.id);
  }

  private async relerPedido(id: number) {
    return (this.prisma as any).deliveryPedidosPortao.findUnique({ where: { id } });
  }

  private async carregarPortao(token: string): Promise<Portao> {
    if (typeof token !== 'string' || !TOKEN_PORTAO.test(token)) throw new NotFoundException(MSG_PORTAO);
    const d = await (this.prisma as any).facial_Devices.findFirst({
      where: { token_entrega: token, ativo: 1 },
      select: {
        id: true,
        id_condominio: true,
        nome: true,
        condominio: {
          select: {
            id: true,
            nome: true,
            ativo: true,
            delivery_autoatendimento: true,
            delivery_auto_inicio: true,
            delivery_auto_fim: true,
          },
        },
      },
    });
    if (!d || !d.condominio || d.condominio.ativo !== 1) throw new NotFoundException(MSG_PORTAO);
    return d as Portao;
  }

  private async carregarPedido(token: string, tokenPedido: string): Promise<{ portao: Portao; pedido: any }> {
    const portao = await this.carregarPortao(token);
    if (typeof tokenPedido !== 'string' || !TOKEN_PEDIDO.test(tokenPedido)) throw new NotFoundException(MSG_PEDIDO);
    const pedido = await (this.prisma as any).deliveryPedidosPortao.findUnique({ where: { token_hash: hashToken(tokenPedido) } });
    // Pedido de outro portão não é lido nem aberto por este QR.
    if (!pedido || pedido.id_device !== portao.id) throw new NotFoundException(MSG_PEDIDO);
    return { portao, pedido };
  }

  /** Condomínio do aparelho com a opção desligada ou fora do horário (aparelho sumido conta como indisponível). */
  private async portaoIndisponivel(idDevice: number): Promise<boolean> {
    const d = await (this.prisma as any).facial_Devices.findUnique({
      where: { id: Number(idDevice) },
      select: {
        id: true,
        id_condominio: true,
        nome: true,
        condominio: {
          select: { id: true, nome: true, delivery_autoatendimento: true, delivery_auto_inicio: true, delivery_auto_fim: true },
        },
      },
    });
    if (!d?.condominio) return true;
    return this.motivoIndisponivel(d as Portao) !== null;
  }

  private motivoIndisponivel(portao: Portao): 'desligado' | 'fora_horario' | null {
    const c = portao.condominio;
    if (!c.delivery_autoatendimento) return 'desligado';
    if (!dentroDoHorario(c.delivery_auto_inicio, c.delivery_auto_fim, new Date(this.agora()))) return 'fora_horario';
    return null;
  }
}
