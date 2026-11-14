import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ehFuncionarioDoApp, TenantAccessService } from '../auth/tenant-access.service';
import { VisitantesService } from '../visitantes/visitantes.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioApp } from '../auth/usuario-app.guard';
import { assertSindicoEstrito } from '../auth/tenant.util';
import { decryptSecret, encryptSecret } from '../facial/device-secret.util';
import { pessoasMigrationEnabled } from '../common/pessoas-migration.util';
import { rotuloBloco } from '../common/rotulo-bloco.util';
import { comLock } from '../common/lock-distribuido';
import { contadorDe, gerarCodigo, INTERVALO_MS } from './codigo-dinamico.util';

/** Mesmo padrão do link do convite (`convites.service.ts`). */
const BASE_URL_PADRAO = 'https://www.prestarecondominios.com.br';
const PASSE_INDISPONIVEL = 'Passe indisponível.';
/** `<id em base36>.<base64url de 32 bytes>` */
const TOKEN_LINK = /^([0-9a-z]{1,7})\.([A-Za-z0-9_-]{43})$/;
const SEGREDO_HEX = /^[0-9a-f]{64}$/i;
const OPCAO_DESLIGADA_LINK = 'QR no app está desligado neste condomínio';
/** Rótulo da derivação da chave do link: separa-a da chave do encryptSecret. */
const ROTULO_CHAVE_LINK = 'prestare/credenciais/link/v1';
/** Quanto a emissão espera pela outra chamada da mesma pessoa (GET_LOCK). */
const ESPERA_LOCK_MINHA_S = 5;

export type RespostaCredencialMinha =
  | { disponivel: true; id: number; segredo?: string; intervalo_s: 30; agora_servidor: string }
  | { disponivel: false; motivo: 'opcao_desligada' | 'sem_morador' };

export interface PassePublico {
  nome: string;
  condominio: string;
  unidade: string;
  valido_de: string | null;
  valido_ate: string | null;
  codigo: string;
  troca_em_s: number;
}

function exigirIdPositivo(valor: unknown, mensagem: string): number {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(mensagem);
  return id;
}

/**
 * Credencial dinâmica de acesso: emissão para o morador (o app gera o código
 * a partir do segredo), link do passe do visitante (a página pública busca o
 * código atual; o segredo não vai ao navegador) e a opção "QR no app".
 *
 * O segredo é devolvido só na emissão e guardado cifrado (encryptSecret). O
 * token do link é derivado (HMAC da chave do servidor com id e versao_link),
 * não é guardado; invalidar o link é incrementar `versao_link`.
 */
@Injectable()
export class CredenciaisService {
  private readonly logger = new Logger(CredenciaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantAccessService,
    private readonly visitantes: VisitantesService,
  ) {}

  // ===================== Morador (app) =====================

