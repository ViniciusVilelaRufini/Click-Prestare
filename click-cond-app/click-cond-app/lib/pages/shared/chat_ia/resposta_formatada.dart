import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:flutter/material.dart';

/// Renderiza a resposta do assistente com a formatação que ele realmente usa.
///
/// O Gemini responde em markdown e a bolha mostrava os símbolos crus
/// ("**36 moradores**" aparecia com os asteriscos na tela). Em vez de puxar o
/// flutter_markdown — que traz dependências e um tema próprio para brigar com
/// o do app — este widget cobre só o subconjunto emitido na prática:
///
///   **negrito**            destaque de valor
///   *itálico*
///   - item  /  * item      lista
///   1. item                lista numerada
///   ### titulo             vira uma linha em negrito
///
/// Qualquer outra sintaxe passa como texto normal, que é o comportamento certo
/// para um chat: nunca esconder conteúdo por não saber formatá-lo.
class RespostaFormatada extends StatelessWidget {
  const RespostaFormatada({
    Key? key,
    required this.texto,
    required this.estilo,
  }) : super(key: key);

  final String texto;
  final TextStyle estilo;

  @override
  Widget build(BuildContext context) {
    final linhas = texto.split('\n');
    final widgets = <Widget>[];

    for (var i = 0; i < linhas.length; i++) {
      final bruta = linhas[i];
      final linha = bruta.trim();

      // Linha vazia vira respiro entre parágrafos, sem acumular vários.
      if (linha.isEmpty) {
        if (widgets.isNotEmpty) {
          widgets.add(const SizedBox(height: AppSpacing.sm));
        }
        continue;
      }

      // ### Título -> linha em negrito (o app não usa hierarquia de títulos).
      final titulo = RegExp(r'^#{1,6}\s+(.*)$').firstMatch(linha);
      if (titulo != null) {
        widgets.add(_paragrafo(
          '**${titulo.group(1)}**',
          estilo,
          topo: widgets.isEmpty ? 0 : AppSpacing.xs,
        ));
        continue;
      }

      // - item  |  * item  |  • item
      final marcador = RegExp(r'^[-*•]\s+(.*)$').firstMatch(linha);
      if (marcador != null) {
        widgets.add(_item(context, '•', marcador.group(1)!, estilo));
        continue;
      }

      // 1. item
      final numerada = RegExp(r'^(\d{1,2})[.)]\s+(.*)$').firstMatch(linha);
      if (numerada != null) {
        widgets.add(
          _item(context, '${numerada.group(1)}.', numerada.group(2)!, estilo),
        );
        continue;
      }

      widgets.add(_paragrafo(linha, estilo));
    }

    if (widgets.isEmpty) return Text(texto, style: estilo);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }

  Widget _paragrafo(String linha, TextStyle base, {double topo = 0}) {
    return Padding(
      padding: EdgeInsets.only(top: topo),
      child: RichText(text: TextSpan(children: _inline(linha, base))),
    );
  }

  Widget _item(BuildContext context, String bullet, String conteudo, TextStyle base) {
    return Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Largura fixa para os itens ficarem alinhados entre si.
          SizedBox(
            width: 18,
            child: Text(bullet, style: base.copyWith(color: AppColors.primary)),
          ),
          Expanded(
            child: RichText(text: TextSpan(children: _inline(conteudo, base))),
          ),
        ],
      ),
    );
  }

  /// Quebra **negrito** e *itálico* em spans, preservando o resto do texto.
  static List<TextSpan> _inline(String texto, TextStyle base) {
    final spans = <TextSpan>[];
    // **negrito** primeiro: o padrão de um asterisco também casaria com ele.
    final re = RegExp(r'\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_');
    var cursor = 0;

    for (final m in re.allMatches(texto)) {
      if (m.start > cursor) {
        spans.add(TextSpan(text: texto.substring(cursor, m.start), style: base));
      }
      final negrito = m.group(1) ?? m.group(3);
      if (negrito != null) {
        spans.add(TextSpan(
          text: negrito,
          style: base.copyWith(fontWeight: FontWeight.w600),
        ));
      } else {
        spans.add(TextSpan(
          text: m.group(2) ?? m.group(4),
          style: base.copyWith(fontStyle: FontStyle.italic),
        ));
      }
      cursor = m.end;
    }

    if (cursor < texto.length) {
      spans.add(TextSpan(text: texto.substring(cursor), style: base));
    }
    return spans.isEmpty ? [TextSpan(text: texto, style: base)] : spans;
  }
}
