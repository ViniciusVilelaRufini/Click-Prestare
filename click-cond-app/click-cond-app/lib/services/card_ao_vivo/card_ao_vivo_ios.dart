import 'package:click/utils/log.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Ponte com o Swift do card ao vivo (Live Activity) no iPhone.
///
/// O Swift (`ios/Runner/CardAoVivoBridge.swift`) faz o trabalho pesado sem
/// depender do Flutter estar rodando: registra no servidor que o card abriu e
/// responde NEGAR/AUTORIZAR pelos botões do card. Daqui o app só:
///  - entrega a sessão (`definirSessao`) — guardada num item próprio do
///    keychain, legível com o aparelho bloqueado depois do 1º desbloqueio;
///  - apaga a sessão e encerra os cards no logout (`limparSessao`);
///  - lê o token de push-to-start para mandar junto do registro do aparelho.
class CardAoVivoIos {
  CardAoVivoIos._();

  static const _canal = MethodChannel('prestare/card_ao_vivo');
  static void Function()? _aoMudarToken;

  static bool get _suportado => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  /// [aoMudarToken] é chamado quando o iOS emite um token de push-to-start
  /// novo; o app então re-registra o aparelho no servidor.
  static void iniciar({required void Function() aoMudarToken}) {
    if (!_suportado) return;
    _aoMudarToken = aoMudarToken;
    _canal.setMethodCallHandler((call) async {
      if (call.method == 'tokenInicioAtualizado') _aoMudarToken?.call();
    });
  }

  static Future<void> definirSessao(String token, String baseUrl) async {
    if (!_suportado || token.isEmpty) return;
    try {
      await _canal.invokeMethod('definirSessao', {'token': token, 'baseUrl': baseUrl});
    } catch (e) {
      logDebug('Card ao vivo: definirSessao falhou: $e');
    }
  }

  static Future<void> limparSessao() async {
    if (!_suportado) return;
    try {
      await _canal.invokeMethod('limparSessao');
    } catch (e) {
      logDebug('Card ao vivo: limparSessao falhou: $e');
    }
  }

  /// Token de push-to-start (iOS 17.2+); "" quando o aparelho não pode
  /// receber card (iOS antigo, Live Activities desligadas) — o servidor apaga
  /// o token antigo e manda o push comum; null fora do iOS ou se a ponte falhar
  /// (o servidor mantém o que tinha).
  static Future<String?> obterTokenInicio() async {
    if (!_suportado) return null;
    try {
      return await _canal.invokeMethod<String>('obterTokenInicio');
    } catch (e) {
      return null;
    }
  }
}
