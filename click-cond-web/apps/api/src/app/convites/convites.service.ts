import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisitantesService } from '../visitantes/visitantes.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/** Horas de validade do link. Depois disso ele não serve para mais nada. */
export const HORAS_DE_VALIDADE = 24;

/**
 * Teto de convites ativos por morador. Folgado de propósito: existe para o
 * recurso não virar canal de spam, não para limitar o morador de verdade.
 */
export const MAX_CONVITES_ATIVOS = 5;

/** 5 MB, o mesmo teto já usado nos uploads do financeiro. */
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

/**
 * Convite de visita preenchido pelo próprio visitante, por link.
 *
 * Esta é a PRIMEIRA superfície do sistema em que alguém sem conta grava dado
 * — até aqui, as únicas rotas públicas eram autenticação e webhooks de
 * pagamento. Três consequências que explicam as escolhas abaixo:
 *
 *  1. O token é guardado como hash (nunca em texto). Banco vazado não vira
 *     coleção de links utilizáveis.
 *  2. Token inválido, expirado e já usado produzem a MESMA resposta. Respostas
 *     distintas transformariam a rota num oráculo que confirma quais tokens
 *     existem.
 *  3. Nada disso escreve em `Visitantes`. Só a confirmação do morador escreve,
 *     e pelo `VisitantesService.create()`.
 */
