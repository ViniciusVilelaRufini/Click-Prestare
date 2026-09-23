import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/modals/termo_consentimento_menor_modal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('TermoConsentimentoMenorModal renderiza dados das partes e cláusulas LGPD', (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() => tester.view.resetPhysicalSize());

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: TermoConsentimentoMenorModal(
            nomeMenor: 'Enzo Gabriel Vilela',
            nomeResponsavel: 'Vinicius Vilela Rufini',
            dataNascimentoMenor: '15/05/2014',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    // Verifica título e identificações
    expect(find.text('Termo de Consentimento'), findsOneWidget);
    expect(find.text('Biometria Facial para Menores (LGPD Art. 14)'), findsOneWidget);
    expect(find.text('Vinicius Vilela Rufini'), findsOneWidget);
    expect(find.text('Enzo Gabriel Vilela'), findsOneWidget);
    expect(find.text('15/05/2014'), findsOneWidget);

    // Verifica cláusulas
    expect(find.text('Finalidade Específica'), findsOneWidget);
    expect(find.text('Amparo Legal (LGPD Art. 14)'), findsOneWidget);
    expect(find.text('Segurança e Não Compartilhamento'), findsOneWidget);
    expect(find.text('Revogação a Qualquer Momento'), findsOneWidget);

    // O botão "Autorizar e Capturar" deve estar desabilitado enquanto o checkbox não for marcado
    final btnFinder = find.widgetWithText(AppButton, 'Autorizar e Capturar');
    expect(btnFinder, findsOneWidget);
    final AppButton btnAntes = tester.widget(btnFinder);
    expect(btnAntes.onPressed, isNull);

    // Rola até o checkbox se necessário e clica
    final checkboxFinder = find.byType(Checkbox);
    expect(checkboxFinder, findsOneWidget);
    await tester.scrollUntilVisible(checkboxFinder, 100);
    await tester.tap(checkboxFinder);
    await tester.pumpAndSettle();

    // Botão agora deve estar habilitado
    final AppButton btnDepois = tester.widget(btnFinder);
    expect(btnDepois.onPressed, isNotNull);
  });
}
