import { rotuloBloco } from '../common/rotulo-bloco.util';

/**
 * Rótulo da unidade para as telas de visitante ("106 · Bloco A"; o front prefixa "Apto ").
 * Antes era `${apto}${bloco}`, que dava "106Bloco A" com o bloco cadastrado como "Bloco A".
 * Só exibição — agrupamentos usam o id do apartamento.
 */
export function rotuloAptoBloco(apto: string | null | undefined, bloco: string | null | undefined): string {
  const a = (apto ?? '').trim();
  const b = rotuloBloco(bloco);
  if (a && b) return `${a} · ${b}`;
  return a || b;
}
