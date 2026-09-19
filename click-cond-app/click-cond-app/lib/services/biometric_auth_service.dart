import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

abstract class SecureStorageInterface {
  Future<void> write({required String key, required String? value});
  Future<String?> read({required String key});
  Future<void> delete({required String key});
  Future<Map<String, String>> readAll();
}

class DefaultSecureStorage implements SecureStorageInterface {
  final FlutterSecureStorage _storage;

  DefaultSecureStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock,
              ),
              aOptions: AndroidOptions(
                encryptedSharedPreferences: true,
              ),
            );

  @override
  Future<void> write({required String key, required String? value}) =>
      _storage.write(key: key, value: value);

  @override
  Future<String?> read({required String key}) => _storage.read(key: key);

  @override
  Future<void> delete({required String key}) => _storage.delete(key: key);

  @override
  Future<Map<String, String>> readAll() => _storage.readAll();
}

class BiometricAuthService {
  BiometricAuthService._internal({
    LocalAuthentication? localAuth,
    SecureStorageInterface? storage,
  })  : _localAuth = localAuth ?? LocalAuthentication(),
        _storage = storage ?? DefaultSecureStorage();

  static final BiometricAuthService instance = BiometricAuthService._internal();

  factory BiometricAuthService({
    LocalAuthentication? localAuth,
    SecureStorageInterface? storage,
  }) {
    return BiometricAuthService._internal(
      localAuth: localAuth,
      storage: storage,
    );
  }

  final LocalAuthentication _localAuth;
  final SecureStorageInterface _storage;

  static const String _keyPrefixLogin = 'bio_login_';
  static const String _keyPrefixPass = 'bio_password_';
  static const String _keyPrefixEnabled = 'bio_enabled_';

  /// Verifica se o dispositivo possui hardware biométrico configurado e disponível
  Future<bool> isBiometricAvailable() async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isSupported = await _localAuth.isDeviceSupported();
      return canCheck && isSupported;
    } on PlatformException catch (_) {
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Verifica se o Face ID específico está disponível
  Future<bool> isFaceIdSupported() async {
    try {
      final available = await _localAuth.getAvailableBiometrics();
      return available.contains(BiometricType.face);
    } catch (_) {
      return false;
    }
  }

  /// Rótulo apropriado para o tipo de biometria (Face ID no iPhone, Biometria no Android/outros)
  Future<String> getBiometricLabel() async {
    try {
      final available = await _localAuth.getAvailableBiometrics();
      if (available.contains(BiometricType.face)) {
        return 'Face ID';
      } else if (available.contains(BiometricType.fingerprint)) {
        return 'Touch ID';
      }
    } catch (_) {}
    return 'Face ID';
  }

  /// Solicita autenticação biométrica do usuário
  Future<bool> authenticate({String? reason}) async {
    try {
      return await _localAuth.authenticate(
        localizedReason:
            reason ?? 'Autentique-se com Face ID para entrar na sua conta',
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } on PlatformException catch (_) {
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Salva as credenciais no Keychain de forma segura para o perfil especificado
  Future<void> saveCredentials({
    required String loginType,
    required String login,
    required String password,
  }) async {
    final cleanLogin = login.trim();
    final cleanPassword = password.trim();
    if (cleanLogin.isEmpty || cleanPassword.isEmpty) return;

    await _storage.write(key: '$_keyPrefixLogin$loginType', value: cleanLogin);
    await _storage.write(key: '$_keyPrefixPass$loginType', value: cleanPassword);
    await _storage.write(key: '$_keyPrefixEnabled$loginType', value: 'true');
  }

  /// Recupera as credenciais salvas para o perfil especificado
  Future<Map<String, String>?> getSavedCredentials(String loginType) async {
    try {
      final isEnabled = await _storage.read(key: '$_keyPrefixEnabled$loginType');
      if (isEnabled != 'true') return null;

      final login = await _storage.read(key: '$_keyPrefixLogin$loginType');
      final password = await _storage.read(key: '$_keyPrefixPass$loginType');

      if (login != null &&
          login.isNotEmpty &&
          password != null &&
          password.isNotEmpty) {
        return {
          'login': login,
          'password': password,
        };
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Retorna se há credenciais salvas e ativas para este perfil
  Future<bool> hasSavedCredentials(String loginType) async {
    final creds = await getSavedCredentials(loginType);
    return creds != null;
  }

  /// Remove as credenciais salvas do Keychain para o perfil
  Future<void> clearCredentials(String loginType) async {
    await _storage.delete(key: '$_keyPrefixLogin$loginType');
    await _storage.delete(key: '$_keyPrefixPass$loginType');
    await _storage.delete(key: '$_keyPrefixEnabled$loginType');
  }

  /// Atualiza as credenciais no Keychain se o usuário já possuir Face ID ativado
  /// para este perfil e os valores tiverem mudado (ex: trocou de senha ou login).
  /// Retorna `true` se houve atualização, ou `false` caso contrário.
  Future<bool> updateCredentialsIfChanged({
    required String loginType,
    required String login,
    required String password,
  }) async {
    final current = await getSavedCredentials(loginType);
    if (current == null) return false;

    final cleanLogin = login.trim();
    final cleanPassword = password.trim();
    if (cleanLogin.isEmpty || cleanPassword.isEmpty) return false;

    if (current['login'] != cleanLogin || current['password'] != cleanPassword) {
      await saveCredentials(
        loginType: loginType,
        login: cleanLogin,
        password: cleanPassword,
      );
      return true;
    }
    return false;
  }
}
