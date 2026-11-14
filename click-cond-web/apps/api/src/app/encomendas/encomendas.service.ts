import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { IaClient } from '../chat-ia/ia.client';
import { casarMorador, extrairLeitura, leituraVazia, LeituraEtiqueta } from './ler-etiqueta';
import { PrismaService } from '../prisma/prisma.service';
import { executarComLock } from '../common/lock-distribuido';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService, umaVez } from '../common/storage/storage.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { TenantAccessService } from '../auth/tenant-access.service';
import axios from 'axios';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { COTA_ETIQUETA_CONDOMINIO_DIA, consumirCotaDiaria, limiteCota } from '../common/cota-ia';

import { rotuloBloco } from '../common/rotulo-bloco.util';
export interface CreateEncomendaDto {
  descricao: string;
  destinatario_apto: string;
  destinatario_bloco?: string;
  recebido_de?: string;
  foto_volume?: string;
  id_condominio: number;
  codigo_rastreio?: string;
}

const INSTRUCAO_ETIQUETA =
  'Você lê etiquetas de encomendas para a portaria de um condomínio. Responda somente com JSON.';
const PROMPT_ETIQUETA =
  'Leia a etiqueta da encomenda na foto. Responda APENAS um JSON com as chaves: ' +
  'nome (destinatário), apto, bloco, transportadora, codigo_rastreio, ' +
  'descricao (tipo e tamanho do volume que aparece na foto, ex.: "Caixa média", "Envelope", "Sacola"). ' +
  'Use null quando não estiver legível. Não invente dados. ' +
  'Nunca comente a qualidade da foto em nenhum campo.';

/** Destino de uma encomenda: quem mora na unidade recebe o aviso. */
type DestinoEncomenda = {
  id: number;
  id_condominio: number;
  destinatario_apto: string;
  destinatario_bloco: string | null;
  descricao: string;
};

/** Lista do console sem os LongText da retirada (assinatura e foto). */
const SELECT_ENCOMENDA_LEVE = {
  id: true,
  descricao: true,
  destinatario_apto: true,
  destinatario_bloco: true,
  recebido_de: true,
  recebido_em: true,
  retirado_em: true,
  retirado_por: true,
  retirado_doc: true,
  status: true,
  foto_volume: true,
  notificado: true,
  notificado_em: true,
  codigo_rastreio: true,
  codigo_validacao: true,
  id_condominio: true,
  recebido_por_user: true,
  entregue_por_user: true,
  created_at: true,
  updated_at: true,
} as const;

/** Bloco gravado sem nulo: '' é "sem bloco", o mesmo que o console grava (o lote compara o texto). */
function blocoGravavel(bloco: string | null | undefined): string {
  return String(bloco ?? '').trim();
}

/** Retirada em lote: as encomendas seguintes reaproveitam a assinatura/foto da 1ª nesta janela. */
const JANELA_LOTE_RETIRADA_MS = 15 * 60_000;

