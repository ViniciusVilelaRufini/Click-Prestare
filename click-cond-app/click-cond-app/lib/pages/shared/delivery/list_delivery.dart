import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_details_page.dart';
import 'package:click/pages/shared/delivery/delivery_form_page.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListDelivery extends StatefulWidget {
  final bool hideAppBar;
  final bool showFab;
  const ListDelivery({super.key, this.hideAppBar = false, this.showFab = true});

  @override
  ListDeliveryState createState() => ListDeliveryState();
}

class ListDeliveryState extends State<ListDelivery> with WidgetsBindingObserver {
  List<DeliveryModel> _deliveries = const [];
  String? _error;
  bool _loading = false;

  /// Avisos com resposta (autorizar/recusar) em envio pelo destaque.
  final Set<int?> _respondendo = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    loadList();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// O status muda na portaria enquanto o app está em segundo plano (o push
  /// chega, o morador volta ao app): recarrega em vez de mostrar o antigo.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) loadList();
  }

  Future<void> loadList() async {
    if (_deliveries.isEmpty) setState(() => _loading = true);
    final result = await apiGetDeliveries();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _deliveries = result.deliveries;
      _error = result.message;
    });
  }

  void openAddDelivery(BuildContext context) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const DeliveryFormPage())).then((created) {
      if (created == true) loadList();
    });
  }

  void _openDetails(DeliveryModel delivery) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => DeliveryDetailsPage(delivery: delivery, onChanged: loadList)),
    ).then((_) => loadList());
  }

  /// Mesma resposta dos detalhes (com confirmação para recusar), direto da
  /// lista.
  Future<void> _responder(DeliveryModel delivery, bool autorizar) async {
    if (!autorizar) {
      final confirmed = await showConfirmDialog(
        context,
        text: 'Recusar esta entrega? A portaria será avisada.',
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() => _respondendo.add(delivery.id));
    final result = await apiResponderDelivery(delivery, autorizar: autorizar);
    if (!mounted) return;
    setState(() => _respondendo.remove(delivery.id));
    if (result.success) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(autorizar ? 'Entrega autorizada.' : 'Entrega recusada.')));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result.message ?? 'Não foi possível enviar sua resposta.'),
          backgroundColor: AppColors.error));
    }
    await loadList();
  }

  @override
  Widget build(BuildContext context) {
    final split = splitDeliveries(_deliveries);
    final loaded = !_loading && _error == null;
    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: 'Delivery',
        showBackButton: !widget.hideAppBar,
        safeAreaBottom: !widget.hideAppBar,
        floatingActionButton: widget.showFab
            ? FloatingActionButton.extended(
                onPressed: () => openAddDelivery(context),
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                icon: const Icon(PhosphorIcons.plus),
                label: const Text('Avisar entrega'),
              )
            : null,
        body: Column(
          children: [
            Container(
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                border: Border(bottom: BorderSide(color: AppColors.border(context))),
              ),
              child: TabBar(
                indicatorColor: AppColors.primary,
                indicatorWeight: 3,
                labelColor: AppColors.primary,
                dividerColor: Colors.transparent,
                unselectedLabelColor: AppColors.textSecondary(context),
                labelStyle: AppTypography.captionMedium(context).copyWith(fontWeight: FontWeight.bold),
                unselectedLabelStyle: AppTypography.captionMedium(context),
                tabs: [
                  Tab(text: loaded ? 'Ativas (${split.ativas.length})' : 'Ativas'),
                  Tab(text: loaded ? 'Histórico (${split.historico.length})' : 'Histórico'),
                ],
              ),
            ),
            Expanded(child: _buildBody(split)),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(({List<DeliveryModel> ativas, List<DeliveryModel> historico}) split) {
    if (_loading) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: 5,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
        itemBuilder: (_, __) => AppSkeleton.listTile(context),
      );
    }
    if (_error != null) return _DeliveryError(message: _error!, onRetry: loadList);
    return TabBarView(children: [
      _buildAtivas(split.ativas),
      _buildHistorico(split.historico),
    ]);
  }

  EdgeInsets get _listPadding => EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.lg,
        // Espaço para o FAB não cobrir o último card.
        widget.showFab ? 96 : AppSpacing.lg,
      );

  Widget _buildAtivas(List<DeliveryModel> ativas) {
    if (ativas.isEmpty) {
      return RefreshIndicator(
        onRefresh: loadList,
        child: _TabEmpty(
          icon: PhosphorIcons.package,
          title: 'Nenhuma entrega em andamento',
          message: 'Avise a portaria quando uma entrega estiver a caminho e acompanhe tudo por aqui.',
          actionLabel: 'Avisar entrega',
          onAction: () => openAddDelivery(context),
        ),
      );
    }
    // As que aguardam resposta viram o destaque no topo (já vêm primeiro na
    // ordenação); as demais seguem como cards.
    final pendentes = ativas.where((d) => d.canRespond).toList();
    final demais = ativas.where((d) => !d.canRespond).toList();
    return RefreshIndicator(
      onRefresh: loadList,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: _listPadding,
        children: [
          for (final d in pendentes) ...[
            _RespondBanner(
              delivery: d,
              busy: _respondendo.contains(d.id),
              onOpen: () => _openDetails(d),
              onAuthorize: () => _responder(d, true),
              onRefuse: () => _responder(d, false),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          if (pendentes.isNotEmpty && demais.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: AppSpacing.md),
              child: Text('Em andamento',
                  style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context))),
            ),
          for (final d in demais) ...[
            _DeliveryCard(delivery: d, onTap: () => _openDetails(d)),
            const SizedBox(height: AppSpacing.md),
          ],
        ],
      ),
    );
  }

  Widget _buildHistorico(List<DeliveryModel> historico) {
    if (historico.isEmpty) {
      return RefreshIndicator(
        onRefresh: loadList,
        child: const _TabEmpty(
          icon: PhosphorIcons.clockCounterClockwise,
          title: 'Nenhuma entrega no histórico',
          message: 'Entregas concluídas, canceladas ou recusadas aparecem aqui.',
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: loadList,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: _listPadding,
        itemCount: historico.length,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
        itemBuilder: (_, index) => _DeliveryCard(
          delivery: historico[index],
          onTap: () => _openDetails(historico[index]),
        ),
      ),
    );
  }
}

