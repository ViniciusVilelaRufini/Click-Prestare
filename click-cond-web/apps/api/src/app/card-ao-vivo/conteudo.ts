/**
 * Conteúdo do card ao vivo da portaria remota.
 *
 * As chaves de `ConteudoCard` são as do `CardPortariaAttributes.ContentState`
 * em Swift (ios/CardPortaria/CardPortariaAttributes.swift) e as que o app
 * Android lê do push de dados. Mudar um nome aqui exige mudar lá também: o
 * iOS descarta em silêncio um content-state que não decodifica.
 *
 * Datas viajam como epoch em SEGUNDOS (número): o JSONDecoder do ActivityKit
 * decodifica `Date` como segundos desde 2001, não 1970.
 */

export type FaseCard = 'aguardando' | 'liberado' | 'entrou' | 'negado' | 'expirado';

/** Janela de resposta do morador (igual ao "Sem resposta" da portaria-web). */
export const JANELA_RESPOSTA_SEG = 180;

export interface BaseCard {
  nome: string;
  isPrestador: boolean;
  bloco: string | null;
  apto: string | null;
  /** Quando o porteiro pediu (auth_solicitado_em). */
  solicitadoEm: Date;
}

export interface ConteudoCard {
  fase: FaseCard;
  nome: string;
  tipo: 'Visitante' | 'Prestador';
  unidade: string;
  chegouEm: number;
  expiraEm: number;
  respondidoPor: string | null;
  voceRespondeu: boolean;
  pelaPortaria: boolean;
  horaResposta: number | null;
  horaEntrada: number | null;
}

export interface AtributosCard {
  idCartao: string;
  idPedido: string;
  origem: string;
}

export function epochSeg(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export function rotuloUnidade(bloco: string | null, apto: string | null): string {
  const partes: string[] = [];
  if (bloco && bloco.trim()) partes.push(`Bloco ${bloco.trim()}`);
  if (apto && apto.trim()) partes.push(`Apto ${apto.trim()}`);
  return partes.join(' · ');
}

export function montarConteudo(
  base: BaseCard,
  fase: FaseCard,
  extras: Partial<ConteudoCard> = {},
): ConteudoCard {
  const chegouEm = epochSeg(base.solicitadoEm);
  return {
    fase,
    nome: base.nome,
    tipo: base.isPrestador ? 'Prestador' : 'Visitante',
    unidade: rotuloUnidade(base.bloco, base.apto),
    chegouEm,
    expiraEm: chegouEm + JANELA_RESPOSTA_SEG,
    respondidoPor: null,
    voceRespondeu: false,
    pelaPortaria: false,
    horaResposta: null,
    horaEntrada: null,
    ...extras,
  };
}

/** Título e corpo do alerta que acompanha a abertura do card (e o push comum). */
export function textoAlerta(c: Pick<ConteudoCard, 'tipo' | 'nome'>) {
  return {
    titulo: `${c.tipo} na portaria`,
    corpo: `${c.nome} quer entrar. Autorizar?`,
  };
}

/** Push-to-start (iOS 17.2+): abre o card com o app fechado. */
export function payloadInicio(c: ConteudoCard, attrs: AtributosCard, agora: number) {
  const alerta = textoAlerta(c);
  return {
    aps: {
      timestamp: agora,
      event: 'start',
      'content-state': c,
      'attributes-type': 'CardPortariaAttributes',
      attributes: attrs,
      // iOS 18+: pede ao sistema que emita o token de atualização deste card
      // (sem ele o iPhone não confirma e o card não recebe as fases).
      'input-push-token': 1,
      // Card AGUARDANDO perde o sentido depois da janela de resposta; o tique
      // do servidor manda EXPIRADO, isto é só a rede de segurança do iOS.
      'stale-date': c.expiraEm + 30,
      alert: { title: alerta.titulo, body: alerta.corpo, sound: 'default' },
      sound: 'default',
    },
  };
}

export function payloadAtualizacao(c: ConteudoCard, agora: number) {
  return {
    aps: {
      timestamp: agora,
      event: 'update',
      'content-state': c,
    },
  };
}

/** Encerra o card mostrando `c` por `dismissalSeg` segundos (0 = some já). */
export function payloadFim(c: ConteudoCard, agora: number, dismissalSeg: number) {
  return {
    aps: {
      timestamp: agora,
      event: 'end',
      'content-state': c,
      'dismissal-date': agora + dismissalSeg,
    },
  };
}
