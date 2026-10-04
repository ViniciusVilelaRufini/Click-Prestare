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

/// Frase de contexto para o card de status dos detalhes.
String deliveryStatusDescription(DeliveryModel delivery) {
  switch (delivery.status) {
    case 'CHEGOU':
      return 'O entregador chegou à portaria.';
    case 'AGUARDANDO_AUTORIZACAO':
      return 'A portaria aguarda sua resposta para liberar a entrega.';
    case 'AUTORIZADA':
      return delivery.modoEntrega == 'PORTARIA'
          ? 'Você autorizou. A entrega fica na portaria para você retirar.'
          : 'Você autorizou. O entregador está liberado para subir.';
    case 'RETIRADA_NA_PORTARIA':
      return 'Sua entrega está na portaria aguardando a retirada.';
    case 'CONCLUIDA':
      return 'Entrega finalizada. Tudo certo por aqui!';
    case 'CANCELADA':
      return 'Este aviso foi cancelado.';
    case 'RECUSADA':
      return 'Esta entrega foi recusada.';
    default:
      return 'A portaria já sabe que sua entrega está a caminho.';
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
          Text(
            style.label,
            style: AppTypography.tiny(context).copyWith(
                color: fg, fontWeight: FontWeight.w700, letterSpacing: 0.1),
          ),
        ]),
      ),
    );
  }
}
