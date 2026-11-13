import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { executarComLock } from '../common/lock-distribuido';
import { ApnsClient, RespostaApns, tokenMorto } from './apns.client';
import { miniaturaBase64 } from './miniatura';
import {
  AtendimentoCard,
  StatusDelivery,
  alertaDelivery,
  conteudoDelivery,
  dismissalDelivery,
  faseDoStatus,
  mensagemDelivery,
  statusDaFase,
} from './delivery-conteudo';
import {
  AlertaCard,
  BaseCard,
  ConteudoCard,
  DELIVERY_MAX_SEG,
  FaseCard,
  JANELA_RESPOSTA_SEG,
  epochSeg,
  montarConteudo,
  payloadAtualizacao,
  payloadFim,
  cabeNoPush,
  payloadInicio,
  temaValido,
  textoAlerta,
} from './conteudo';

/**
 * Card ao vivo da portaria remota (spec 2026-11-13-card-ao-vivo-portaria-remota).
 *
 * Um pedido de autorização vira, em cada aparelho dos moradores do apto:
 *  - iPhone com token de push-to-start → Live Activity aberta pelo APNs;
 *  - Android com o app novo → push de dados que o app transforma em
 *    notificação fixa;
 *  - qualquer outro → o push comum de hoje.
 *
 * Reserva automática: o aparelho confirma que o card abriu
 * (`POST /card-ao-vivo/confirmar`). Sem confirmação em 10 s, aquele aparelho
 * recebe o push comum — nunca deixar o pedido passar pesa mais que o aviso
 * duplicado (decisão do usuário).
 *
 * Tudo aqui é melhor esforço: quem chama faz `void ... .catch()` e a resposta
 * HTTP do porteiro/morador nunca depende do card.
 */

export type OrigemPedido = 'visitante' | 'visita' | 'delivery';

/** Notificação comum (de hoje) que substitui o card em quem não o tem. */
type PushComum = { titulo: string; corpo: string; dados: Record<string, string> };

type Aparelho = {
  id_user: number;
  fcm_token: string;
  plataforma: string | null;
  card_token_inicio: string | null;
  card_android: number;
  card_tema?: string | null;
  card_versao?: number | null;
};

/** O que muda entre abrir o card da portaria e o do delivery. */
interface OpcoesAbertura {
  origem: OrigemPedido;
  id: number;
  idsUsuarios: number[];
  conteudo: ConteudoCard;
  /** null = nenhum aviso comum (a ação foi do próprio morador). */
  pushComum: PushComum | null;
  foto: () => Promise<string | null>;
  /** Delivery: a foto vai no estado (pode chegar depois); portaria: no atributo. */
  fotoNoEstado: boolean;
  /** `Users_Devices.card_versao` mínima para desenhar este card. */
  versaoMinima: number;
  alerta: AlertaCard;
}

export interface PedidoCard extends BaseCard {
  origem: OrigemPedido;
  id: number;
  fotoUrl?: string | null;
  /** Foto como está no cadastro (URL do bucket, chave ou data URL) para a miniatura do card. */
  fotoOrigem?: string | null;
}

export interface QuemRespondeu {
  /** Users.id do morador; null quando foi a portaria. */
  idUser: number | null;
  nome?: string | null;
  pelaPortaria: boolean;
}

type Linha = {
  id: number;
  origem: string;
  id_pedido: number;
  id_user: number;
  plataforma: string;
  fcm_token: string;
  token_inicio: string | null;
  token_atualizacao: string | null;
  fase: string;
  fase_em: Date;
  conteudo_json?: string | null;
  confirmado_em: Date | null;
  reserva_enviada_em: Date | null;
  encerrado_em: Date | null;
  created_at: Date;
};

export const RESERVA_MS = 10_000;
/** Teto para ler e reduzir a foto do visitante; passou, o card sai com as iniciais. */
export const FOTO_TETO_MS = 3_000;
export const LIBERADO_ESPERA_SEG = 600;
export const DISMISSAL_ENTROU_SEG = 300;
export const DISMISSAL_FINAL_SEG = 120;
export const CHAVE_APNS_S3 = 'config/apns/AuthKey.p8';

