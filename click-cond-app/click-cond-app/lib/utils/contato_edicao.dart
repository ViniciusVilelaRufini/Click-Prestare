/// CPF/CNPJ para exibir num campo de edição. Só valores puramente numéricos
/// de 11 (CPF) ou 14 dígitos (CNPJ) ganham máscara; o resto fica como está
/// (RG, passaporte, valor já formatado).
String formatarDocumentoEdicao(String? documento) {
  final s = (documento ?? '').trim();
  if (!RegExp(r'^\d+$').hasMatch(s)) return s;
  if (s.length == 11) {
    return '${s.substring(0, 3)}.${s.substring(3, 6)}.${s.substring(6, 9)}-${s.substring(9)}';
  }
  if (s.length == 14) {
    return '${s.substring(0, 2)}.${s.substring(2, 5)}.${s.substring(5, 8)}/'
        '${s.substring(8, 12)}-${s.substring(12)}';
  }
  return s;
}

/// Telefone para exibir num campo de edição: "+5517992559990" e
/// "17992559990" viram "(17) 99255-9990". Fora de 10/11 dígitos (com ou sem
/// o 55 do país) o valor fica como veio.
String formatarTelefoneEdicao(String? telefone) {
  final s = (telefone ?? '').trim();
  if (s.isEmpty) return s;
  var d = s.replaceAll(RegExp(r'\D'), '');
  if (d.startsWith('55') && (d.length == 12 || d.length == 13)) {
    d = d.substring(2);
  }
  if (d.length == 11) {
    return '(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}';
  }
  if (d.length == 10) {
    return '(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}';
  }
  return s;
}

/// Valor a enviar à API de um campo exibido com máscara. Se o usuário não
/// mexeu (o texto é o próprio [formatar] do [original]), segue o [original]
/// exatamente como veio do servidor, então a máscara de exibição nunca muda o
/// que é gravado. Se mexeu, vale o texto digitado; com [soDigitos] a máscara é
/// removida (telas que antes enviavam o que o usuário digitava, sem máscara).
String contatoParaEnvio({
  required String exibido,
  required String original,
  required String Function(String?) formatar,
  bool soDigitos = false,
}) {
  if (exibido == formatar(original)) return original;
  // Só tira a máscara de valores que são só números e pontuação (CPF/CNPJ,
  // telefone); um RG com letras segue como foi digitado.
  if (soDigitos && RegExp(r'^[\d\s.\-/()+]+$').hasMatch(exibido)) {
    return exibido.replaceAll(RegExp(r'\D'), '');
  }
  return exibido;
}

/// Telefone a enviar à API. Sem mexer, vai o [original]. Editado, se o
/// original tinha o prefixo do país ("+5517…" ou "5517…" com 12/13 dígitos) o
/// novo número volta com o mesmo estilo de prefixo ("+55" ou "55") e só
/// dígitos; sem prefixo no original, segue o comportamento de
/// [contatoParaEnvio] (com [soDigitos] conforme a tela).
String telefoneParaEnvio({
  required String exibido,
  required String original,
  bool soDigitos = false,
}) {
  if (exibido == formatarTelefoneEdicao(original)) return original;
  final o = original.trim();
  final dOrig = o.replaceAll(RegExp(r'\D'), '');
  final temPrefixo =
      dOrig.startsWith('55') && (dOrig.length == 12 || dOrig.length == 13);
  final puro = RegExp(r'^[\d\s.\-/()+]+$').hasMatch(exibido);
  if (temPrefixo && puro) {
    var d = exibido.replaceAll(RegExp(r'\D'), '');
    if (d.startsWith('55') && (d.length == 12 || d.length == 13)) {
      d = d.substring(2);
    }
    return '${o.startsWith('+') ? '+55' : '55'}$d';
  }
  return contatoParaEnvio(
    exibido: exibido,
    original: original,
    formatar: formatarTelefoneEdicao,
    soDigitos: soDigitos,
  );
}
