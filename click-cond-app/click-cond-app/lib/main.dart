import 'package:click/pages/singleton.dart';
import 'package:click/router.dart';
import 'package:click/theme/app_theme.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/localstorage_config.dart';
import 'package:click/utils/navigation_service.dart';
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

class MyApp extends StatefulWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  MyAppState createState() => MyAppState();
}

class MyAppState extends State<MyApp> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    Singleton.instance.mainView = this;
    _init();
  }

  Future<void> _init() async {
    await LocalStorageConfig.instance.initializeLocalStorage();
    await ThemeController.instance.init();
    ThemeController.instance.addListener(update);
    if (mounted) setState(() => _ready = true);
  }

  void update() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    ThemeController.instance.removeListener(update);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

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
