import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Dentro de uma conta (ex.: Luz), o cartão "Total pendente" ainda era o bloco
/// preto da paleta antiga; agora segue o cartão amarelo do resumo do
/// Financeiro (cartaoDestaque).
void main() {
  testWidgets('total da categoria no cartão amarelo de destaque', (t) async {
    await t.pumpWidget(MaterialApp(
      home: MoradorFinanceiroCategoryDetailPage(
        title: 'Luz',
        icon: PhosphorIcons.lightning,
        getItems: () => const [],
        personalCategories: const [],
        mes: '11',
        ano: '2026',
        onRefresh: () {},
        showContaFormModal: ({item, initialCategory, customContext, onSuccess}) {},
        buildFinanceiroCard: (item, {onChanged}) => const SizedBox(),
      ),
    ));
    await t.pumpAndSettle();

    final rotulo = find.text('TOTAL PENDENTE · LUZ');
    expect(rotulo, findsOneWidget);
    final ctx = t.element(rotulo);
    final cartao = find.ancestor(
      of: rotulo,
      matching: find.byWidgetPredicate((w) => w is Container && w.decoration == cartaoDestaque(ctx)),
    );
    expect(cartao, findsOneWidget);
    final blocoPreto = find.byWidgetPredicate((w) =>
        w is Container && w.decoration is BoxDecoration && (w.decoration as BoxDecoration).color == AppColors.primary);
    expect(blocoPreto, findsNothing);
  });
}
