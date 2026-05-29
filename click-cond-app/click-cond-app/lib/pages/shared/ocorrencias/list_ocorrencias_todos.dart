import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListOcorrenciasTodos extends StatefulWidget {
  const ListOcorrenciasTodos({Key? key}) : super(key: key);
  @override
  _ListOcorrenciasTodosPageState createState() => _ListOcorrenciasTodosPageState();
}

class _ListOcorrenciasTodosPageState extends State<ListOcorrenciasTodos> {
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
        final date = DateTime.parse(item['created_at'].toString());
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
      list = await apiGetAll("ocorrencias/todos");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: 8,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, __) => AppSkeleton.listTile(context),
      );
    }

    final filteredList = _getFilteredList();
    final months = _getMonths();

    return Column(
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
        
        // Lista
        Expanded(
          child: filteredList.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(PhosphorIcons.warning, size: 48, color: AppColors.textTertiary(context)),
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        _selectedMonth == null 
                            ? getText('alert_list_empty_generic')
                            : 'Nenhuma ocorrência encontrada neste mês.',
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
                    itemBuilder: (_, i) => _OcorrenciaCard(
                      item: filteredList[i],
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => DetailOcorrencia(id: filteredList[i]['id'])),
                      ).then((_) => loadList()),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

}

class _OcorrenciaCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _OcorrenciaCard({required this.item, required this.onTap});

  Color _statusColor(dynamic status) {
    final s = status?.toString() ?? '';
    if (s == '1' || s.toLowerCase() == 'resolvida') return const Color(0xFF22C55E);
    return const Color(0xFFF59E0B);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: _statusColor(item['status']).withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(PhosphorIcons.warning, color: _statusColor(item['status']), size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(item['tipo'] ?? item['descricao'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: (item['publica'] == true) 
                              ? const Color(0xFF22C55E).withOpacity(0.12) 
                              : AppColors.textTertiary(context).withOpacity(0.08),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          (item['publica'] == true) ? 'Pública' : 'Privada',
                          style: AppTypography.captionMedium(context).copyWith(
                            color: (item['publica'] == true) 
                                ? const Color(0xFF22C55E) 
                                : AppColors.textSecondary(context),
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (item['descricao'] != null)
                    Text(item['descricao'], style: AppTypography.caption(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (item['criado_por'] != null && item['criado_por'].toString().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'Autor: ${item['criado_por']}',
                        style: AppTypography.caption(context).copyWith(fontSize: 10, color: AppColors.textSecondary(context)),
                      ),
                    ),
                ],
              ),
            ),
            Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}
