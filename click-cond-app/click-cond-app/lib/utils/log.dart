import 'package:flutter/foundation.dart';

/// Log de diagnóstico que existe só em debug.
///
/// `print()` NÃO é removido no build de release do Android: tudo o que os
/// controllers imprimiam continuava indo para o logcat em produção — inclusive
/// o corpo inteiro das respostas, que carrega CPF, PIN de portaria, placa e
/// foto de rosto. Dado pessoal sensível gravado sem finalidade e sem controle.
///
/// Regra prática ao usar: logue rota e status. Nunca `response.body`.
bool logDebugHabilitado = kDebugMode;

/// Ponto de saída, trocável no teste. Em produção é o [debugPrint].
void Function(String)? logDebugSaida;

/// Aceita [Object?] porque a maioria dos call sites loga o `e` de um catch.
void logDebug(Object? mensagem) {
  if (!logDebugHabilitado) return;
  final texto = mensagem?.toString() ?? '';
  if (texto.isEmpty) return;
  (logDebugSaida ?? debugPrint)(texto);
}

/// Versão preguiçosa: em release a mensagem nem chega a ser montada, então
/// interpolar algo caro (ou sensível) não custa nada e não vaza.
void logDebugLazy(String Function() mensagem) {
  if (!logDebugHabilitado) return;
  logDebug(mensagem());
}
