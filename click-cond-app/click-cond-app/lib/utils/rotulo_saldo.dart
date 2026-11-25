/// Rótulo do saldo ("POSITIVO"/"NEGATIVO") a partir do texto monetário
/// ("R$ 1.234,56", "- R$ 10,00"). Saldo zero não leva rótulo (retorna null).
String? rotuloSaldo(String saldo) {
  final digitos = saldo.replaceAll(RegExp(r'[^0-9]'), '');
  if (digitos.isEmpty || RegExp(r'^0+$').hasMatch(digitos)) return null;
  return saldo.contains('-') ? 'NEGATIVO' : 'POSITIVO';
}
