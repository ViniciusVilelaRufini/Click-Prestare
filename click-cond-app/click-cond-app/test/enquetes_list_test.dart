import 'dart:convert';

import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/shared/enquetes/list_enquetes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/votacao/votacao_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

String _data(DateTime d) => DateFormat('dd/MM/yyyy').format(d);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final agora = DateTime.now();
  final mesAtual = DateTime(agora.year, agora.month, 10);
  final mesAnterior = DateTime(agora.year, agora.month - 1, 10);

  List<Map<String, dynamic>> enquetes() => [
        {
          'id': 1,
          'titulo': 'Pintura da fachada',
          'descricao': 'Escolha a cor',
          'data_inicio': _data(mesAtual),
          'data_termino': _data(mesAtual.add(const Duration(days: 40))),
          'status': 1,
          'opcoes': ['10;Azul;3', '11;Branco;2'],
        },
        {
          'id': 2,
          'titulo': 'Horário da piscina',
          'descricao': null,
          'data_inicio': _data(mesAtual),
          'data_termino': _data(mesAtual),
          'status': 2,
          'opcoes': ['20;Manhã;1'],
        },
        {
          'id': 3,
          'titulo': 'Enquete do mês passado',
          'descricao': '',
          'data_inicio': _data(mesAnterior),
          'data_termino': _data(mesAnterior),
          'status': 2,
          'opcoes': <String>[],
        },
      ];

  late int chamadasLista;

  void servir(List<Map<String, dynamic>> lista) {
    chamadasLista = 0;
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get-all')) {
        chamadasLista++;
        return http.Response(jsonEncode(lista), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('', 404);
    });
  }

  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
  });

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, {double largura = 360, ThemeData? tema}) async {
    tester.view.physicalSize = Size(largura * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: tema, home: const ListEnquetes()));
    await tester.pumpAndSettle();
  }

  String rotuloMes(DateTime d) {
    final m = DateFormat('MMM', 'pt_BR').format(d).replaceAll('.', '');
    return '${m[0].toUpperCase()}${m.substring(1)}';
  }

  testWidgets('título é "Enquetes" e mostra os cards do mês atual', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    servir(enquetes());
    await abrir(tester);

    expect(find.text('Enquetes'), findsOneWidget);
    expect(find.text('Votações'), findsNothing);
    expect(chamadasLista, 1);

    final cards = tester.widgetList<VotacaoCard>(find.byType(VotacaoCard)).toList();
    expect(cards.map((c) => c.titulo), ['Pintura da fachada', 'Horário da piscina']);
    expect(cards[0].totalVotos, 5);
    expect(cards[0].subtitulo, 'Escolha a cor');
    expect(cards[1].subtitulo, isNull);
    expect(find.text('Enquete do mês passado'), findsNothing);
    // Morador não cria enquete.
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('chip do mês anterior filtra a lista', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    servir(enquetes());
    await abrir(tester);

    final chip = find.text(rotuloMes(mesAnterior));
    await tester.ensureVisible(chip);
    await tester.pumpAndSettle();
    await tester.tap(chip);
    await tester.pumpAndSettle();

    final titulos = tester.widgetList<VotacaoCard>(find.byType(VotacaoCard)).map((c) => c.titulo).toList();
    expect(titulos, ['Enquete do mês passado']);
  });

  testWidgets('mês sem enquetes mostra o estado vazio', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    servir([enquetes()[2]]);
    await abrir(tester);

    expect(find.byType(VotacaoCard), findsNothing);
    expect(find.text('Nenhum registro encontrado!'), findsOneWidget);
  });

  testWidgets('tocar no card abre o detalhe e recarrega a lista ao voltar', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    servir(enquetes());
    await abrir(tester);

    await tester.tap(find.text('Pintura da fachada'));
    await tester.pumpAndSettle();
    expect(find.byType(DetailEnquete), findsOneWidget);
    expect(tester.widget<DetailEnquete>(find.byType(DetailEnquete)).id, 1);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    expect(chamadasLista, 2);
  });

  testWidgets('síndico vê o botão de criar enquete', (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    servir(enquetes());
    await abrir(tester);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('320dp em tema escuro: sem overflow', (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    final lista = enquetes();
    lista[0]['titulo'] = 'Pintura da fachada principal e das garagens do bloco B com nova cor';
    servir(lista);
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    expect(tester.takeException(), isNull);
    expect(find.byType(VotacaoCard), findsNWidgets(2));
  });
}