@Injectable()
export class EncomendasService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly auditoria: AuditoriaService,
    private readonly tenant: TenantAccessService,
    @Optional() private readonly ia?: IaClient,
  ) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  private readonly estado: EstadoCompartilhado;

  /**
   * Lê a foto da etiqueta com IA e tenta casar o destinatário com os moradores
   * do condomínio. Não grava nada. Falha da IA devolve leitura vazia (o porteiro
   * preenche à mão). Imagem e texto lido não são logados.
   */
  async lerEtiqueta(
    idCondominio: number,
    user: JwtPayload,
    imagem: string,
  ): Promise<{ leitura: LeituraEtiqueta; destinatario: { apto: string; bloco: string | null; nome: string } | null }> {
    await this.tenant.assertCondominio(idCondominio, user);
    const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(imagem ?? '');
    if (!m) throw new BadRequestException('Envie a foto como imagem (jpeg, png ou webp).');
    const base64 = m[2].replace(/\s+/g, '');
    if (Math.floor((base64.length * 3) / 4) > 5 * 1024 * 1024) {
      throw new BadRequestException('A foto passa de 5 MB.');
    }
    const mimeType = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!this.ia?.isConfigured) return { leitura: leituraVazia(), destinatario: null };
    // Cota só antes de chamar o modelo; fora do try para o 429 não virar leitura vazia.
    await consumirCotaDiaria(this.estado, [
      {
        prefixo: `etiqueta-ia:cota:condominio:${idCondominio}`,
        limite: limiteCota('ETIQUETA_IA_COTA_CONDOMINIO_DIA', COTA_ETIQUETA_CONDOMINIO_DIA),
      },
    ]);
    try {
      const resp = await this.ia.gerarComFerramentas(
        [{ role: 'user', parts: [{ text: PROMPT_ETIQUETA }, { inlineData: { mimeType, data: base64 } }] }],
        [],
        INSTRUCAO_ETIQUETA,
      );
      const leitura = extrairLeitura(resp?.texto ?? '');
      const moradores = await this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio },
        select: { nome: true, apartamento: true, bloco: true },
      });
      return { leitura, destinatario: casarMorador(leitura, moradores) };
    } catch {
      return { leitura: leituraVazia(), destinatario: null };
    }
  }

  onModuleInit() {
    // Verificar rastreamentos a cada 2 horas
    setInterval(() => void executarComLock(this.prisma, 'encomendas:tracking', async () => { await this.tickTrackingJob(); }, { intervaloMinimoMs: 2 * 60 * 60 * 1000 }), 2 * 60 * 60 * 1000).unref?.();

    // Executar verificação inicial após 15 segundos do bootstrap
    setTimeout(() => void executarComLock(this.prisma, 'encomendas:tracking', async () => { await this.tickTrackingJob(); }, { intervaloMinimoMs: 2 * 60 * 60 * 1000 }), 15000).unref?.();
  }

  /**
   * Carrega o id_condominio da encomenda e valida que o operador pertence a
   * esse condomínio. As rotas /:id/retirar, /:id/notificar e DELETE /:id não
   * têm o condomínio no path checável pelo TenantGuard contra o registro —
   * sem isso, um porteiro retira/apaga encomenda de outro prédio (IDOR).
   * Lança 404 (via NotFoundException no findUnique) se não existir.
   */
  private async assertEncomendaDoTenant(id: number, operador?: JwtPayload): Promise<void> {
    if (!this.prisma.isConnected) return;
    const e = await this.prisma.encomendas.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!e) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    await this.tenant.assertEntidade(e.id_condominio, operador, `encomenda #${id}`);
  }

  /**
   * Contexto rico para auditoria de uma encomenda: descrição, destinatário
   * (apto/bloco), remetente, status e quem retirou (se aplicável).
   *
   * Permite responder no painel: "que pacote era, pra qual apartamento,
   * quem retirou e quando".
   */
  private async carregarContextoEncomenda(idEncomenda: number) {
    const e = await this.prisma.encomendas.findUnique({
      where: { id: idEncomenda },
      include: {
        recebidoPor: { select: { id: true, name: true } },
        entreguePor: { select: { id: true, name: true } },
      },
    });
    if (!e) return null;

    const fmtDate = (d: Date | null) =>
      d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null;

    const aptoLabel = e.destinatario_bloco
      ? `${rotuloBloco(e.destinatario_bloco)}, Apto ${e.destinatario_apto}`
      : `Apto ${e.destinatario_apto}`;

    return {
      encomenda: {
        id: e.id,
        descricao: e.descricao,
        status: e.status,
        remetente: e.recebido_de,
        temFoto: !!e.foto_volume,
      },
      destinatario: {
        apto: e.destinatario_apto,
        bloco: e.destinatario_bloco,
        label: aptoLabel,
      },
      recebimento: {
        em: fmtDate(e.recebido_em as any),
        por: e.recebidoPor ? { id: e.recebidoPor.id, nome: e.recebidoPor.name } : null,
      },
      retirada: e.retirado_em
        ? {
            em: fmtDate(e.retirado_em as any),
            por: e.retirado_por,
            documento: e.retirado_doc,
            entreguePor: e.entreguePor ? { id: e.entreguePor.id, nome: e.entreguePor.name } : null,
            comAssinatura: !!e.retirado_assinatura,
            comFoto: !!e.retirado_foto,
          }
        : null,
    };
  }

  /**
   * `opcoes` (console): `leve` deixa de fora a assinatura e a foto da
   * retirada (LongText; data URL quando o upload falhou) e devolve
   * `tem_comprovante` no lugar — o comprovante é aberto por GET :id;
   * `retiradasDesde` traz só as retiradas a partir dessa data (as que ainda
   * aguardam vêm sempre). Sem opções, a lista de sempre.
   */
  async findAll(
    idCondominio: number,
    status?: string,
    operador?: JwtPayload,
    opcoes: { leve?: boolean; retiradasDesde?: Date } = {},
  ) {
    await this.tenant.assertCondominio(idCondominio, operador);
    if (!this.prisma.isConnected) {
      const mocks = [
        {
          id: 401,
          descricao: 'Pacote Mercado Livre - Caixa Média',
          destinatario_apto: '102',
          destinatario_bloco: 'A',
          recebido_de: 'Correios / Sedex',
          recebido_em: new Date(),
          retirado_em: null,
          retirado_por: null,
          status: 'Aguardando',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 402,
          descricao: 'Envelope Documentos - Sedex 10',
          destinatario_apto: '304',
          destinatario_bloco: 'B',
          recebido_de: 'Loggi Transportes',
          recebido_em: new Date(Date.now() - 7200000),
          retirado_em: null,
          retirado_por: null,
          status: 'Aguardando',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(Date.now() - 7200000),
          updated_at: new Date(Date.now() - 7200000),
        },
        {
          id: 403,
          descricao: 'Caixa Amazon Prime - Eletrônicos',
          destinatario_apto: '501',
          destinatario_bloco: 'A',
          recebido_de: 'Amazon Logistics',
          recebido_em: new Date(Date.now() - 86400000),
          retirado_em: new Date(Date.now() - 10000000),
          retirado_por: 'Fernanda Lima (Titular)',
          status: 'Retirada',
          id_condominio: Number(idCondominio),
          foto_volume: null,
          recebido_por_user: null,
          entregue_por_user: null,
          created_at: new Date(Date.now() - 86400000),
          updated_at: new Date(Date.now() - 10000000),
        },
      ];

      if (status) {
        return mocks.filter((m) => m.status === status);
      }
      return mocks;
    }

    const where = {
      id_condominio: Number(idCondominio),
      ...(status ? { status } : {}),
      ...(opcoes.retiradasDesde
        ? { OR: [{ status: { not: 'Retirada' } }, { retirado_em: { gte: opcoes.retiradasDesde } }] }
        : {}),
    };
    if (!opcoes.leve) {
      return this.prisma.encomendas.findMany({ where, orderBy: { recebido_em: 'desc' } });
    }
    const lista = await this.prisma.encomendas.findMany({
      where,
      select: SELECT_ENCOMENDA_LEVE,
      orderBy: { recebido_em: 'desc' },
    });
    const retiradas = lista.filter((e) => e.status === 'Retirada').map((e) => e.id);
    const comComprovante = retiradas.length
      ? await this.prisma.encomendas.findMany({
          where: { id: { in: retiradas }, OR: [{ retirado_assinatura: { not: null } }, { retirado_foto: { not: null } }] },
          select: { id: true },
        })
      : [];
    const ids = new Set(comComprovante.map((e) => e.id));
    return lista.map((e) => ({ ...e, tem_comprovante: ids.has(e.id) }));
  }

  async findOne(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return {
        id,
        descricao: 'Pacote de Demonstração',
        destinatario_apto: '100',
        destinatario_bloco: 'A',
        recebido_de: 'Correios',
        recebido_em: new Date(),
        retirado_em: null,
        retirado_por: null,
        status: 'Aguardando',
        id_condominio: 1,
      };
    }

    const e = await this.prisma.encomendas.findUnique({ where: { id: Number(id) } });
    if (!e) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    await this.tenant.assertEntidade(e.id_condominio, operador, `encomenda #${id}`);
    return e;
  }

  async create(dto: CreateEncomendaDto, operador?: JwtPayload) {
    // id_condominio vem do body no app: sem isto o chamador cadastrava (e notificava moradores) em outro condomínio.
    await this.tenant.assertCondominio(dto.id_condominio, operador);
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        descricao: dto.descricao,
        destinatario_apto: dto.destinatario_apto,
        destinatario_bloco: dto.destinatario_bloco ?? null,
        recebido_de: dto.recebido_de ?? null,
        foto_volume: dto.foto_volume ?? null,
        status: 'Aguardando',
        id_condominio: dto.id_condominio,
        recebido_em: new Date(),
        retirado_em: null,
        retirado_por: null,
        recebido_por_user: null,
        entregue_por_user: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    let fotoUrl: string | null = dto.foto_volume ?? null;
    // Encomenda nova não tem foto gravada: URL do bucket nunca é dela.
    await this.storage.exigirArquivoDoRegistro(fotoUrl, []);
    if (fotoUrl && this.storage.isDataUrl(fotoUrl)) {
      fotoUrl = (await this.storage.uploadDataUrl(fotoUrl, 'encomendas')) ?? null;
    }

    let encomenda;
    try {
      // Verificar se o morador ja cadastrou um rastreio esperado para esta encomenda
      if (dto.codigo_rastreio && this.prisma.isConnected) {
        const expected = await this.prisma.encomendas.findFirst({
          where: {
            id_condominio: dto.id_condominio,
            codigo_rastreio: dto.codigo_rastreio,
            status: 'Esperando',
          },
        });
        if (expected) {
          // Chegou agora: mesmo registro do recebimento confirmado (receber), não
          // a data do pré-registro feito pelo morador.
          encomenda = await this.prisma.encomendas.update({
            where: { id: expected.id },
            data: {
              descricao: dto.descricao || expected.descricao,
              destinatario_apto: dto.destinatario_apto || expected.destinatario_apto,
              destinatario_bloco: blocoGravavel(dto.destinatario_bloco ?? expected.destinatario_bloco),
              recebido_de: dto.recebido_de ?? expected.recebido_de,
              foto_volume: fotoUrl,
              status: 'Aguardando',
              recebido_em: new Date(),
              recebido_por_user: idUsuarioDoToken(operador),
              notificado: 0,
              notificado_em: null,
            },
          });
        }
      }

      if (!encomenda) {
        encomenda = await this.prisma.encomendas.create({
          data: {
            descricao: dto.descricao,
            destinatario_apto: dto.destinatario_apto,
            destinatario_bloco: blocoGravavel(dto.destinatario_bloco),
            recebido_de: dto.recebido_de ?? null,
            foto_volume: fotoUrl,
            status: 'Aguardando',
            id_condominio: dto.id_condominio,
            notificado: 0,
            recebido_por_user: idUsuarioDoToken(operador),
            codigo_rastreio: dto.codigo_rastreio ?? null,
          },
        });
      }
    } catch (err: any) {
      throw new BadRequestException(
        `Nao foi possivel registrar a encomenda. Tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Notificar moradores do apartamento (o destino é o gravado: no casamento
    // com pré-registro sem apto no formulário, vale o do pré-registro).
    const avisados = await this.avisarUnidade(
      encomenda,
      'Nova Encomenda!',
      `Uma encomenda (${dto.descricao}) chegou para o seu apartamento.`,
      (nome) => {
        const transportadora = dto.recebido_de ? `de ${dto.recebido_de}` : 'entregador';
        return `Olá, ${nome}! Uma nova encomenda (${dto.descricao}) ${transportadora} chegou na portaria para o seu apartamento. Retire quando puder!`;
      },
      'notificar moradores',
    );
    encomenda = await this.marcarNotificada(encomenda, avisados);

    const ctx = await this.carregarContextoEncomenda(encomenda.id);
    await this.auditoria.registrar({
      id_condominio: encomenda.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'encomendas',
      entidade_id: encomenda.id,
      descricao: `Encomenda registrada para ${ctx?.destinatario.label ?? 'apto'}: "${encomenda.descricao}"`,
      detalhes: ctx ?? undefined,
    });

    return { ...encomenda, avisados };
  }

  /**
   * Avisa (push e WhatsApp) quem mora na unidade de destino. Devolve quantos
   * moradores ao menos um envio alcançou; falha de envio não derruba a rota.
   */
  private async avisarUnidade(
    e: DestinoEncomenda,
    titulo: string,
    corpo: string,
    whatsapp: (nome: string) => string,
    contexto: string,
  ): Promise<number> {
    let avisados = 0;
    try {
      const moradores = await this.prisma.users.findMany({
        where: {
          moradores: {
            some: {
              id_condominio: e.id_condominio,
              apartamento: e.destinatario_apto,
              ...(e.destinatario_bloco ? { bloco: e.destinatario_bloco } : {}),
            },
          },
          notif_encomendas: 1,
        },
        select: { fcm_token: true, name: true, phone: true },
      });

      for (const morador of moradores) {
        let alcancou = false;
        if (morador.fcm_token) {
          const r = await this.notifications.sendPushNotification(
            morador.fcm_token,
            titulo,
            corpo,
            { id: e.id.toString(), type: 'encomenda' },
          );
          if (r) alcancou = true;
        }
        if (morador.phone) {
          const r = await this.notifications.sendWhatsApp(morador.phone, whatsapp(morador.name ?? ''));
          if (r) alcancou = true;
        }
        if (alcancou) avisados++;
      }
    } catch (error) {
      console.error(`Falha ao ${contexto}:`, error);
    }
    return avisados;
  }

  /** `notificado` só vira 1 quando o aviso alcançou alguém. */
  private async marcarNotificada<T extends { id: number }>(encomenda: T, avisados: number): Promise<T> {
    if (avisados <= 0) return encomenda;
    return (await this.prisma.encomendas.update({
      where: { id: encomenda.id },
      data: { notificado: 1, notificado_em: new Date() },
    })) as unknown as T;
  }

  async retirar(
    id: number,
    retiradoPor: string,
    retiradoDoc?: string,
    retiradoAssinatura?: string,
    retiradoFoto?: string,
    operador?: JwtPayload,
  ) {
    if (!this.prisma.isConnected) {
      return {
        success: true,
        id,
        retirado_por: retiradoPor,
        retirado_doc: retiradoDoc,
        retirado_assinatura: retiradoAssinatura,
        retirado_foto: retiradoFoto,
        status: 'Retirada',
      };
    }

    await this.assertEncomendaDoTenant(id, operador);

    // Assinatura e foto da retirada: URL do bucket só se for a desta encomenda
    // ou a de outra do MESMO condomínio retirada há no máximo 15 min — a
    // retirada em lote da portaria-web reaproveita nas seguintes a URL que a
    // 1ª devolveu.
    const propria = umaVez(async () =>
      this.prisma.encomendas.findUnique({
        where: { id: Number(id) },
        select: { id_condominio: true, retirado_assinatura: true, retirado_foto: true },
      }),
    );
    const gravadosPara = (valor: unknown) => async () => {
      const e = await propria();
      const atuais: unknown[] = [e?.retirado_assinatura, e?.retirado_foto];
      if (!e || atuais.some((g) => this.storage.chaveDoArquivo(g) === this.storage.chaveDoArquivo(valor))) return atuais;
      const url = this.storage.normalizarUrl(valor) as string;
      const doLote = await this.prisma.encomendas.findMany({
        where: {
          id: { not: Number(id) },
          id_condominio: e.id_condominio,
          retirado_em: { gte: new Date(Date.now() - JANELA_LOTE_RETIRADA_MS) },
          OR: [{ retirado_assinatura: url }, { retirado_foto: url }],
        },
        select: { retirado_assinatura: true, retirado_foto: true },
        take: 5,
      });
      return [...atuais, ...doLote.flatMap((o) => [o.retirado_assinatura, o.retirado_foto])];
    };
    await this.storage.exigirArquivoDoRegistro(retiradoAssinatura, gravadosPara(retiradoAssinatura));
    await this.storage.exigirArquivoDoRegistro(retiradoFoto, gravadosPara(retiradoFoto));

    let assinaturaUrl: string | null = retiradoAssinatura ?? null;
    if (assinaturaUrl && this.storage.isDataUrl(assinaturaUrl)) {
      const uploaded = await this.storage.uploadDataUrl(assinaturaUrl, 'encomendas');
      if (uploaded) {
        assinaturaUrl = uploaded;
      }
    }

    let fotoUrl: string | null = retiradoFoto ?? null;
    if (fotoUrl && this.storage.isDataUrl(fotoUrl)) {
      const uploaded = await this.storage.uploadDataUrl(fotoUrl, 'encomendas');
      if (uploaded) {
        fotoUrl = uploaded;
      }
    }

    try {
      const transicao = await this.prisma.encomendas.updateMany({
        where: { id: Number(id), status: 'Aguardando' },
        data: {
          retirado_em: new Date(),
          retirado_por: retiradoPor,
          retirado_doc: retiradoDoc ?? null,
          retirado_assinatura: assinaturaUrl,
          retirado_foto: fotoUrl,
          status: 'Retirada',
          entregue_por_user: idUsuarioDoToken(operador),
        },
      });

      if (transicao.count === 0) {
        throw new ConflictException('Esta encomenda ja foi retirada ou nao esta aguardando entrega.');
      }
      const atualizada = await this.prisma.encomendas.findUnique({
        where: { id: Number(id) },
      });
      if (!atualizada) throw new NotFoundException(`Encomenda ${id} nao encontrada`);

      const ctx = await this.carregarContextoEncomenda(atualizada.id);
      await this.auditoria.registrar({
        id_condominio: atualizada.id_condominio,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'RETIRADA',
        modulo: 'encomendas',
        entidade_id: atualizada.id,
        descricao: `Entregou "${atualizada.descricao}" para ${retiradoPor} (${ctx?.destinatario.label ?? 'apto'})`,
        detalhes: ctx ?? undefined,
      });

      return atualizada;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }

  async notificar(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { success: true, id, notificado: 1, notificado_em: new Date() };
    }

    await this.assertEncomendaDoTenant(id, operador);

    try {
      const atual = await this.prisma.encomendas.findUnique({ where: { id: Number(id) } });
      if (!atual) throw new NotFoundException(`Encomenda ${id} não encontrada`);
      // Lista do porteiro velha (o morador deu baixa pelo app): não manda
      // "aguardando retirada" de algo que já saiu.
      if (atual.status !== 'Aguardando') {
        throw new ConflictException(
          atual.status === 'Retirada'
            ? 'Esta encomenda já foi retirada.'
            : 'Só é possível notificar encomenda aguardando retirada.',
        );
      }

      const avisados = await this.avisarUnidade(
        atual,
        'Aviso de Encomenda Pendente!',
        `Você tem uma encomenda pendente (${atual.descricao}) aguardando retirada.`,
        (nome) => `Olá, ${nome}! Lembramos que você tem uma encomenda pendente (${atual.descricao}) aguardando retirada na portaria do condomínio.`,
        'reenviar notificação',
      );
      const e = await this.marcarNotificada(atual, avisados);

      const ctx = await this.carregarContextoEncomenda(e.id);
      await this.auditoria.registrar({
        id_condominio: e.id_condominio,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'STATUS',
        modulo: 'encomendas',
        entidade_id: e.id,
        descricao: `Reenviou notificação de "${e.descricao}" para ${ctx?.destinatario.label ?? 'apto'}`,
        detalhes: ctx ?? undefined,
      });

      return { ...e, avisados };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }

  /**
   * Confirma o recebimento na portaria de uma encomenda que o morador
   * pré-registrou (status 'Esperando', ex.: iFood). Vira 'Aguardando' (encomenda
   * normal), registra quem recebeu e notifica o morador — mesmo fluxo de uma
   * encomenda recém-chegada.
   */
  async receber(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { success: true, id, status: 'Aguardando' };
    }

    await this.assertEncomendaDoTenant(id, operador);

    const agora = new Date();
    const transicao = await this.prisma.encomendas.updateMany({
      where: { id: Number(id), status: 'Esperando' },
      data: {
        status: 'Aguardando',
        recebido_em: agora,
        recebido_por_user: idUsuarioDoToken(operador),
        notificado: 0,
        notificado_em: null,
      },
    });
    if (transicao.count === 0) {
      throw new ConflictException('Esta encomenda já foi recebida ou não está aguardando confirmação.');
    }
    let recebida = await this.prisma.encomendas.findUnique({
      where: { id: Number(id) },
    });
    if (!recebida) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    // O pré-registro do app grava bloco nulo; o console grava ''. Iguala ao
    // receber, senão o "Retirar lote" separava volumes da mesma unidade.
    if (recebida.destinatario_bloco !== blocoGravavel(recebida.destinatario_bloco)) {
      recebida = await this.prisma.encomendas.update({
        where: { id: recebida.id },
        data: { destinatario_bloco: blocoGravavel(recebida.destinatario_bloco) },
      });
    }

    // Notifica o(s) morador(es) do apartamento que a encomenda chegou.
    const avisados = await this.avisarUnidade(
      recebida,
      'Encomenda recebida!',
      `Sua encomenda (${recebida.descricao}) chegou na portaria.`,
      (nome) => `Olá, ${nome}! Sua encomenda (${recebida.descricao}) chegou na portaria do condomínio. Retire quando puder!`,
      'notificar moradores (receber)',
    );
    const encomenda = await this.marcarNotificada(recebida, avisados);

    const ctx = await this.carregarContextoEncomenda(encomenda.id);
    await this.auditoria.registrar({
      id_condominio: encomenda.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'encomendas',
      entidade_id: encomenda.id,
      descricao: `Recebeu encomenda esperada "${encomenda.descricao}" (${ctx?.destinatario.label ?? 'apto'})`,
      detalhes: ctx ?? undefined,
    });

    return { ...encomenda, avisados };
  }

  /**
   * Console: corrige a unidade de uma encomenda que ainda aguarda retirada
   * (o porteiro escolheu o apartamento errado). A nova unidade é avisada; a
   * troca só vale enquanto o status lido continua 'Aguardando'.
   */
  async corrigirUnidade(
    idCondominio: number,
    id: number,
    dto: { destinatario_apto?: string; destinatario_bloco?: string | null },
    operador?: JwtPayload,
  ) {
    const apto = String(dto?.destinatario_apto ?? '').trim();
    if (!apto) throw new BadRequestException('Informe o apartamento de destino.');
    // Sem bloco grava '' — o mesmo que o recebimento do console grava —, para a
    // mesma unidade não se separar no lote de retirada (que compara o texto).
    const bloco = String(dto?.destinatario_bloco ?? '').trim();

    const atual = await this.prisma.encomendas.findUnique({ where: { id: Number(id) } });
    if (!atual) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    await this.tenant.assertEntidade(atual.id_condominio, operador, `encomenda #${id}`);
    if (atual.id_condominio !== Number(idCondominio)) {
      throw new ForbiddenException('Encomenda não pertence a este condomínio.');
    }
    if (atual.status !== 'Aguardando') {
      throw new ConflictException('Só é possível corrigir a unidade de encomenda aguardando retirada.');
    }
    if (atual.destinatario_apto.trim() === apto && (atual.destinatario_bloco ?? '').trim() === bloco) {
      throw new BadRequestException('A encomenda já está nesta unidade.');
    }
    const unidade = await this.prisma.apartamentos.findFirst({
      where: { id_condominio: atual.id_condominio, apto, ...(bloco ? { bloco } : { OR: [{ bloco: null }, { bloco: '' }] }) },
      select: { id: true },
    });
    if (!unidade) throw new BadRequestException('Unidade não encontrada neste condomínio.');

    const transicao = await this.prisma.encomendas.updateMany({
      where: { id: Number(id), status: 'Aguardando' },
      data: { destinatario_apto: apto, destinatario_bloco: bloco, notificado: 0, notificado_em: null },
    });
    if (transicao.count === 0) {
      throw new ConflictException('A encomenda mudou enquanto você corrigia. Recarregue a lista.');
    }
    const corrigida = await this.prisma.encomendas.findUnique({ where: { id: Number(id) } });
    if (!corrigida) throw new NotFoundException(`Encomenda ${id} não encontrada`);

    const avisados = await this.avisarUnidade(
      corrigida,
      'Nova Encomenda!',
      `Uma encomenda (${corrigida.descricao}) chegou para o seu apartamento.`,
      (nome) => `Olá, ${nome}! Uma nova encomenda (${corrigida.descricao}) chegou na portaria para o seu apartamento. Retire quando puder!`,
      'notificar moradores (correção de unidade)',
    );
    const encomenda = await this.marcarNotificada(corrigida, avisados);

    const ctx = await this.carregarContextoEncomenda(encomenda.id);
    const de = atual.destinatario_bloco
      ? `${rotuloBloco(atual.destinatario_bloco)}, Apto ${atual.destinatario_apto}`
      : `Apto ${atual.destinatario_apto}`;
    await this.auditoria.registrar({
      id_condominio: encomenda.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'UPDATE',
      modulo: 'encomendas',
      entidade_id: encomenda.id,
      descricao: `Corrigiu a unidade de "${encomenda.descricao}": ${de} → ${ctx?.destinatario.label ?? 'apto'}`,
      detalhes: ctx ?? undefined,
    });

    return { ...encomenda, avisados };
  }

  async update(id: number, dto: Partial<CreateEncomendaDto>, operador?: JwtPayload) {
    if (!this.prisma.isConnected) return { id, ...dto };
    const existing = await this.prisma.encomendas.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true, foto_volume: true, destinatario_apto: true, destinatario_bloco: true },
    });
    if (!existing) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    await this.tenant.assertEntidade(existing.id_condominio, operador, `encomenda #${id}`);

    let fotoUrl = dto.foto_volume;
    await this.storage.exigirArquivoDoRegistro(fotoUrl, [existing.foto_volume]);

    // Trocar a unidade (edição pelo app) segue as regras de "Corrigir
    // unidade": só aguardando retirada, unidade existente, bloco '', notificado
    // zerado e aviso à unidade nova. Vai antes dos outros campos para que um
    // 409/400 não deixe a edição pela metade. Bloco nulo e '' são a mesma
    // unidade.
    const aptoAtual = String(existing.destinatario_apto ?? '').trim();
    const apto = dto.destinatario_apto !== undefined ? String(dto.destinatario_apto ?? '').trim() : aptoAtual;
    const bloco = dto.destinatario_bloco !== undefined ? blocoGravavel(dto.destinatario_bloco) : blocoGravavel(existing.destinatario_bloco);
    const mudaUnidade = (dto.destinatario_apto !== undefined || dto.destinatario_bloco !== undefined) &&
      (apto !== aptoAtual || bloco !== blocoGravavel(existing.destinatario_bloco));
    let avisados: number | undefined;
    if (mudaUnidade) {
      const corrigida = await this.corrigirUnidade(
        existing.id_condominio,
        Number(id),
        { destinatario_apto: apto, destinatario_bloco: bloco },
        operador,
      );
      avisados = corrigida.avisados;
    }

    if (fotoUrl && this.storage.isDataUrl(fotoUrl)) {
      fotoUrl = (await this.storage.uploadDataUrl(fotoUrl, 'encomendas')) ?? undefined;
    }

    const updated = await this.prisma.encomendas.update({
      where: { id: Number(id) },
      data: {
        ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        ...(dto.recebido_de !== undefined && { recebido_de: dto.recebido_de ?? null }),
        ...(dto.codigo_rastreio !== undefined && { codigo_rastreio: dto.codigo_rastreio ?? null }),
        ...(fotoUrl !== undefined && { foto_volume: fotoUrl }),
      },
    });

    return avisados === undefined ? updated : { ...updated, avisados };
  }

  async remove(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };
    // Carrega contexto + id_condominio ANTES de deletar — depois sumiu.
    const existing = await this.prisma.encomendas.findUnique({
      where: { id: Number(id) },
      select: { id_condominio: true },
    });
    if (!existing) throw new NotFoundException(`Encomenda ${id} não encontrada`);
    // Valida tenant antes de apagar (IDOR cross-condomínio).
    await this.tenant.assertEntidade(existing.id_condominio, operador, `encomenda #${id}`);
    const ctx = await this.carregarContextoEncomenda(Number(id));
    try {
      await this.prisma.encomendas.delete({ where: { id: Number(id) } });
      if (existing && ctx) {
        await this.auditoria.registrar({
          id_condominio: existing.id_condominio,
          usuario_nome: operador?.nome ?? 'Portaria',
          acao: 'DELETE',
          modulo: 'encomendas',
          entidade_id: Number(id),
          descricao: `Removeu encomenda "${ctx.encomenda.descricao}" (${ctx.destinatario.label})`,
          detalhes: ctx,
        });
      }
      return { success: true };
    } catch {
      throw new NotFoundException(`Encomenda ${id} não encontrada`);
    }
  }

  // Serviço periódico para buscar atualizações dos correios/transportadoras
  async tickTrackingJob() {
    if (!this.prisma.isConnected) return;
    try {
      const activeTracking = await this.prisma.encomendas.findMany({
        where: {
          status: 'Esperando',
          codigo_rastreio: { not: null },
        },
      });

      for (const enc of activeTracking) {
        if (!enc.codigo_rastreio) continue;

        try {
          // Simulação para códigos de teste (ex: TEST1234)
          if (enc.codigo_rastreio.toUpperCase().startsWith('TEST')) {
            const ageMinutes = (Date.now() - new Date(enc.created_at).getTime()) / (1000 * 60);
            // Simular alteração após 3 minutos
            if (ageMinutes > 3.0 && enc.notificado === 0) {
              const moradores = await this.prisma.users.findMany({
                where: {
                  moradores: {
                    some: {
                      id_condominio: enc.id_condominio,
                      apartamento: enc.destinatario_apto,
                      ...(enc.destinatario_bloco ? { bloco: enc.destinatario_bloco } : {}),
                    },
                  },
                  fcm_token: { not: null },
                  notif_encomendas: 1,
                },
                select: { fcm_token: true },
              });

              for (const morador of moradores) {
                if (morador.fcm_token) {
                  await this.notifications.sendPushNotification(
                    morador.fcm_token,
                    'Encomenda a Caminho!',
                    `Sua encomenda "${enc.descricao}" (${enc.codigo_rastreio}) saiu para entrega!`,
                    { id: enc.id.toString(), type: 'encomenda' },
                  );
                }
              }

              await this.prisma.encomendas.update({
                where: { id: enc.id },
                data: { notificado: 2 }, // 2 = saiu para entrega
              });
            }
            continue;
          }

          // Consulta real na Linketrack pública
          const url = `https://api.linketrack.com/v1/track?user=teste&token=1abcd09f9a73867d05c747731051b22e11afd590&codigo=${enc.codigo_rastreio}`;
          const response = await axios.get(url, { timeout: 5000 });
          if (response.status === 200 && response.data?.eventos?.length > 0) {
            const lastEvent = response.data.eventos[0];
            const eventStatus = lastEvent.status || '';

            if (eventStatus.toLowerCase().includes('saiu para entrega') && enc.notificado === 0) {
              const moradores = await this.prisma.users.findMany({
                where: {
                  moradores: {
                    some: {
                      id_condominio: enc.id_condominio,
                      apartamento: enc.destinatario_apto,
                      ...(enc.destinatario_bloco ? { bloco: enc.destinatario_bloco } : {}),
                    },
                  },
                  fcm_token: { not: null },
                  notif_encomendas: 1,
                },
                select: { fcm_token: true },
              });

              for (const morador of moradores) {
                if (morador.fcm_token) {
                  await this.notifications.sendPushNotification(
                    morador.fcm_token,
                    'Encomenda a Caminho!',
                    `Sua encomenda "${enc.descricao}" (${enc.codigo_rastreio}) saiu para entrega!`,
                    { id: enc.id.toString(), type: 'encomenda' },
                  );
                }
              }

              await this.prisma.encomendas.update({
                where: { id: enc.id },
                data: { notificado: 2 },
              });
            }
          }
        } catch (err: any) {
          console.error(`Erro ao consultar rastreio ${enc.codigo_rastreio}:`, err.message || err);
        }
      }
    } catch (e) {
      console.error('Falha no job de rastreamento de encomendas:', e);
    }
  }
}
