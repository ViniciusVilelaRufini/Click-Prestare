/** Nome para comparar: sem espaços nas pontas nem repetidos, minúsculas, sem acento. */
export function nomeNormalizado(nome: string | null | undefined): string {
  return (nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Uma linha de Funcionarios_Portaria cujo login é o e-mail do prestador é o login DESTE prestador quando tem o turno
 * que só a concessão pelo cadastro grava ('Geral') ou, se o turno foi mudado depois (o síndico muda pelo app ou pela
 * aba "Equipe da portaria"), quando o nome é o mesmo do prestador. Não há FK entre as duas tabelas: sem essa
 * corroboração, o login de um colega com o mesmo e-mail é de outra pessoa e nunca é alterado, revogado nem tem a
 * senha tocada. Critério único do cadastro de prestadores, da aba da equipe e do fallback do login do app.
 */
export function ehLoginDoPrestador(
  fp: { login: string; turno: string | null; nome: string | null },
  p: { email: string | null; nome?: string | null },
): boolean {
  if ((fp.login ?? '').trim().toLowerCase() !== (p.email ?? '').trim().toLowerCase()) return false;
  if (fp.turno === 'Geral') return true;
  const nome = nomeNormalizado(p.nome);
  return !!nome && nomeNormalizado(fp.nome) === nome;
}
