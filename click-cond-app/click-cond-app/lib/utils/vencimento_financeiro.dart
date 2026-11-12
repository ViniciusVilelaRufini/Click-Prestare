import 'package:click/utils/financeiro_constants.dart';

/// Onde o vencimento mais próximo está em relação a hoje (dia local).
enum SituacaoVencimento { vencido, hoje, futuro }

/// Vencimento mais próximo entre as contas pendentes, já com o rótulo do selo.
class ProximoVencimento {
  final DateTime data;
  final SituacaoVencimento situacao;

  /// "Vencido desde 07/11", "Vence hoje" ou "Vence 07/11".
  final String rotulo;

  const ProximoVencimento(this.data, this.situacao, this.rotulo);
}

String _dd(int n) => n.toString().padLeft(2, '0');

DateTime? _parseData(String raw, int anoPadrao) {
  if (raw.contains('/')) {
    final p = raw.split('/');
    if (p.length < 2) return null;
    final d = int.tryParse(p[0].trim()) ?? 1;
    final m = int.tryParse(p[1].trim()) ?? 1;
    var y = p.length >= 3 ? (int.tryParse(p[2].trim()) ?? anoPadrao) : anoPadrao;
    if (y < 100) y += 2000;
    return DateTime(y, m, d);
  }
  if (raw.contains('-')) {
    final p = raw.split('-');
    if (p.length < 3) return null;
    final y = int.tryParse(p[0].trim()) ?? anoPadrao;
    final m = int.tryParse(p[1].trim()) ?? 1;
    final d = int.tryParse(p[2].split('T').first.trim()) ?? 1;
    return DateTime(y, m, d);
  }
  return null;
}

/// Menor vencimento entre as contas não pagas, comparado com o dia de [hoje]
/// (injetável nos testes; padrão: agora, no fuso do aparelho). Nulo quando
/// nenhuma conta pendente tem data legível.
ProximoVencimento? proximoVencimentoPendente(List<dynamic> itens, {DateTime? hoje}) {
  final agora = hoje ?? DateTime.now();
  final diaHoje = DateTime(agora.year, agora.month, agora.day);
  DateTime? menor;

  for (final item in itens) {
    if (isPagoValor(item['pago'])) continue;
    final raw = (item['data_vencimento'] ?? item['vencimento'] ?? item['data'] ?? '')
        .toString()
        .trim();
    if (raw.isEmpty) continue;
    final data = _parseData(raw, agora.year);
    if (data == null) continue;
    if (menor == null || data.isBefore(menor)) menor = data;
  }

  if (menor == null) return null;
  final dm = '${_dd(menor.day)}/${_dd(menor.month)}';
  if (menor.isBefore(diaHoje)) {
    return ProximoVencimento(menor, SituacaoVencimento.vencido, 'Vencido desde $dm');
  }
  if (menor.isAtSameMomentAs(diaHoje)) {
    return ProximoVencimento(menor, SituacaoVencimento.hoje, 'Vence hoje');
  }
  return ProximoVencimento(menor, SituacaoVencimento.futuro, 'Vence $dm');
}
