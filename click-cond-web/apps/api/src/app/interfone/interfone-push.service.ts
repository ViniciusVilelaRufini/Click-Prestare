import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { APNS_TOPICO_VOIP, ApnsClient, tokenMorto } from '../card-ao-vivo/apns.client';
import { carregarChaveApns } from '../card-ao-vivo/apns-chave';

/** Versão mínima do interfone no app para receber o toque (VoIP/dados). */
export const INTERFONE_VERSAO_APP = 1;
/**
 * Versão do interfone no app que tem a tela do pedido do portão (Autorizar/Negar). Só decide o
 * push do pedido; o toque das chamadas continua com INTERFONE_VERSAO_APP.
 */
export const INTERFONE_VERSAO_PEDIDO = 2;
/**
 * Validade do VoIP push: o toque máximo no apartamento é 60 s. Depois disso o
 * APNs descarta em vez de entregar atrasado (todo VoIP push vira ligação no
 * CallKit, mesmo de chamada que já acabou).
 */
export const VOIP_EXPIRACAO_S = 60;

export interface DadosToque {
  tipo: string;
  unidade: string;
  portao: string;
  condominio: string;
}

/** O que o push `interfone_pedido` leva (o app mostra sem consultar a API). */
export interface DadosPedidoPush {
  id_chamada: number;
  unidade: string;
  condominio: string;
  portao: string;
  nome: string;
  motivo: string | null;
  tipo: string;
  /** Link assinado da foto do visitante; null sem foto. */
  foto_url: string | null;
}

const TITULO_PEDIDO: Record<string, string> = {
  visita: 'Visita no portão',
  entrega: 'Entrega no portão',
  servico: 'Prestador no portão',
  outro: 'Pedido no portão',
};

interface Aparelho {
  id_user: number;
  fcm_token: string;
  plataforma: string | null;
  voip_token: string | null;
  interfone_versao: number;
}

/**
 * Push do interfone. O toque é por push (o app não fica registrado na
 * central): iPhone com app novo → VoIP push (PushKit → CallKit); Android com
 * app novo → FCM só de dados, alta prioridade (o app monta a tela de
 * ligação); app antigo → push comum pedindo para atualizar.
 *
 * Nunca lança: falha de push vira "não tocou" e o núcleo decide (portaria).
 */
