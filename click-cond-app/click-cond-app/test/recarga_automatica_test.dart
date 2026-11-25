import 'dart:convert';

import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/delivery/list_delivery.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias_todos.dart';
import 'package:click/pages/sindico/list_condominiums.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/cond_cache.dart';
import 'package:click/services/atualizacoes_app.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Recarga automática (push em primeiro plano ou volta ao app) que falha não
/// pode trocar a lista da tela por um falso "nada por aqui", nem desfazer o
/// status que o síndico escolheu e ainda não salvou.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    ApiClient.tokenProvider = () => 'sessao';
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  const json = {'content-type': 'application/json; charset=utf-8'};

  group('apiGetAllOuNull', () {
    test('status diferente de 200 → null (apiGetAll segue devolvendo [])', () async {
      ApiClient.client = MockClient((_) async => http.Response('erro', 500));
      expect(await apiGetAllOuNull('ocorrencias/todos'), isNull);
      expect(await apiGetAll('ocorrencias/todos'), isEmpty);
    });

    test('sem rede → null (apiGetAll segue devolvendo [])', () async {
      ApiClient.client = MockClient((_) async => throw http.ClientException('sem rede'));
      expect(await apiGetAllOuNull('ocorrencias/todos'), isNull);
      expect(await apiGetAll('ocorrencias/todos'), isEmpty);
    });

    test('200 devolve a lista; corpo vazio vira []', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode([{'id': 1}]), 200, headers: json));
      expect(await apiGetAllOuNull('ocorrencias/todos'), [{'id': 1}]);
      ApiClient.client = MockClient((_) async => http.Response('""', 200, headers: json));
      expect(await apiGetAllOuNull('ocorrencias/todos'), isEmpty);
    });
  });

  group('apiGetAllEncomendasOuNull', () {
    test('500 e sem rede → null; apiGetAllEncomendas segue devolvendo []', () async {
      ApiClient.client = MockClient((_) async => http.Response('erro', 500));
      expect(await apiGetAllEncomendasOuNull(), isNull);
      expect(await apiGetAllEncomendas(), isEmpty);
      ApiClient.client = MockClient((_) async => throw http.ClientException('sem rede'));
      expect(await apiGetAllEncomendasOuNull(), isNull);
      expect(await apiGetAllEncomendas(), isEmpty);
    });

    test('200 devolve a lista', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode([{'id': 3}]), 200, headers: json));
      expect(await apiGetAllEncomendasOuNull(), [{'id': 3}]);
    });
  });

  group('statusDoSeletorAposCarga', () {
    test('primeira carga: vale o do servidor', () {
      expect(statusDoSeletorAposCarga(escolhido: '', anteriorDoServidor: null, novoDoServidor: 'Pendente'),
          'Pendente');
    });
    test('seletor intocado: acompanha o servidor', () {
      expect(
          statusDoSeletorAposCarga(escolhido: 'Pendente', anteriorDoServidor: 'Pendente', novoDoServidor: 'ciente'),
          'ciente');
    });
    test('síndico escolheu e não salvou: a escolha fica', () {
      expect(
          statusDoSeletorAposCarga(escolhido: 'ciente', anteriorDoServidor: 'Pendente', novoDoServidor: 'Pendente'),
          'ciente');
      expect(
          statusDoSeletorAposCarga(
              escolhido: 'solucionado', anteriorDoServidor: 'Pendente', novoDoServidor: 'ciente'),
          'solucionado');
    });
  });

  testWidgets('ocorrências: recarga que falha mantém a lista na tela', (tester) async {
    storageMorador({'token': 'sessao', 'user': {'id': 100, 'nome': 'Ana'}});
    var falhar = false;
    ApiClient.client = MockClient((req) async {
      if (falhar) return http.Response('erro', 503);
      return http.Response(
          jsonEncode([
            {'id': 1, 'tipo': 'Barulho no 302', 'status': 'Pendente', 'created_at': '2026-11-14T10:00:00.000Z'}
          ]),
          200,
          headers: json);
    });

    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ListOcorrenciasTodos())));
    await tester.pumpAndSettle();
    expect(find.text('BARULHO NO 302'), findsOneWidget);

    falhar = true;
    AtualizacoesApp.avisar(DominioApp.tudo);
    await tester.pumpAndSettle();
    expect(find.text('BARULHO NO 302'), findsOneWidget);
  });

  testWidgets('delivery: recarga que falha mantém a lista em vez da tela de erro', (tester) async {
    var falhar = false;
    ApiClient.client = MockClient((req) async {
      if (falhar) throw http.ClientException('sem rede');
      return http.Response(
          jsonEncode([
            {'id': 1, 'status': 'AGENDADA', 'estabelecimento': 'Farmácia', 'modo_entrega': 'UNIDADE'}
          ]),
          200,
          headers: json);
    });

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();
    expect(find.text('Farmácia'), findsOneWidget);

    falhar = true;
    AtualizacoesApp.avisar(DominioApp.delivery);
    await tester.pumpAndSettle();
    expect(find.text('Farmácia'), findsOneWidget);
  });

  testWidgets('ocorrência: status escolhido e não salvo sobrevive à recarga', (tester) async {
    storageLogin({'token': 'sessao', 'user': {'id': 1, 'name': 'Síndico'}});
    final enviados = <Map<String, dynamic>>[];
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/ocorrencias/get')) {
        return http.Response(
            jsonEncode({
              'id': 9,
              'descricao': 'Barulho no 302',
              'tipo': 'Barulho',
              'status': 'Pendente',
              'resposta': '',
              'criado_por': 'Ana',
              'created_at': '2026-11-14T10:00:00.000Z',
              'anexos': '',
              'publica': false,
              'user': 100,
            }),
            200,
            headers: json);
      }
      if (req.url.path.endsWith('/ocorrencias/update')) {
        enviados.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response('{}', 200, headers: json);
      }
      return http.Response('[]', 200, headers: json);
    });
    tester.view.physicalSize = const Size(1800, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(home: DetailOcorrencia(id: 9)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ciente'));
    await tester.pump();

    // Chega push da ocorrência; o servidor ainda diz "Pendente".
    AtualizacoesApp.avisar(DominioApp.ocorrencia);
    await tester.pumpAndSettle();

    await tester.tap(find.text('SALVAR'));
    await tester.pumpAndSettle();

    expect(enviados, hasLength(1));
    expect((enviados.single['ocorrencia'] as Map)['status'], 'ciente');
  });

  group('início (ListCondomiums)', () {
    // getCondominios* devolvem [] num 5xx: a recarga automática não pode
    // esvaziar o início; a carga inicial segue mostrando o que veio.
    Future<void> montar(WidgetTester tester, bool Function() falhar) async {
      storageMorador({'token': 'sessao', 'user': {'id': 100, 'nome': 'Ana'}});
      ApiClient.client = MockClient((req) async {
        if (req.url.path.endsWith('/moradores/list-condominios')) {
          if (falhar()) return http.Response('erro', 503);
          return http.Response(jsonEncode([{'id': 5, 'nome': 'Residencial Aurora', 'saldo': '1'}]), 200,
              headers: json);
        }
        if (req.url.path.contains('dashboard/summary') || req.url.path.contains('moradores/get')) {
          return http.Response('{}', 200, headers: json);
        }
        return http.Response('[]', 200, headers: json);
      });
      tester.view.physicalSize = const Size(1200, 2600);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      addTearDown(CondCache.clear);
      await tester.pumpWidget(const MaterialApp(home: ListCondomiums()));
      await tester.pumpAndSettle();
    }

    testWidgets('recarga automática com 5xx mantém o condomínio na tela', (tester) async {
      var falhar = false;
      await montar(tester, () => falhar);
      expect(find.textContaining('Residencial Aurora'), findsWidgets);

      falhar = true;
      AtualizacoesApp.avisar(DominioApp.tudo);
      await tester.pumpAndSettle();
      expect(find.textContaining('Residencial Aurora'), findsWidgets);
    });

    testWidgets('carga inicial vazia segue vazia (sem condomínio na tela)', (tester) async {
      await montar(tester, () => true);
      expect(find.textContaining('Residencial Aurora'), findsNothing);
    });
  });
}
