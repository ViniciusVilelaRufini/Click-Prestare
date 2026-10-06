import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

// Funções puras das telas de Áreas Sociais (detalhe e reserva). Nada aqui
// toca em rede, Singleton ou storage — tudo é testável sem montar tela.

const _statusAtivos = {'pendente', 'aprovado'};
const _statusDoMorador = {'pendente', 'aprovado', 'recusado'};

String _normalizar(dynamic v) => (v ?? '').toString().trim().toLowerCase();

/// Reservas que a tela de detalhe deve listar.
///
/// - [podeVerTodas] (síndico ou funcionário com permissão `areas_sociais`):
///   pendentes e aprovadas de todos os apartamentos.
/// - Senão (morador): só as do [bloco] + [apto] informados, com status
///   pendente, aprovado ou recusado. Sem bloco/apto não devolve nada.
///
/// Status, bloco e apto são comparados ignorando maiúsculas e espaços.
/// A ordem original da lista é mantida.
///
/// Atenção: essa comparação frouxa de bloco/apto serve só para EXIBIR. A regra
/// de edição continua sendo a de `_canEditAgendamento` em
/// `area_social_detail.dart` (síndico, permissão `areas_sociais` ou bloco/apto
/// com igualdade exata) — as telas devem passar o callback de editar (ex.:
/// `MinhaReservaCard.onEditar`) só quando essa regra mais estrita permitir.
List<dynamic> reservasVisiveis(
  List<dynamic>? lista, {
  required bool podeVerTodas,
  String? bloco,
  String? apto,
}) {
  if (lista == null) return const [];
  if (podeVerTodas) {
    return lista.where((r) => r is Map && _statusAtivos.contains(_normalizar(r['status']))).toList();
  }
  final b = _normalizar(bloco);
  final a = _normalizar(apto);
  if (b.isEmpty || a.isEmpty) return const [];
  return lista
      .where((r) =>
          r is Map &&
          _normalizar(r['bloco']) == b &&
          _normalizar(r['apto']) == a &&
          _statusDoMorador.contains(_normalizar(r['status'])))
      .toList();
}

/// Rótulo pt-BR, cor semântica e ícone de um status de reserva.
class StatusReservaInfo {
  /// Âmbar — aguardando aprovação.
  static const Color corPendente = Color(0xFFF59E0B);

  /// Verde — reserva aprovada.
  static const Color corAprovada = Color(0xFF10B981);

  /// Vermelho — reserva recusada.
  static const Color corRecusada = Color(0xFFEF4444);

  /// Cinza — cancelada ou status desconhecido.
  static const Color corNeutra = Color(0xFF64748B);

  final String rotulo;
  final Color cor;
  final IconData icone;

  const StatusReservaInfo(this.rotulo, this.cor, this.icone);

  /// Cor para texto/ícone sobre o fundo tingido com [cor]: escurece no tema
  /// claro (âmbar e verde puros não têm contraste no branco) e clareia um
  /// pouco no escuro.
  Color corTexto(BuildContext context) => Theme.of(context).brightness == Brightness.dark
      ? Color.lerp(cor, Colors.white, 0.18)!
      : Color.lerp(cor, Colors.black, 0.4)!;
}

/// Mapeia o status vindo da API (pendente, aprovado, recusado, cancelado)
/// para rótulo, cor e ícone. Desconhecido mantém o texto original em cinza.
StatusReservaInfo statusReservaInfo(String? status) {
  switch (_normalizar(status)) {
    case 'pendente':
      return const StatusReservaInfo('Pendente', StatusReservaInfo.corPendente, PhosphorIcons.hourglassMedium);
    case 'aprovado':
      return const StatusReservaInfo('Aprovada', StatusReservaInfo.corAprovada, PhosphorIcons.checkCircle);
    case 'recusado':
      return const StatusReservaInfo('Recusada', StatusReservaInfo.corRecusada, PhosphorIcons.xCircle);
    case 'cancelado':
      return const StatusReservaInfo('Cancelada', StatusReservaInfo.corNeutra, PhosphorIcons.prohibit);
    case '':
      return const StatusReservaInfo('Sem status', StatusReservaInfo.corNeutra, PhosphorIcons.question);
    default:
      return StatusReservaInfo(status!.trim(), StatusReservaInfo.corNeutra, PhosphorIcons.question);
  }
}

