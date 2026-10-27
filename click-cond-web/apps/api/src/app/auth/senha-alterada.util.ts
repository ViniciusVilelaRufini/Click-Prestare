/**
 * Momento da troca de senha, truncado no segundo. O `iat` do JWT é em
 * segundos inteiros e a coluna é DATETIME(0), que ARREDONDA a fração: gravar
 * 12:00:00.700 viraria 12:00:01 e o token emitido logo depois (iat 12:00:00)
 * seria recusado.
 */
export function momentoTrocaSenha(agora: number = Date.now()): Date {
  return new Date(Math.floor(agora / 1000) * 1000);
}

/** O token foi emitido antes da última troca de senha da conta. */
export function tokenAnteriorATrocaDeSenha(
  iat: number | undefined,
  senhaAlteradaEm: Date | null | undefined,
): boolean {
  if (!senhaAlteradaEm) return false;
  // Sem iat não há como provar que o token é posterior à troca.
  if (!iat) return true;
  return iat < Math.floor(senhaAlteradaEm.getTime() / 1000);
}
