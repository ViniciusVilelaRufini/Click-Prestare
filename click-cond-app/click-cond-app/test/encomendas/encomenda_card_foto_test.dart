import 'dart:convert';

import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> _enc(String? foto) => {
      'id': 1,
      'descricao': 'Caixa da Amazon',
      'destinatario_bloco': 'A',
      'destinatario_apto': '106',
      'recebido_de': 'Amazon',
      'recebido_em': DateTime.now()
          .subtract(const Duration(days: 2))
          .toIso8601String(),
      'status': 'aguardando',
      'foto_volume': foto,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Singleton.instance.id_condominio = 11;
    storageMorador({
      'token': 't',
      'user': {'id': 1, 'nome': 'Ana'},
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, String? foto) async {
    ApiClient.client = MockClient(
        (_) async => http.Response(jsonEncode([_enc(foto)]), 200));
    await tester.pumpWidget(const MaterialApp(home: ListEncomendas()));
    await tester.pumpAndSettle();
  }

  testWidgets('com foto: imagem em degradê à esquerda do cartão',
      (tester) async {
    await abrir(tester, 'https://cdn/x.jpg');

    final mask = find.byType(ShaderMask);
    expect(mask, findsOneWidget);
    expect(find.descendant(of: mask, matching: find.byType(Image)),
        findsOneWidget);
    expect(tester.getSize(mask).width, 104);
    expect(tester.getTopLeft(find.text('Caixa da Amazon')).dx -
            tester.getTopLeft(mask).dx,
        92);
  });

  testWidgets('sem foto: cartão sem degradê', (tester) async {
    await abrir(tester, null);

    expect(find.text('Caixa da Amazon'), findsOneWidget);
    expect(find.byType(ShaderMask), findsNothing);
  });
}
