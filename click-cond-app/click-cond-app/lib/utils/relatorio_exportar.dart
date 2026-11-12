import 'package:open_filex/open_filex.dart';

/// Mensagem a mostrar quando o aparelho não conseguiu abrir o relatório
/// exportado, ou null se abriu normalmente.
///
/// `OpenFilex.open` não lança quando não há app para o tipo do arquivo: só
/// devolve um [OpenResult] com `type` diferente de [ResultType.done].
String? avisoRelatorioNaoAbriu(ResultType type) {
  switch (type) {
    case ResultType.done:
      return null;
    case ResultType.noAppToOpen:
      return 'Relatório gerado, mas nenhum aplicativo deste aparelho abre '
          'planilhas (CSV). Instale um leitor de planilhas e tente novamente.';
    case ResultType.permissionDenied:
      return 'Relatório gerado, mas o aparelho negou permissão para abri-lo.';
    case ResultType.fileNotFound:
    case ResultType.error:
      return 'Relatório gerado, mas não foi possível abri-lo. Tente novamente.';
  }
}

/// Posição de rolagem que deixa o item [index] visível (centralizado quando
/// possível) numa lista horizontal de itens de largura fixa.
double offsetRolagemParaItem({
  required int index,
  required double itemExtent,
  required double separator,
  required double viewport,
  required double maxScrollExtent,
}) {
  final inicioItem = index * (itemExtent + separator);
  final centralizado = inicioItem - (viewport - itemExtent) / 2;
  return centralizado.clamp(0.0, maxScrollExtent < 0 ? 0.0 : maxScrollExtent);
}
