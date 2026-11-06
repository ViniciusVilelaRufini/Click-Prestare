import 'dart:convert';
import 'dart:io';

import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:localstorage/localstorage.dart';

class _SeguroMemoria implements SecureStorageInterface {
  final Map<String, String> dados = {};

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      dados.remove(key);
    } else {
      dados[key] = value;
    }
  }

  @override
  Future<String?> read({required String key}) async => dados[key];

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

/// Com arquivo de verdade: nos demais testes o `localstorage` não tem caminho e
/// nunca grava, então a colisão entre gravações não aparecia.
///
/// Uma exceção não capturada dentro do `storageMorador` derruba o teste sozinha,
/// que é o que se via no logcat a cada login: "An async operation is currently
/// pending".
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory pasta;

  setUpAll(() async {
    pasta = await Directory.systemTemp.createTemp('click_user_data');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => pasta.path,
    );
    SegredosSessao.armazenamento = _SeguroMemoria();
    await ensureStorageReady();
  });

  Map<String, dynamic> noDisco() =>
      jsonDecode(File('${pasta.path}/user_data').readAsStringSync()) as Map<String, dynamic>;

  test('login grava tudo sem exceção e a chave recusada chega ao disco', () async {
    storageMorador({
      'token': 't',
      'user': {'id': 7, 'nome': 'Vinicius', 'photo': 'p.png'},
    });
    // Chega com a primeira gravação em curso, então o pacote a recusa.
    await Future<void>.delayed(Duration.zero);
    setUserPhoto('nova.png');

    await Future<void>.delayed(const Duration(milliseconds: 300));

    final salvo = noDisco();
    expect(salvo['id'], 7);
    expect(salvo['name'], 'Vinicius');
    expect(salvo['loginType'], 'morador');
    expect(salvo['photo'], 'nova.png');
  });

  test('logout logo após gravar não deixa o dado apagado voltar', () async {
    storageMorador({
      'token': 't',
      'user': {'id': 7, 'nome': 'Vinicius'},
    });
    await storageLogout();
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(noDisco().containsKey('name'), isFalse);
    expect(getUsername(), '');
  });

  test('cache pendente não vai para o disco depois do logout', () async {
    storageMorador({
      'token': 't',
      'user': {'id': 7, 'nome': 'Vinicius'},
    });
    saveCondCachePersistent(1, {'nome': 'pendente'});
    await storageLogout();
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(noDisco().containsKey('cond_cache_1'), isFalse);
  });

  test('resposta que chega sem sessão não grava cache', () async {
    await storageLogout();
    saveCondCachePersistent(2, {'nome': 'em voo'});
    await Future<void>.delayed(const Duration(milliseconds: 300));

    expect(noDisco().containsKey('cond_cache_2'), isFalse);
    expect(getCondCachePersistent(2), isNull);
  });

  // Fica por último: fecha o arquivo que os testes acima usam.
  group('disco com falha persistente', () {
    setUpAll(() => LocalStorage('user_data').dispose());

    test('logout termina e a regravação para no limite', () async {
      debugRegravacoes = 0;
      storageMorador({
        'token': 't',
        'user': {'id': 7, 'nome': 'Vinicius'},
      });

      await storageLogout().timeout(const Duration(seconds: 2));
      await Future<void>.delayed(const Duration(seconds: 3));
      final tentativas = debugRegravacoes;

      expect(tentativas, greaterThan(0));
      expect(tentativas, lessThanOrEqualTo(5));

      await Future<void>.delayed(const Duration(seconds: 2));
      expect(debugRegravacoes, tentativas, reason: 'o laço precisa ter parado');
    });

    test('cache volta a aceitar gravação depois da falha', () async {
      storageMorador({
        'token': 't',
        'user': {'id': 7, 'nome': 'Vinicius'},
      });
      saveCondCachePersistent(3, {'nome': 'a'});
      await Future<void>.delayed(const Duration(milliseconds: 300));
      debugRegravacoes = 0;
      saveCondCachePersistent(4, {'nome': 'b'});
      await Future<void>.delayed(const Duration(milliseconds: 500));

      expect(debugRegravacoes, greaterThan(0), reason: 'a segunda gravação não ficou presa na primeira');
      await Future<void>.delayed(const Duration(seconds: 2));
    });
  });
}
