import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:syncfusion_flutter_charts/charts.dart';

class FinanceiroRelatorio extends StatefulWidget {
  const FinanceiroRelatorio({Key? key}) : super(key: key);
  @override
  _FinanceiroRelatorioPageState createState() => _FinanceiroRelatorioPageState();
}

class _FinanceiroRelatorioPageState extends State<FinanceiroRelatorio> {
  List<dynamic> categorias = [];
  dynamic resultObj;
  final ScrollController _scrollController = ScrollController();
  bool _isLoading = false;
  List<dynamic> titlesTabs = [];
  String tabSelected = "";
  String mes = '';
  String ano = '';
  final List<ChartData> chartData = [];

  @override
  void initState() {
    super.initState();
    loadList();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() { _isLoading = true; chartData.clear(); });
      final locals = await apiGetAllFinanceiro("financeiro/grafico", mes, ano);
      if (locals is Map) {
        resultObj = locals;
        categorias = locals['categorias'] ?? [];
        titlesTabs = locals['meses'] ?? [];
        if (tabSelected.isEmpty && titlesTabs.isNotEmpty) {
          final last = titlesTabs.last;
          tabSelected = last['periodo'];
          mes = last['mes'];
          ano = last['ano'].toString();
        }
        for (final categ in categorias) {
          if (categ is Map) {
            final rawPerc = categ['percentual'];
            final double perc = rawPerc is num ? rawPerc.toDouble() : 0.0;
            chartData.add(ChartData(categ['categoria'] ?? '', perc));
          }
        }
      } else {
        categorias = [];
        titlesTabs = [];
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void changeMonth(String month, String newMes, String newAno) {
    setState(() { tabSelected = month; mes = newMes; ano = newAno; });
    loadList();
  }

  String _moeda(String v) => v.replaceAll("R\$", Singleton.instance.getCurrentMoeda());

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_nav_relatorio'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: loadList,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 38,
                      child: ListView.separated(
                        controller: _scrollController,
                        scrollDirection: Axis.horizontal,
                        itemCount: titlesTabs.length,
                        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
                        itemBuilder: (_, i) {
                          final t = titlesTabs[i];
                          final selected = tabSelected == t['periodo'];
                          return GestureDetector(
                            onTap: selected ? null : () => changeMonth(t['periodo'], t['mes'], t['ano']),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              decoration: BoxDecoration(
                                color: selected 
                                    ? AppColors.primary 
                                    : AppColors.surface(context),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: selected 
                                      ? AppColors.primary 
                                      : AppColors.textSecondary(context).withOpacity(0.1),
                                  width: 1,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Icon(
                                    PhosphorIcons.calendarBlank,
                                    size: 14,
                                    color: selected ? Colors.white : AppColors.textSecondary(context),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    t['periodo'],
                                    style: AppTypography.caption(context).copyWith(
                                      color: selected ? Colors.white : AppColors.textSecondary(context),
                                      fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (chartData.isNotEmpty)
                      Container(
                        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(20)),
                        child: SfCircularChart(
                          margin: EdgeInsets.zero,
                          legend: const Legend(isVisible: true),
                          series: [
                            PieSeries<ChartData, String>(
                              dataSource: chartData,
                              xValueMapper: (d, _) => d.x,
                              yValueMapper: (d, _) => d.y,
                              dataLabelSettings: const DataLabelSettings(isVisible: true),
                            )
                          ],
                        ),
                      ),
                    const SizedBox(height: AppSpacing.lg),
                    if (resultObj != null && resultObj is Map) ...[
                      Text(getText('financeiro_nav_resultado'), style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary)),
                      const SizedBox(height: AppSpacing.md),
                      Container(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
                        child: Column(
                          children: [
                            _ResultRow(label: getText('financeiro_total_receitas'), value: _moeda(resultObj['totalReceitaReal']), valueColor: const Color(0xFF22C55E), extra: resultObj['percentualReceita']),
                            const SizedBox(height: AppSpacing.sm),
                            _ResultRow(label: getText('financeiro_total_despesas'), value: _moeda(resultObj['totalDespesaReal']), valueColor: AppColors.error, extra: resultObj['percentualDespesa']),
                            const Divider(height: AppSpacing.xl),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(getText('financeiro_resultado_periodo'), style: AppTypography.bodyMedium(context)),
                                Text(_moeda(resultObj['saldoReal']), style: AppTypography.headline(context).copyWith(color: AppColors.primary)),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(getText('lb_categorias').toUpperCase(), style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary)),
                      const SizedBox(height: AppSpacing.md),
                      for (final categ in categorias)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(14)),
                            child: Row(
                              children: [
                                Icon(
                                  categ['tipo'] == 'D' ? PhosphorIcons.arrowUp : PhosphorIcons.arrowDown,
                                  color: categ['tipo'] == 'D' ? AppColors.error : const Color(0xFF22C55E),
                                  size: 18,
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Expanded(child: Text(categ['categoria'], style: AppTypography.body(context))),
                                Text(_moeda(categ['saldoReal']), style: AppTypography.captionMedium(context)),
                                const SizedBox(width: AppSpacing.sm),
                                Text(categ['percentualString'], style: AppTypography.tiny(context)),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  final String? extra;
  const _ResultRow({required this.label, required this.value, required this.valueColor, this.extra});
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.body(context)),
        Row(children: [
          Text(value, style: AppTypography.captionMedium(context).copyWith(color: valueColor)),
          if (extra != null) ...[const SizedBox(width: 8), Text(extra!, style: AppTypography.tiny(context))],
        ]),
      ],
    );
  }
}

class ChartData {
  ChartData(this.x, this.y);
  final String x;
  final double? y;
}
