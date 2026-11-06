import 'dart:async';

import 'package:click/main.dart';
import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter_test/flutter_test.dart';

class _CofreMudo implements SecureStorageInterface {
  @override
  Future<void> write({required String key, required String? value}) async {}

  @override
  Future<String?> read({required String key}) => Completer<String?>().future;

  @override
  Future<void> delete({required String key}) async {}

  @override
  Future<Map<String, String>> readAll() async => {};
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('Keystore sem responder não prende a abertura', () async {
    SegredosSessao.armazenamento = _CofreMudo();

    await prepararAbertura(limite: const Duration(milliseconds: 50))
        .timeout(const Duration(seconds: 2));

    expect(getToken(), '');
  });
}