  async minha(
    user: JwtPayload,
    body: { id_condominio: number; renovar?: boolean },
    agora: Date = new Date(),
  ): Promise<RespostaCredencialMinha> {
    const p = this.prisma as any;
    const idCondominio = exigirIdPositivo(body?.id_condominio, 'id_condominio inválido.');
    const idUser = idUsuarioApp(user);
    await this.tenant.assertCondominio(idCondominio, user);

    // A pessoa é a linha de Moradores daquele usuário naquele condomínio; com
    // mais de uma (dois apartamentos), a primeira por id.
    const morador = await p.moradores.findFirst({
      where: { id_user: idUser, id_condominio: idCondominio },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!morador) return { disponivel: false, motivo: 'sem_morador' };
    if (!(await this.opcaoLigada(idCondominio))) return { disponivel: false, motivo: 'opcao_desligada' };

    const daPessoa = {
      id_condominio: idCondominio,
      tipo_pessoa: 'morador',
      id_pessoa: morador.id,
      origem: 'app',
      revogada_em: null,
    };
    // Uma ativa por pessoa, condomínio e origem. Ler, revogar e criar correm
    // sob um lock dessa chave (GET_LOCK, vale entre instâncias): sem ele, duas
    // chamadas juntas (dois toques, `renovar` repetido) liam "sem ativa" ou
    // revogavam ao mesmo tempo e deixavam duas credenciais ativas.
    const r = await comLock(
      this.prisma as any,
      `credenciais:minha:${idCondominio}:morador:${morador.id}:app`,
      async (): Promise<RespostaCredencialMinha> => {
        const ativa = await p.credenciais_Acesso.findFirst({ where: daPessoa, orderBy: { id: 'desc' } });
        if (ativa && body?.renovar !== true) {
          return { disponivel: true, id: ativa.id, intervalo_s: 30, agora_servidor: agora.toISOString() };
        }

        // Aparelho novo derruba o anterior.
        await p.credenciais_Acesso.updateMany({ where: daPessoa, data: { revogada_em: agora } });
        const segredo = randomBytes(32).toString('hex');
        const nova = await p.credenciais_Acesso.create({
          data: {
            id_condominio: idCondominio,
            tipo_pessoa: 'morador',
            id_pessoa: morador.id,
            segredo: encryptSecret(segredo),
            origem: 'app',
          },
        });
        return { disponivel: true, id: nova.id, segredo, intervalo_s: 30, agora_servidor: agora.toISOString() };
      },
      { esperaSegundos: ESPERA_LOCK_MINHA_S, duracaoMaximaMs: 30_000 },
    );
    if (!r.obtido) throw new ServiceUnavailableException('Credencial em emissão. Tente de novo.');
    return r.valor;
  }

  // ===================== Link do visitante (app) =====================

  async linkVisita(id: number, user: JwtPayload): Promise<{ url: string; valido_ate: string | null }> {
    const p = this.prisma as any;
    const ref = await this.visitantes.referenciaParaCredencial(exigirIdPositivo(id, 'Visita inválida.'), user);
    await this.assertPodeGerirLink(ref, user);
    if (!(await this.opcaoLigada(ref.id_condominio))) throw new ForbiddenException(OPCAO_DESLIGADA_LINK);
    if (!ref.codigo_acesso) throw new BadRequestException('Esta visita já foi encerrada.');
    this.chaveDoLink(true);

    const daVisita = {
      id_condominio: ref.id_condominio,
      tipo_pessoa: 'visita',
      origem: 'link',
      revogada_em: null,
      ...this.alvoDaVisita(ref),
    };
    let cred = await p.credenciais_Acesso.findFirst({ where: daVisita, orderBy: { id: 'desc' } });
    if (!cred) {
      cred = await p.credenciais_Acesso.create({
        data: {
          id_condominio: ref.id_condominio,
          tipo_pessoa: 'visita',
          id_pessoa: null,
          ...this.alvoDaVisita(ref),
          segredo: encryptSecret(randomBytes(32).toString('hex')),
          origem: 'link',
        },
      });
    }
    return {
      url: this.urlDoPasse(this.tokenDoLink(cred)),
      valido_ate: ref.data_hora_termino ? new Date(ref.data_hora_termino).toISOString() : null,
    };
  }

  async invalidarLink(id: number, user: JwtPayload): Promise<{ ok: true }> {
    const p = this.prisma as any;
    const ref = await this.visitantes.referenciaParaCredencial(exigirIdPositivo(id, 'Visita inválida.'), user);
    await this.assertPodeGerirLink(ref, user);
    await p.credenciais_Acesso.updateMany({
      where: {
        id_condominio: ref.id_condominio,
        tipo_pessoa: 'visita',
        origem: 'link',
        revogada_em: null,
        ...this.alvoDaVisita(ref),
      },
      data: { versao_link: { increment: 1 } },
    });
    return { ok: true };
  }

  // ===================== Passe público =====================

  /**
   * Dados e código atual do passe. Todo motivo de recusa responde o MESMO 404:
   * respostas diferentes virariam um oráculo de quais tokens existem.
   */
  async lerPassePublico(token: string, agora: Date = new Date()): Promise<PassePublico> {
    const p = this.prisma as any;
    const indisponivel = () => new NotFoundException(PASSE_INDISPONIVEL);

    const m = TOKEN_LINK.exec(typeof token === 'string' ? token : '');
    if (!m || !this.chaveDoLink(false)) throw indisponivel();
    const id = parseInt(m[1], 36);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff) throw indisponivel();

    const cred = await p.credenciais_Acesso.findUnique({ where: { id } });
    if (!cred || cred.tipo_pessoa !== 'visita' || cred.origem !== 'link' || cred.revogada_em) throw indisponivel();
    const esperado = Buffer.from(this.tokenDoLink(cred));
    const recebido = Buffer.from(m[0]);
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) throw indisponivel();

