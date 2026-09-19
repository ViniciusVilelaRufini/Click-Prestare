import 'package:flutter_test/flutter_test.dart';
import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/local_storage.dart';

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
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeSecureStorage fakeStorage;
  late BiometricAuthService service;

  setUp(() {
    fakeStorage = FakeSecureStorage();
    service = BiometricAuthService(storage: fakeStorage);
  });

  group('Frente 2 TDD: Face ID e Credenciais no Keychain para Morador, Síndico e Portaria', () {
    test('salva e recupera credenciais de Morador com CPF ou E-mail', () async {
      await service.saveCredentials(
        loginType: 'morador',
        login: '123.456.789-00',
        password: 'senhaMorador123',
      );

      expect(await service.hasSavedCredentials('morador'), isTrue);
      final creds = await service.getSavedCredentials('morador');
      expect(creds, isNotNull);
      expect(creds!['login'], '123.456.789-00');
      expect(creds['password'], 'senhaMorador123');
    });

    test('salva e recupera credenciais de Portaria/Funcionário', () async {
      await service.saveCredentials(
        loginType: 'funcionario',
        login: 'porteiro_noite',
        password: 'senhaPortaria789',
      );

      expect(await service.hasSavedCredentials('funcionario'), isTrue);
      final creds = await service.getSavedCredentials('funcionario');
      expect(creds, isNotNull);
      expect(creds!['login'], 'porteiro_noite');
      expect(creds['password'], 'senhaPortaria789');
    });

    test('salva e recupera credenciais de Síndico', () async {
      await service.saveCredentials(
        loginType: 'sindico',
        login: 'sindico@condominio.com',
        password: 'senhaSindico456',
      );

      expect(await service.hasSavedCredentials('sindico'), isTrue);
      final creds = await service.getSavedCredentials('sindico');
      expect(creds, isNotNull);
      expect(creds!['login'], 'sindico@condominio.com');
      expect(creds['password'], 'senhaSindico456');
    });

    test('isolamento completo: salvar morador não afeta síndico ou portaria', () async {
      await service.saveCredentials(
        loginType: 'morador',
        login: 'morador@teste.com',
        password: 'passMorador',
      );
      await service.saveCredentials(
        loginType: 'sindico',
        login: 'sindico@teste.com',
        password: 'passSindico',
      );
      await service.saveCredentials(
        loginType: 'funcionario',
        login: 'porteiro@teste.com',
        password: 'passFuncionario',
      );

      final morador = await service.getSavedCredentials('morador');
      final sindico = await service.getSavedCredentials('sindico');
      final portaria = await service.getSavedCredentials('funcionario');

      expect(morador!['login'], 'morador@teste.com');
      expect(sindico!['login'], 'sindico@teste.com');
      expect(portaria!['login'], 'porteiro@teste.com');

      // Limpar morador não apaga sindico nem portaria
      await service.clearCredentials('morador');
      expect(await service.hasSavedCredentials('morador'), isFalse);
      expect(await service.hasSavedCredentials('sindico'), isTrue);
      expect(await service.hasSavedCredentials('funcionario'), isTrue);
    });

    test('logout preserva credenciais do Keychain para permitir Face ID no próximo acesso', () async {
      await service.saveCredentials(
        loginType: 'morador',
        login: 'morador_persistente@teste.com',
        password: 'senhaPersistente',
      );

      await storageLogout();

      // Keychain ainda guarda as credenciais mesmo após o storage da sessão ser deslogado
      expect(await service.hasSavedCredentials('morador'), isTrue);
      final creds = await service.getSavedCredentials('morador');
      expect(creds!['login'], 'morador_persistente@teste.com');
    });

    test('updateCredentialsIfChanged atualiza automaticamente a senha alterada no Keychain', () async {
      // Estado inicial: morador salva senha antiga
      await service.saveCredentials(
        loginType: 'morador',
        login: 'morador@teste.com',
        password: 'senhaAntiga123',
      );

      // Usuário faz login manual digitando senha nova: deve atualizar automaticamente
      final atualizado = await service.updateCredentialsIfChanged(
        loginType: 'morador',
        login: 'morador@teste.com',
        password: 'senhaNovaModificada456',
      );

      expect(atualizado, isTrue);
      final creds = await service.getSavedCredentials('morador');
      expect(creds!['password'], 'senhaNovaModificada456');
    });

    test('updateCredentialsIfChanged não sobrescreve se nada tiver mudado', () async {
      await service.saveCredentials(
        loginType: 'sindico',
        login: 'sindico@teste.com',
        password: 'mesmaSenha123',
      );

      final atualizado = await service.updateCredentialsIfChanged(
        loginType: 'sindico',
        login: 'sindico@teste.com',
        password: 'mesmaSenha123',
      );

      expect(atualizado, isFalse);
    });

    test('updateCredentialsIfChanged não cria credencial se o usuário não tiver Face ID ativado antes', () async {
      final atualizado = await service.updateCredentialsIfChanged(
        loginType: 'funcionario',
        login: 'porteiro_novo',
        password: 'senhaQualquer',
      );

      // Se não havia credencial salva/ativada previamente, não deve salvar silenciosamente
      expect(atualizado, isFalse);
      expect(await service.hasSavedCredentials('funcionario'), isFalse);
    });
  });
}
