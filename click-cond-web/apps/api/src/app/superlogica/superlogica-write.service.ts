import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SuperlogicaClient } from './superlogica.client';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaContato, SuperlogicaUnidade } from './superlogica.types';

/**
 * Envio de proprietário/morador do Clique para a Superlógica — o lado de
 * escrita da integração.
 *
 * É a única coisa que o Clique grava no ERP. Cobrança, unidade e condomínio
 * continuam sendo só leitura. Ver INTEGRACAO_SUPERLOGICA.md.
 *
 * Nada acontece sem `Condominios.superlogica_escrita = 1`, ligado condomínio a
 * condomínio no CRM.
 */

/** ID_LABEL_TRES — tipo de responsável, na tabela da Superlógica. */
const LABEL_PROPRIETARIO_RESIDENTE = 1;
const LABEL_RESIDENTE = 7;

/** ID_TIPOCONTATO_TCON — 1 = condômino. */
const TIPO_CONTATO_CONDOMINO = 1;

/**
 * ID_TIPORESP_TRES — quem recebe cobrança.
 *
 * 4 = NÃO RECEBER COBRANÇAS, de propósito. Cadastrar alguém no app não pode
 * mudar para quem o boleto é emitido: isso é decisão financeira da
 * administradora, tomada no ERP. O contato entra como cadastro, não como
 * sacado.
 */
const TIPORESP_NAO_RECEBER_COBRANCAS = 4;

export interface PayloadCondomino {
  [campo: string]: string | number;
}

export interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
  idContatoSuperlogica?: number;
}

@Injectable()
export class SuperlogicaWriteService {
  private readonly logger = new Logger(SuperlogicaWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SuperlogicaClient,
    private readonly superlogica: SuperlogicaService,
  ) {}

  /**
   * Monta o corpo do PUT /unidades/post.
   *
   * Os contatos que já estão na unidade são reenviados por `ID_CONTATO_CON` —
   * a documentação diz que, com esse campo, os demais são desconsiderados, ou
   * seja, ele referencia o contato existente em vez de recriá-lo.
   *
   * Reenviar todos é a proteção contra a dúvida central deste endpoint: ele se
   * chama "Editar unidade", e não está documentado se a lista de contatos é
   * substituída ou acrescida. Mandando a lista completa, o resultado é o mesmo
   * nas duas hipóteses — e ninguém perde morador.
   */
  static montarPayload(
    idCondominioSuperlogica: number,
    idUnidadeSuperlogica: number,
    contatosExistentes: SuperlogicaContato[],
    novo: {
      nome: string;
      email?: string | null;
      telefone?: string | null;
      documento?: string | null;
      tipo?: string | null;
    },
    hoje = new Date(),
  ): PayloadCondomino {
    const payload: PayloadCondomino = {
      ID_CONDOMINIO_COND: idCondominioSuperlogica,
      ID_UNIDADE_UNI: idUnidadeSuperlogica,
    };

    contatosExistentes.forEach((c, i) => {
      payload[`contatos[${i}][ID_CONTATO_CON]`] = c.id_contato_con;
    });

    const i = contatosExistentes.length;
    const ehInquilino = /inquilin/i.test(novo.tipo ?? '');

    payload[`contatos[${i}][ST_NOME_CON]`] = novo.nome;
    payload[`contatos[${i}][DT_ENTRADA_RES]`] = SuperlogicaClient.formatarData(hoje);
    payload[`contatos[${i}][ID_TIPOCONTATO_TCON]`] = TIPO_CONTATO_CONDOMINO;
    payload[`contatos[${i}][ID_LABEL_TRES]`] = ehInquilino ? LABEL_RESIDENTE : LABEL_PROPRIETARIO_RESIDENTE;
    payload[`contatos[${i}][ID_TIPORESP_TRES]`] = TIPORESP_NAO_RECEBER_COBRANCAS;

    if (novo.email) payload[`contatos[${i}][ST_EMAIL_CON]`] = novo.email;
    if (novo.telefone) payload[`contatos[${i}][ST_TELEFONE_CON]`] = novo.telefone;
    if (novo.documento) payload[`contatos[${i}][ST_CPF_CON]`] = novo.documento;

    return payload;
  }

  /** Só dígitos, para comparar CPF que veio formatado de um lado e não do outro. */
  private static soDigitos(valor?: string | null): string {
    return (valor ?? '').replace(/\D/g, '');
  }

  /**
   * Procura o contato na unidade por CPF ou e-mail.
   *
   * Serve para dois momentos: antes de enviar (não duplicar quem já está lá) e
   * depois (descobrir o id do contato recém-criado, já que a resposta do ERP
   * não o devolve de forma confiável).
   */
  static acharContato(
    unidade: SuperlogicaUnidade | undefined,
    alvo: { email?: string | null; documento?: string | null },
  ): SuperlogicaContato | undefined {
    const doc = SuperlogicaWriteService.soDigitos(alvo.documento);
    const email = (alvo.email ?? '').trim().toLowerCase();

    return (unidade?.contatos ?? []).find((c) => {
      if (doc && SuperlogicaWriteService.soDigitos(c.st_cpf_con) === doc) return true;
      if (email && (c.st_email_con ?? '').trim().toLowerCase() === email) return true;
      return false;
    });
  }

