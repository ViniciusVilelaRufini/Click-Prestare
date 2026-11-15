import 'package:click/pages/shared/assembleias/new_votacao.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Rodada 5 (assembleia robusta): ao criar pauta/enquete o síndico pode marcar
// "Somente proprietários" (a API recebe `votacao.somente_proprietarios`).

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('VotacaoModel', () {
    test('manda somente_proprietarios como 0/1 (padrão 0)', () {
      expect(VotacaoModel(titulo: 'X').toJson()['somente_proprietarios'], 0);
      expect(VotacaoModel(titulo: 'X', somenteProprietarios: true).toJson()['somente_proprietarios'], 1);
    });

    test('demais campos continuam iguais aos do app 1.2.48', () {
      final j = VotacaoModel(
        titulo: 'Pintura',
        descricao: '',
        data_inicio: '2026-11-15',
        data_termino: '2026-11-20',
        id_assembleia: 5,
        is_enquete: false,
        opcoes: ['Sim', 'Não'],
      ).toJson();
      expect(j.keys.toSet(), {
        'titulo',
        'descricao',
        'data_inicio',
        'hora_inicio',
        'data_termino',
        'hora_termino',
        'is_enquete',
        'id_assembleia',
        'opcoes',
        'somente_proprietarios',
      });
      expect(j['opcoes'], ['Sim', 'Não']);
      expect(j['id_assembleia'], 5);
    });
  });

  group('tela', () {
    setUp(() async {
      await ensureStorageReady();
      Singleton.instance.id_condominio = 22;
      storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    });

    tearDown(() async {
      await storageLogout();
      Singleton.instance.reset();
    });

    Future<void> abrir(WidgetTester tester, {required bool enquete}) async {
      tester.view.physicalSize = const Size(360 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: NewVotacao(idAssembleia: enquete ? null : 5, isEnquete: enquete)));
      await tester.pumpAndSettle();
    }

    testWidgets('pauta: chave desligada por padrão, com a explicação; liga ao tocar', (tester) async {
      await abrir(tester, enquete: false);
      expect(find.text('Somente proprietários'), findsOneWidget);
      expect(find.text(NewVotacao.ajudaSomenteProprietariosPauta), findsOneWidget);
      final chave = find.byKey(NewVotacao.chaveSomenteProprietarios);
      expect(tester.widget<Switch>(chave).value, isFalse);
      await tester.ensureVisible(chave);
      await tester.tap(chave);
      await tester.pumpAndSettle();
      expect(tester.widget<Switch>(chave).value, isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('enquete: explicação própria', (tester) async {
      await abrir(tester, enquete: true);
      expect(find.text(NewVotacao.ajudaSomenteProprietariosEnquete), findsOneWidget);
    });
  });
}
