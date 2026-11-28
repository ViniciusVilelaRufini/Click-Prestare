import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../common/storage/storage.service';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { InterfoneService } from './interfone.service';
import { InterfoneAcoesService, chamadaNaJanelaDoPedido } from './interfone-acoes.service';
import { InterfonePushService } from './interfone-push.service';

export type DecisaoPedido = 'autorizar' | 'negar';
const DECISOES: readonly string[] = ['autorizar', 'negar'];
/** Respostas de um toque na tela do pedido (o morador também pode escrever um texto curto). */
export const MENSAGENS_RAPIDAS = ['Já desço', 'Deixe na portaria', 'Volte mais tarde'] as const;
export const TIPOS_PEDIDO = ['visita', 'entrega', 'servico', 'outro'] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];
export const ORIGENS_PEDIDO = ['central', 'ia'] as const;
export type OrigemPedido = (typeof ORIGENS_PEDIDO)[number];
export const MENSAGEM_PEDIDO_MAX = 120;
const NOME_MAX = 120;
const MOTIVO_MAX = 255;

export type EstadoPedido = 'pendente' | 'autorizado' | 'negado' | 'expirado';

/** O pedido como o app do morador, o console e a central o veem. */
export interface PedidoResumo {
  id: number;
  estado: EstadoPedido;
  nome_falado: string;
  motivo: string | null;
  tipo: string;
  mensagem: string | null;
  respondido_por_nome: string | null;
  /** ISO 8601. */
  respondido_em: string | null;
  /** O portão abriu depois da autorização (pelo pedido ou, se ele falhou, por quem atendeu). */
  portao_aberto: boolean;
}

export interface EntradaPedido {
  idChamada: number;
  idApartamento: number;
  nome: string;
  motivo?: string | null;
  tipo: TipoPedido;
  origem: OrigemPedido;
}

const INCLUDE_PEDIDO = {
  chamada: { select: { estado: true, encerrada_em: true, porta_aberta_em: true } },
  condominio: { select: { central_contratada: true } },
  apartamento: { select: { apto: true, bloco: true } },
} as const;

type ChamadaDoPedido = { estado: string; encerrada_em: Date | null; porta_aberta_em: Date | null };
type LinhaPedido = {
  id: number;
  id_chamada: number;
  id_condominio: number;
  id_apartamento: number;
  nome_falado: string;
  motivo: string | null;
  tipo: string;
  estado: string;
  mensagem: string | null;
  respondido_por_nome: string | null;
  respondido_em: Date | null;
};

function conflito(motivo: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, motivo, message });
}

function invalido(motivo: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, motivo, message });
}

function primeiroNome(v: string | null | undefined): string | null {
  const p = String(v ?? '').trim().split(/\s+/)[0];
  return p ? p.slice(0, 60) : null;
}

/** Nome, motivo, tipo e origem do pedido: 400 antes de qualquer consulta. */
function normalizarEntrada(e: EntradaPedido) {
  const nome = typeof e?.nome === 'string' ? e.nome.trim().slice(0, NOME_MAX) : '';
  if (!nome) throw invalido('nome_obrigatorio', 'Informe o nome de quem está no portão.');
  const tipo = typeof e?.tipo === 'string' ? e.tipo.trim() : '';
  if (!(TIPOS_PEDIDO as readonly string[]).includes(tipo)) throw invalido('tipo_invalido', 'Tipo do pedido inválido.');
  if (!(ORIGENS_PEDIDO as readonly string[]).includes(e?.origem)) throw invalido('origem_invalida', 'Origem do pedido inválida.');
  const motivo = typeof e?.motivo === 'string' ? e.motivo.trim().slice(0, MOTIVO_MAX) || null : null;
  if (!Number.isInteger(e?.idChamada) || e.idChamada <= 0) throw invalido('chamada_invalida', 'Chamada inválida.');
  if (!Number.isInteger(e?.idApartamento) || e.idApartamento <= 0) throw invalido('unidade_obrigatoria', 'Escolha a unidade do pedido.');
  return { idChamada: e.idChamada, idApartamento: e.idApartamento, nome, motivo, tipo: tipo as TipoPedido, origem: e.origem };
}