int? _minutos(String hora) {
  final m = RegExp(r'^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$').firstMatch(hora);
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final min = int.parse(m.group(2)!);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

String _hhmm(String hora) {
  final m = RegExp(r'^\s*(\d{1,2}:\d{2})').firstMatch(hora);
  return m == null ? hora.trim() : m.group(1)!;
}

/// Duração entre [de] e [ate] ("HH:mm", aceita segundos): `'6 h'`,
/// `'1 h 30'`, `'45 min'`. Devolve `''` se inválido ou se [ate] não for
/// depois de [de] (reserva não vira o dia).
String duracaoHorario(String de, String ate) {
  final ini = _minutos(de);
  final fim = _minutos(ate);
  if (ini == null || fim == null || fim <= ini) return '';
  final total = fim - ini;
  final h = total ~/ 60;
  final m = total % 60;
  if (h == 0) return '$m min';
  if (m == 0) return '$h h';
  return '$h h ${m.toString().padLeft(2, '0')}';
}

/// Faixa para exibição: `'10:00 – 16:00'` (traço longo, sem segundos).
String faixaHorario(String de, String ate) => '${_hhmm(de)} – ${_hhmm(ate)}';

/// Separa o horário no formato usado em `new_reserva.dart`
/// (`'10:00 - 16:00'`; aceita também `–` e sem espaços). Nulo se não houver
/// as duas pontas.
({String de, String ate})? separarHorario(String? horario) {
  if (horario == null) return null;
  final partes = horario.split(RegExp(r'\s*[-–]\s*'));
  if (partes.length != 2) return null;
  final de = partes[0].trim();
  final ate = partes[1].trim();
  if (de.isEmpty || ate.isEmpty) return null;
  return (de: de, ate: ate);
}

const _diasSemana = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
];

const _meses = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/// Abreviações de mês em maiúsculas ("JAN", "FEV"...), para selos de data.
const mesesAbreviados = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/// Abreviações do dia da semana começando na segunda (índice = `weekday - 1`).
const diasSemanaAbreviados = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

/// Converte `'dd/MM/yyyy'` em data (sem hora). Nulo se inválida.
DateTime? parseDataReserva(String? data) {
  final m = RegExp(r'^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$').firstMatch(data ?? '');
  if (m == null) return null;
  final d = int.parse(m.group(1)!);
  final mes = int.parse(m.group(2)!);
  final a = int.parse(m.group(3)!);
  final dt = DateTime(a, mes, d);
  if (dt.day != d || dt.month != mes) return null;
  return dt;
}

/// `'11/10/2026'` → `'Domingo, 11 de outubro de 2026'`. Data inválida volta
/// como veio. Nomes fixos em pt-BR (não depende de inicializar o `intl`).
String dataPorExtenso(String data) {
  final dt = parseDataReserva(data);
  if (dt == null) return data;
  return '${_diasSemana[dt.weekday - 1]}, ${dt.day} de ${_meses[dt.month - 1]} de ${dt.year}';
}

/// Textos prontos para o resumo da reserva. Ver [resumoReserva].
class ResumoReservaInfo {
  /// Ex.: "Domingo, 11 de outubro de 2026".
  final String dataExtenso;

  /// Ex.: "10:00 – 16:00" (vazio se o horário for inválido).
  final String horario;

  /// Ex.: "6 h" (vazio se o horário for inválido).
  final String duracao;

  /// "12 convidados", "1 convidado" ou "Sem convidados informados".
  final String convidados;

  /// Quantidade informada (nula quando não informada ou 0).
  final int? quantidadeConvidados;

  const ResumoReservaInfo({
    required this.dataExtenso,
    required this.horario,
    required this.duracao,
    required this.convidados,
    required this.quantidadeConvidados,
  });

  /// Uma linha só: "Domingo, 11 de outubro de 2026 · 10:00 – 16:00 · 12 convidados"
  /// (partes vazias e "sem convidados" ficam de fora).
  String get linha => [
        dataExtenso,
        horario,
        if (quantidadeConvidados != null) convidados,
      ].where((s) => s.isNotEmpty).join(' · ');
}

/// Monta o resumo a partir da [data] (`'dd/MM/yyyy'`), do [horario]
/// (`'10:00 - 16:00'`, formato de `new_reserva.dart`) e de [convidados]
/// (nulo ou 0 = não informado).
ResumoReservaInfo resumoReserva(String data, String horario, int? convidados) {
  final partes = separarHorario(horario);
  final qtd = (convidados == null || convidados <= 0) ? null : convidados;
  return ResumoReservaInfo(
    dataExtenso: dataPorExtenso(data),
    horario: partes == null ? '' : faixaHorario(partes.de, partes.ate),
    duracao: partes == null ? '' : duracaoHorario(partes.de, partes.ate),
    convidados: qtd == null ? 'Sem convidados informados' : (qtd == 1 ? '1 convidado' : '$qtd convidados'),
    quantidadeConvidados: qtd,
  );
}

/// Converte o campo `convidados` da API (int, string ou nulo) em `int?`.
int? convidadosDaReserva(dynamic valor) {
  if (valor == null) return null;
  if (valor is int) return valor > 0 ? valor : null;
  final n = int.tryParse(valor.toString().trim());
  return (n == null || n <= 0) ? null : n;
}
