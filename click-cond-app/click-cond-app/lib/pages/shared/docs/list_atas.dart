import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/docs/new_document.dart';
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

class ListAtas extends StatefulWidget {
  const ListAtas({Key? key}) : super(key: key);
  @override
  _ListAtasPageState createState() => _ListAtasPageState();
}

class _ListAtasPageState extends State<ListAtas> {
  List<dynamic> list = [];
  bool _isLoading = false;
  DateTime? _selectedMonth;

  // Helper para gerar os últimos 12 meses em português
  List<Map<String, dynamic>> _getMonths() {
    final monthsPt = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    List<Map<String, dynamic>> res = [];
    final now = DateTime.now();
    for (int i = 0; i < 12; i++) {
      final date = DateTime(now.year, now.month - i, 1);
      res.add({
        'month': date.month,
        'year': date.year,
        'label': "${monthsPt[date.month - 1]} / ${date.year}",
      });
    }
    return res;
  }

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
    final months = _getMonths();

    return AppScaffold(
      title: getText('docs_nav_atas'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewDocument(is_ata: true)))
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
          : Column(
              children: [
                // Seletor de Meses Premium
                Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: AppColors.textTertiary(context).withOpacity(0.08),
                        width: 1,
                      ),
                    ),
                  ),
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    children: [
                      // Chip "Todos"
                      Padding(
                        padding: const EdgeInsets.only(right: 8.0),
                        child: ChoiceChip(
                          label: const Text('Todos os Meses'),
                          selected: _selectedMonth == null,
                          onSelected: (val) {
                            setState(() => _selectedMonth = null);
                          },
                          selectedColor: AppColors.primary,
                          backgroundColor: AppColors.surface(context),
                          labelStyle: AppTypography.captionMedium(context).copyWith(
                            color: _selectedMonth == null ? Colors.white : AppColors.textSecondary(context),
                            fontWeight: FontWeight.w600,
                          ),
                          side: BorderSide(
                            color: _selectedMonth == null 
                                ? AppColors.primary 
                                : AppColors.textTertiary(context).withOpacity(0.15),
                          ),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                      ),
                      ...months.map((m) {
                        final isSelected = _selectedMonth != null && 
                                           _selectedMonth!.month == m['month'] && 
                                           _selectedMonth!.year == m['year'];
                        return Padding(
                          padding: const EdgeInsets.only(right: 8.0),
                          child: ChoiceChip(
                            label: Text(m['label']),
                            selected: isSelected,
                            onSelected: (val) {
                              setState(() {
                                _selectedMonth = val ? DateTime(m['year'], m['month']) : null;
                              });
                            },
                            selectedColor: AppColors.primary,
                            backgroundColor: AppColors.surface(context),
                            labelStyle: AppTypography.captionMedium(context).copyWith(
                              color: isSelected ? Colors.white : AppColors.textSecondary(context),
                              fontWeight: FontWeight.w600,
                            ),
                            side: BorderSide(
                              color: isSelected 
                                  ? AppColors.primary 
                                  : AppColors.textTertiary(context).withOpacity(0.15),
                            ),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        );
                      }),
                    ],
                  ),
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
                            padding: const EdgeInsets.all(AppSpacing.lg),
                            itemCount: filteredList.length,
                            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                            itemBuilder: (_, i) => GestureDetector(
                              onTap: () => launchInBrowser(filteredList[i]['link_doc'], context),
                              child: Container(
                                padding: const EdgeInsets.all(AppSpacing.md),
                                decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 44, height: 44,
                                      decoration: BoxDecoration(color: AppColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                                      child: const Icon(PhosphorIcons.fileText, color: AppColors.primary, size: 22),
                                    ),
                                    const SizedBox(width: AppSpacing.md),
                                    Expanded(child: Text(filteredList[i]['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                    if (isSindico)
                                      IconButton(
                                        icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.error),
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
