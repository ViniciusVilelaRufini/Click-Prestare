import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
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

  @override
  Widget build(BuildContext context) {
    final delivery = widget.delivery;
    return AppScaffold(
      title: 'Detalhes da entrega',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _StatusCard(delivery: delivery),
            const SizedBox(height: AppSpacing.lg),
            _InfoCard(
              title: 'Aviso',
              children: [
                _InfoLine(label: 'Estabelecimento', value: delivery.estabelecimento ?? 'Não informado'),
                _InfoLine(label: 'Tipo de entrega', value: delivery.modoEntregaLabel),
                if (delivery.previsaoEm != null) _InfoLine(label: 'Previsão', value: _formatDate(delivery.previsaoEm!)),
                if (delivery.observacaoMorador?.trim().isNotEmpty ?? false)
                  _InfoLine(label: 'Observação', value: delivery.observacaoMorador!),
                if (delivery.motivo?.trim().isNotEmpty ?? false) _InfoLine(label: 'Motivo', value: delivery.motivo!),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            _Timeline(events: delivery.eventos, currentStatus: delivery.status),
            if (delivery.canCancel) ...[
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Cancelar aviso',
                variant: AppButtonVariant.danger,
                loading: _cancelling,
                onPressed: _cancelling ? null : _cancel,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final DeliveryModel delivery;
  const _StatusCard({required this.delivery});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: _statusColor(delivery.status).withValues(alpha: 0.10),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: _statusColor(delivery.status).withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Icon(PhosphorIcons.package, color: _statusColor(delivery.status), size: 28),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(delivery.statusLabel, style: AppTypography.title(context).copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: AppSpacing.xs),
                Text('Acompanhe as atualizações da portaria.', style: AppTypography.caption(context)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _InfoCard({required this.title, required this.children});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: AppRadius.rlg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.sm),
          ...children,
        ]),
      );
}

class _InfoLine extends StatelessWidget {
  final String label;
  final String value;
  const _InfoLine({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: AppSpacing.sm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
          const SizedBox(height: 2),
          Text(value, style: AppTypography.body(context)),
        ]),
      );
}

class _Timeline extends StatelessWidget {
  final List<DeliveryEvent> events;
  final String currentStatus;
  const _Timeline({required this.events, required this.currentStatus});

  @override
  Widget build(BuildContext context) {
    final items = events.isEmpty ? [DeliveryEvent(statusNovo: currentStatus)] : events;
    return _InfoCard(
      title: 'Linha do tempo',
      children: items.map((event) => Padding(
        padding: const EdgeInsets.only(top: AppSpacing.md),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(PhosphorIcons.checkCircle, color: _statusColor(event.statusNovo), size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(deliveryStatusLabel(event.statusNovo), style: AppTypography.bodyMedium(context)),
            if (event.createdAt != null) Text(_formatDate(event.createdAt!), style: AppTypography.tiny(context)),
            if (event.mensagem?.trim().isNotEmpty ?? false) Text(event.mensagem!, style: AppTypography.caption(context)),
          ])),
        ]),
      )).toList(),
    );
  }
}

Color _statusColor(String status) {
  switch (status) {
    case 'CONCLUIDA':
      return AppColors.success;
    case 'CANCELADA':
    case 'RECUSADA':
      return AppColors.error;
    case 'AUTORIZADA':
      return AppColors.info;
    default:
      return AppColors.warning;
  }
}

String _formatDate(String raw) {
  final value = DateTime.tryParse(raw);
  return value == null ? raw : DateFormat('dd/MM/yyyy HH:mm').format(value.toLocal());
}
