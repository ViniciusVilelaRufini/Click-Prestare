import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/new_votacao.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListEnquetes extends StatefulWidget {
  const ListEnquetes({Key? key}) : super(key: key);
  @override
  _ListEnquetesPageState createState() => _ListEnquetesPageState();
}

class _ListEnquetesPageState extends State<ListEnquetes> {
  List<dynamic> list = [];
  bool _isLoading = false;
  int _selectedMonth = DateTime.now().month;
  int _selectedYear = DateTime.now().year;

  // Generate months: 6 previous + current + 3 ahead
  List<DateTime> get _months {
    final months = <DateTime>[];
    final now = DateTime.now();
    for (int i = -6; i <= 3; i++) {
      int m = now.month + i;
      int y = now.year;
      while (m < 1) { m += 12; y--; }
      while (m > 12) { m -= 12; y++; }
      months.add(DateTime(y, m));
    }
    return months;
  }

  final _monthScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    loadList();
    // Scroll to the current month (index 6) after build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_monthScrollController.hasClients) {
        _monthScrollController.animateTo(
          6 * 76.0,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _monthScrollController.dispose();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAll("assembleias/votacoes/enquetes");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<dynamic> get _filteredList {
    return list.where((item) {
      // Try to parse data_inicio or data_termino field: expected "dd/MM/yyyy"
      final raw = (item['data_inicio'] ?? item['data_termino'] ?? '').toString();
      if (raw.isEmpty) return true;
      try {
        final parts = raw.split('/');
        if (parts.length == 3) {
          final month = int.parse(parts[1]);
          final year = int.parse(parts[2]);
          return month == _selectedMonth && year == _selectedYear;
        }
      } catch (_) {}
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final filtered = _filteredList;

    return AppScaffold(
      title: getText('lb_votacoes'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewVotacao(isEnquete: true)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Month selector ───────────────────────────────────────────
          _MonthStrip(
            months: _months,
            selectedMonth: _selectedMonth,
            selectedYear: _selectedYear,
            scrollController: _monthScrollController,
            onMonthSelected: (dt) => setState(() {
              _selectedMonth = dt.month;
              _selectedYear = dt.year;
            }),
          ),
          // ── List ─────────────────────────────────────────────────────
          Expanded(
            child: _isLoading
                ? ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: 6,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, __) => AppSkeleton.listTile(context),
                  )
                : filtered.isEmpty
                    ? Center(
                        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Icon(PhosphorIcons.chartBar, size: 56, color: AppColors.textTertiary(context)),
                          const SizedBox(height: AppSpacing.md),
                          Text(getText('alert_list_empty_generic'), style: AppTypography.caption(context)),
                        ]),
                      )
                    : RefreshIndicator(
                        onRefresh: loadList,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                          itemBuilder: (_, i) => _EnqueteCard(
                            item: filtered[i],
                            onTap: () => Navigator.push(context,
                                    MaterialPageRoute(builder: (_) => DetailEnquete(id: filtered[i]['id'])))
                                .then((_) => loadList()),
                          ),
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

// ── Month Strip ──────────────────────────────────────────────────────────────

class _MonthStrip extends StatelessWidget {
  final List<DateTime> months;
  final int selectedMonth;
  final int selectedYear;
  final ScrollController scrollController;
  final ValueChanged<DateTime> onMonthSelected;

  const _MonthStrip({
    required this.months,
    required this.selectedMonth,
    required this.selectedYear,
    required this.scrollController,
    required this.onMonthSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 68,
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border(bottom: BorderSide(color: AppColors.border(context))),
      ),
      child: ListView.builder(
        controller: scrollController,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        itemCount: months.length,
        itemBuilder: (_, i) {
          final dt = months[i];
          final isSelected = dt.month == selectedMonth && dt.year == selectedYear;
          final isCurrentMonth = dt.month == DateTime.now().month && dt.year == DateTime.now().year;
          final monthLabel = DateFormat('MMM', 'pt_BR').format(dt);
          final yearLabel = dt.year.toString().substring(2);

          return GestureDetector(
            onTap: () => onMonthSelected(dt),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
              margin: const EdgeInsets.only(right: AppSpacing.sm),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.primary
                    : isCurrentMonth
                        ? AppColors.primary.withOpacity(0.08)
                        : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
                border: isSelected
                    ? null
                    : Border.all(
                        color: isCurrentMonth
                            ? AppColors.primary.withOpacity(0.3)
                            : AppColors.border(context),
                      ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    monthLabel.toUpperCase(),
                    style: AppTypography.caption(context).copyWith(
                      color: isSelected
                          ? Colors.white
                          : isCurrentMonth
                              ? AppColors.primary
                              : AppColors.textSecondary(context),
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                      letterSpacing: 0.5,
                    ),
                  ),
                  Text(
                    yearLabel,
                    style: AppTypography.tiny(context).copyWith(
                      color: isSelected
                          ? Colors.white.withOpacity(0.75)
                          : AppColors.textTertiary(context),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Cards ────────────────────────────────────────────────────────────────────

class _EnqueteCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _EnqueteCard({required this.item, required this.onTap});

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
              decoration: BoxDecoration(color: AppColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
              child: const Icon(PhosphorIcons.chartBar, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['titulo'] ?? item['pergunta'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (item['status'] != null)
                    _StatusBadge(item['status']),
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

class _StatusBadge extends StatelessWidget {
  final dynamic status;
  const _StatusBadge(this.status);
  @override
  Widget build(BuildContext context) {
    final isOpen = status?.toString().toLowerCase() == 'aberta' || status?.toString() == '1';
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isOpen ? const Color(0xFF22C55E).withOpacity(0.1) : AppColors.textTertiary(context).withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        isOpen ? 'Aberta' : 'Encerrada',
        style: AppTypography.tiny(context).copyWith(color: isOpen ? const Color(0xFF22C55E) : AppColors.textTertiary(context)),
      ),
    );
  }
}
