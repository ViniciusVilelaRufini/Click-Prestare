import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:click/services/card_ao_vivo/link_card.dart';
import 'package:click/pages/auth/redefinir_senha_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/router.dart';
import 'package:click/theme/app_theme.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/localstorage_config.dart';
import 'package:click/utils/log.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/widgets/app/prestare_splash_animation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'package:click/services/firebase_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // A tela sobe ANTES do Firebase, e o init roda sem ser esperado.
  //
  // Antes isto era `await FirebaseService.instance.init()` na frente do
  // runApp: qualquer falha ali — plist de configuração fora do bundle,
  // APNs demorando para responder, aparelho sem rede — impedia o primeiro
  // frame e o app ficava na splash nativa para sempre, sem mensagem. Foi
  // exatamente o que aconteceu no primeiro build de TestFlight no iPhone.
  //
  // Push é recurso acessório: se ele falhar, o morador ainda precisa
  // conseguir abrir o app e usar portaria, reservas e financeiro.
  runApp(const MyApp());

  FirebaseService.instance.init();
}

/// `AppColors.primary` e afins são getters sem `BuildContext`: quem só lê neles
/// não depende do `Theme` e não reconstruiria na troca de tema, ficando com a cor
/// antiga até o próximo setState. Marca toda a árvore abaixo de [context].
void reconstruirArvore(BuildContext context) {
  void marcar(Element e) {
    e.markNeedsBuild();
    e.visitChildren(marcar);
  }

  (context as Element).visitChildren(marcar);
}

/// Prepara o armazenamento e o tema. Nunca lança nem fica preso: sem isto, um
/// arquivo corrompido ou o Keystore sem responder deixavam o app na abertura
/// para sempre. Se algo falhar, o app abre pedindo login, com o tema do sistema.
Future<void> prepararAbertura({Duration limite = const Duration(seconds: 10)}) async {
  try {
    await LocalStorageConfig.instance.initializeLocalStorage().timeout(limite);
  } catch (e) {
    logDebug('[Abertura] armazenamento: ${e.runtimeType}');
  }
  try {
    await ThemeController.instance.init().timeout(limite);
  } catch (e) {
    logDebug('[Abertura] tema: ${e.runtimeType}');
  }
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  MyAppState createState() => MyAppState();
}

class MyAppState extends State<MyApp> with WidgetsBindingObserver {
  bool _ready = false;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSubscription;

  @override
  void initState() {
    super.initState();
    Singleton.instance.mainView = this;
    WidgetsBinding.instance.addObserver(this);
    _init();
    _initDeepLinks();
  }

  Future<void> _init() async {
    await prepararAbertura();
    ThemeController.instance.addListener(_trocouTema);
    if (mounted) setState(() => _ready = true);
  }

  void _initDeepLinks() {
    _appLinks = AppLinks();

    // Deep link com app em segundo plano ou em execução
    _linkSubscription = _appLinks.uriLinkStream.listen((uri) {
      _processDeepLink(uri);
    });

    // Deep link inicial quando o app abre frio
    _appLinks.getInitialLink().then((uri) {
      if (uri != null) {
        _processDeepLink(uri);
      }
    });
  }

  void _processDeepLink(Uri uri) {
    // Toque no card ao vivo do iPhone (portaria remota ou delivery).
    final telaDoCard = telaDoLinkCard(uri);
    if (telaDoCard != null) {
      FirebaseService.instance.abrirTela(telaDoCard);
      return;
    }
    if (uri.scheme == 'clickprestare' &&
        (uri.host == 'redefinir-senha' || uri.path.contains('redefinir-senha'))) {
      final token = uri.queryParameters['token'] ?? '';
      if (token.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          NavigationService.navigatorKey.currentState?.push(
            MaterialPageRoute(
              builder: (_) => RedefinirSenhaPage(token: token),
            ),
          );
        });
      }
    }
  }

  void update() {
    if (mounted) setState(() {});
  }

  void _trocouTema() {
    update();
    if (mounted) reconstruirArvore(context);
  }

  @override
  void didChangePlatformBrightness() {
    // Com modo manual, o brilho do aparelho não muda nenhuma cor.
    if (ThemeController.instance.mode != ThemeMode.system) return;
    _trocouTema();
  }

  @override
  void dispose() {
    _linkSubscription?.cancel();
    ThemeController.instance.removeListener(_trocouTema);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PrestareSplashGate(appPronto: _ready, builder: _construirApp);
  }

  Widget _construirApp(BuildContext context) {
    return MaterialApp(
      navigatorKey: NavigationService.navigatorKey,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en', 'US'),
        Locale('de', 'DE'),
        Locale('pt', 'BR'),
        Locale('pt', 'PT'),
        Locale('es', 'ES'),
      ],
      locale: getCurrentLocale(),
      initialRoute: '/',
      onGenerateRoute: RouterGenerator.generateRouter,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeController.instance.mode,
    );
  }
}
