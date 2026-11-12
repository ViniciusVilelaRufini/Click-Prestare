import 'package:click/utils/relatorio_exportar.dart';
import 'package:click/utils/visitantes_presenca.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:open_filex/open_filex.dart';

void main() {
  test('prestador sem nome usa a chave de prestador', () {
    final i = DateTime(2026, 11, 1), t = DateTime(2026, 11, 2);
    expect(
      validarCadastroVisitante(nome: ' ', inicio: i, termino: t, prestador: true),
      'prestador_nome_obrigatorio',
    );
    expect(
      validarCadastroVisitante(nome: ' ', inicio: i, termino: t),
      'visitante_nome_obrigatorio',
    );
  });

  test('avisa quando o relatório não abre', () {
    expect(avisoRelatorioNaoAbriu(ResultType.done), isNull);
    expect(avisoRelatorioNaoAbriu(ResultType.noAppToOpen), contains('nenhum aplicativo'));
    expect(avisoRelatorioNaoAbriu(ResultType.permissionDenied),
        'Relatório gerado, mas o aparelho negou permissão para abri-lo.');
    for (final t in [ResultType.fileNotFound, ResultType.error]) {
      expect(avisoRelatorioNaoAbriu(t),
          'Relatório gerado, mas não foi possível abri-lo. Tente novamente.');
    }
  });

  test('offset leva o mês selecionado para a área visível', () {
    // NOV = índice 10; 54 de largura + 8 de espaço; tela de 360; total 12 itens.
    const max = 12 * 54 + 11 * 8 - 360.0;
    final off = offsetRolagemParaItem(
        index: 10, itemExtent: 54, separator: 8, viewport: 360, maxScrollExtent: max);
    expect(off, greaterThan(0));
    expect(off, lessThanOrEqualTo(max));
    final inicio = 10 * 62.0;
    expect(inicio >= off && inicio + 54 <= off + 360, isTrue);
    expect(offsetRolagemParaItem(
        index: 0, itemExtent: 54, separator: 8, viewport: 360, maxScrollExtent: max), 0);
  });
}
