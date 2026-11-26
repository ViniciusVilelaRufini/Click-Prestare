import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/docs/new_document.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/datas.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_filtro_meses.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Data da ata ("12/11/2026") a partir de `created_at` (a API não manda outra
/// data); vazio se ausente ou inválida.
String formatarDataAta(dynamic valor) {
  final d = parseDataApi(valor);
  if (d == null) return '';
  String pad(int n) => n.toString().padLeft(2, '0');
  return '${pad(d.day)}/${pad(d.month)}/${d.year}';
}

class ListAtas extends StatefulWidget {
  const ListAtas({super.key});
  @override
  _ListAtasPageState createState() => _ListAtasPageState();
}

class _ListAtasPageState extends State<ListAtas> {
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
      list = await apiGetAllDocs("documentos", 1);
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
    if (res) { loadList(); } else {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final filteredList = _getFilteredList();

    return AppScaffold(
      title: getText('docs_nav_atas'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewDocument(is_ata: true)))
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

                // Lista de Atas
                Expanded(
                  child: filteredList.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(PhosphorIcons.fileText, size: 56, color: AppColors.textTertiary(context)),
                              const SizedBox(height: AppSpacing.md),
                              Text(
                                _selectedMonth == null 
                                    ? getText('alert_list_empty_generic')
                                    : 'Nenhuma ata encontrada neste mês.', 
                                style: AppTypography.caption(context),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: loadList,
                          child: ListView.separated(
                            padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, isSindico ? fabClearance(context) : AppSpacing.lg),
                            itemCount: filteredList.length,
                            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                            itemBuilder: (_, i) => GestureDetector(
                              onTap: () => launchInBrowser(filteredList[i]['link_doc'], context),
                              child: Container(
                                padding: const EdgeInsets.all(AppSpacing.md),
                                decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 44, height: 44,
                                      decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.zero),
                                      child: Icon(PhosphorIcons.fileText, color: AppColors.primary, size: 22),
                                    ),
                                    const SizedBox(width: AppSpacing.md),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(filteredList[i]['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                                          if (formatarDataAta(filteredList[i]['created_at']).isNotEmpty) ...[
                                            const SizedBox(height: 2),
                                            Text(formatarDataAta(filteredList[i]['created_at']), style: AppTypography.caption(context)),
                                          ],
                                        ],
                                      ),
                                    ),
                                    if (isSindico)
                                      IconButton(
                                        icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.textTertiary(context)),
                                        onPressed: () => delete(filteredList[i]['id']),
                                        padding: EdgeInsets.zero,
                                        constraints: const BoxConstraints(),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
