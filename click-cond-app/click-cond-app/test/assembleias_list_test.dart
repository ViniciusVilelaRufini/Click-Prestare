import 'dart:convert';

import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/intl.dart';

String _data(DateTime d) => DateFormat('dd/MM/yyyy').format(d);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final hoje = DateTime.now();
  final daqui3 = DateTime(hoje.year, hoje.month, hoje.day + 3);

  // Formato real de getAll (assembleias.service.ts): sem local e sem votações.
  List<Map<String, dynamic>> assembleias() => [
        {
          'id': 1,
          'titulo': 'Assembleia Geral Ordinária',
          'descricao': 'Aprovação de contas',
          'data': _data(daqui3),
          'hora': '19:30',
        },
        {
          'id': 2,
          'titulo': 'Assembleia Extraordinária',
          'descricao': '',
          'data': _data(hoje),
          'hora': '',
        },
      ];

  late int chamadasLista;

  void servir(List<Map<String, dynamic>> lista) {
    chamadasLista = 0;
    ApiClient.client = MockClient((request) async {
      const json = {'content-type': 'application/json; charset=utf-8'};
      final path = request.url.path;
      if (path.endsWith('/assembleias/get-all')) {
        chamadasLista++;
        return http.Response(jsonEncode(lista), 200, headers: json);
      }
      if (path.endsWith('/assembleias/get')) {
        return http.Response(
            jsonEncode({
              'assembleia': {
                'id': int.parse(request.url.queryParameters['id']!),
                'titulo': 'Assembleia Geral Ordinária',
                'descricao': '',
                'data': _data(daqui3),
                'hora': '19:30',
                'link': '',
                'local': 'Salão de festas',
                'anexos': '',
              },
              'votacoes': [],
              'meusVotos': [],
            }),
            200,
            headers: json);
      }
      return http.Response('', 404);
    });
  }

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
    await tester.pumpWidget(MaterialApp(theme: tema, home: const ListAssembleias()));
    await tester.pumpAndSettle();
  }

  void entrarComoMorador() => storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
  void entrarComoSindico() => storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});

  testWidgets('título "Assembleias" e cards com o que a lista traz (data/hora, descrição, proximidade)',
      (tester) async {
    entrarComoMorador();
    servir(assembleias());
    await abrir(tester);

    expect(find.text('Assembleias'), findsOneWidget);
    expect(chamadasLista, 1);
    expect(find.byType(AssembleiaCard), findsNWidgets(2));
    expect(find.text('Assembleia Geral Ordinária'), findsOneWidget);
    expect(find.text('Aprovação de contas'), findsOneWidget);
    expect(find.text('${_data(daqui3)} às 19:30'), findsOneWidget);
    expect(find.text('Em 3 dias'), findsOneWidget);
    // Sem hora: só a data; hoje ganha o selo "Hoje".
    expect(find.text(_data(hoje)), findsOneWidget);
    expect(find.text('Hoje'), findsOneWidget);
    // Bloco de data com o dia.
    expect(find.text('${daqui3.day}'), findsOneWidget);
    // Morador não cria assembleia.
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('lista vazia mostra o estado vazio', (tester) async {
    entrarComoMorador();
    servir([]);
    await abrir(tester);
    expect(find.byType(AssembleiaCard), findsNothing);
    expect(find.text('Nenhum registro encontrado!'), findsOneWidget);
    expect(find.text('Nenhuma assembleia marcada no momento.'), findsOneWidget);
  });

  testWidgets('tocar no card abre o detalhe e recarrega a lista ao voltar', (tester) async {
    entrarComoMorador();
    servir(assembleias());
    await abrir(tester);

    await tester.tap(find.text('Assembleia Geral Ordinária'));
    await tester.pumpAndSettle();
    expect(find.byType(DetailAssembleia), findsOneWidget);
    expect(tester.widget<DetailAssembleia>(find.byType(DetailAssembleia)).id, 1);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    expect(chamadasLista, 2);
  });

  testWidgets('leitor de tela: o card é um botão com o resumo completo', (tester) async {
    final handle = tester.ensureSemantics();
    entrarComoMorador();
    servir(assembleias());
    await abrir(tester);
    expect(
      find.bySemanticsLabel('Assembleia Geral Ordinária, Aprovação de contas, ${_data(daqui3)} às 19:30, Em 3 dias'),
      findsOneWidget,
    );
    handle.dispose();
  });

  testWidgets('síndico vê o botão de criar; 320dp em tema escuro sem overflow', (tester) async {
    entrarComoSindico();
    final lista = assembleias();
    lista[0]['titulo'] = 'Assembleia Geral Extraordinária para aprovação da reforma completa da fachada';
    lista[0]['descricao'] = 'Pauta extensa com vários itens de obra, orçamento e rateio entre as unidades';
    servir(lista);
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    expect(tester.takeException(), isNull);
    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(find.byType(AssembleiaCard), findsNWidgets(2));
  });
}