/** Mensagem do morador: opcional, texto de até 120 caracteres (acima disso 400, não corta). */
function normalizarMensagem(m: unknown): string | null {
  if (m === undefined || m === null) return null;
  if (typeof m !== 'string') throw invalido('mensagem_invalida', 'Mensagem inválida.');
  const t = m.trim();
  if (t.length > MENSAGEM_PEDIDO_MAX) throw invalido('mensagem_longa', `A mensagem pode ter até ${MENSAGEM_PEDIDO_MAX} caracteres.`);
  return t || null;
}

/**
 * Pedido do portão (portaria autônoma): quem atende a chamada (central ou IA) pede, o morador da
 * unidade autoriza ou nega pelo app.
 *
 * Regras de segurança (autorizar abre um portão de verdade):
 * - só morador vinculado à unidade do pedido responde (403);
 * - só pedido `pendente` (409 `pedido_respondido`) e dentro da janela: chamada ativa ou encerrada
 *   há até 5 min (409 `pedido_expirado`, grava `expirado`);
 * - "uma vez": a troca `pendente → autorizado|negado` é condicional (updateMany com o estado no
 *   where); só quem a ganhou segue, e só então o portão é aberto (InterfoneAcoesService.abrirPorPedido).
 *
 * Não cria visitante (Pessoas/Visitas/Visitantes), não libera PIN nem rosto: abre o portão do facial
 * da chamada e pronto.
 */
