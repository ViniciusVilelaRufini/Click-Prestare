// Validações puras dos formulários do síndico (devolvem a mensagem de erro ou
// null quando está ok). Ficam fora das telas para serem testadas sem widget.

String? validarAssembleia({String? titulo, String? data, String? hora}) {
  if ((titulo ?? '').trim().isEmpty) return 'Informe o título da assembleia.';
  if ((data ?? '').trim().isEmpty || (hora ?? '').trim().isEmpty) {
    return 'Informe a data e a hora da assembleia.';
  }
  return null;
}

String? validarComunicado({String? titulo, String? descricao}) {
  if ((titulo ?? '').trim().isEmpty) return 'Informe o título do comunicado.';
  if ((descricao ?? '').trim().isEmpty) return 'Informe a descrição do comunicado.';
  return null;
}

/// Votação/enquete: título, ao menos duas opções distintas (sem vazias, sem
/// diferenciar maiúsculas) e as duas datas preenchidas.
String? validarVotacao({
  String? titulo,
  required List<String> opcoes,
  String? dataInicio,
  String? dataTermino,
  bool enquete = false,
}) {
  if ((titulo ?? '').trim().isEmpty) {
    return 'Informe o título da ${enquete ? 'enquete' : 'votação'}.';
  }
  final distintas = opcoes.map((o) => o.trim().toLowerCase()).where((o) => o.isNotEmpty).toSet();
  if (distintas.length < 2) return 'Informe pelo menos duas opções diferentes.';
  if ((dataInicio ?? '').trim().isEmpty || (dataTermino ?? '').trim().isEmpty) {
    return 'Informe as datas de início e término.';
  }
  return null;
}

/// Data da mudança ("dd/MM/aaaa", como a API devolve, ou "aaaa-MM-dd") anterior
/// a hoje (dia local). Data ilegível ou vazia não conta como passada.
bool mudancaDataPassada(String? data, {DateTime? hoje}) {
  final s = (data ?? '').trim();
  DateTime? d;
  final br = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})').firstMatch(s);
  final iso = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(s);
  if (br != null) {
    d = DateTime(int.parse(br[3]!), int.parse(br[2]!), int.parse(br[1]!));
  } else if (iso != null) {
    d = DateTime(int.parse(iso[1]!), int.parse(iso[2]!), int.parse(iso[3]!));
  }
  if (d == null) return false;
  final agora = hoje ?? DateTime.now();
  return d.isBefore(DateTime(agora.year, agora.month, agora.day));
}
