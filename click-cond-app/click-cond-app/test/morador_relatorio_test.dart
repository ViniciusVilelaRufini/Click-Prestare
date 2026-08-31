import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/financeiro/morador_relatorio_page.dart';

void main() {
  testWidgets('MoradorRelatorioPage renderiza com filtros e métricas', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.resetPhysicalSize);

    final mockItems = [
      {
        'id': 1,
        'nome': 'Taxa Condominial',
        'categoria': 'Condomínio',
        'valor': 350.0,
        'pago': 1,
        'data_vencimento': '10/08/2026',
        'data_pagamento': '09/08/2026',
      },
      {
        'id': 2,
        'nome': 'Conta de Luz',
        'categoria': 'Luz',
        'valor': 185.50,
        'pago': 0,
        'data_vencimento': '31/08/2026',
      },
      {
        'id': 3,
        'nome': 'Internet Fibra',
        'categoria': 'Internet',
        'valor': 120.0,
        'pago': 1,
        'data_vencimento': '15/07/2026',
      },
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: MoradorRelatorioPage(
          initialMes: '08',
          initialAno: '2026',
          items: mockItems,
        ),
      ),
    );

    await tester.pumpAndSettle();

    // Verifica se os elementos principais da tela estão presentes
    expect(find.text('Exportar Relatório'), findsOneWidget);
    expect(find.text('Relatório Pessoal'), findsOneWidget);
    expect(find.text('1. Modelo de Relatório'), findsOneWidget);
    expect(find.text('2. Conta / Categoria'), findsOneWidget);
    expect(find.text('3. Período do Relatório'), findsOneWidget);
    expect(find.text('4. Status das Contas'), findsOneWidget);
    expect(find.text('Gerar e Baixar Relatório'), findsOneWidget);

    // No mês de Agosto/2026 temos 2 contas (Taxa Condominial e Conta de Luz)
    expect(find.text('Taxa Condominial'), findsOneWidget);
    expect(find.text('Conta de Luz'), findsOneWidget);
  });
}
