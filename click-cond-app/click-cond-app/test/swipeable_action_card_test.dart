import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/widgets/app/swipeable_action_card.dart';

void main() {
  group('SwipeableActionCard', () {
    testWidgets('renderiza filho e responde a tap quando fechado', (tester) async {
      bool tapped = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SwipeableActionCard(
              onTap: () => tapped = true,
              actions: [
                SwipeAction(
                  icon: Icons.edit,
                  label: 'Editar',
                  backgroundColor: Colors.blue,
                  onTap: () {},
                ),
              ],
              child: const SizedBox(
                height: 80,
                child: Text('Card Morador'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Card Morador'), findsOneWidget);
      await tester.tap(find.text('Card Morador'));
      await tester.pump();

      expect(tapped, isTrue);
    });

    testWidgets('revela ações ao arrastar para a esquerda e dispara ação', (tester) async {
      bool editTapped = false;
      bool sendTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SwipeableActionCard(
              actions: [
                SwipeAction(
                  icon: Icons.edit,
                  label: 'Editar',
                  backgroundColor: Colors.grey,
                  onTap: () => editTapped = true,
                ),
                SwipeAction(
                  icon: Icons.send,
                  label: 'Enviar',
                  backgroundColor: Colors.blue,
                  onTap: () => sendTapped = true,
                ),
              ],
              child: const SizedBox(
                width: 400,
                height: 80,
                child: Text('Card Deslizável'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Card Deslizável'), findsOneWidget);
      expect(find.text('Editar'), findsOneWidget);
      expect(find.text('Enviar'), findsOneWidget);

      // Simula arraste para a esquerda
      await tester.drag(find.text('Card Deslizável'), const Offset(-200, 0));
      await tester.pumpAndSettle();

      // Clica em 'Enviar'
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();

      expect(sendTapped, isTrue);
      expect(editTapped, isFalse);
    });
  });
}
