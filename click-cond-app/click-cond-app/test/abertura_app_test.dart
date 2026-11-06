import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:click/main.dart';
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

/// A abertura espera o armazenamento antes de sair do spinner: se ela lança ou
/// não termina, o app nunca abre, em nenhuma tentativa.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('JSON corrompido nos dois arquivos não prende a abertura', () async {
    final pasta = await Directory.systemTemp.createTemp('click_corrompido');
    File('${pasta.path}/user_data').writeAsStringSync('{"name": "Vin');
    File('${pasta.path}/user_config').writeAsStringSync('nem json');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => pasta.path,
    );
    final seguro = _Seguro()..dados['token'] = 'token-salvo';
    SegredosSessao.armazenamento = seguro;

    await prepararAbertura().timeout(const Duration(seconds: 5));

    // Sem nome nem tipo de login não há sessão utilizável: pede login de novo.
    expect(getToken(), '');
    expect(seguro.dados.containsKey('token'), isFalse);

    // O login seguinte reescreve o arquivo com JSON válido.
    storageMorador({
      'token': 'novo',
      'user': {'id': 1, 'nome': 'Vinicius'},
    });
    await Future<void>.delayed(const Duration(milliseconds: 300));
    final salvo = jsonDecode(File('${pasta.path}/user_data').readAsStringSync());
    expect(salvo['name'], 'Vinicius');
  });
}
