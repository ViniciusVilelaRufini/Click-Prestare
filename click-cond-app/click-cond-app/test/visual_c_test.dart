import 'package:click/pages/shared/configuracoes/configuracoes_view.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/valor_destaque.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> mostrar(WidgetTester t, Widget w, {ThemeMode modo = ThemeMode.light}) =>
      t.pumpWidget(MaterialApp(
        themeMode: modo,
        theme: ThemeData.light(),
        darkTheme: ThemeData.dark(),
        home: Scaffold(body: w),
      ));

  group('ValorDestaque', () {
    testWidgets('prefixo pequeno e número separados', (t) async {
      await mostrar(t, ValorDestaque.doTexto('R\$ 1.250,75'));
      expect(find.text('R\$'), findsOneWidget);
      expect(find.text('1.250,75'), findsOneWidget);
    });

    testWidgets('negativo mantém sinal e cor de erro', (t) async {
      await mostrar(t, ValorDestaque.doTexto('- R\$ 300,00'), modo: ThemeMode.dark);
      final txt = t.widget<Text>(find.text('-300,00'));
      expect(txt.style?.color, AppColors.error);
    });

    testWidgets('zero não ganha sinal', (t) async {
      await mostrar(t, ValorDestaque.doTexto('- R\$ 0,00'));
      expect(find.text('0,00'), findsOneWidget);
    });
  });

  test('nome do idioma atual', () {
    expect(nomeIdiomaPorCodigo('en'), getText('language_en'));
    expect(nomeIdiomaPorCodigo('pt_PT'), getText('language_pt_pt'));
    expect(nomeIdiomaPorCodigo(null), getText('language_pt_br'));
  });
}
