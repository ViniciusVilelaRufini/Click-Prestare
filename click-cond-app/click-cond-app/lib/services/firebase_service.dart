import 'dart:convert';

import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class FirebaseService {
  static final FirebaseService instance = FirebaseService._();
  FirebaseService._();

  /// Nunca lança: quem chama não espera o resultado, e uma falha aqui não
  /// pode derrubar nem travar o app — no máximo o aparelho fica sem push.
  Future<void> init() async {
    if (kIsWeb) return;
    try {
      await _init();
    } catch (e) {
      // Sem push, mas com app funcionando.
      if (kDebugMode) print('Firebase indisponível, seguindo sem push: $e');
    }
  }

  Future<void> _init() async {
    await Firebase.initializeApp();

    FirebaseMessaging messaging = FirebaseMessaging.instance;

    // Request permissions (iOS/Android 13+)
    NotificationSettings settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      if (kDebugMode) {
        print('User granted permission');
      }
    }

    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    String? token = await messaging.getToken().timeout(
      const Duration(seconds: 15),
      onTimeout: () => null,
    );
    if (kDebugMode) {
      print('FCM Token: $token');
    }

    await _registrarNoServidor(token);
    FirebaseMessaging.instance.onTokenRefresh.listen(_registrarNoServidor);

    // Handle background messages
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      if (kDebugMode) {
        print('Got a message whilst in the foreground! Data: ${message.data}');
      }

      final type = message.data['type']?.toString();
      if (type == 'autorizacao_visitante') {
        final idStr = message.data['id']?.toString();
        final id = int.tryParse(idStr ?? '');
        if (id != null) {
          mostrarDialogoAutorizacaoVisitante(
            id: id,
            nome: message.data['nome']?.toString(),
          );
        }
      }
    });

    // Check if the app was launched by tapping a notification (terminated → foreground)
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      if (kDebugMode) {
        print('App opened from terminated state via notification: ${initialMessage.data}');
      }
      handleNotificationNavigation(initialMessage);
    }

    // Handle when the app is opened from a notification (background → foreground)
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      if (kDebugMode) {
        print('Notification opened the app from background. Data: ${message.data}');
      }
      handleNotificationNavigation(message);
    });
  }

  /// Navega diretamente para a tela apropriada ao tocar na notificação push.
  void handleNotificationNavigation(RemoteMessage? message) {
    if (message == null) return;
    final type = message.data['type']?.toString();
    if (type == null || type.isEmpty) return;

    if (kDebugMode) {
      print('[FCM] handleNotificationNavigation: type=$type, data=${message.data}');
    }

    _navigateByType(type, message.data);
  }

  void _navigateByType(String type, Map<String, dynamic> data, [int attempts = 0]) {
    final nav = NavigationService.navigatorKey.currentState;
    final ctx = NavigationService.navigatorKey.currentContext;

    // Se o navigator ainda não estiver pronto (ex.: app iniciando ou splash/auto-login),
    // tenta novamente a cada 200ms por até 5 segundos.
    if (nav == null || ctx == null) {
      if (attempts < 25) {
        Future.delayed(const Duration(milliseconds: 200), () {
          _navigateByType(type, data, attempts + 1);
        });
      }
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      switch (type) {
        case 'autorizacao_visitante':
          nav.push(
            MaterialPageRoute(
              builder: (_) => const PendentesVisitantePage(),
            ),
          );
          break;
        case 'visitante':
        case 'visitante_acesso':
          nav.push(
            MaterialPageRoute(
              builder: (_) => const HistoricoAcessosPage(),
            ),
          );
          break;
        case 'encomenda':
          nav.push(
            MaterialPageRoute(
              builder: (_) => const ListEncomendas(),
            ),
          );
          break;
        case 'ocorrencia_chat':
        case 'ocorrencia_atribuida':
          nav.push(
            MaterialPageRoute(
              builder: (_) => const ListOcorrencias(),
            ),
          );
          break;
        case 'financeiro':
          nav.push(
            MaterialPageRoute(
              builder: (_) => const MoradorFinanceiroView(),
            ),
          );
          break;
        default:
          break;
      }
    });
  }

  /// Envia o token do aparelho para o servidor, se houver sessão.
  Future<void> registrarNoServidor([String? tokenFcm]) async {
    final token = tokenFcm ?? await FirebaseMessaging.instance.getToken();
    await _registrarNoServidor(token);
  }

  Future<void> _registrarNoServidor(String? tokenFcm) async {
    if (tokenFcm == null || tokenFcm.isEmpty) return;
    final jwt = getToken();
    if (jwt.isEmpty) return;

    try {
      await ApiClient.post(
        ApiConfig.buildUri('/users/update-fcm-token'),
        headers: {'Content-Type': 'application/json', 'Authorization': jwt},
        body: jsonEncode({
          'fcm_token': tokenFcm,
          'plataforma': defaultTargetPlatform.name,
        }),
      );
    } catch (e) {
      if (kDebugMode) print('Falha ao registrar token de push: $e');
    }
  }
}

Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (kIsWeb) return;
  await Firebase.initializeApp();
  if (kDebugMode) {
    print("Handling a background message: ${message.messageId}");
  }
}