@Injectable()
export class ConvitesService {
  private readonly logger = new Logger(ConvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly visitantes: VisitantesService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Só dígitos. "123.456.789-00" e "12345678900" têm de ser a mesma pessoa. */
  static normalizarCpf(valor: string): string {
    return (valor ?? '').replace(/\D/g, '');
  }

  /**
   * Valida CPF pelos dígitos verificadores.
   *
   * Sem isso, um dígito trocado cria uma "pessoa" nova no agrupamento por CPF
   * — o visitante recorrente vira dois cadastros e o terminal facial, dois
   * rostos.
   */
  static cpfValido(valor: string): boolean {
    const cpf = ConvitesService.normalizarCpf(valor);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false; // 111.111.111-11 e afins

    for (const [tamanho, posicao] of [[9, 10], [10, 11]] as const) {
      let soma = 0;
      for (let i = 0; i < tamanho; i++) {
        soma += Number(cpf[i]) * (posicao - i);
      }
      const resto = (soma * 10) % 11;
      const digito = resto === 10 ? 0 : resto;
      if (digito !== Number(cpf[tamanho])) return false;
    }
    return true;
  }

  // ===================== Morador gera =====================

  /**
   * Cria o convite e devolve o token em texto — única vez em que ele existe
   * fora do celular de quem recebe.
   *
   * Condomínio e apartamento saem do vínculo do morador, NUNCA do corpo da
   * requisição: aceitar do cliente permitiria convidar para a unidade alheia.
   */
  async gerar(user: JwtPayload, isPrestador: boolean) {
    const idUsuario = Number(user?.user?.id ?? user?.sub);
    if (!idUsuario) throw new ForbiddenException('Sessão sem usuário.');

    const vinculo = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: idUsuario },
      // `id_apto`, não `id_apartamento` — é o nome real da coluna em
      // Apartamentos_Users. Pedir coluna inexistente faz o Prisma lançar.
      select: { id_apto: true, apartamento: { select: { id_condominio: true } } },
    });
    if (!vinculo?.apartamento) {
      throw new ForbiddenException(
        'Só um morador vinculado a uma unidade pode gerar convite de visita.',
      );
    }

    const ativos = await this.prisma.convites_Visita.count({
      where: {
        id_usuario: idUsuario,
        status: { in: ['aguardando', 'preenchido'] },
        expira_em: { gt: new Date() },
      },
    });
    if (ativos >= MAX_CONVITES_ATIVOS) {
      throw new BadRequestException(
        `Você já tem ${MAX_CONVITES_ATIVOS} convites em aberto. ` +
          'Aguarde eles serem usados ou expirarem para gerar outro.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expira = new Date();
    expira.setHours(expira.getHours() + HORAS_DE_VALIDADE);

    const convite = await this.prisma.convites_Visita.create({
      data: {
        token_hash: this.hash(token),
        id_condominio: vinculo.apartamento.id_condominio,
        id_apartamento: vinculo.id_apto,
        id_usuario: idUsuario,
        is_prestador: isPrestador ? 1 : 0,
        status: 'aguardando',
        expira_em: expira,
      },
    });

    return { id: convite.id, token, url: this.montarUrl(token), expira_em: expira };
  }

  /**
   * Monta o link completo. Quem decide o domínio é o SERVIDOR, não o app.
   *
   * Se o app montasse a URL, trocar de domínio exigiria uma release na loja e
   * conviveria com versões antigas apontando para o lugar errado — os links já
   * enviados por WhatsApp continuariam quebrados. Aqui é uma variável de
   * ambiente.
   */
  private montarUrl(token: string): string {
    const base = (process.env.CONVITE_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      this.logger.error(
        'CONVITE_BASE_URL não configurada — o link do convite sai sem domínio e não abre.',
      );
    }
    return `${base}/convite/${token}`;
  }

  // ===================== Visitante preenche (público) =====================

  /**
   * Busca o convite pelo token, recusando token inexistente, expirado ou já
   * usado com a MESMA mensagem — ver o item 2 do cabeçalho da classe.
   */
  private async exigirConviteAberto(token: string) {
    const convite = await this.prisma.convites_Visita.findUnique({
      where: { token_hash: this.hash(token ?? '') },
      include: {
        condominio: { select: { nome: true } },
        apartamento: { select: { apto: true, bloco: true } },
      },
    });

    const aberto =
      convite && convite.status === 'aguardando' && convite.expira_em > new Date();

    if (!aberto) {
      throw new NotFoundException('Este convite não está mais disponível.');
    }
    return convite;
  }

  /** Dados mínimos para desenhar a página. Não revela o morador. */
  async lerPublico(token: string) {
    const convite = await this.exigirConviteAberto(token);
    return {
      condominio: convite.condominio?.nome ?? '',
      unidade: convite.apartamento?.bloco
        ? `Apartamento ${convite.apartamento.apto} · Bloco ${convite.apartamento.bloco}`
        : `Apartamento ${convite.apartamento?.apto ?? ''}`,
      is_prestador: convite.is_prestador === 1,
      expira_em: convite.expira_em,
    };
  }

  async responder(
    token: string,
    dados: { nome?: string; cpf?: string; foto?: string; aceite?: boolean },
  ) {
    const convite = await this.exigirConviteAberto(token);

    const nome = (dados.nome ?? '').trim();
    if (nome.length < 3) {
      throw new BadRequestException('Informe seu nome completo.');
    }

    const cpf = ConvitesService.normalizarCpf(dados.cpf ?? '');
    if (!ConvitesService.cpfValido(cpf)) {
      throw new BadRequestException('CPF inválido.');
    }

    // Sem aceite não há prova de consentimento, e o que está sendo coletado é
    // CPF e foto de quem nem é usuário do sistema.
    if (dados.aceite !== true) {
      throw new BadRequestException('É preciso aceitar o uso dos dados para continuar.');
    }

    const foto = (dados.foto ?? '').trim();
    if (!foto) {
      throw new BadRequestException('Envie uma foto do seu rosto.');
    }
    if (Buffer.byteLength(foto, 'utf8') > MAX_FOTO_BYTES) {
      throw new BadRequestException('Foto maior que 5MB. Tente novamente com uma foto menor.');
    }

    const url = this.storage.enabled
      ? await this.storage.uploadDataUrl(foto, 'convites')
      : foto;

    const agora = new Date();
    // `status: 'aguardando'` no where fecha a corrida: dois envios simultâneos
    // do mesmo link, só um grava.
    const atualizados = await this.prisma.convites_Visita.updateMany({
      where: { id: convite.id, status: 'aguardando' },
      data: {
        nome,
        cpf,
        foto_url: url,
        aceite_em: agora,
        preenchido_em: agora,
        status: 'preenchido',
      },
    });
    if (atualizados.count === 0) {
      throw new NotFoundException('Este convite não está mais disponível.');
    }

    await this.avisarMorador(convite.id_usuario, nome, convite.is_prestador === 1);

    return { ok: true };
  }

  private async avisarMorador(idUsuario: number, nome: string, ehPrestador: boolean) {
    try {
      // `sendPushNotification` recebe o TOKEN FCM do aparelho, não o id do
      // usuário — é preciso buscar. Mesmo padrão de areas-sociais.service.ts.
      const morador = await this.prisma.users.findUnique({
        where: { id: idUsuario },
        select: { fcm_token: true },
      });
      if (!morador?.fcm_token) {
        // Sem token o morador nunca instalou/abriu o app neste aparelho. O
        // convite continua esperando na tela dele; só não há como avisar.
        this.logger.log(`Convite preenchido, mas o morador ${idUsuario} não tem fcm_token.`);
        return;
      }

      await this.notifications.sendPushNotification(
        morador.fcm_token,
        ehPrestador ? 'Prestador preencheu o convite' : 'Visitante preencheu o convite',
        `${nome} enviou os dados. Confirme para liberar a entrada.`,
        { type: 'convite_visita' },
      );
    } catch (err: any) {
      // Push é aviso, não o canal de verdade: o convite continua esperando na
      // tela do morador. Falhar aqui não pode desfazer o preenchimento.
      this.logger.warn(`Convite preenchido mas push falhou: ${err?.message ?? err}`);
    }
  }

  // ===================== Morador decide =====================

  private async exigirConviteDoMorador(id: number, user: JwtPayload) {
    const idUsuario = Number(user?.user?.id ?? user?.sub);
    const convite = await this.prisma.convites_Visita.findUnique({ where: { id: Number(id) } });
    if (!convite || convite.id_usuario !== idUsuario) {
      // Mesma resposta para "não existe" e "é de outro morador".
      throw new NotFoundException('Convite não encontrado.');
    }
    return convite;
  }

  async listarPendentes(user: JwtPayload) {
    const idUsuario = Number(user?.user?.id ?? user?.sub);
    return this.prisma.convites_Visita.findMany({
      where: { id_usuario: idUsuario, status: 'preenchido' },
      orderBy: { preenchido_em: 'desc' },
      select: {
        id: true,
        nome: true,
        cpf: true,
        foto_url: true,
        is_prestador: true,
        preenchido_em: true,
      },
    });
  }

  /**
   * Confirma e cria o visitante PELO `create()` existente.
   *
   * Escrever direto em `Visitantes` seria mais curto e estaria errado: o
   * `create()` herda `foto_pessoa`, `foto_documento` e `face_id` quando o CPF
   * já é conhecido no condomínio. Sem ele, o mesmo visitante vira dois rostos
   * no terminal facial — defeito que só apareceria no prédio.
   */
  async confirmar(id: number, user: JwtPayload) {
    const convite = await this.exigirConviteDoMorador(id, user);
    if (convite.status !== 'preenchido') {
      throw new BadRequestException('Este convite não está aguardando confirmação.');
    }

    const visitante = await this.visitantes.create(
      {
        nome: convite.nome ?? '',
        doc_identificacao: convite.cpf ?? undefined,
        foto_pessoa: convite.foto_url ?? undefined,
        id_apartamento: convite.id_apartamento,
        id_condominio: convite.id_condominio,
        is_visitante: convite.is_prestador === 1 ? 0 : 1,
        is_prestador: convite.is_prestador,
      } as any,
      user,
    );

    await this.prisma.convites_Visita.update({
      where: { id: convite.id },
      data: {
        status: 'confirmado',
        respondido_em: new Date(),
        id_visitante: (visitante as any)?.id ?? null,
      },
    });

    return visitante;
  }

  /**
   * Recusa e APAGA A FOTO na hora.
   *
   * Dado de quem não foi autorizado a entrar não fica guardado esperando um
   * job de limpeza rodar.
   */
  async recusar(id: number, user: JwtPayload) {
    const convite = await this.exigirConviteDoMorador(id, user);
    if (convite.status !== 'preenchido') {
      throw new BadRequestException('Este convite não está aguardando confirmação.');
    }

    if (convite.foto_url && this.storage.enabled) {
      try {
        await this.storage.deleteUrl(convite.foto_url);
      } catch (err: any) {
        this.logger.warn(`Falha ao apagar foto de convite recusado: ${err?.message ?? err}`);
      }
    }

    await this.prisma.convites_Visita.update({
      where: { id: convite.id },
      data: { status: 'recusado', respondido_em: new Date(), foto_url: null },
    });

    return { ok: true };
  }
}
