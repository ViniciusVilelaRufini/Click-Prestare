import 'package:click/utils/datas.dart';

/// Grupo de eventos de um mesmo dia local, com os rótulos do cabeçalho.
class GrupoEventosDia {
  /// "HOJE", "ONTEM" ou dia da semana em maiúsculas; vazio sem data válida.
  final String rotuloEsquerdo;

  /// "11 de novembro"; vazio sem data válida.
  final String rotuloDireito;
  final List<dynamic> eventos;

  const GrupoEventosDia(this.rotuloEsquerdo, this.rotuloDireito, this.eventos);
}

const _meses = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

const _diasSemana = [
  'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'
];

/// Agrupa até [maxLinhas] eventos (na ordem recebida) por dia local do
/// `timestamp`. Eventos sem timestamp válido vão num grupo sem cabeçalho,
/// no fim. [agora] é injetável para teste.
List<GrupoEventosDia> agruparEventosPorDia(
  List<dynamic> eventos, {
  required DateTime agora,
  int maxLinhas = 4,
}) {
  final hoje = DateTime(agora.year, agora.month, agora.day);
  final ordem = <DateTime>[];
  final porDia = <DateTime, List<dynamic>>{};
  final semData = <dynamic>[];

  for (final e in eventos.take(maxLinhas)) {
    final ts = e is Map ? e['timestamp'] : null;
    final d = parseDataApi(ts);
    if (d == null) {
      semData.add(e);
      continue;
    }
    final dia = DateTime(d.year, d.month, d.day);
    if (!porDia.containsKey(dia)) ordem.add(dia);
    porDia.putIfAbsent(dia, () => []).add(e);
  }

  final grupos = <GrupoEventosDia>[];
  for (final dia in ordem) {
    // Diferença em dias de calendário (DateTime.utc evita o erro de horário
    // de verão em Duration.inDays).
    final diff = DateTime.utc(hoje.year, hoje.month, hoje.day)
        .difference(DateTime.utc(dia.year, dia.month, dia.day))
        .inDays;
    final esquerdo = diff == 0
        ? 'HOJE'
        : diff == 1
            ? 'ONTEM'
            : _diasSemana[dia.weekday - 1];
    grupos.add(GrupoEventosDia(
        esquerdo, '${dia.day} de ${_meses[dia.month - 1]}', porDia[dia]!));
  }
  if (semData.isNotEmpty) grupos.add(GrupoEventosDia('', '', semData));
  return grupos;
}
