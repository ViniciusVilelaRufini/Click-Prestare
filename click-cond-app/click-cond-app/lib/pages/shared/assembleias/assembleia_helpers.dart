import 'package:click/pages/shared/areas%20sociais/widgets/reserva_helpers.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart' show textoLimpo;

// Funções puras das telas de Assembleias. A API (assembleias.service.ts)
// devolve na lista só { id, titulo, descricao, data: 'dd/MM/yyyy',
// hora: 'HH:mm' } — local, link, anexos e votações vêm apenas no detalhe.

const _mesesCurtos = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/// Data da assembleia (`'dd/MM/yyyy'`) ou nulo se ausente/inválida.
DateTime? dataAssembleia(dynamic data) => parseDataReserva(textoLimpo(data));

/// `('20/05/2026', '19:30')` → `'20/05/2026 às 19:30'`; só um dos dois →
/// só ele; nada → `''`.
String dataHoraAssembleia(dynamic data, dynamic hora) {
  final d = textoLimpo(data);
  final h = textoLimpo(hora);
  if (d.isNotEmpty && h.isNotEmpty) return '$d às $h';
  return d.isNotEmpty ? d : h;
}

/// Data por extenso com a hora: `'Quarta-feira, 20 de maio de 2026 às 19:30'`.
/// Data inválida volta como veio (ver [dataHoraAssembleia]).
String dataHoraExtensoAssembleia(dynamic data, dynamic hora) {
  final d = textoLimpo(data);
  if (dataAssembleia(d) == null) return dataHoraAssembleia(data, hora);
  final h = textoLimpo(hora);
  final extenso = dataPorExtenso(d);
  return h.isEmpty ? extenso : '$extenso às $h';
}

/// Sigla do mês para o bloco de data do card (`'MAI'`); `''` se inválida.
String mesCurtoAssembleia(DateTime? data) => data == null ? '' : _mesesCurtos[data.month - 1];

/// Quanto falta para a assembleia, para o selo do card: `'Hoje'`,
/// `'Amanhã'`, `'Em 5 dias'`. Data passada ou inválida → `''` (sem selo).
String quandoAssembleia(dynamic data, {DateTime? agora}) {
  final dias = _diasAteAssembleia(data, agora);
  if (dias == null || dias < 0) return '';
  if (dias == 0) return 'Hoje';
  if (dias == 1) return 'Amanhã';
  return 'Em $dias dias';
}

/// Dias de calendário de hoje até a data (negativo = passou); nulo se inválida.
int? _diasAteAssembleia(dynamic data, DateTime? agora) {
  final dt = dataAssembleia(data);
  if (dt == null) return null;
  final now = agora ?? DateTime.now();
  return DateTime.utc(dt.year, dt.month, dt.day).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
}

/// Se a assembleia é hoje (para o selo de proximidade em verde, sem comparar
/// o texto de [quandoAssembleia]).
bool assembleiaEhHoje(dynamic data, {DateTime? agora}) => _diasAteAssembleia(data, agora) == 0;

/// Se a assembleia foi finalizada com a ATA (`finalizada` da API nova; a
/// antiga apagava a assembleia e não manda o campo → falso).
bool assembleiaFinalizada(dynamic assembleia) {
  if (assembleia is! Map) return false;
  final v = assembleia['finalizada'];
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = textoLimpo(v).toLowerCase();
  return s == 'true' || s == '1';
}

/// Separa a lista da API (com `incluir_finalizadas=1`) em abertas e
/// finalizadas, mantendo a ordem de cada uma. Itens que não são mapa somem.
({List<Map> abertas, List<Map> finalizadas}) separarAssembleias(dynamic lista) {
  final abertas = <Map>[];
  final finalizadas = <Map>[];
  if (lista is List) {
    for (final a in lista) {
      if (a is! Map) continue;
      (assembleiaFinalizada(a) ? finalizadas : abertas).add(a);
    }
  }
  return (abertas: abertas, finalizadas: finalizadas);
}

/// Data de `finalizada_em` para a tela (`'dd/MM/yyyy'`): aceita ISO (vira o
/// dia local) ou já `'dd/MM/yyyy'`. Vazio ou ilegível → `''`.
String dataFinalizacao(dynamic v) {
  final s = textoLimpo(v);
  final br = RegExp(r'^(\d{2})/(\d{2})/(\d{4})').firstMatch(s);
  if (br != null) return br.group(0)!;
  final iso = DateTime.tryParse(s);
  if (iso == null) return '';
  final d = iso.isUtc ? iso.toLocal() : iso;
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(d.day)}/${dois(d.month)}/${d.year}';
}

/// Link da ATA da assembleia finalizada (`link_ata`), ou nulo.
String? linkAta(dynamic assembleia) {
  if (assembleia is! Map) return null;
  final s = textoLimpo(assembleia['link_ata']);
  return s.isEmpty ? null : s;
}

/// Se a data da assembleia já passou (dia anterior a hoje).
bool assembleiaPassou(dynamic data, {DateTime? agora}) {
  final dt = dataAssembleia(data);
  if (dt == null) return false;
  final now = agora ?? DateTime.now();
  return dt.isBefore(DateTime(now.year, now.month, now.day));
}
