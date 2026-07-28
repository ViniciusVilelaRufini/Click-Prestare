/**
 * Só os dígitos de um documento. "453.466.488-53" → "45346648853".
 *
 * A senha inicial de morador e funcionário é o CPF, e ela vai por e-mail para
 * a pessoa digitar no login. Com a máscara, o que chega é
 * "453.466.488-53" — quem digita erra o ponto ou o traço e não entra. O
 * documento é gravado como veio do formulário (às vezes com máscara, às vezes
 * sem), então normalizar aqui garante que a senha seja sempre a mesma coisa,
 * independente de como foi digitado no cadastro.
 *
 * Devolve string vazia para nulo/indefinido, para o chamador cair no `||`
 * do valor padrão.
 */
export function somenteDigitos(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\D/g, '');
}
