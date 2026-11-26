import { formatarApto } from '../common/formatar-apto.util';

/**
 * Rótulo da unidade para as telas de visitante ("Bloco A · Apto 106", ou "Apto 106" sem bloco).
 * Só exibição — agrupamentos usam o id do apartamento.
 */
export function rotuloAptoBloco(apto: string | null | undefined, bloco: string | null | undefined): string {
  return formatarApto(apto, bloco);
}
