import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Folga para o "começa agora": o porteiro que cadastra quem está no portão
 * manda a hora do próprio PC, que pode estar alguns minutos adiantado.
 */
export const MARGEM_INICIO_AGORA_MS = 10 * 60 * 1000;

/**
 * Quem cadastrou é a portaria: o operador do console (token com
 * `id_condominio`, porteiro ou síndico que entrou por lá) ou o funcionário
 * pelo app. Síndico e morador pelo app são quem agenda, não quem recebe na
 * portaria.
 */
export function criadoPelaPortaria(operador?: JwtPayload | null): boolean {
  if (!operador) return false;
  if (operador.id_condominio) return true;
  const tipo = (operador.typeAccess ?? operador.user?.typeAccess ?? '').toString().toLowerCase();
  return tipo === 'funcionario' || tipo === 'porteiro' || tipo === 'operador';
}

/**
 * O aviso que a unidade recebe quando uma visita nasce liberada.
 *
 * - `chegada`: a portaria cadastrou quem está no portão agora. "Acabou de
 *   chegar" por push e WhatsApp, como sempre foi.
 * - `agendamento`: morador/síndico agendou pelo app, ou a janela começa no
 *   futuro. Push com a data, sem WhatsApp (não é urgente). A chegada de fato
 *   é avisada pela entrada no facial.
 */
export function tipoAvisoCriacaoVisita(
  operador: JwtPayload | null | undefined,
  inicio: Date | string | null | undefined,
  agora: number = Date.now(),
): 'chegada' | 'agendamento' {
  if (!criadoPelaPortaria(operador)) return 'agendamento';
  const ini = inicio ? new Date(inicio).getTime() : NaN;
  if (!Number.isNaN(ini) && ini > agora + MARGEM_INICIO_AGORA_MS) return 'agendamento';
  return 'chegada';
}

/**
 * Descrição da auditoria do cadastro de uma visita: "agendamento" só quando é um
 * agendamento; a portaria que libera quem está no portão agora não agendou nada.
 */
export function descricaoCriacaoVisita(
  tipoLabel: string,
  nome: string,
  apto: string,
  operador: JwtPayload | null | undefined,
  inicio: Date | string | null | undefined,
  aguardaAutorizacao = false,
): string {
  if (aguardaAutorizacao) return `Novo cadastro: ${tipoLabel} "${nome}" para ${apto}`;
  return tipoAvisoCriacaoVisita(operador, inicio) === 'chegada'
    ? `${tipoLabel} liberado pela portaria: "${nome}" para ${apto}`
    : `Novo agendamento: ${tipoLabel} "${nome}" para ${apto}`;
}
