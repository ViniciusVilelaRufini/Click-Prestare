import 'dart:io';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/utils/api_client.dart';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';

class RelatoriosPage extends StatefulWidget {
  const RelatoriosPage({Key? key}) : super(key: key);

  @override
  _RelatoriosPageState createState() => _RelatoriosPageState();
}

class _RelatoriosPageState extends State<RelatoriosPage> {
  String _selectedTipo = 'visitantes';
  DateTime? _dataInicio;
  DateTime? _dataFim;
  bool _isLoadingPdf = false;
  bool _isLoadingXlsx = false;

  final Map<String, Map<String, dynamic>> _categories = {
    'visitantes': {
      'label': 'Visitantes',
      'desc': 'Histórico de controle de acesso de moradores e prestadores.',
      'icon': PhosphorIcons.users,
      'color': Colors.blue,
    },
    'encomendas': {
      'label': 'Encomendas',
      'desc': 'Entradas, entregas e pendências de mercadorias no condomínio.',
      'icon': PhosphorIcons.package,
      'color': AppColors.success,
    },
    'ocorrencias': {
      'label': 'Ocorrências',
      'desc': 'Histórico de ocorrências abertas pelos moradores e resoluções.',
      'icon': PhosphorIcons.warningCircle,
      'color': Colors.amber,
    },
    'financeiro': {
      'label': 'Financeiro',
      'desc': 'Fluxo de despesas, receitas e balanço do condomínio.',
      'icon': PhosphorIcons.wallet,
      'color': Colors.purple,
    },
  };

  Future<void> _selectDate(BuildContext context, bool isInicio) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2101),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.dark(
              primary: AppColors.primary,
              onPrimary: Colors.white,
              surface: AppColors.surface(context),
              onSurface: AppColors.textPrimary(context),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      setState(() {
        if (isInicio) {
          _dataInicio = picked;
        } else {
          _dataFim = picked;
        }
      });
    }
  }

  String _formatDate(DateTime? date) {
    if (date == null) return 'Selecionar';
    return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
  }

  Future<void> _export(String formato) async {
    if (_isLoadingPdf || _isLoadingXlsx) return;

    setState(() {
      if (formato == 'pdf') {
        _isLoadingPdf = true;
      } else {
        _isLoadingXlsx = true;
      }
    });

    try {
      final Map<String, String> queryParams = {
        'tipo': _selectedTipo,
        'formato': formato,
      };

      if (_dataInicio != null) {
        queryParams['dataInicio'] = _dataInicio!.toIso8601String().split('T')[0];
      }
      if (_dataFim != null) {
        queryParams['dataFim'] = _dataFim!.toIso8601String().split('T')[0];
      }

      final url = ApiConfig.buildUri(
        '/condominios/${Singleton.instance.id_condominio}/relatorios',
        queryParams,
      );

      final response = await ApiClient.get(
        url,
        headers: {
          'Authorization': getToken(),
        },
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final bytes = response.bodyBytes;
        final dir = await getTemporaryDirectory();
        final formattedDate = DateTime.now().millisecondsSinceEpoch.toString();
        final filename = 'relatorio_${_selectedTipo}_$formattedDate.$formato';
        final file = File('${dir.path}/$filename');
        await file.writeAsBytes(bytes);

        setState(() {
          _isLoadingPdf = false;
          _isLoadingXlsx = false;
        });
        await OpenFilex.open(file.path);
      } else {
        setState(() {
          _isLoadingPdf = false;
          _isLoadingXlsx = false;
        });
        if (mounted) {
          await showAppDialog(
            context,
            title: 'Erro ao gerar',
            message: 'Não foi possível obter o relatório do servidor. Código: ${response.statusCode}',
            icon: PhosphorIcons.xCircle,
            iconColor: AppColors.error,
          );
        }
      }
    } catch (e) {
      setState(() {
        _isLoadingPdf = false;
        _isLoadingXlsx = false;
      });
      if (mounted) {
        await showAppDialog(
          context,
          title: 'Erro de comunicação',
          message: 'Houve uma falha ao contatar o servidor de relatórios.',
          icon: PhosphorIcons.warningCircle,
          iconColor: AppColors.error,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Relatórios do Condomínio',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Selecione uma categoria de relatório:',
              style: AppTypography.captionMedium(context).copyWith(
                color: AppColors.textTertiary(context),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            ..._categories.entries.map((entry) {
              final isSelected = _selectedTipo == entry.key;
              final category = entry.value;
              return GestureDetector(
                onTap: () => setState(() => _selectedTipo = entry.key),
                child: Container(
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.primary.withOpacity(0.1) : AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border.all(
                      color: isSelected ? AppColors.primary : Colors.white.withOpacity(0.05),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        decoration: BoxDecoration(
                          color: (category['color'] as Color).withOpacity(0.12),
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Icon(
                          category['icon'] as IconData,
                          color: category['color'] as Color,
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              category['label'] as String,
                              style: AppTypography.bodyMedium(context).copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              category['desc'] as String,
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.textSecondary(context),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
            const SizedBox(height: AppSpacing.lg),
            Text(
              'Período (Opcional):',
              style: AppTypography.captionMedium(context).copyWith(
                color: AppColors.textTertiary(context),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => _selectDate(context, true),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.md,
                        horizontal: AppSpacing.md,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(color: Colors.white.withOpacity(0.05)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'DATA INÍCIO',
                            style: AppTypography.tiny(context).copyWith(
                              fontSize: 9,
                              color: AppColors.textTertiary(context),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _formatDate(_dataInicio),
                            style: AppTypography.body(context),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: GestureDetector(
                    onTap: () => _selectDate(context, false),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.md,
                        horizontal: AppSpacing.md,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(color: Colors.white.withOpacity(0.05)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'DATA FIM',
                            style: AppTypography.tiny(context).copyWith(
                              fontSize: 9,
                              color: AppColors.textTertiary(context),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _formatDate(_dataFim),
                            style: AppTypography.body(context),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            if (_dataInicio != null || _dataFim != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _dataInicio = null;
                      _dataFim = null;
                    });
                  },
                  icon: const Icon(PhosphorIcons.trash, size: 14, color: AppColors.error),
                  label: const Text(
                    'Limpar período',
                    style: TextStyle(color: AppColors.error, fontSize: 12),
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Exportar PDF',
                    loading: _isLoadingPdf,
                    onPressed: () => _export('pdf'),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: 'Exportar Excel',
                    variant: AppButtonVariant.secondary,
                    loading: _isLoadingXlsx,
                    onPressed: () => _export('xlsx'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xxl),
          ],
        ),
      ),
    );
  }
}
