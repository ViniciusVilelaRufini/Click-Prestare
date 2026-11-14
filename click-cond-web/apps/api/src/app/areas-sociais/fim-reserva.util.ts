/**
 * Término "00:00" é a meia-noite do FIM do dia (o app gera "24:00", que a
 * coluna TIME devolve como 00:00): vale 1440, senão nada colide com ele.
 *
 * Fica fora de areas-sociais.service.ts para o facial.service (que aquele
 * service injeta) poder usar a mesma regra sem import circular.
 */
export function fimEmMinutos(minutos: number): number {
  return minutos === 0 ? 1440 : minutos;
}
