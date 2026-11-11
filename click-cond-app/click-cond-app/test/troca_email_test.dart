import 'dart:convert';

import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/shared/funcionarios/edit_funcionario.dart';
import 'package:click/pages/shared/funcionarios/new_funcionario_1.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/troca_email.dart';
import 'package:click/widgets/app/dialog_senha_atual.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Trocar o próprio e-mail de acesso passou a exigir `senha_atual` na API
/// (sindico/update, funcionarios/update-infos, moradores/update). O app pede a
/// senha só quando o e-mail muda de verdade — a API compara com trim e sem
/// diferenciar maiúsculas, e o app precisa concordar com ela.
void main() {
  group('emailDeAcessoMudou', () {
    test('mesmo e-mail não é troca', () {
      expect(emailDeAcessoMudou('ana@x.com', 'ana@x.com'), isFalse);
    });

    test('só caixa ou espaços diferentes não é troca', () {
      expect(emailDeAcessoMudou('Ana@X.com', '  ana@x.COM '), isFalse);
    });

    test('outro e-mail é troca', () {
      expect(emailDeAcessoMudou('ana@x.com', 'ana@y.com'), isTrue);
    });

    test('nulo e vazio contam como o mesmo valor', () {
      expect(emailDeAcessoMudou(null, ''), isFalse);
      expect(emailDeAcessoMudou('', 'nova@x.com'), isTrue);
    });
  });

  group('comSenhaAtual', () {
    test('põe senha_atual no mesmo objeto do e-mail, sem alterar o original', () {
      final original = {'email': 'nova@x.com'};
      final copia = comSenhaAtual(original, 's3nha');
      expect(copia, {'email': 'nova@x.com', 'senha_atual': 's3nha'});
      expect(original.containsKey('senha_atual'), isFalse);
    });

    test('aceita model com toJson', () {
      final copia = comSenhaAtual(FuncionarioModel(id: 7, email: 'f@x.com'), 'abc');
      expect(copia['id'], 7);
      expect(copia['email'], 'f@x.com');
      expect(copia['senha_atual'], 'abc');
    });

    test('sem senha não manda o campo', () {
      expect(comSenhaAtual({'email': 'a@x.com'}, null).containsKey('senha_atual'), isFalse);
      expect(comSenhaAtual({'email': 'a@x.com'}, '').containsKey('senha_atual'), isFalse);
    });
  });

  group('controllers enviam senha_atual e mostram a mensagem da API', () {
    late Map<String, dynamic> corpo;
    const msgSenha = 'Para trocar o e-mail de acesso, informe sua senha atual.';

    void responder(int status, Object resposta) {
      ApiClient.client = MockClient((req) async {
        corpo = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode(resposta), status,
            headers: {'content-type': 'application/json; charset=utf-8'});
      });
    }

    setUp(() => Singleton.instance.id_condominio = 22);
    tearDown(() {
      ApiClient.restaurarPadroes();
      Singleton.instance.reset();
    });

    test('funcionário: senha_atual dentro de "funcionario" e a message da API chega à tela', () async {
      responder(400, {'statusCode': 400, 'message': msgSenha});
      await expectLater(
        updateFuncionarioApi(FuncionarioModel(id: 1, email: 'novo@x.com'), senhaAtual: 'abc'),
        throwsA(msgSenha),
      );
      expect(corpo['funcionario']['senha_atual'], 'abc');
      expect(corpo['funcionario']['email'], 'novo@x.com');
    });

    test('funcionário: 429 da trava por conta aparece como veio', () async {
      const msg429 = 'Muitas tentativas. Tente novamente em alguns minutos.';
      responder(429, {'statusCode': 429, 'message': msg429});
      await expectLater(updateFuncionarioApi(FuncionarioModel(id: 1), senhaAtual: 'x'), throwsA(msg429));
    });

    test('funcionário: sem troca de e-mail não manda senha_atual', () async {
      responder(400, {'message': 'outro erro'});
      await expectLater(updateFuncionarioApi(FuncionarioModel(id: 1, email: 'f@x.com')), throwsA('outro erro'));
      expect((corpo['funcionario'] as Map).containsKey('senha_atual'), isFalse);
    });

    test('síndico: senha_atual no corpo junto do e-mail', () async {
      responder(400, {'message': msgSenha});
      await expectLater(
        updateSindico('Sid', '123', '', 'novo@x.com', '', null, senhaAtual: 'abc'),
        throwsA(msgSenha),
      );
      expect(corpo['senha_atual'], 'abc');
      expect(corpo['email'], 'novo@x.com');
    });

    test('síndico: sem senha o campo não vai', () async {
      responder(400, {'message': 'x'});
      await expectLater(updateSindico('Sid', '', '', 's@x.com', '', null), throwsA('x'));
      expect(corpo.containsKey('senha_atual'), isFalse);
    });

    test('morador: senha_atual dentro de "morador" e devolve a message', () async {
      responder(400, {'message': msgSenha});
      final res = await updateMoradorApi({'id': 5, 'email': 'novo@x.com'}, senhaAtual: 'abc');
      expect(res, msgSenha);
      expect(corpo['morador']['senha_atual'], 'abc');
    });
  });

  group('DialogSenhaAtual', () {
    Future<void> abrir(WidgetTester tester, void Function(String?) aoFechar) async {
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (ctx) => TextButton(
            onPressed: () async => aoFechar(await pedirSenhaAtualParaTrocaDeEmail(ctx)),
            child: const Text('abrir'),
          ),
        ),
      ));
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();
    }

    testWidgets('senha fica oculta e Confirmar devolve o texto', (tester) async {
      String? devolvida = 'nao-fechou';
      await abrir(tester, (s) => devolvida = s);
      final campo = tester.widget<TextField>(find.byType(TextField));
      expect(campo.obscureText, isTrue);
      await tester.enterText(find.byType(TextField), 'minhaSenha');
      await tester.tap(find.text('CONFIRMAR'));
      await tester.pumpAndSettle();
      expect(devolvida, 'minhaSenha');
    });

    testWidgets('Cancelar devolve null', (tester) async {
      String? devolvida = 'nao-fechou';
      await abrir(tester, (s) => devolvida = s);
      await tester.tap(find.text('CANCELAR'));
      await tester.pumpAndSettle();
      expect(devolvida, isNull);
    });

    testWidgets('campo vazio não fecha o diálogo', (tester) async {
      String? devolvida = 'nao-fechou';
      await abrir(tester, (s) => devolvida = s);
      await tester.tap(find.text('CONFIRMAR'));
      await tester.pumpAndSettle();
      expect(find.byType(DialogSenhaAtual), findsOneWidget);
      expect(devolvida, 'nao-fechou');
    });
  });

  group('EditFuncionario', () {
    late List<Map<String, dynamic>> updates;

    setUp(() async {
      await ensureStorageReady();
      Singleton.instance.id_condominio = 22;
      updates = [];
      ApiClient.client = MockClient((req) async {
        if (req.url.path.endsWith('/funcionarios/get')) {
          return http.Response(
            jsonEncode({'id': 3, 'nome': 'Rui', 'email': 'rui@x.com', 'documento': '', 'telefone': ''}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        if (req.url.path.endsWith('/funcionarios/update-infos')) {
          updates.add(jsonDecode(req.body) as Map<String, dynamic>);
          return http.Response(jsonEncode({'message': 'Já existe outro usuário com este e-mail.'}), 400,
              headers: {'content-type': 'application/json; charset=utf-8'});
        }
        return http.Response('', 404);
      });
    });

    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    Future<void> abrir(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: EditFuncionario()));
      await tester.pumpAndSettle();
    }

    Finder campoEmail() => find.widgetWithText(TextField, 'rui@x.com');

    testWidgets('e-mail igual (só caixa/espaço) salva sem pedir senha', (tester) async {
      await abrir(tester);
      await tester.enterText(campoEmail(), ' RUI@x.com ');
      await tester.ensureVisible(find.text('SALVAR'));
      await tester.tap(find.text('SALVAR'));
      await tester.pumpAndSettle();
      expect(find.byType(DialogSenhaAtual), findsNothing);
      expect(updates, hasLength(1));
      expect((updates.single['funcionario'] as Map).containsKey('senha_atual'), isFalse);
      // A mensagem da API aparece em vez de "Houve um erro, tente novamente!".
      expect(find.text('Já existe outro usuário com este e-mail.'), findsOneWidget);
    });

    testWidgets('e-mail novo pede a senha e manda senha_atual', (tester) async {
      await abrir(tester);
      await tester.enterText(campoEmail(), 'novo@x.com');
      await tester.ensureVisible(find.text('SALVAR'));
      await tester.tap(find.text('SALVAR'));
      await tester.pumpAndSettle();
      expect(find.byType(DialogSenhaAtual), findsOneWidget);
      await tester.enterText(
          find.descendant(of: find.byType(DialogSenhaAtual), matching: find.byType(TextField)), 'abc123');
      await tester.tap(find.text('CONFIRMAR'));
      await tester.pumpAndSettle();
      expect(updates, hasLength(1));
      expect(updates.single['funcionario']['senha_atual'], 'abc123');
      expect(updates.single['funcionario']['email'], 'novo@x.com');
    });

    testWidgets('cancelar o diálogo não salva', (tester) async {
      await abrir(tester);
      await tester.enterText(campoEmail(), 'novo@x.com');
      await tester.ensureVisible(find.text('SALVAR'));
      await tester.tap(find.text('SALVAR'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('CANCELAR'));
      await tester.pumpAndSettle();
      expect(updates, isEmpty);
    });
  });
}
