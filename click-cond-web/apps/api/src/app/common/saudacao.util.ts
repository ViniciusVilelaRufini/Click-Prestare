/** "Olá, Ana!" — e só "Olá!" quando não há nome (nunca "Olá, null!" nem "Olá, !"). */
export function saudacao(nome?: string | null): string {
  const n = typeof nome === 'string' ? nome.trim() : '';
  return n ? `Olá, ${n}!` : 'Olá!';
}
