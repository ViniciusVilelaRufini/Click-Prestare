import 'dart:io';

import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _Seguro implements SecureStorageInterface {
  final Map<String, String> dados = {};

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value != null) dados[key] = value;
  }

  @override
  Future<String?> read({required String key}) async => dados[key];

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

/// Arquivo corrompido prova que os dados se perderam. Erro ao abrir o arquivo
/// não prova nada: apagar o token aí derrubaria uma sessão boa por um soluço do
/// disco. Um diretório no lugar do arquivo faz a abertura falhar de verdade.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('erro de E/S ao ler user_data não apaga o token salvo', () async {
    final pasta = await Directory.systemTemp.createTemp('click_es');
    Directory('${pasta.path}/user_data').createSync();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => pasta.path,
    );
    final seguro = _Seguro()..dados['token'] = 'token-salvo';
    SegredosSessao.armazenamento = seguro;

    await ensureStorageReady().timeout(const Duration(seconds: 5));

    expect(getToken(), 'token-salvo');
    expect(seguro.dados['token'], 'token-salvo');
  });
}
