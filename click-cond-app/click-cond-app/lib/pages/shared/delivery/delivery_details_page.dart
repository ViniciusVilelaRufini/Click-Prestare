import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_form_page.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

bool _reduceMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

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

  /// Check animado no card principal logo depois de autorizar.
  bool _celebrando = false;

  Future<void> _responder(bool autorizar) async {
    if (autorizar) HapticFeedback.lightImpact();
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
      HapticFeedback.mediumImpact();
      widget.onChanged?.call();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(autorizar ? 'Entrega autorizada.' : 'Entrega recusada.')));
      if (autorizar && !_reduceMotion(context)) {
        setState(() => _celebrando = true);
        await Future<void>.delayed(const Duration(milliseconds: 550));
        if (!mounted) return;
      }
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

  /// Novo aviso a partir de um encerrado, já com o estabelecimento. Criado o
  /// aviso, volta para a lista (que recarrega).
  Future<void> _novaEntrega() async {
    final created = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => DeliveryFormPage(prefillEstablishment: widget.delivery.estabelecimento),
      ),
    );
    if (created != true || !mounted) return;
    widget.onChanged?.call();
    Navigator.pop(context, true);
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
    if (!isAtiva(delivery.status)) {
      return AppButton(
        label: 'Avisar nova entrega',
        icon: PhosphorIcons.plus,
        variant: AppButtonVariant.secondary,
        onPressed: _novaEntrega,
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final delivery = widget.delivery;
    final actions = _buildActions(delivery);

    return AppScaffold(
      title: 'Detalhes da entrega',
      bottomNavigationBar: actions == null
          ? null
          : _BottomActionBar(key: const Key('delivery-actions-bar'), child: actions),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Entrance(index: 0, child: _TrackingHero(delivery: delivery, celebrate: _celebrando)),
            const SizedBox(height: AppSpacing.lg),
            _Entrance(index: 1, child: _NextStepCard(delivery: delivery)),
            const SizedBox(height: AppSpacing.xxl),
            _Entrance(index: 2, child: _InfoGrid(delivery: delivery)),
            const SizedBox(height: AppSpacing.xxl),
            _Entrance(index: 3, child: _Timeline(events: delivery.eventos, currentStatus: delivery.status)),
          ],
        ),
      ),
    );
  }
}

/// Entrada suave e escalonada dos blocos (≤ 300 ms no total).
class _Entrance extends StatelessWidget {
  final int index;
  final Widget child;
  const _Entrance({required this.index, required this.child});

  @override
  Widget build(BuildContext context) {
    if (_reduceMotion(context)) return child;
    final start = (index * 0.15).clamp(0.0, 0.6);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 300),
      curve: Interval(start, 1, curve: Curves.easeOutCubic),
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, (1 - t) * 12), child: child),
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

/// Faixa de rastreio: estabelecimento em destaque, selo do status, linha de
/// contexto e as etapas (ou a faixa "Encerrada").
class _TrackingHero extends StatelessWidget {
  final DeliveryModel delivery;
  final bool celebrate;
  const _TrackingHero({required this.delivery, required this.celebrate});

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(delivery.status);
    final step = deliveryStepIndex(delivery.status);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final reduce = _reduceMotion(context);
    final icon = celebrate
        ? Container(
            key: const ValueKey('celebrate'),
            width: 64,
            height: 64,
            decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle),
            child: const Icon(PhosphorIcons.check, size: 32, color: AppColors.lightTextPrimary),
          )
        : _PulsingIcon(
            key: const ValueKey('status'),
            icon: style.icon,
            color: style.color,
            foreground: style.foreground(context),
            pulse: isAtiva(delivery.status) && !reduce,
          );

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        borderRadius: AppRadius.rxxl,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            style.color.withValues(alpha: dark ? 0.26 : 0.18),
            style.color.withValues(alpha: dark ? 0.08 : 0.04),
          ],
        ),
        border: Border.all(color: style.color.withValues(alpha: 0.25)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          AnimatedSwitcher(
            duration: reduce ? Duration.zero : const Duration(milliseconds: 320),
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: CurvedAnimation(parent: animation, curve: Curves.easeOutBack),
              child: child,
            ),
            child: icon,
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                deliveryTitle(delivery),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.headline(context).copyWith(fontWeight: FontWeight.w700, height: 1.25),
              ),
              const SizedBox(height: AppSpacing.sm),
              DeliveryStatusBadge(status: delivery.status, showIcon: true),
              const SizedBox(height: 6),
              Text(deliveryContextLine(delivery), style: AppTypography.caption(context).copyWith(fontSize: 13)),
            ]),
          ),
        ]),
        const SizedBox(height: AppSpacing.xl),
        if (step >= 0)
          _Stepper(
            current: step,
            color: style.color,
            onColor: style.onColor,
            finished: delivery.status == 'CONCLUIDA',
            times: deliveryStepTimes(delivery),
          )
        else
          _ClosedStrip(delivery: delivery),
      ]),
    );
  }
}

