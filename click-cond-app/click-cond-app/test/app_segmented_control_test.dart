import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Notificações tem 5 filtros com contador: divididos em partes iguais, os
/// rótulos encolhiam até ficar ilegíveis. No modo com rolagem cada aba tem a
/// largura do próprio rótulo, em tamanho normal.
void main() {
  const filtros = [
    AppSegment(label: 'Todas', count: 128),
    AppSegment(label: 'Acessos', count: 12),
    AppSegment(label: 'Encomendas', count: 3),
    AppSegment(label: 'Comunicados', count: 128),
    AppSegment(label: 'Outros'),
  ];

  Future<List<int>> montar(WidgetTester t, {required bool scrollable}) async {
    final tocados = <int>[];
    await t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 320,
          child: AppSegmentedControl(
            scrollable: scrollable,
            segments: filtros,
            selectedIndex: 0,
            onChanged: tocados.add,
          ),
        ),
      ),
    ));
    return tocados;
  }

  testWidgets('com rolagem, os rótulos ficam em tamanho normal', (t) async {
    await montar(t, scrollable: true);
    expect(t.takeException(), isNull);
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.byType(FittedBox), findsNothing);
    expect(find.text('COMUNICADOS (128)'), findsOneWidget);
  });

  testWidgets('com rolagem, a última aba é alcançável e tocável', (t) async {
    final tocados = await montar(t, scrollable: true);
    await t.drag(find.byType(SingleChildScrollView), const Offset(-600, 0));
    await t.pumpAndSettle();
    await t.tap(find.text('OUTROS'));
    expect(tocados, [4]);
  });

  testWidgets('sem rolagem, mantém as abas em partes iguais', (t) async {
    await montar(t, scrollable: false);
    expect(find.byType(SingleChildScrollView), findsNothing);
    expect(find.byType(Expanded), findsNWidgets(filtros.length));
  });
}
