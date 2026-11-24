import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioApp } from '../auth/usuario-app.guard';
import { assertOperador } from '../auth/tenant.util';
import { autorDoToken } from '../auth/usuario-do-token.util';
import { decryptSecret, encryptSecret } from '../facial/device-secret.util';
import { comLock, executarComLock } from '../common/lock-distribuido';
import { hojeBrasilia, horaBrasilia } from '../common/hora-brasilia.util';
import { rotuloBloco } from '../common/rotulo-bloco.util';
import { CredenciaisValidacaoService } from '../credenciais/credenciais-validacao.service';
import { diaBrasiliaDe, gerarCodigo } from '../credenciais/codigo-dinamico.util';
import { carregarImagensDoPasse, DadosDoPasse, montarPasseApple } from './apple-passe.builder';
import { WalletChavesService } from './wallet-chaves.service';
import { ApplePassPushClient, RespostaApns, tokenMorto } from './apple-push.client';
import { WALLET_WEB_SERVICE_URL } from './wallet.constantes';
import { momentoTrocaSenha } from '../auth/senha-alterada.util';
import {
  credencialAnteriorATrocaDeSenha,
  motivoCredencialMoradorInvalida,
  revogarCredenciaisDeMoradores,
} from '../credenciais/credencial-morador-vigencia.util';

export const ORIGENS_WALLET = ['wallet_apple', 'wallet_google'] as const;

/** Troca do cliente de push nos testes. Em produção, o ApplePassPushClient. */
export const WALLET_APPLE_PUSH = 'WALLET_APPLE_PUSH';
export interface AvisoApple {
  avisar(pushToken: string): Promise<RespostaApns>;
}
/** Avisos simultâneos ao APNs (uma sessão HTTP/2 multiplexa). */
const AVISOS_EM_PARALELO = 20;
/** Lote do UPDATE da troca diária. */
const LOTE_MARCAR = 1000;

/**
 * Porta de calendário da troca diária: só na hora 0 de Brasília, uma vez por
 * data (AAAA-MM-DD de Brasília). Fora dela, null (o job nem roda).
 */
export function cicloDoTickWallet(agora: Date = new Date()): string | null {
  if (horaBrasilia(agora) !== 0) return null;
  return hojeBrasilia(agora).toISOString().slice(0, 10);
}

const SEGREDO_HEX = /^[0-9a-f]{64}$/i;
/** Rótulo da subchave do token do passe (ver chaveDoToken). */
const ROTULO_CHAVE_TOKEN = 'prestare/wallet/apple-token/v1';
const ESPERA_LOCK_S = 5;
const MSG_SEM_MORADOR = 'Seu usuário não tem unidade vinculada neste condomínio.';
const MSG_DESLIGADO = 'Passe na carteira não está ativo neste condomínio.';
const MSG_INDISPONIVEL = 'Passe na carteira indisponível no momento.';

export interface SituacaoWallet {
  habilitado: boolean;
  apple: { disponivel: boolean; ativo: boolean };
  google: { disponivel: boolean; ativo: boolean };
}

function exigirIdPositivo(valor: unknown, mensagem: string): number {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(mensagem);
  return id;
}

/** "Bloco A · Apto 12", omitindo a parte que não existe. */
function rotuloUnidade(bloco: string | null | undefined, apartamento: string | null | undefined): string {
  const partes = [rotuloBloco(bloco), (apartamento ?? '').trim() ? `Apto ${String(apartamento).trim()}` : ''];
  return partes.filter(Boolean).join(' · ');
}

/**
 * Passe do morador na carteira do celular (Apple Wallet).
 *
 * O passe é uma credencial própria em Credenciais_Acesso (origem
 * `wallet_apple`), com segredo separado do segredo do app, e mostra o código
 * diário P2. Uma ativa por pessoa, condomínio e origem: "adicionar de novo"
 * reentrega o mesmo passe (mesmo número de série). Cancelar pelo próprio
 * morador revoga só o passe; o cancelamento pelo operador ("perdeu o
 * celular") e os eventos de vida da conta (unidade tirada ou apagada, senha
 * trocada) revogam também o QR do app (origem `app`).
 *
 * O segredo, o código e o token do passe nunca vão para log nem para resposta
 * JSON: só dentro do .pkpass entregue ao dono.
 */
