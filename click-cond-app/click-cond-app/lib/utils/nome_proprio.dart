/// Nome de pessoa para exibição: a API devolve como foi gravado (às vezes
/// "VINICIUS VILELA RUFINI", às vezes "vinicius familia"); aqui fica sempre
/// com a inicial maiúscula, mantendo as partículas em minúsculas
/// ("Maria da Silva e Souza"). Nulo ou vazio vira ''.
const _particulas = {'da', 'de', 'do', 'das', 'dos', 'e'};

String nomeProprio(String? nome) {
  final texto = (nome ?? '').trim();
  if (texto.isEmpty) return '';
  final palavras = texto.split(RegExp(r'\s+'));
  final saida = <String>[];
  for (var i = 0; i < palavras.length; i++) {
    final p = palavras[i].toLowerCase();
    if (i > 0 && _particulas.contains(p)) {
      saida.add(p);
    } else {
      saida.add(_capitalizar(p));
    }
  }
  return saida.join(' ');
}

/// Maiúscula no começo e depois de hífen/apóstrofo ("d'Ávila", "Ana-Maria").
String _capitalizar(String palavra) {
  final b = StringBuffer();
  var maiuscula = true;
  for (final c in palavra.split('')) {
    b.write(maiuscula ? c.toUpperCase() : c);
    maiuscula = c == '-' || c == "'" || c == '’';
  }
  return b.toString();
}
