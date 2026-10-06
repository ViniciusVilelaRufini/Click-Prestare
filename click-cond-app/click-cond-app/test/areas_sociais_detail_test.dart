import 'dart:convert';

import 'package:click/pages/shared/areas%20sociais/area_social_detail.dart';
import 'package:click/pages/shared/areas%20sociais/new_reserva.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/minha_reserva_card.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _agendamentos = [
  {'id': 1, 'bloco': 'A', 'apto': '101', 'data': '12/10/2026', 'horaDe': '10:00', 'horaAte': '16:00', 'status': 'pendente', 'convidados': 3},
  {'id': 2, 'bloco': 'A', 'apto': '101', 'data': '13/10/2026', 'horaDe': '08:00', 'horaAte': '12:00', 'status': 'recusado'},
  {'id': 3, 'bloco': 'A', 'apto': '101', 'data': '14/10/2026', 'horaDe': '08:00', 'horaAte': '12:00', 'status': 'cancelado'},
  {'id': 4, 'bloco': 'B', 'apto': '202', 'data': '15/10/2026', 'horaDe': '18:00', 'horaAte': '22:00', 'status': 'aprovado'},
  {'id': 5, 'bloco': 'B', 'apto': '203', 'data': '16/10/2026', 'horaDe': '18:00', 'horaAte': '22:00', 'status': 'recusado'},
];

Map<String, dynamic> area({
  int precisaAgendar = 1,
  String? regras = 'Proibido som alto após 22h.',
  List<Map<String, dynamic>> agendamentos = _agendamentos,
  dynamic capacidade = 10,
  bool monitoramento = false,
  String nome = 'Churrasqueira',
}) =>
    {
      'id': 30,
      'nome': nome,
      'imagem': '',
      'capacidade': capacidade,
      'precisa_agendar': precisaAgendar,
      'precisa_autorizacao': 1,
      'precisa_pagamento': 1,
      'regras': regras,
      'tem_monitoramento': monitoramento,
      'ocupacao': 3,
      'agendamentos': agendamentos,
      'horarios_livres': {
        '12/10/2026': [
          {'horarioDe': '10:00', 'horarioAte': '16:00'},
        ],
      },
    };

void entrarComoMorador() {
  storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
  Singleton.instance.id_apartamento = 55;
  Singleton.instance.bloco = 'A';
  Singleton.instance.apartamento = '101';
}

void entrarComoSindico() => storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});

