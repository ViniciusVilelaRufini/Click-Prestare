import 'dart:async';
import 'dart:convert';

import 'package:click/pages/perfil_choice.dart';
import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/pages/sindico/list_condominiums.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/router.dart';
import 'package:click/services/biometric_auth_service.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/cond_cache.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Sessão perdida logo depois de um login (e 401 sem motivo com o app aberto).
///
/// Visto no emulador: a recarga do armazenamento seguro esvaziava o cache do
/// token. A lista de condomínios abria nessa janela, navegava em pleno build
/// (Navigator travado para sempre) e seus requests saíam sem Authorization; o
/// 401 deles encerrava a sessão recém-criada.

/// Armazenamento seguro com leitura que só termina quando o teste manda, para
/// segurar aberto o intervalo de uma leitura real no Keystore.
class _SeguroLento implements SecureStorageInterface {
  final Map<String, String> dados = {};
  Completer<void>? portao;
  int leituras = 0;

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      dados.remove(key);
    } else {
      dados[key] = value;
    }
  }

  @override
  Future<String?> read({required String key}) async {
    leituras++;
    // O valor sai do cofre antes da espera, como numa leitura real em curso.
    final lido = dados[key];
    final p = portao;
    if (p != null) await p.future;
    return lido;
  }

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

Map<String, dynamic> _loginDe(String token) => {
      'token': token,
      'user': {'id': 1, 'nome': 'Vinicius'},
    };

