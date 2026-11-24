import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { limitarConcorrencia } from '../common/limitar-concorrencia';
import { assertEmailNaoReservado } from '../common/email-reservado.util';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { type Gravados, PREFIXOS_FOTO_MORADOR, StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { SuperlogicaWriteService } from '../superlogica/superlogica-write.service';
import { WalletService } from '../wallet/wallet.service';
import { MobileAuthService } from '../auth/mobile-auth.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';
import { momentoTrocaSenha } from '../auth/senha-alterada.util';
import * as bcrypt from 'bcrypt';
import { MSG_CONTA_DE_OUTRO_CONDOMINIO, ehVinculoUnidadeRepetido, usuarioTemVinculoEmOutroCondominio, usuarioTemVinculoNoCondominio, usuariosComVinculoEmOutroCondominio } from '../common/vinculos-usuario.util';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { randomBytes } from 'crypto';
import { calcularIdade, temTermoResponsavel, validarBiometria, validarMaioridade } from '../common/idade.util';

import { chaveUnidade, normalizarBloco, rotuloBloco } from '../common/rotulo-bloco.util';
import { validarCodigoTag } from '../common/tag-codigo.util';
import { assertTagNaoEmUso } from '../common/tag-em-uso.util';
import { REVOGADO_PELO_OPERADOR, lerBiometriaAutorizada } from '../consentimentos/consentimentos.service';
import { GuaritaOperacoesService } from '../guarita/guarita-operacoes.service';
export interface CreateMoradorDto {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  data_nascimento?: string;
  tipo?: string;
  id_apartamento: number;
  id_condominio: number;
  sendCredentials?: boolean;
  /**
   * Não enviar este morador à Superlógica.
   *
   * Usado quando ele VEIO de lá (importação): sem isso o envio automático o
   * mandaria de volta e criaria contato duplicado na unidade.
   */
  skipSuperlogica?: boolean;
  foto_pessoa?: string;
  foto_documento?: string;
  tag_rfid?: string;
  qrcode_acesso?: string;
  /**
   * Só na edição: a unidade que o formulário mostrava antes da troca. Com ela, trocar a unidade
   * troca só aquele vínculo e mantém as outras unidades do morador no condomínio.
   */
  id_apartamento_anterior?: number;
}

/** Recusa da edição quando a unidade da linha e a anterior da tela são vínculos diferentes (sai com a mensagem, não a genérica). */
class UnidadeDaTelaDivergente extends BadRequestException {}

/** Campos da conta (Users) que decidem o caminho do "Enviar Acesso". */
const SELECAO_CONTA_ENVIO = {
  id: true,
  email: true,
  login: true,
  password: true,
  senha_alterada_em: true,
  fcm_token: true,
  is_sindico: true,
  is_funcionario: true,
  _count: { select: { devices: true, sindicos: true, sindicosCondominios: true, funcionarios: true } },
} as const;

type ContaEnvioAcesso = {
  id?: number;
  email?: string | null;
  login?: string | null;
  password?: string | null;
  senha_alterada_em?: Date | string | null;
  fcm_token?: string | null;
  is_sindico?: number | null;
  is_funcionario?: number | null;
  _count?: { devices?: number; sindicos?: number; sindicosCondominios?: number; funcionarios?: number } | null;
};

/**
 * Evidência de que a conta já entrou no app: senha trocada/definida depois da criação
 * (`senha_alterada_em`: redefinição, troca no app ou senha inicial já enviada), ou aparelho com push
 * registrado (`fcm_token` / Users_Devices). A senha aleatória do cadastro sozinha não conta.
 */
export const MSG_EMAIL_ACESSO_FALHOU =
  'Não conseguimos enviar o e-mail agora. O morador ainda não tem acesso; tente de novo.';
export const MSG_AVISO_EMAIL_CADASTRO =
  'Morador cadastrado, mas o e-mail de acesso não saiu. Use "Enviar acesso" para tentar de novo.';

/** Tempo total que a importação espera pelos e-mails antes de responder; o que sobra segue em segundo plano. */
export const ORCAMENTO_ENVIO_IMPORTACAO_MS = 25_000;
/** Prazo absoluto da importação, contado do início (cadastro das linhas + espera dos e-mails): fica abaixo dos ~60 s do ALB. */
export const PRAZO_TOTAL_IMPORTACAO_MS = 40_000;
/** Falhas seguidas que fazem a importação parar de tentar enviar (SMTP fora do ar). */
const FALHAS_SEGUIDAS_PARA_PARAR = 3;

export function jaAcessouApp(conta: ContaEnvioAcesso | null | undefined): boolean {
  if (!conta) return false;
  return !!conta.senha_alterada_em || !!(conta.fcm_token ?? '').trim() || (conta._count?.devices ?? 0) > 0;
}

/**
 * A conta tem outro papel além de morador: síndico (flag, perfil em Sindicos ou vínculo em
 * Sindicos_Condominios), equipe (flag ou Funcionarios em qualquer condomínio) ou o login de uma linha de
 * portaria. Quem só usa o console web não deixa push nem senha_alterada_em — a senha dela nunca é trocada
 * pelo "Enviar Acesso" do morador.
 */
export function temOutroPapel(conta: ContaEnvioAcesso | null | undefined, loginDePortaria: boolean): boolean {
  if (!conta) return false;
  const c = conta._count ?? {};
  return (
    Number(conta.is_sindico ?? 0) === 1 ||
    Number(conta.is_funcionario ?? 0) === 1 ||
    (c.sindicos ?? 0) > 0 ||
    (c.sindicosCondominios ?? 0) > 0 ||
    (c.funcionarios ?? 0) > 0 ||
    loginDePortaria
  );
}

/**
 * Caminho do "Enviar Acesso" — a mesma regra decide a API e o `envio_acesso_por_link` da lista.
 * 'link' (a senha nunca é trocada daqui): conta com outro papel (síndico, equipe, portaria), conta também
 * de outro condomínio, ou conta com login e senha que já usou o app.
 * 'senha' (credencial inicial): conta nova, sem login, ou exclusivamente de morador deste condomínio que
 * nunca entrou.
 */
export function modoEnvioAcesso(
  conta: ContaEnvioAcesso | null | undefined,
  ctx: { outroCondominio: boolean; loginDePortaria: boolean },
): 'link' | 'senha' {
  if (temOutroPapel(conta, ctx.loginDePortaria)) return 'link';
  if (!(conta?.login ?? '').trim()) return 'senha';
  if (ctx.outroCondominio) return 'link';
  return conta!.password && jaAcessouApp(conta) ? 'link' : 'senha';
}

/**
 * Vínculos (Apartamentos_Users) da unidade de uma linha de Moradores, pelo bloco/apto gravados nela.
 * Linha sem apto não aponta unidade nenhuma.
 */
function vinculosDaUnidade<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(
  vinculos: T[],
  bloco: string | null | undefined,
  apto: string | null | undefined,
): T[] {
  if (!(apto ?? '').trim()) return [];
  const chave = chaveUnidade(bloco, apto);
  return vinculos.filter((v) => v.apartamento && chaveUnidade(v.apartamento.bloco, v.apartamento.apto) === chave);
}

/**
 * Unidade que a tela mostra para uma linha de Moradores: o vínculo deste condomínio com o bloco/apto
 * da linha. Sem correspondência, só um vínculo único serve; com vários, 0 (a tela não chuta a unidade
 * de outra linha do mesmo morador, que a edição trocaria por engano).
 */
function idApartamentoDaLinha(
  linha: { bloco: string | null; apartamento: string | null },
  vinculosDoCondominio: Array<{ id_apto: number; apartamento?: { bloco: string | null; apto: string | null } | null }>,
): number {
  const daLinha = vinculosDaUnidade(vinculosDoCondominio, linha.bloco, linha.apartamento);
  if (daLinha.length > 0) return daLinha[0].id_apto;
  return vinculosDoCondominio.length === 1 ? vinculosDoCondominio[0].id_apto : 0;
}

@Injectable()
export class MoradoresService {
  private static mockMoradores = [
    { id: 1, nome: 'João da Silva', documento: '11122233344', email: 'joao@example.com', telefone: '11999998888', data_nascimento: null, tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 0, id_condominio: 1, photo: null, foto_pessoa: null, foto_documento: null },
    { id: 2, nome: 'Maria Oliveira', documento: '55566677788', email: 'maria@example.com', telefone: '11988887777', data_nascimento: null, tipo: 'inquilino', bloco: 'B', apartamento: '202', id_apartamento: 0, id_condominio: 1, photo: null, foto_pessoa: null, foto_documento: null },
  ];

  private readonly logger = new Logger(MoradoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly auditoria: AuditoriaService,
    private readonly superlogicaWrite: SuperlogicaWriteService,
    @Optional() private readonly wallet?: WalletService,
    // "Enviar Acesso" para conta que já tem senha: o mesmo link do "Esqueci a senha" do morador.
    @Optional() private readonly mobileAuth?: MobileAuthService,
    // Módulo Guarita: o morador que sai tem os dispositivos dele removidos do Guarita.
    @Optional() private readonly guarita?: GuaritaOperacoesService,
  ) {}

  private gerarSenhaAleatoria(): string {
    return randomBytes(4).toString('hex');
  }

  private parseDate(dateStr: string | Date | null | undefined): Date | null {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    const s = String(dateStr).trim();
    if (!s || s === 'null' || s === 'undefined') return null;

    if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
      const parts = s.split(' ')[0].split('/');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Contexto rico para auditoria de morador: identificação, apartamento,
   * status de credenciais (RFID, QR, foto facial). Responde no painel:
   * "qual morador, em qual apto, com quais credenciais habilitadas".
   */
  private async carregarContextoMorador(idMorador: number) {
    const m = await this.prisma.moradores.findUnique({ where: { id: idMorador } });
    if (!m) return null;

    const aptoLabel = m.bloco
      ? `${rotuloBloco(m.bloco)}, Apto ${m.apartamento}`
      : (m.apartamento ? `Apto ${m.apartamento}` : null);

    return {
      morador: {
        id: m.id,
        nome: m.nome,
        documento: m.documento,
        email: m.email,
        telefone: m.telefone,
        tipo: m.tipo,
      },
      apartamento: aptoLabel
        ? { bloco: m.bloco, numero: m.apartamento, label: aptoLabel }
        : null,
      credenciais: {
        temTagRfid: !!(m as any).tag_rfid,
        temQrCode: !!(m as any).qrcode_acesso,
        temFacial: !!m.face_id,
        statusFacial: m.face_sync_status,
      },
    };
  }

  /**
   * Funcionarios_Portaria.login é único só na própria tabela: gravar o mesmo valor em Users.login
   * (conta nova, ou login novo numa conta existente) misturava os dois namespaces de login.
   * Mesma mensagem neutra do conflito de e-mail no update (não diz que é de um porteiro).
   */
  private async assertLoginLivreDaPortaria(login: string | null | undefined): Promise<void> {
    if (!login) return;
    const emUso = await this.prisma.funcionarios_Portaria.count({ where: { login } });
    if (emUso > 0) throw new BadRequestException('Já existe outro usuário com este e-mail.');
  }

  private fireFacialSync(idMorador: number) {
    this.facial
      .syncMorador(idMorador)
      .catch((err) => this.logger.warn(`Sync facial morador ${idMorador} falhou: ${err?.message ?? err}`));
  }

  /**
   * Envia o e-mail de acesso e ESPERA o resultado: falha (inclusive "sem provedor de e-mail configurado")
   * sobe como erro, para quem chama não dizer "acesso enviado" sem ter saído.
   */
  private async enviarEmailAcesso(email: string, nome: string, senha?: string): Promise<void> {
    try {
      if (senha) await this.mail.sendWelcomeMorador(email, nome, senha);
      else await this.mail.sendWelcomeMoradorExisting(email, nome);
    } catch (err: any) {
      this.logger.warn(`Falha ao enviar acesso para ${email}: ${err?.message ?? err}`);
      throw err;
    }
  }

  private fireWelcomeEmail(email: string, nome: string, senha?: string) {
    if (senha) {
      this.mail
        .sendWelcomeMorador(email, nome, senha)
        .catch((err) => this.logger.warn(`Falha ao enviar credenciais para ${email}: ${err?.message ?? err}`));
    } else {
      this.mail
        .sendWelcomeMoradorExisting(email, nome)
        .catch((err) => this.logger.warn(`Falha ao enviar boas-vindas para ${email}: ${err?.message ?? err}`));
    }
  }

  /**
   * `gravados`: fotos que o cadastro já tem. URL do bucket fora disso é
   * recusada — a API assina toda URL do bucket que devolve
   * (StorageService.exigirArquivoDoRegistro).
   */
  private async resolveFoto(value: string | undefined | null, gravados: Gravados): Promise<string | null> {
    // Qualquer vazio (null/undefined/"") vira null — "" no banco contaria como
    // "tem foto" (foto_pessoa != null) e quebraria o status e o "Remover foto".
    if (!value) return null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'moradores')) ?? null;
    }
    await this.storage.exigirArquivoDoRegistro(value, gravados);
    return value;
  }

  /**
   * Garante que tag RFID / QR não estão sendo usadas por outra pessoa
   * (morador OU visitante) no mesmo condomínio. Idealmente o schema teria
   * UNIQUE compound (id_condominio, tag_rfid) — enquanto não rodamos a
   * migration, validamos no application layer.
   *
   * Suporta excluir o próprio morador via `excluirMoradorId` (no update).
   */
  /**
   * Tag RFID como vai para o banco: NORMALIZADA (ver tag-codigo.util), que é a
   * forma comparada com a leitura do leitor. Vazio vira null; código inválido
   * é recusado. 50 = tamanho da coluna Moradores.tag_rfid.
   */
  private tagRfidParaGravar(bruto: unknown): string | null {
    if (bruto == null || String(bruto).trim() === '') return null;
    const validado = validarCodigoTag(bruto, 50);
    if (validado.erro !== undefined) throw new BadRequestException(validado.erro);
    return validado.codigo;
  }

  private async assertCredencialDisponivel(
    idCondominio: number,
    tag: string | undefined | null,
    qr: string | undefined | null,
    excluirMoradorId: number | null,
  ): Promise<void> {
    if (!this.prisma.isConnected) return;

    const checks: Array<Promise<void>> = [];

    if (tag) {
      // Por VARIANTES e em todas as fontes (Tags, Moradores, visita/visitante
      // não encerrado): a mesma tag em outro formato é a mesma tag.
      checks.push(
        assertTagNaoEmUso(this.prisma, idCondominio, tag, {
          ignorar: { idMorador: excluirMoradorId },
        }),
      );
    }

    if (qr) {
      checks.push(
        (async () => {
          const conflitoMorador = await this.prisma.moradores.findFirst({
            where: {
              id_condominio: idCondominio,
              qrcode_acesso: qr,
              ...(excluirMoradorId ? { NOT: { id: excluirMoradorId } } : {}),
            },
            select: { id: true, nome: true },
          });
          if (conflitoMorador) {
            throw new BadRequestException(
              `QR Code já cadastrado para o morador "${conflitoMorador.nome}"`,
            );
          }
          const conflitoVisitante = await this.prisma.visitantes.findFirst({
            where: { id_condominio: idCondominio, codigo_acesso: qr },
            select: { id: true, nome: true },
          });
          if (conflitoVisitante) {
            throw new BadRequestException(
              `QR Code já em uso pelo visitante "${conflitoVisitante.nome}"`,
            );
          }
        })(),
      );
    }

    await Promise.all(checks);
  }

  /** Síndicos do condomínio, para o painel escolher quem vincular como morador. */
  async listSindicosCondominio(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const rels = await this.prisma.sindicos_Condominios.findMany({
      where: { id_condominio: Number(idCondominio) },
      include: { user: { include: { sindicos: true } } },
    });
    return rels.map((r) => ({
      id_user: r.id_user,
      nome: r.user?.sindicos?.[0]?.name ?? r.user?.name ?? '',
      email: r.user?.email ?? null,
    }));
  }

  /**
   * Vincula um usuário JÁ EXISTENTE (ex.: um síndico) a um apartamento como morador,
   * sem criar conta nova: cria Apartamentos_Users + Moradores e marca is_morador=1.
   * Idempotente. Valida que o apartamento pertence ao condomínio do path (tenant).
   */
  async linkExistingUser(
    idCondominio: number,
    body: { id_user: number; id_apartamento: number; tipo?: string },
    operador?: JwtPayload,
  ) {
    // Defesa em profundidade: o controller já exige operador, mas este método
    // escreve em Apartamentos_Users, que é a tabela pela qual TODO o
    // isolamento do sistema decide de quem é cada apartamento. Uma chamada
    // futura que esqueça a checagem não pode virar escalada de privilégio.
    // (O condomínio já é coberto pelo TenantGuard na rota e pela validação do
    // apartamento logo abaixo.)
    assertOperador(operador, 'vincular usuário a apartamento');

    if (!this.prisma.isConnected) {
      throw new BadRequestException('Banco indisponível. Tente novamente em instantes.');
    }
    const idUser = Number(body.id_user);
    const idApto = Number(body.id_apartamento);
    if (!idUser || !idApto) throw new BadRequestException('Usuário e apartamento são obrigatórios.');

    const tipo = String(body.tipo || 'proprietario')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim() || 'proprietario';

    const apto = await this.prisma.apartamentos.findUnique({ where: { id: idApto } });
    if (!apto) throw new NotFoundException('Apartamento não encontrado.');
    if (apto.id_condominio !== Number(idCondominio)) {
      throw new BadRequestException('Este apartamento não pertence ao condomínio.');
    }

    const user = await this.prisma.users.findUnique({ where: { id: idUser } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    // Users.id é sequencial e global: só liga quem JÁ tem vínculo (síndico/equipe/morador) com este
    // condomínio. Antes qualquer id copiava nome/CPF/e-mail de outra pessoa e abria a troca de login dela.
    if (!(await usuarioTemVinculoNoCondominio(this.prisma as any, idUser, Number(idCondominio)))) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const already = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: idUser, id_apto: idApto },
    });
    if (already) throw new BadRequestException(`${user.name ?? 'Este usuário'} já está vinculado a este apartamento.`);

    const venc = new Date();
    venc.setDate(venc.getDate() + 45);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.apartamentos_Users.create({
          data: { id_apto: apto.id, id_user: idUser, tipo, vencimento: venc },
        });
        await tx.moradores.create({
          data: {
            nome: user.name ?? 'Síndico',
            documento: user.cpf ?? null,
            email: user.email ?? null,
            telefone: user.phone ?? null,
            tipo,
            id_user: idUser,
            id_condominio: apto.id_condominio,
            bloco: apto.bloco || null,
            apartamento: apto.apto || null,
          },
        });
        await tx.users.update({ where: { id: idUser }, data: { is_morador: 1 } });
      });
    } catch (err: any) {
      // Duas gravações ao mesmo tempo passam pela conferência acima; a chave única barra a segunda.
      if (ehVinculoUnidadeRepetido(err)) {
        throw new BadRequestException(`${user.name ?? 'Este usuário'} já está vinculado a este apartamento.`);
      }
      throw err;
    }

    return { success: true, id_condominio: apto.id_condominio, apto_id: apto.id, apto_tipo: tipo };
  }

  /**
   * Último registro de biometria de cada titular — a regra de ConsentimentosService.autorizouBiometria,
   * que o FacialService.syncMorador usa para decidir se o rosto vai ao terminal. Só leitura: o console
   * nunca grava consentimento de morador. `null` quando não deu para ler (a lista não cai pelo aviso).
   */
  private async biometriaAutorizadaPorUsuario(idsUser: Array<number | null | undefined>): Promise<Map<number, boolean> | null> {
    try {
      return await lerBiometriaAutorizada(this.prisma, idsUser);
    } catch (e: any) {
      this.logger.warn(`[moradores.findAll] consentimentos de biometria não lidos: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Para a tela avisar que o rosto cadastrado espera o aceite do morador no app (o syncMorador pula
   * sem gravar status). Marca de revogação do operador aqui também conta como não autorizado.
   * Sem conta que entra no app (sem Users ou sem login), não há aceite a esperar: primeiro o acesso.
   * Menos para o menor dependente: a conta dele nasce sem login de propósito (o aceite é do
   * responsável), então para ele vale o aviso de aguardar o aceite.
   */
  private estadoAceiteBiometria(
    m: {
      id_user: number | null;
      foto_pessoa: string | null;
      face_id: string | null;
      face_sync_error: string | null;
      data_nascimento?: Date | string | null;
    },
    autorizados: Map<number, boolean> | null,
    conta: { login?: string | null; login_type?: string | null } | null | undefined,
  ) {
    const tem_conta_app = m.id_user != null && !!(conta?.login ?? '').trim();
    const menorDependente = m.data_nascimento
      ? calcularIdade(m.data_nascimento) < 18
      : conta?.login_type === 'dependente_menor';
    const biometria_autorizada =
      autorizados == null
        ? null
        : m.id_user != null && m.face_sync_error !== REVOGADO_PELO_OPERADOR && autorizados.get(m.id_user) === true;
    const rostoParado = biometria_autorizada === false && !!m.foto_pessoa && !m.face_id;
    return {
      tem_conta_app,
      biometria_autorizada,
      aguardando_aceite_biometria: rostoParado && (tem_conta_app || menorDependente),
      biometria_sem_conta_app: rostoParado && !tem_conta_app && !menorDependente,
    };
  }

  /**
   * `envio_acesso_por_link` de cada linha da lista: o que o "Enviar Acesso" fará, pela mesma regra
   * (modoEnvioAcesso). A linha sem id_user usa a conta que a API acharia pelo e-mail do cadastro; a conta
   * achada que é de outro condomínio a API recusa, e a linha fica com `false`. Nada da conta sai na lista.
   * Leituras que falham deixam o booleano pela informação que houver (a API continua decidindo).
   */
  private async enviosPorLink(
    linhas: Array<{ id_user: number | null; email?: string | null; user?: ContaEnvioAcesso | null }>,
    idCondominio: number,
  ): Promise<boolean[]> {
    const contas: Array<ContaEnvioAcesso | null> = linhas.map((l) => (l.user ? { ...l.user, id: l.user.id ?? l.id_user ?? undefined } : null));
    const achadas = new Set<number>();
    const semConta = linhas
      .map((l, i) => ({ i, email: (l.email ?? '').trim() }))
      .filter(({ i, email }) => linhas[i].id_user == null && !!email);
    if (semConta.length > 0) {
      try {
        const emails = [...new Set(semConta.map((x) => x.email))];
        const encontradas: ContaEnvioAcesso[] = await this.prisma.users.findMany({
          where: { OR: [{ email: { in: emails } }, { login: { in: emails } }] },
          select: SELECAO_CONTA_ENVIO,
        });
        for (const { i, email } of semConta) {
          const e = email.toLowerCase();
          const c = encontradas.find((u) => (u.email ?? '').toLowerCase() === e || (u.login ?? '').toLowerCase() === e);
          if (c) {
            contas[i] = c;
            achadas.add(i);
          }
        }
      } catch (e: any) {
        this.logger.warn(`[moradores.findAll] contas pelo e-mail não lidas: ${e?.message ?? e}`);
      }
    }
    const ids = contas.filter((c) => c?.id != null && !!(c.login ?? '').trim()).map((c) => Number(c!.id));
    let deFora = new Set<number>();
    if (ids.length > 0) {
      try {
        deFora = await usuariosComVinculoEmOutroCondominio(this.prisma as any, ids, idCondominio);
      } catch (e: any) {
        this.logger.warn(`[moradores.findAll] vínculos em outro condomínio não lidos: ${e?.message ?? e}`);
      }
    }
    const logins = [...new Set(contas.map((c) => (c?.login ?? '').trim()).filter(Boolean))];
    let dePortaria = new Set<string>();
    if (logins.length > 0) {
      try {
        const linhasPortaria = await this.prisma.funcionarios_Portaria.findMany({
          where: { login: { in: logins } },
          select: { login: true },
        });
        dePortaria = new Set(linhasPortaria.map((p) => p.login.toLowerCase()));
      } catch (e: any) {
        this.logger.warn(`[moradores.findAll] logins de portaria não lidos: ${e?.message ?? e}`);
      }
    }
    return contas.map((c, i) => {
      if (!c) return false;
      const outroCondominio = c.id != null && deFora.has(Number(c.id));
      if (achadas.has(i) && outroCondominio) return false; // a API recusa ligar o cadastro a ela
      const loginDePortaria = dePortaria.has((c.login ?? '').trim().toLowerCase());
      return modoEnvioAcesso(c, { outroCondominio, loginDePortaria }) === 'link';
    });
  }

  /**
   * Moradores no schema legado têm FK para Users e podem ter id_condominio.
   * Para a portaria, listamos moradores diretamente filtrados por id_condominio
   * e juntamos foto via Users. Quando o app legado popular Apartamentos_Users
   * podemos cruzar pelo apartamento.
   */
  async findAll(idCondominio: number, search?: string, idApto?: number) {
    if (!this.prisma.isConnected) {
      return MoradoresService.mockMoradores.filter(m =>
        !search || m.nome.toLowerCase().includes(search.toLowerCase()) || (m.documento || '').includes(search)
      );
    }

    // Quando filtra por apartamento, a fonte canônica é Apartamentos_Users (o vínculo real
    // morador↔apto), com LEFT JOIN em Moradores para o perfil. Assim a lista inclui vínculos
    // "órfãos" (sem ficha em Moradores) e bate exatamente com a contagem do card/app.
    if (idApto) {
      const rels = await this.prisma.apartamentos_Users.findMany({
        // O apto do filtro tem de ser DESTE condomínio: sem isto, um id_apto de outro prédio listava os moradores dele.
        where: { id_apto: Number(idApto), apartamento: { id_condominio: Number(idCondominio) } },
        include: {
          apartamento: true,
          user: { include: { moradores: true, _count: { select: { devices: true, sindicos: true, sindicosCondominios: true, funcionarios: true } } } },
        },
      });
      // Users é global: conta que também é de OUTRO condomínio não empresta CPF, e-mail, telefone e
      // foto dela a esta lista — valem só os dados do cadastro daqui (Moradores).
      const compartilhadas = await usuariosComVinculoEmOutroCondominio(
        this.prisma as any,
        rels.filter((r) => r.user?.photo || r.user?.email || r.user?.phone || r.user?.cpf).map((r) => r.id_user),
        Number(idCondominio),
      );
      const autorizados = await this.biometriaAutorizadaPorUsuario(rels.map((r) => r.id_user));
      const porLink = await this.enviosPorLink(rels as any[], Number(idCondominio));
      const seen = new Set<number>();
      const out: any[] = [];
      for (const [indice, r] of rels.entries()) {
        if (seen.has(r.id_user)) continue;
        seen.add(r.id_user);
        const condId = r.apartamento?.id_condominio ?? idCondominio;
        // `id` é usado para editar e EXCLUIR o cadastro: tem de ser o
        // Moradores.id deste condomínio. O fallback para o cadastro de outro
        // condomínio ou para o Users.id (que coincide com o Moradores.id de
        // outra pessoa) abria e apagava o morador errado. Vínculo sem cadastro
        // aqui fica de fora — é resíduo de exclusão antiga.
        // Uma linha de Moradores por unidade (app, link-user): a desta unidade, senão a do condomínio.
        const doCondominio = (r.user?.moradores ?? []).filter((mor) => mor.id_condominio === condId);
        const m =
          doCondominio.find((mor) => chaveUnidade(mor.bloco, mor.apartamento) === chaveUnidade(r.apartamento?.bloco, r.apartamento?.apto)) ??
          doCondominio[0];
        if (!m) {
          this.logger.warn(`[moradores.findAll] vínculo sem cadastro: apto ${idApto}, user ${r.id_user} — omitido`);
          continue;
        }
        const u = compartilhadas.has(r.id_user) ? null : r.user;
        const fotoFinal = m?.foto_pessoa ?? u?.photo ?? null;
        out.push({
          id: m.id,
          nome: m?.nome ?? u?.name ?? '',
          documento: m?.documento ?? u?.cpf ?? null,
          email: m?.email ?? u?.email ?? null,
          telefone: m?.telefone ?? u?.phone ?? null,
          data_nascimento: m?.data_nascimento ?? null,
          tipo: r.tipo ?? m?.tipo ?? null,
          bloco: m?.bloco ?? r.apartamento?.bloco ?? null,
          apartamento: m?.apartamento ?? r.apartamento?.apto ?? null,
          id_apartamento: Number(idApto),
          id_condominio: condId,
          photo: fotoFinal,
          foto_pessoa: fotoFinal,
          foto_documento: m?.foto_documento ?? null,
          face_id: m?.face_id ?? null,
          face_sync_status: m?.face_sync_status ?? null,
          face_sync_error: m?.face_sync_error ?? null,
          // Tag RFID e QR Code não saem na lista (eram a credencial do prédio inteiro num GET só):
          // ficam na ficha (findOne), que a tela carrega antes de editar.
          ...this.estadoAceiteBiometria(m, autorizados, r.user),
          envio_acesso_por_link: porLink[indice],
        });
      }
      // Busca textual local (mesmo comportamento da query condo-wide).
      if (!search) return out;
      const q = search.toLowerCase();
      return out.filter(
        (o) =>
          (o.nome ?? '').toLowerCase().includes(q) ||
          (o.documento ?? '').toLowerCase().includes(q),
      );
    }

    const list = await this.prisma.moradores.findMany({
      where: {
        id_condominio: idCondominio,
        ...(idApto
          ? {
              user: {
                apartamentosUsers: {
                  some: {
                    id_apto: idApto,
                  },
                },
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { documento: { contains: search } },
                { apartamento: { contains: search } },
                { bloco: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            photo: true,
            login: true,
            login_type: true,
            // O caminho do "Enviar Acesso" (modoEnvioAcesso): só viram um booleano, não saem na resposta.
            password: true,
            senha_alterada_em: true,
            fcm_token: true,
            is_sindico: true,
            is_funcionario: true,
            _count: { select: { devices: true, sindicos: true, sindicosCondominios: true, funcionarios: true } },
            // Só os vínculos deste condomínio, na ordem em que nasceram: a unidade de cada linha sai deles.
            apartamentosUsers: {
              where: { apartamento: { id_condominio: Number(idCondominio) } },
              select: {
                id_apto: true,
                apartamento: { select: { bloco: true, apto: true } },
              },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
      orderBy: { nome: 'asc' },
    });

    // Conta que também é de OUTRO condomínio não empresta a foto global (Users) a esta lista.
    const compartilhadas = await usuariosComVinculoEmOutroCondominio(
      this.prisma as any,
      list.filter((m) => !m.foto_pessoa && m.user?.photo).map((m) => m.id_user),
      Number(idCondominio),
    );
    const autorizados = await this.biometriaAutorizadaPorUsuario(list.map((m) => m.id_user));
    const porLink = await this.enviosPorLink(list as any[], Number(idCondominio));
    return list.map((m, indice) => {
      const idAptoMapped = idApartamentoDaLinha(m, m.user?.apartamentosUsers ?? []);
      const fotoFinal = m.foto_pessoa ?? (m.id_user != null && compartilhadas.has(m.id_user) ? null : m.user?.photo) ?? null;
      return {
        id: m.id,
        nome: m.nome,
        documento: m.documento,
        email: m.email,
        telefone: m.telefone,
        data_nascimento: m.data_nascimento,
        tipo: m.tipo,
        bloco: m.bloco,
        apartamento: m.apartamento,
        id_apartamento: idAptoMapped,
        id_condominio: m.id_condominio,
        photo: fotoFinal,
        foto_pessoa: fotoFinal,
        foto_documento: m.foto_documento ?? null,
        face_id: m.face_id ?? null,
        face_sync_status: m.face_sync_status ?? null,
        face_sync_error: m.face_sync_error ?? null,
        // Sem tag_rfid e qrcode_acesso: só na ficha (findOne). Esta lista também alimenta o CRM.
        ...this.estadoAceiteBiometria(m, autorizados, m.user),
        // A confirmação da tela usa a mesma regra da API (modoEnvioAcesso): link ou senha inicial.
        envio_acesso_por_link: porLink[indice],
      };
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      const m = MoradoresService.mockMoradores.find(x => x.id === id);
      if (!m) throw new NotFoundException(`Morador ${id} não encontrado`);
      return m;
    }
    const m = await this.prisma.moradores.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            photo: true,
            apartamentosUsers: {
              select: {
                id_apto: true,
                apartamento: { select: { bloco: true, apto: true, id_condominio: true } },
              },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    if (!m) throw new NotFoundException(`Morador ${id} não encontrado`);
    // Conta que também é de outro condomínio: a foto global dela não entra (nem no `user` aninhado).
    const contaCompartilhada =
      !!m.user?.photo && m.id_user != null && m.id_condominio != null &&
      (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, m.id_user, m.id_condominio));
    const fotoFinal = m.foto_pessoa ?? (contaCompartilhada ? null : m.user?.photo) ?? null;
    const idAptoMapped = idApartamentoDaLinha(
      m,
      (m.user?.apartamentosUsers ?? []).filter((v: any) => v.apartamento?.id_condominio === m.id_condominio),
    );
    // Os vínculos do user são de TODOS os condomínios (Users é global): servem só para achar a
    // unidade desta linha e não saem na resposta (GET da ficha, POST e PUT).
    const { apartamentosUsers: _vinculos, ...userSemVinculos } = m.user ?? ({} as any);
    return {
      ...m,
      user: m.user ? { ...userSemVinculos, ...(contaCompartilhada && { photo: null }) } : m.user,
      id_apartamento: idAptoMapped,
      photo: fotoFinal,
      foto_pessoa: fotoFinal,
      foto_documento: m.foto_documento ?? null,
    };
  }

  /**
   * Retorna toda a atividade do morador para o painel de detalhes:
   * - Visitas que esse morador convidou (Visitantes WHERE user=id_user)
   * - Encomendas para o apto do morador (match por string apto+bloco)
   * - Ocorrências criadas pelo morador
   * - Histórico de acessos faciais do morador
   *
   * As 4 queries rodam em paralelo (Promise.all) para baixa latência.
   *
   * `ocorrenciasSoPublicasOuDe`: recorte de TenantAccessService.recorteOcorrenciasPrivadas — com um
   * Users.id, as ocorrências saem só públicas ou abertas por ele; `null` = todas as do morador.
   */
  async atividade(idMorador: number, ocorrenciasSoPublicasOuDe: number | null = null) {
    if (!this.prisma.isConnected) {
      return {
        visitas: [],
        encomendas: [],
        ocorrencias: [],
        acessos: [],
        stats: {
          visitasNoLocal: 0,
          visitasAgendadas: 0,
          visitasHistorico: 0,
          encomendasAguardando: 0,
          encomendasEntregues: 0,
          ocorrenciasPendentes: 0,
          ocorrenciasResolvidas: 0,
          totalAcessos: 0,
        },
      };
    }

    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: {
        id: true,
        id_user: true,
        id_condominio: true,
        apartamento: true,
        bloco: true,
      },
    });
    if (!morador) {
      throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    }

    // Normaliza apartamento/bloco do morador uma vez (strings podem ter
    // espaços ou variações que quebrariam o match).
    const aptoNorm = (morador.apartamento ?? '').trim();
    const blocoNorm = (morador.bloco ?? '').trim();

    const [visitas, encomendas, ocorrencias, acessos] = await Promise.all([
      // Visitas que esse morador convidou (campo `user` em Visitantes = autor)
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          user: morador.id_user,
        },
        select: {
          id: true,
          nome: true,
          doc_identificacao: true,
          foto_pessoa: true,
          is_visitante: true,
          is_prestador: true,
          data_hora_inicio: true,
          data_hora_termino: true,
          data_entrada: true,
          data_saida: true,
          codigo_acesso: true,
          created_at: true,
          apartamento: { select: { bloco: true, apto: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),

      // Encomendas para o apto do morador. Encomendas NÃO tem FK para
      // Morador — match feito por string (apto + bloco). O índice
      // (id_condominio, status) acelera o filtro.
      aptoNorm
        ? this.prisma.encomendas.findMany({
            where: {
              id_condominio: morador.id_condominio ?? -1,
              destinatario_apto: aptoNorm,
              ...(blocoNorm ? { destinatario_bloco: blocoNorm } : {}),
            },
            select: {
              id: true,
              descricao: true,
              destinatario_apto: true,
              destinatario_bloco: true,
              recebido_de: true,
              recebido_em: true,
              retirado_em: true,
              retirado_por: true,
              status: true,
              foto_volume: true,
              recebidoPor: { select: { name: true } },
              entreguePor: { select: { name: true } },
            },
            orderBy: { recebido_em: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),

      // Ocorrências criadas pelo morador (`user` em Ocorrencias = autor)
      this.prisma.ocorrencias.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          user: morador.id_user,
          ...(ocorrenciasSoPublicasOuDe != null && {
            OR: [{ publica: true }, { user: ocorrenciasSoPublicasOuDe }],
          }),
        },
        select: {
          id: true,
          descricao: true,
          status: true,
          resposta: true,
          resposta_at: true,
          created_at: true,
          categoria: { select: { nome: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),

      // Histórico de acessos faciais do morador
      this.prisma.acessos_Facial.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          tipo_pessoa: 'morador',
          id_pessoa: morador.id,
        },
        select: {
          id: true,
          id_device: true,
          tipo_dispositivo: true,
          evento: true,
          confianca: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      }),
    ]);

    // Resolve nomes dos dispositivos referenciados nos acessos (1 query)
    const idsDevice = Array.from(new Set(acessos.map((a) => a.id_device)));
    const devices = idsDevice.length > 0
      ? await this.prisma.facial_Devices.findMany({
          where: { id: { in: idsDevice } },
          select: { id: true, nome: true, tipo: true },
        })
      : [];
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    // Stats agregados pra alimentar os badges das abas e KPIs
    const agora = new Date();
    const visitasNoLocal = visitas.filter((v) => !!v.data_entrada && !v.data_saida).length;
    const visitasAgendadas = visitas.filter(
      (v) =>
        !v.data_entrada &&
        !v.data_saida &&
        v.data_hora_inicio &&
        (!v.data_hora_termino || new Date(v.data_hora_termino) >= agora),
    ).length;
    const visitasHistorico = visitas.length - visitasNoLocal - visitasAgendadas;
    const encomendasAguardando = encomendas.filter(
      (e) => (e.status ?? '').toLowerCase() !== 'entregue',
    ).length;
    const encomendasEntregues = encomendas.length - encomendasAguardando;
    const ocorrenciasPendentes = ocorrencias.filter(
      (o) => (o.status ?? '').toLowerCase() !== 'resolvido',
    ).length;
    const ocorrenciasResolvidas = ocorrencias.length - ocorrenciasPendentes;

    return {
      visitas: visitas.map((v) => ({
        ...v,
        apto: v.apartamento?.apto ?? null,
        apto_bloco: v.apartamento?.bloco ?? null,
        apartamento: undefined,
      })),
      encomendas,
      ocorrencias,
      acessos: acessos.map((a) => {
        const d = deviceById.get(a.id_device);
        return {
          ...a,
          terminalNome: d?.nome ?? `Dispositivo #${a.id_device}`,
          terminalTipo: d?.tipo ?? a.tipo_dispositivo ?? 'desconhecido',
        };
      }),
      stats: {
        visitasNoLocal,
        visitasAgendadas,
        visitasHistorico: Math.max(0, visitasHistorico),
        encomendasAguardando,
        encomendasEntregues,
        ocorrenciasPendentes,
        ocorrenciasResolvidas,
        totalAcessos: acessos.length,
      },
    };
  }

  /**
   * Criação simplificada: assumimos que o porteiro está só registrando dados
   * básicos. Cria um Users mínimo se ainda não existir e vincula via id_user.
   */
  /**
   * `opts.permitirContaDeOutroCondominio`: só para os chamadores confiáveis do CRM (criar morador e importação
   * de contatos da Superlógica). Pula APENAS a recusa de ligar conta que já tem vínculo em outro condomínio;
   * as credenciais e o perfil dessa conta continuam intocados.
   *
   * `opts.semContaApp`: só a importação, para a linha com e-mail e sem data de nascimento. O cadastro entra
   * com o e-mail em Moradores e um Users sem login nem senha (como o cadastro sem e-mail): sem a data não há
   * conta de app. O "Enviar Acesso" cria o login depois que a data for preenchida.
   */
  async create(
    dto: CreateMoradorDto,
    operador?: JwtPayload,
    opts?: {
      permitirContaDeOutroCondominio?: boolean;
      semContaApp?: boolean;
      /** Importação: em vez de enviar na hora, entrega o envio a quem chama (que o roda com limite de concorrência). */
      adiarEnvio?: (enviar: () => Promise<void>) => void;
    },
  ) {
    if (!this.prisma.isConnected) {
      const newM = {
        id: MoradoresService.mockMoradores.length + 1,
        nome: dto.nome,
        documento: dto.documento || null,
        email: dto.email || null,
        data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
        tipo: dto.tipo || 'proprietario',
        bloco: 'A',
        apartamento: '101',
        id_apartamento: 0,
        id_condominio: dto.id_condominio,
        photo: null,
        foto_pessoa: dto.foto_pessoa || null,
        foto_documento: dto.foto_documento || null,
      };
      MoradoresService.mockMoradores.push(newM as any);
      if (dto.sendCredentials && dto.email) {
        this.fireWelcomeEmail(dto.email, dto.nome, this.gerarSenhaAleatoria());
      }
      return newM;
    }

    // Mesma guarda do update: objeto/array no e-mail estourava no toLowerCase (500).
    if (dto.email != null && typeof dto.email !== 'string') {
      throw new BadRequestException('E-mail inválido.');
    }
    // O e-mail vira login da conta: o domínio das lápides de revogação é recusado.
    assertEmailNaoReservado(dto.email);

    // Validar duplicidade
    const emailNorm = dto.email ? dto.email.toLowerCase().trim() : null;
    const docNorm = dto.documento ? dto.documento.trim() : null;
    const nomeNorm = dto.nome ? dto.nome.trim() : null;

    let aptoObj = null;
    if (dto.id_apartamento) {
      aptoObj = await this.prisma.apartamentos.findUnique({
        where: { id: Number(dto.id_apartamento) },
      });
      if (aptoObj && aptoObj.id_condominio !== dto.id_condominio) {
        throw new BadRequestException('Apartamento não pertence a este condomínio.');
      }
    }

    const duplicationCheck = await this.prisma.moradores.findFirst({
      where: {
        id_condominio: dto.id_condominio,
        OR: [
          ...(emailNorm ? [{ email: emailNorm }] : []),
          ...(docNorm ? [{ documento: docNorm }] : []),
          ...(nomeNorm && aptoObj ? [{ 
            nome: nomeNorm,
            bloco: aptoObj.bloco || null,
            apartamento: aptoObj.apto || null
          }] : [])
        ]
      }
    });

    if (duplicationCheck) {
      throw new BadRequestException('Este morador já está cadastrado neste condomínio (e-mail, documento ou nome/apartamento duplicado).');
    }

    // Garante que tag/QR não estão em uso por outro morador OU visitante no
    // mesmo condomínio. Duas pessoas com a mesma credencial é o pior bug
    // possível em controle de acesso — "quem é quem?".
    const tagRfid = this.tagRfidParaGravar(dto.tag_rfid);
    await this.assertCredencialDisponivel(dto.id_condominio, tagRfid, dto.qrcode_acesso, null);

    // Senha inicial SEMPRE aleatória. Com sendCredentials ela vai no e-mail de boas-vindas;
    // sem, ninguém a conhece e a conta é ativada por "Enviar credenciais" ou "Esqueci a senha".
    // Antes, sem o envio, virava os dígitos do CPF — que não é segredo.
    const senhaInicial = this.gerarSenhaAleatoria();
    const senhaHash = await bcrypt.hash(senhaInicial, 10);

    const ehMenor = dto.data_nascimento ? calcularIdade(dto.data_nascimento) < 18 : false;

    // Cláusula 8.3 e Anexo I: menor não pode ter biometria facial nem conta
    // de aplicativo. A importação em lote sem data de nascimento só é
    // permitida quando o cadastro NÃO carrega foto facial nem cria
    // credenciais de acesso — nesses casos a data é obrigatória e
    // validarMaioridade() lança se estiver ausente (não apenas se for menor).
    // Só o e-mail cria conta de app: sendCredentials sem e-mail não envia nada
    // (a tela e a importação o mandam marcado por padrão).
    const criaContaApp = !!dto.email && !opts?.semContaApp;
    if (criaContaApp) {
      validarMaioridade(dto.data_nascimento, 'criação de conta de usuário no aplicativo');
    }

    // Antes do upload: recusa por idade não deixa foto órfã no bucket.
    if (dto.foto_pessoa) {
      validarMaioridade(dto.data_nascimento, 'cadastro de biometria facial');
    }

    // Cadastro novo não tem foto gravada: URL do bucket nunca é dele.
    // `enviadas`: só o que ESTA chamada subiu (data URL) — é o que sai do bucket se o cadastro falhar.
    const enviadas: string[] = [];
    const subir = async (valor: string | undefined) => {
      const url = await this.resolveFoto(valor, []);
      if (url && valor && this.storage.isDataUrl(valor)) enviadas.push(url);
      return url;
    };
    // Mesma limpeza do catch da transação: deleteUrl só apaga dentro de moradores/,
    // e só o que esta chamada subiu está em `enviadas`.
    const apagarEnviadas = async () => {
      for (const url of enviadas) {
        await this.storage.deleteUrl(url, PREFIXOS_FOTO_MORADOR).catch(() => false);
      }
    };
    const fotoPessoaUrl = await subir(dto.foto_pessoa);
    let fotoDocumentoUrl: string | null;
    try {
      fotoDocumentoUrl = await subir(dto.foto_documento);
    } catch (err) {
      // foto_documento recusada (ou upload falhou) depois que a foto_pessoa já subiu.
      await apagarEnviadas();
      throw err;
    }

    // Users, vínculo e cadastro numa transação só: antes, falhar o Moradores (texto longo demais,
    // por exemplo) deixava a conta e o vínculo gravados — o card da unidade contava "1 morador", o
    // painel dela aparecia vazio e tentar de novo com o mesmo e-mail criava um segundo vínculo.
    let passwordWasSet = false;
    let createdMorador;
    try {
      createdMorador = await this.prisma.$transaction(async (tx) => {
        // Cria/encontra Users
        let userId: number;
        if (ehMenor) {
          // Menor de 18 anos: cria registro básico de dependente sem acesso ao aplicativo (is_morador: 0)
          const u = await tx.users.create({
            data: {
              name: dto.nome,
              phone: dto.telefone,
              cpf: dto.documento,
              is_morador: 0,
              login_type: 'dependente_menor',
              photo: null,
              profile_image: null,
            },
          });
          userId = u.id;
        } else if (criaContaApp) {
          // O e-mail da conta tem prioridade; só sem ele cai no login (conta antiga com e-mail só no login).
          // Uma busca com OR escolheria uma das duas contas ao acaso e ligaria a unidade à errada.
          const existing =
            (await tx.users.findFirst({ where: { email: dto.email } })) ??
            (await tx.users.findFirst({ where: { login: dto.email } }));
          if (existing) {
            userId = existing.id;
            // Users é global: conta com vínculo em OUTRO condomínio só é ligada a este cadastro.
            // Login, senha e foto dela não são tocados (vinculos-usuario.util; mesma regra do sendCredentials).
            const contaDeOutroCondominio = await usuarioTemVinculoEmOutroCondominio(this.prisma as any, existing.id, dto.id_condominio);
            if (contaDeOutroCondominio && existing.id !== idUsuarioDoToken(operador) && !opts?.permitirContaDeOutroCondominio) {
              throw new BadRequestException(MSG_CONTA_DE_OUTRO_CONDOMINIO);
            }
            // Atualiza login e password caso estejam vazios para permitir acesso, e as fotos
            const userUpdates: any = {};
            if (!contaDeOutroCondominio && (!existing.login || !existing.password)) {
              if (existing.login !== dto.email) await this.assertLoginLivreDaPortaria(dto.email);
              userUpdates.login = dto.email;
              userUpdates.password = senhaHash;
              passwordWasSet = true;
            }
            if (fotoPessoaUrl && !contaDeOutroCondominio) {
              userUpdates.photo = fotoPessoaUrl;
              userUpdates.profile_image = fotoPessoaUrl;
            }
            if (Object.keys(userUpdates).length > 0) {
              await tx.users.update({
                where: { id: existing.id },
                data: userUpdates,
              });
            }
          } else {
            await this.assertLoginLivreDaPortaria(dto.email);
            const u = await tx.users.create({
              data: {
                name: dto.nome,
                email: dto.email,
                login: dto.email,
                password: senhaHash,
                phone: dto.telefone,
                cpf: dto.documento,
                is_morador: 1,
                login_type: 'morador',
                photo: fotoPessoaUrl,
                profile_image: fotoPessoaUrl,
              },
            });
            userId = u.id;
            passwordWasSet = true;
          }
        } else {
          const u = await tx.users.create({
            data: {
              name: dto.nome,
              phone: dto.telefone,
              cpf: dto.documento,
              is_morador: 1,
              login_type: 'morador',
              photo: fotoPessoaUrl,
              profile_image: fotoPessoaUrl,
            },
          });
          userId = u.id;
        }

        const tipoNorm = dto.tipo
          ? String(dto.tipo).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
          : 'proprietario';

        // Busca dados do apartamento
        let bloco = '';
        let aptoNum = '';
        if (dto.id_apartamento) {
          const aptoObj = await tx.apartamentos.findUnique({
            where: { id: Number(dto.id_apartamento) },
          });
          if (aptoObj) {
            bloco = aptoObj.bloco || '';
            aptoNum = aptoObj.apto || '';

            // Insere o vinculo em Apartamentos_Users
            const dataVenc = new Date();
            dataVenc.setDate(dataVenc.getDate() + 45);
            await tx.apartamentos_Users.create({
              data: {
                id_apto: aptoObj.id,
                id_user: userId,
                tipo: tipoNorm,
                vencimento: dataVenc,
              },
            });
          }
        }

        return tx.moradores.create({
          data: {
            nome: dto.nome,
            documento: dto.documento ?? null,
            email: dto.email ?? null,
            telefone: dto.telefone?.trim() || null,
            data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
            tipo: tipoNorm,
            id_user: userId,
            id_condominio: dto.id_condominio,
            bloco: bloco || null,
            apartamento: aptoNum || null,
            foto_pessoa: fotoPessoaUrl,
            foto_documento: fotoDocumentoUrl,
            tag_rfid: tagRfid,
            qrcode_acesso: dto.qrcode_acesso ? dto.qrcode_acesso.trim() : null,
          },
        });
      });
    } catch (err: any) {
      // Nada foi gravado: a foto que esta chamada subiu não pode ficar no bucket sem dono.
      await apagarEnviadas();
      // Recusas da própria API (conta de outro condomínio, login da portaria) saem com a mensagem.
      if (err instanceof HttpException) throw err;
      // Conta existente (achada pelo e-mail) que já tem vínculo com esta unidade: sem a chave única
      // uq_au_apto_user, gravava o vínculo e o Moradores duas vezes.
      if (ehVinculoUnidadeRepetido(err)) {
        throw new ConflictException('Este morador já está cadastrado nesta unidade.');
      }
      if (err?.code === 'P2002') {
        // meta.target pode ser o nome do índice (user_login, uni_cpf) ou a lista de campos.
        const alvo = String(err?.meta?.target ?? '').toLowerCase();
        if (alvo.includes('cpf')) throw new ConflictException('Este CPF já pertence a outra conta.');
        if (alvo.includes('login') || alvo.includes('email')) throw new ConflictException('Já existe outro usuário com este e-mail.');
      }
      this.logger.error(
        `[moradores.create] Falha ao criar morador: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel cadastrar o morador. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // A conta existente foi achada por dto.email, então o aviso vai sempre para o endereço
    // dela. Conta de outro condomínio não recebe senha nova (passwordWasSet fica false):
    // só o aviso de "você já tem conta", sem credencial.
    let credenciaisEnviadas: boolean | undefined;
    let avisoEmail: string | undefined;
    if (dto.sendCredentials && criaContaApp) {
      const enviar = () => this.enviarEmailAcesso(dto.email!, dto.nome, passwordWasSet ? senhaInicial : undefined);
      if (opts?.adiarEnvio) {
        opts.adiarEnvio(enviar);
      } else {
        try {
          await enviar();
          credenciaisEnviadas = true;
        } catch {
          credenciaisEnviadas = false;
          avisoEmail = MSG_AVISO_EMAIL_CADASTRO;
        }
      }
    }

    // Mão dupla com a Superlógica. Best-effort de propósito: o ERP fora do ar
    // não pode impedir o cadastro de um morador no Clique. O serviço checa
    // sozinho se o condomínio tem escrita ligada — sem isso, não faz nada.
    if (!dto.skipSuperlogica) {
      this.superlogicaWrite
        .enviarMorador(createdMorador.id)
        .then((r) => {
          if (r.enviado) {
            this.logger.log(`Morador ${createdMorador.id} enviado à Superlógica.`);
          } else if (r.motivo && r.motivo !== 'escrita desligada para este condomínio') {
            this.logger.log(`Morador ${createdMorador.id} não enviado à Superlógica: ${r.motivo}`);
          }
        })
        .catch((err) =>
          this.logger.error(
            `Falha ao enviar morador ${createdMorador.id} à Superlógica: ${err?.message ?? err}`,
          ),
        );
    }

    if (fotoPessoaUrl) {
      this.fireFacialSync(createdMorador.id);
    }

    const ctx = await this.carregarContextoMorador(createdMorador.id);
    await this.auditoria.registrar({
      id_condominio: createdMorador.id_condominio ?? dto.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'moradores',
      entidade_id: createdMorador.id,
      descricao: `Cadastrou morador "${createdMorador.nome}"${ctx?.apartamento ? ' no ' + ctx.apartamento.label : ''}`,
      detalhes: ctx ?? undefined,
    });

    const criado = (await this.findOne(createdMorador.id)) as any;
    return {
      ...criado,
      ...(credenciaisEnviadas !== undefined && { credenciais_enviadas: credenciaisEnviadas }),
      ...(avisoEmail && { aviso_email: avisoEmail }),
    };
  }

  async update(id: number, dto: Partial<CreateMoradorDto>, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      const idx = MoradoresService.mockMoradores.findIndex(x => x.id === id);
      if (idx !== -1) {
        MoradoresService.mockMoradores[idx] = { ...MoradoresService.mockMoradores[idx], ...dto } as any;
        return MoradoresService.mockMoradores[idx];
      }
      throw new NotFoundException(`Morador ${id} não encontrado`);
    }

    // Interface, não DTO: um objeto no e-mail virava filtro do Prisma na busca de conflito em Users.
    if (dto.email != null && typeof dto.email !== 'string') {
      throw new BadRequestException('E-mail inválido.');
    }

    // Carrega o morador atual com seu Users vinculado
    const atual = await this.prisma.moradores.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!atual) throw new NotFoundException(`Morador ${id} não encontrado`);
    // E-mail novo vira login da conta: o domínio das lápides de revogação é recusado.
    if (dto.email !== undefined && dto.email !== atual.email) assertEmailNaoReservado(dto.email);

    // Depois de carregar o atual: a tela reenvia a foto que recebeu (de
    // Moradores ou de Users), e só ela vale como URL do bucket.
    const fotosDoCadastro = [atual.foto_pessoa, atual.foto_documento, atual.user?.photo, atual.user?.profile_image];
    let fotoPessoaUrl = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa, fotosDoCadastro) : undefined;
    // Foto reenviada igual à do cadastro não é edição: sem isto, corrigir o telefone exigia a data de
    // nascimento, rodava o sync facial de novo e regravava a foto de perfil do app (Users.photo).
    if (fotoPessoaUrl !== undefined && fotoPessoaUrl === (atual.foto_pessoa ?? null)) fotoPessoaUrl = undefined;
    // "Remover foto" quando o cadastro não tem foto e a tela mostrava a de perfil do app (Users.photo):
    // sem isto nada mudava e a foto continuava na lista. Sai só a de perfil; o facial lê Moradores.foto_pessoa,
    // que já está vazio. Conta também de outro condomínio fica intocada (abaixo, contaDeOutroCondominio).
    const removeFotoDoPerfil =
      dto.foto_pessoa !== undefined && fotoPessoaUrl === undefined && !atual.foto_pessoa &&
      !(dto.foto_pessoa ?? '').toString().trim() && !!(atual.user?.photo || atual.user?.profile_image);
    const fotoDocumentoUrl =
      dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento, fotosDoCadastro) : undefined;

    // Valida duplicação de credenciais. Só dispara se o campo veio no dto e
    // mudou — não bloqueia edições que mantêm a credencial atual.
    // A tela reenvia a tag a cada edição: se veio igual à gravada (cadastro
    // antigo, ainda não normalizado), fica como está, sem revalidar.
    const tagDigitada = dto.tag_rfid !== undefined ? (dto.tag_rfid ?? '').toString().trim() : undefined;
    const novaTag =
      tagDigitada === undefined
        ? undefined
        : tagDigitada === ((atual as any).tag_rfid ?? '')
          ? tagDigitada
          : (this.tagRfidParaGravar(tagDigitada) ?? '');
    const novoQr = dto.qrcode_acesso !== undefined ? dto.qrcode_acesso?.trim() : undefined;
    await this.assertCredencialDisponivel(
      atual.id_condominio ?? -1,
      novaTag !== (atual as any).tag_rfid ? novaTag : undefined,
      novoQr !== (atual as any).qrcode_acesso ? novoQr : undefined,
      id,
    );

    // Se o email mudou, valida unicidade no Users (login + email)
    const emailMudou = dto.email !== undefined && dto.email !== atual.email;
    if (emailMudou && dto.email) {
      const emailBusca = dto.email.trim().toLowerCase();
      const conflito = await this.prisma.users.findFirst({
        where: {
          OR: [{ email: emailBusca }, { login: emailBusca }],
          NOT: { id: atual.id_user },
        },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe outro usuário com este e-mail.');
      }
    }
    // Cláusula 8.3: mesma regra do create() — sempre que o PATCH anexa e-mail
    // (credencial) ou foto facial, a data de nascimento é obrigatória e a
    // idade é validada, incondicionalmente. Isso cobre o registro criado sem
    // data de nascimento (import em lote, caso legítimo do Fix 2 em create())
    // que depois recebe foto/e-mail via update — sem isso o menor passava
    // batido só porque `atual.data_nascimento` também estava vazio.
    // validarMaioridade() já lança quando a data está ausente, então chamar
    // sem guarda de "é menor?" fecha os dois buracos (data ausente e menor).
    // Só quando algo muda de fato (a tela antiga reenviava e-mail e foto em todo salvar): e-mail novo,
    // foto nova, ou a data trocada num cadastro que fica com e-mail ou foto.
    const dnFinal = dto.data_nascimento !== undefined ? dto.data_nascimento : atual.data_nascimento;
    const diaNasc = (v: Date | string | null | undefined) => this.parseDate(v as any)?.toISOString().slice(0, 10) ?? null;
    const dataMudou = dto.data_nascimento !== undefined && diaNasc(dto.data_nascimento) !== diaNasc(atual.data_nascimento);
    const emailFinal = dto.email !== undefined ? dto.email : atual.email;
    const fotoFinal = fotoPessoaUrl !== undefined ? fotoPessoaUrl : atual.foto_pessoa;
    if ((emailMudou && dto.email) || (dataMudou && emailFinal)) {
      validarMaioridade(dnFinal, 'atualização de e-mail/conta de usuário no aplicativo');
    }
    if (fotoPessoaUrl || (dataMudou && fotoFinal)) {
      // Menor: só com o termo do responsável, aceito no app (extra2).
      validarBiometria(dnFinal, temTermoResponsavel((atual as any).extra2), 'atualização de biometria facial');
    }

    // O console nunca é o titular: com a conta também em outro condomínio, nome/telefone/foto ficam só
    // em Moradores. Só consulta quando há o que propagar (as demais edições não tocam Users).
    const tocaPerfilDaConta = dto.nome !== undefined || dto.telefone !== undefined || fotoPessoaUrl !== undefined || removeFotoDoPerfil;
    const contaDeOutroCondominio =
      tocaPerfilDaConta && !!atual.id_user && atual.id_condominio != null &&
      (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, atual.id_user, atual.id_condominio));

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        let bloco: string | undefined = undefined;
        let aptoNum: string | undefined = undefined;
        const tipoNorm = dto.tipo !== undefined
          ? String(dto.tipo).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
          : undefined;

        // Só os vínculos DESTE condomínio: sem o filtro, editar o morador
        // aqui apagava o vínculo dele (ou do síndico) em outros prédios.
        const escopoVinculos = {
          id_user: atual.id_user as number,
          ...(atual.id_condominio != null && { apartamento: { id_condominio: atual.id_condominio } }),
        };
        // O morador pode ter mais de uma unidade aqui, e o app e o link-user criam UMA linha de
        // Moradores por unidade. A unidade desta linha é o bloco/apto dela: é esse vínculo que a
        // edição troca (ou cujo tipo muda), nunca o das outras unidades. A unidade anterior que a
        // tela manda só vale quando a linha não aponta um vínculo; sem as duas, só um vínculo único.
        const precisaVinculos = !!atual.id_user && (dto.id_apartamento !== undefined || tipoNorm !== undefined);
        const vinculos: { id: number; id_apto: number; apartamento?: { bloco: string | null; apto: string | null } | null }[] =
          precisaVinculos
            ? await tx.apartamentos_Users.findMany({
                where: escopoVinculos,
                select: { id: true, id_apto: true, apartamento: { select: { bloco: true, apto: true } } },
                orderBy: { id: 'asc' },
              })
            : [];
        const daLinha = vinculosDaUnidade(vinculos, atual.bloco, atual.apartamento);
        const anterior = dto.id_apartamento_anterior != null ? Number(dto.id_apartamento_anterior) : undefined;
        const doAnterior = anterior ? vinculos.filter((v) => v.id_apto === anterior) : [];
        // Linha e tela apontando vínculos válidos e diferentes (ex.: no painel do 101 a lista mostrou a
        // linha do 102): não há como saber qual unidade o operador quis trocar. Recusa sem mexer em nada.
        if (
          dto.id_apartamento !== undefined &&
          daLinha.length > 0 &&
          doAnterior.length > 0 &&
          !doAnterior.some((v) => daLinha.some((d) => d.id === v.id))
        ) {
          throw new UnidadeDaTelaDivergente(
            'Este cadastro é de outra unidade do morador. Abra-o pela lista de moradores para trocar a unidade.',
          );
        }
        const saem =
          daLinha.length > 0 ? daLinha : doAnterior.length > 0 ? doAnterior : vinculos.length === 1 ? vinculos : [];
        // Vínculos que ficam com a unidade desta linha depois da edição: recebem o tipo novo.
        let vinculosFinais: { id: number }[] = saem;
        let tipoJaGravado = false;

        if (dto.id_apartamento !== undefined) {
          let apagar: { id: number }[] = [];

          if (dto.id_apartamento > 0) {
            const aptoObj = await tx.apartamentos.findUnique({
              where: { id: Number(dto.id_apartamento) },
            });
            if (aptoObj && aptoObj.id_condominio !== atual.id_condominio) {
              throw new BadRequestException('Apartamento não pertence a este condomínio.');
            }
            if (aptoObj) {
              bloco = aptoObj.bloco || '';
              aptoNum = aptoObj.apto || '';

              if (atual.id_user) {
                const daNova = vinculos.filter((v) => v.id_apto === aptoObj.id);
                const trocados = saem.filter((v) => v.id_apto !== aptoObj.id);
                if (daNova.length > 0) {
                  // Outra linha de Moradores do mesmo morador já é dessa unidade: mover esta deixaria a
                  // pessoa duas vezes nela. Recusa sem mexer em nada.
                  // Vale também para a linha sem vínculo identificável (nada a trocar, mas o texto dela muda).
                  const chaveNova = chaveUnidade(aptoObj.bloco, aptoObj.apto);
                  if (chaveUnidade(atual.bloco, atual.apartamento) !== chaveNova && atual.id_condominio != null) {
                    const outrasLinhas = await tx.moradores.findMany({
                      where: { id_user: atual.id_user, id_condominio: atual.id_condominio, NOT: { id } },
                      select: { bloco: true, apartamento: true },
                    });
                    if (outrasLinhas.some((l) => chaveUnidade(l.bloco, l.apartamento) === chaveNova)) {
                      throw new BadRequestException(
                        'Este morador já está cadastrado nessa unidade. Edite o cadastro dele nela ou remova este.',
                      );
                    }
                  }
                  // Já tem a unidade nova: só some o vínculo da que saiu.
                  apagar = trocados;
                  vinculosFinais = daNova;
                } else if (trocados.length > 0) {
                  const [movido, ...repetidos] = trocados;
                  await tx.apartamentos_Users.update({ where: { id: movido.id }, data: { id_apto: aptoObj.id } });
                  apagar = repetidos;
                  vinculosFinais = [movido];
                } else {
                  const dataVenc = new Date();
                  dataVenc.setDate(dataVenc.getDate() + 45);
                  await tx.apartamentos_Users.create({
                    data: {
                      id_apto: aptoObj.id,
                      id_user: atual.id_user,
                      tipo: tipoNorm || atual.tipo || 'proprietario',
                      vencimento: dataVenc,
                    },
                  });
                  tipoJaGravado = true;
                }
              }
            }
          } else {
            // Sem unidade: sai a desta linha; sem ela (cliente antigo), todas as deste condomínio.
            apagar = daLinha.length > 0 || anterior !== undefined ? saem : vinculos;
            vinculosFinais = [];
            bloco = '';
            aptoNum = '';
          }
          if (apagar.length > 0) {
            await tx.apartamentos_Users.deleteMany({ where: { id: { in: apagar.map((v) => v.id) } } });
          }
        }
        // Tipo novo vale só para o vínculo da unidade desta linha (o dono do 101 pode ser inquilino do 102).
        if (tipoNorm !== undefined && atual.id_user && !tipoJaGravado) {
          if (vinculosFinais.length > 0) {
            await tx.apartamentos_Users.updateMany({ where: { id: { in: vinculosFinais.map((v) => v.id) } }, data: { tipo: tipoNorm } });
          } else if (dto.id_apartamento === undefined || dto.id_apartamento > 0) {
            this.logger.warn(`[moradores.update] morador ${id}: tipo trocado sem vínculo identificável da unidade; vínculos não alterados.`);
          }
        }

        // Atualiza moradores
        const morador = await tx.moradores.update({
          where: { id },
          data: {
            ...(dto.nome !== undefined && { nome: dto.nome }),
            ...(dto.documento !== undefined && { documento: dto.documento }),
            ...(dto.email !== undefined && { email: dto.email }),
            ...(dto.telefone !== undefined && { telefone: dto.telefone }),
            ...(tipoNorm !== undefined && { tipo: tipoNorm }),
            ...(dto.data_nascimento !== undefined && {
              data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
            }),
            ...(fotoPessoaUrl !== undefined && { foto_pessoa: fotoPessoaUrl }),
            ...(fotoDocumentoUrl !== undefined && { foto_documento: fotoDocumentoUrl }),
            ...(novaTag !== undefined && { tag_rfid: novaTag || null }),
            ...(novoQr !== undefined && { qrcode_acesso: novoQr || null }),
            ...(bloco !== undefined && { bloco: bloco || null }),
            ...(aptoNum !== undefined && { apartamento: aptoNum || null }),
          },
        });

        // Propaga para Users (login/email/phone/name/cpf/photo) para manter o acesso ao app e sincronizar a foto
        const userPatch: any = {};
        if (dto.nome !== undefined) userPatch.name = dto.nome;
        if (dto.telefone !== undefined) userPatch.phone = dto.telefone;
        if (dto.documento !== undefined) userPatch.cpf = dto.documento || null;
        if (emailMudou) {
          userPatch.email = dto.email || null;
          userPatch.login = dto.email || null;
        }
        if (fotoPessoaUrl !== undefined) {
          userPatch.photo = fotoPessoaUrl;
          userPatch.profile_image = fotoPessoaUrl;
        } else if (removeFotoDoPerfil) {
          userPatch.photo = null;
          userPatch.profile_image = null;
        }
        // O console edita o cadastro do condomínio (Moradores). Login/e-mail/CPF da
        // conta (Users) só mudam pelo próprio titular, no app, com a senha atual:
        // quem tem a conta é a pessoa, não o operador. (O console não tem o campo
        // de senha atual, então aqui a credencial nunca é gravada.)
        delete userPatch.email;
        delete userPatch.login;
        delete userPatch.cpf;
        if (Object.keys(userPatch).length > 0 && atual.id_user && !contaDeOutroCondominio) {
          await tx.users.update({
            where: { id: atual.id_user },
            data: userPatch,
          });
        }

        return morador;
      });
    } catch (err: any) {
      // Recusa nossa (unidade de outro condomínio, unidade divergente, já cadastrado na unidade):
      // sai com a mensagem. Só o erro do banco vira a mensagem genérica.
      if (err instanceof HttpException) throw err;
      // Vínculo com a unidade nova gravado ao mesmo tempo por outra chamada (chave uq_au_apto_user).
      if (ehVinculoUnidadeRepetido(err)) {
        throw new BadRequestException(
          'Este morador já está cadastrado nessa unidade. Edite o cadastro dele nela ou remova este.',
        );
      }
      this.logger.error(
        `[moradores.update] Falha ao atualizar morador ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel atualizar o morador. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Roda quando o campo foto foi tocado — INCLUSIVE remoção (foto null).
    // syncMorador cadastra (foto nova) ou remove o rosto do aparelho (sem foto).
    // Também quando a data de nascimento mudou e há foto: sem a data o facial pula o morador, e
    // preenchê-la depois (já validada acima) é o que leva o rosto aos terminais.
    if (fotoPessoaUrl !== undefined || (dataMudou && fotoFinal)) {
      this.fireFacialSync(id);
    }

    // Módulo Guarita: unidade trocada → os dispositivos do morador são
    // regravados com a unidade nova; unidade desvinculada → removidos do
    // Guarita. Só enfileira (best-effort); a edição do morador já foi gravada.
    if (this.guarita && dto.id_apartamento !== undefined) {
      const unidadeAntes = `${(atual.bloco ?? '').trim()}|${(atual.apartamento ?? '').trim()}`;
      const unidadeDepois = `${((result as any).bloco ?? '').trim()}|${((result as any).apartamento ?? '').trim()}`;
      if (unidadeAntes !== unidadeDepois) {
        await this.refletirUnidadeNoGuarita(id, !((result as any).apartamento ?? '').trim(), operador?.nome ?? 'Portaria');
      }
    }

    // Diff dos campos sensíveis para o log.
    const camposAuditar = ['nome', 'documento', 'email', 'telefone', 'tipo', 'tag_rfid', 'qrcode_acesso'] as const;
    const changes: Record<string, { de: any; para: any }> = {};
    for (const k of camposAuditar) {
      if (dto[k] !== undefined && (atual as any)[k] !== (result as any)[k]) {
        changes[k] = { de: (atual as any)[k] ?? null, para: (result as any)[k] ?? null };
      }
    }
    if (fotoPessoaUrl !== undefined && fotoPessoaUrl !== atual.foto_pessoa) {
      changes['foto_pessoa'] = { de: '(anterior)', para: '(nova)' };
    }
    if (removeFotoDoPerfil && !contaDeOutroCondominio) {
      changes['foto_perfil_app'] = { de: '(anterior)', para: null };
    }
    const ctx = await this.carregarContextoMorador(result.id);
    await this.auditoria.registrar({
      id_condominio: atual.id_condominio ?? -1,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'UPDATE',
      modulo: 'moradores',
      entidade_id: result.id,
      descricao: `Atualizou morador "${result.nome}"${ctx?.apartamento ? ' (' + ctx.apartamento.label + ')' : ''}`,
      detalhes: { contexto: ctx, changes },
    });

    return this.findOne(result.id);
  }

  async remove(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      MoradoresService.mockMoradores = MoradoresService.mockMoradores.filter(x => x.id !== id);
      return;
    }
    // Carrega contexto ANTES de remover.
    const ctx = await this.carregarContextoMorador(id);
    const morador = await this.prisma.moradores.findUnique({
      where: { id },
      select: { face_id: true, id_condominio: true, nome: true, id_user: true },
    });
    // Módulo Guarita: as tags vêm pelos veículos, que a cascata da transação
    // abaixo apaga — por isso são lidas aqui, antes dela.
    const tagsGuarita = this.guarita ? await this.guarita.tagsDoMorador(id).catch(() => [] as number[]) : [];
    try {
      await this.prisma.$transaction(async (tx) => {
        if (morador?.id_user && morador?.id_condominio) {
          const aptos = await tx.apartamentos.findMany({
            where: { id_condominio: morador.id_condominio },
            select: { id: true },
          });
          const aptoIds = aptos.map((a) => a.id);
          if (aptoIds.length > 0) {
            await tx.apartamentos_Users.deleteMany({
              where: {
                id_user: morador.id_user,
                id_apto: { in: aptoIds },
              },
            });
          }
        }
        await tx.moradores.delete({ where: { id } });
      });
    } catch (err: any) {
      // Quarta ocorrência do mesmo padrão (visitantes, apartamentos e o
      // remove de visita foram as outras): o catch respondia sempre "não
      // encontrado" e escondia a causa real — restrição de chave estrangeira,
      // transação abortada, banco fora. A existência já foi conferida acima.
      this.logger.error(
        `[moradores.remove] Falha ao excluir ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Não foi possível remover o morador. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
    if (morador) {
      await this.auditoria.registrar({
        id_condominio: morador.id_condominio ?? -1,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'DELETE',
        modulo: 'moradores',
        entidade_id: id,
        descricao: `Removeu morador "${morador.nome}"${ctx?.apartamento ? ' do ' + ctx.apartamento.label : ''}`,
        detalhes: ctx ?? undefined,
      });
    }
    // Passe da carteira: a leitura já nega (morador_removido); revogar e avisar
    // faz o passe aparecer inválido no celular. Não bloqueia a exclusão.
    if (morador?.id_condominio && this.wallet) {
      void this.wallet.revogarDoMorador(id, morador.id_condominio);
    }
    // Também sem face_id: o terminal de área com reserva matricula sem gravar face_id (F5).
    if (morador) {
      this.facial
        .unsyncMoradorExcluido(id, morador.face_id, morador.id_condominio)
        .catch((err) => this.logger.warn(`Unsync facial morador ${id} falhou: ${err?.message ?? err}`));
    }
    // Módulo Guarita: controle/tag de ex-morador abrindo o portão é o risco
    // maior — a remoção entra na fila na hora. Só condomínio com Guarita recebe
    // a contagem na resposta (sem Guarita a resposta continua vazia).
    if (this.guarita && morador?.id_condominio) {
      const guaritas = await this.guarita.guaritasDoCondominio(morador.id_condominio).catch(() => []);
      const guarita_remocoes = tagsGuarita.length
        ? await this.guarita.enfileirarRemocoes(tagsGuarita, operador?.nome ?? 'Portaria')
        : 0;
      if (guaritas.length > 0 || guarita_remocoes > 0) return { guarita_remocoes };
    }
    return undefined;
  }

  /**
   * Troca/saída de unidade no Guarita: desvinculado → remove; outra unidade →
   * regrava (edição) os dispositivos já gravados. Nunca lança.
   */
  private async refletirUnidadeNoGuarita(idMorador: number, semUnidade: boolean, autor: string) {
    const g = this.guarita as GuaritaOperacoesService;
    try {
      const ids = await g.tagsDoMorador(idMorador);
      if (!ids.length) return;
      if (semUnidade) {
        await g.enfileirarRemocoes(ids, autor);
        return;
      }
      // Quem pode ser regravado decide a fila (GuaritaOperacoesService.podeEscrever).
      for (const id of ids) {
        await g.enfileirarEdicao(id, autor).catch((err: any) =>
          this.logger.warn(`Edição da tag ${id} no Guarita (troca de unidade) não entrou na fila: ${err?.message ?? err}`),
        );
      }
    } catch (err: any) {
      this.logger.warn(`Guarita: troca de unidade do morador ${idMorador} não refletida: ${err?.message ?? err}`);
    }
  }

  /**
   * "Enviar Acesso" (console e tela do síndico no app). O caminho sai de `modoEnvioAcesso`:
   * - Conta que já usou o app (senha trocada/definida, aparelho com push registrado) ou que também é de
   *   outro condomínio: não gera senha nova nem derruba sessões; manda o link do "Esqueci a senha"
   *   (MobileAuthService, papel morador).
   * - Conta que nunca entrou e é só deste condomínio (inclusive a que nasceu com senha aleatória no
   *   cadastro ou na importação): credencial inicial — senha gerada e e-mail de boas-vindas, sem prazo.
   * A resposta continua `{ ok: true }` (o app só confere o 2xx); `modo` e `message` são campos novos.
   * Nenhuma recusa deixa efeito: o cadastro só é ligado à conta depois de todas as conferências.
   */
  async sendCredentials(id: number, operador?: JwtPayload) {
    const m = (await this.findOne(id)) as any;
    if (!m.email) {
      throw new NotFoundException('Morador não possui e-mail cadastrado');
    }
    // Cláusula 8.3: menor não tem conta de app. Sem a data não há como saber — mesma regra do cadastro com e-mail.
    if (!m.data_nascimento) {
      throw new BadRequestException('Informe a data de nascimento do morador antes de enviar o acesso.');
    }
    if (calcularIdade(m.data_nascimento) < 18) {
      throw new BadRequestException(
        'Este morador é menor de 18 anos e não recebe acesso ao app (Cláusula 8.3). O acesso do menor é pelo responsável.',
      );
    }
    // Gera uma senha temporária aleatória de 8 caracteres alfanuméricos
    // (mesmo padrão da recuperação de senha), em vez de usar o CPF da pessoa.
    const senhaInicial = this.gerarSenhaAleatoria();
    // Valor de senha_alterada_em antes da troca: volta se o e-mail não sair (jaAcessouApp depende dele).
    let userIdSenha: number | null = null;
    let senhaAlteradaAntes: Date | string | null = null;
    // Para onde a senha vai. Conta nova: o e-mail do cadastro. Conta existente:
    // SEMPRE o e-mail da própria conta, porque Moradores.email pode ter sido
    // editado por um operador e divergir de Users (mandar para lá entregaria a
    // senha da conta a quem trocou o e-mail do cadastro).
    let emailDestino: string = m.email;
    if (this.prisma.isConnected) {
      let userId: number | null = m.id_user ?? null;
      let conta: ContaEnvioAcesso | null = null;
      // Cadastro sem id_user cuja conta foi achada pelo e-mail: só é ligado a ela no fim, sem recusa pelo caminho.
      let ligarCadastro = false;
      if (userId) {
        conta = await this.prisma.users.findUnique({ where: { id: userId }, select: SELECAO_CONTA_ENVIO });
      } else {
        const existingUser: ContaEnvioAcesso | null = await this.prisma.users.findFirst({
          where: { OR: [{ email: m.email }, { login: m.email }] },
          select: SELECAO_CONTA_ENVIO,
        });
        // Sem id_user a conta (nova ou achada) recebe login = m.email no caminho da senha inicial.
        if (!existingUser || existingUser.login !== m.email) {
          await this.assertLoginLivreDaPortaria(m.email);
        }
        if (existingUser) {
          if (m.id_condominio != null && (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, existingUser.id!, m.id_condominio))) {
            throw new BadRequestException('Esta pessoa também tem conta em outro condomínio. Peça que use "Esqueci a senha" no app.');
          }
          userId = existingUser.id!;
          conta = existingUser;
          ligarCadastro = true;
        }
      }
      const outroCondominio =
        !!userId && m.id_condominio != null && (await usuarioTemVinculoEmOutroCondominio(this.prisma as any, userId, m.id_condominio));

      // Login de uma linha de portaria = conta de porteiro (sincronizarContaDoPorteiro casa pelo login).
      // Erro de banco sobe (não decide "senha" às cegas); o `?.` só cobre doubles de teste sem o delegate.
      const loginDePortaria =
        !!(conta?.login ?? '').trim() &&
        ((await this.prisma.funcionarios_Portaria?.count({ where: { login: String(conta!.login).trim() } })) ?? 0) > 0;

      if (modoEnvioAcesso(conta, { outroCondominio, loginDePortaria }) === 'link') {
        // A senha atual e as sessões continuam valendo até o morador trocar.
        // Conta de síndico/equipe sem login de e-mail cai na recusa de conferirLinkRedefinicao, sem gravar nada.
        const login = String(conta?.login ?? '').trim().toLowerCase();
        await this.conferirLinkRedefinicao(userId!, login);
        if (ligarCadastro) await this.prisma.moradores.update({ where: { id }, data: { id_user: userId! } });
        try {
          await this.mobileAuth!.enviarLinkDefinirSenhaOperador(userId!);
        } catch (err: any) {
          this.logger.warn(`Falha ao enviar link de acesso do morador ${id}: ${err?.message ?? err}`);
          throw new ServiceUnavailableException(MSG_EMAIL_ACESSO_FALHOU);
        }
        // O login da conta só aparece para o operador quando é o próprio e-mail do cadastro.
        const destino = login === String(m.email).trim().toLowerCase() ? login : 'o e-mail de acesso do morador';
        const ctxLink = await this.carregarContextoMorador(id);
        await this.auditoria.registrar({
          id_condominio: m.id_condominio ?? -1,
          usuario_nome: operador?.nome ?? 'Portaria',
          acao: 'STATUS',
          modulo: 'moradores',
          entidade_id: id,
          descricao: `Enviou link de redefinição de senha para "${m.nome}" (${destino})`,
          detalhes: ctxLink ?? undefined,
        });
        return {
          ok: true,
          modo: 'link' as const,
          message: `Enviamos para ${destino} um link para o morador definir uma nova senha. O link vale por 30 minutos.`,
        };
      }

      // Credencial inicial. Conta sem login: o login nasce com o e-mail (cadastro importado sem acesso ao app).
      let loginNovo: string | null = null;
      if (conta && !ligarCadastro) {
        const candidato = [conta.email, conta.login].find((v) => !!v && String(v).includes('@'));
        if (candidato) {
          emailDestino = String(candidato);
          if (!conta.login) loginNovo = emailDestino;
        } else if (!conta.login) {
          loginNovo = m.email;
        } else {
          throw new BadRequestException('Esta conta não tem e-mail de acesso cadastrado. Peça que a pessoa use "Esqueci a senha" no app.');
        }
      }
      if (outroCondominio) {
        throw new BadRequestException('Esta pessoa também tem conta em outro condomínio. Peça que use "Esqueci a senha" no app.');
      }
      if (loginNovo) {
        // Users.email e Users.login são únicos: o e-mail não pode ser de outra conta nem de um porteiro.
        const conflito = await this.prisma.users.findFirst({
          where: { OR: [{ email: loginNovo }, { login: loginNovo }], NOT: { id: userId! } },
          select: { id: true },
        });
        if (conflito) throw new BadRequestException('Já existe outro usuário com este e-mail.');
        await this.assertLoginLivreDaPortaria(loginNovo);
        emailDestino = loginNovo;
      }
      if (!userId) {
        const newUser = await this.prisma.users.create({
          data: {
            name: m.nome,
            email: m.email,
            login: m.email,
            phone: m.telefone,
            cpf: m.documento,
            is_morador: 1,
            login_type: 'morador',
            photo: m.foto_pessoa,
            profile_image: m.foto_pessoa,
          },
        });
        userId = newUser.id;
        ligarCadastro = true;
      }
      if (ligarCadastro) await this.prisma.moradores.update({ where: { id }, data: { id_user: userId! } });
      const senhaHash = await bcrypt.hash(senhaInicial, 10);
      userIdSenha = userId!;
      senhaAlteradaAntes = conta?.senha_alterada_em ?? null;
      await this.prisma.users.update({
        where: { id: userId! },
        data: {
          // Conta existente mantém o login; só a conta nova (ou a que não tinha login) recebe o e-mail.
          ...(!m.id_user && { login: m.email }),
          ...(loginNovo && { login: loginNovo, ...(!conta?.email && { email: loginNovo }) }),
          password: senhaHash,
          // Senha nova: derruba os tokens emitidos antes (JwtStrategy).
          senha_alterada_em: momentoTrocaSenha(),
        },
      });
    }
    try {
      await this.enviarEmailAcesso(emailDestino, m.nome, senhaInicial);
    } catch {
      // Sem e-mail não há acesso: a conta volta a "nunca entrou" para a próxima tentativa repetir a senha inicial.
      if (userIdSenha != null) {
        try {
          await this.prisma.users.update({ where: { id: userIdSenha }, data: { senha_alterada_em: senhaAlteradaAntes } });
        } catch (e: any) {
          this.logger.error(`Não foi possível restaurar senha_alterada_em do user ${userIdSenha}: ${e?.message ?? e}`);
        }
      }
      throw new ServiceUnavailableException(MSG_EMAIL_ACESSO_FALHOU);
    }

    const destinoSenha =
      emailDestino.trim().toLowerCase() === String(m.email).trim().toLowerCase() ? emailDestino : 'o e-mail de acesso do morador';
    const ctx = await this.carregarContextoMorador(id);
    await this.auditoria.registrar({
      id_condominio: m.id_condominio ?? -1,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'STATUS',
      modulo: 'moradores',
      entidade_id: id,
      descricao: `Reenviou credenciais para "${m.nome}" (${destinoSenha})`,
      detalhes: ctx ?? undefined,
    });

    return {
      ok: true,
      modo: 'senha' as const,
      message: `Enviamos para ${destinoSenha} o acesso ao app com uma senha inicial.`,
    };
  }

  /**
   * Conferências do link pelo mecanismo do "Esqueci a senha" (token de 30 min, um uso, e-mail próprio).
   * Aquele fluxo responde "ok" mesmo quando não envia (contra enumeração de contas); aqui o operador
   * precisa saber, então as situações em que ele não enviaria são recusadas antes, sem efeito.
   */
  private async conferirLinkRedefinicao(idConta: number, login: string): Promise<void> {
    if (!login.includes('@')) {
      throw new BadRequestException('Esta conta não tem e-mail de acesso cadastrado. Peça que a pessoa use "Esqueci a senha" no app.');
    }
    if (!this.mobileAuth) {
      throw new BadRequestException('Não foi possível enviar o link agora. Tente de novo em instantes.');
    }
    // O fluxo do morador só acha a conta quando algum cadastro de morador usa o e-mail do login.
    // A mensagem não revela o endereço da conta ao operador.
    const cadastros = await this.prisma.moradores.count({ where: { email: login } });
    if (!cadastros) {
      throw new BadRequestException(
        'O e-mail de acesso deste morador é diferente do e-mail do cadastro; peça a ele para usar "Esqueci a senha" no app.',
      );
    }
    // Mesmo teto do "Esqueci a senha": 3 links por hora por conta.
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
    const recentes = await this.prisma.redefinicoes_Senha.count({
      where: { id_conta: idConta, papel: 'morador', criado_em: { gte: umaHoraAtras } },
    });
    if (recentes >= 3) {
      throw new BadRequestException('Já enviamos 3 links para este morador na última hora. Aguarde um pouco antes de enviar de novo.');
    }
  }

  async exportExcel(
    idCondominio: number,
    options?: { mascarar?: boolean; finalidade?: string; usuarioNome?: string; usuarioEmail?: string; ip?: string },
  ) {
    const list = await this.findAll(idCondominio);
    const deveMascarar = options?.mascarar !== false; // padrão true para cumprir minimização LGPD
    const finalidade = options?.finalidade || 'Não informada';

    // Registra trilha de auditoria formal da exportação (Art. 46 e Art. 6º, X LGPD)
    void this.auditoria.registrar({
      id_condominio: idCondominio,
      usuario_nome: options?.usuarioNome || 'Operador',
      usuario_email: options?.usuarioEmail,
      acao: 'STATUS',
      modulo: 'moradores',
      descricao: `Exportação em massa da lista de moradores (${list.length} registros). Finalidade: ${finalidade}. Documentos mascarados: ${deveMascarar ? 'Sim' : 'Não'}.`,
      detalhes: {
        totalRegistros: list.length,
        finalidade,
        mascarado: deveMascarar,
      },
      ip: options?.ip,
    });

    const formatDoc = (doc?: string | null) => {
      if (!doc) return '';
      if (!deveMascarar) return doc;
      const digits = doc.replace(/\D/g, '');
      if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
      if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`;
      if (digits.length > 4) return `${digits.slice(0, 2)}.***.**-${digits.slice(-2)}`;
      return doc;
    };

    try {
      const xlsx = require('xlsx');
      const ws = xlsx.utils.json_to_sheet(list.map(m => ({
        'Nome Completo': m.nome,
        'Documento': formatDoc(m.documento),
        'E-mail': m.email || '',
        'Telefone': m.telefone || '',
        'Quadra/Bloco': m.bloco || '',
        'Lote/Apto': m.apartamento || '',
        'Vínculo': m.tipo || 'proprietario',
      })));
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Moradores');
      const base64 = xlsx.write(wb, { type: 'base64', bookType: 'xlsx' });
      return { base64, filename: `moradores_condominio_${idCondominio}.xlsx` };
    } catch {
      const csv = ['Nome Completo,Documento,E-mail,Telefone,Quadra/Bloco,Lote/Apto,Vínculo']
        .concat(list.map(m => `"${m.nome}","${formatDoc(m.documento)}","${m.email||''}","${m.telefone||''}","${m.bloco||''}","${m.apartamento||''}","${m.tipo||''}"`))
        .join('\n');
      return { base64: Buffer.from(csv).toString('base64'), filename: `moradores_condominio_${idCondominio}.csv` };
    }
  }

  /**
   * Importação da planilha de moradores.
   * - `podeCriarUnidade`: só quem gerencia unidades (síndico, ou funcionário com a permissão
   *   "apartamentos" — o controller decide) cria a unidade que não existe. Sem a opção, não cria:
   *   a linha vai para os erros pedindo ao síndico.
   * - Data de nascimento: DD/MM/AAAA ou AAAA-MM-DD. A linha sem data importa, mas sem acesso ao app
   *   (sem a data não há como saber se é menor — Cláusula 8.3); o e-mail fica no cadastro para o
   *   "Enviar Acesso" depois que a data for preenchida.
   */
  async importBulk(
    idCondominio: number,
    linhas: any[],
    opcoes: { podeCriarUnidade?: boolean; operador?: JwtPayload; /** só testes */ orcamentoEnvioMs?: number } = {},
  ) {
    const inicioImportacao = Date.now();
    const criados = [];
    const erros: { nome: string; erro: string }[] = [];
    const semAcesso: { nome: string; motivo: string }[] = [];
    /** `linha` = número da linha na planilha (cabeçalho é a 1; o 1º morador é a 2). */
    const semEmail: { linha: number; nome: string }[] = [];
    const envios: Array<{ linha: number; nome: string; enviar: () => Promise<void> }> = [];
    // Unidades do condomínio, lidas uma vez e só se preciso: "Bloco A"/101 da planilha é a unidade A/101.
    let unidades: Array<{ id: number; bloco: string | null; apto: string | null }> | null = null;
    for (const [indice, item] of linhas.entries()) {
      if (!item.nome) continue;
      try {
        let idApto = 0;
        const blocoStr = item.quadra?.toString().trim() || item.bloco?.toString().trim() || '';
        const aptoStr = item.lote?.toString().trim() || item.apartamento?.toString().trim() || '';
        const dataNascimento = this.dataNascimentoDaPlanilha(item.data_nascimento);

        // "Bloco" sozinho normaliza para vazio e casaria com a unidade sem bloco: recusa explicando.
        if (blocoStr && !normalizarBloco(blocoStr)) {
          throw new BadRequestException(`Bloco "${blocoStr}" inválido: informe o bloco (ex.: A) ou deixe a coluna vazia.`);
        }

        if (blocoStr || aptoStr) {
          // Tenta encontrar o apartamento no condominio
          let dbApto: { id: number } | null = await this.prisma.apartamentos.findFirst({
            where: {
              id_condominio: idCondominio,
              bloco: blocoStr || null,
              apto: aptoStr || null,
            },
          });
          if (!dbApto) {
            unidades ??= await this.prisma.apartamentos.findMany({
              where: { id_condominio: idCondominio },
              select: { id: true, bloco: true, apto: true },
            });
            const chave = chaveUnidade(blocoStr, aptoStr);
            dbApto = unidades.find((u) => chaveUnidade(u.bloco, u.apto) === chave) ?? null;
          }

          if (dbApto) {
            idApto = dbApto.id;
          } else if (opcoes.podeCriarUnidade) {
            const novoApto = await this.prisma.apartamentos.create({
              data: {
                id_condominio: idCondominio,
                bloco: blocoStr || null,
                apto: aptoStr || null,
              },
            });
            unidades?.push({ id: novoApto.id, bloco: novoApto.bloco ?? null, apto: novoApto.apto ?? null });
            idApto = novoApto.id;
          } else {
            throw new BadRequestException('Unidade não cadastrada — peça ao síndico para cadastrá-la.');
          }
        }

        const email = item.email?.toString().trim() || undefined;
        // Com e-mail e sem data: o cadastro entra sem conta de app. Se o e-mail já é de uma conta,
        // ligar a ela daria acesso a este condomínio sem saber a idade — pede a data.
        const semContaApp = !!email && !dataNascimento;
        if (semContaApp) {
          const conta = await this.prisma.users.findFirst({
            where: { OR: [{ email }, { login: email }] },
            select: { id: true },
          });
          if (conta) {
            throw new BadRequestException(
              'Este e-mail já tem conta no app: informe a data de nascimento na planilha para ligar o cadastro a ela.',
            );
          }
        }

        const m = await this.create(
          {
            nome: item.nome,
            documento: item.documento?.toString() || undefined,
            email,
            telefone: item.telefone?.toString() || undefined,
            tipo: item.tipo?.toString() || 'proprietario',
            id_apartamento: idApto,
            id_condominio: idCondominio,
            data_nascimento: dataNascimento ?? undefined,
            sendCredentials: !semContaApp && item.sendCredentials !== false,
          },
          opcoes.operador,
          { semContaApp, adiarEnvio: (enviar) => envios.push({ linha: indice + 2, nome: item.nome, enviar }) },
        );
        criados.push(m);
        if (semContaApp) semAcesso.push({ nome: item.nome, motivo: 'Sem data de nascimento: importado sem acesso ao app.' });
      } catch (err: any) {
        this.logger.error(`[moradores.importBulk] Erro ao importar morador "${item.nome}": ${err?.message ?? err}`);
        erros.push({ nome: item.nome, erro: err?.message ?? 'Erro desconhecido' });
      }
    }
    // Envios depois do cadastro: no máximo 4 ao mesmo tempo (SMTP aguenta pouca conexão simultânea),
    // com orçamento total de tempo para a requisição não estourar (ALB/CloudFront cortam em ~60 s).
    const emailPendente: { linha: number; nome: string }[] = [];
    if (envios.length) {
      const limitar = limitarConcorrencia('moradores-importacao-email', 4, { filaMaxima: 1000, esperaMaximaMs: 600_000 });
      const estado: Array<'pendente' | 'ok' | 'falhou'> = envios.map(() => 'pendente');
      let falhasSeguidas = 0;
      const tarefas = envios.map((e, i) =>
        limitar(async () => {
          if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_PARAR) throw new Error('envio interrompido: SMTP indisponível');
          await e.enviar();
        })
          .then(() => {
            falhasSeguidas = 0;
            estado[i] = 'ok';
          })
          .catch((err: any) => {
            falhasSeguidas++;
            estado[i] = 'falhou';
            this.logger.warn(`[moradores.importBulk] e-mail de acesso de "${e.nome}" não saiu: ${err?.message ?? err}`);
          }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(tarefas),
        new Promise<void>((resolve) => {
          // Espera os envios no máximo pelo orçamento, e nunca além do prazo total contado do início.
          const restante = Math.max(0, inicioImportacao + PRAZO_TOTAL_IMPORTACAO_MS - Date.now());
          timer = setTimeout(resolve, Math.min(opcoes.orcamentoEnvioMs ?? ORCAMENTO_ENVIO_IMPORTACAO_MS, restante));
        }),
      ]);
      if (timer) clearTimeout(timer);
      envios.forEach((e, i) => {
        if (estado[i] === 'falhou') semEmail.push({ linha: e.linha, nome: e.nome });
        else if (estado[i] === 'pendente') emailPendente.push({ linha: e.linha, nome: e.nome });
      });
    }
    return { ok: true, total: criados.length, criados, erros, sem_acesso: semAcesso, sem_email: semEmail, email_pendente: emailPendente };
  }

  /**
   * Data de nascimento da planilha em AAAA-MM-DD. Vazia → null. Aceita DD/MM/AAAA e AAAA-MM-DD
   * (com ou sem hora); data impossível (31/02), futura ou em outro formato é recusada.
   */
  private dataNascimentoDaPlanilha(valor: unknown): string | null {
    const s = valor == null ? '' : String(valor).trim();
    if (!s) return null;
    let dia: number, mes: number, ano: number;
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (br) [dia, mes, ano] = [Number(br[1]), Number(br[2]), Number(br[3])];
    else if (iso) [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else throw new BadRequestException('Data de nascimento inválida: use DD/MM/AAAA ou AAAA-MM-DD.');
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia || ano < 1900 || d.getTime() > Date.now()) {
      throw new BadRequestException('Data de nascimento inválida: use DD/MM/AAAA ou AAAA-MM-DD.');
    }
    return d.toISOString().slice(0, 10);
  }
}
