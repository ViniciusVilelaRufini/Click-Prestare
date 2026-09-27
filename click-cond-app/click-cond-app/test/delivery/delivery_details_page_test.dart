import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_details_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('apresenta o status e não mostra campos internos do entregador', (tester) async {
    final aviso = DeliveryModel.fromJson({
      'id': 7,
      'status': 'AUTORIZADA',
      'estabelecimento': 'Mercado',
      'modo_entrega': 'UNIDADE',
      'entregador': {
        'nome': 'João',
        'documento': '123.456.789-00',
        'status': 'BLOQUEADO',
        'motivo_bloqueio': 'Registro interno',
      },
      'eventos': [
        {'status_novo': 'AGENDADA', 'created_at': '2026-09-27T18:00:00.000Z'},
        {'status_novo': 'AUTORIZADA', 'created_at': '2026-09-27T18:10:00.000Z'},
      ],
    });

    await tester.pumpWidget(MaterialApp(home: DeliveryDetailsPage(delivery: aviso)));

    expect(find.text('Entrega autorizada'), findsWidgets);
    expect(find.text('123.456.789-00'), findsNothing);
    expect(find.text('Registro interno'), findsNothing);
    expect(find.text('Cancelar aviso'), findsNothing);
  });
}
