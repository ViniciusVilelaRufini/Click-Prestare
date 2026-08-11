import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';

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

    // Request permissions (iOS)
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

    // Sem isto, no iOS a notificação NÃO aparece com o app em primeiro plano:
    // o listener onMessage roda, mas nada é desenhado na tela. No Android o
    // sistema exibe sozinho, e é por isso que a diferença passa despercebida.
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    // No iOS o getToken espera o registro no APNs, que pode não responder
    // nunca (sem rede, perfil sem push, simulador). O timeout evita que os
    // listeners abaixo — que são o que realmente entrega a notificação —
    // fiquem para trás por causa dele.
    String? token = await messaging.getToken().timeout(
      const Duration(seconds: 15),
      onTimeout: () => null,
    );
    if (kDebugMode) {
      print('FCM Token: $token');
    }

    // Registra o token a CADA abertura, não só no login.
    //
    // `Users.fcm_token` guarda um token por usuário, e quem o gravava era só
    // a tela de login. Quem já tinha sessão salva entrava direto na home e
    // nunca registrava o aparelho — então o push continuava indo para o
    // último celular que passou pelo login. Trocar de aparelho (ou instalar
    // no iPhone tendo logado antes no Android) deixava o novo mudo.
    await _registrarNoServidor(token);

    // O FCM troca o token sozinho (reinstalação, restauração de backup,
    // expiração). Sem ouvir isto, o servidor fica com um token morto e os
    // envios falham em silêncio.
    FirebaseMessaging.instance.onTokenRefresh.listen(_registrarNoServidor);

    // Handle background messages
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      if (kDebugMode) {
        print('Got a message whilst in the foreground!');
        print('Message data: ${message.data}');
      }

      _logByType(message);

      if (message.notification != null) {
        if (kDebugMode) {
          print('Message also contained a notification: ${message.notification}');
        }
      }
    });

    // Handle when the app is opened from a notification (background → foreground)
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      if (kDebugMode) {
        print('Notification opened the app. Data: ${message.data}');
      }
      _logByType(message);
    });
  }

  /// Envia o token do aparelho para o servidor, se houver sessão.
  ///
  /// Sem JWT não há a quem associar o token — é o caso da primeira abertura,
  /// antes do login, e aí quem registra é a própria tela de login.
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
          // Serve para diagnóstico no servidor: um usuário pode ter vários
          // aparelhos registrados, e saber qual é qual ajuda quando alguém
          // relata que "não chega no iPhone".
          'plataforma': defaultTargetPlatform.name,
        }),
      );
    } catch (e) {
      // Push é acessório: falhar aqui não pode atrapalhar o uso do app.
      if (kDebugMode) print('Falha ao registrar token de push: $e');
    }
  }

  void _logByType(RemoteMessage message) {
    final type = message.data['type']?.toString();
    if (type == null) return;

    // Portaria remota: push acionável — abre o diálogo Autorizar/Negar.
    if (type == 'autorizacao_visitante') {
      final idStr = message.data['id']?.toString();
      final id = int.tryParse(idStr ?? '');
      if (id != null) {
        mostrarDialogoAutorizacaoVisitante(
          id: id,
          nome: message.data['nome']?.toString(),
        );
      }
      return;
    }

    if (!kDebugMode) return;
    switch (type) {
      case 'visitante':
        print('[FCM] Novo visitante chegou (PIN). id=${message.data['id']}');
        break;
      case 'visitante_acesso':
        print('[FCM] Visitante reconhecido pelo terminal facial. id=${message.data['id']}');
        break;
      case 'ocorrencia_atribuida':
        print('[FCM] Ocorrência atribuída ao funcionário. id=${message.data['id']}');
        break;
      case 'ocorrencia_chat':
        print('[FCM] Nova mensagem na ocorrência. id=${message.data['id']}');
        break;
      default:
        print('[FCM] Tipo desconhecido: $type');
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
