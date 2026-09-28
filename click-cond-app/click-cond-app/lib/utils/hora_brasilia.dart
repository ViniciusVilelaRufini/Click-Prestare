/// "Agora" no relógio do condomínio (Brasília, UTC-3, sem horário de verão).
///
/// As datas/horas digitadas no app são horário do condomínio — é assim que a
/// API as lê e as devolve. Usar `DateTime.now()` do aparelho como padrão (e
/// mínimo) do seletor deslocava a janela quando o celular estava em outro
/// fuso: com o aparelho em UTC, "agora" virava 3 h no futuro e o PIN era
/// recusado com "período ainda não iniciou".
DateTime agoraBrasilia([DateTime? instante]) {
  final b = (instante ?? DateTime.now()).toUtc().subtract(const Duration(hours: 3));
  return DateTime(b.year, b.month, b.day, b.hour, b.minute, b.second);
}
