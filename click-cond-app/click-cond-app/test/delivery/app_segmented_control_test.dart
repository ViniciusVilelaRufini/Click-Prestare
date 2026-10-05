import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const segments = [
    AppSegment(label: 'Ativas', count: 2),
    AppSegment(label: 'Histórico', count: 5),
  ];

  testWidgets('controlado: mostra rótulos em caixa alta com contagem e notifica o toque', (tester) async {
    int? tapped;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AppSegmentedControl(segments: segments, selectedIndex: 0, onChanged: (i) => tapped = i),
      ),
    ));
    expect(find.text('ATIVAS (2)'), findsOneWidget);
    expect(find.text('HISTÓRICO (5)'), findsOneWidget);
    await tester.tap(find.text('HISTÓRICO (5)'));
    expect(tapped, 1);
  });

  testWidgets('ligado ao TabController: toque troca a aba e o destaque acompanha', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: DefaultTabController(
        length: 2,
        child: Scaffold(
          body: Column(children: [
            AppSegmentedControl.tabs(segments: segments),
            const Expanded(child: TabBarView(children: [Text('conteudo-a'), Text('conteudo-b')])),
          ]),
        ),
      ),
    ));
    expect(find.text('conteudo-a'), findsOneWidget);
    await tester.tap(find.text('HISTÓRICO (5)'));
    await tester.pumpAndSettle();
    expect(find.text('conteudo-b'), findsOneWidget);
    final selected = tester.widget<AnimatedContainer>(find.ancestor(
      of: find.text('HISTÓRICO (5)'),
      matching: find.byType(AnimatedContainer),
    ));
    expect((selected.decoration as BoxDecoration).color, isNot(Colors.transparent));
  });
}
