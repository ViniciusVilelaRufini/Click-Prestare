import 'dart:convert';

import 'package:click/pages/shared/notificacoes/notificacoes_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/linha_faixa.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Notificações no desenho dos eventos: faixa em degradê na cor do tipo,
/// selo "● TIPO" e "NOVA" discreto, sem a barra lateral grossa.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    ApiClient.client = MockClient((request) async {
      const json = {'content-type': 'application/json; charset=utf-8'};
      if (request.url.path.contains('notificacoes')) {
        return http.Response(
          jsonEncode([
            {'id': 'e1', 'tipo': 'encomenda', 'titulo': 'Encomenda chegou', 'descricao': 'Caixa grande', 'timestamp': '2026-11-09T22:00:00Z'},
            {'id': 'a1', 'tipo': 'acesso', 'titulo': 'Saída registrada', 'descricao': 'Rafael saiu.', 'timestamp': '2026-11-09T21:00:00Z'},
          ]),
          200,
          headers: json,
        );
      }
      return http.Response('[]', 200, headers: json);
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets('avisos na linha em degradê com selo do tipo', (t) async {
    await t.pumpWidget(const MaterialApp(home: NotificacoesPage()));
    await t.pumpAndSettle();
    expect(find.byType(LinhaFaixa), findsNWidgets(2));
    expect(find.text('ENCOMENDA'), findsOneWidget);
    expect(find.text('SAÍDA'), findsOneWidget);
    // Encomenda no amarelo da marca (como texto, a versão legível dele).
    final selo = t.widget<Text>(find.text('ENCOMENDA'));
    expect(selo.style?.color, AppColors.brandInkOf(t.element(find.text('ENCOMENDA'))));
    // Sem a barra lateral grossa de 4px.
    expect(
      find.byWidgetPredicate((w) => w is Container && w.constraints?.maxWidth == 4),
      findsNothing,
    );
  });
}
