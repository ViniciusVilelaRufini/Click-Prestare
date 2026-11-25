import 'dart:convert';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/rotulo_reserva.dart';
import 'package:click/widgets/cells/cell_my_agendamento.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Área com "exige confirmação": a API manda o push "Vai usar sua reserva?"
/// 30 min antes e cancela, no início do horário, a reserva aprovada que não foi
/// confirmada (`areas-sociais.service.ts`, `cancelarReservasNaoConfirmadas`).
/// O app não tinha onde confirmar. A rota é POST
/// `areas-sociais/agendamento/confirmar` e só aceita reserva `aprovado`.
void main() {
  // 25/11/2026 às 10:00 em Brasília.
  final agora = DateTime(2026, 11, 25, 10, 0);

  Map<String, dynamic> reserva({
    String status = 'aprovado',
    Object? exige = true,
    Object? confirmadaEm,
    String data = '25/11/2026',
    String horaDe = '12:00',
    String horaAte = '16:00',
    bool comCampoExige = true,
  }) =>
      {
        'id': 9,
        'nomeArea': 'Churrasqueira',
        'status': status,
        'data': data,
        'horaDe': horaDe,
        'horaAte': horaAte,
        'apto': '101',
        'bloco': 'A',
        'confirmada_em': confirmadaEm,
        if (comCampoExige) 'exige_confirmacao': exige,
      };

  group('podeConfirmarPresenca', () {
    test('aprovada, área exige, sem confirmação e antes do fim: pode', () {
      expect(podeConfirmarPresenca(reserva(), agora: agora), isTrue);
    });

    test('a API manda exige_confirmacao como bool; 1 e "1" também valem', () {
      expect(podeConfirmarPresenca(reserva(exige: 1), agora: agora), isTrue);
      expect(podeConfirmarPresenca(reserva(exige: '1'), agora: agora), isTrue);
      expect(podeConfirmarPresenca(reserva(exige: false), agora: agora), isFalse);
      expect(podeConfirmarPresenca(reserva(exige: 0), agora: agora), isFalse);
      expect(podeConfirmarPresenca(reserva(exige: null), agora: agora), isFalse);
    });

    test('API sem o campo exige_confirmacao: o botão não aparece', () {
      expect(podeConfirmarPresenca(reserva(comCampoExige: false), agora: agora), isFalse);
    });

    test('já confirmada: não pede de novo', () {
      expect(podeConfirmarPresenca(reserva(confirmadaEm: '2026-11-25T09:31:00.000Z'), agora: agora), isFalse);
      expect(podeConfirmarPresenca(reserva(confirmadaEm: ''), agora: agora), isTrue);
    });

    test('só reserva aprovada (a API recusa pendente, cancelada e recusada)', () {
      for (final s in ['pendente', 'cancelado', 'recusado', 'confirmado']) {
        expect(podeConfirmarPresenca(reserva(status: s), agora: agora), isFalse, reason: s);
      }
      expect(podeConfirmarPresenca(reserva(status: 'Aprovado'), agora: agora), isTrue);
    });

    test('depois do fim do horário não aparece; durante ainda aparece', () {
      expect(podeConfirmarPresenca(reserva(), agora: DateTime(2026, 11, 25, 15, 59)), isTrue);
      expect(podeConfirmarPresenca(reserva(), agora: DateTime(2026, 11, 25, 16, 0)), isFalse);
      expect(podeConfirmarPresenca(reserva(data: '24/11/2026'), agora: agora), isFalse);
      expect(podeConfirmarPresenca(reserva(data: '30/11/2026'), agora: agora), isTrue);
    });

    test('sem hora de fim usa o início; data ilegível deixa a API decidir', () {
      expect(podeConfirmarPresenca(reserva(horaAte: ''), agora: DateTime(2026, 11, 25, 11, 59)), isTrue);
      expect(podeConfirmarPresenca(reserva(horaAte: ''), agora: DateTime(2026, 11, 25, 12, 0)), isFalse);
      expect(podeConfirmarPresenca(reserva(data: ''), agora: agora), isTrue);
    });

    test('reserva que vira a noite termina no dia seguinte', () {
      final noite = reserva(horaDe: '22:00', horaAte: '02:00');
      expect(podeConfirmarPresenca(noite, agora: DateTime(2026, 11, 26, 1, 0)), isTrue);
      expect(podeConfirmarPresenca(noite, agora: DateTime(2026, 11, 26, 2, 0)), isFalse);
    });

    test('item que não é mapa: não', () {
      expect(podeConfirmarPresenca(null, agora: agora), isFalse);
      expect(podeConfirmarPresenca('x', agora: agora), isFalse);
    });
  });

  group('apiConfirmarAgendamento', () {
    setUp(() => Singleton.instance.id_condominio = 22);
    tearDown(() {
      ApiClient.restaurarPadroes();
      Singleton.instance.reset();
    });

    test('POST agendamento/confirmar com o id; 200 é sucesso', () async {
      late http.Request enviado;
      ApiClient.client = MockClient((req) async {
        enviado = req;
        return http.Response('{"success":true}', 200);
      });
      final r = await apiConfirmarAgendamento(9);
      expect(r.ok, isTrue);
      expect(enviado.method, 'POST');
      expect(enviado.url.path, endsWith('/areas-sociais/agendamento/confirmar'));
      expect(jsonDecode(enviado.body)['id'], 9);
    });

    test('recusa da API chega à tela', () async {
      ApiClient.client = MockClient((req) async => http.Response(
          jsonEncode({'statusCode': 409, 'message': 'Esta reserva ainda não foi aprovada.'}), 409,
          headers: {'content-type': 'application/json; charset=utf-8'}));
      final r = await apiConfirmarAgendamento(9);
      expect(r.ok, isFalse);
      expect(r.mensagem, 'Esta reserva ainda não foi aprovada.');
    });

    test('sem rede: falha com texto de comunicação', () async {
      ApiClient.client = MockClient((req) async => throw http.ClientException('sem rede'));
      final r = await apiConfirmarAgendamento(9);
      expect(r.ok, isFalse);
      expect(r.mensagem, isNotNull);
    });
  });

  group('CellMyAgendamento', () {
    Future<void> mostrar(WidgetTester tester, Widget celula) async {
      tester.view.physicalSize = const Size(1800, 3200);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: ListView(children: [celula]))));
      await tester.pumpAndSettle();
    }

    final futuro = reserva(data: '25/11/2099');

    testWidgets('mostra "Confirmar presença" e chama onConfirmar com o id', (tester) async {
      int? confirmado;
      await mostrar(tester, CellMyAgendamento(item: futuro, onCancel: (_) {}, onConfirmar: (id) => confirmado = id));
      final botao = find.text('Confirmar presença');
      expect(botao, findsOneWidget);
      await tester.tap(botao);
      await tester.pumpAndSettle();
      expect(confirmado, 9);
    });

    testWidgets('sem onConfirmar, ou área que não exige, não mostra o botão', (tester) async {
      await mostrar(tester, CellMyAgendamento(item: futuro, onCancel: (_) {}));
      expect(find.text('Confirmar presença'), findsNothing);
      await mostrar(tester,
          CellMyAgendamento(item: reserva(data: '25/11/2099', exige: false), onConfirmar: (_) {}));
      expect(find.text('Confirmar presença'), findsNothing);
    });

    testWidgets('confirmada: mostra "Presença confirmada" no lugar do botão', (tester) async {
      await mostrar(
        tester,
        CellMyAgendamento(
          item: reserva(data: '25/11/2099', confirmadaEm: '2026-11-25T09:31:00.000Z'),
          onConfirmar: (_) {},
        ),
      );
      expect(find.text('Confirmar presença'), findsNothing);
      expect(find.text('Presença confirmada'), findsOneWidget);
    });
  });

  group('Minhas reservas (morador)', () {
    setUp(() async {
      await ensureStorageReady();
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      Singleton.instance.id_condominio = 22;
    });
    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    testWidgets('confirmar presença chama a API; recarga que falha mantém a reserva na tela', (tester) async {
      // Largo: o rótulo de lista vazia da aba de áreas (sem traduções no
      // teste) estoura em 360dp, e isso não é o que este teste olha.
      tester.view.physicalSize = const Size(2400, 2400);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      var falharLista = false;
      final confirmados = <dynamic>[];
      ApiClient.client = MockClient((req) async {
        final path = req.url.path;
        if (path.endsWith('/areas-sociais/agendamento/confirmar')) {
          confirmados.add(jsonDecode(req.body)['id']);
          return http.Response('{"success":true}', 200);
        }
        if (falharLista) return http.Response('erro', 503);
        if (path.endsWith('/areas-sociais/meus-agendamentos/get-all')) {
          return http.Response(jsonEncode([reserva(data: '25/11/2099')]), 200,
              headers: {'content-type': 'application/json; charset=utf-8'});
        }
        return http.Response('[]', 200);
      });

      await tester.pumpWidget(const MaterialApp(home: ListAreasSociais()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('MEUS AGENDAMENTOS'));
      await tester.pumpAndSettle();
      expect(find.text('Churrasqueira'), findsOneWidget);

      falharLista = true;
      await tester.tap(find.text('Confirmar presença'));
      await tester.pumpAndSettle();
      expect(confirmados, [9]);
      expect(find.text('Churrasqueira'), findsOneWidget, reason: 'reload com falha não esvazia a lista');
      expect(find.textContaining('Presença confirmada'), findsOneWidget);
    });
  });
}