/// Ícone do status num círculo; com [pulse], um anel se expande e some em
/// loop (desligado com "reduzir movimento" e nos status encerrados).
class _PulsingIcon extends StatefulWidget {
  final IconData icon;
  final Color color;
  final Color foreground;
  final bool pulse;
  const _PulsingIcon({
    super.key,
    required this.icon,
    required this.color,
    required this.foreground,
    required this.pulse,
  });

  @override
  State<_PulsingIcon> createState() => _PulsingIconState();
}

class _PulsingIconState extends State<_PulsingIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _PulsingIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (widget.pulse && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.pulse && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 64,
      height: 64,
      child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
        if (widget.pulse)
          AnimatedBuilder(
            key: const Key('delivery-hero-pulse'),
            animation: _controller,
            builder: (context, _) {
              final t = Curves.easeOut.transform(_controller.value);
              return Transform.scale(
                scale: 1 + t * 0.45,
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: widget.color.withValues(alpha: 0.45 * (1 - t)), width: 3),
                  ),
                ),
              );
            },
          ),
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(color: widget.color.withValues(alpha: 0.20), shape: BoxShape.circle),
          child: Icon(widget.icon, color: widget.foreground, size: 30),
        ),
      ]),
    );
  }
}

/// Etapas Aviso → Chegou → Autorização → Concluída, com ícone e horário de
/// cada uma; os trechos até a etapa atual se preenchem ao abrir a tela.
class _Stepper extends StatelessWidget {
  final int current;
  final Color color;
  final Color onColor;
  final bool finished;
  final List<String?> times;

  const _Stepper({
    required this.current,
    required this.color,
    required this.onColor,
    required this.finished,
    required this.times,
  });

  /// Quanto do trecho k (entre a etapa k-1 e k) está preenchido, dado o
  /// progresso [t] da animação (0..1 cobre todos os trechos até a atual).
  double _segment(int k, double t) => (t * current - (k - 1)).clamp(0.0, 1.0);

  @override
  Widget build(BuildContext context) {
    final track = AppColors.textTertiary(context).withValues(alpha: 0.30);
    final reduce = _reduceMotion(context);
    return Semantics(
      label: 'Etapa ${current + 1} de ${deliverySteps.length}: ${deliverySteps[current]}',
      excludeSemantics: true,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: reduce ? 1 : 0, end: 1),
        duration: reduce ? Duration.zero : const Duration(milliseconds: 600),
        curve: Curves.easeInOutCubic,
        builder: (context, t, _) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (var i = 0; i < deliverySteps.length; i++)
            Expanded(
              child: Column(children: [
                SizedBox(
                  height: 44,
                  child: Row(children: [
                    // Metade direita do trecho que chega nesta etapa.
                    Expanded(
                      child: i == 0
                          ? const SizedBox.shrink()
                          : _Line(fill: (_segment(i, t) * 2 - 1).clamp(0.0, 1.0), color: color, track: track),
                    ),
                    _StepDot(
                      step: i,
                      state: i < current || (finished && i == current)
                          ? _StepState.done
                          : i == current
                              ? _StepState.current
                              : _StepState.future,
                      color: color,
                      onColor: onColor,
                      track: track,
                    ),
                    // Metade esquerda do trecho que sai desta etapa.
                    Expanded(
                      child: i == deliverySteps.length - 1
                          ? const SizedBox.shrink()
                          : _Line(fill: (_segment(i + 1, t) * 2).clamp(0.0, 1.0), color: color, track: track),
                    ),
                  ]),
                ),
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
                if (i <= current && times[i] != null)
                  Text(
                    formatStepTime(times[i]!),
                    textAlign: TextAlign.center,
                    style: AppTypography.tiny(context).copyWith(fontSize: 10.5, color: AppColors.textSecondary(context)),
                  ),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  final double fill;
  final Color color;
  final Color track;
  const _Line({required this.fill, required this.color, required this.track});

  @override
  Widget build(BuildContext context) => Container(
        height: 3,
        decoration: BoxDecoration(color: track, borderRadius: BorderRadius.circular(2)),
        child: FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: fill,
          child: Container(decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        ),
      );
}

enum _StepState { done, current, future }

class _StepDot extends StatelessWidget {
  final int step;
  final _StepState state;
  final Color color;
  final Color onColor;
  final Color track;
  const _StepDot({
    required this.step,
    required this.state,
    required this.color,
    required this.onColor,
    required this.track,
  });

  @override
  Widget build(BuildContext context) {
    final icon = deliveryStepIcon(step);
    switch (state) {
      case _StepState.done:
        return Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Icon(icon, size: 16, color: onColor),
        );
      case _StepState.current:
        // Maior e com halo.
        return Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(color: color.withValues(alpha: 0.28), shape: BoxShape.circle),
          child: Center(
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              child: Icon(icon, size: 19, color: onColor),
            ),
          ),
        );
      case _StepState.future:
        return Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated(context),
            shape: BoxShape.circle,
            border: Border.all(color: track, width: 1.5),
          ),
          child: Icon(icon, size: 15, color: AppColors.textTertiary(context)),
        );
    }
  }
}