    const t = agora.getTime();
    if (cred.valido_de && t < new Date(cred.valido_de).getTime()) throw indisponivel();
    if (cred.valido_ate && t > new Date(cred.valido_ate).getTime()) throw indisponivel();

    const cond = await p.condominios.findUnique({
      where: { id: cred.id_condominio },
      select: { nome: true, qr_app_habilitado: true },
    });
    if (!cond?.qr_app_habilitado) throw indisponivel();

    // Mesmo espaço de id da validação no leitor: Visitas com a migração
    // ligada, Visitantes desligada.
    const idAlvo = pessoasMigrationEnabled(this.prisma) ? cred.id_visita : cred.id_visitante;
    if (idAlvo == null) throw indisponivel();
    const ref = await this.visitantes.referenciaParaCredencial(idAlvo).catch(() => null);
    if (!ref || ref.id_condominio !== cred.id_condominio || !ref.codigo_acesso) throw indisponivel();

    const segredo = decryptSecret(cred.segredo);
    if (!segredo || !SEGREDO_HEX.test(segredo)) {
      this.logger.warn(`Passe ${id}: segredo da credencial ilegível`);
      throw indisponivel();
    }

    const resto = t % INTERVALO_MS;
    return {
      nome: (ref.nome ?? '').trim().split(/\s+/)[0] ?? '',
      condominio: cond.nome ?? '',
      unidade: ref.apto
        ? ref.bloco
          ? `Apartamento ${ref.apto} · ${rotuloBloco(ref.bloco)}`
          : `Apartamento ${ref.apto}`
        : rotuloBloco(ref.bloco),
      valido_de: ref.data_hora_inicio ? new Date(ref.data_hora_inicio).toISOString() : null,
      valido_ate: ref.data_hora_termino ? new Date(ref.data_hora_termino).toISOString() : null,
      codigo: gerarCodigo('P1', cred.id, contadorDe(agora), Buffer.from(segredo, 'hex')),
      troca_em_s: Math.ceil((INTERVALO_MS - resto) / 1000),
    };
  }

  // ===================== Opção do condomínio =====================

  async lerOpcao(idCondominio: number, user: JwtPayload): Promise<{ qr_app_habilitado: boolean }> {
    const id = exigirIdPositivo(idCondominio, 'Condomínio inválido.');
    await this.tenant.assertCondominio(id, user);
    return { qr_app_habilitado: await this.opcaoLigada(id) };
  }

  /**
   * Liga/desliga "QR no app". Mexe em acesso físico (com a opção ligada o PIN
   * lido como QR deixa de abrir), então exige síndico pelo typeAccess, sem
   * aceitar o `turno` texto livre do porteiro.
   */
  async definirOpcao(
    idCondominio: number,
    valor: boolean,
    user: JwtPayload,
  ): Promise<{ qr_app_habilitado: boolean }> {
    const id = exigirIdPositivo(idCondominio, 'Condomínio inválido.');
    assertSindicoEstrito(user, 'alterar o QR no app');
    if (typeof valor !== 'boolean') throw new BadRequestException('qr_app_habilitado deve ser verdadeiro ou falso.');
    await this.tenant.assertCondominio(id, user);
    const r = await (this.prisma as any).condominios.update({
      where: { id },
      data: { qr_app_habilitado: valor },
      select: { qr_app_habilitado: true },
    });
    return { qr_app_habilitado: !!r.qr_app_habilitado };
  }

  // ===================== Apoio =====================

  /** Token do link: derivado, não guardado. Público para os testes. */
  tokenDoLink(cred: { id: number; versao_link: number }): string {
    const chave = this.chaveDoLink(true) as Buffer;
    const mac = createHmac('sha256', chave)
      .update(`passe-link|${cred.id}|${cred.versao_link}`)
      .digest('base64url');
    return `${cred.id.toString(36)}.${mac}`;
  }

  /**
   * Chave do link = HMAC-SHA256(sha256(FACIAL_CRED_KEY || JWT_SECRET),
   * "prestare/credenciais/link/v1"). A base é a mesma do encryptSecret, mas a
   * derivação com rótulo próprio separa as duas chaves: nada calculado com uma
   * serve para a outra. Sem nenhum dos dois segredos o token seria forjável:
   * a emissão recusa e a leitura responde 404.
   */
  private chaveDoLink(exigir: boolean): Buffer | null {
    const segredo = process.env.FACIAL_CRED_KEY || process.env.JWT_SECRET;
    if (!segredo) {
      if (exigir) throw new ServiceUnavailableException('Passe do visitante indisponível neste servidor.');
      return null;
    }
    const base = createHash('sha256').update(segredo).digest();
    return createHmac('sha256', base).update(ROTULO_CHAVE_LINK).digest();
  }

  /**
   * Link pela raiz, como o do convite (o hosting da portaria-web não reescreve
   * caminho profundo para o SPA), com o token no fragmento (`#passe=`): o
   * fragmento não vai para o servidor, então o token não aparece em log de
   * acesso, CDN nem Referer. A página lê o fragmento e o envia no corpo do
   * POST /api/passes/publico.
   */
  private urlDoPasse(token: string): string {
    const base = (process.env.CONVITE_BASE_URL ?? '').trim().replace(/\/+$/, '') || BASE_URL_PADRAO;
    return `${base}/#passe=${encodeURIComponent(token)}`;
  }

  /**
   * Funcionário do app só gera/invalida o link com a mesma permissão exigida
   * para cadastrar visitante (`cadastrar_visitante`) ou se for morador da
   * unidade da visita. Morador e síndico já foram conferidos por
   * `referenciaParaCredencial`.
   */
  private async assertPodeGerirLink(
    ref: { id_condominio: number; id_apartamento?: number | null },
    user: JwtPayload,
  ): Promise<void> {
    if (!ehFuncionarioDoApp(user)) return;
    try {
      await this.tenant.assertPermissaoFuncionario(ref.id_condominio, 'cadastrar_visitante', user);
      return;
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      const dono =
        ref.id_apartamento != null
          ? await (this.prisma as any).apartamentos_Users.findFirst({
              where: { id_user: idUsuarioApp(user), id_apto: ref.id_apartamento },
              select: { id_apto: true },
            })
          : null;
      if (!dono) throw e;
    }
  }

  private alvoDaVisita(ref: { espaco: 'visita' | 'visitante'; id: number }) {
    return ref.espaco === 'visita'
      ? { id_visita: ref.id, id_visitante: null }
      : { id_visita: null, id_visitante: ref.id };
  }

  private async opcaoLigada(idCondominio: number): Promise<boolean> {
    const cond = await (this.prisma as any).condominios.findUnique({
      where: { id: idCondominio },
      select: { qr_app_habilitado: true },
    });
    return !!cond?.qr_app_habilitado;
  }
}
