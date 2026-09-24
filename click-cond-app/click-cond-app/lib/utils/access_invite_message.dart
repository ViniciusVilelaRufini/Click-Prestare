String buildVisitorAccessInvite({
  required String condominioNome,
  required String bloco,
  required String apartamento,
  required String autorizadoPor,
  required String codigo,
}) {
  final nomeCondominio =
      condominioNome.trim().isEmpty ? 'Condominio' : condominioNome.trim();
  final nomeAutorizador =
      autorizadoPor.trim().isEmpty ? 'Morador' : autorizadoPor.trim();

  return '\u{1F511} *Convite de Acesso - Prestare*\n\n'
      '\u{1F3E2} *Condom\u00EDnio:* $nomeCondominio\n\n'
      'Ol\u00E1! Sua libera\u00E7\u00E3o de acesso foi cadastrada.\n\n'
      '\u{1F4CD} *Destino:* Bloco $bloco, Apto $apartamento\n'
      '\u{1F464} *Autorizado por:* $nomeAutorizador\n'
      '\u{1F511} *C\u00F3digo de Acesso (PIN):* $codigo\n\n'
      'Apresente este c\u00F3digo ao chegar na portaria para libera\u00E7\u00E3o da sua entrada.';
}
