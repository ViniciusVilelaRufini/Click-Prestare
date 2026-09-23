import { ForbiddenException, Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { FacialService } from '../facial/facial.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';

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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(
      forwardRef(() => {
        // Lazy require em tempo de execução para evitar TDZ por import circular
        const { FacialService } = require('../facial/facial.service');
        return FacialService;
      }),
    )
    private readonly facial: FacialService,
  ) {}

  /** Expõe o PrismaService para os controllers do módulo quando necessário */
  get prismaClient(): PrismaService {
    return this.prisma;
  }

  private idDoUsuario(user: JwtPayload): number {
    // Users.id real: no token da portaria-web o `sub` é o id do operador em
    // Funcionarios_Portaria, e as rotas "do próprio usuário" revogavam a
    // biometria (e tiravam o rosto do terminal) do morador de mesmo número.
    const id = idUsuarioDoToken(user);
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
   * Revoga o consentimento de biometria facial do titular.
   *
   * 1. Grava novo registro append-only com `aceito: 0`.
   * 2. Localiza todos os moradores vinculados ao usuário.
   * 3. Chama `facial.unsyncMorador` para cada morador com face_id.
   * 4. Se todos os aparelhos removeram com sucesso: face_id = null, face_sync_status = 'revoked'.
   * 5. Se algum aparelho falhou (offline): face_sync_status = 'pending_removal' (preserva face_id para retry).
   */
  async revogarBiometria(target: JwtPayload | number, operadorNome?: string) {
    const idUser = typeof target === 'number' ? target : this.idDoUsuario(target);
    const registrado_em = new Date();

    // 1. Histórico LGPD: novo registro com aceito = 0
    await this.prisma.consentimentos.create({
      data: {
        id_user: idUser,
        tipo: 'biometria',
        versao: POLITICA_VERSAO,
        aceito: 0,
        registrado_em,
      },
    });

    this.logger.log(
      `Biometria facial revogada para usuário ${idUser} por ${operadorNome ?? 'próprio titular'}.`,
    );

    // 2. Localiza moradores vinculados
    const moradores = await this.prisma.moradores.findMany({
      where: { id_user: idUser },
    });

    let allRemoved = true;
    for (const m of moradores) {
      if (m.face_id && m.id_condominio) {
        const ok = await this.facial.unsyncMorador(m.id, m.face_id, m.id_condominio);
        if (ok) {
          await this.prisma.moradores.update({
            where: { id: m.id },
            data: {
              face_id: null,
              face_sync_status: 'revoked',
              face_sync_error: null,
              foto_pessoa: null,
            },
          });
        } else {
          allRemoved = false;
          await this.prisma.moradores.update({
            where: { id: m.id },
            data: {
              face_sync_status: 'pending_removal',
              face_sync_error: 'device_offline_pending_retry',
              foto_pessoa: null,
            },
          });
        }
      }
    }

    return {
      ok: true,
      revogado: true,
      status: allRemoved ? 'revoked' : 'pending_removal',
    };
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
