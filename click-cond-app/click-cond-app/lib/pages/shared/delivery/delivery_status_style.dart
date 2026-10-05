import 'package:click/models/delivery_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Visual de cada status do aviso de entrega: cor, ícone e rótulo curto.
///
/// Único lugar com esse mapeamento — lista, detalhes e formulário usam daqui.
class DeliveryStatusStyle {
  final Color color;
  final IconData icon;

  /// Rótulo curto para selos ("Chegou", "Concluída"...). O rótulo longo
  /// continua em [deliveryStatusLabel].
  final String label;

  const DeliveryStatusStyle._(this.color, this.icon, this.label);

  static const _agendada = DeliveryStatusStyle._(
      AppColors.primary, PhosphorIcons.calendarCheck, 'Agendada');

  static DeliveryStatusStyle of(String status) {
    switch (status) {
      case 'CHEGOU':
        return const DeliveryStatusStyle._(
            AppColors.warning, PhosphorIcons.bellRinging, 'Chegou');
      case 'AGUARDANDO_AUTORIZACAO':
        return const DeliveryStatusStyle._(
            Color(0xFFF97316), PhosphorIcons.handPalm, 'Aguardando você');
      case 'AUTORIZADA':
        return const DeliveryStatusStyle._(
            Color(0xFF14B8A6), PhosphorIcons.thumbsUp, 'Autorizada');
      case 'RETIRADA_NA_PORTARIA':
        return const DeliveryStatusStyle._(
            Color(0xFF8B5CF6), PhosphorIcons.storefront, 'Na portaria');
      case 'CONCLUIDA':
        return const DeliveryStatusStyle._(
            AppColors.success, PhosphorIcons.checkCircle, 'Concluída');
      case 'CANCELADA':
        return const DeliveryStatusStyle._(
            AppColors.error, PhosphorIcons.prohibit, 'Cancelada');
      case 'RECUSADA':
        return const DeliveryStatusStyle._(
            AppColors.error, PhosphorIcons.xCircle, 'Recusada');
      default:
        return _agendada;
    }
  }

