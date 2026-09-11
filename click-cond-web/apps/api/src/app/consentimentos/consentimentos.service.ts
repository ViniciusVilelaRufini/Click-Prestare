import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Versão do texto de privacidade vigente.
 *
 * Trocou o texto de forma relevante, troca isto: quem aceitou a versão
 * anterior vê a tela de novo. Sem versão, "aceitei" é uma afirmação sobre um
 * texto que ninguém sabe mais qual era.
 */
export const POLITICA_VERSAO = '2026-09';

export type TipoConsentimento = 'privacidade' | 'biometria';

/**
 * Consentimento LGPD do titular.
 *
 * Tabela append-only: a revogação é um registro novo, nunca a edição do
 * anterior (Art. 8º, §5º). O estado atual é a linha mais recente por
 * (usuário, tipo).
 */
@Injectable()
export class ConsentimentosService {
  private readonly logger = new Logger(ConsentimentosService.name);

  constructor(private readonly prisma: PrismaService) {}

  private idDoUsuario(user: JwtPayload): number {
    const id = Number(user?.user?.id ?? user?.sub);
    if (!id) throw new ForbiddenException('Sessão sem usuário.');
    return id;
  }

  /** Último registro de um tipo, ou null se nunca houve. */
  private async ultimo(idUser: number, tipo: TipoConsentimento) {
    return this.prisma.consentimentos.findFirst({
      where: { id_user: idUser, tipo },
      orderBy: { registrado_em: 'desc' },
    });
  }

  /**
   * O que falta aceitar. O app chama no login e no bootstrap — este segundo
   * porque quem entra por auto-login nunca passa pela tela de login e, sem
   * ele, jamais veria o aceite.
   */
  async pendentes(user: JwtPayload) {
    const idUser = this.idDoUsuario(user);
    const privacidade = await this.ultimo(idUser, 'privacidade');

    // Só o aceite de privacidade bloqueia. A biometria é opcional por
    // exigência do Art. 8º, §3º (consentimento livre): se recusá-la impedisse
    // o uso do app, seria condição de uso, não consentimento.
    const precisaAceitar =
      !privacidade || privacidade.aceito !== 1 || privacidade.versao !== POLITICA_VERSAO;

    const biometria = await this.ultimo(idUser, 'biometria');

    return {
      precisaAceitar,
      versao: POLITICA_VERSAO,
      biometria: {
        // Perguntamos de novo quando a versão muda, mas sem bloquear.
        respondida: !!biometria && biometria.versao === POLITICA_VERSAO,
        aceita: biometria?.aceito === 1,
      },
    };
  }

  /**
   * Grava o aceite. Sempre INSERT — nunca UPDATE.
   *
   * `privacidade: false` também é gravado: a recusa é um fato com
   * consequência (o app desloga) e precisa constar no histórico.
   */
  async registrar(user: JwtPayload, dados: { privacidade: boolean; biometria: boolean }) {
    const idUser = this.idDoUsuario(user);
    const registrado_em = new Date();

    await this.prisma.consentimentos.createMany({
      data: [
        {
          id_user: idUser,
          tipo: 'privacidade',
          versao: POLITICA_VERSAO,
          aceito: dados.privacidade ? 1 : 0,
          registrado_em,
        },
        {
          id_user: idUser,
          tipo: 'biometria',
          versao: POLITICA_VERSAO,
          aceito: dados.biometria ? 1 : 0,
          registrado_em,
        },
      ],
    });

    this.logger.log(
      `Consentimento ${POLITICA_VERSAO} do usuário ${idUser}: ` +
        `privacidade=${dados.privacidade}, biometria=${dados.biometria}`,
    );

    return { ok: true, versao: POLITICA_VERSAO };
  }

  /**
   * O titular autorizou o uso da biometria facial?
   *
   * É isto que faz a caixa da tela valer alguma coisa. Uma caixa de
   * consentimento que o sistema ignora é PIOR que caixa nenhuma: produz
   * aparência de conformidade sem a substância.
   *
   * Responde `false` quando não há registro — ausência de consentimento não é
   * consentimento. Vale para qualquer versão aceita: quem autorizou na versão
   * anterior e ainda não respondeu a nova continua autorizado, porque revogar
   * exige ato do titular, não passagem do tempo.
   */
  async autorizouBiometria(idUser: number): Promise<boolean> {
    if (!idUser) return false;
    const ultimo = await this.ultimo(idUser, 'biometria');
    return ultimo?.aceito === 1;
  }
}
