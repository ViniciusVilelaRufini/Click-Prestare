import 'package:click/pages/shared/delivery/list_delivery.dart';
import 'package:click/router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a rota delivery abre a lista de avisos', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    final context = tester.element(find.byType(SizedBox));

    final route = RouterGenerator.generateRouter(const RouteSettings(name: '/delivery')) as MaterialPageRoute;

    expect(route.builder(context), isA<ListDelivery>());
  });
}
