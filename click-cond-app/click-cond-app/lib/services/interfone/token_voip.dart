import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';

final RegExp _hex = RegExp(r'^[0-9a-fA-F]{16,200}$');

/// O token só vai ao servidor no formato que ele aceita (hex de 16 a 200);
/// vazio (PushKit invalidou) ou qualquer outra coisa vira null.
String? tokenVoipValido(String? token) {
  final t = token?.trim() ?? '';
  return _hex.hasMatch(t) ? t.toLowerCase() : null;
}

/// `interfone_versao` mandado no registro do aparelho. 1 = este app atende a
/// chamada. No iPhone isso só vale com o token VoIP: sem ele (PushKit ainda
/// sem token no primeiro arranque) o servidor não tem como tocar, e 0 faz ele
/// mandar o push comum em vez de nada.
int versaoDoInterfone({required bool ios, required String? voipToken}) => ios && voipToken == null ? 0 : 1;

/// Token VoIP do PushKit, guardado pelo AppDelegate no flutter_callkit_incoming.
/// No Android não existe (o toque chega pelo push de dados do FCM).
Future<String?> tokenVoipDoAparelho() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.iOS) return null;
  return FlutterCallkitIncoming.getDevicePushTokenVoIP();
}
