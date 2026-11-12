/// Telefone para exibição. Há telefones gravados só com dígitos
/// ("11945700985") e outros já formatados ("(17) 98833-8146"); aqui só os
/// puramente numéricos de 10 ou 11 dígitos ganham máscara. O valor gravado
/// não muda.
String formatarTelefoneExibicao(String? telefone) {
  final s = (telefone ?? '').trim();
  if (!RegExp(r'^\d+$').hasMatch(s)) return s;
  if (s.length == 11) {
    return '(${s.substring(0, 2)}) ${s.substring(2, 7)}-${s.substring(7)}';
  }
  if (s.length == 10) {
    return '(${s.substring(0, 2)}) ${s.substring(2, 6)}-${s.substring(6)}';
  }
  return s;
}
