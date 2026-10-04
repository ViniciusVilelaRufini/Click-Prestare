import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DeliveryDetailsPage extends StatefulWidget {
  final DeliveryModel delivery;
  final VoidCallback? onChanged;

  const DeliveryDetailsPage({super.key, required this.delivery, this.onChanged});

  @override
  State<DeliveryDetailsPage> createState() => _DeliveryDetailsPageState();
}

class _DeliveryDetailsPageState extends State<DeliveryDetailsPage> {
  bool _cancelling = false;
  bool _respondendo = false;

  Future<void> _responder(bool autorizar) async {
    if (!autorizar) {
      final confirmed = await showConfirmDialog(
        context,
        text: 'Recusar esta entrega? A portaria será avisada.',
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() => _respondendo = true);
    final result = await apiResponderDelivery(widget.delivery, autorizar: autorizar);
    if (!mounted) return;
    setState(() => _respondendo = false);
    if (result.success) {
      widget.onChanged?.call();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(autorizar ? 'Entrega autorizada.' : 'Entrega recusada.')));
      Navigator.pop(context, true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result.message ?? 'Não foi possível enviar sua resposta.'),
          backgroundColor: AppColors.error));
    }
  }

  Future<void> _cancel() async {
    final confirmed = await showConfirmDialog(
      context,
      text: 'Deseja cancelar este aviso de entrega? Esta ação só é permitida antes da chegada.',
    );
    if (confirmed != true || !mounted) return;

    setState(() => _cancelling = true);
    final result = await apiCancelDelivery(widget.delivery);
    if (!mounted) return;
    setState(() => _cancelling = false);
    if (result.success) {
      widget.onChanged?.call();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Aviso cancelado.')));
      Navigator.pop(context, true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message ?? 'Não foi possível cancelar o aviso.'), backgroundColor: AppColors.error),
      );
    }
  }

  /// Ações do morador para o status atual; null quando não há nenhuma.
  Widget? _buildActions(DeliveryModel delivery) {
    if (delivery.canRespond) {
      return Row(children: [
        Expanded(
          flex: 2,
          child: AppButton(
            label: 'Recusar',
            icon: PhosphorIcons.x,
            variant: AppButtonVariant.danger,
            onPressed: _respondendo ? null : () => _responder(false),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          flex: 3,
          child: AppButton(
            label: 'Autorizar entrega',
            icon: PhosphorIcons.check,
            loading: _respondendo,
            onPressed: _respondendo ? null : () => _responder(true),
          ),
        ),
      ]);
    }
    if (delivery.canCancel) {
      return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(
          'Você pode cancelar o aviso até o entregador chegar.',
          textAlign: TextAlign.center,
          style: AppTypography.caption(context).copyWith(fontSize: 13),
        ),
        const SizedBox(height: AppSpacing.sm),
        AppButton(
          label: 'Cancelar aviso',
          icon: PhosphorIcons.prohibit,
          variant: AppButtonVariant.danger,
          loading: _cancelling,
          onPressed: _cancelling ? null : _cancel,
        ),
      ]);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final delivery = widget.delivery;
    final actions = _buildActions(delivery);
    final showMotivoInHero = deliveryStepIndex(delivery.status) < 0;
    final motivo = delivery.motivo?.trim();
    final observacao = delivery.observacaoMorador?.trim();
    final estabelecimento = delivery.estabelecimento?.trim();

    return AppScaffold(
      title: 'Detalhes da entrega',
      bottomNavigationBar: actions == null
          ? null
          : _BottomActionBar(key: const Key('delivery-actions-bar'), child: actions),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _StatusHero(delivery: delivery),
            const SizedBox(height: AppSpacing.lg),
            _SectionCard(
              title: 'Informações',
              children: [
                _InfoRow(
                  icon: PhosphorIcons.storefront,
                  label: 'Estabelecimento',
                  value: estabelecimento?.isNotEmpty == true ? estabelecimento! : 'Não informado',
                ),
                _InfoRow(
                  icon: delivery.modoEntrega == 'PORTARIA' ? PhosphorIcons.storefront : PhosphorIcons.house,
                  label: 'Tipo de entrega',
                  value: delivery.modoEntregaLabel,
                ),
                if (delivery.previsaoEm != null)
                  _InfoRow(
                    icon: PhosphorIcons.calendarBlank,
                    label: 'Previsão',
                    value: formatDeliveryDate(delivery.previsaoEm!),
                  ),
                if (observacao?.isNotEmpty ?? false)
                  _InfoRow(icon: PhosphorIcons.chatText, label: 'Observação', value: observacao!),
                if (!showMotivoInHero && (motivo?.isNotEmpty ?? false))
                  _InfoRow(icon: PhosphorIcons.warningCircle, label: 'Motivo', value: motivo!),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            _Timeline(events: delivery.eventos, currentStatus: delivery.status),
          ],
        ),
      ),
    );
  }
}

