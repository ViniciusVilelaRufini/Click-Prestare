import 'dart:convert';

import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/notificacoes/notificacoes_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final agora = DateTime.utc(2026, 11, 25, 12);
  final visita = DateTime.utc(2026, 11, 25, 10);

  group('notificacaoEhNova', () {
    test('depois da última visita é nova; antes, não', () {
      expect(notificacaoEhNova({'tipo': 'encomenda', 'timestamp': '2026-11-25T11:00:00Z'}, visita, agora: agora), isTrue);
      expect(notificacaoEhNova({'tipo': 'encomenda', 'timestamp': '2026-11-25T09:00:00Z'}, visita, agora: agora), isFalse);
    });

    /// F6: o item `financeiro` usa o vencimento (até 7 dias no futuro) como
    /// timestamp. Sempre "depois da última visita": o sino nunca zerava.
    test('timestamp no futuro (conta a vencer) não conta', () {
      final conta = {'tipo': 'financeiro', 'titulo': 'Conta a vencer', 'timestamp': '2026-11-28T00:00:00.000Z'};
      expect(notificacaoEhNova(conta, visita, agora: agora), isFalse);
      expect(notificacaoEhNova(conta, null, agora: agora), isFalse);
    });

    /// F18: "Você entrou no condomínio" acendia o sino por algo que o próprio
    /// morador fez.
    test('ação do próprio usuário (categoria voce) não conta', () {
      expect(
        notificacaoEhNova({'tipo': 'acesso', 'categoria': 'voce', 'timestamp': '2026-11-25T11:00:00Z'}, visita, agora: agora),
        isFalse,
      );
    });

    test('enquanto a API não manda a categoria: "Você entrou/saiu" do feed de acessos', () {
      final eu = {'tipo': 'acesso', 'descricao': 'Você entrou no condomínio.', 'timestamp': '2026-11-25T11:00:00Z'};
      final outro = {'tipo': 'acesso', 'descricao': 'Rafael entrou.', 'timestamp': '2026-11-25T11:00:00Z'};
      expect(notificacaoEhNova(eu, visita, agora: agora), isFalse);
      expect(notificacaoEhNova(outro, visita, agora: agora), isTrue);
    });

    test('sem visita registrada conta tudo que não é futuro nem do próprio usuário', () {
      final itens = [
        {'tipo': 'encomenda', 'timestamp': '2026-11-20T11:00:00Z'},
        {'tipo': 'financeiro', 'timestamp': '2026-11-30T00:00:00Z'},
        {'tipo': 'acesso', 'categoria': 'voce', 'timestamp': '2026-11-20T11:00:00Z'},
      ];
      expect(itens.where((n) => notificacaoEhNova(n, null, agora: agora)).length, 1);
    });
  });

  /// F7: no elevador, sem sinal, a central abria vazia e gravava "visto
  /// agora": os avisos reais nunca mais contavam como novos.
  group('central sem rede', () {
    setUp(() async {
      await ensureStorageReady();
      storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    });

    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    testWidgets('falha não marca como visto e mostra tentar de novo', (t) async {
      var chamadas = 0;
      var online = false;
      ApiClient.client = MockClient((req) async {
        chamadas++;
        if (!online) throw Exception('sem rede');
        return http.Response(
          jsonEncode([
            {'id': 'encomenda-1', 'tipo': 'encomenda', 'titulo': 'Encomenda chegou', 'descricao': 'Caixa', 'timestamp': '2026-11-09T22:00:00Z'},
          ]),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      expect(getUltimaVisitaNotificacoes(), isNull);

      await t.pumpWidget(const MaterialApp(home: NotificacoesPage()));
      await t.pumpAndSettle();

      expect(getUltimaVisitaNotificacoes(), isNull, reason: 'busca falhou: nada foi visto');
      expect(find.text('Nenhuma notificação por aqui'), findsNothing);
      expect(find.text('Tentar de novo'), findsOneWidget);

      online = true;
      await t.tap(find.text('Tentar de novo'));
      await t.pumpAndSettle();

      expect(chamadas, 2);
      expect(find.text('Encomenda chegou'), findsOneWidget);
      expect(getUltimaVisitaNotificacoes(), isNotNull, reason: 'busca deu certo: agora sim, visto');
    });
  });
}
