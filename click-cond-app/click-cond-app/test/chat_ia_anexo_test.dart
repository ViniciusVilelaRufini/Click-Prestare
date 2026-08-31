import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void main() {
  testWidgets('ChatIaPage exibe botão de anexo (paperclip) e campo de texto', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: ChatIaPage(),
      ),
    );
    await tester.pumpAndSettle();

    // Verifica que o botão de anexo existe
    expect(find.byIcon(PhosphorIcons.paperclip), findsOneWidget);
    // Verifica que o campo de texto existe
    expect(find.byType(TextField), findsOneWidget);
  });
}
