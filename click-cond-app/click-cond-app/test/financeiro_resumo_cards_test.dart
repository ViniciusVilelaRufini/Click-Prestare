import 'package:click/pages/shared/financeiro/financeiro_resumo_cards.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('destaca saldo e separa receitas de despesas', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: FinanceiroResumoCards(
            receita: 'BRL 4.200,00',
            despesa: '-BRL 1.500,00',
            saldo: 'BRL 2.700,00',
            percentualReceita: '56%',
            percentualDespesa: '20%',
          ),
        ),
      ),
    );

    expect(find.text('Saldo do período'), findsOneWidget);
    expect(find.text('BRL 2.700,00'), findsOneWidget);
    expect(find.text('Receitas'), findsOneWidget);
    expect(find.text('Despesas'), findsOneWidget);
    expect(find.text('BRL 4.200,00'), findsOneWidget);
    expect(find.text('-BRL 1.500,00'), findsOneWidget);
  });
}
