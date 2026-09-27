/** Só os dígitos do documento. */
export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** CPF pelos dígitos verificadores (rejeita sequências repetidas como 111.111.111-11). */
export function cpfValido(valor: string): boolean {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

/** CNPJ pelos dígitos verificadores. */
export function cnpjValido(valor: string): boolean {
  const cnpj = soDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12]) && calc(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

/**
 * Erro do documento informado, ou null se ok. 11 dígitos = CPF e 14 = CNPJ,
 * ambos com dígito verificador. Outros tamanhos (RG, passaporte) e vazio passam.
 */
export function erroDocumento(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  if (d.length === 11 && !cpfValido(d)) return 'CPF inválido. Confira os números digitados.';
  if (d.length === 14 && !cnpjValido(d)) return 'CNPJ inválido. Confira os números digitados.';
  return null;
}
