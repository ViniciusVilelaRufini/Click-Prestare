import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/comunicados/detail_comunidado.dart';
import 'package:click/pages/shared/comunicados/new_Comunicado.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListComunicados extends StatefulWidget {
  const ListComunicados({Key? key}) : super(key: key);
  @override
  _ListComunicadosPageState createState() => _ListComunicadosPageState();
}

class _ListComunicadosPageState extends State<ListComunicados> {
  List<dynamic> list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      if (list.isEmpty) setState(() => _isLoading = true);
      list = await apiGetAll("comunicados");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = (getUserType() == 'sindico') || getUserPermission('comunicados') == 1;
    return AppScaffold(
      title: getText('lb_comunicados'),
      floatingActionButton: canAdd
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewComunicado(isEdit: false)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : list.isEmpty
              ? _EmptyState(getText('alert_list_empty_generic'))
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) => _ComunicadoCard(
                      item: list[i],
                      onTap: () => Navigator.push(context,
                              MaterialPageRoute(builder: (_) => DetailComunicado(id: list[i]['id'])))
                          .then((_) => loadList()),
                    ),
                  ),
                ),
    );
  }
}

class _ComunicadoCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _ComunicadoCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(PhosphorIcons.megaphone, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['titulo'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(item['descricao'] ?? '', style: AppTypography.caption(context), maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String message;
  const _EmptyState(this.message);
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(PhosphorIcons.megaphone, size: 56, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text(message, style: AppTypography.caption(context), textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
