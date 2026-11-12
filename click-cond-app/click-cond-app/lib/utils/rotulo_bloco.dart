/// Rótulo do bloco para exibição. Há condomínios com o bloco cadastrado como
/// "Bloco A" e outros só como "A"; prefixar sempre gerava "Bloco Bloco A".
String rotuloBloco(String? bloco) {
  final s = (bloco ?? '').trim();
  if (s.isEmpty || s == 'null') return '';
  return RegExp(r'^bloco\b', caseSensitive: false).hasMatch(s) ? s : 'Bloco $s';
}

/// Unidade para exibição/exportação: "Bloco A - Apto 12" (sem "Bloco Bloco").
/// Partes vazias são omitidas.
String rotuloUnidade(String? bloco, String? apto) {
  final b = rotuloBloco(bloco);
  final a = (apto ?? '').trim();
  return [if (b.isNotEmpty) b, if (a.isNotEmpty) 'Apto $a'].join(' - ');
}
