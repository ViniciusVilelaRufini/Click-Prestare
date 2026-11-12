/// Regras puras da tela de ocorrência (nova/edição), testáveis sem widget.
library;

const msgDescricaoObrigatoria = 'Descrição é obrigatória.';

/// Quantos anexos a ocorrência já tem no servidor (`anexos` separados por ';').
/// `''.split(';')` dá `['']`: parte vazia não conta.
int contarAnexos(dynamic anexos) {
  if (anexos is! String) return 0;
  return anexos.split(';').where((p) => p.trim().isNotEmpty).length;
}

/// Converte os arquivos escolhidos para envio, pulando o que for nulo — tanto
/// o arquivo quanto a conversão (`convertToBase64` devolve null quando não
/// consegue ler). Lista vazia = sem fotos novas, e o servidor mantém as atuais.
List<String> anexosParaEnvio(List<dynamic> arquivos, dynamic Function(dynamic arquivo) converter) {
  final saida = <String>[];
  for (final arquivo in arquivos) {
    if (arquivo == null) continue;
    final convertido = converter(arquivo);
    if (convertido is String && convertido.isNotEmpty) saida.add(convertido);
  }
  return saida;
}

/// Mesma regra da API: descrição só com espaços não é relato.
String? validarDescricaoOcorrencia(String texto) =>
    texto.trim().isEmpty ? msgDescricaoObrigatoria : null;

/// Aviso na edição: os anexos atuais ficam no servidor e só são trocados se o
/// usuário enviar fotos novas.
String avisoAnexosMantidos(int quantidade) => quantidade == 1
    ? '1 anexo atual será mantido se você não enviar novos.'
    : '$quantidade anexos atuais serão mantidos se você não enviar novos.';
