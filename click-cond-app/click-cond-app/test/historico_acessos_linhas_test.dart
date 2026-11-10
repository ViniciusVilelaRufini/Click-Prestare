import 'dart:convert';

import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/evento_linha.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// "Eventos de Acesso" no mesmo desenho dos eventos do início (e da portaria
/// web): foto ou inicial em degradê, selo de entrada/saída, data completa e
/// a linha com o método e o condomínio.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    ApiClient.client = MockClient((request) async {
      const json = {'content-type': 'application/json; charset=utf-8'};
      if (request.url.path.contains('meus-eventos')) {
        return http.Response(
          jsonEncode([
            {
              'id': 11, 'nome': 'Rafael Costa', 'evento': 'entrada', 'tipo_pessoa': 'visitante',
              'categoria': 'visitante', 'tipo_dispositivo': 'pin', 'condominio': 'Boa vista',
              'timestamp': '2026-11-09T22:45:00Z', 'foto': null,
            },
            {
              'id': 12, 'nome': 'Vinicius Rufini', 'evento': 'saida', 'tipo_pessoa': 'visitante',
              'categoria': 'visitante', 'tipo_dispositivo': 'facial', 'condominio': 'Boa vista',
              'timestamp': '2026-11-09T21:58:00Z', 'foto': 'https://cdn.exemplo/v.jpg',
            },
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

  testWidgets('cada evento usa a linha com foto em degradê', (t) async {
    await t.pumpWidget(const MaterialApp(home: HistoricoAcessosPage()));
    await t.pumpAndSettle();
    expect(find.byType(EventoLinha), findsNWidgets(2));
    expect(find.text('PIN / Manual · Boa vista'), findsOneWidget);
    expect(find.text('Facial · Boa vista'), findsOneWidget);
    final comFoto = t.widget<EventoLinha>(find.byType(EventoLinha).last);
    expect(comFoto.foto, 'https://cdn.exemplo/v.jpg');
  });
}