/// Barra inferior fixa com as ações: sempre visível, acima da área segura.
class _BottomActionBar extends StatelessWidget {
  final Widget child;
  const _BottomActionBar({super.key, required this.child});

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated(context),
          border: Border(top: BorderSide(color: AppColors.border(context))),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
            child: child,
          ),
        ),
      );
}

/// Card principal: status atual em destaque, frase de contexto e as etapas
/// do fluxo (ou o motivo, quando cancelada/recusada).
class _StatusHero extends StatelessWidget {
  final DeliveryModel delivery;
  const _StatusHero({required this.delivery});

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(delivery.status);
    final step = deliveryStepIndex(delivery.status);
    final motivo = delivery.motivo?.trim();
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: style.color.withValues(alpha: 0.10),
        borderRadius: AppRadius.rxl,
        border: Border.all(color: style.color.withValues(alpha: 0.28)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(color: style.color.withValues(alpha: 0.18), shape: BoxShape.circle),
            child: Icon(style.icon, color: style.foreground(context), size: 28),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(delivery.statusLabel,
                  style: AppTypography.headline(context).copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(deliveryStatusDescription(delivery), style: AppTypography.caption(context)),
            ]),
          ),
        ]),
        if (step >= 0) ...[
          const SizedBox(height: AppSpacing.xl),
          _ProgressSteps(current: step, color: style.color, finished: delivery.status == 'CONCLUIDA'),
        ] else if (motivo?.isNotEmpty ?? false) ...[
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surfaceElevated(context).withValues(alpha: 0.7),
              borderRadius: AppRadius.rmd,
            ),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(PhosphorIcons.warningCircle, size: 18, color: style.foreground(context)),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Motivo', style: AppTypography.tiny(context)),
                  const SizedBox(height: 2),
                  Text(motivo!, style: AppTypography.captionMedium(context)),
                ]),
              ),
            ]),
          ),
        ],
      ]),
    );
  }
}

/// Indicador horizontal Aviso → Chegou → Autorização → Concluída.
class _ProgressSteps extends StatelessWidget {
  final int current;
  final Color color;
  final bool finished;
  const _ProgressSteps({required this.current, required this.color, required this.finished});

  @override
  Widget build(BuildContext context) {
    final track = AppColors.textTertiary(context).withValues(alpha: 0.35);
    return Semantics(
      label: 'Etapa ${current + 1} de ${deliverySteps.length}: ${deliverySteps[current]}',
      excludeSemantics: true,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < deliverySteps.length; i++)
          Expanded(
            child: Column(children: [
              Row(children: [
                Expanded(
                  child: i == 0
                      ? const SizedBox.shrink()
                      : Container(height: 3, color: i <= current ? color : track),
                ),
                // Caixa fixa: o halo da etapa atual não desalinha as linhas.
                SizedBox(
                  width: 34,
                  height: 34,
                  child: Center(
                    child: _StepDot(
                      index: i,
                      done: i < current || (finished && i == current),
                      active: i == current,
                      color: color,
                      track: track,
                    ),
                  ),
                ),
                Expanded(
                  child: i == deliverySteps.length - 1
                      ? const SizedBox.shrink()
                      : Container(height: 3, color: i < current ? color : track),
                ),
              ]),
              const SizedBox(height: 6),
              Text(
                deliverySteps[i],
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.tiny(context).copyWith(
                  fontSize: 11,
                  color: i <= current ? AppColors.textPrimary(context) : AppColors.textTertiary(context),
                  fontWeight: i == current ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ]),
          ),
      ]),
    );
  }
}

