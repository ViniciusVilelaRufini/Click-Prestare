import 'package:flutter_test/flutter_test.dart';
import 'package:click/services/biometric_auth_service.dart';

class FakeSecureStorage implements SecureStorageInterface {
  final Map<String, String> _data = {};

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      _data.remove(key);
    } else {
      _data[key] = value;
    }
  }

  @override
  Future<String?> read({required String key}) async {
    return _data[key];
  }

  @override
  Future<void> delete({required String key}) async {
    _data.remove(key);
  }

  @override
  Future<Map<String, String>> readAll() async {
    return Map.from(_data);
  }
}

void main() {
  late FakeSecureStorage fakeStorage;
  late BiometricAuthService service;

  setUp(() {
    fakeStorage = FakeSecureStorage();
    service = BiometricAuthService(storage: fakeStorage);
  });

  group('BiometricAuthService - Gestão de Credenciais', () {
    test('retorna null se não houver credenciais salvas', () async {
      final creds = await service.getSavedCredentials('sindico');
      expect(creds, isNull);
      expect(await service.hasSavedCredentials('sindico'), isFalse);
    });

    test('salva e recupera credenciais para síndico', () async {
      await service.saveCredentials(
        loginType: 'sindico',
        login: 'sindico@predio.com',
        password: 'senhaSegura123',
      );

      expect(await service.hasSavedCredentials('sindico'), isTrue);
      final creds = await service.getSavedCredentials('sindico');
      expect(creds, isNotNull);
      expect(creds!['login'], 'sindico@predio.com');
      expect(creds['password'], 'senhaSegura123');
    });

    test('salva credenciais isoladas por perfil (morador, sindico, funcionario)', () async {
      await service.saveCredentials(
        loginType: 'morador',
        login: 'morador@apto101.com',
        password: 'senhaMorador',
      );
      await service.saveCredentials(
        loginType: 'funcionario',
        login: 'porteiro@predio.com',
        password: 'senhaPorteiro',
      );

      final credsMorador = await service.getSavedCredentials('morador');
      final credsPorteiro = await service.getSavedCredentials('funcionario');
      final credsSindico = await service.getSavedCredentials('sindico');

      expect(credsMorador!['login'], 'morador@apto101.com');
      expect(credsPorteiro!['login'], 'porteiro@predio.com');
      expect(credsSindico, isNull);
    });

    test('limpa credenciais salvas de um perfil específico', () async {
      await service.saveCredentials(
        loginType: 'morador',
        login: 'morador@apto101.com',
        password: 'senhaMorador',
      );

      expect(await service.hasSavedCredentials('morador'), isTrue);

      await service.clearCredentials('morador');

      expect(await service.hasSavedCredentials('morador'), isFalse);
      expect(await service.getSavedCredentials('morador'), isNull);
    });

    test('não salva credenciais com campos vazios', () async {
      await service.saveCredentials(
        loginType: 'sindico',
        login: '  ',
        password: '123',
      );
      expect(await service.hasSavedCredentials('sindico'), isFalse);

      await service.saveCredentials(
        loginType: 'sindico',
        login: 'user@test.com',
        password: '',
      );
      expect(await service.hasSavedCredentials('sindico'), isFalse);
    });
  });
}