  private async carregarContexto(idMorador: number) {
    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        documento: true,
        tipo: true,
        bloco: true,
        apartamento: true,
        id_condominio: true,
        id_superlogica_con: true,
      },
    });
    if (!morador?.id_condominio) return null;

    const condominio = await this.prisma.condominios.findUnique({
      where: { id: morador.id_condominio },
      select: { id: true, id_superlogica_cond: true, superlogica_escrita: true },
    });

    const apartamento = await this.prisma.apartamentos.findFirst({
      where: {
        id_condominio: morador.id_condominio,
        bloco: morador.bloco || null,
        apto: morador.apartamento || null,
      },
      select: { id: true, id_superlogica_uni: true },
    });

    return { morador, condominio, apartamento };
  }

  /**
   * Envia um morador do Clique para a unidade correspondente no ERP.
   *
   * Best-effort por decisão: falar com a Superlógica não pode derrubar o
   * cadastro de morador no Clique. Toda recusa devolve um motivo, que fica no
   * log e na auditoria, em vez de virar exceção na cara do usuário do app.
   */
  async enviarMorador(idMorador: number): Promise<ResultadoEnvio> {
    const ctx = await this.carregarContexto(idMorador);
    if (!ctx) return { enviado: false, motivo: 'morador sem condomínio' };

    const { morador, condominio, apartamento } = ctx;

    if (condominio?.superlogica_escrita !== 1) {
      return { enviado: false, motivo: 'escrita desligada para este condomínio' };
    }
    if (condominio?.id_superlogica_cond == null) {
      return { enviado: false, motivo: 'condomínio não vinculado' };
    }
    if (!apartamento?.id_superlogica_uni) {
      // Sem unidade correspondente não há onde pendurar o contato. Criar a
      // unidade no ERP seria escrita muito além do combinado.
      return { enviado: false, motivo: 'apartamento sem unidade vinculada no ERP' };
    }
    if (morador.id_superlogica_con != null) {
      return { enviado: false, motivo: 'já enviado anteriormente' };
    }

    const unidades = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    const unidade = unidades.find((u) => Number(u.id_unidade_uni) === apartamento.id_superlogica_uni);
    if (!unidade) {
      return { enviado: false, motivo: 'unidade não encontrada no ERP' };
    }

    // Já existe lá? Então só amarra os dois lados — reenviar criaria um contato
    // duplicado na unidade.
    const jaExiste = SuperlogicaWriteService.acharContato(unidade, morador);
    if (jaExiste) {
      await this.prisma.moradores.update({
        where: { id: morador.id },
        data: { id_superlogica_con: Number(jaExiste.id_contato_con) },
      });
      return { enviado: false, motivo: 'contato já existia no ERP', idContatoSuperlogica: Number(jaExiste.id_contato_con) };
    }

    const payload = SuperlogicaWriteService.montarPayload(
      condominio.id_superlogica_cond,
      apartamento.id_superlogica_uni,
      unidade.contatos ?? [],
      morador,
    );

    await this.client.putEscritaRestrita('unidades/post', payload);

    // A resposta do ERP não traz o id do contato criado de forma confiável
    // (vem vazio no exemplo oficial), então relemos a unidade para descobrir.
    const depois = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    const criado = SuperlogicaWriteService.acharContato(
      depois.find((u) => Number(u.id_unidade_uni) === apartamento.id_superlogica_uni),
      morador,
    );

    if (criado) {
      await this.prisma.moradores.update({
        where: { id: morador.id },
        data: { id_superlogica_con: Number(criado.id_contato_con) },
      });
    } else {
      // Enviou e não achou depois: não marca como enviado, mas avisa alto —
      // pode ser latência do ERP ou contato sem CPF nem e-mail para casar.
      this.logger.warn(
        `Morador ${idMorador} enviado à unidade ${apartamento.id_superlogica_uni}, mas não foi localizado na releitura.`,
      );
    }

    this.logger.log(`Morador ${idMorador} enviado à Superlógica (unidade ${apartamento.id_superlogica_uni}).`);

    return { enviado: true, idContatoSuperlogica: criado ? Number(criado.id_contato_con) : undefined };
  }

  /**
   * Mostra exatamente o que seria enviado, sem enviar.
   *
   * Existe para conferir o payload contra o ERP antes de ligar a escrita num
   * condomínio de verdade.
   */
  async preverEnvio(idMorador: number): Promise<{ payload: PayloadCondomino | null; motivo?: string }> {
    const ctx = await this.carregarContexto(idMorador);
    if (!ctx) return { payload: null, motivo: 'morador sem condomínio' };

    const { morador, condominio, apartamento } = ctx;
    if (condominio?.id_superlogica_cond == null) return { payload: null, motivo: 'condomínio não vinculado' };
    if (!apartamento?.id_superlogica_uni) return { payload: null, motivo: 'apartamento sem unidade vinculada no ERP' };

    const unidades = await this.superlogica.listarUnidades(condominio.id_superlogica_cond);
    const unidade = unidades.find((u) => Number(u.id_unidade_uni) === apartamento.id_superlogica_uni);

    return {
      payload: SuperlogicaWriteService.montarPayload(
        condominio.id_superlogica_cond,
        apartamento.id_superlogica_uni,
        unidade?.contatos ?? [],
        morador,
      ),
    };
  }
}
