import 'dart:convert';

import 'package:click/pages/shared/areas%20sociais/new_reserva.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/convidados_stepper.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/disponibilidade_calendario.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/horario_card.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/resumo_reserva.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> area({
  String? regras,
  int precisaAutorizacao = 1,
  Map<String, dynamic>? horarios,
}) =>
    {
      'id': 30,
      'nome': 'Churrasqueira',
      'capacidade': 10,
      'precisa_autorizacao': precisaAutorizacao,
      'regras': regras,
      'horarios_livres': horarios ??
          {
            '12/10/2026': [
              {'horarioDe': '10:00', 'horarioAte': '16:00'},
              {'horarioDe': '18:00', 'horarioAte': '22:00'},
            ],
            '14/10/2026': [],
          },
    };

Finder diaDoCalendario(String dia) =>
    find.descendant(of: find.byType(DisponibilidadeCalendario), matching: find.text(dia));

AppButton botaoAcao(WidgetTester tester) => tester.widget<AppButton>(find.byType(AppButton));

Future<void> tocar(WidgetTester tester, Finder alvo) async {
  await tester.ensureVisible(alvo);
  await tester.pumpAndSettle();
  await tester.tap(alvo);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    // Sem isto o primeiro teste grava o loginType antes do storage abrir
    // (mesmo motivo de areas_sociais_detail_test.dart).
    await ensureStorageReady();
    storageMorador({
      'token': 'token-morador',
      'user': {'id': 1, 'nome': 'Ana'},
    });
    Singleton.instance.id_condominio = 22;
    Singleton.instance.id_apartamento = 55;
    Singleton.instance.bloco = 'A';
    Singleton.instance.apartamento = '101';
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, Widget tela) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: tela));
    await tester.pumpAndSettle();
  }

  testWidgets('seções aparecem em sequência e o botão só habilita com dia, horário e aceite das regras',
      (tester) async {
    await abrir(tester, NewReserva(obj: area(regras: 'Proibido som alto após 22h.')));

    // Só o calendário no início.
    expect(find.byType(DisponibilidadeCalendario), findsOneWidget);
    expect(find.byType(HorarioCard), findsNothing);
    expect(find.byType(ConvidadosStepper), findsNothing);
    expect(find.byType(ResumoReserva), findsNothing);
    expect(find.text('Proibido som alto após 22h.'), findsNothing);
    expect(find.text('Solicitar reserva'), findsOneWidget);
    expect(botaoAcao(tester).onPressed, isNull);

    // Dia → horários.
    await tocar(tester, diaDoCalendario('12'));
    expect(find.byType(HorarioCard), findsNWidgets(2));
    expect(find.text('10:00 – 16:00'), findsOneWidget);
    expect(find.byType(ConvidadosStepper), findsNothing);
    expect(find.byType(ResumoReserva), findsNothing);
    expect(botaoAcao(tester).onPressed, isNull);

    // Horário → convidados, regras e resumo.
    await tocar(tester, find.text('10:00 – 16:00'));
    expect(find.byType(ConvidadosStepper), findsOneWidget);
    expect(find.text('Proibido som alto após 22h.'), findsOneWidget);
    expect(find.byType(ResumoReserva), findsOneWidget);
    expect(botaoAcao(tester).onPressed, isNull, reason: 'falta aceitar as regras');

    // Aceite → habilita.
    await tocar(tester, find.byType(Checkbox));
    expect(botaoAcao(tester).onPressed, isNotNull);

    // Desmarcar volta a bloquear.
    await tocar(tester, find.byType(Checkbox));
    expect(botaoAcao(tester).onPressed, isNull);
  });

  testWidgets('sem regras: dia + horário bastam; área sem autorização usa "Confirmar reserva"', (tester) async {
    await abrir(tester, NewReserva(obj: area(regras: '  ', precisaAutorizacao: 0)));
    expect(find.text('Confirmar reserva'), findsOneWidget);

    await tocar(tester, diaDoCalendario('12'));
    await tocar(tester, find.text('18:00 – 22:00'));

    expect(find.byType(Checkbox), findsNothing);
    expect(botaoAcao(tester).onPressed, isNotNull);
  });

  testWidgets('dia sem horário livre mostra estado vazio e mantém o botão bloqueado', (tester) async {
    await abrir(tester, NewReserva(obj: area()));
    await tocar(tester, diaDoCalendario('14'));

    expect(find.byType(HorarioCard), findsNothing);
    expect(find.text('Nenhum horário livre neste dia'), findsOneWidget);
    expect(botaoAcao(tester).onPressed, isNull);
  });

  testWidgets('trocar para um dia sem o horário escolhido limpa a seleção', (tester) async {
    await abrir(
      tester,
      NewReserva(
        obj: area(horarios: {
          '12/10/2026': [
            {'horarioDe': '10:00', 'horarioAte': '16:00'},
          ],
          '13/10/2026': [
            {'horarioDe': '08:00', 'horarioAte': '12:00'},
          ],
        }),
      ),
    );
    await tocar(tester, diaDoCalendario('12'));
    await tocar(tester, find.text('10:00 – 16:00'));
    expect(botaoAcao(tester).onPressed, isNotNull);

    await tocar(tester, diaDoCalendario('13'));
    expect(find.byType(ResumoReserva), findsNothing);
    expect(botaoAcao(tester).onPressed, isNull);
  });

  testWidgets('área sem dias disponíveis mostra o estado vazio do calendário', (tester) async {
    await abrir(tester, NewReserva(obj: area(horarios: {})));
    expect(find.text('Nenhum dia disponível no momento'), findsOneWidget);
    expect(botaoAcao(tester).onPressed, isNull);
  });

  testWidgets('stepper de convidados alimenta o payload salvo', (tester) async {
    late http.Request enviado;
    ApiClient.client = MockClient((request) async {
      enviado = request;
      return http.Response('{}', 200);
    });

    Object? resultado;
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () async {
            resultado = await Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => NewReserva(obj: area())),
            );
          },
          child: const Text('abrir'),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();

    await tocar(tester, diaDoCalendario('12'));
    await tocar(tester, find.text('10:00 – 16:00'));
    await tocar(tester, find.byKey(ConvidadosStepper.chaveMais));
    await tocar(tester, find.byKey(ConvidadosStepper.chaveMais));
    expect(find.text('2 convidados'), findsOneWidget); // resumo acompanha

    await tocar(tester, find.text('Solicitar reserva'));

    expect(enviado.url.path, endsWith('/areas-sociais/agendamento/insert'));
    final payload = jsonDecode(enviado.body) as Map<String, dynamic>;
    expect(payload['agendamento'], {
      'id': -1,
      'id_area_social': 30,
      'data': '12/10/2026',
      'horaDe': '10:00',
      'horaAte': '16:00',
      'id_apartamento': '55',
      'convidados': 2,
    });
    expect(resultado, true);
  });

  testWidgets('sem convidados o payload segue com convidados nulo', (tester) async {
    late http.Request enviado;
    ApiClient.client = MockClient((request) async {
      enviado = request;
      return http.Response('{}', 200);
    });
    await abrir(tester, NewReserva(obj: area()));
    await tocar(tester, diaDoCalendario('12'));
    await tocar(tester, find.text('10:00 – 16:00'));
    await tocar(tester, find.byKey(ConvidadosStepper.chaveMais));
    await tocar(tester, find.byKey(ConvidadosStepper.chaveMenos)); // volta a "Opcional"
    expect(find.text('Opcional'), findsOneWidget);

    await tocar(tester, find.text('Solicitar reserva'));
    final payload = jsonDecode(enviado.body) as Map<String, dynamic>;
    expect((payload['agendamento'] as Map)['convidados'], isNull);
  });

  testWidgets('síndico: dica pede bloco e apartamento até escolher os dois (botão segue a regra antiga)',
      (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/apartamentos/get-all')) {
        return http.Response(jsonEncode([{'id': 77, 'bloco': 'Torre9', 'apto': '707'}]), 200,
            headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('', 404);
    });
    await abrir(tester, NewReserva(obj: area(regras: '  ')));
    const dica = 'Escolha bloco e apartamento.';
    expect(find.text(dica), findsOneWidget);

    // Dia + horário: botão habilita (gating inalterado), dica continua.
    await tocar(tester, diaDoCalendario('12'));
    await tocar(tester, find.text('10:00 – 16:00'));
    expect(botaoAcao(tester).onPressed, isNotNull);
    expect(find.text(dica), findsOneWidget);

    await tocar(tester, find.text('Bloco'));
    await tocar(tester, find.text('Torre9').last);
    expect(find.text(dica), findsOneWidget, reason: 'falta o apto');

    await tocar(tester, find.text('Apartamento'));
    await tocar(tester, find.text('707').last);
    expect(find.text(dica), findsNothing);
  });

  testWidgets('morador não vê a dica de bloco e apartamento', (tester) async {
    await abrir(tester, NewReserva(obj: area()));
    expect(find.text('Escolha bloco e apartamento.'), findsNothing);
    expect(find.text('Escolha um dia no calendário.'), findsOneWidget);
  });

  testWidgets('edição: sem calendário, mostra resumo e o botão excluir', (tester) async {
    await abrir(
      tester,
      NewReserva(
        obj: area(regras: 'Regra qualquer'),
        objEditReserva: {
          'id': 9,
          'data': '12/10/2026',
          'horaDe': '10:00',
          'horaAte': '16:00',
          'bloco': 'A',
          'apto': '101',
          'convidados': 4,
          'status': 'pendente',
        },
      ),
    );

    expect(find.byType(DisponibilidadeCalendario), findsNothing);
    expect(find.byType(HorarioCard), findsNothing);
    expect(find.byType(ConvidadosStepper), findsNothing);
    expect(find.byType(ResumoReserva), findsOneWidget);
    expect(find.text('4 convidados'), findsOneWidget);
    expect(find.text('Solicitar reserva'), findsNothing);
    final botao = botaoAcao(tester);
    expect(botao.variant, AppButtonVariant.danger);
    expect(botao.onPressed, isNotNull);
  });
}
