import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter_test/flutter_test.dart';

/// O token da sessão (válido por 365 dias) e o token de "dispositivo
/// confiável" do MFA ficavam no `localstorage`: um JSON em texto puro nos
/// documentos do app, que o Android copiava para o backup do Google. Agora
/// vivem no armazenamento seguro (Keystore/Keychain), com cache em memória
/// para o getToken() continuar síncrono.
class _SeguroFalso implements SecureStorageInterface {
  final Map<String, String> dados = {};
  bool falharEscrita = false;

  @override
  Future<void> write({required String key, required String? value}) async {
    if (falharEscrita) throw Exception('keystore indisponível');
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

void main() {
  late _SeguroFalso seguro;
  late Map<String, dynamic> legado;

  setUp(() async {
    seguro = _SeguroFalso();
    legado = {};
    SegredosSessao.armazenamento = seguro;
    SegredosSessao.legado = LegadoSessao(
      ler: (k) => legado[k],
      gravar: (k, v) async => legado[k] = v,
      apagar: (k) async => legado.remove(k),
    );
    await SegredosSessao.carregar();
  });

  test('migra o token do armazenamento antigo e apaga a cópia em texto puro', () async {
    legado['token'] = 'token-antigo';
    legado['sindico_device_token'] = 'device-antigo';

    await SegredosSessao.carregar();

    expect(SegredosSessao.ler('token'), 'token-antigo');
    expect(SegredosSessao.ler('sindico_device_token'), 'device-antigo');
    expect(seguro.dados['token'], 'token-antigo');
    expect(legado.containsKey('token'), isFalse);
    expect(legado.containsKey('sindico_device_token'), isFalse);
  });

  test('gravar fica disponível na hora e vai para o armazenamento seguro', () async {
    await SegredosSessao.gravar('token', 't1');

    expect(SegredosSessao.ler('token'), 't1');
    expect(seguro.dados['token'], 't1');
    expect(legado.containsKey('token'), isFalse);
  });

  test('gravar null apaga a sessão', () async {
    await SegredosSessao.gravar('token', 't1');
    await SegredosSessao.gravar('token', null);

    expect(SegredosSessao.ler('token'), '');
    expect(seguro.dados.containsKey('token'), isFalse);
  });

  test('apagar remove do cache e do armazenamento seguro', () async {
    await SegredosSessao.gravar('token', 't1');
    await SegredosSessao.apagar('token');

    expect(SegredosSessao.ler('token'), '');
    expect(seguro.dados.containsKey('token'), isFalse);
  });

  test('se o Keystore falhar, o usuário continua logado (fica no armazenamento antigo)', () async {
    seguro.falharEscrita = true;

    await SegredosSessao.gravar('token', 't2');

    expect(SegredosSessao.ler('token'), 't2');
    expect(legado['token'], 't2');

    // No próximo boot o valor ainda é encontrado.
    await SegredosSessao.carregar();
    expect(SegredosSessao.ler('token'), 't2');
  });

  test('valor "null" gravado como texto pelo código antigo não vira sessão', () async {
    legado['token'] = 'null';
    await SegredosSessao.carregar();
    expect(SegredosSessao.ler('token'), '');
  });
}