/// Cancelada/recusada: faixa "Encerrada" com o motivo no lugar das etapas.
class _ClosedStrip extends StatelessWidget {
  final DeliveryModel delivery;
  const _ClosedStrip({required this.delivery});

  @override
  Widget build(BuildContext context) {
    final recusada = delivery.status == 'RECUSADA';
    final tone = recusada ? AppColors.error : AppColors.textSecondary(context);
    final motivo = delivery.motivo?.trim();
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.10),
        borderRadius: AppRadius.rmd,
        border: Border.all(color: tone.withValues(alpha: 0.25)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(recusada ? PhosphorIcons.xCircle : PhosphorIcons.prohibit, size: 20, color: DeliveryStatusStyle.of(delivery.status).foreground(context)),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Encerrada', style: AppTypography.captionMedium(context).copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(
              motivo?.isNotEmpty == true ? motivo! : 'Sem motivo informado.',
              style: AppTypography.caption(context).copyWith(fontSize: 13),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// "O que acontece agora?": o próximo passo em linguagem simples.
class _NextStepCard extends StatelessWidget {
  final DeliveryModel delivery;
  const _NextStepCard({required this.delivery});

  @override
  Widget build(BuildContext context) {
    final next = deliveryNextStep(delivery);
    final style = DeliveryStatusStyle.of(delivery.status);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: _softCard(context),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: style.color.withValues(alpha: 0.14), borderRadius: AppRadius.rmd),
          child: Icon(next.icon, size: 20, color: style.foreground(context)),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('O que acontece agora?',
                style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context), fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(next.text, style: AppTypography.body(context).copyWith(fontSize: 15, height: 1.45)),
          ]),
        ),
      ]),
    );
  }
}

/// Card com profundidade suave: sombra leve no claro, borda no escuro.
BoxDecoration _softCard(BuildContext context) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return BoxDecoration(
    color: dark ? AppColors.surface(context) : AppColors.surfaceElevated(context),
    borderRadius: AppRadius.rlg,
    border: Border.all(color: AppColors.border(context)),
    boxShadow: dark
        ? null
        : [BoxShadow(color: const Color(0xFF64748B).withValues(alpha: 0.08), blurRadius: 16, offset: const Offset(0, 4))],
  );
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Semantics(
          header: true,
          child: Text(text,
              style: AppTypography.captionMedium(context)
                  .copyWith(color: AppColors.textSecondary(context), fontWeight: FontWeight.w700)),
        ),
      );
}

typedef _Tile = ({IconData icon, String label, String value, bool full});

/// Detalhes em grade de 2 colunas (1 coluna em telas estreitas); só entram
/// os blocos com conteúdo.
class _InfoGrid extends StatelessWidget {
  final DeliveryModel delivery;
  const _InfoGrid({required this.delivery});