@Injectable()
export class WalletService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletService.name);
  private readonly push: AvisoApple;
  private readonly avisosPendentes = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly validacao: CredenciaisValidacaoService,
    private readonly chaves: WalletChavesService,
    private readonly tenant: TenantAccessService,
    private readonly auditoria: AuditoriaService,
    @Optional() @Inject(WALLET_APPLE_PUSH) push?: AvisoApple,
  ) {
    this.push = push ?? new ApplePassPushClient(() => this.chaves.apple());
  }

  /**
   * Troca diária do código: tentativa 5 min depois do boot e de hora em hora,
   * no padrão dos jobs do facial (GET_LOCK + cicloDeNegocio). Roda uma vez por
   * dia no cluster, em algum minuto entre 00:00 e 00:59 de Brasília; a
   * tolerância de um dia na validação cobre o atraso.
   */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const tick = () =>
      void executarComLock(
        this.prisma as any,
        'wallet:tickDiario',
        async () => {
          await this.tickDiario();
        },
        { cicloDeNegocio: () => cicloDoTickWallet() },
      );
    setTimeout(tick, 5 * 60 * 1000).unref?.();
    setInterval(tick, 60 * 60 * 1000).unref?.();
  }

  onModuleDestroy() {
    if (this.push instanceof ApplePassPushClient) this.push.fecharSessao();
  }

  // ===================== App (morador) =====================

  async situacao(user: JwtPayload, idCondominioBruto: unknown): Promise<SituacaoWallet> {
    const p = this.prisma as any;
    const idCondominio = exigirIdPositivo(idCondominioBruto, 'id_condominio inválido.');
    const idUser = idUsuarioApp(user);
    await this.tenant.assertCondominio(idCondominio, user);

    const morador = await this.linhaDeMorador(idUser, idCondominio);
    const [habilitado, chaves] = await Promise.all([
      this.validacao.walletHabilitado(idCondominio),
      this.chaves.apple(),
    ]);
    const ativa = async (origem: string) =>
      !!morador &&
      !!(await p.credenciais_Acesso.findFirst({
        where: { ...this.daPessoa(idCondominio, morador.id), origem, revogada_em: null },
        select: { id: true },
      }));
    return {
      habilitado: habilitado && !!morador,
      apple: { disponivel: !!chaves, ativo: await ativa('wallet_apple') },
      // Google Wallet ainda não publicado: o botão do Android fica oculto.
      google: { disponivel: false, ativo: await ativa('wallet_google') },
    };
  }

  async emitirApple(user: JwtPayload, body: { id_condominio: unknown }, agora: Date = new Date()): Promise<Buffer> {
    const p = this.prisma as any;
    const idCondominio = exigirIdPositivo(body?.id_condominio, 'id_condominio inválido.');
    const idUser = idUsuarioApp(user);
    await this.tenant.assertCondominio(idCondominio, user);

    const morador = await this.linhaDeMorador(idUser, idCondominio);
    if (!morador) throw new BadRequestException(MSG_SEM_MORADOR);
    if (!(await this.validacao.walletHabilitado(idCondominio))) throw new BadRequestException(MSG_DESLIGADO);
    const chaves = await this.chaves.apple();
    if (!chaves) throw new ServiceUnavailableException(MSG_INDISPONIVEL);
    this.chaveDoToken(true);

    // Ler e criar sob o lock da pessoa (GET_LOCK, vale entre instâncias): dois
    // toques juntos não criam duas credenciais ativas.
    const r = await comLock(
      p,
      this.nomeDoLock(idCondominio, morador.id),
      async () => {
        const ativa = await p.credenciais_Acesso.findFirst({
          where: { ...this.daPessoa(idCondominio, morador.id), origem: 'wallet_apple', revogada_em: null },
          orderBy: { id: 'desc' },
        });
        // Passe anterior à última troca de senha já sai anulado (passeAppleDaCredencial): reentregá-lo
        // deixaria o morador sem passe que abre. Revoga e emite outro.
        if (ativa && !(await credencialAnteriorATrocaDeSenha(p, ativa, idUser))) return ativa;
        if (ativa) {
          await p.credenciais_Acesso.updateMany({ where: { id: ativa.id, revogada_em: null }, data: { revogada_em: agora } });
        }
        return p.credenciais_Acesso.create({
          data: {
            id_condominio: idCondominio,
            tipo_pessoa: 'morador',
            id_pessoa: morador.id,
            segredo: encryptSecret(randomBytes(32).toString('hex')),
            origem: 'wallet_apple',
            wallet_atualizado_em: agora,
          },
        });
      },
      { esperaSegundos: ESPERA_LOCK_S, duracaoMaximaMs: 30_000 },
    );
    if (!r.obtido) throw new ServiceUnavailableException('Passe em emissão. Tente de novo.');

    const cred = r.valor;
    const segredo = this.segredoDe(cred);
    if (!segredo) throw new ServiceUnavailableException(MSG_INDISPONIVEL);
    const cond = await p.condominios.findUnique({ where: { id: idCondominio }, select: { nome: true } });
    const dia = diaBrasiliaDe(agora);
    return montarPasseApple(
      this.dadosDoPasse(cred.id, cond?.nome, morador, gerarCodigo('P2', cred.id, dia, segredo), dia),
      chaves,
      carregarImagensDoPasse(),
      agora,
    );
  }

  async cancelarDoUsuario(
    user: JwtPayload,
    body: { id_condominio: unknown },
    agora: Date = new Date(),
  ): Promise<{ ok: true }> {
    const idCondominio = exigirIdPositivo(body?.id_condominio, 'id_condominio inválido.');
    const idUser = idUsuarioApp(user);
    await this.tenant.assertCondominio(idCondominio, user);
    const morador = await this.linhaDeMorador(idUser, idCondominio);
    if (morador) await this.revogar(idCondominio, morador.id, agora);
    return { ok: true };
  }

  // ===================== Operador (portaria-web / síndico) =====================

  async cancelarPeloOperador(
    idMoradorBruto: unknown,
    operador: JwtPayload,
    agora: Date = new Date(),
  ): Promise<{ ok: true; cancelados: number; qr_app_cancelados: number }> {
    assertOperador(operador, 'cancelar o passe da carteira');
    const idMorador = exigirIdPositivo(idMoradorBruto, 'Morador inválido.');
    const p = this.prisma as any;
    const morador = await p.moradores.findUnique({
      where: { id: idMorador },
      select: { id: true, nome: true, id_condominio: true, id_user: true },
    });
    if (!morador) throw new NotFoundException('Morador não encontrado.');
    await this.tenant.assertCondominio(morador.id_condominio, operador);

    // A emissão prende o passe à primeira linha de Moradores do usuário no
    // condomínio (linhaDeMorador), e a ficha aberta pode ser a de outra
    // unidade dele: revoga em todas as linhas do mesmo usuário ali. Linha sem
    // usuário só tem a si mesma.
    const linhas: number[] = morador.id_user
      ? (
          await p.moradores.findMany({
            where: { id_user: morador.id_user, id_condominio: morador.id_condominio },
            select: { id: true },
          })
        ).map((m: { id: number }) => m.id)
      : [];
    if (!linhas.includes(morador.id)) linhas.push(morador.id);
    let cancelados = 0;
    for (const id of linhas) cancelados += await this.revogar(morador.id_condominio, id, agora);
    // O QR do app também: o segredo guardado no aparelho perdido gera o código sem internet. O app do
    // morador emite um novo na próxima abertura com sessão válida.
    const qrApp = await revogarCredenciaisDeMoradores(p, linhas, agora);
    // E as sessões da conta: com o JWT (365 dias) o aparelho perdido emitiria QR e passe novos na próxima
    // abertura com internet. senha_alterada_em derruba todo token anterior (JwtStrategy), inclusive o de
    // síndico ou funcionário que use a mesma conta; o morador entra de novo com a mesma senha.
    const sessoesEncerradas = !!morador.id_user;
    if (morador.id_user) {
      await p.users.updateMany({ where: { id: morador.id_user }, data: { senha_alterada_em: momentoTrocaSenha(agora.getTime()) } });
    }
    await this.auditoria.registrar({
      id_condominio: morador.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      ...autorDoToken(operador),
      acao: 'UPDATE',
      modulo: 'wallet',
      entidade_id: morador.id,
      descricao: sessoesEncerradas
        ? `Cancelou o passe da carteira e o QR do app de ${morador.nome} e encerrou as sessões do app da conta`
        : `Cancelou o passe da carteira e o QR do app de ${morador.nome}`,
      detalhes: { cancelados, qr_app_cancelados: qrApp, sessoes_encerradas: sessoesEncerradas },
    });
    return { ok: true, cancelados, qr_app_cancelados: qrApp };
  }

  /**
   * Morador excluído: revoga os passes de carteira dele e avisa os aparelhos
   * (o passe aparece inválido). A validação já nega por `morador_removido`;
   * isto só apressa a atualização do passe. Nunca lança.
   */
  async revogarDoMorador(idMorador: number, idCondominio: number, agora: Date = new Date()): Promise<void> {
    try {
      await this.revogar(idCondominio, idMorador, agora);
    } catch (e: any) {
      this.logger.warn(`Passes de carteira do morador ${idMorador} não foram revogados: ${e?.message ?? e}`);
    }
  }

  /**
   * Eventos de vida da conta (unidade tirada ou apagada, senha trocada): revoga o QR do app e os passes de
   * carteira das linhas de Moradores dadas e avisa os aparelhos (o passe aparece anulado). A leitura já nega
   * pela conferência de vínculo e de senha; isto deixa o estado gravado e o passe atualizado. Nunca lança.
   */
  async revogarCredenciaisDosMoradores(idsMoradores: number[], agora: Date = new Date()): Promise<void> {
    const ids = [...new Set(idsMoradores)].filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) return;
    try {
      const p = this.prisma as any;
      const carteira: Array<{ id: number }> = await p.credenciais_Acesso.findMany({
        where: { tipo_pessoa: 'morador', id_pessoa: { in: ids }, origem: { in: [...ORIGENS_WALLET] }, revogada_em: null },
        select: { id: true },
      });
      await revogarCredenciaisDeMoradores(p, ids, agora);
      await this.marcarAtualizado(carteira.map((c) => c.id));
    } catch (e: any) {
      this.logger.warn(`Credenciais dos moradores ${ids.join(',')} não foram revogadas: ${e?.message ?? e}`);
    }
  }

  /** `revogarCredenciaisDosMoradores` de todas as linhas de Moradores da conta (troca de senha). Nunca lança. */
  async revogarCredenciaisDaConta(idUser: number, agora: Date = new Date()): Promise<void> {
    try {
      const linhas: Array<{ id: number }> = await (this.prisma as any).moradores.findMany({
        where: { id_user: idUser },
        select: { id: true },
      });
      await this.revogarCredenciaisDosMoradores(linhas.map((l) => l.id), agora);
    } catch (e: any) {
      this.logger.warn(`Credenciais da conta ${idUser} não foram revogadas: ${e?.message ?? e}`);
    }
  }

  // ===================== Serviço da Apple =====================

  /**
   * O .pkpass atual de uma credencial `wallet_apple`, para o serviço de
   * atualização da Apple: válido com o código do dia, ou anulado (voided)
   * quando revogada ou morador removido. Opção do condomínio desligada não
   * anula: o passe segue com o código e o aviso "Passe pausado pelo
   * condomínio" no verso, e a validação nega (`carteira_desligada`); religar
   * volta ao normal. null quando a credencial não existe ou não é
   * wallet_apple. Sem chaves: 503.
   */
  async passeAppleDaCredencial(
    idCredencial: number,
    agora: Date = new Date(),
  ): Promise<{ pkpass: Buffer; atualizadoEm: Date } | null> {
    const p = this.prisma as any;
    const cred = await p.credenciais_Acesso.findUnique({ where: { id: idCredencial } });
    if (!cred || cred.origem !== 'wallet_apple' || cred.tipo_pessoa !== 'morador') return null;
    const chaves = await this.chaves.apple();
    if (!chaves) throw new ServiceUnavailableException(MSG_INDISPONIVEL);

    const [morador, cond, habilitado] = await Promise.all([
      cred.id_pessoa != null
        ? p.moradores.findUnique({
            where: { id: cred.id_pessoa },
            select: { id: true, nome: true, bloco: true, apartamento: true, id_condominio: true, id_user: true },
          })
        : null,
      p.condominios.findUnique({ where: { id: cred.id_condominio }, select: { nome: true } }),
      this.validacao.walletHabilitado(cred.id_condominio),
    ]);
    // Mesma conferência do leitor: a conta segue com unidade no condomínio e o passe é posterior à última
    // troca de senha. Sem isso o ex-morador recebia todo dia um passe novo.
    const moradorValido =
      morador &&
      morador.id_condominio === cred.id_condominio &&
      !(await motivoCredencialMoradorInvalida(p, cred, morador.id_user, cred.id_condominio))
        ? morador
        : null;
    const segredo = this.segredoDe(cred);
    const valido = !cred.revogada_em && !!moradorValido && !!segredo;
    const dia = diaBrasiliaDe(agora);
    const codigo = valido ? gerarCodigo('P2', cred.id, dia, segredo as Buffer) : null;
    const pkpass = montarPasseApple(
      {
        ...this.dadosDoPasse(
          cred.id,
          cond?.nome,
          moradorValido ?? { nome: 'Passe cancelado' },
          codigo,
          codigo !== null ? dia : null,
        ),
        pausado: !habilitado,
      },
      chaves,
      carregarImagensDoPasse(),
      agora,
    );
    return { pkpass, atualizadoEm: cred.wallet_atualizado_em ?? cred.criado_em ?? agora };
  }

  /**
   * `authenticationToken` do passe: base64url dos primeiros 24 bytes de
   * HMAC-SHA256(chaveDoToken, "wallet-auth|<id>"). Derivado, não guardado.
   * Sem segredo no servidor: 503.
   */
  tokenDoPasse(idCredencial: number): string {
    const chave = this.chaveDoToken(true) as Buffer;
    return createHmac('sha256', chave).update(`wallet-auth|${idCredencial}`).digest().subarray(0, 24).toString('base64url');
  }

  /** Mesma conta de `tokenDoPasse`, ou null sem segredo no servidor (para conferir sem lançar). */
  tokenDoPasseOuNulo(idCredencial: number): string | null {
    return this.chaveDoToken(false) ? this.tokenDoPasse(idCredencial) : null;
  }

  // ===================== Atualização dos passes =====================

  /** Hora gravada em `wallet_atualizado_em`, lida no momento da escrita (os testes trocam). */
  relogio: () => Date = () => new Date();

  /**
   * Grava `wallet_atualizado_em` nas credenciais dadas: o serviço da Apple
   * passa a listá-las como alteradas e entrega o passe novo.
   */
  async marcarAtualizado(idsCredencial: number[]): Promise<void> {
    const ids = [...new Set(idsCredencial)].filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) return;
    await this.gravarAtualizado(ids);
    // Avisa em segundo plano: o pedido de quem cancelou não espera o APNs
    // (até 8 s por aparelho). avisarApple nunca rejeita.
    const aviso = this.avisarApple(ids);
    this.avisosPendentes.add(aviso);
    void aviso.finally(() => this.avisosPendentes.delete(aviso));
  }

  /**
   * Marca os passes de carteira ativos dos condomínios com as duas opções
   * ligadas e avisa os aparelhos da Apple; cada aparelho busca o passe com o
   * código do dia. Sem chaves da Apple, só marca (o aviso sairia sem efeito).
   * Lança só se o banco falhar ao ler ou marcar (o ciclo não é dado como
   * feito e a hora seguinte tenta de novo); falha de aparelho não interrompe.
   */
  async tickDiario(): Promise<{ apple: number; google: number }> {
    const p = this.prisma as any;
    const creds: Array<{ id: number; origem: string }> = await p.credenciais_Acesso.findMany({
      where: {
        origem: { in: [...ORIGENS_WALLET] },
        revogada_em: null,
        condominio: { qr_app_habilitado: true, wallet_habilitado: true },
      },
      select: { id: true, origem: true },
    });
    await this.gravarAtualizado(creds.map((c) => c.id));

    const apple = creds.filter((c) => c.origem === 'wallet_apple').map((c) => c.id);
    let avisadas = 0;
    if (apple.length && (await this.chaves.apple())) {
      const r = await this.avisarApple(apple);
      avisadas = apple.length;
      this.logger.log(
        `Troca diária da carteira: ${apple.length} passe(s) da Apple, ${r.avisados} aviso(s), ${r.mortos} token(s) morto(s), ${r.falhas} falha(s)`,
      );
    }
    return { apple: avisadas, google: 0 };
  }

  /** Espera os avisos em segundo plano (testes e desligamento). */
  async aguardarAvisos(): Promise<void> {
    while (this.avisosPendentes.size) await Promise.all([...this.avisosPendentes]);
  }

  /**
   * Avisa por APNs os aparelhos registrados nas credenciais dadas. Token que o
   * APNs diz morto apaga aquele registro; outra falha só conta. Nunca lança.
   */
  async avisarApple(idsCredencial: number[]): Promise<{ avisados: number; mortos: number; falhas: number }> {
    const total = { avisados: 0, mortos: 0, falhas: 0 };
    const p = this.prisma as any;
    let registros: Array<{ id: number; push_token: string }> = [];
    try {
      if (!idsCredencial.length) return total;
      registros = await p.wallet_Registros.findMany({
        where: { id_credencial: { in: idsCredencial } },
        select: { id: true, push_token: true },
      });
    } catch (e: any) {
      this.logger.warn(`Avisos da carteira (Apple) não saíram: ${e?.message ?? e}`);
      return total;
    }
    const motivos = new Map<string, number>();
    for (let i = 0; i < registros.length; i += AVISOS_EM_PARALELO) {
      await Promise.all(
        registros.slice(i, i + AVISOS_EM_PARALELO).map(async (reg) => {
          let r: RespostaApns;
          try {
            r = await this.push.avisar(reg.push_token);
          } catch {
            r = { status: 0, motivo: 'erro' };
          }
          if (r.status === 200) {
            total.avisados++;
            return;
          }
          if (tokenMorto(r)) {
            total.mortos++;
            try {
              await p.wallet_Registros.deleteMany({ where: { id: reg.id } });
            } catch {
              /* sai na próxima */
            }
            return;
          }
          total.falhas++;
          const chave = `${r.status}${r.motivo ? ' ' + r.motivo : ''}`;
          motivos.set(chave, (motivos.get(chave) ?? 0) + 1);
        }),
      );
    }
    if (total.falhas) {
      const resumo = [...motivos].map(([m, n]) => `${m} (${n})`).join(', ');
      this.logger.warn(
        `Avisos da carteira (Apple): ${total.avisados} avisados, ${total.mortos} tokens mortos, ${total.falhas} falhas: ${resumo}`,
      );
    }
    return total;
  }

  /**
   * A opção do condomínio mudou de efeito: os passes ativos passam a ser
   * entregues pausados (ou sem o aviso de novo). Não revoga. Nunca lança.
   */
  async marcarCondominio(idCondominio: number): Promise<void> {
    try {
      const creds = await (this.prisma as any).credenciais_Acesso.findMany({
        where: { id_condominio: idCondominio, origem: { in: [...ORIGENS_WALLET] }, revogada_em: null },
        select: { id: true },
      });
      await this.marcarAtualizado(creds.map((c: { id: number }) => c.id));
    } catch (e: any) {
      this.logger.warn(`Passes de carteira do condomínio ${idCondominio} não foram marcados: ${e?.message ?? e}`);
    }
  }

  // ===================== Apoio =====================

  private daPessoa(idCondominio: number, idMorador: number) {
    return { id_condominio: idCondominio, tipo_pessoa: 'morador', id_pessoa: idMorador };
  }

  private nomeDoLock(idCondominio: number, idMorador: number) {
    return `credenciais:wallet:${idCondominio}:morador:${idMorador}`;
  }

  /** Mesma regra de `credenciais/minha`: a primeira linha de Moradores do usuário no condomínio. */
  private linhaDeMorador(idUser: number, idCondominio: number) {
    return (this.prisma as any).moradores.findFirst({
      where: { id_user: idUser, id_condominio: idCondominio },
      orderBy: { id: 'asc' },
      select: { id: true, nome: true, bloco: true, apartamento: true },
    });
  }

  /** Revoga as credenciais de carteira ativas da pessoa e marca as revogadas. Devolve quantas. */
  private async revogar(idCondominio: number, idMorador: number, agora: Date): Promise<number> {
    const p = this.prisma as any;
    const r = await comLock(
      p,
      this.nomeDoLock(idCondominio, idMorador),
      async () => {
        const ativas = await p.credenciais_Acesso.findMany({
          where: { ...this.daPessoa(idCondominio, idMorador), origem: { in: [...ORIGENS_WALLET] }, revogada_em: null },
          select: { id: true },
        });
        const ids: number[] = ativas.map((c: { id: number }) => c.id);
        if (ids.length) {
          await p.credenciais_Acesso.updateMany({
            where: { id: { in: ids }, revogada_em: null },
            data: { revogada_em: agora },
          });
        }
        return ids;
      },
      { esperaSegundos: ESPERA_LOCK_S, duracaoMaximaMs: 30_000 },
    );
    if (!r.obtido) throw new ServiceUnavailableException('Passe em emissão. Tente de novo.');
    await this.marcarAtualizado(r.valor);
    return r.valor.length;
  }

  /**
   * `wallet_atualizado_em` = hora do momento da escrita, nunca menor que a
   * gravada: o serviço da Apple compara com o `passesUpdatedSince` do
   * aparelho, e um valor que andasse para trás (instante lido no começo de um
   * pedido lento, relógio de outra instância) sumiria da lista de alterados.
   * A condição fica no WHERE do próprio UPDATE: atômica por linha.
   */
  private async gravarAtualizado(ids: number[]): Promise<void> {
    const p = this.prisma as any;
    for (let i = 0; i < ids.length; i += LOTE_MARCAR) {
      const momento = this.relogio();
      await p.credenciais_Acesso.updateMany({
        where: {
          id: { in: ids.slice(i, i + LOTE_MARCAR) },
          OR: [{ wallet_atualizado_em: null }, { wallet_atualizado_em: { lt: momento } }],
        },
        data: { wallet_atualizado_em: momento },
      });
    }
  }

  private dadosDoPasse(
    idCredencial: number,
    condominio: string | null | undefined,
    morador: { nome?: string | null; bloco?: string | null; apartamento?: string | null },
    codigo: string | null,
    /** Mesmo contador usado em gerarCodigo; null no passe anulado. */
    diaDoCodigo: number | null,
  ): DadosDoPasse {
    return {
      serial: `c${idCredencial}`,
      authToken: this.tokenDoPasse(idCredencial),
      webServiceUrl: WALLET_WEB_SERVICE_URL,
      condominio: condominio ?? '',
      morador: morador.nome ?? '',
      unidade: rotuloUnidade(morador.bloco, morador.apartamento),
      codigo,
      diaDoCodigo,
    };
  }

  private segredoDe(cred: { segredo: string }): Buffer | null {
    const hex = decryptSecret(cred.segredo);
    return hex && SEGREDO_HEX.test(hex) ? Buffer.from(hex, 'hex') : null;
  }

  /**
   * Chave do token = HMAC-SHA256(sha256(FACIAL_CRED_KEY || JWT_SECRET),
   * "prestare/wallet/apple-token/v1"), como a chave do link do visitante
   * (credenciais.service.ts, chaveDoLink). A base sozinha é a chave do
   * encryptSecret; o rótulo próprio separa as duas: nada calculado com uma
   * serve para a outra.
   */
  private chaveDoToken(exigir: boolean): Buffer | null {
    const segredo = process.env.FACIAL_CRED_KEY || process.env.JWT_SECRET;
    if (!segredo) {
      if (exigir) throw new ServiceUnavailableException(MSG_INDISPONIVEL);
      return null;
    }
    const base = createHash('sha256').update(segredo).digest();
    return createHmac('sha256', base).update(ROTULO_CHAVE_TOKEN).digest();
  }
}
