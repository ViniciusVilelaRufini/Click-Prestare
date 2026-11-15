/// "Agendado por <nome>" da reserva, a partir do `criado_por` que a API
/// devolve (nome de quem agendou). Reserva antiga, ou API sem a coluna ainda,
/// vem sem o campo ou com null: devolve null e a célula fica como era.
String? rotuloAgendadoPor(dynamic item) {
  if (item is! Map) return null;
  final nome = item['criado_por'];
  if (nome is! String) return null;
  final limpo = nome.trim();
  return limpo.isEmpty ? null : 'Agendado por $limpo';
}
