import 'dart:convert';

import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/shared/enquetes/list_enquetes.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Menu "Gerenciar" do condomínio: o item de Assembleias se chama
/// "Assembleias" (não mais "Assembleias e Votações") e Enquetes continua lá.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    // Nada de rede real: condomínio sem cidade (não busca a previsão do tempo)
    // e listas vazias para as abas do IndexedStack.
    ApiClient.client = MockClient((request) async {
      final path = request.url.path;
      const json = {'content-type': 'application/json; charset=utf-8'};
      if (path.endsWith('/condominio/get-condominio')) {
        return http.Response(jsonEncode({'id': 22, 'nome': 'Residencial Teste', 'saldo': '0'}), 200, headers: json);
      }
      if (path.endsWith('/dashboard/summary')) {
        return http.Response('{}', 200, headers: json);
      }
      if (path.endsWith('/assembleias/get-all') || path.endsWith('/assembleias/votacoes/enquetes/get-all')) {
        return http.Response('[]', 200, headers: json);
      }
      return http.Response('[]', 200, headers: json);
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400 * 3, 3000 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: MyCondominium(id: 22)));
    await tester.pumpAndSettle();
  }

  Future<void> rolarAte(WidgetTester tester, Finder f) async {
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
  }

  testWidgets('síndico: item "Assembleias" abre a lista de assembleias e "Enquetes" abre as enquetes',
      (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    await abrir(tester);

    expect(find.text('Assembleias e Votações'), findsNothing);
    expect(find.text('Assembléias e Votações'), findsNothing);

    final assembleias = find.text('Assembleias');
    await rolarAte(tester, assembleias);
    expect(assembleias, findsOneWidget);
    await tester.tap(assembleias);
    await tester.pumpAndSettle();
    expect(find.byType(ListAssembleias), findsOneWidget);
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();

    final enquetes = find.text('Enquetes');
    await rolarAte(tester, enquetes);
    expect(enquetes, findsOneWidget);
    await tester.tap(enquetes);
    await tester.pumpAndSettle();
    expect(find.byType(ListEnquetes), findsOneWidget);
  });

  testWidgets('linha do módulo mostra o efeito do toque (Material acima do fundo do bloco)', (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    await abrir(tester);
    final tinta = find.ancestor(of: find.text('Comunicados'), matching: find.byType(InkWell)).first;
    // A tinta do InkWell é pintada no Material mais próximo; um fundo opaco
    // entre os dois a esconde.
    String? achado;
    tester.element(tinta).visitAncestorElements((e) {
      final w = e.widget;
      if (w is Material) {
        achado = 'material';
        return false;
      }
      final cor = w is ColoredBox
          ? w.color
          : (w is DecoratedBox && w.decoration is BoxDecoration)
              ? (w.decoration as BoxDecoration).color
              : null;
      if (cor != null && cor.a > 0) {
        achado = 'fundo opaco antes do Material';
        return false;
      }
      return true;
    });
    expect(achado, 'material');
  });

  testWidgets('módulo com moldura amarela e ícone na cor do texto, sem degradê', (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    await abrir(tester);
    final cartao = find.ancestor(of: find.text('Comunicados'), matching: find.byType(InkWell)).first;
    expect(find.descendant(of: cartao, matching: find.byType(ShaderMask)), findsNothing);
    final moldura = find.descendant(
      of: cartao,
      matching: find.byWidgetPredicate((w) =>
          w is Container &&
          w.decoration is BoxDecoration &&
          (w.decoration as BoxDecoration).border is Border &&
          ((w.decoration as BoxDecoration).border as Border).top.color == AppColors.brand),
    );
    expect(moldura, findsOneWidget);
    final icone = tester.widget<Image>(find.descendant(of: moldura, matching: find.byType(Image)));
    expect(icone.color, AppColors.textPrimary(tester.element(moldura)));
  });

  testWidgets('funcionário: o filtro continua escondendo Assembleias e Enquetes', (tester) async {
    storageFuncionario({'token': 't', 'user': {'id': 3, 'nome': 'Fun'}});
    await abrir(tester);

    // Tela alta (3000dp): o menu inteiro está construído, sem rolagem.
    expect(find.text('Comunicados'), findsOneWidget, reason: 'o menu foi montado');
    expect(find.text('Assembleias'), findsNothing);
    expect(find.text('Enquetes'), findsNothing);
    expect(find.text('Assembleias e Votações'), findsNothing);
  });
}
