import 'dart:convert';

import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _iso(Duration d) => DateTime.now().toUtc().add(d).toIso8601String();

Map<String, dynamic> _visita(int id, String nome, {int idPessoa = 0}) => {
      'id': id,
      'id_pessoa': idPessoa == 0 ? id : idPessoa,
      'nome': nome,
      'doc_identificacao': '000$id',
      'is_prestador': 0,
      'apto_bloco': 'A',
      'apto': '106',
      'liberado': 1,
      'created_at': _iso(Duration(hours: -id)),
      'data_hora_inicio': _iso(Duration(hours: -id)),
      'data_hora_termino': _iso(const Duration(days: 1)),
      'data_entrada': null,
      'data_saida': null,
    };

const _json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Singleton.instance.id_condominio = 11;
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrirCadastrados(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: ListVisitantes()));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('CADASTRADOS'));
    await tester.pumpAndSettle();
  }

  /// A2: puxar para atualizar (ou a volta de um check-in) com a rede
  /// oscilando apagava a lista inteira.
  testWidgets('recarga que falha mantém a lista na tela', (tester) async {
    var falhar = false;
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/visitantes/get-all')) {
        if (falhar) return http.Response('erro', 503);
        return http.Response(jsonEncode([_visita(1, 'Rafael Costa')]), 200, headers: _json);
      }
      return http.Response('[]', 200);
    });
    await abrirCadastrados(tester);
    expect(find.text('Rafael Costa'), findsWidgets);

    falhar = true;
    final estado = tester.state<ListVisitantesPageState>(find.byType(ListVisitantes));
    await estado.loadList(avisarErro: false);
    await tester.pumpAndSettle();
    expect(find.text('Rafael Costa'), findsWidgets);
  });

  /// F8: a API manda 30 visitas por vez; a 31ª (visitante antigo com PIN
  /// ativo) nunca aparecia.
  testWidgets('página cheia mostra "Carregar mais" e busca com offset', (tester) async {
    final offsets = <String?>[];
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/visitantes/get-all')) {
        final offset = req.url.queryParameters['offset'];
        offsets.add(offset);
        if (offset == '0') {
          return http.Response(
              jsonEncode([for (var i = 1; i <= 30; i++) _visita(i, 'Pessoa $i')]), 200,
              headers: _json);
        }
        return http.Response(jsonEncode([_visita(31, 'Antigo Com PIN')]), 200, headers: _json);
      }
      return http.Response('[]', 200);
    });
    await abrirCadastrados(tester);

    final botao = find.text('Carregar mais');
    await tester.scrollUntilVisible(botao, 400, scrollable: find.byType(Scrollable).last);
    await tester.tap(botao);
    await tester.pumpAndSettle();

    expect(offsets, ['0', '30']);
    await tester.scrollUntilVisible(find.text('Antigo Com PIN'), 400, scrollable: find.byType(Scrollable).last);
    expect(find.text('Antigo Com PIN'), findsOneWidget);
    expect(find.text('Carregar mais'), findsNothing, reason: 'página incompleta: acabou');
  });

  /// Push `confirmacao_reserva`: abre direto em "Minhas reservas" (o card com
  /// "Confirmar presença") no condomínio do push.
  testWidgets('reservas pelo push: aba Minhas reservas e condomínio do push', (tester) async {
    tester.view.physicalSize = const Size(2400, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final condominios = <String?>[];
    ApiClient.client = MockClient((req) async {
      condominios.add(req.url.queryParameters['id_condominio']);
      if (req.url.path.endsWith('/areas-sociais/meus-agendamentos/get-all')) {
        return http.Response(
            jsonEncode([
              {
                'id': 9,
                'nomeArea': 'Churrasqueira',
                'status': 'aprovado',
                'data': '25/11/2099',
                'horaDe': '12:00',
                'horaAte': '16:00',
                'apto': '101',
                'bloco': 'A',
              }
            ]),
            200,
            headers: _json);
      }
      return http.Response('[]', 200);
    });
    await tester.pumpWidget(const MaterialApp(home: ListAreasSociais(minhasReservas: true, idCondominio: 7)));
    await tester.pumpAndSettle();
    expect(find.text('Churrasqueira'), findsOneWidget, reason: 'abriu na aba Minhas reservas');
    expect(condominios.toSet(), {'7'});
  });
}
