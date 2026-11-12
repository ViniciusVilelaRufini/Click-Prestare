/// Tipo do morador normalizado para comparação: sem acento nem caixa, e com
/// "membro" tratado como "dependente" (a API pode devolver qualquer um dos dois).
String tipoMoradorNormalizado(String? tipo) {
  final t = (tipo ?? '')
      .trim()
      .toLowerCase()
      .replaceAll('á', 'a')
      .replaceAll('ê', 'e');
  return t == 'membro' ? 'dependente' : t;
}

/// Rótulo de exibição do tipo ("Proprietário", "Inquilino", "Dependente").
/// Só para mostrar: os valores usados nos filtros não mudam.
String rotuloTipoMorador(String? tipo) {
  switch (tipoMoradorNormalizado(tipo)) {
    case 'proprietario':
      return 'Proprietário';
    case 'inquilino':
      return 'Inquilino';
    case 'dependente':
      return 'Dependente';
    default:
      final s = (tipo ?? '').trim();
      return s.isEmpty ? 'Proprietário' : s;
  }
}
