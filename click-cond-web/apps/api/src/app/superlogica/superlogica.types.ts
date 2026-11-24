/**
 * Tipos da API Superlógica Condomínios (v2/condor).
 *
 * Os nomes dos campos são os do ERP — snake_case com sufixo de tabela — e vêm
 * SEMPRE como string, inclusive valores e datas. Campo vazio vem como "" e não
 * como null. Ver INTEGRACAO_SUPERLOGICA.md.
 */

/** `GET /condominios/get` */
export interface SuperlogicaCondominio {
  id_condominio_cond: string;
  st_nome_cond: string;
  st_fantasia_cond: string;
  st_cnpj_cond?: string;
  st_cpf_cond?: string;
  dt_diavencimento_cond?: string;
  fl_ativo_cond?: string;
}

/** Contato de uma unidade (proprietário, inquilino...). */
export interface SuperlogicaContato {
  id_contato_con: string;
  st_nome_con: string;
  st_email_con?: string;
  st_telefone_con?: string;
  st_cpf_con?: string;
  /** Rótulo do vínculo: "Proprietário Residente", "Inquilino"... */
  st_nometiporesp_tres?: string;
}

/** `GET /unidades/index` */
export interface SuperlogicaUnidade {
  id_unidade_uni: string;
  id_condominio_cond: string;
  /** Vem com zeros à esquerda: "000101". */
  st_unidade_uni: string;
  /** Vem com zeros à esquerda: "01". Pode ser "" em condomínio sem bloco. */
  st_bloco_uni: string;
  nm_fracao_uni?: string;
  st_sacado_uni?: string;
  /** Só presente com `exibirDadosDosContatos=1`. */
  contatos?: SuperlogicaContato[];
}

/**
 * `GET /cobranca/index` — a resposta real traz 119 campos; aqui só os que a
 * integração consome.
 */
export interface SuperlogicaCobranca {
  id_recebimento_recb: string;
  id_condominio_cond: string;
  id_unidade_uni: string;
  st_unidade_uni?: string;
  st_bloco_uni?: string;
  /** Número do documento/boleto: "001/00499387345". */
  st_documento_recb: string;
  /** "MM/DD/AAAA HH:mm:ss". */
  dt_vencimento_recb: string;
  /** "" enquanto a cobrança está pendente. */
  dt_liquidacao_recb?: string;
  dt_recebimento_recb?: string;
  vl_total_recb: string;
  /** Ver STATUS_PAGO / STATUS_PENDENTE. */
  fl_status_recb: string;
  /** Payload EMV do Pix copia-e-cola. Vem preenchido. */
  st_pixqrcode_recb?: string;
  /** URL da 2ª via do boleto. Vem preenchida. */
  link_segundavia?: string;
}

/**
 * Semântica de `fl_status_recb`, confirmada contra a produção: todas as
 * cobranças com status 3 tinham `dt_liquidacao_recb` e `dt_recebimento_recb`
 * preenchidos; nenhuma com status 0 tinha. A documentação oficial não descreve
 * esses códigos.
 */
export const STATUS_PENDENTE = '0';
export const STATUS_PAGO = '3';

/**
 * Status LOCAL (coluna `Financeiro.status`, não o `fl_status_recb` do ERP) da
 * cobrança que deixou de ser dívida viva sem ter sido paga: sumiu da listagem
 * de válidas do ERP (cancelada, invalidada, renegociada lá) ou voltou com um
 * `fl_status_recb` que não é pendente nem pago.
 *
 * É o mesmo '3' da dívida renegociada em acordo de propósito: todas as
 * leituras de dívida em aberto já o excluem (`NAO_RENEGOCIADO` na
 * inadimplência, no detalhe e na notificação do inadimplente, nos lembretes,
 * na régua de WhatsApp e na tela do morador; o resumo do app e o assistente
 * também filtram `status <> '3'`). Um valor novo exigiria acertar cada uma.
 * Se a cobrança voltar a aparecer no ERP, o sync seguinte regrava o status.
 */
export const STATUS_LOCAL_FORA_DA_DIVIDA = '3';
