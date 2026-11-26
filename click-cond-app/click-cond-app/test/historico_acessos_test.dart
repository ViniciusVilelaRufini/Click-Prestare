import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('HistoricoAcessosPage renderiza scaffold com título e campo de busca', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HistoricoAcessosPage(),
      ),
    );

    // Renderiza a estrutura inicial
    expect(find.text('EVENTOS DE ACESSO'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('TODOS'), findsOneWidget);
    expect(find.text('VISITANTES'), findsOneWidget);
    expect(find.text('PRESTADORES'), findsOneWidget);
    expect(find.text('ENTRADAS'), findsOneWidget);
    expect(find.text('SAÍDAS'), findsOneWidget);

    // Deixa os microtasks e timers de rede concluírem
    await tester.pump(const Duration(milliseconds: 100));
  });

  testWidgets('HistoricoAcessosPage aceita filtro inicial personalizado', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HistoricoAcessosPage(filtroInicial: 'prestadores'),
      ),
    );

    expect(find.text('PRESTADORES'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 100));
  });
}