const _msgExpirou = 'Sua sessão expirou. Faça login novamente.';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _SeguroLento seguro;
  final obterOriginal = FirebaseService.instance.obterTokenFcm;
  final apagarOriginal = FirebaseService.instance.apagarTokenFcm;

  setUp(() async {
    PackageInfo.setMockInitialValues(
      appName: 'click',
      packageName: 'click',
      version: '1',
      buildNumber: '1',
      buildSignature: '',
    );
    // Câmera e notificação já concedidas: o _init da HomePage segue direto.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('flutter.baseflow.com/permissions/methods'),
      (_) async => 1,
    );
    seguro = _SeguroLento();
    SegredosSessao.armazenamento = seguro;
    await ensureStorageReady();
  });

  tearDown(() async {
    seguro.portao = null;
    ApiClient.restaurarPadroes();
    await storageLogout();
    FirebaseService.instance
      ..limiteFcm = const Duration(seconds: 15)
      ..obterTokenFcm = obterOriginal
      ..apagarTokenFcm = apagarOriginal;
  });

  Future<void> abrirAte(WidgetTester tester, Type tela) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(find.byType(tela), findsOneWidget);
  }

  testWidgets('login com recarga do cofre em curso abre a home com dados', (tester) async {
    final enviados = <String, String?>{};
    final consentimento = Completer<void>();
    ApiClient.client = MockClient((req) async {
      enviados[req.url.path.replaceFirst('/api', '')] = req.headers['Authorization'];
      if (req.url.path.endsWith('/consentimentos/pendentes')) {
        await consentimento.future;
        return http.Response(jsonEncode({'precisaAceitar': false}), 200);
      }
      if (req.headers['Authorization'] == null) {
        return http.Response('{"message":"Unauthorized"}', 401);
      }
      if (req.url.path.contains('dashboard/summary') || req.url.path.contains('moradores/get')) {
        return http.Response('{}', 200);
      }
      return http.Response('[]', 200);
    });

    storageMorador(_loginDe('token-novo'));
    await tester.pump();

    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      onGenerateRoute: RouterGenerator.generateRouter,
    ));
    // HomePage._init → auto-login → PortaDeEntrada, à espera de /consentimentos.
    await abrirAte(tester, PortaDeEntrada);

    // Uma recarga em curso, com a leitura do Keystore ainda sem resposta.
    seguro.portao = Completer<void>();
    unawaited(SegredosSessao.carregar());
    await tester.pump();
    expect(getToken(), 'token-novo', reason: 'recarregar o cofre não pode esvaziar a sessão');

    // /consentimentos responde durante a leitura: a lista de condomínios abre.
    consentimento.complete();
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    seguro.portao!.complete();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();

    expect(enviados['/notificacoes/get-all'], 'token-novo',
        reason: 'request logo depois do login precisa levar o token');
    expect(getToken(), 'token-novo');
    expect(find.byType(ListCondomiums), findsOneWidget);
    expect(find.text(_msgExpirou), findsNothing);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('lista aberta sem token volta para o início sem travar o Navigator', (tester) async {
    final consentimento = Completer<void>();
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/consentimentos/pendentes')) {
        await consentimento.future;
        return http.Response(jsonEncode({'precisaAceitar': false}), 200);
      }
      return http.Response('[]', 200);
    });

    storageMorador(_loginDe('token-novo'));
    await tester.pump();
    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      onGenerateRoute: RouterGenerator.generateRouter,
    ));
    await abrirAte(tester, PortaDeEntrada);

    // A sessão acabou enquanto a checagem de consentimento estava no ar.
    unawaited(SegredosSessao.apagar('token'));
    consentimento.complete();
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(HomePage), findsOneWidget);
    expect(find.byType(ListCondomiums), findsNothing);
    expect(tester.takeException(), isNull);

    // O Navigator segue funcionando.
    NavigationService.navigatorKey.currentState!.push(
      MaterialPageRoute(builder: (_) => const Scaffold(body: Text('depois'))),
    );
    await tester.pumpAndSettle();
    expect(find.text('depois'), findsOneWidget);
  });

  test('registrar o push não recarrega o cofre nem esvazia o token', () async {
    ApiClient.client = MockClient((_) async => http.Response('{}', 200));
    storageMorador(_loginDe('token-novo'));
    final leiturasAntes = seguro.leituras;
    seguro.portao = Completer<void>();

    unawaited(FirebaseService.instance.registrarNoServidor('fcm-novo'));
    await Future<void>.delayed(const Duration(milliseconds: 5));

    expect(getToken(), 'token-novo');
    expect(seguro.leituras, leiturasAntes);
    seguro.portao!.complete();
  });

  test('logout encerra a sessão antes da rede e não apaga o login seguinte', () async {
    final remocao = Completer<void>();
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/users/remove-fcm-token')) await remocao.future;
      return http.Response('{}', 200);
    });
    storageMorador(_loginDe('token-velho'));

    final saindo = storageLogout();
    await Future<void>.delayed(const Duration(milliseconds: 5));
    expect(getToken(), '', reason: 'a HomePage do 401 não pode entrar sozinha com o token morto');

    storageMorador(_loginDe('token-novo'));
    remocao.complete();
    await saindo;

    expect(getToken(), 'token-novo');
    expect(getUsername(), 'Vinicius');
    expect(seguro.dados['token'], 'token-novo');
  });

  test('o logout avisa o servidor com o token da sessão que saiu', () async {
    String? usado;
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/users/remove-fcm-token')) usado = req.headers['Authorization'];
      return http.Response('{}', 200);
    });
    storageMorador(_loginDe('token-velho'));
    await storageLogout();
    expect(usado, 'token-velho');
  });

  testWidgets('401 atrasado de outra sessão não derruba o login novo', (tester) async {
    final resposta = Completer<http.Response>();
    ApiClient.client = MockClient((_) => resposta.future);
    storageMorador(_loginDe('token-velho'));
    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      home: const Scaffold(body: Text('tela')),
    ));

    final emVoo = ApiClient.get(Uri.parse('https://exemplo.test/visitantes/get-all'));
    await tester.pump();
    storageMorador(_loginDe('token-novo'));
    resposta.complete(http.Response('{}', 401));
    await emVoo;
    await tester.pump();

    expect(getToken(), 'token-novo');
    expect(find.text(_msgExpirou), findsNothing);
    expect(find.text('tela'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('401 da sessão atual continua encerrando a sessão', (tester) async {
    ApiClient.client = MockClient((_) async => http.Response('{}', 401));
    storageMorador(_loginDe('token-atual'));
    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      onGenerateRoute: (s) => s.name == '/'
          ? MaterialPageRoute(settings: s, builder: (_) => const Scaffold(body: Text('raiz')))
          : null,
    ));

    await ApiClient.get(Uri.parse('https://exemplo.test/visitantes/get-all'));
    await tester.pump();
    await tester.pump();

    expect(find.text(_msgExpirou), findsOneWidget);
    await tester.pump(const Duration(seconds: 7));
    expect(getToken(), '');
  });

  group('401 sem credencial', () {
    testWidgets('sem sessão, não navega nem avisa de expiração', (tester) async {
      var raizes = 0;
      ApiClient.client = MockClient((_) async => http.Response('{}', 401));
      await tester.pumpWidget(MaterialApp(
        navigatorKey: NavigationService.navigatorKey,
        onGenerateRoute: (s) {
          raizes++;
          return MaterialPageRoute(settings: s, builder: (_) => const Scaffold(body: Text('raiz')));
        },
      ));
      final antes = raizes;

      await ApiClient.get(Uri.parse('https://exemplo.test/x'));
      await tester.pump();
      await tester.pump();

      expect(raizes, antes);
      expect(find.text(_msgExpirou), findsNothing);
    });

    testWidgets('request sem header não derruba a sessão que existe', (tester) async {
      final resposta = Completer<http.Response>();
      ApiClient.client = MockClient((_) => resposta.future);
      storageMorador(_loginDe('token-bom'));
      await tester.pumpWidget(MaterialApp(
        navigatorKey: NavigationService.navigatorKey,
        home: const Scaffold(body: Text('tela')),
      ));

      ApiClient.tokenProvider = () => '';
      final emVoo = ApiClient.get(Uri.parse('https://exemplo.test/x'));
      await tester.pump();
      ApiClient.tokenProvider = getToken;
      resposta.complete(http.Response('{}', 401));
      await emVoo;
      await tester.pump();

      expect(getToken(), 'token-bom');
      expect(find.text(_msgExpirou), findsNothing);
    });
  });

  testWidgets('vários 401 juntos navegam e avisam uma vez só', (tester) async {
    var raizes = 0;
    ApiClient.client = MockClient((_) async => http.Response('{}', 401));
    storageMorador(_loginDe('token-atual'));
    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      onGenerateRoute: (s) {
        raizes++;
        return MaterialPageRoute(settings: s, builder: (_) => const Scaffold(body: Text('raiz')));
      },
    ));
    final antes = raizes;

    await Future.wait([
      ApiClient.get(Uri.parse('https://exemplo.test/a')),
      ApiClient.get(Uri.parse('https://exemplo.test/b')),
      ApiClient.get(Uri.parse('https://exemplo.test/c')),
    ]);
    await tester.pump();
    await tester.pump();

    expect(raizes, antes + 1);
    expect(find.text(_msgExpirou), findsOneWidget);
    await tester.pump(const Duration(seconds: 7));
  });

  testWidgets('401 com o app parado agenda o frame que leva ao login', (tester) async {
    ApiClient.client = MockClient((_) async => http.Response('{}', 401));
    storageMorador(_loginDe('token-atual'));
    await tester.pumpWidget(MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      home: const Scaffold(body: Text('tela')),
    ));
    await tester.pumpAndSettle();
    expect(tester.binding.hasScheduledFrame, isFalse);

    await ApiClient.get(Uri.parse('https://exemplo.test/a'));

    expect(tester.binding.hasScheduledFrame, isTrue);
    await tester.pump();
    await tester.pump(const Duration(seconds: 7));
  });

  group('logout e o token de push', () {
    late List<String> chamadas;

    setUp(() {
      chamadas = [];
      FirebaseService.instance
        ..obterTokenFcm = (() async => 'fcm')
        ..apagarTokenFcm = (() async => chamadas.add('deleteToken'));
      ApiClient.client = MockClient((req) async {
        chamadas.add(req.url.path.split('/').last);
        return http.Response('{}', 200);
      });
    });

    test('logout normal remove no servidor e no aparelho', () async {
      storageMorador(_loginDe('token-velho'));
      await storageLogout();
      expect(chamadas, ['remove-fcm-token', 'deleteToken']);
    });

    test('login durante o logout mantém o push da sessão nova', () async {
      storageMorador(_loginDe('token-velho'));
      final saindo = storageLogout();
      storageMorador(_loginDe('token-novo'));
      await saindo;
      expect(chamadas, isEmpty);
      expect(getToken(), 'token-novo');
    });

    test('Sair sem esperar: a sessão local já acabou quando a tela navega', () async {
      storageMorador(_loginDe('token-velho'));
      final saindo = storageLogout();
      expect(getToken(), '');
      expect(getUsername(), '');
      await saindo;
    });

    test('registro do login novo espera o deleteToken em curso', () async {
      final apagando = Completer<void>();
      var pedidos = 0;
      FirebaseService.instance
        ..apagarTokenFcm = (() => apagando.future)
        ..obterTokenFcm = (() async {
          pedidos++;
          return 'fcm';
        });
      storageMorador(_loginDe('token-velho'));
      final saindo = storageLogout();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      final antes = pedidos;

      storageMorador(_loginDe('token-novo'));
      final registrando = FirebaseService.instance.registrarNoServidor();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(pedidos, antes, reason: 'o token pedido agora morreria com o delete em curso');

      apagando.complete();
      await saindo;
      await registrando;
      expect(pedidos, antes + 1);
      expect(chamadas.last, 'update-fcm-token');
    });

    test('login enquanto o aviso ao servidor está no ar não apaga o token do aparelho', () async {
      final aviso = Completer<void>();
      ApiClient.client = MockClient((_) async {
        await aviso.future;
        return http.Response('{}', 200);
      });
      storageMorador(_loginDe('token-velho'));
      final saindo = storageLogout();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      storageMorador(_loginDe('token-novo'));
      aviso.complete();
      await saindo;
      expect(chamadas, isEmpty);
    });
  });

  group('FCM sem resposta', () {
    setUp(() {
      FirebaseService.instance
        ..limiteFcm = const Duration(milliseconds: 10)
        ..obterTokenFcm = (() => Completer<String?>().future)
        ..apagarTokenFcm = (() => Completer<void>().future);
      ApiClient.client = MockClient((_) async => http.Response('{}', 200));
    });

    test('não segura o login', () async {
      storageMorador(_loginDe('t'));
      await FirebaseService.instance
          .registrarNoServidor()
          .timeout(const Duration(seconds: 2));
    });

    test('não segura o Sair', () async {
      storageMorador(_loginDe('t'));
      await storageLogout().timeout(const Duration(seconds: 2));
      expect(getToken(), '');
    });
  });

  group('resposta atrasada de uma sessão que saiu', () {
    Map<String, dynamic> condominio() => {
          'id': 5,
          'nome': 'Da sessão velha',
          'saldo': '1',
        };

    testWidgets('a lista não preenche o cache da sessão nova', (tester) async {
      final lista = Completer<void>();
      ApiClient.client = MockClient((req) async {
        if (req.url.path.endsWith('/moradores/list-condominios')) {
          await lista.future;
          return http.Response(jsonEncode([condominio()]), 200);
        }
        if (req.url.path.contains('dashboard/summary') || req.url.path.contains('moradores/get')) {
          return http.Response('{}', 200);
        }
        return http.Response('[]', 200);
      });
      storageMorador(_loginDe('token-velho'));
      await tester.pumpWidget(const MaterialApp(home: ListCondomiums()));
      await tester.pump();

      await storageLogout();
      storageMorador(_loginDe('token-novo'));
      lista.complete();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      expect(CondCache.get(5), isNull);
      expect(find.text('Da sessão velha'), findsNothing);
    });

    testWidgets('a tela do condomínio não preenche o cache da sessão nova', (tester) async {
      final cond = Completer<void>();
      ApiClient.client = MockClient((req) async {
        if (req.url.path.contains('dashboard/summary')) return http.Response('{}', 200);
        if (req.url.path.contains('pendentes')) return http.Response('[]', 200);
        if (req.url.path.contains('fcm-token')) return http.Response('{}', 200);
        await cond.future;
        return http.Response(jsonEncode(condominio()), 200);
      });
      storageMorador(_loginDe('token-velho'));
      await tester.pumpWidget(const MaterialApp(home: MyCondominium(id: 5)));
      await tester.pump();

      await storageLogout();
      storageMorador(_loginDe('token-novo'));
      cond.complete();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      expect(CondCache.get(5), isNull);
    });
  });
}
