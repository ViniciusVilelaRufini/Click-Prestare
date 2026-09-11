import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/aceite_privacidade.dart';

/// A tela de consentimento LGPD.
///
/// Duas regras aqui não são estéticas, são jurídicas:
///
///  1. "Aceitar e continuar" só funciona com a caixa de privacidade marcada.
///     Consentimento presumido não é consentimento (Art. 8º).
///  2. A caixa da biometria é OPCIONAL e não trava o botão. O Art. 8º, §3º
///     exige consentimento livre; biometria obrigatória seria condição de
///     uso. Se alguém "simplificar" isso um dia, este teste quebra.
void main() {
  // A tela é longa: na viewport padrão (800x600) o ListView nem constrói as
  // caixas, e os testes falhariam por motivo errado.
  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.physicalSize = const Size(1000, 3000);
    view.devicePixelRatio = 1.0;
  });
  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  Widget montar() => const MaterialApp(home: AceitePrivacidadePage());

  testWidgets('mostra as duas caixas, uma obrigatória e outra opcional', (tester) async {
    await tester.pumpWidget(montar());

    expect(find.text('Obrigatório'), findsOneWidget);
    expect(find.text('Opcional'), findsOneWidget);
  });

  testWidgets('informa o que o Art. 9º manda informar', (tester) async {
    await tester.pumpWidget(montar());

    expect(find.text('O que tratamos e para quê'), findsOneWidget);
    expect(find.text('Com quem compartilhamos'), findsOneWidget);
    expect(find.text('Por quanto tempo'), findsOneWidget);
    expect(find.text('Seus direitos'), findsOneWidget);
  });

  testWidgets('o botão nasce desabilitado — sem aceite não se entra', (tester) async {
    await tester.pumpWidget(montar());

    final botao = tester.widget<ElevatedButton>(
      find.widgetWithText(ElevatedButton, 'Aceitar e continuar'),
    );
    expect(botao.onPressed, isNull);
  });

  testWidgets('marcar SÓ a biometria não libera o botão', (tester) async {
    await tester.pumpWidget(montar());

    // Toca na segunda caixa (biometria).
    await tester.tap(find.text('Opcional'));
    await tester.pump();

    final botao = tester.widget<ElevatedButton>(
      find.widgetWithText(ElevatedButton, 'Aceitar e continuar'),
    );
    expect(botao.onPressed, isNull);
  });

  testWidgets('marcar a privacidade libera o botão, mesmo sem a biometria', (tester) async {
    await tester.pumpWidget(montar());

    await tester.tap(find.text('Obrigatório'));
    await tester.pump();

    final botao = tester.widget<ElevatedButton>(
      find.widgetWithText(ElevatedButton, 'Aceitar e continuar'),
    );
    // Recusar biometria não pode impedir o uso do app.
    expect(botao.onPressed, isNotNull);
  });

  testWidgets('oferece sair sem aceitar', (tester) async {
    await tester.pumpWidget(montar());
    expect(find.text('Recusar e sair'), findsOneWidget);
  });
}
