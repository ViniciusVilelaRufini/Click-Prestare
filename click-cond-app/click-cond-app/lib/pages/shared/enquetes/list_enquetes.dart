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
import 'package:click/widgets/votacao/votacao_card.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListEnquetes extends StatefulWidget {
  const ListEnquetes({super.key});
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
    // Os chips formatam o mês em pt_BR; sem os dados do locale o DateFormat
    // lança. A carga é síncrona para os dados locais do intl.
    initializeDateFormatting('pt_BR');
    loadList();
    // Scroll to the current month (index 6) after build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_monthScrollController.hasClients) {
        _monthScrollController.animateTo(
          6 * _MonthStrip.passo,
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

  void _abrir(dynamic item) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => DetailEnquete(id: item['id'])))
        .then((_) => loadList());
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final filtered = _filteredList;
    // Folga para o FAB do síndico não cobrir o último card.
    final folgaFinal = isSindico ? 88.0 : AppSpacing.xl;

    return AppScaffold(
      title: getText('lb_enquetes'),
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
        crossAxisAlignment: CrossAxisAlignment.stretch,
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
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: 5,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, __) => const _CardSkeleton(),
                  )
                : RefreshIndicator(
                    onRefresh: loadList,
                    child: filtered.isEmpty
                        ? ListView(
                            // Rolável para o "puxar para atualizar" funcionar no vazio.
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, folgaFinal),
                            children: [
                              _EstadoVazio(mes: DateTime(_selectedYear, _selectedMonth)),
                            ],
                          )
                        : ListView.separated(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, folgaFinal),
                            itemCount: filtered.length,
                            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                            itemBuilder: (_, i) {
                              final item = filtered[i];
                              final descricao = (item['descricao'] ?? '').toString().trim();
                              return VotacaoCard.fromItem(
                                item,
                                subtitulo: descricao.isEmpty || descricao == 'null' ? null : descricao,
                                onTap: () => _abrir(item),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}

// ── Month Strip ──────────────────────────────────────────────────────────────

/// Faixa horizontal de meses. Cada chip tem largura fixa ([largura] +
/// [espaco] = [passo]) para o scroll inicial cair exatamente no mês atual.
class _MonthStrip extends StatelessWidget {
  static const double largura = 64;
  static const double espaco = 8;
  static const double passo = largura + espaco;

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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final destaque = corDestaqueVotacao(context);
    final now = DateTime.now();

    return Container(
      height: 72,
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        border: Border(bottom: BorderSide(color: AppColors.border(context))),
      ),
      child: ListView.builder(
        controller: scrollController,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm + 2),
        itemCount: months.length,
        itemBuilder: (_, i) {
          final dt = months[i];
          final isSelected = dt.month == selectedMonth && dt.year == selectedYear;
          final isCurrentMonth = dt.month == now.month && dt.year == now.year;
          final mes = DateFormat('MMM', 'pt_BR').format(dt).replaceAll('.', '');
          final mesLabel = mes.isEmpty ? '' : '${mes[0].toUpperCase()}${mes.substring(1)}';
          final mesLongo = DateFormat('MMMM', 'pt_BR').format(dt);
          final mostrarAno = dt.year != now.year;

          final Color fg = isSelected ? Colors.white : AppColors.textPrimary(context);
          final Color bg = isSelected ? AppColors.primary : AppColors.surface(context);
          final Color borda = isSelected
              ? AppColors.primary
              : isCurrentMonth
                  ? destaque.withValues(alpha: isDark ? 0.6 : 0.45)
                  : AppColors.border(context);

          return Padding(
            padding: const EdgeInsets.only(right: espaco),
            child: Semantics(
              button: true,
              selected: isSelected,
              label: '$mesLongo de ${dt.year}${isCurrentMonth ? ', mês atual' : ''}',
              excludeSemantics: true,
              onTap: () => onMonthSelected(dt),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => onMonthSelected(dt),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOut,
                    width: largura,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: bg,
                      borderRadius: BorderRadius.circular(AppRadius.full),
                      border: Border.all(color: borda, width: isCurrentMonth && !isSelected ? 1.5 : 1),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          mesLabel,
                          maxLines: 1,
                          style: AppTypography.bodyMedium(context).copyWith(
                            fontSize: 14,
                            height: 1.2,
                            color: fg,
                            fontWeight: isSelected || isCurrentMonth ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                        if (mostrarAno)
                          Text(
                            '${dt.year}',
                            maxLines: 1,
                            style: AppTypography.tiny(context).copyWith(
                              height: 1.2,
                              color: isSelected ? Colors.white.withValues(alpha: 0.8) : AppColors.textTertiary(context),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Estados ──────────────────────────────────────────────────────────────────

/// Mesmo contorno do [VotacaoCard] para a troca skeleton → lista não pular.
class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AppSkeleton(width: 44, height: 44, borderRadius: AppRadius.md),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: LayoutBuilder(
              builder: (_, c) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(width: c.maxWidth * 0.85, height: 14),
                  const SizedBox(height: AppSpacing.sm),
                  AppSkeleton(width: c.maxWidth * 0.55, height: 12),
                  const SizedBox(height: AppSpacing.md),
                  const AppSkeleton(width: 96, height: 22, borderRadius: AppRadius.full),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EstadoVazio extends StatelessWidget {
  final DateTime mes;
  const _EstadoVazio({required this.mes});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final mesTxt = DateFormat("MMMM 'de' y", 'pt_BR').format(mes);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xxl),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.chartBar, size: 26, color: corDestaqueVotacao(context)),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            getText('alert_list_empty_generic'),
            textAlign: TextAlign.center,
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Não há enquetes em $mesTxt. Escolha outro mês acima.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }
}