@Injectable()
export class CardAoVivoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CardAoVivoService.name);
  private tickInterval?: ReturnType<typeof setInterval>;
  /** Público para os testes trocarem por um falso. */
  apns: Pick<ApnsClient, 'enviar'>;
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly storage?: StorageService,
  ) {
    this.apns = new ApnsClient(async () => {
      const b64 = process.env['APNS_KEY_P8_BASE64'];
      if (b64) return Buffer.from(b64, 'base64').toString('utf-8');
      return (await this.storage?.lerObjetoTexto(CHAVE_APNS_S3)) ?? null;
    });
  }

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.tickInterval = setInterval(
      () => void executarComLock(this.prisma, 'card-ao-vivo:tick', () => this.tick()),
      30_000,
    );
    this.tickInterval.unref?.();
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  // ─────────────────────────────────────────── abrir

  /** Abre o card do pedido nos aparelhos dos usuários. Encerra o card anterior do mesmo pedido. */
  async abrir(p: PedidoCard, idsUsuarios: number[]): Promise<void> {
    await this.encerrar(p.origem, p.id);
    if (!idsUsuarios.length) return;
    // Unidade e hora vêm do banco (quem chama nem sempre tem o apartamento).
    const conteudo = montarConteudo((await this.carregarBase(p.origem, p.id)) ?? p, 'aguardando');
    await this.abrirNucleo({
      origem: p.origem,
      id: p.id,
      idsUsuarios,
      conteudo,
      pushComum: this.pushComum(p, conteudo),
      foto: () => this.fotoDoCard(p),
      fotoNoEstado: false,
      versaoMinima: 1,
      alerta: textoAlerta(conteudo),
    });
  }

  /**
   * Delivery (spec 2026-11-13-card-ao-vivo-delivery): abre o card do
   * atendimento nos aparelhos do morador que criou o aviso. Só aparelho com
   * `card_versao >= 2` (o app que sabe desenhar o delivery); os outros
   * recebem a notificação de hoje.
   */
  async abrirDelivery(
    a: AtendimentoCard,
    idUser: number,
    opts: { voceRespondeu?: boolean; semAvisoComum?: boolean } = {},
  ): Promise<void> {
    const fase = faseDoStatus(a.status);
    if (!fase || fase === 'encerrar' || !idUser) return;
    await this.encerrar('delivery', a.id);
    const conteudo = conteudoDelivery(a, fase, { voceRespondeu: !!opts.voceRespondeu }, epochSeg(new Date(this.agora())));
    await this.abrirNucleo({
      origem: 'delivery',
      id: a.id,
      idsUsuarios: [idUser],
      conteudo,
      pushComum: opts.semAvisoComum ? null : this.pushComumDelivery(a.id, a.status, a.motivo),
      foto: () => (a.fotoEntregador ? this.fotoDoCard({ fotoOrigem: a.fotoEntregador }) : Promise.resolve(null)),
      fotoNoEstado: true,
      versaoMinima: 2,
      alerta: alertaDelivery(fase, conteudo) ?? { titulo: 'Delivery', corpo: mensagemDelivery(a.status, a.motivo) },
    });
  }

  /**
   * Delivery mudou de status. Devolve os tokens que tinham card aberto,
   * confirmado e sem reserva ANTES da mudança (quem chama não manda a
   * notificação de hoje a eles). Sem card aberto e status não-final: abre.
   */
  async atualizarDelivery(
    a: AtendimentoCard,
    idUser: number,
    opts: { voceRespondeu: boolean },
  ): Promise<{ cobertos: Set<string>; abriu?: boolean }> {
    const cobertos = new Set<string>();
    const fase = faseDoStatus(a.status);
    if (!fase) return { cobertos };
    const abertas = await this.linhasAbertas('delivery', a.id);
    for (const l of abertas) if (l.confirmado_em && !l.reserva_enviada_em) cobertos.add(l.fcm_token);
    if (fase === 'encerrar') {
      if (abertas.length) await this.encerrarLinhas(abertas);
      return { cobertos };
    }
    if (!abertas.length) {
      if (dismissalDelivery(fase) !== null) return { cobertos };
      // Reabre (o card já manda o aviso de hoje a quem não tem card): quem
      // chama não manda de novo. Ação do próprio morador: sem aviso comum.
      await this.abrirDelivery(a, idUser, { voceRespondeu: opts.voceRespondeu, semAvisoComum: opts.voceRespondeu });
      return { cobertos, abriu: true };
    }
    const foto = a.fotoEntregador ? await this.fotoDoCard({ fotoOrigem: a.fotoEntregador }) : null;
    const seg = epochSeg(new Date(this.agora()));
    const alerta = alertaDelivery(fase, { nome: a.estabelecimento?.trim() || 'Delivery' });
    let c = conteudoDelivery(a, fase, { voceRespondeu: opts.voceRespondeu, foto }, seg);
    // Foto no estado: o push (APNs ou dados do Android) não pode passar de 4 KB.
    // Mede o push que vai sair de fato (fim no entregue/recusado, atualização no resto).
    const dismissal = dismissalDelivery(fase);
    const corpoDe = (x: ConteudoCard) => (dismissal === null ? payloadAtualizacao(x, seg, alerta) : payloadFim(x, seg, dismissal));
    if (c.foto && (!cabeNoPush(corpoDe(c)) || !cabeNoPush(this.dadosAndroid(abertas[0], c)))) {
      c = conteudoDelivery(a, fase, { voceRespondeu: opts.voceRespondeu }, seg);
    }
    await this.aplicarConteudo(abertas, () => c, dismissalDelivery(fase), null, alerta);
    return { cobertos };
  }

  /** Núcleo de abertura, comum à portaria e ao delivery. */
  private async abrirNucleo(o: OpcoesAbertura): Promise<void> {
    const [aparelhos, usuarios] = await Promise.all([
      this.prisma.users_Devices.findMany({
        where: { id_user: { in: o.idsUsuarios } },
        select: {
          id_user: true,
          fcm_token: true,
          plataforma: true,
          card_token_inicio: true,
          card_android: true,
          card_tema: true,
          card_versao: true,
        },
      }),
      this.prisma.users.findMany({
        where: { id: { in: o.idsUsuarios } },
        select: { id: true, fcm_token: true },
      }),
    ]);
    const agora = new Date(this.agora());

    // Reserva agendada ANTES dos envios: se algum envio demorar, o aviso
    // comum continua garantido.
    const t = setTimeout(() => void this.verificarReserva(o.origem, o.id).catch(() => undefined), RESERVA_MS);
    t.unref?.();

    // Foto em miniatura, uma vez para todos os aparelhos.
    const foto = await o.foto();

    const alvos: Aparelho[] = [];
    const vistos = new Set<string>();
    for (const u of usuarios) {
      // Usuário deslogado (Users.fcm_token null) não recebe nada, como hoje.
      if (!u.fcm_token) continue;
      const doUsuario = (aparelhos as Aparelho[]).filter((a) => a.id_user === u.id && a.fcm_token);
      // Aparelho que ainda não reabriu o app desde Users_Devices: só o token antigo.
      if (!doUsuario.length) doUsuario.push({ id_user: u.id, fcm_token: u.fcm_token, plataforma: null, card_token_inicio: null, card_android: 0 });
      for (const a of doUsuario) {
        if (vistos.has(a.fcm_token)) continue;
        vistos.add(a.fcm_token);
        alvos.push(a);
      }
    }

    // Em paralelo: um aparelho lento não atrasa os outros moradores.
    await Promise.all(alvos.map((a) => this.abrirNoAparelho(o, a, agora, foto).catch((e) =>
      this.logger.warn(`Card ao vivo (aparelho do usuário ${a.id_user}): ${e?.message ?? e}`),
    )));
  }

  private async abrirNoAparelho(o: OpcoesAbertura, a: Aparelho, agora: Date, foto: string | null) {
    const plataforma = (a.plataforma ?? '').toLowerCase();
    // App que não sabe desenhar este tipo de card (ex.: delivery no 1.2.45).
    const sabeDesenhar = (a.card_versao ?? 1) >= o.versaoMinima;
    const push = o.pushComum;
    if (plataforma === 'ios' && a.card_token_inicio && sabeDesenhar) {
      const linha = await this.criarLinha(o.origem, o.id, a.id_user, 'ios', a.fcm_token, a.card_token_inicio, agora, o.conteudo);
      // Tema do app no aparelho: o card do iPhone segue Claro/Escuro/Sistema.
      const tema = temaValido(a.card_tema);
      const atributos = { idCartao: String(linha.id), idPedido: String(o.id), origem: o.origem, ...(tema ? { tema } : {}) };
      const seg = epochSeg(agora);
      const montar = (comFoto: boolean) =>
        !comFoto || !foto
          ? payloadInicio(o.conteudo, atributos, seg, o.alerta)
          : o.fotoNoEstado
            ? payloadInicio({ ...o.conteudo, foto }, atributos, seg, o.alerta)
            : payloadInicio(o.conteudo, { ...atributos, foto }, seg, o.alerta);
      let corpo = montar(true);
      // Passou do limite do APNs (nome muito longo + foto): sai sem a foto.
      if (foto && !cabeNoPush(corpo)) corpo = montar(false);
      // O estado salvo é o que o iPhone recebeu (reenvios não tiram a foto).
      if (o.fotoNoEstado && corpo.aps['content-state'] !== o.conteudo) {
        await this.marcar(linha.id, { conteudo_json: JSON.stringify(corpo.aps['content-state']) });
      }
      const r = await this.apns.enviar(a.card_token_inicio, corpo, 10);
      if (r.status !== 200) await this.falhouAbrir(linha, r, push);
    } else if (plataforma === 'android' && a.card_android === 1 && sabeDesenhar) {
      const linha = await this.criarLinha(o.origem, o.id, a.id_user, 'android', a.fcm_token, null, agora, o.conteudo);
      const r = await this.notifications.enviarDados(a.fcm_token, this.dadosAndroid(linha, o.conteudo, foto));
      if (r !== 'ok') {
        await this.marcar(linha.id, { encerrado_em: agora, reserva_enviada_em: agora });
        if (r !== 'morto' && push) await this.notifications.enviarParaAparelho(a.fcm_token, push.titulo, push.corpo, push.dados);
      }
    } else {
      // App antigo (não monta o card) ou iPhone sem token: o push de hoje.
      if (push) await this.notifications.enviarParaAparelho(a.fcm_token, push.titulo, push.corpo, push.dados);
    }
  }

  private async falhouAbrir(linha: Linha, r: RespostaApns, push: PushComum | null) {
    const agora = new Date(this.agora());
    if (tokenMorto(r)) {
      await this.prisma.users_Devices
        .updateMany({ where: { card_token_inicio: linha.token_inicio }, data: { card_token_inicio: null } })
        .catch(() => undefined);
    } else if (r.status !== 0) {
      this.logger.warn(`APNs recusou o card ${linha.id}: ${r.status} ${r.motivo ?? ''}`);
    }
    await this.marcar(linha.id, { encerrado_em: agora, reserva_enviada_em: agora });
    if (push) await this.notifications.enviarParaAparelho(linha.fcm_token, push.titulo, push.corpo, push.dados);
  }

  // ─────────────────────────────────────────── confirmação e reserva

  /** O aparelho avisa que o card abriu (iOS manda também o token da Live Activity). */
  async confirmar(idUser: number, idCartao: number, tokenAtualizacao?: string | null): Promise<{ ok: boolean }> {
    if (!idUser || !idCartao) return { ok: false };
    const linha = (await this.prisma.cards_Ao_Vivo.findUnique({ where: { id: Number(idCartao) } })) as Linha | null;
    if (!linha || linha.id_user !== idUser) return { ok: false };
    const token = tokenAtualizacao && /^[0-9a-fA-F]{16,200}$/.test(tokenAtualizacao) ? tokenAtualizacao : null;
    await this.marcar(linha.id, {
      confirmado_em: linha.confirmado_em ?? new Date(this.agora()),
      ...(token ? { token_atualizacao: token } : {}),
    });
    // O iPhone mandou o token depois de a fase mudar (resposta rápida de
    // outro morador, encerramento por re-solicitação/exclusão/logout): o card
    // dele ainda mostra AGUARDANDO. Relê a linha DEPOIS de gravar o token —
    // quem mudou a fase relê também (aplicarFase), então um dos dois envia.
    if (token && linha.plataforma === 'ios') {
      const atual = (await this.prisma.cards_Ao_Vivo.findUnique({ where: { id: linha.id } })) as Linha | null;
      // Mudou desde a abertura: na portaria toda mudança tira de AGUARDANDO;
      // o delivery abre em fases variadas, então vale a hora da última troca.
      const mudou =
        !!atual &&
        (!!atual.encerrado_em ||
          new Date(atual.fase_em).getTime() > new Date(atual.created_at).getTime() ||
          (atual.origem !== 'delivery' && atual.fase !== 'aguardando'));
      if (atual && mudou) {
        const agora = epochSeg(new Date(this.agora()));
        const c = lerConteudo(atual) ?? montarConteudo(
          { nome: '', isPrestador: false, bloco: null, apto: null, solicitadoEm: atual.created_at },
          (atual.fase as FaseCard) || 'aguardando',
        );
        const dismissal =
          atual.origem === 'delivery'
            ? (dismissalDelivery(atual.fase as FaseCard) ?? 0)
            : atual.fase === 'entrou' ? DISMISSAL_ENTROU_SEG : atual.fase === 'aguardando' ? 0 : DISMISSAL_FINAL_SEG;
        const corpo = atual.encerrado_em ? payloadFim(c, agora, dismissal) : payloadAtualizacao(c, agora);
        await this.apns.enviar(token, corpo, 10);
      }
    }
    return { ok: true };
  }

  /**
   * Push comum para os aparelhos que não confirmaram o card. Com pedido: os
   * cards dele (chamado 10 s depois de abrir). Sem: todos os atrasados (tique;
   * cobre o servidor reiniciado no meio da espera).
   */
  async verificarReserva(origem?: OrigemPedido, idPedido?: number): Promise<void> {
    const limite = new Date(this.agora() - (origem ? RESERVA_MS - 1000 : RESERVA_MS + 5000));
    const linhas = (await this.prisma.cards_Ao_Vivo.findMany({
      where: {
        ...(origem ? { origem, id_pedido: idPedido } : {}),
        // Portaria: só o pedido em aberto. Delivery: o card abre em fases
        // variadas (chegou, aguardando...), todas valem a reserva.
        OR: [{ fase: 'aguardando' }, { origem: 'delivery' }],
        confirmado_em: null,
        reserva_enviada_em: null,
        encerrado_em: null,
        created_at: { lte: limite },
      },
    })) as Linha[];
    if (!linhas.length) return;

    const bases = new Map<string, BaseCard | null>();
    for (const l of linhas) {
      // Marca antes de enviar: dois tiques simultâneos não duplicam o push.
      const marcar = () =>
        this.prisma.cards_Ao_Vivo.updateMany({
          where: { id: l.id, reserva_enviada_em: null },
          data: { reserva_enviada_em: new Date(this.agora()) },
        });
      if (l.origem === 'delivery') {
        if (!(await marcar()).count) continue;
        const c = lerConteudo(l);
        const push = this.pushComumDelivery(l.id_pedido, statusDaFase(l.fase), c?.motivo ?? null);
        await this.notifications.enviarParaAparelho(l.fcm_token, push.titulo, push.corpo, push.dados);
        continue;
      }
      const chave = `${l.origem}:${l.id_pedido}`;
      if (!bases.has(chave)) bases.set(chave, await this.carregarBase(l.origem as OrigemPedido, l.id_pedido));
      const base = bases.get(chave);
      const r = await marcar();
      if (!r.count || !base) continue;
      const c = montarConteudo(base, 'aguardando');
      const push = this.pushComum({ id: l.id_pedido }, c);
      await this.notifications.enviarParaAparelho(l.fcm_token, push.titulo, push.corpo, push.dados);
    }
  }

  // ─────────────────────────────────────────── fases

  /** Morador (ou portaria) respondeu. LIBERADO acompanha até a entrada; NEGADO encerra. */
  async respondido(origem: OrigemPedido, id: number, fase: 'liberado' | 'negado', quem: QuemRespondeu): Promise<void> {
    const linhas = await this.linhasAbertas(origem, id, ['aguardando']);
    if (!linhas.length) return;
    let nome = quem.nome ?? null;
    if (!quem.pelaPortaria && !nome && quem.idUser) {
      const u = await this.prisma.users.findUnique({ where: { id: quem.idUser }, select: { name: true } });
      nome = primeiroNome(u?.name);
    }
    const hora = epochSeg(new Date(this.agora()));
    await this.aplicarFase(origem, id, linhas, fase, (l) => ({
      voceRespondeu: !quem.pelaPortaria && l.id_user === quem.idUser,
      respondidoPor: quem.pelaPortaria ? null : nome,
      pelaPortaria: quem.pelaPortaria,
      horaResposta: hora,
    }), fase === 'negado' ? DISMISSAL_FINAL_SEG : null, ['aguardando']);
  }

  /** Visitante passou (facial ou check-in da portaria). */
  async entrou(origem: OrigemPedido, id: number, em: Date = new Date(this.agora())): Promise<void> {
    const linhas = await this.linhasAbertas(origem, id, ['aguardando', 'liberado']);
    if (!linhas.length) return;
    await this.aplicarFase(origem, id, linhas, 'entrou', () => ({ horaEntrada: epochSeg(em) }), DISMISSAL_ENTROU_SEG, ['aguardando', 'liberado']);
  }

  /** Some com o card na hora (visitante excluído, check-out, re-solicitação). */
  async encerrar(origem: OrigemPedido, id: number): Promise<void> {
    const linhas = await this.linhasAbertas(origem, id);
    if (linhas.length) await this.encerrarLinhas(linhas);
  }

  /** Logout: encerra os cards abertos do usuário em todos os aparelhos. */
  async encerrarDoUsuario(idUser: number): Promise<void> {
    if (!idUser) return;
    const linhas = (await this.prisma.cards_Ao_Vivo.findMany({ where: { id_user: idUser, encerrado_em: null } })) as Linha[];
    if (linhas.length) await this.encerrarLinhas(linhas);
  }

  /** A cada 30 s: reserva atrasada, AGUARDANDO vencido, LIBERADO sem entrada, limpeza. */
  async tick(): Promise<void> {
    const agora = this.agora();
    await this.verificarReserva();

    // Só a portaria tem prazo de resposta; o delivery em AGUARDANDO espera o morador.
    const vencidos = (await this.prisma.cards_Ao_Vivo.findMany({
      where: {
        encerrado_em: null,
        origem: { not: 'delivery' },
        fase: 'aguardando',
        fase_em: { lte: new Date(agora - JANELA_RESPOSTA_SEG * 1000) },
      },
    })) as Linha[];
    for (const [chave, linhas] of agrupar(vencidos)) {
      const [origem, id] = chave.split(':');
      await this.aplicarFase(origem as OrigemPedido, Number(id), linhas, 'expirado', () => ({}), DISMISSAL_FINAL_SEG, ['aguardando']);
    }

    const semEntrada = (await this.prisma.cards_Ao_Vivo.findMany({
      where: { encerrado_em: null, fase: 'liberado', fase_em: { lte: new Date(agora - LIBERADO_ESPERA_SEG * 1000) } },
    })) as Linha[];
    if (semEntrada.length) await this.encerrarLinhas(semEntrada);

    // Delivery esquecido (a portaria não fechou o atendimento): some em 2 h.
    const deliveryVelho = (await this.prisma.cards_Ao_Vivo.findMany({
      where: { encerrado_em: null, origem: 'delivery', created_at: { lte: new Date(agora - DELIVERY_MAX_SEG * 1000) } },
    })) as Linha[];
    if (deliveryVelho.length) await this.encerrarLinhas(deliveryVelho);

    await this.prisma.cards_Ao_Vivo.deleteMany({ where: { encerrado_em: { lte: new Date(agora - 24 * 3600_000) } } });
  }

  // ─────────────────────────────────────────── internos

  /**
   * Leva as linhas à `fase` e avisa cada aparelho. A troca é condicional
   * (só de `permitidas`, só se aberta): duas mudanças simultâneas (tique que
   * expira × resposta do morador) não mandam as duas ao aparelho. O token é
   * relido DEPOIS da troca: se o iPhone confirmar no meio, o `confirmar`
   * (que relê depois de gravar o token) ou este envio alcança o card.
   */
  private async aplicarFase(
    origem: OrigemPedido,
    id: number,
    linhas: Linha[],
    fase: FaseCard,
    extras: (l: Linha) => Partial<ConteudoCard>,
    dismissalSeg: number | null,
    permitidas: string[],
  ) {
    const base = await this.carregarBase(origem, id);
    if (!base) {
      await this.encerrarLinhas(linhas);
      return;
    }
    await this.aplicarConteudo(linhas, (l) => montarConteudo(base, fase, extras(l)), dismissalSeg, permitidas);
  }

  /**
   * Núcleo de `aplicarFase`, comum à portaria e ao delivery: grava e envia o
   * conteúdo pronto. `permitidas` null = qualquer fase (delivery); `alerta`
   * faz o update tocar (pedido que exige o morador).
   */
  private async aplicarConteudo(
    linhas: Linha[],
    conteudoDe: (l: Linha) => ConteudoCard,
    dismissalSeg: number | null,
    permitidas: string[] | null,
    alerta: AlertaCard | null = null,
  ) {
    const agora = new Date(this.agora());
    const seg = epochSeg(agora);
    for (const l of linhas) {
      const c = conteudoDe(l);
      const r = await this.prisma.cards_Ao_Vivo.updateMany({
        where: { id: l.id, encerrado_em: null, ...(permitidas ? { fase: { in: permitidas } } : {}) },
        data: {
          fase: c.fase,
          fase_em: agora,
          conteudo_json: JSON.stringify(c),
          ...(dismissalSeg !== null ? { encerrado_em: agora } : {}),
        },
      });
      if (!r.count) continue;
      if (l.plataforma === 'ios') {
        const token = (await this.tokenAtual(l.id)) ?? l.token_atualizacao;
        if (token) {
          const corpo = dismissalSeg === null ? payloadAtualizacao(c, seg, alerta) : payloadFim(c, seg, dismissalSeg);
          await this.apns.enviar(token, corpo, 10);
        }
      } else {
        await this.notifications.enviarDados(l.fcm_token, this.dadosAndroid(l, c));
      }
    }
  }

  /** Some com as linhas na hora. */
  private async encerrarLinhas(linhas: Linha[]) {
    const agora = new Date(this.agora());
    const seg = epochSeg(agora);
    for (const l of linhas) {
      const r = await this.prisma.cards_Ao_Vivo.updateMany({
        where: { id: l.id, encerrado_em: null },
        data: { encerrado_em: agora },
      });
      if (!r.count) continue;
      if (l.plataforma === 'ios') {
        const token = (await this.tokenAtual(l.id)) ?? l.token_atualizacao;
        if (token) {
          const c = lerConteudo(l) ?? montarConteudo(
            { nome: '', isPrestador: false, bloco: null, apto: null, solicitadoEm: l.created_at },
            (l.fase as FaseCard) || 'aguardando',
          );
          await this.apns.enviar(token, payloadFim(c, seg, 0), 5);
        }
      } else {
        await this.notifications.enviarDados(l.fcm_token, {
          type: 'card_portaria',
          id_cartao: String(l.id),
          id_pedido: String(l.id_pedido),
          origem: l.origem,
          fase: 'encerrado',
        });
      }
    }
  }

  private async tokenAtual(id: number): Promise<string | null> {
    const l = await this.prisma.cards_Ao_Vivo.findUnique({ where: { id }, select: { token_atualizacao: true } } as any);
    return ((l as any)?.token_atualizacao as string | null) ?? null;
  }

  private async linhasAbertas(origem: OrigemPedido, id: number, fases?: string[]): Promise<Linha[]> {
    return (await this.prisma.cards_Ao_Vivo.findMany({
      where: { origem, id_pedido: Number(id), encerrado_em: null, ...(fases ? { fase: { in: fases } } : {}) },
    })) as Linha[];
  }

  private async criarLinha(
    origem: OrigemPedido,
    idPedido: number,
    idUser: number,
    plataforma: 'ios' | 'android',
    fcm: string,
    tokenInicio: string | null,
    agora: Date,
    conteudo: ConteudoCard,
  ): Promise<Linha> {
    return (await this.prisma.cards_Ao_Vivo.create({
      data: {
        origem,
        id_pedido: idPedido,
        id_user: idUser,
        plataforma,
        fcm_token: fcm,
        token_inicio: tokenInicio,
        fase: conteudo.fase,
        fase_em: agora,
        conteudo_json: JSON.stringify(conteudo),
        created_at: agora,
      },
    })) as Linha;
  }

  private async marcar(id: number, data: Record<string, unknown>) {
    await this.prisma.cards_Ao_Vivo.update({ where: { id }, data }).catch(() => undefined);
  }

  private dadosAndroid(
    l: Pick<Linha, 'id' | 'id_pedido' | 'origem'> & { origem: string },
    c: ConteudoCard,
    foto: string | null = null,
  ): Record<string, string> {
    const dados: Record<string, string> = {
      type: 'card_portaria',
      id_cartao: String(l.id),
      id_pedido: String(l.id_pedido),
      origem: l.origem,
      fase: c.fase,
      conteudo: JSON.stringify(c),
    };
    // Só na abertura: o app guarda a foto do card e a reusa nas fases seguintes.
    if (foto && cabeNoPush({ ...dados, foto })) dados['foto'] = foto;
    return dados;
  }

  /** A notificação de hoje do delivery (mesmo título, texto e dados de DeliveryService.notificarMorador). */
  private pushComumDelivery(idAtendimento: number, status: StatusDelivery, motivo?: string | null): PushComum {
    return {
      titulo: 'Delivery',
      corpo: mensagemDelivery(status, motivo),
      dados: { id_delivery: String(idAtendimento), status },
    };
  }

  /**
   * Miniatura da foto do visitante (base64), ou null — sem foto, o card mostra
   * as iniciais. Teto de 3 s: a foto não pode atrasar o aviso.
   */
  async fotoDoCard(p: Pick<PedidoCard, 'fotoUrl' | 'fotoOrigem'>): Promise<string | null> {
    const origem = (p.fotoOrigem ?? p.fotoUrl ?? '').trim();
    if (!origem) return null;
    let teto: ReturnType<typeof setTimeout> | undefined;
    const trabalho = (async () => {
      let bytes: Buffer | null = null;
      const i = origem.indexOf(';base64,');
      if (origem.startsWith('data:image/') && i > 0) {
        const b64 = origem.slice(i + 8);
        if (b64.length <= 11_000_000) bytes = Buffer.from(b64, 'base64');
      } else {
        bytes = (await this.storage?.lerArquivoBytes(origem)) ?? null;
      }
      return bytes ? miniaturaBase64(bytes) : null;
    })().catch((e: any) => {
      // Também depois do teto: erro tardio não pode virar rejeição sem dono.
      this.logger.warn(`Card ao vivo: foto do pedido não carregou: ${e?.message ?? e}`);
      return null;
    });
    try {
      return await Promise.race([
        trabalho,
        new Promise<null>((r) => {
          teto = setTimeout(() => r(null), FOTO_TETO_MS);
          (teto as any)?.unref?.();
        }),
      ]);
    } finally {
      if (teto) clearTimeout(teto);
    }
  }

  /** O push de hoje (mesmo título, corpo e `type`), para quem não tem card. */
  private pushComum(p: Pick<PedidoCard, 'id' | 'fotoUrl'>, c: ConteudoCard) {
    const t = textoAlerta(c);
    const foto = p.fotoUrl && !p.fotoUrl.startsWith('data:') && p.fotoUrl.length < 500 ? p.fotoUrl : '';
    return {
      titulo: t.titulo,
      corpo: `${c.nome} quer entrar no seu apartamento. Autorizar?`,
      dados: {
        type: 'autorizacao_visitante',
        id: String(p.id),
        nome: c.nome,
        ...(foto ? { photo: foto } : {}),
      } as Record<string, string>,
    };
  }

  /** Nome, tipo, unidade e hora do pedido, lidos do banco (o card é atualizado por várias instâncias). */
  async carregarBase(origem: OrigemPedido, id: number): Promise<BaseCard | null> {
    try {
      if (origem === 'visita') {
        const v = await this.prisma.visitas.findUnique({
          where: { id: Number(id) },
          select: {
            is_prestador: true,
            auth_solicitado_em: true,
            created_at: true,
            pessoa: { select: { nome: true } },
            apartamento: { select: { bloco: true, apto: true } },
          },
        } as any);
        if (!v) return null;
        const x = v as any;
        return {
          nome: x.pessoa?.nome ?? '',
          isPrestador: x.is_prestador === 1,
          bloco: x.apartamento?.bloco ?? null,
          apto: x.apartamento?.apto ?? null,
          solicitadoEm: x.auth_solicitado_em ?? x.created_at ?? new Date(this.agora()),
        };
      }
      const v = await this.prisma.visitantes.findUnique({
        where: { id: Number(id) },
        select: {
          nome: true,
          is_prestador: true,
          auth_solicitado_em: true,
          apartamento: { select: { bloco: true, apto: true } },
        },
      });
      if (!v) return null;
      return {
        nome: v.nome,
        isPrestador: v.is_prestador === 1,
        bloco: v.apartamento?.bloco ?? null,
        apto: v.apartamento?.apto ?? null,
        solicitadoEm: v.auth_solicitado_em ?? new Date(this.agora()),
      };
    } catch (e: any) {
      this.logger.warn(`Card ao vivo: pedido ${origem}:${id} não carregou: ${e?.message ?? e}`);
      return null;
    }
  }
}

/** Último content-state gravado na linha (o que o aparelho deveria estar mostrando). */
function lerConteudo(l: Pick<Linha, 'conteudo_json'>): ConteudoCard | null {
  if (!l.conteudo_json) return null;
  try {
    return JSON.parse(l.conteudo_json) as ConteudoCard;
  } catch {
    return null;
  }
}

function agrupar(linhas: Linha[]): Map<string, Linha[]> {
  const m = new Map<string, Linha[]>();
  for (const l of linhas) {
    const k = `${l.origem}:${l.id_pedido}`;
    m.set(k, [...(m.get(k) ?? []), l]);
  }
  return m;
}

function primeiroNome(nome?: string | null): string | null {
  const n = (nome ?? '').trim();
  return n ? n.split(/\s+/)[0] : null;
}
