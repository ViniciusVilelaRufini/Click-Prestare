import 'package:click/utils/nome_proprio.dart';

/// "Agendado por (nome)" da reserva, a partir do `criado_por` que a API
/// devolve (nome de quem agendou). Reserva antiga, ou API sem a coluna ainda,
/// vem sem o campo ou com null: devolve null e a célula fica como era.
String? rotuloAgendadoPor(dynamic item) {
  if (item is! Map) return null;
  final nome = item['criado_por'];
  if (nome is! String) return null;
  final limpo = nome.trim();
  return limpo.isEmpty ? null : 'Agendado por ${nomeProprio(limpo)}';
}

bool _verdadeiro(Object? v) => v == true || v == 1 || v == '1' || v == 'true';

/// Momento (horário de Brasília) de uma reserva a partir do `data`
/// (dd/MM/yyyy) e de uma hora `HH:mm` da API; null se não der para ler.
DateTime? _momentoReserva(String data, String hora) {
  final d = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(data.trim());
  final h = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(hora.trim());
  if (d == null || h == null) return null;
  return DateTime(int.parse(d[3]!), int.parse(d[2]!), int.parse(d[1]!), int.parse(h[1]!), int.parse(h[2]!));
}

/// A reserva já tem presença confirmada (`confirmada_em` preenchido)?
bool presencaConfirmada(dynamic item) {
  if (item is! Map) return false;
  final c = item['confirmada_em'];
  return c != null && c.toString().trim().isNotEmpty;
}

/// Mostra "Confirmar presença" na reserva do morador?
///
/// A API (`confirmarAgendamento`) só aceita reserva `aprovado` e cancela, no
/// início do horário, a reserva não confirmada de área com
/// `exige_confirmacao`. Sem o campo `exige_confirmacao` na resposta (API
/// antiga), o botão não aparece. Depois do fim do horário não há o que
/// confirmar. [agora] é o relógio de Brasília (quem chama passa
/// `agoraBrasilia()`); data ilegível deixa a decisão para a API.
bool podeConfirmarPresenca(dynamic item, {required DateTime agora}) {
  if (item is! Map) return false;
  if (item['status']?.toString().toLowerCase() != 'aprovado') return false;
  if (!_verdadeiro(item['exige_confirmacao'])) return false;
  if (presencaConfirmada(item)) return false;
  final data = item['data']?.toString() ?? '';
  final inicio = _momentoReserva(data, item['horaDe']?.toString() ?? '');
  var fim = _momentoReserva(data, item['horaAte']?.toString() ?? '') ?? inicio;
  if (fim == null) return true;
  // Reserva que vira a noite (22:00 às 02:00) termina no dia seguinte.
  if (inicio != null && fim.isBefore(inicio)) fim = fim.add(const Duration(days: 1));
  return agora.isBefore(fim);
}
