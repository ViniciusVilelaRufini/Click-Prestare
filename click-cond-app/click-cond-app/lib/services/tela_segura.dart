import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Bloqueio de captura de tela (print e gravação) enquanto o QR de acesso
/// está aberto. No Android liga e desliga `FLAG_SECURE` na janela
/// (MainActivity.kt). O iOS não permite bloquear o print; lá, e em qualquer
/// outra plataforma, não faz nada e não lança.
class TelaSegura {
  static const _canal = MethodChannel('prestare/tela_segura');

  static Future<void> ligar() => _chamar('ligar');

  static Future<void> desligar() => _chamar('desligar');

  static Future<void> _chamar(String metodo) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _canal.invokeMethod<void>(metodo);
    } catch (_) {
      // Versão nativa sem o canal: a tela funciona, só sem o bloqueio.
    }
  }
}
