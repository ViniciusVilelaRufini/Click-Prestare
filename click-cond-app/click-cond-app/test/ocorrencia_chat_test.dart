import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/ocorrencias/ocorrencia_chat.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Chat da ocorrência: falha ao enviar aparecia como nada (o texto ficava no
/// campo sem aviso), uma busca que falhava apagava a conversa da tela, e uma
/// resposta que chegava depois de sair do chat religava o poll sem ninguém
/// para cancelar.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const json = {'content-type': 'application/json; charset=utf-8'};
  final msg = {
    'id': 1,
    'id_user': 99,
    'mensagem': 'Barulho depois das 22h',
    'created_at': '2026-11-25T10:00:00.000Z',
  };

  late int buscas;
  late List<String> enviadas;

  setUp(() async {
    await ensureStorageReady();
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    Singleton.instance.id_condominio = 22;
    buscas = 0;
    enviadas = [];
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: OcorrenciaChatPage(idOcorrencia: 5, titulo: 'Barulho')));
    await tester.pump();
    await tester.pump();
  }

  Future<void> fechar(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
  }

  testWidgets('envio recusado mostra a mensagem da API e mantém o texto no campo', (tester) async {
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/ocorrencias/mensagens/enviar')) {
        enviadas.add(req.body);
        return http.Response(jsonEncode({'statusCode': 403, 'message': 'Você não pode responder esta ocorrência.'}),
            403,
            headers: json);
      }
      buscas++;
      return http.Response(jsonEncode([msg]), 200, headers: json);
    });
    await abrir(tester);

    await tester.enterText(find.byType(TextField), 'Resolvido?');
    await tester.tap(find.byIcon(PhosphorIcons.paperPlaneRight));
    await tester.pump();
    await tester.pump();

    expect(enviadas, hasLength(1));
    expect(find.text('Você não pode responder esta ocorrência.'), findsOneWidget);
    expect(find.text('Resolvido?'), findsOneWidget, reason: 'o texto fica para tentar de novo');
    await fechar(tester);
  });

  testWidgets('busca do poll que falha mantém a conversa na tela', (tester) async {
    var falhar = false;
    ApiClient.client = MockClient((req) async {
      buscas++;
      if (falhar) return http.Response('erro', 503);
      return http.Response(jsonEncode([msg]), 200, headers: json);
    });
    await abrir(tester);
    expect(find.text('Barulho depois das 22h'), findsOneWidget);

    falhar = true;
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
    expect(buscas, greaterThanOrEqualTo(2));
    expect(find.text('Barulho depois das 22h'), findsOneWidget);
    expect(find.text('Nenhuma mensagem ainda'), findsNothing);
    await fechar(tester);
  });

  testWidgets('primeira carga que falha mostra o erro com tentar de novo', (tester) async {
    var falhar = true;
    ApiClient.client = MockClient((req) async {
      buscas++;
      if (falhar) throw http.ClientException('sem rede');
      return http.Response(jsonEncode([msg]), 200, headers: json);
    });
    await abrir(tester);
    expect(find.text('Não foi possível carregar as mensagens.'), findsOneWidget);
    expect(find.text('Nenhuma mensagem ainda'), findsNothing);

    falhar = false;
    await tester.tap(find.text('TENTAR DE NOVO'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Barulho depois das 22h'), findsOneWidget);
    await fechar(tester);
  });

  testWidgets('resposta que chega depois de sair do chat não religa o poll', (tester) async {
    final pendente = Completer<http.Response>();
    ApiClient.client = MockClient((req) async {
      buscas++;
      if (buscas == 1) return http.Response('erro', 503); // backoff para 10 s
      return pendente.future; // segunda busca fica em voo
    });
    await abrir(tester);
    expect(buscas, 1);

    await tester.pump(const Duration(seconds: 10));
    expect(buscas, 2);

    // Sai do chat com a busca em voo; ela falha depois do dispose.
    await fechar(tester);
    pendente.complete(http.Response('erro', 503));
    await tester.pump();

    await tester.pump(const Duration(minutes: 5));
    expect(buscas, 2, reason: 'nenhum timer novo depois do dispose');
  });
}