void entrarComoFuncionario({required int areasSociais}) => storageFuncionario({
      'token': 't',
      'user': {'id': 3, 'nome': 'Rui', 'areas_sociais': areasSociais},
    });

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late int chamadasDetalhe;

  /// Detalhe da área via MockClient; o resto (inclusive o condomínio do clima)
  /// responde 404, então o clima nunca chega ao http real.
  void servir(Map<String, dynamic> obj) {
    chamadasDetalhe = 0;
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/areas-sociais/get')) {
        chamadasDetalhe++;
        return http.Response(jsonEncode(obj), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('', 404);
    });
  }

  setUp(() async {
    // Sem isto o primeiro teste grava o loginType antes do storage abrir.
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
    await tester.pumpWidget(MaterialApp(theme: tema, home: const AreaSocialDetail(myId: 30)));
    await tester.pumpAndSettle();
  }

  Finder rodape() => find.text('Reservar este espaço');

  List<int> idsListados(WidgetTester tester) => tester
      .widgetList<MinhaReservaCard>(find.byType(MinhaReservaCard, skipOffstage: false))
      .map((c) => c.reserva['id'] as int)
      .toList();

  testWidgets('morador vê só as próprias reservas (pendente, aprovada, recusada), editáveis, e o botão de reservar',
      (tester) async {
    entrarComoMorador();
    servir(area());
    await abrir(tester);

    expect(find.text('Minhas reservas'), findsOneWidget);
    expect(idsListados(tester), [1, 2]);
    final cards = tester.widgetList<MinhaReservaCard>(find.byType(MinhaReservaCard, skipOffstage: false));
    expect(cards.every((c) => !c.mostrarApto), isTrue);
    expect(cards.every((c) => c.onEditar != null), isTrue);
    expect(rodape(), findsOneWidget);
  });

  testWidgets('síndico vê pendentes e aprovadas de todos, com apto, e pode editar', (tester) async {
    entrarComoSindico();
    servir(area());
    await abrir(tester);

    expect(find.text('Minhas reservas'), findsNothing);
    expect(find.text('Reservas'), findsOneWidget);
    expect(idsListados(tester), [1, 4]);
    final cards = tester.widgetList<MinhaReservaCard>(find.byType(MinhaReservaCard, skipOffstage: false));
    expect(cards.every((c) => c.mostrarApto && c.onEditar != null), isTrue);
    expect(rodape(), findsOneWidget);
  });

  testWidgets('funcionário com permissão vê todas e não tem o botão de reservar', (tester) async {
    entrarComoFuncionario(areasSociais: 1);
    servir(area());
    await abrir(tester);

    expect(idsListados(tester), [1, 4]);
    expect(rodape(), findsNothing);
  });

  testWidgets('funcionário sem permissão não vê reservas de ninguém nem o botão', (tester) async {
    entrarComoFuncionario(areasSociais: 0);
    servir(area());
    await abrir(tester);

    expect(idsListados(tester), isEmpty);
    expect(find.text('Nenhuma reserva ainda'), findsOneWidget);
    expect(rodape(), findsNothing);
  });

  testWidgets('morador sem reservas vê o estado vazio', (tester) async {
    entrarComoMorador();
    servir(area(agendamentos: [_agendamentos[3]]));
    await abrir(tester);

    expect(find.byType(MinhaReservaCard), findsNothing);
    expect(find.text('Nenhuma reserva ainda'), findsOneWidget);
    expect(rodape(), findsOneWidget);
  });

  testWidgets('morador não edita reserva de outro apto mesmo se aparecer (regra estrita)', (tester) async {
    entrarComoMorador();
    Singleton.instance.bloco = 'a'; // casa para exibir, mas a edição exige igualdade exata
    servir(area());
    await abrir(tester);

    final cards = tester.widgetList<MinhaReservaCard>(find.byType(MinhaReservaCard, skipOffstage: false));
    expect(cards, isNotEmpty);
    expect(cards.every((c) => c.onEditar == null), isTrue);
  });

  testWidgets('área sem agendamento: sem seção de reservas e sem botão', (tester) async {
    entrarComoMorador();
    servir(area(precisaAgendar: 0));
    await abrir(tester);

    expect(find.text('Minhas reservas'), findsNothing);
    expect(find.byType(MinhaReservaCard), findsNothing);
    expect(rodape(), findsNothing);
  });

  testWidgets('regras ficam recolhidas e abrem ao tocar', (tester) async {
    entrarComoMorador();
    servir(area());
    await abrir(tester);

    expect(find.text('Regras de uso'), findsOneWidget);
    expect(find.text('Proibido som alto após 22h.'), findsNothing);
    await tester.tap(find.text('Regras de uso'));
    await tester.pumpAndSettle();
    expect(find.text('Proibido som alto após 22h.'), findsOneWidget);
  });

  testWidgets('sem regras, o card de regras não aparece', (tester) async {
    entrarComoMorador();
    servir(area(regras: '   '));
    await abrir(tester);
    expect(find.text('Regras de uso'), findsNothing);
  });

  testWidgets('tags viram chips curtos', (tester) async {
    entrarComoMorador();
    servir(area());
    await abrir(tester);
    expect(find.text('Agendamento'), findsOneWidget);
    expect(find.text('Autorização'), findsOneWidget);
    expect(find.text('Pagamento'), findsOneWidget);
  });

  testWidgets('clima que falha (http de teste devolve 400) não deixa chip nem skeleton', (tester) async {
    entrarComoMorador();
    final obj = area();
    var pediuCondominio = false;
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/areas-sociais/get')) {
        return http.Response(jsonEncode(obj), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (request.url.path.endsWith('/condominio/get-condominio')) {
        pediuCondominio = true;
        return http.Response(jsonEncode({'cidade': 'Franca', 'uf': 'SP'}), 200,
            headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('', 404);
    });
    await abrir(tester);

    expect(pediuCondominio, isTrue);
    expect(find.byType(AppSkeleton), findsNothing);
    expect(find.byWidgetPredicate((w) => w is Tooltip && (w.message ?? '').startsWith('Previsão')), findsNothing);
    expect(find.text('Agendamento'), findsOneWidget); // a linha das tags segue normal
  });

  testWidgets('"Reservar este espaço" abre a NewReserva e recarrega ao voltar', (tester) async {
    entrarComoMorador();
    servir(area());
    await abrir(tester);
    expect(chamadasDetalhe, 1);

    await tester.tap(rodape());
    await tester.pumpAndSettle();
    expect(find.byType(NewReserva), findsOneWidget);
    expect(tester.widget<NewReserva>(find.byType(NewReserva)).objEditReserva, isNull);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    expect(find.byType(NewReserva), findsNothing);
    expect(chamadasDetalhe, 2);
  });

  testWidgets('"Editar" abre a NewReserva em modo edição com o item', (tester) async {
    entrarComoMorador();
    servir(area());
    await abrir(tester);

    final editar = find.byKey(MinhaReservaCard.chaveEditar).first;
    await tester.ensureVisible(editar);
    await tester.pumpAndSettle();
    await tester.tap(editar);
    await tester.pumpAndSettle();

    final tela = tester.widget<NewReserva>(find.byType(NewReserva));
    expect(tela.objEditReserva['id'], 1);
  });

  testWidgets('320dp, tema escuro, nome longo, ocupação e capacidade indeterminada: sem overflow', (tester) async {
    entrarComoSindico();
    servir(area(
      capacidade: -1,
      monitoramento: true,
      nome: 'Salão de festas principal com churrasqueira e piscina',
    ));
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Regras de uso'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