class _StepDot extends StatelessWidget {
  final int index;
  final bool done;
  final bool active;
  final Color color;
  final Color track;
  const _StepDot({
    required this.index,
    required this.done,
    required this.active,
    required this.color,
    required this.track,
  });

  @override
  Widget build(BuildContext context) {
    if (done) {
      return Container(
        width: 26,
        height: 26,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: const Icon(PhosphorIcons.check, size: 14, color: Colors.white),
      );
    }
    if (active) {
      // Halo em volta da etapa atual.
      return Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(color: color.withValues(alpha: 0.30), shape: BoxShape.circle),
        child: Center(
          child: Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: Center(
              child: Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
              ),
            ),
          ),
        ),
      );
    }
    return Container(
      width: 26,
      height: 26,
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        shape: BoxShape.circle,
        border: Border.all(color: track, width: 2),
      ),
      child: Center(
        child: Text('${index + 1}',
            style: AppTypography.tiny(context).copyWith(fontSize: 11, color: AppColors.textTertiary(context))),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _SectionCard({required this.title, required this.children});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: AppRadius.rlg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.xs),
          ...children,
        ]),
      );
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Semantics(
        label: '$label: $value',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.only(top: AppSpacing.md),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.10),
                borderRadius: AppRadius.rsm,
              ),
              child: Icon(icon, size: 18, color: AppColors.primary),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: AppTypography.tiny(context)),
                const SizedBox(height: 2),
                Text(value, style: AppTypography.body(context).copyWith(fontSize: 15)),
              ]),
            ),
          ]),
        ),
      );
}

class _Timeline extends StatelessWidget {
  final List<DeliveryEvent> events;
  final String currentStatus;
  const _Timeline({required this.events, required this.currentStatus});

  @override
  Widget build(BuildContext context) {
    final items = events.isEmpty ? [DeliveryEvent(statusNovo: currentStatus)] : events;
    return _SectionCard(
      title: 'Linha do tempo',
      children: [
        const SizedBox(height: AppSpacing.md),
        for (var i = 0; i < items.length; i++)
          _TimelineItem(event: items[i], isLast: i == items.length - 1),
      ],
    );
  }
}

class _TimelineItem extends StatelessWidget {
  final DeliveryEvent event;

  /// O último evento é o status atual: ponto com halo e sem linha abaixo.
  final bool isLast;
  const _TimelineItem({required this.event, required this.isLast});

  String? _when() {
    final raw = event.createdAt;
    if (raw == null) return null;
    final relative = relativeTime(raw);
    final absolute = formatDeliveryDate(raw);
    // Datas antigas já saem como dd/MM HH:mm; não repete a data.
    return relative.contains('/') || relative == absolute ? absolute : '$relative · $absolute';
  }

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(event.statusNovo);
    final when = _when();
    final mensagem = event.mensagem?.trim();
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 24,
          child: Column(children: [
            const SizedBox(height: 3),
            Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: isLast ? style.color.withValues(alpha: 0.22) : Colors.transparent,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(color: style.color, shape: BoxShape.circle),
                ),
              ),
            ),
            if (!isLast)
              Expanded(
                child: Container(
                  width: 2,
                  margin: const EdgeInsets.symmetric(vertical: 2),
                  color: AppColors.border(context),
                ),
              ),
          ]),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                deliveryStatusLabel(event.statusNovo),
                style: AppTypography.bodyMedium(context).copyWith(
                  fontSize: 15,
                  fontWeight: isLast ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
              if (when != null) Text(when, style: AppTypography.tiny(context)),
              if (mensagem?.isNotEmpty ?? false) ...[
                const SizedBox(height: 2),
                Text(mensagem!, style: AppTypography.caption(context).copyWith(fontSize: 13)),
              ],
            ]),
          ),
        ),
      ]),
    );
  }
}