@Injectable()
export class InterfonePushService {
  private readonly logger = new Logger(InterfonePushService.name);
  /** Público para os testes trocarem por um falso. */
  apns: Pick<ApnsClient, 'enviar'>;
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly storage?: StorageService,
  ) {
    this.apns = new ApnsClient(() => carregarChaveApns(this.storage));
  }

  /**
   * Toca nos aparelhos dos usuários (exceto quem desligou o interfone).
   * iPhone com app novo sem token VoIP recebe alerta "Toque para atender";
   * "Atualize o app" fica só para quem tem o app sem interfone (versão 0).
   * `tocou` = aparelhos em que o toque saiu (VoIP 200 / dados 'ok');
   * `semApp` = aparelhos com app sem interfone, que receberam o push comum.
   */
  async tocar(
    idChamada: number,
    idsUsuarios: number[],
    dados: DadosToque,
  ): Promise<{ tocou: number; semApp: number; ids: number[] }> {
    let tocou = 0;
    let semApp = 0;
    const tocaram = new Set<number>();
    try {
      const alvos = await this.aparelhos(idsUsuarios, true);
      const id = String(idChamada);
      const conteudo = { type: 'interfone_chamada', id, ...dados };
      const expiracao = Math.floor(this.agora() / 1000) + VOIP_EXPIRACAO_S;
      await Promise.all(
        alvos.map(async (a) => {
          try {
            const plataforma = (a.plataforma ?? '').toLowerCase();
            const versao = a.interfone_versao ?? 0;
            if (plataforma === 'ios' && a.voip_token && versao >= INTERFONE_VERSAO_APP) {
              // Chaves no topo junto de um `aps` mínimo: o app lê do topo ou de `data`.
              const r = await this.apns.enviar(a.voip_token, { aps: {}, ...conteudo }, 10, {
                topico: APNS_TOPICO_VOIP,
                tipo: 'voip',
                expiracao,
              });
              if (r.status === 200) {
                tocou++;
                tocaram.add(a.id_user);
              } else if (tokenMorto(r)) {
                await this.prisma.users_Devices
                  .updateMany({ where: { voip_token: a.voip_token }, data: { voip_token: null } })
                  .catch(() => undefined);
              } else if (r.status !== 0) {
                this.logger.warn(`APNs recusou o VoIP da chamada ${idChamada}: ${r.status} ${r.motivo ?? ''}`);
              }
            } else if (plataforma === 'ios' && versao >= INTERFONE_VERSAO_APP) {
              // App novo sem token VoIP (PushKit ainda não registrou): alerta
              // comum com os dados da chamada; tocar abre o app na chamada.
              const r = await this.notifications.enviarParaAparelho(
                a.fcm_token,
                dados.tipo === 'portaria_unidade' ? 'A portaria está chamando' : 'Visitante chamando no portão',
                'Toque para atender.',
                conteudo,
              );
              if (r) {
                tocou++;
                tocaram.add(a.id_user);
              }
            } else if (plataforma === 'android' && versao >= INTERFONE_VERSAO_APP) {
              if ((await this.notifications.enviarDados(a.fcm_token, conteudo)) === 'ok') {
                tocou++;
                tocaram.add(a.id_user);
              }
            } else {
              semApp++;
              await this.notifications.enviarParaAparelho(
                a.fcm_token,
                dados.tipo === 'portaria_unidade' ? 'A portaria está chamando' : 'Visitante chamando no portão',
                'Atualize o app para atender pelo celular.',
                { type: 'interfone_perdida', id },
              );
            }
          } catch (e: any) {
            this.logger.warn(`Interfone: toque no aparelho do usuário ${a.id_user} falhou: ${e?.message ?? e}`);
          }
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Interfone: toque da chamada ${idChamada} falhou: ${e?.message ?? e}`);
    }
    return { tocou, semApp, ids: [...tocaram].sort((x, y) => x - y) };
  }

  /**
   * Usuários que o toque alcançaria (aparelho com o interfone novo: Android
   * v1+, iPhone v1+ com token VoIP ou, sem ele, pelo alerta), sem mandar nada. Serve para decidir "sem
   * app" sem esperar o APNs.
   */
  async podemTocar(idsUsuarios: number[]): Promise<number[]> {
    try {
      const alvos = await this.aparelhos(idsUsuarios, true);
      const ok = new Set<number>();
      for (const a of alvos) {
        const plataforma = (a.plataforma ?? '').toLowerCase();
        if ((a.interfone_versao ?? 0) < INTERFONE_VERSAO_APP) continue;
        if (plataforma === 'android' || plataforma === 'ios') ok.add(a.id_user);
      }
      return [...ok].sort((x, y) => x - y);
    } catch {
      return [];
    }
  }

  /**
   * Para o toque nos outros aparelhos (atendida em outro lugar, visitante
   * desligou). Android: dados `interfone_fim`. iPhone: nada — o app consulta o
   * estado enquanto toca (outro VoIP push abriria OUTRA ligação no CallKit).
   */
  async fim(idChamada: number, idsUsuarios: number[]): Promise<void> {
    try {
      const alvos = await this.aparelhos(idsUsuarios, false);
      const dados = { type: 'interfone_fim', id: String(idChamada) };
      await Promise.all(
        alvos
          .filter((a) => (a.plataforma ?? '').toLowerCase() === 'android' && (a.interfone_versao ?? 0) >= INTERFONE_VERSAO_APP)
          .map((a) => this.notifications.enviarDados(a.fcm_token, dados).catch(() => undefined)),
      );
    } catch (e: any) {
      this.logger.warn(`Interfone: fim da chamada ${idChamada} falhou: ${e?.message ?? e}`);
    }
  }

  /**
   * Pedido do portão aos moradores da unidade (exceto quem desligou o interfone). App com a tela do
   * pedido (interfone_versao >= INTERFONE_VERSAO_PEDIDO): Android → dados `interfone_pedido` (o app
   * abre a tela de Autorizar/Negar); iPhone → alerta com os mesmos dados (o toque abre a tela).
   * Nunca VoIP: não é ligação. App antigo (sem a tela) → alerta comum, sem tipo, pedindo para
   * atualizar. `ids` = usuários em que o pedido saiu num app com a tela; `alcance` = aparelhos
   * alcançados (com a tela / antigos).
   */
  async pedido(
    idPedido: number,
    idsUsuarios: number[],
    dados: DadosPedidoPush,
  ): Promise<{ ids: number[]; alcance: { apps: number; antigos: number } }> {
    const saiu = new Set<number>();
    const alcance = { apps: 0, antigos: 0 };
    try {
      const alvos = await this.aparelhos(idsUsuarios, true);
      const conteudo: Record<string, string> = {
        type: 'interfone_pedido',
        id: String(idPedido),
        id_chamada: String(dados.id_chamada),
        unidade: dados.unidade ?? '',
        condominio: dados.condominio ?? '',
        portao: dados.portao ?? '',
        nome: dados.nome ?? '',
        motivo: dados.motivo ?? '',
        tipo: dados.tipo ?? '',
        foto_url: dados.foto_url ?? '',
      };
      const titulo = TITULO_PEDIDO[dados.tipo] ?? TITULO_PEDIDO['outro'];
      const texto = `${dados.nome} pede para entrar${dados.motivo ? ` (${dados.motivo})` : ''}. Toque para responder.`;
      const antigo = `Visitante no portão: ${dados.nome}. Atualize o app Prestare para responder.`;
      await Promise.all(
        alvos.map(async (a) => {
          try {
            const plataforma = (a.plataforma ?? '').toLowerCase();
            const comTela = (a.interfone_versao ?? 0) >= INTERFONE_VERSAO_PEDIDO;
            if (comTela && plataforma === 'android') {
              if ((await this.notifications.enviarDados(a.fcm_token, conteudo)) === 'ok') {
                saiu.add(a.id_user);
                alcance.apps++;
              }
            } else if (comTela && plataforma === 'ios') {
              if (await this.notifications.enviarParaAparelho(a.fcm_token, titulo, texto, conteudo)) {
                saiu.add(a.id_user);
                alcance.apps++;
              }
            } else if (await this.notifications.enviarParaAparelho(a.fcm_token, 'Interfone', antigo)) {
              // App sem a tela do pedido (interfone v1 ou sem interfone): só o aviso, sem tipo.
              alcance.antigos++;
            }
          } catch (e: any) {
            this.logger.warn(`Interfone: pedido ${idPedido} no aparelho do usuário ${a.id_user} falhou: ${e?.message ?? e}`);
          }
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Interfone: push do pedido ${idPedido} falhou: ${e?.message ?? e}`);
    }
    return { ids: [...saiu].sort((x, y) => x - y), alcance };
  }

  /**
   * Fecha a tela do pedido nos outros celulares (alguém respondeu ou o pedido expirou): dados
   * `interfone_pedido_fim` nos aparelhos com a tela do pedido, Android e iPhone (no iPhone chega com
   * o app aberto; fechado, a tela consulta o estado ao abrir).
   */
  async pedidoFim(idPedido: number, idsUsuarios: number[]): Promise<void> {
    try {
      const alvos = await this.aparelhos(idsUsuarios, false);
      const dados = { type: 'interfone_pedido_fim', id: String(idPedido) };
      await Promise.all(
        alvos
          .filter((a) => ['android', 'ios'].includes((a.plataforma ?? '').toLowerCase()) && (a.interfone_versao ?? 0) >= INTERFONE_VERSAO_PEDIDO)
          .map((a) => this.notifications.enviarDados(a.fcm_token, dados).catch(() => undefined)),
      );
    } catch (e: any) {
      this.logger.warn(`Interfone: fim do pedido ${idPedido} falhou: ${e?.message ?? e}`);
    }
  }

  /** Push comum "Chamada perdida do portão às HH:MM". */
  async perdida(idChamada: number, idsUsuarios: number[], hora: string): Promise<void> {
    try {
      const alvos = await this.aparelhos(idsUsuarios, true);
      const dados = { type: 'interfone_perdida', id: String(idChamada) };
      await Promise.all(
        alvos.map((a) =>
          this.notifications
            .enviarParaAparelho(a.fcm_token, 'Interfone', `Chamada perdida do portão às ${hora}`, dados)
            .catch(() => undefined),
        ),
      );
    } catch (e: any) {
      this.logger.warn(`Interfone: aviso de chamada perdida ${idChamada} falhou: ${e?.message ?? e}`);
    }
  }

  /**
   * Aparelhos dos usuários, um por token. Usuário deslogado (Users.fcm_token
   * null) fica de fora, como no resto dos pushes; quem ainda não tem registro
   * em Users_Devices recebe no token antigo (tratado como app sem interfone).
   */
  private async aparelhos(idsUsuarios: number[], soQuemRecebe: boolean): Promise<Aparelho[]> {
    const ids = [...new Set(idsUsuarios.filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return [];
    const usuarios: { id: number; fcm_token: string | null }[] = await this.prisma.users.findMany({
      where: { id: { in: ids }, ...(soQuemRecebe ? { interfone_receber: 1 } : {}) },
      select: { id: true, fcm_token: true },
    });
    const ativos = usuarios.filter((u) => !!u.fcm_token);
    if (!ativos.length) return [];
    const registros: Aparelho[] = await this.prisma.users_Devices.findMany({
      where: { id_user: { in: ativos.map((u) => u.id) } },
      select: { id_user: true, fcm_token: true, plataforma: true, voip_token: true, interfone_versao: true },
    });
    const vistos = new Set<string>();
    const alvos: Aparelho[] = [];
    for (const u of ativos) {
      const doUsuario = registros.filter((a) => a.id_user === u.id && a.fcm_token);
      if (!doUsuario.length) {
        doUsuario.push({ id_user: u.id, fcm_token: u.fcm_token as string, plataforma: null, voip_token: null, interfone_versao: 0 });
      }
      for (const a of doUsuario) {
        if (vistos.has(a.fcm_token)) continue;
        vistos.add(a.fcm_token);
        alvos.push(a);
      }
    }
    return alvos;
  }
}
