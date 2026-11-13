import type { Prisma } from '../prisma/generated';

/**
 * Vaga cedida a visitante tem prazo (`fim`). Passado o fim, ela deixa de
 * valer — não ocupa vaga do apartamento nem dá usos ilimitados ao visitante
 * no aparelho — mesmo sem ninguém ter revogado: a linha segue `ativo = 1` até
 * o porteiro ou o morador revogar. Não há job que encerre a vaga; a vigência
 * é decidida na leitura, por este filtro (somado a `ativo: 1`).
 */
export function whereVagaVigente(agora: Date = new Date()): Prisma.VagasWhereInput {
  return { OR: [{ tipo_ocupacao: { not: 'visitante' } }, { fim: null }, { fim: { gt: agora } }] };
}

/** A mesma regra de `whereVagaVigente`, para uma vaga já lida. */
export function vagaVencida(
  v: { tipo_ocupacao?: string | null; fim?: Date | string | null },
  agora: Date = new Date(),
): boolean {
  return v.tipo_ocupacao === 'visitante' && v.fim != null && new Date(v.fim).getTime() <= agora.getTime();
}
