import { ForbiddenException, Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PREFIXOS_FOTO_MORADOR, StorageService } from '../common/storage/storage.service';
import type { FacialService } from '../facial/facial.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { usuarioTemVinculoEmOutroCondominio } from '../common/vinculos-usuario.util';

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
 * `Moradores.face_sync_error` da linha cuja biometria o operador revogou naquele condomínio. A recusa
 * global não é gravada (é do titular), então é esta marca que impede o `syncMorador` e o
 * `syncReservaArea` de matricular o rosto de novo ali até uma nova resposta do titular (`registrar`,
 * que a limpa: "sim" libera, "não" vira recusa global). Com ela, `pendentes` pede o aceite de novo.
 * `face_sync_status` segue `'revoked'` para as telas.
 */
export const REVOGADO_PELO_OPERADOR = 'revogado_pelo_operador';

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
    @Optional() private readonly storage?: StorageService,
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
    const biometria = await this.ultimo(idUser, 'biometria');

    // Biometria revogada pelo operador em algum condomínio: o aceite global segue 1, mas o rosto só
    // volta com uma nova resposta do titular — então a tela de aceite precisa aparecer (o app só a
    // mostra com precisaAceitar). A resposta, sim ou não, passa a valer e tira a marca (registrar).
    const revogadaPeloOperador =
      (await this.prisma.moradores.count({
        where: { id_user: idUser, face_sync_error: REVOGADO_PELO_OPERADOR },
      })) > 0;

    const precisaAceitar =
      !privacidade ||
      privacidade.aceito !== 1 ||
      privacidade.versao !== POLITICA_VERSAO ||
      revogadaPeloOperador;

    return {
      precisaAceitar,
      versao: POLITICA_VERSAO,
      biometria: {
        // Perguntamos de novo quando a versão muda, mas sem bloquear.
        respondida: !revogadaPeloOperador && !!biometria && biometria.versao === POLITICA_VERSAO,
        aceita: !revogadaPeloOperador && biometria?.aceito === 1,
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

    // A resposta do titular, posterior à revogação do operador, passa a valer nos cadastros que ele
    // tinha revogado (R5b): "sim" desbloqueia; "não" vira a recusa global gravada acima, que bloqueia
    // em todo condomínio até um novo "sim". Sem a marca, a tela de aceite não é pedida a cada login.
    await this.prisma.moradores.updateMany({
      where: { id_user: idUser, face_sync_error: REVOGADO_PELO_OPERADOR },
      data: { face_sync_error: null },
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
   *
   * Com `idCondominio` (operador): age só nos moradores desse condomínio, não grava a recusa (1), só
   * limpa a foto em Users se a conta não é de outro condomínio e só apaga do storage a foto que mais
   * nada referencia. Cada linha desse condomínio recebe `REVOGADO_PELO_OPERADOR` em face_sync_error:
   * o rosto não é matriculado de novo ali até um novo aceite de biometria do titular.
   */
  async revogarBiometria(target: JwtPayload | number, operadorNome?: string, idCondominio?: number) {
    const idUser = typeof target === 'number' ? target : this.idDoUsuario(target);
    const registrado_em = new Date();
    // Operador (síndico/portaria) só administra o cadastro do condomínio dele. A recusa global e os
    // cadastros de outros condomínios são do titular (POST /consentimentos/revogar-biometria).
    const escopo = idCondominio != null ? Number(idCondominio) : null;

    // 1. Histórico LGPD: novo registro com aceito = 0 — só na revogação do próprio titular.
    if (escopo == null) {
      await this.prisma.consentimentos.create({
        data: {
          id_user: idUser,
          tipo: 'biometria',
          versao: POLITICA_VERSAO,
          aceito: 0,
          registrado_em,
        },
      });
    }

    this.logger.log(
      `Biometria facial revogada para usuário ${idUser}` +
        (escopo != null ? ` no condomínio ${escopo}` : '') +
        ` por ${operadorNome ?? 'próprio titular'}.`,
    );

    // 2. Localiza moradores vinculados
    const moradores = await this.prisma.moradores.findMany({
      where: { id_user: idUser, ...(escopo != null && { id_condominio: escopo }) },
    });

    let allRemoved = true;
    const fotos = new Set<string>();
    // Operador: sem recusa global, a marca na linha é o que impede o recadastro do rosto aqui (R5b).
    const marcaOperador = escopo != null ? REVOGADO_PELO_OPERADOR : null;
    for (const m of moradores) {
      if (m.foto_pessoa) fotos.add(m.foto_pessoa);
      if (m.face_id && m.id_condominio) {
        const ok = await this.facial.unsyncMorador(m.id, m.face_id, m.id_condominio);
        if (ok) {
          await this.prisma.moradores.update({
            where: { id: m.id },
            data: {
              face_id: null,
              face_sync_status: 'revoked',
              face_sync_error: marcaOperador,
              foto_pessoa: null,
            },
          });
        } else {
          allRemoved = false;
          await this.prisma.moradores.update({
            where: { id: m.id },
            data: {
              face_sync_status: 'pending_removal',
              face_sync_error: marcaOperador ?? 'device_offline_pending_retry',
              foto_pessoa: null,
            },
          });
        }
      } else if (marcaOperador) {
        // Sem rosto no aparelho: a foto (se houver) sai do banco e a linha fica bloqueada mesmo assim.
        await this.prisma.moradores.update({
          where: { id: m.id },
          data: { foto_pessoa: null, face_sync_status: 'revoked', face_sync_error: marcaOperador },
        });
      } else if (m.foto_pessoa) {
        // Foto guardada mas nunca enrolada (sem face_id): sai do banco também.
        await this.prisma.moradores.update({ where: { id: m.id }, data: { foto_pessoa: null } });
      }
    }

    // O banco só guardava o LINK: o objeto (public-read) seguia no storage para quem já tinha a URL.
    // Users.photo/profile_image recebem a mesma URL no cadastro; apagado o objeto, apontariam para nada.
    if (fotos.size > 0) {
      const urls = [...fotos];
      // Revogação só deste condomínio: Users é global — se a conta também é de outro condomínio, a foto
      // dela fica como está; se é só daqui, sai como na revogação do titular.
      const limparConta =
        escopo == null || !(await usuarioTemVinculoEmOutroCondominio(this.prisma as any, idUser, escopo));
      if (limparConta) {
        await this.prisma.users.updateMany({ where: { id: idUser, photo: { in: urls } }, data: { photo: null } });
        await this.prisma.users.updateMany({ where: { id: idUser, profile_image: { in: urls } }, data: { profile_image: null } });
      }
      for (const url of urls) {
        if (escopo != null) {
          // A mesma URL pode seguir na conta ou no cadastro de outro condomínio: aí fica no storage.
          // Os cadastros daqui já foram zerados acima.
          const [naConta, emOutroCadastro] = await Promise.all([
            this.prisma.users.count({ where: { id: idUser, OR: [{ photo: url }, { profile_image: url }] } }),
            this.prisma.moradores.count({ where: { foto_pessoa: url } }),
          ]);
          if (naConta + emOutroCadastro > 0) continue;
        }
        await this.storage?.deleteUrl(url, PREFIXOS_FOTO_MORADOR).catch(() => false);
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