String _deliveryTitle(DeliveryModel delivery) =>
    delivery.estabelecimento?.trim().isNotEmpty == true ? delivery.estabelecimento!.trim() : 'Entrega avisada';

/// Destaque no topo das ativas: a portaria pediu a autorização do morador.
class _RespondBanner extends StatelessWidget {
  final DeliveryModel delivery;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onAuthorize;
  final VoidCallback onRefuse;

  const _RespondBanner({
    required this.delivery,
    required this.busy,
    required this.onOpen,
    required this.onAuthorize,
    required this.onRefuse,
  });

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(delivery.status);
    final title = _deliveryTitle(delivery);
    final time = deliveryTimeLabel(delivery);
    return Container(
      decoration: BoxDecoration(
        color: style.color.withValues(alpha: 0.10),
        borderRadius: AppRadius.rxl,
        border: Border.all(color: style.color.withValues(alpha: 0.40), width: 1.2),
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            label: 'A portaria aguarda sua resposta: $title. Toque para ver os detalhes.',
            onTap: onOpen,
            excludeSemantics: true,
            child: InkWell(
              onTap: onOpen,
              borderRadius: AppRadius.rmd,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Row(children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: style.color.withValues(alpha: 0.18),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(style.icon, color: style.foreground(context), size: 22),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('A portaria aguarda sua resposta',
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text(
                        time == null ? title : '$title · $time',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.caption(context),
                      ),
                    ]),
                  ),
                  Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
                ]),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(children: [
            Expanded(
              child: AppButton(
                label: 'Recusar',
                icon: PhosphorIcons.x,
                size: AppButtonSize.md,
                variant: AppButtonVariant.danger,
                onPressed: busy ? null : onRefuse,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: AppButton(
                label: 'Autorizar',
                icon: PhosphorIcons.check,
                size: AppButtonSize.md,
                loading: busy,
                onPressed: busy ? null : onAuthorize,
              ),
            ),
          ]),
        ],
      ),
    );
  }
}