  @override
  Widget build(BuildContext context) {
    final estabelecimento = delivery.estabelecimento?.trim();
    final observacao = delivery.observacaoMorador?.trim();
    final motivo = delivery.motivo?.trim();
    final previsao = delivery.previsaoEm;
    // Em cancelada/recusada o motivo já aparece na faixa "Encerrada".
    final motivoNoTopo = deliveryStepIndex(delivery.status) < 0;
    final tiles = <_Tile>[
      if (estabelecimento?.isNotEmpty ?? false)
        (icon: PhosphorIcons.storefront, label: 'Estabelecimento', value: estabelecimento!, full: false),
      (
        icon: delivery.modoEntrega == 'PORTARIA' ? PhosphorIcons.storefront : PhosphorIcons.house,
        label: 'Tipo de entrega',
        value: delivery.modoEntregaLabel,
        full: false,
      ),
      if (previsao != null && previsao.trim().isNotEmpty)
        (icon: PhosphorIcons.calendarBlank, label: 'Previsão', value: formatDeliveryDate(previsao), full: false),
      if (observacao?.isNotEmpty ?? false)
        (icon: PhosphorIcons.chatText, label: 'Observação', value: observacao!, full: true),
      if (!motivoNoTopo && (motivo?.isNotEmpty ?? false))
        (icon: PhosphorIcons.warningCircle, label: 'Motivo', value: motivo!, full: true),
    ];

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const _SectionLabel('Detalhes do aviso'),
      LayoutBuilder(builder: (context, constraints) {
        final twoColumns = constraints.maxWidth >= 300;
        final rows = <Widget>[];
        var i = 0;
        while (i < tiles.length) {
          final tile = tiles[i];
          final next = i + 1 < tiles.length ? tiles[i + 1] : null;
          if (twoColumns && !tile.full && next != null && !next.full) {
            rows.add(IntrinsicHeight(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(child: _InfoTile(tile: tile)),
                const SizedBox(width: AppSpacing.md),
                Expanded(child: _InfoTile(tile: next)),
              ]),
            ));
            i += 2;
          } else {
            rows.add(_InfoTile(tile: tile));
            i += 1;
          }
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (var r = 0; r < rows.length; r++) ...[
            if (r > 0) const SizedBox(height: AppSpacing.md),
            rows[r],
          ],
        ]);
      }),
    ]);
  }
}

class _InfoTile extends StatelessWidget {
  final _Tile tile;
  const _InfoTile({required this.tile});

  @override
  Widget build(BuildContext context) => Semantics(
        label: '${tile.label}: ${tile.value}',
        excludeSemantics: true,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: _softCard(context),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(tile.icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              Expanded(child: Text(tile.label, style: AppTypography.tiny(context))),
            ]),
            const SizedBox(height: 6),
            Text(tile.value, style: AppTypography.captionMedium(context).copyWith(fontSize: 14.5)),
          ]),
        ),
      );
}

/// Linha do tempo estilo rastreio: o evento mais recente no topo, em
/// destaque; os anteriores, discretos.
class _Timeline extends StatelessWidget {
  final List<DeliveryEvent> events;
  final String currentStatus;
  const _Timeline({required this.events, required this.currentStatus});

  @override
  Widget build(BuildContext context) {
    final items = events.isEmpty ? [DeliveryEvent(statusNovo: currentStatus)] : events.reversed.toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const _SectionLabel('Linha do tempo'),
      Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: _softCard(context),
        child: Column(children: [
          for (var i = 0; i < items.length; i++)
            _TimelineItem(event: items[i], isLatest: i == 0, isLast: i == items.length - 1),
        ]),
      ),
    ]);
  }
}

class _TimelineItem extends StatelessWidget {
  final DeliveryEvent event;
  final bool isLatest;
  final bool isLast;
  const _TimelineItem({required this.event, required this.isLatest, required this.isLast});

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
    final dotColor = isLatest ? style.color : style.color.withValues(alpha: 0.45);
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 24,
          child: Column(children: [
            const SizedBox(height: 2),
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: isLatest ? style.color.withValues(alpha: 0.22) : Colors.transparent,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Container(
                  width: isLatest ? 12 : 10,
                  height: isLatest ? 12 : 10,
                  decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
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
                  fontWeight: isLatest ? FontWeight.w700 : FontWeight.w500,
                  color: isLatest ? AppColors.textPrimary(context) : AppColors.textSecondary(context),
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
