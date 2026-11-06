import 'package:click/services/biometric_auth_service.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _CofreInstavel implements SecureStorageInterface {
  final Map<String, String> dados = {};
  bool falhar = true;

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value != null) dados[key] = value;
  }

  @override
  Future<String?> read({required String key}) async {
    if (falhar) throw Exception('keystore indisponível');
    return dados[key];
  }

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

/// A carga fica memorizada. Se a primeira leitura falhou e isso também ficasse,
/// o morador com sessão salva só voltaria a entrar reabrindo o app.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('falha no primeiro boot se recupera no registro de push seguinte', () async {
    final cofre = _CofreInstavel()..dados['token'] = 'token-salvo';
    SegredosSessao.armazenamento = cofre;
    String? enviado;
    ApiClient.client = MockClient((req) async {
      enviado = req.headers['Authorization'];
      return http.Response('{}', 200);
    });
    addTearDown(ApiClient.restaurarPadroes);

    await ensureStorageReady();
    expect(getToken(), '');

    cofre.falhar = false;
    await FirebaseService.instance.registrarNoServidor('fcm');

    expect(getToken(), 'token-salvo');
    expect(enviado, 'token-salvo');
  });

  test('com a leitura boa, a carga não se repete', () async {
    final cofre = _CofreInstavel()..falhar = false;
    SegredosSessao.armazenamento = cofre;
    await ensureStorageReady();

    cofre.falhar = true;
    cofre.dados['token'] = 'nao-devia-ler';
    await ensureStorageReady();

    expect(getToken(), 'token-salvo');
  });
}
