import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { executarComLock } from '../common/lock-distribuido';
import { ApnsClient, RespostaApns, tokenMorto } from './apns.client';
import {
  BaseCard,
  ConteudoCard,
  FaseCard,
  epochSeg,
  montarConteudo,
  payloadAtualizacao,
  payloadFim,
  payloadInicio,
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

export type OrigemPedido = 'visitante' | 'visita';

export interface PedidoCard extends BaseCard {
  origem: OrigemPedido;
  id: number;
  fotoUrl?: string | null;
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
  confirmado_em: Date | null;
  reserva_enviada_em: Date | null;
  encerrado_em: Date | null;
  created_at: Date;
};

export const RESERVA_MS = 10_000;
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

    const [aparelhos, usuarios] = await Promise.all([
      this.prisma.users_Devices.findMany({
        where: { id_user: { in: idsUsuarios } },
        select: { id_user: true, fcm_token: true, plataforma: true, card_token_inicio: true },
      }),
      this.prisma.users.findMany({
        where: { id: { in: idsUsuarios } },
        select: { id: true, fcm_token: true },
      }),
    ]);

    // Unidade e hora vêm do banco (quem chama nem sempre tem o apartamento).
    const conteudo = montarConteudo((await this.carregarBase(p.origem, p.id)) ?? p, 'aguardando');
    const pushComum = this.pushComum(p, conteudo);
    const agora = new Date(this.agora());
    const cobertos = new Set<string>();

    for (const u of usuarios) {
      // Usuário deslogado (Users.fcm_token null) não recebe nada, como hoje.
      if (!u.fcm_token) continue;
      const doUsuario = aparelhos.filter((a) => a.id_user === u.id && a.fcm_token);
      // Aparelho que ainda não reabriu o app desde Users_Devices: só o token antigo.
      if (!doUsuario.length) doUsuario.push({ id_user: u.id, fcm_token: u.fcm_token, plataforma: null, card_token_inicio: null });

      for (const a of doUsuario) {
        if (cobertos.has(a.fcm_token)) continue;
        cobertos.add(a.fcm_token);
        const plataforma = (a.plataforma ?? '').toLowerCase();

        if (plataforma === 'ios' && a.card_token_inicio) {
          const linha = await this.criarLinha(p, u.id, 'ios', a.fcm_token, a.card_token_inicio, agora);
          const r = await this.apns.enviar(
            a.card_token_inicio,
            payloadInicio(conteudo, { idCartao: String(linha.id), idPedido: String(p.id), origem: p.origem }, epochSeg(agora)),
            10,
          );
          if (r.status !== 200) await this.falhouAbrir(linha, r, pushComum);
        } else if (plataforma === 'android') {
          const linha = await this.criarLinha(p, u.id, 'android', a.fcm_token, null, agora);
          const r = await this.notifications.enviarDados(a.fcm_token, this.dadosAndroid(linha, conteudo));
          if (r !== 'ok') {
            await this.marcar(linha.id, { encerrado_em: agora, reserva_enviada_em: agora });
            if (r !== 'morto') await this.notifications.enviarParaAparelho(a.fcm_token, pushComum.titulo, pushComum.corpo, pushComum.dados);
          }
        } else {
          await this.notifications.enviarParaAparelho(a.fcm_token, pushComum.titulo, pushComum.corpo, pushComum.dados);
        }
      }
    }

    const t = setTimeout(() => void this.verificarReserva(p.origem, p.id).catch(() => undefined), RESERVA_MS);
    t.unref?.();
  }

  private async falhouAbrir(linha: Linha, r: RespostaApns, push: ReturnType<CardAoVivoService['pushComum']>) {
    const agora = new Date(this.agora());
    if (tokenMorto(r)) {
      await this.prisma.users_Devices
        .updateMany({ where: { card_token_inicio: linha.token_inicio }, data: { card_token_inicio: null } })
        .catch(() => undefined);
    } else if (r.status !== 0) {
      this.logger.warn(`APNs recusou o card ${linha.id}: ${r.status} ${r.motivo ?? ''}`);
    }
    await this.marcar(linha.id, { encerrado_em: agora, reserva_enviada_em: agora });
    await this.notifications.enviarParaAparelho(linha.fcm_token, push.titulo, push.corpo, push.dados);
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
    // A fase mudou antes de o iPhone mandar o token (resposta muito rápida de
    // outro morador): o card dele ainda mostra AGUARDANDO. Leva ao estado atual.
    if (token && linha.plataforma === 'ios' && linha.fase !== 'aguardando') {
      const base = await this.carregarBase(linha.origem as OrigemPedido, linha.id_pedido);
      if (base) {
        const c = montarConteudo(base, linha.fase as FaseCard);
        const agora = epochSeg(new Date(this.agora()));
        const corpo = linha.encerrado_em ? payloadFim(c, agora, DISMISSAL_FINAL_SEG) : payloadAtualizacao(c, agora);
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
        fase: 'aguardando',
        confirmado_em: null,
        reserva_enviada_em: null,
        encerrado_em: null,
        created_at: { lte: limite },
      },
    })) as Linha[];
    if (!linhas.length) return;

    const bases = new Map<string, BaseCard | null>();
    for (const l of linhas) {
      const chave = `${l.origem}:${l.id_pedido}`;
      if (!bases.has(chave)) bases.set(chave, await this.carregarBase(l.origem as OrigemPedido, l.id_pedido));
      const base = bases.get(chave);
      // Marca antes de enviar: dois tiques simultâneos não duplicam o push.
      const r = await this.prisma.cards_Ao_Vivo.updateMany({
        where: { id: l.id, reserva_enviada_em: null },
        data: { reserva_enviada_em: new Date(this.agora()) },
      });
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
    }), fase === 'negado' ? DISMISSAL_FINAL_SEG : null);
  }

  /** Visitante passou (facial ou check-in da portaria). */
  async entrou(origem: OrigemPedido, id: number, em: Date = new Date(this.agora())): Promise<void> {
    const linhas = await this.linhasAbertas(origem, id, ['aguardando', 'liberado']);
    if (!linhas.length) return;
    await this.aplicarFase(origem, id, linhas, 'entrou', () => ({ horaEntrada: epochSeg(em) }), DISMISSAL_ENTROU_SEG);
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

    const vencidos = (await this.prisma.cards_Ao_Vivo.findMany({
      where: { encerrado_em: null, fase: 'aguardando', fase_em: { lte: new Date(agora - 180_000) } },
    })) as Linha[];
    for (const [chave, linhas] of agrupar(vencidos)) {
      const [origem, id] = chave.split(':');
      await this.aplicarFase(origem as OrigemPedido, Number(id), linhas, 'expirado', () => ({}), DISMISSAL_FINAL_SEG);
    }

    const semEntrada = (await this.prisma.cards_Ao_Vivo.findMany({
      where: { encerrado_em: null, fase: 'liberado', fase_em: { lte: new Date(agora - LIBERADO_ESPERA_SEG * 1000) } },
    })) as Linha[];
    if (semEntrada.length) await this.encerrarLinhas(semEntrada);

    await this.prisma.cards_Ao_Vivo.deleteMany({ where: { encerrado_em: { lte: new Date(agora - 24 * 3600_000) } } });
  }

  // ─────────────────────────────────────────── internos

  private async aplicarFase(
    origem: OrigemPedido,
    id: number,
    linhas: Linha[],
    fase: FaseCard,
    extras: (l: Linha) => Partial<ConteudoCard>,
    dismissalSeg: number | null,
  ) {
    const base = await this.carregarBase(origem, id);
    if (!base) {
      await this.encerrarLinhas(linhas);
      return;
    }
    const agora = new Date(this.agora());
    const seg = epochSeg(agora);
    for (const l of linhas) {
      const c = montarConteudo(base, fase, extras(l));
      if (l.plataforma === 'ios') {
        if (l.token_atualizacao) {
          const corpo = dismissalSeg === null ? payloadAtualizacao(c, seg) : payloadFim(c, seg, dismissalSeg);
          await this.apns.enviar(l.token_atualizacao, corpo, 10);
        }
      } else {
        await this.notifications.enviarDados(l.fcm_token, this.dadosAndroid(l, c));
      }
      await this.marcar(l.id, {
        fase,
        fase_em: agora,
        ...(dismissalSeg !== null ? { encerrado_em: agora } : {}),
      });
    }
  }

  private async encerrarLinhas(linhas: Linha[]) {
    const agora = new Date(this.agora());
    const seg = epochSeg(agora);
    for (const l of linhas) {
      if (l.plataforma === 'ios') {
        if (l.token_atualizacao) {
          const c = montarConteudo(
            { nome: '', isPrestador: false, bloco: null, apto: null, solicitadoEm: l.created_at },
            (l.fase as FaseCard) || 'aguardando',
          );
          await this.apns.enviar(l.token_atualizacao, payloadFim(c, seg, 0), 5);
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
      await this.marcar(l.id, { encerrado_em: agora });
    }
  }

  private async linhasAbertas(origem: OrigemPedido, id: number, fases?: string[]): Promise<Linha[]> {
    return (await this.prisma.cards_Ao_Vivo.findMany({
      where: { origem, id_pedido: Number(id), encerrado_em: null, ...(fases ? { fase: { in: fases } } : {}) },
    })) as Linha[];
  }

  private async criarLinha(
    p: PedidoCard,
    idUser: number,
    plataforma: 'ios' | 'android',
    fcm: string,
    tokenInicio: string | null,
    agora: Date,
  ): Promise<Linha> {
    return (await this.prisma.cards_Ao_Vivo.create({
      data: {
        origem: p.origem,
        id_pedido: p.id,
        id_user: idUser,
        plataforma,
        fcm_token: fcm,
        token_inicio: tokenInicio,
        fase: 'aguardando',
        fase_em: agora,
        created_at: agora,
      },
    })) as Linha;
  }

  private async marcar(id: number, data: Record<string, unknown>) {
    await this.prisma.cards_Ao_Vivo.update({ where: { id }, data }).catch(() => undefined);
  }

  private dadosAndroid(l: Pick<Linha, 'id' | 'id_pedido' | 'origem'> & { origem: string }, c: ConteudoCard): Record<string, string> {
    return {
      type: 'card_portaria',
      id_cartao: String(l.id),
      id_pedido: String(l.id_pedido),
      origem: l.origem,
      fase: c.fase,
      conteudo: JSON.stringify(c),
    };
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
