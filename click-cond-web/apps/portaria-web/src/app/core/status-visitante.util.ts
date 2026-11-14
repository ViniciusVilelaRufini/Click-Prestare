import { AUTORIZACAO_EXPIRACAO_MS } from '../visitantes/visitantes.service';

/**
 * Status de uma visita/pessoa como a tela de Visitantes mostra
 * (visitantes-page.component.ts: `autorizacaoExpirada`, `janelaEncerrada`
 * e `getStatusVisitante`), em funções puras para outras telas usarem o MESMO
 * critério. O dashboard listava em "Na portaria agora" como "Liberado" quem
 * a tela de Visitantes mostrava "Janela encerrada" / "Autorização expirada":
 * ele lia o `statusLabel` da API, que diz "Liberado" com `liberado = 1`
 * mesmo com a janela vencida.
 *
 * Cópia fiel da regra da tela de Visitantes (que não foi alterada aqui): se
 * uma mudar, a outra tem de acompanhar.
 */
export interface VisitaParaStatus {
  liberado?: number | boolean;
  is_prestador?: number | null;
  dias_semana?: string | null;
  data_entrada?: string | null;
  data_saida?: string | null;
  data_hora_inicio?: string | null;
  data_hora_termino?: string | null;
  autorizacao_expirada?: boolean;
  auth_status?: 'pendente' | 'autorizado' | 'negado' | null;
  auth_solicitado_em?: string | null;
  auth_respondido_em?: string | null;
}

export type StatusVisitante = 'presente' | 'liberado' | 'autorizado' | 'agendado' | 'expirado' | 'saiu';

/** Pedido pendente ou autorizado há mais que 10 minutos (expirado). */
export function autorizacaoExpirada(p: VisitaParaStatus | null | undefined, agoraMs: number): boolean {
  if (!p) return false;
  if (p.auth_status === 'pendente') {
    const sol = p.auth_solicitado_em;
    if (!sol) return false;
    return agoraMs - new Date(sol).getTime() > AUTORIZACAO_EXPIRACAO_MS;
  }
  if (p.auth_status === 'autorizado') {
    if (p.data_entrada && !p.data_saida) return false; // presente no condomínio
    const refTime = p.auth_respondido_em || p.auth_solicitado_em;
    if (!refTime) return false;
    return agoraMs - new Date(refTime).getTime() > AUTORIZACAO_EXPIRACAO_MS;
  }
  return false;
}

/** Liberado, mas a janela da visita já terminou: o terminal recusa a entrada. */
export function janelaEncerrada(v: VisitaParaStatus, agoraMs: number): boolean {
  if (v.liberado !== 1 || (v.data_entrada && !v.data_saida)) return false;
  return !!v.data_hora_termino && new Date(v.data_hora_termino).getTime() < agoraMs;
}

export function statusVisitante(v: VisitaParaStatus, agoraMs: number): StatusVisitante {
  const liberado = v.liberado === 1;
  if (v.data_entrada && !v.data_saida) return 'presente';
  // Prestador e visitante recorrente mantêm a liberação depois da saída.
  const acessoContinuo = liberado && (v.is_prestador === 1 || !!String(v.dias_semana ?? '').trim());
  if (v.data_saida && !acessoContinuo) return 'saiu';
  if (v.autorizacao_expirada) return 'expirado';
  if (liberado && v.data_hora_inicio && new Date(v.data_hora_inicio).getTime() > agoraMs) return 'agendado';
  if (liberado && !autorizacaoExpirada(v, agoraMs)) {
    return janelaEncerrada(v, agoraMs) ? 'saiu' : 'liberado';
  }
  if (liberado && v.data_hora_inicio && v.data_hora_termino) {
    const inicio = new Date(v.data_hora_inicio).getTime();
    const fim = new Date(v.data_hora_termino).getTime();
    if (agoraMs >= inicio && agoraMs <= fim) return 'autorizado';
  }
  return 'saiu';
}
