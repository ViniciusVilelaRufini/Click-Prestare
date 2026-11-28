import 'dart:convert';

import 'package:click/services/biometric_auth_service.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/services/interfone/token_voip.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Cofre implements SecureStorageInterface {
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final voipOriginal = FirebaseService.instance.obterTokenVoip;
  final sessaoCardOriginal = FirebaseService.instance.definirSessaoCard;
  late List<Map<String, dynamic>> corpos;

  setUp(() async {
    SegredosSessao.armazenamento = _Cofre();
    await ensureStorageReady();
    storageMorador({
      'token': 'sessao',
      'user': {'id': 1, 'nome': 'Ana'},
    });
    corpos = [];
    ApiClient.client = MockClient((r) async {
      if (r.url.path.endsWith('/update-fcm-token')) {
        corpos.add(jsonDecode(r.body) as Map<String, dynamic>);
      }
      return http.Response('{}', 200);
    });
    FirebaseService.instance.definirSessaoCard = (_, __) async {};
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    FirebaseService.instance
      ..obterTokenVoip = voipOriginal
      ..definirSessaoCard = sessaoCardOriginal;
    await storageLogout();
  });

  test('registro manda interfone_versao 1 e o token VoIP quando há', () async {
    FirebaseService.instance.obterTokenVoip = () async => 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
    await FirebaseService.instance.registrarNoServidor('fcm-1');
    expect(corpos.single['interfone_versao'], 1);
    expect(corpos.single['voip_token'], 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(corpos.single['fcm_token'], 'fcm-1');
    expect(corpos.single['card_versao'], 2);
  });

  test('sem token VoIP (Android) manda só a versão', () async {
    FirebaseService.instance.obterTokenVoip = () async => null;
    await FirebaseService.instance.registrarNoServidor('fcm-1');
    expect(corpos.single['interfone_versao'], 1);
    expect(corpos.single.containsKey('voip_token'), isFalse);
  });

  test('falha ao ler o token VoIP não impede o registro', () async {
    FirebaseService.instance.obterTokenVoip = () async => throw Exception('canal');
    await FirebaseService.instance.registrarNoServidor('fcm-1');
    expect(corpos.single['interfone_versao'], 1);
    expect(corpos.single.containsKey('voip_token'), isFalse);
  });

  test('iPhone sem token VoIP manda interfone_versao 0; com token, 1', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    FirebaseService.instance.obterTokenVoip = () async => null;
    await FirebaseService.instance.registrarNoServidor('fcm-1');
    expect(corpos.last['interfone_versao'], 0);
    expect(corpos.last.containsKey('voip_token'), isFalse);

    FirebaseService.instance.obterTokenVoip = () async => 'abcdef0123456789';
    await FirebaseService.instance.registrarNoServidor('fcm-1');
    expect(corpos.last['interfone_versao'], 1);
    expect(corpos.last['voip_token'], 'abcdef0123456789');
  });

  test('versaoDoInterfone', () {
    expect(versaoDoInterfone(ios: false, voipToken: null), 1);
    expect(versaoDoInterfone(ios: true, voipToken: null), 0);
    expect(versaoDoInterfone(ios: true, voipToken: 'abcdef0123456789'), 1);
  });

  test('tokenVoipValido aceita só hex de 16 a 200', () {
    expect(tokenVoipValido('abcdef0123456789'), 'abcdef0123456789');
    expect(tokenVoipValido(''), isNull);
    expect(tokenVoipValido(null), isNull);
    expect(tokenVoipValido('abc'), isNull);
    expect(tokenVoipValido('xyz0123456789abcdef'), isNull);
    expect(tokenVoipValido('a' * 201), isNull);
  });
}
