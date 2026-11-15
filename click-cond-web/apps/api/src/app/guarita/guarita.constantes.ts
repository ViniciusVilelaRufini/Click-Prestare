/**
 * Módulo Guarita (Nice / Linear-HCS) — constantes compartilhadas pela fila de
 * operações, pelas rotas do agente e pelas rotas do console.
 *
 * NÃO validado em aparelho: tudo aqui segue a referência escrita do protocolo
 * e o simulador do agente.
 */

/** `Facial_Devices.tipo` do Módulo Guarita. */
export const TIPO_DEVICE_GUARITA = 'guarita';

/** `Facial_Devices.fabricante` do Módulo Guarita (família `linear` no agente). */
export const FABRICANTE_LINEAR = 'linear';

/** Porta TCP principal do Guarita (modo servidor). */
export const PORTA_PADRAO_GUARITA = 9000;

/** Tamanho máximo da palavra de autorização TCP do Guarita (15 caracteres ASCII). */
export const PALAVRA_MAX = 15;

/** Operações que o agente executa (entregues em `GET operacoes`). */
export const OPERACOES_DO_AGENTE = [
  'cadastrar',
  'editar',
  'apagar',
  'atualizar_receptores',
  'importar',
  'conferir',
] as const;
export type TipoOperacaoAgente = (typeof OPERACOES_DO_AGENTE)[number];

/** Operações que gravam no Guarita (comando 67). */
export const OPERACOES_DE_GRAVACAO = ['cadastrar', 'editar', 'apagar'] as const;

/** Leituras completas do cadastro (comandos 7 + 70 + 43). */
export const OPERACOES_DE_LEITURA = ['importar', 'conferir'] as const;

/** Janela do cadastro por aproximação: linha em Guarita_Operacoes, nunca entregue ao agente. */
export const OPERACAO_CAPTURA = 'captura';

/** Estados de `Guarita_Operacoes.estado`. */
export const ESTADO_OP = {
  pendente: 'pendente',
  enviada: 'enviada',
  /** Importação/conferência montando as partes (reivindicada por UMA instância). */
  processando: 'processando',
  ok: 'ok',
  falhou: 'falhou',
  cancelada: 'cancelada',
} as const;

/** Estados de `Tags.guarita_estado`. */
export const ESTADO_TAG = {
  aguardandoAprovacao: 'aguardando_aprovacao',
  pendente: 'pendente',
  gravado: 'gravado',
  ativo: 'ativo',
  falhou: 'falhou',
  aVincular: 'a_vincular',
  removendo: 'removendo',
  /** O serial existe no Guarita em OUTRA unidade/bloco: nunca recebe apagar nem editar. */
  conflito: 'conflito',
  /** Veio da importação e sumiu do Guarita (o Prestare não o gravou): o síndico decide. */
  ausente: 'ausente',
  /** Tag do app recusada pela portaria: o mesmo código não volta para a fila. */
  recusada: 'recusada',
} as const;

/** Tipos de dispositivo do Guarita aceitos pela integração (sem BM e SN). */
export const TIPOS_DISPOSITIVO_GUARITA = [1, 2, 3, 6] as const;
export type TipoDispositivoGuarita = (typeof TIPOS_DISPOSITIVO_GUARITA)[number];

/** Sigla de cada tipo, para rótulos ("RF 1", "TA 2"...). */
export const SIGLA_TIPO: Record<number, string> = { 1: 'RF', 2: 'TA', 3: 'CT', 6: 'TP' };

/** `Tags.tipo` das tags que representam um dispositivo do Guarita. */
export const TIPO_TAG_POR_GUARITA: Record<number, string> = {
  1: 'rf',
  2: 'tag_ativo',
  3: 'cartao',
  6: 'tag_passivo',
};

/** Operação `enviada` há mais que isto sem resultado volta a ser entregue. */
export const REENTREGA_MS = 5 * 60 * 1000;

/** No máximo isto por `GET operacoes`. */
export const MAX_OPERACOES_POR_PEDIDO = 50;

/** Frames por parte na importação (o agente manda até isto em cada POST). */
export const MAX_FRAMES_POR_PARTE = 500;

/** Capacidade do Guarita (dispositivos) — teto de sanidade da importação. */
export const MAX_DISPOSITIVOS_GUARITA = 12000;

/** Acima disto (segundos), a diferença do relógio do Guarita vira aviso. */
export const AVISO_RELOGIO_S = 120;

/** Janela do cadastro por aproximação. */
export const JANELA_CAPTURA_MS = 60 * 1000;

/** Mensagem de RF digitado (o contador só vem completo na captura 42/90). */
export const MSG_RF_SO_POR_CAPTURA = 'Controle remoto só pode ser cadastrado por captura no Guarita.';

/** Mensagem do código impresso inválido. */
export const MSG_CODIGO_IMPRESSO_INVALIDO = 'Código inválido. Use o formato impresso no cartão: 015 02158.';

/** Chave do estado de conexão reportado pelo agente (Estado_Compartilhado). */
export const chaveEstadoGuarita = (idDevice: number) => `guarita:estado:${idDevice}`;
/** Validade do estado reportado (o agente manda a cada 60 s e a cada mudança). */
export const ESTADO_TTL_MS = 3 * 60 * 1000;

/** Prefixo dos "não cadastrados" recebidos de um Guarita (Estado_Compartilhado). */
export const prefixoNaoCadastrado = (idDevice: number) => `guarita:naocad:${idDevice}:`;
/** Quanto tempo um "não cadastrado" fica disponível para a captura. */
export const NAO_CADASTRADO_TTL_MS = 10 * 60 * 1000;
