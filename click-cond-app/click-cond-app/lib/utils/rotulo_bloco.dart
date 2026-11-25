/// Rótulo do bloco para exibição. Há condomínios com o bloco cadastrado como
/// "Bloco A" e outros só como "A"; prefixar sempre gerava "Bloco Bloco A".
String rotuloBloco(String? bloco) {
  final s = (bloco ?? '').trim();
  if (s.isEmpty || s == 'null') return '';
  return RegExp(r'^bloco\b', caseSensitive: false).hasMatch(s) ? s : 'Bloco $s';
}

/// Unidade nos cards de reserva: "Bloco A · Apto 106" (sem bloco, só "Apto 106").
String rotuloUnidadeCard(String? bloco, String? apto, {String rotuloApto = 'Apto'}) {
  final b = rotuloBloco(bloco);
  final a = (apto ?? '').trim();
  return [if (b.isNotEmpty) b, if (a.isNotEmpty) '$rotuloApto $a'].join(' · ');
}

/// Unidade para exibição/exportação: "Bloco A - Apto 12" (sem "Bloco Bloco").
/// Partes vazias são omitidas.
String rotuloUnidade(String? bloco, String? apto) {
  final b = rotuloBloco(bloco);
  final a = (apto ?? '').trim();
  return [if (b.isNotEmpty) b, if (a.isNotEmpty) 'Apto $a'].join(' - ');
}
