import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

void main() {
  testWidgets('MoradorFinanceiroCategoryDetailPage renderiza sem erros', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MoradorFinanceiroCategoryDetailPage(
          title: 'Condomínio',
          icon: PhosphorIcons.buildings,
          getItems: () => [
            {
              'id': 1,
              'nome': 'Boleto Condomínio',
              'tipo': 'C',
              'categoria': 'Condomínio',
              'data_vencimento': '10/08/2026',
              'valor': 892.60,
              'pago': 0,
            }
          ],
          personalCategories: const ['Aluguel', 'Água', 'Luz', 'Internet', 'Outros'],
          mes: '08',
          ano: '2026',
          onRefresh: () {},
          showContaFormModal: ({item, initialCategory, customContext, onSuccess}) {},
          buildFinanceiroCard: (item, {onChanged}) => Text(item['nome'].toString()),
        ),
      ),
    );

    expect(find.text('Condomínio'), findsOneWidget);
    expect(find.text('Total Pendente (Condomínio)'), findsOneWidget);
    expect(find.text('Contas e Cobranças'), findsOneWidget);
    expect(find.text('Boleto Condomínio'), findsOneWidget);
  });
}
