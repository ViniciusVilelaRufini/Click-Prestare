import 'package:click/utils/navegacao_login.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('depois do login não sobra nada na pilha para o Voltar',
      (tester) async {
    final key = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: key,
      home: const Text('escolha'),
    ));
    key.currentState!.push(MaterialPageRoute(builder: (_) => const Text('login')));
    await tester.pumpAndSettle();

    entrarLimpandoPilha(key.currentContext!, const Text('inicio'));
    await tester.pumpAndSettle();

    expect(find.text('inicio'), findsOneWidget);
    expect(key.currentState!.canPop(), isFalse);
  });
}
