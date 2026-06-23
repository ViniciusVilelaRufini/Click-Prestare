/**
 * Engine das Regras de Acesso (modelo WHITELIST), extraída como função pura
 * para ser testável de forma exaustiva (ver access-rules.spec.ts).
 *
 * Regra do modelo: se um terminal TEM regras ativas, ele é restrito — o acesso
 * só passa se EXISTIR alguma regra que cubra SIMULTANEAMENTE o sentido
 * (entrada/saida), o horário e a categoria da pessoa. Se nenhuma cobrir, NEGA.
 * Terminal SEM regras ativas = liberado (não restrito).
 */

export type CategoriaPessoa =
  | 'morador'
  | 'visitante'
  | 'prestador'
  | 'funcionario';

export interface RegraAcessoLike {
  /** 'entrada' | 'saida' | 'ambos' */
  sentido: string;
  /** "HH:MM" ou null (sem restrição de horário) */
  hora_inicio: string | null;
  hora_fim: string | null;
  permitir_morador: number;
  permitir_visitante: number;
  permitir_prestador: number;
  permitir_funcionario: number;
}

/** A regra cobre a categoria da pessoa? */
function cobreCategoria(r: RegraAcessoLike, tipo: CategoriaPessoa): boolean {
  if (tipo === 'morador') return r.permitir_morador === 1;
  if (tipo === 'visitante') return r.permitir_visitante === 1;
  if (tipo === 'prestador') return r.permitir_prestador === 1;
  if (tipo === 'funcionario') return r.permitir_funcionario === 1;
  return false;
}

/** A regra cobre o horário "HH:MM"? (sem hora_inicio/fim = horário livre) */
function cobreHorario(r: RegraAcessoLike, horaMinuto: string): boolean {
  if (!r.hora_inicio || !r.hora_fim) return true;
  if (r.hora_inicio <= r.hora_fim) {
    return horaMinuto >= r.hora_inicio && horaMinuto <= r.hora_fim;
  }
  // Faixa que cruza a meia-noite (ex.: 22:00–06:00)
  return horaMinuto >= r.hora_inicio || horaMinuto <= r.hora_fim;
}

/** Existe alguma regra que cobre sentido + horário + categoria? */
export function algumaRegraPermite(
  regras: RegraAcessoLike[],
  evento: string,
  tipoPessoa: CategoriaPessoa,
  horaMinuto: string,
): boolean {
  for (const r of regras) {
    if (r.sentido !== 'ambos' && r.sentido !== evento) continue;
    if (!cobreHorario(r, horaMinuto)) continue;
    if (cobreCategoria(r, tipoPessoa)) return true;
  }
  return false;
}

/**
 * Decisão final usada pelo webhook: o acesso deve ser BLOQUEADO pelas regras?
 * - Sem regras ativas → false (terminal liberado).
 * - Com regras, mas nenhuma cobre o caso atual → true (bloqueia).
 */
export function bloqueadoPorRegrasAcesso(
  regras: RegraAcessoLike[],
  evento: string,
  tipoPessoa: CategoriaPessoa,
  horaMinuto: string,
): boolean {
  if (regras.length === 0) return false;
  return !algumaRegraPermite(regras, evento, tipoPessoa, horaMinuto);
}
