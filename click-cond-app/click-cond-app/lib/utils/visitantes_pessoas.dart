/// Visitantes e prestadores contados por PESSOA, não por visita.
///
/// A API devolve uma linha por visita/cadastro: quem entrou 20 vezes aparece
/// 20 vezes. Os chips "Todos / Visitantes / Prestadores" contavam linhas e
/// diziam "20" para uma única pessoa, enquanto a aba "Cadastrados" já mostrava
/// uma por pessoa. Esta função concentra a regra de identidade para as duas
/// leituras contarem igual.
library;

/// Chave de documento: só dígitos. Só vale como identidade com 4+ dígitos.
String _docDigitos(Map<dynamic, dynamic> item) =>
    (item['doc_identificacao'] ?? '')
        .toString()
        .replaceAll(RegExp(r'\D'), '')
        .trim();

String _nomeNormalizado(Map<dynamic, dynamic> item) => (item['nome'] ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replaceAll(RegExp(r'\s+'), ' ');

String _foto(Map<dynamic, dynamic> item) =>
    (item['foto_pessoa'] ?? item['photo'])?.toString().trim() ?? '';

bool _fotoValida(String foto) =>
    foto.isNotEmpty && foto != 'null' && foto != 'undefined';

/// Agrupa as linhas por pessoa e devolve UMA linha por pessoa (a primeira
/// ocorrência, completada com foto/documento das demais quando faltarem).
///
/// Duas linhas são a mesma pessoa se tiverem o mesmo documento (4+ dígitos),
/// o mesmo nome normalizado (minúsculas, espaços colapsados) ou a mesma URL
/// http de foto. As linhas recebidas não são alteradas: o resultado contém
/// cópias.
List<Map<String, dynamic>> deduplicarPessoas(Iterable<dynamic> linhas) {
  final List<Map<String, dynamic>> pessoas = [];

  for (final raw in linhas) {
    final item = Map<String, dynamic>.from(raw as Map);
    final docDigits = _docDigitos(item);
    final nomeNorm = _nomeNormalizado(item);
    final photoUrl = _foto(item);
    final hasValidPhoto = _fotoValida(photoUrl);

    int matchIndex = -1;
    for (int i = 0; i < pessoas.length; i++) {
      final existing = pessoas[i];
      final existingDoc = _docDigitos(existing);
      final existingNome = _nomeNormalizado(existing);
      final existingPhoto = _foto(existing);

      final matchDoc = docDigits.length >= 4 && existingDoc == docDigits;
      final matchNome = nomeNorm.isNotEmpty && existingNome == nomeNorm;
      final matchPhoto = hasValidPhoto &&
          _fotoValida(existingPhoto) &&
          photoUrl.startsWith('http') &&
          existingPhoto == photoUrl;

      if (matchDoc || matchNome || matchPhoto) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex == -1) {
      pessoas.add(item);
    } else {
      final existing = pessoas[matchIndex];
      final existingPhoto = _foto(existing);
      if ((existingPhoto.isEmpty || existingPhoto == 'null') &&
          hasValidPhoto) {
        existing['foto_pessoa'] = photoUrl;
        existing['photo'] = photoUrl;
      }
      final existingDoc =
          (existing['doc_identificacao'] ?? '').toString().trim();
      if (existingDoc.isEmpty && docDigits.isNotEmpty) {
        existing['doc_identificacao'] = item['doc_identificacao'];
      }
    }
  }

  return pessoas;
}
