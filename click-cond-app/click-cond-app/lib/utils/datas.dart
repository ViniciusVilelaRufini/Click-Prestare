/// Datas vindas da API.
///
/// O servidor serializa com `toISOString()`, ou seja, UTC com sufixo `Z`
/// (`2026-08-11T15:20:00.000Z`). `DateTime.parse` respeita esse sufixo e
/// devolve um DateTime **em UTC** — e aí `.hour` é a hora de Londres, não a
/// de quem está olhando a tela. Foi assim que a portaria registrou uma
/// entrada ao meio-dia e o app mostrou 15:20.
///
/// A portaria-web nunca sofreu disso porque o navegador converte sozinho ao
/// formatar.
///
/// Comparar instantes (`isAfter`, `difference`) já funciona sem conversão:
/// essas operações usam o tempo absoluto. A conversão importa quando se LÊ um
/// campo do calendário — hora, dia, mês — para exibir ou filtrar.
library;

/// Converte uma data da API para o fuso do aparelho. Devolve `null` quando o
/// valor está ausente ou não é uma data válida.
DateTime? parseDataApi(dynamic valor) {
  final texto = valor?.toString();
  if (texto == null || texto.isEmpty) return null;
  return DateTime.tryParse(texto)?.toLocal();
}

/// `11/08/2026 às 12:20` no fuso do aparelho.
String formatarDataHora(dynamic valor, {String fallback = ''}) {
  final d = parseDataApi(valor);
  if (d == null) return fallback;
  final pad = (int n) => n.toString().padLeft(2, '0');
  return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
}
