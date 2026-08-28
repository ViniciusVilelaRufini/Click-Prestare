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
    expect(find.text('Eventos de Acesso'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Todos'), findsOneWidget);
    expect(find.text('Visitantes'), findsOneWidget);
    expect(find.text('Prestadores'), findsOneWidget);
    expect(find.text('Entradas'), findsOneWidget);
    expect(find.text('Saídas'), findsOneWidget);

    // Deixa os microtasks e timers de rede concluírem
    await tester.pump(const Duration(milliseconds: 100));
  });

  testWidgets('HistoricoAcessosPage aceita filtro inicial personalizado', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: HistoricoAcessosPage(filtroInicial: 'prestadores'),
      ),
    );

    expect(find.text('Prestadores'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 100));
  });
}
