import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/docs/list_atas.dart';
import 'package:click/pages/shared/docs/list_contatos.dart';
import 'package:click/pages/shared/docs/new_document.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_filtro_meses.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListDocs extends StatefulWidget {
  const ListDocs({super.key});
  @override
  _ListDocsPageState createState() => _ListDocsPageState();
}

class _ListDocsPageState extends State<ListDocs> {
  List<dynamic> list = [];
  bool _isLoading = false;
  DateTime? _selectedMonth;

  List<dynamic> _getFilteredList() {
    if (_selectedMonth == null) return list;
    return list.where((item) {
      if (item['created_at'] == null) return false;
      try {
        final date = DateTime.parse(item['created_at'].toString()).toLocal();
        return date.month == _selectedMonth!.month && date.year == _selectedMonth!.year;
      } catch (_) {
        return false;
      }
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAllDocs("documentos", 0);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> delete(int index) async {
    final choice = await showConfirmDialog(context);
    if (choice != true) return;
    setState(() => _isLoading = true);
    final res = await apiDeleteObject('documentos', index);
    if (mounted) setState(() => _isLoading = false);
    if (res) {
      loadList();
    } else {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final filteredList = _getFilteredList();

    return AppScaffold(
      title: getText('docs_nav'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewDocument(is_ata: false)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.brand,
              child: Icon(PhosphorIcons.plus, color: AppColors.onBrand),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : Column(
              children: [
                AppFiltroMeses(
                  selecionado: _selectedMonth,
                  onChanged: (m) => setState(() => _selectedMonth = m),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: loadList,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg,
                          isSindico ? fabClearance(context) : AppSpacing.lg),
                      children: [
                        // Atalhos fixos primeiro: são a navegação da tela e não
                        // dependem do período nem de haver documentos.
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: _DocCard(
                            item: {'nome': 'Atas'},
                            icon: PhosphorIcons.fileText,
                            showArrow: true,
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ListAtas())),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: _DocCard(
                            item: {'nome': getText('contatos_nav')},
                            icon: PhosphorIcons.addressBook,
                            showArrow: true,
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ListContatos())),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: AppSpacing.md, bottom: AppSpacing.sm),
                          child: Semantics(
                            header: true,
                            child: Text('DOCUMENTOS', style: AppTypography.label(context)),
                          ),
                        ),
                        if (filteredList.isEmpty)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                            child: Column(children: [
                              Icon(PhosphorIcons.folder, size: 40, color: AppColors.textTertiary(context)),
                              const SizedBox(height: AppSpacing.md),
                              Text(
                                _selectedMonth == null
                                    ? 'Nenhum documento enviado ainda.'
                                    : 'Nenhum documento neste período.',
                                textAlign: TextAlign.center,
                                style: AppTypography.caption(context),
                              ),
                            ]),
                          ),
                        for (var item in filteredList)
                          Padding(
                            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                            child: _DocCard(
                              item: item,
                              onTap: () => launchInBrowser(item['link_doc'], context),
                              onDelete: isSindico ? () => delete(item['id']) : null,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

}

class _DocCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  final VoidCallback? onDelete;
  final bool showArrow;
  /// Atalhos (Atas/Contatos) usam ícone próprio; documento comum fica no PDF.
  final IconData? icon;
  const _DocCard({required this.item, this.onTap, this.onDelete, this.showArrow = false, this.icon});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.zero),
              child: Icon(icon ?? PhosphorIcons.filePdf, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(item['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            if (onDelete != null)
              IconButton(
                icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.textTertiary(context)),
                onPressed: onDelete,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            if (showArrow || onDelete == null)
              Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}
