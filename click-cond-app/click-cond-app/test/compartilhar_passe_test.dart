import 'dart:convert';
import 'dart:io';

import 'package:click/pages/shared/prestador%20de%20servico/list_prestadores.dart';
import 'package:click/pages/shared/visitantes/compartilhar_passe.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// O QR do visitante deixa de ser o PIN desenhado (um print valia tanto quanto
/// o original, e a imagem saía de api.qrserver.com). O morador compartilha um
/// link do passe, cuja página mostra um QR que muda a cada 30 s.
const _url = 'https://www.prestarecondominios.com.br/?passe=1b.assinatura';

Map<String, dynamic> _visita({int id = 41, int prestador = 0, String nome = 'Maria Souza'}) => {
      'id': id,
      'nome': nome,
      'is_prestador': prestador,
      'apto_bloco': 'A',
      'apto': '106',
      'condominio_nome': 'Residencial Boa Vista',
      'morador_nome': 'Vinicius',
      // Já dentro: aparece na primeira aba das duas listas.
      'data_entrada': DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'data_saida': null,
      'codigo_acesso': '460551',
      'telefone': '(17) 99999-0000',
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<int> pedidos;
  late List<int> invalidados;
  late List<Uri> abertos;
  late Map<String, dynamic> respostaLink;

  setUp(() {
    pedidos = [];
    invalidados = [];
    abertos = [];
    respostaLink = {'url': _url, 'valido_ate': null};
    CompartilharPasse.pedirLink = (id) async {
      pedidos.add(id);
      return respostaLink;
    };
    CompartilharPasse.invalidarLink = (id) async {
      invalidados.add(id);
      return {'ok': true};
    };
    CompartilharPasse.abrirWhatsApp = (uri) async {
      abertos.add(uri);
      return true;
    };
  });

  group('mensagem', () {
    test('com o link da API: leva o link do passe e o PIN', () async {
      final texto = await CompartilharPasse.mensagem(_visita());

      expect(pedidos, [41]);
      expect(texto, contains(_url));
      expect(texto, contains('Abra o link ao chegar e mostre o QR no leitor:'));
      expect(texto, contains('460-551'));
      expect(texto, contains('Se preferir, informe o PIN na portaria.'));
      expect(texto, contains('*Tipo:* Visitante'));
      expect(texto, isNot(contains('qrserver')));
    });

    test('prestador usa a mesma rota e sai como prestador', () async {
      final texto = await CompartilharPasse.mensagem(_visita(id: 77, prestador: 1));
      expect(pedidos, [77]);
      expect(texto, contains('Prestador(a) de Serviço'));
      expect(texto, contains(_url));
    });

    test('erro da API (inclusive opção desligada) ainda compartilha o PIN, sem link', () async {
      respostaLink = {'erro': 'QR no app desligado neste condomínio'};
      final texto = await CompartilharPasse.mensagem(_visita());

      expect(texto, contains('460-551'));
      expect(texto, isNot(contains('http')));
      expect(texto, isNot(contains('QR')));
      expect(texto, endsWith('Informe este código ao chegar na portaria para liberação da sua entrada.'));
    });

    test('exceção ao pedir o link também cai no PIN', () async {
      CompartilharPasse.pedirLink = (id) async => throw const SocketException('sem rede');
      final texto = await CompartilharPasse.mensagem(_visita());
      expect(texto, contains('460-551'));
      expect(texto, isNot(contains('http')));
    });

    test('url que não é https é ignorada', () async {
      respostaLink = {'url': 'javascript:alert(1)'};
      final texto = await CompartilharPasse.mensagem(_visita());
      expect(texto, isNot(contains('javascript')));
    });
  });

  test('nenhuma referência a api.qrserver.com no app', () {
    final achados = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      if (f.readAsStringSync().contains('qrserver')) achados.add(f.path);
    }
    expect(achados, isEmpty);
  });

  group('nas listas', () {
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

    void servir(List<Map<String, dynamic>> lista) {
      ApiClient.client = MockClient((req) async {
        if (req.url.path.endsWith('/visitantes/get-all')) {
          return http.Response(jsonEncode(lista), 200, headers: {'content-type': 'application/json; charset=utf-8'});
        }
        return http.Response('[]', 200);
      });
    }

    Future<void> abrirDetalhe(WidgetTester tester, Widget tela, String nome, {double largura = 400}) async {
      tester.view.physicalSize = Size(largura * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: tela));
      await tester.pumpAndSettle();
      await tester.tap(find.text(nome).first);
      await tester.pumpAndSettle();
    }

    Future<void> rolarAte(WidgetTester tester, Finder f) async {
      await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).last);
      await tester.pumpAndSettle();
    }

    testWidgets('visitante: sem QR do PIN; "Compartilhar passe" envia o link pelo WhatsApp', (tester) async {
      servir([_visita()]);
      await abrirDetalhe(tester, const ListVisitantes(), 'Maria Souza');

      expect(find.byType(QrImageView), findsNothing);
      expect(find.text('460-551'), findsWidgets);
      final botao = find.text('COMPARTILHAR PASSE');
      await rolarAte(tester, botao);
      await tester.tap(botao);
      await tester.pumpAndSettle();

      expect(pedidos, [41]);
      expect(abertos, hasLength(1));
      expect(abertos.single.host, 'wa.me');
      expect(abertos.single.path, '/5517999990000');
      final texto = abertos.single.queryParameters['text']!;
      expect(texto, contains(_url));
      expect(texto, contains('460-551'));
    });

    testWidgets('visitante: "Cancelar link" confirma e invalida', (tester) async {
      servir([_visita()]);
      await abrirDetalhe(tester, const ListVisitantes(), 'Maria Souza');

      final cancelar = find.text('CANCELAR LINK');
      await rolarAte(tester, cancelar);
      await tester.tap(cancelar);
      await tester.pumpAndSettle();
      expect(find.text('O link enviado deixa de funcionar. Continuar?'), findsOneWidget);
      expect(invalidados, isEmpty);

      await tester.tap(find.text('CANCELAR LINK').last);
      await tester.pumpAndSettle();
      expect(invalidados, [41]);
    });

    testWidgets('prestador: sem QR do PIN; "Compartilhar passe" pede o link da mesma visita', (tester) async {
      servir([_visita(id: 77, prestador: 1, nome: 'José Eletricista')]);
      // Largura maior: o cabeçalho do detalhe do prestador (selos e título, que
      // não são desta mudança) estoura a 400dp com a fonte de teste.
      await abrirDetalhe(tester, const ListPrestadores(), 'José Eletricista', largura: 700);

      expect(find.byType(QrImageView), findsNothing);
      final botao = find.text('COMPARTILHAR PASSE');
      await rolarAte(tester, botao);
      await tester.tap(botao);
      await tester.pumpAndSettle();

      expect(pedidos, [77]);
      expect(abertos.single.queryParameters['text'], contains(_url));
    });

    testWidgets('erro da API ainda compartilha o PIN', (tester) async {
      respostaLink = {'erro': 'Falha'};
      servir([_visita()]);
      await abrirDetalhe(tester, const ListVisitantes(), 'Maria Souza');

      final botao = find.text('COMPARTILHAR PASSE');
      await rolarAte(tester, botao);
      await tester.tap(botao);
      await tester.pumpAndSettle();

      final texto = abertos.single.queryParameters['text']!;
      expect(texto, contains('460-551'));
      expect(texto, isNot(contains('http')));
    });
  });
}
