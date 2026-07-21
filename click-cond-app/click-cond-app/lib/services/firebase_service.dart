import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';

class FirebaseService {
  static final FirebaseService instance = FirebaseService._();
  FirebaseService._();

  Future<void> init() async {
    if (kIsWeb) return;
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

    // Get Token
    String? token = await messaging.getToken();
    if (kDebugMode) {
      print('FCM Token: $token');
    }

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