class _DeliveryCard extends StatelessWidget {
  final DeliveryModel delivery;
  final VoidCallback onTap;
  const _DeliveryCard({required this.delivery, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final style = DeliveryStatusStyle.of(delivery.status);
    final title = _deliveryTitle(delivery);
    final time = deliveryTimeLabel(delivery);
    final portaria = delivery.modoEntrega == 'PORTARIA';
    final modo = portaria ? 'Na portaria' : 'Na unidade';
    final observacao = delivery.observacaoMorador?.trim();
    final hasObservacao = observacao != null && observacao.isNotEmpty;

    return Semantics(
      button: true,
      label: [
        'Entrega $title',
        'status ${style.label}',
        modo,
        if (time != null) time,
        if (hasObservacao) 'observação: $observacao',
      ].join(', '),
      // excludeSemantics descarta o toque do InkWell: repete aqui.
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.rlg,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: style.color.withValues(alpha: 0.12),
                  borderRadius: AppRadius.rmd,
                ),
                child: Icon(style.icon, color: style.foreground(context), size: 22),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    DeliveryStatusBadge(status: delivery.status),
                  ]),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    _MetaChip(icon: portaria ? PhosphorIcons.storefront : PhosphorIcons.house, label: modo),
                    if (time != null) _MetaChip(icon: PhosphorIcons.clock, label: time),
                  ]),
                  if (hasObservacao) ...[
                    const SizedBox(height: 6),
                    Row(children: [
                      Icon(PhosphorIcons.chatText, size: 14, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          observacao,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.caption(context).copyWith(fontSize: 13),
                        ),
                      ),
                    ]),
                  ],
                ]),
              ),
              const SizedBox(width: AppSpacing.xs),
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MetaChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated(context),
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 12, color: AppColors.textSecondary(context)),
          const SizedBox(width: 4),
          Text(label, style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
        ]),
      );
}

/// Estado vazio de uma aba; rolável para o puxar-para-atualizar funcionar.
class _TabEmpty extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _TabEmpty({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.xxl),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.10),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, size: 36, color: AppColors.primary),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text(title, textAlign: TextAlign.center, style: AppTypography.headline(context)),
                    const SizedBox(height: AppSpacing.sm),
                    Text(message, textAlign: TextAlign.center, style: AppTypography.caption(context)),
                    if (actionLabel != null && onAction != null) ...[
                      const SizedBox(height: AppSpacing.xl),
                      AppButton(
                        label: actionLabel!,
                        icon: PhosphorIcons.plus,
                        size: AppButtonSize.md,
                        fullWidth: false,
                        onPressed: onAction,
                      ),
                    ],
                  ]),
                ),
              ),
            ),
          ],
        ),
      );
}

class _DeliveryError extends StatelessWidget {
  final String message;
  final Future<void> Function() onRetry;
  const _DeliveryError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(color: AppColors.error.withValues(alpha: 0.10), shape: BoxShape.circle),
              child: const Icon(PhosphorIcons.warningCircle, size: 36, color: AppColors.error),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(message, textAlign: TextAlign.center, style: AppTypography.body(context)),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Tentar novamente',
              icon: PhosphorIcons.arrowsClockwise,
              variant: AppButtonVariant.secondary,
              size: AppButtonSize.md,
              fullWidth: false,
              onPressed: onRetry,
            ),
          ]),
        ),
      );
}