@Injectable()
export class InterfonePedidosService {
  private readonly logger = new Logger(InterfonePedidosService.name);
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: InterfoneService,
    private readonly acoes: InterfoneAcoesService,
    private readonly push: InterfonePushService,
    @Optional() private readonly realtime?: RealtimeGateway,
    @Optional() private readonly storage?: StorageService,
  ) {}

  /**
   * Cria o pedido na chamada (que ainda não acabou). Chamada com unidade: o pedido vai para ela;
   * `facial_portaria` (sem unidade): para a unidade escolhida, do mesmo condomínio. Um pedido
   * pendente por chamada (409 `pedido_pendente`). Copia a foto da chamada, avisa o console e a
   * central (`interfone:pedido`) e manda o push aos moradores da unidade em segundo plano.
   * Quem chama confere quem pode pedir (a central confere o operador).
   */
  async criar(entrada: EntradaPedido): Promise<PedidoResumo> {
    const e = normalizarEntrada(entrada);
    const c = await this.nucleo.carregar(e.idChamada);
    if (!c) throw new NotFoundException('Chamada não encontrada.');
    if (c.estado === 'encerrada') throw conflito('encerrada', 'A chamada já terminou.');
    if (c.id_apartamento != null && c.id_apartamento !== e.idApartamento) {
      throw invalido('unidade_da_chamada', 'O pedido vai para a unidade da chamada.');
    }
    const apto = await this.prisma.apartamentos.findFirst({
      where: { id: e.idApartamento },
      select: { id: true, apto: true, bloco: true, id_condominio: true },
    });
    if (!apto) throw new NotFoundException('Unidade não encontrada.');
    if (apto.id_condominio !== c.id_condominio) throw new ForbiddenException('Acesso negado: unidade de outro condomínio.');
    const pendentes = await this.prisma.interfone_Pedidos.count({ where: { id_chamada: c.id, estado: 'pendente' } });
    if (pendentes > 0) throw conflito('pedido_pendente', 'Já há um pedido esperando a resposta do morador nesta chamada.');

    const p = await this.prisma.interfone_Pedidos.create({
      data: {
        id_chamada: c.id,
        id_condominio: c.id_condominio,
        id_apartamento: apto.id,
        nome_falado: e.nome,
        motivo: e.motivo,
        tipo: e.tipo,
        origem: e.origem,
        foto: c.foto ?? null,
        estado: 'pendente',
        created_at: new Date(this.agora()),
      },
    });
    const resumo = this.resumo(p, c);
    this.emitir(p, c.condominio?.central_contratada === 1, this.paraSalas(resumo));

    const unidade = rotuloAptoBloco(apto.apto, apto.bloco);
    this.nucleo.emSegundoPlano(`push do pedido ${p.id}`, async () => {
      const moradores = await this.nucleo.moradoresDaUnidade(apto.id);
      await this.push.pedido(p.id, moradores, {
        id_chamada: c.id,
        unidade,
        condominio: c.condominio?.nome ?? '',
        portao: c.facial?.nome ?? 'Portaria',
        nome: e.nome,
        motivo: e.motivo,
        tipo: e.tipo,
        foto_url: await this.assinar(c.foto),
      });
    });
    return resumo;
  }

  /**
   * O morador responde pelo app. Ordem: entrada (400) → pedido existe (404) → vínculo com a unidade
   * do pedido (403) → módulo ligado (403) → pendente (409 `pedido_respondido`) → janela (409
   * `pedido_expirado`) → troca condicional do estado → (autorizar) abre o portão uma vez.
   */
  async responder(idPedido: number, idUser: number, decisao: DecisaoPedido, mensagem?: string | null): Promise<PedidoResumo> {
    if (!DECISOES.includes(decisao)) throw invalido('decisao_invalida', 'Decisão inválida: autorizar ou negar.');
    const msg = normalizarMensagem(mensagem);
    const p = await this.carregar(idPedido);
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    await this.acoes.assertVinculo(idUser, p.id_apartamento);
    await this.acoes.assertModulo(p.id_condominio);
    if (p.estado !== 'pendente') throw this.jaRespondido(p.estado);
    const central = p.condominio?.central_contratada === 1;

    if (!p.chamada || !chamadaNaJanelaDoPedido(p.chamada, this.agora())) {
      const r = await this.prisma.interfone_Pedidos.updateMany({ where: { id: p.id, estado: 'pendente' }, data: { estado: 'expirado' } });
      if (r.count === 1) await this.depoisDaResposta(p.id, idUser, central);
      throw conflito('pedido_expirado', 'O pedido expirou: a chamada terminou há mais de 5 minutos.');
    }

    const nome = await this.nomeDoMorador(idUser);
    const troca = await this.prisma.interfone_Pedidos.updateMany({
      where: { id: p.id, estado: 'pendente' },
      data: {
        estado: decisao === 'autorizar' ? 'autorizado' : 'negado',
        mensagem: msg,
        respondido_por_id: idUser,
        respondido_por_nome: nome,
        respondido_em: new Date(this.agora()),
      },
    });
    if (troca.count !== 1) {
      // Outro morador (ou outro toque) respondeu entre a leitura e a troca: só um vale.
      const atual = await this.prisma.interfone_Pedidos.findUnique({ where: { id: p.id }, select: { estado: true } });
      throw this.jaRespondido(atual?.estado ?? 'autorizado');
    }

    if (decisao === 'autorizar') {
      try {
        const r = await this.acoes.abrirPorPedido(p.id_chamada, { uid: idUser, nome }, {
          idPedido: p.id,
          unidade: p.apartamento ? rotuloAptoBloco(p.apartamento.apto, p.apartamento.bloco) : undefined,
        });
        if (!r.ok) this.logger.warn(`Interfone: pedido ${p.id} autorizado, portão não abriu (${r.motivo ?? 'sem motivo'}).`);
      } catch (e: any) {
        // A autorização fica gravada; o operador vê "autorizado" sem portão aberto e pode abrir.
        this.logger.warn(`Interfone: pedido ${p.id} autorizado, abrir falhou: ${e?.message ?? e}`);
      }
    }
    return this.depoisDaResposta(p.id, idUser, central);
  }

  /** App: o pedido para a tela do morador (só morador vinculado à unidade do pedido). */
  async paraApp(idPedido: number, idUser: number): Promise<PedidoResumo> {
    const p = await this.carregar(idPedido);
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    await this.acoes.assertVinculo(idUser, p.id_apartamento);
    await this.acoes.assertModulo(p.id_condominio);
    return this.resumo(p, p.chamada);
  }

  /** Último pedido da chamada (contexto da central), com só o primeiro nome de quem respondeu. */
  async ultimoDaChamada(idChamada: number): Promise<PedidoResumo | null> {
    const p = await this.prisma.interfone_Pedidos.findFirst({
      where: { id_chamada: idChamada },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      include: INCLUDE_PEDIDO,
    });
    return p ? this.paraSalas(this.resumo(p, p.chamada)) : null;
  }

  // ─────────────────────────────────────────── apoio

  /** Relê o pedido, avisa o console/central e fecha a tela nos outros celulares da unidade. */
  private async depoisDaResposta(idPedido: number, idUser: number, central: boolean): Promise<PedidoResumo> {
    const p = await this.carregar(idPedido);
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    const resumo = this.resumo(p, p.chamada);
    this.emitir(p, central, this.paraSalas(resumo));
    this.nucleo.emSegundoPlano(`fim do pedido ${p.id}`, async () => {
      const outros = (await this.nucleo.moradoresDaUnidade(p.id_apartamento)).filter((u) => u !== idUser);
      if (outros.length) await this.push.pedidoFim(p.id, outros);
    });
    return resumo;
  }

  private carregar(id: number) {
    if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
    return this.prisma.interfone_Pedidos.findUnique({ where: { id }, include: INCLUDE_PEDIDO });
  }

  /**
   * Pendente fora da janela aparece `expirado` (sem gravar). `portao_aberto`: autorizado e o portão
   * da chamada abriu depois da resposta (mesma resolução de segundos do banco).
   */
  private resumo(p: LinhaPedido, c: ChamadaDoPedido | null | undefined): PedidoResumo {
    let estado = p.estado as EstadoPedido;
    if (estado === 'pendente' && (!c || !chamadaNaJanelaDoPedido(c, this.agora()))) estado = 'expirado';
    const portaoAberto =
      p.estado === 'autorizado' && !!p.respondido_em && !!c?.porta_aberta_em && c.porta_aberta_em.getTime() >= p.respondido_em.getTime();
    return {
      id: p.id,
      estado,
      nome_falado: p.nome_falado,
      motivo: p.motivo ?? null,
      tipo: p.tipo,
      mensagem: p.mensagem ?? null,
      respondido_por_nome: p.respondido_por_nome ?? null,
      respondido_em: p.respondido_em ? p.respondido_em.toISOString() : null,
      portao_aberto: portaoAberto,
    };
  }

  /** Console e central: só o primeiro nome de quem respondeu (LGPD, como no contexto). */
  private paraSalas(r: PedidoResumo): PedidoResumo {
    return { ...r, respondido_por_nome: r.respondido_por_nome ? primeiroNome(r.respondido_por_nome) : null };
  }

  /** `interfone:pedido` no console do prédio e, em condomínio da central, na sala da central. */
  private emitir(p: { id_chamada: number; id_condominio: number }, central: boolean, resumo: PedidoResumo): void {
    const evento = { ...resumo, id_chamada: p.id_chamada, id_condominio: p.id_condominio };
    this.realtime?.emitirPortaria(p.id_condominio, 'interfone:pedido', evento);
    if (central) this.realtime?.emitirCentral('interfone:pedido', evento);
  }

  private jaRespondido(estado: string): ConflictException {
    return estado === 'expirado'
      ? conflito('pedido_expirado', 'O pedido expirou: a chamada terminou há mais de 5 minutos.')
      : conflito('pedido_respondido', 'Este pedido já foi respondido.');
  }

  private async nomeDoMorador(idUser: number): Promise<string> {
    try {
      const u = await this.prisma.users.findUnique({ where: { id: idUser }, select: { name: true } });
      const nome = String(u?.name ?? '').trim().slice(0, NOME_MAX);
      if (nome) return nome;
    } catch (e: any) {
      this.logger.warn(`Interfone: nome do morador ${idUser} não veio do banco: ${e?.message ?? e}`);
    }
    return 'Morador';
  }

  /** Link assinado da foto (bucket privado); null sem foto ou se assinar falhar. */
  private async assinar(foto: string | null | undefined): Promise<string | null> {
    if (!foto) return null;
    try {
      return this.storage ? await this.storage.assinarUrl(foto) : foto;
    } catch {
      return null;
    }
  }
}
