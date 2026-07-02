import 'dart:io';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/singleton.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
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

  bool _isExporting = false;

  /// Baixa o livro caixa (CSV) do mês selecionado e abre no app padrão.
  Future<void> _exportCsv() async {
    if (mes.isEmpty || ano.isEmpty) return;
    try {
      setState(() => _isExporting = true);
      final bytes = await apiExportLivroCaixaCsv(mes, ano);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/livro_caixa_$mes-$ano.csv');
      await file.writeAsBytes(bytes);
      if (mounted) setState(() => _isExporting = false);
      await OpenFilex.open(file.path);
    } catch (e) {
      if (mounted) {
        setState(() => _isExporting = false);
        displayMessage(context, getText('alert_error'),
            e.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  /// Fecha ou reabre a competência do mês selecionado. Mês fechado bloqueia
  /// lançamentos/edições no backend (FechamentoService).
  Future<void> _gerenciarFechamento() async {
    if (mes.isEmpty || ano.isEmpty) return;
    List<dynamic> fechamentos = [];
    try {
      fechamentos = await apiListarFechamentos() as List<dynamic>;
    } catch (e) {
      displayMessage(context, getText('alert_error'),
          e.toString().replaceFirst('Exception: ', ''));
      return;
    }
    if (!mounted) return;

    final mesInt = int.tryParse(mes) ?? 0;
    final anoInt = int.tryParse(ano) ?? 0;
    final fechado = fechamentos.any((f) =>
        f['mes'] == mesInt && f['ano'] == anoInt && (f['ativo'] == 1 || f['ativo'] == true));

    final txtMotivo = TextEditingController();
    final confirmou = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: AppColors.surface(c),
        title: Text(fechado ? 'Reabrir competência' : 'Fechar competência',
            style: AppTypography.title(c)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              fechado
                  ? 'O mês $mes/$ano está FECHADO. Reabrir permite lançamentos e edições novamente (exige motivo).'
                  : 'Fechar o mês $mes/$ano bloqueia novos lançamentos e edições na competência.',
              style: AppTypography.caption(c),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: txtMotivo,
              decoration: InputDecoration(
                  labelText: fechado ? 'Motivo da reabertura (obrigatório)' : 'Observação (opcional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(c, true),
            child: Text(fechado ? 'Reabrir' : 'Fechar Mês'),
          ),
        ],
      ),
    );
    if (confirmou != true || !mounted) return;

    if (fechado && txtMotivo.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe o motivo da reabertura.');
      return;
    }

    final res = fechado
        ? await apiReabrirMes(mesInt, anoInt, txtMotivo.text.trim())
        : await apiFecharMes(mesInt, anoInt, txtMotivo.text.trim().isEmpty ? null : txtMotivo.text.trim());
    if (!mounted) return;
    if (res['ok'] == true) {
      displayMessage(context, getText('alert'),
          fechado ? 'Competência reaberta.' : 'Competência fechada.');
    } else {
      displayMessage(context, getText('alert_error'), res['message'].toString());
    }
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
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _isExporting ? null : _exportCsv,
                            icon: _isExporting
                                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Icon(PhosphorIcons.fileCsv, size: 18, color: AppColors.primary),
                            label: const Text('Exportar CSV', style: TextStyle(color: AppColors.primary)),
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: AppColors.primary),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _gerenciarFechamento,
                            icon: const Icon(PhosphorIcons.lockKey, size: 18, color: AppColors.primary),
                            label: const Text('Fechamento', style: TextStyle(color: AppColors.primary)),
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: AppColors.primary),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (chartData.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                        decoration: BoxDecoration(
                          color: AppColors.surface(context), 
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: SfCircularChart(
                          margin: EdgeInsets.zero,
                          legend: Legend(
                            isVisible: true,
                            position: LegendPosition.bottom,
                            textStyle: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
                          ),
                          annotations: <CircularChartAnnotation>[
                            CircularChartAnnotation(
                              widget: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    getText('financeiro_resultado_periodo').toUpperCase(),
                                    style: AppTypography.tiny(context).copyWith(
                                      color: AppColors.textTertiary(context),
                                      fontSize: 8,
                                      letterSpacing: 1.1,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    resultObj != null ? _moeda(resultObj['saldoReal'] ?? 'R\$ 0,00') : 'R\$ 0,00',
                                    style: AppTypography.bodyMedium(context).copyWith(
                                      color: resultObj != null && (resultObj['saldoReal'] ?? '').toString().contains('-') 
                                          ? AppColors.error 
                                          : const Color(0xFF22C55E),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 15,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          series: [
                            DoughnutSeries<ChartData, String>(
                              dataSource: chartData,
                              xValueMapper: (d, _) => d.x,
                              yValueMapper: (d, _) => d.y,
                              innerRadius: '75%',
                              radius: '90%',
                              strokeWidth: 3,
                              strokeColor: AppColors.surface(context),
                              pointColorMapper: (d, i) {
                                final colors = [
                                  const Color(0xFF3B82F6), // Blue
                                  const Color(0xFF10B981), // Emerald Green
                                  const Color(0xFFF59E0B), // Amber
                                  const Color(0xFFEF4444), // Red
                                  const Color(0xFF8B5CF6), // Purple
                                  const Color(0xFFEC4899), // Pink
                                  const Color(0xFF14B8A6), // Teal
                                  const Color(0xFF6366F1), // Indigo
                                ];
                                return colors[i % colors.length];
                              },
                              dataLabelSettings: const DataLabelSettings(isVisible: false),
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
