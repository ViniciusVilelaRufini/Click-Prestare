import 'dart:convert';

import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Errar a senha atual ao trocar a senha: a API responde 401 "Senha atual
/// incorreta." (`mobile-auth.service.ts`, `updatePassword`). O ApiClient trata
/// todo 401 da sessão atual como sessão vencida e desloga, então o usuário caía
/// na tela de login em vez de ver a mensagem. As três rotas de new-password
/// pulam esse tratamento: ali 401 é senha errada, não token vencido.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const msg = 'Senha atual incorreta.';
  late List<String> rotas;

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    rotas = [];
    ApiClient.client = MockClient((req) async {
      rotas.add(req.url.path);
      return http.Response(jsonEncode({'statusCode': 401, 'message': msg}), 401,
          headers: {'content-type': 'application/json; charset=utf-8'});
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  test('morador: 401 da senha atual mostra a mensagem e mantém a sessão', () async {
    storageMorador({'token': 'tok-morador', 'user': {'id': 1, 'nome': 'Ana'}});
    await expectLater(updatePasswordMoradorApi('errada', 'Nova@1234'), throwsA(msg));
    expect(rotas.single, endsWith('/moradores/new-password'));
    expect(getToken(), 'tok-morador');
  });

  test('síndico: 401 da senha atual mostra a mensagem e mantém a sessão', () async {
    storageLogin({'token': 'tok-sindico', 'user': {'id': 2, 'name': 'Sid'}});
    await expectLater(updatePasswordSindicoApi('errada', 'Nova@1234'), throwsA(msg));
    expect(rotas.single, endsWith('/sindico/new-password'));
    expect(getToken(), 'tok-sindico');
  });

  test('funcionário: 401 da senha atual mostra a mensagem e mantém a sessão', () async {
    storageFuncionario({'token': 'tok-func', 'user': {'id': 3, 'nome': 'Rui'}});
    await expectLater(updatePasswordFuncionarioApi('errada', 'Nova@1234'), throwsA(msg));
    expect(rotas.single, endsWith('/funcionarios/new-password'));
    expect(getToken(), 'tok-func');
  });
}
