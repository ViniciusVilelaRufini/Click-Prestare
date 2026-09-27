import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_details_page.dart';
import 'package:click/pages/shared/delivery/delivery_form_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
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

class ListDeliveryState extends State<ListDelivery> {
  List<DeliveryModel> _deliveries = const [];
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    loadList();
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
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
      body: _loading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 5,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : _error != null
              ? _DeliveryError(message: _error!, onRetry: loadList)
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: _deliveries.isEmpty
                      ? _DeliveryEmpty(onCreate: () => openAddDelivery(context))
                      : ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          itemCount: _deliveries.length,
                          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                          itemBuilder: (_, index) => _DeliveryCard(
                            delivery: _deliveries[index],
                            onTap: () => Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => DeliveryDetailsPage(delivery: _deliveries[index], onChanged: loadList)),
                            ).then((_) => loadList()),
                          ),
                        ),
                ),
    );
  }
}

class _DeliveryCard extends StatelessWidget {
  final DeliveryModel delivery;
  final VoidCallback onTap;
  const _DeliveryCard({required this.delivery, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: AppRadius.rlg,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: AppRadius.rlg),
          child: Row(children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: .1), borderRadius: AppRadius.rmd),
              child: const Icon(PhosphorIcons.package, color: AppColors.primary),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(delivery.estabelecimento?.trim().isNotEmpty == true ? delivery.estabelecimento! : 'Entrega avisada', style: AppTypography.bodyMedium(context)),
              const SizedBox(height: AppSpacing.xs),
              Text(delivery.statusLabel, style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
            ])),
            const Icon(PhosphorIcons.caretRight, size: 18),
          ]),
        ),
      );
}

class _DeliveryEmpty extends StatelessWidget {
  final VoidCallback onCreate;
  const _DeliveryEmpty({required this.onCreate});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(PhosphorIcons.package, size: 56, color: AppColors.primary),
            const SizedBox(height: AppSpacing.lg),
            Text('Nenhum aviso de entrega', style: AppTypography.title(context)),
            const SizedBox(height: AppSpacing.sm),
            Text('Avise a portaria quando sua entrega estiver a caminho.', textAlign: TextAlign.center, style: AppTypography.bodySecondary(context)),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(onPressed: onCreate, child: const Text('Avisar entrega')),
          ]),
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
            const Icon(PhosphorIcons.warningCircle, size: 48, color: AppColors.error),
            const SizedBox(height: AppSpacing.md),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(onPressed: onRetry, child: const Text('Tentar novamente')),
          ]),
        ),
      );
}
