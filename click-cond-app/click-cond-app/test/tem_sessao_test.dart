import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter_test/flutter_test.dart';

class _Memoria implements SecureStorageInterface {
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

/// As recargas de tela disparadas por `.then` rodam também depois do "Sair";
/// temSessao() é o que impede a chamada sem token (401) e o diálogo de erro.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SegredosSessao.armazenamento = _Memoria();
  });

  test('sem token não há sessão', () async {
    await SegredosSessao.apagar('token');
    expect(temSessao(), isFalse);
  });

  test('com token há sessão', () async {
    await SegredosSessao.gravar('token', 'abc');
    expect(temSessao(), isTrue);
  });

  test('o token some no mesmo instante em que o logout é chamado, sem esperar', () async {
    await SegredosSessao.gravar('token', 'abc');
    expect(temSessao(), isTrue);
    final saindo = storageLogout(); // sem await: é o que as telas fazem
    expect(temSessao(), isFalse);
    await saindo;
  });
}