  /// Cor para texto sobre o fundo tingido: escurece no tema claro (o âmbar
  /// puro some no branco) e clareia um pouco no escuro.
  Color foreground(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
          ? Color.lerp(color, Colors.white, 0.12)!
          : Color.lerp(color, Colors.black, 0.28)!;

  /// Cor de ícone/texto sobre o preenchimento sólido da cor do status:
  /// escura nos tons claros (âmbar, verde, laranja), branca nos demais.
  Color get onColor =>
      ThemeData.estimateBrightnessForColor(color) == Brightness.light
          ? AppColors.lightTextPrimary
          : Colors.white;
}

/// Título de um aviso: o estabelecimento, ou um texto padrão.
String deliveryTitle(DeliveryModel delivery) {
  final text = delivery.estabelecimento?.trim();
  return text == null || text.isEmpty ? 'Entrega avisada' : text;
}

const _encerrados = {'CONCLUIDA', 'CANCELADA', 'RECUSADA'};

/// Em andamento: tudo que ainda não foi concluído, cancelado ou recusado.
bool isAtiva(String status) => !_encerrados.contains(status);

/// Etapas do fluxo mostradas no indicador de progresso dos detalhes.
const List<String> deliverySteps = [
  'Aviso',
  'Chegou',
  'Autorização',
  'Concluída'
];

/// Posição do status em [deliverySteps]; -1 para cancelada/recusada (fora do
/// fluxo).
int deliveryStepIndex(String status) {
  switch (status) {
    case 'CANCELADA':
    case 'RECUSADA':
      return -1;
    case 'CHEGOU':
      return 1;
    case 'AGUARDANDO_AUTORIZACAO':
    case 'AUTORIZADA':
    case 'RETIRADA_NA_PORTARIA':
      return 2;
    case 'CONCLUIDA':
      return 3;
    default:
      return 0;
  }
}

DateTime? _parse(String? iso) {
  if (iso == null) return null;
  return DateTime.tryParse(iso)?.toLocal();
}

String _hm(DateTime d) => DateFormat('HH:mm').format(d);

/// Tempo relativo curto: 'agora', 'há 5 min', 'há 2 h', 'hoje 14:30',
/// 'ontem 14:30', 'dd/MM HH:mm' (e equivalentes no futuro: 'em 20 min',
/// 'amanhã 09:00'). Valor que não é data volta como veio.
String relativeTime(String iso, {DateTime? now}) {
  final date = _parse(iso);
  if (date == null) return iso;
  final ref = now ?? DateTime.now();
  final diff = ref.difference(date);

  if (diff.inSeconds.abs() < 60) return 'agora';
  if (!diff.isNegative) {
    if (diff.inMinutes < 60) return 'há ${diff.inMinutes} min';
    if (diff.inHours < 6) return 'há ${diff.inHours} h';
  } else if (-diff.inMinutes < 60) {
    return 'em ${-diff.inMinutes} min';
  }

  final today = DateTime(ref.year, ref.month, ref.day);
  final day = DateTime(date.year, date.month, date.day);
  final days = day.difference(today).inDays;
  if (days == 0) return 'hoje ${_hm(date)}';
  if (days == -1) return 'ontem ${_hm(date)}';
  if (days == 1) return 'amanhã ${_hm(date)}';
  if (date.year != ref.year) {
    return DateFormat('dd/MM/yyyy HH:mm').format(date);
  }
  return DateFormat('dd/MM HH:mm').format(date);
}

/// Data absoluta 'dd/MM/yyyy HH:mm'; valor que não é data volta como veio.
String formatDeliveryDate(String iso) {
  final date = _parse(iso);
  return date == null ? iso : DateFormat('dd/MM/yyyy HH:mm').format(date);
}

/// Momento mostrado no card da lista: a previsão quando o aviso ainda está
/// em andamento e ela é futura (ou recente), senão quando o aviso foi criado.
String? deliveryTimeLabel(DeliveryModel delivery, {DateTime? now}) {
  final ref = now ?? DateTime.now();
  final previsao = _parse(delivery.previsaoEm);
  if (isAtiva(delivery.status) &&
      previsao != null &&
      previsao.isAfter(ref.subtract(const Duration(hours: 1)))) {
    return 'Previsão ${relativeTime(delivery.previsaoEm!, now: ref)}';
  }
  final created = delivery.createdAt;
  if (created == null || _parse(created) == null) return null;
  return relativeTime(created, now: ref);
}

int _newestFirst(DeliveryModel a, DeliveryModel b) {
  final da = _parse(a.createdAt);
  final db = _parse(b.createdAt);
  if (da != null && db != null) {
    final byDate = db.compareTo(da);
    if (byDate != 0) return byDate;
  } else if (da != null) {
    return -1;
  } else if (db != null) {
    return 1;
  }
  return (b.id ?? 0).compareTo(a.id ?? 0);
}

int _priority(DeliveryModel d) {
  if (d.canRespond) return 0;
  if (d.status == 'CHEGOU') return 1;
  return 2;
}

/// Separa as abas da lista: ativas (resposta pendente, depois chegou, depois
/// o resto; mais novo primeiro em cada grupo) e histórico (mais novo primeiro).
({List<DeliveryModel> ativas, List<DeliveryModel> historico}) splitDeliveries(
    List<DeliveryModel> deliveries) {
  final ativas = deliveries.where((d) => isAtiva(d.status)).toList()
    ..sort((a, b) {
      final byPriority = _priority(a).compareTo(_priority(b));
      return byPriority != 0 ? byPriority : _newestFirst(a, b);
    });
  final historico = deliveries.where((d) => !isAtiva(d.status)).toList()
    ..sort(_newestFirst);
  return (ativas: ativas, historico: historico);
}

/// Ícone de cada etapa de [deliverySteps].
IconData deliveryStepIcon(int step) {
  switch (step) {
    case 1:
      return PhosphorIcons.door;
    case 2:
      return PhosphorIcons.shieldCheck;
    case 3:
      return PhosphorIcons.checkCircle;
    default:
      return PhosphorIcons.calendarCheck;
  }
}

const _statusDoFluxo = {
  'AGENDADA',
  'CHEGOU',
  'AGUARDANDO_AUTORIZACAO',
  'AUTORIZADA',
  'RETIRADA_NA_PORTARIA',
  'CONCLUIDA',
};

/// Quando cada etapa foi alcançada (ISO do primeiro evento dela), ou null.
/// O aviso usa a criação quando não há evento AGENDADA.
List<String?> deliveryStepTimes(DeliveryModel delivery) {
  final times = List<String?>.filled(deliverySteps.length, null);
  for (final event in delivery.eventos) {
    if (!_statusDoFluxo.contains(event.statusNovo)) continue;
    final step = deliveryStepIndex(event.statusNovo);
    times[step] ??= event.createdAt;
  }
  times[0] ??= delivery.createdAt;
  return times;
}

/// Horário curto para debaixo da etapa: 'HH:mm' no dia, 'dd/MM' em outros.
String formatStepTime(String iso, {DateTime? now}) {
  final date = _parse(iso);
  if (date == null) return '';
  final ref = now ?? DateTime.now();
  final sameDay =
      date.year == ref.year && date.month == ref.month && date.day == ref.day;
  return DateFormat(sameDay ? 'HH:mm' : 'dd/MM').format(date);
}

/// Quando o aviso entrou no status atual: último evento desse status.
String? _currentStatusTime(DeliveryModel delivery) {
  for (final event in delivery.eventos.reversed) {
    if (event.statusNovo == delivery.status && _parse(event.createdAt) != null) {
      return event.createdAt;
    }
  }
  return null;
}

/// 'há 5 min' / 'hoje 14:30' / 'ontem 14:30' / 'em 27/09 10:00'.
String _quando(String iso, DateTime now) {
  final rel = relativeTime(iso, now: now);
  return rel.contains('/') ? 'em $rel' : rel;
}

/// Linha de contexto do card principal dos detalhes, p.ex.
/// 'Concluída às 21:22 · há 1 h', 'Chegou há 5 min', 'Aviso para hoje 14:30'.
String deliveryContextLine(DeliveryModel delivery, {DateTime? now}) {
  final ref = now ?? DateTime.now();
  final status = delivery.status;
  final time = _currentStatusTime(delivery);

  if (status == 'CONCLUIDA') {
    final date = _parse(time);
    if (date == null) return 'Entrega concluída';
    final rel = relativeTime(time!, now: ref);
    final sameDay =
        date.year == ref.year && date.month == ref.month && date.day == ref.day;
    if (!sameDay) return 'Concluída ${_quando(time, ref)}';
    final recente = rel == 'agora' || rel.startsWith('há');
    return recente ? 'Concluída às ${_hm(date)} · $rel' : 'Concluída às ${_hm(date)}';
  }

  // Status desconhecido é tratado como aviso agendado (igual ao rótulo).
  final agendada = status == 'AGENDADA' ||
      !(_statusDoFluxo.contains(status) || _encerrados.contains(status));
  if (agendada) {
    final previsao = delivery.previsaoEm;
    if (_parse(previsao) != null) {
      final rel = relativeTime(previsao!, now: ref);
      final relativo = rel == 'agora' || rel.startsWith('há') || rel.startsWith('em ');
      return relativo ? 'Previsão $rel' : 'Aviso para ${rel.contains('/') ? 'o dia $rel' : rel}';
    }
    final criado = time ?? delivery.createdAt;
    if (_parse(criado) != null) return 'Avisado ${_quando(criado!, ref)}';
    return 'Aguardando o entregador';
  }

  const prefixos = {
    'CHEGOU': 'Chegou',
    'AGUARDANDO_AUTORIZACAO': 'Autorização pedida',
    'AUTORIZADA': 'Autorizada',
    'RETIRADA_NA_PORTARIA': 'Deixada na portaria',
    'CANCELADA': 'Cancelada',
    'RECUSADA': 'Recusada',
  };
  final prefixo = prefixos[status] ?? deliveryStatusLabel(status);
  return time == null ? prefixo : '$prefixo ${_quando(time, ref)}';
}

/// Card "O que acontece agora?": ícone e uma ou duas frases por status.
({IconData icon, String text}) deliveryNextStep(DeliveryModel delivery) {
  switch (delivery.status) {
    case 'CHEGOU':
      return (
        icon: PhosphorIcons.door,
        text: 'O entregador está na portaria. A portaria vai pedir sua autorização.',
      );
    case 'AGUARDANDO_AUTORIZACAO':
      return (
        icon: PhosphorIcons.handPalm,
        text: 'A portaria só libera a entrada depois da sua resposta.',
      );
    case 'AUTORIZADA':
      return delivery.modoEntrega == 'PORTARIA'
          ? (
              icon: PhosphorIcons.storefront,
              text: 'Entrega liberada. Ela vai ficar na portaria para você retirar.',
            )
          : (
              icon: PhosphorIcons.personSimpleWalk,
              text: 'Entrega liberada. O entregador está a caminho do seu apartamento.',
            );
    case 'RETIRADA_NA_PORTARIA':
      return (
        icon: PhosphorIcons.storefront,
        text: 'Sua entrega ficou na portaria. Retire quando puder.',
      );
    case 'CONCLUIDA':
      return (icon: PhosphorIcons.checkCircle, text: 'Tudo certo — nada a fazer.');
    case 'CANCELADA':
      return (
        icon: PhosphorIcons.prohibit,
        text: 'Este aviso foi cancelado. Se ainda precisar, avise uma nova entrega.',
      );
    case 'RECUSADA':
      return (
        icon: PhosphorIcons.xCircle,
        text: 'A entrega foi recusada e o entregador não foi liberado. '
            'Se precisar, avise uma nova entrega.',
      );
    default:
      return (
        icon: PhosphorIcons.bellRinging,
        text: 'Avisamos a portaria. Quando o entregador chegar, você será notificado.',
      );
  }
}

const _meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/// Cabeçalho de dia da lista: 'Hoje', 'Ontem', '27 de set' (com o ano quando
/// é outro ano) ou 'Sem data'.
String deliveryDayLabel(DateTime? date, {DateTime? now}) {
  if (date == null) return 'Sem data';
  final ref = now ?? DateTime.now();
  final today = DateTime(ref.year, ref.month, ref.day);
  final days = DateTime(date.year, date.month, date.day).difference(today).inDays;
  if (days == 0) return 'Hoje';
  if (days == -1) return 'Ontem';
  final base = '${date.day} de ${_meses[date.month - 1]}';
  return date.year == ref.year ? base : '$base de ${date.year}';
}

/// Agrupa por dia de criação mantendo a ordem em que cada dia aparece pela
/// primeira vez (a ordenação das abas continua valendo).
List<({String label, List<DeliveryModel> items})> groupDeliveriesByDay(
    List<DeliveryModel> deliveries,
    {DateTime? now}) {
  final groups = <String, List<DeliveryModel>>{};
  for (final d in deliveries) {
    final label = deliveryDayLabel(_parse(d.createdAt), now: now);
    groups.putIfAbsent(label, () => []).add(d);
  }
  return [for (final e in groups.entries) (label: e.key, items: e.value)];
}

/// Resumo do topo das ativas ('1 aguardando você', '2 em andamento',
/// '3 concluídas'); contagens zeradas não aparecem.
List<String> deliverySummary(List<DeliveryModel> deliveries) {
  final aguardando = deliveries.where((d) => d.canRespond).length;
  final andamento =
      deliveries.where((d) => isAtiva(d.status) && !d.canRespond).length;
  final concluidas = deliveries.where((d) => d.status == 'CONCLUIDA').length;
  return [
    if (aguardando > 0) '$aguardando aguardando você',
    if (andamento > 0) '$andamento em andamento',
    if (concluidas > 0) '$concluidas ${concluidas == 1 ? 'concluída' : 'concluídas'}',
  ];
}

/// Selo (pílula) com o status: ponto colorido ou ícone + rótulo curto.
class DeliveryStatusBadge extends StatelessWidget {
  final String status;
  final bool showIcon;

  const DeliveryStatusBadge(
      {super.key, required this.status, this.showIcon = false});

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(status);
    final fg = style.foreground(context);
    return Semantics(
      label: 'Status: ${style.label}',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: style.color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: style.color.withValues(alpha: 0.28)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (showIcon)
            Icon(style.icon, size: 12, color: fg)
          else
            Container(
              width: 6,
              height: 6,
              decoration:
                  BoxDecoration(color: style.color, shape: BoxShape.circle),
            ),
          const SizedBox(width: 5),
          // Flexible: em espaço apertado o rótulo encurta em vez de estourar.
          Flexible(
            child: Text(
              style.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.tiny(context).copyWith(
                  color: fg, fontWeight: FontWeight.w700, letterSpacing: 0.1),
            ),
          ),
        ]),
      ),
    );
  }
}
