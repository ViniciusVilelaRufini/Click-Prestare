import 'package:click/widgets/animations/validation_alert_wrapper.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void main() {
  testWidgets('ValidationAlertWrapper renderiza filho normalmente sem erro', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ValidationAlertWrapper(
            child: Text('Campo de Teste'),
          ),
        ),
      ),
    );

    expect(find.text('Campo de Teste'), findsOneWidget);
    expect(find.byIcon(PhosphorIcons.warningCircle), findsNothing);
  });

  testWidgets('ValidationAlertWrapper exibe ícone e mensagem animada quando há erro', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ValidationAlertWrapper(
            errorText: 'Informe o campo obrigatório.',
            child: Text('Campo com Erro'),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Campo com Erro'), findsOneWidget);
    expect(find.text('Informe o campo obrigatório.'), findsOneWidget);
    expect(find.byIcon(PhosphorIcons.warningCircle), findsOneWidget);
  });

  testWidgets('AppInput integra com ValidationAlertWrapper exibindo erro ao receber errorText', (tester) async {
    final controller = TextEditingController();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppInput(
            label: 'Nome do Visitante',
            controller: controller,
            errorText: 'Informe o nome do visitante.',
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Nome do Visitante'), findsWidgets);
    expect(find.text('Informe o nome do visitante.'), findsOneWidget);
    expect(find.byIcon(PhosphorIcons.warningCircle), findsOneWidget);
  });
}
