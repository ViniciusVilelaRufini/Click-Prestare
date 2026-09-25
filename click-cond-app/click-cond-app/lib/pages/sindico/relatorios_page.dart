import 'dart:io';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/api_client.dart';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/utils.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';

class RelatoriosPage extends StatefulWidget {
  const RelatoriosPage({super.key});

  @override
  State<RelatoriosPage> createState() => _RelatoriosPageState();
}

class _RelatoriosPageState extends State<RelatoriosPage> {
  String _selectedTipo = 'visitantes';
  DateTime? _dataInicio;
  DateTime? _dataFim;
  String? _selectedBloco;
  String? _selectedApto;
  List<dynamic> _apartamentos = [];
  List<String> _blocosList = [];
  bool _isLoadingPdf = false;
  bool _isLoadingXlsx = false;

  @override
  void initState() {
    super.initState();
    _loadApartamentos();
  }

  Future<void> _loadApartamentos() async {
    try {
      final res = await apiGetAll('apartamentos');
      debugPrint('[RelatoriosPage] _loadApartamentos res count: ${res is List ? res.length : res}');
      if (res is List) {
        if (mounted) {
          setState(() {
            _apartamentos = res;
            final Set<String> blocos = {};
            for (final item in _apartamentos) {
              final b = item['bloco']?.toString().trim();
              if (b != null && b.isNotEmpty) {
                blocos.add(b);
              }
            }
            _blocosList = blocos.toList()..sort();
          });
        }
      }
    } catch (e) {
      debugPrint('[RelatoriosPage] _loadApartamentos error: $e');
    }
  }

  List<String> _getAptosList() {
    final Set<String> aptos = {};
    for (final item in _apartamentos) {
      final b = item['bloco']?.toString().trim();
      final a = item['apto']?.toString().trim();
      if (a != null && a.isNotEmpty) {
        if (_selectedBloco == null || _selectedBloco!.isEmpty || b == _selectedBloco) {
          aptos.add(a);
        }
      }
    }
    final list = aptos.toList();
    list.sort((a, b) {
      final intA = int.tryParse(a);
      final intB = int.tryParse(b);
      if (intA != null && intB != null) return intA.compareTo(intB);
      return a.compareTo(b);
    });
    return list;
  }

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
      if (_selectedBloco != null && _selectedBloco!.trim().isNotEmpty) {
        queryParams['bloco'] = _selectedBloco!.trim();
      }
      if (_selectedApto != null && _selectedApto!.trim().isNotEmpty) {
        queryParams['apto'] = _selectedApto!.trim();
      }

      final url = ApiConfig.buildUri(
        '/condominios/${Singleton.instance.id_condominio}/relatorios',
        queryParams,
      );
      debugPrint('[RelatoriosPage] _export calling url: $url');

      final response = await ApiClient.get(
        url,
        headers: {
          'Authorization': getToken(),
        },
      ).timeout(ApiConfig.timeout);
      debugPrint('[RelatoriosPage] _export response: ${response.statusCode}');

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
        final openResult = await OpenFilex.open(file.path);
        debugPrint('[RelatoriosPage] OpenFilex result: ${openResult.type} - ${openResult.message}');
        if (openResult.type == ResultType.noAppToOpen && mounted) {
          showAppDialog(
            context,
            title: 'Relatório Gerado',
            message: 'O relatório em ${formato.toUpperCase()} foi gerado com sucesso no dispositivo. Para visualizá-lo, instale um aplicativo compatível (como Microsoft Excel ou Google Planilhas).',
            icon: PhosphorIcons.checkCircle,
            iconColor: AppColors.success,
          );
        }
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
    final isDark = Theme.of(context).brightness == Brightness.dark;

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
                    color: isSelected
                        ? AppColors.primary.withValues(alpha: 0.08)
                        : (isDark ? AppColors.surface(context) : Colors.white),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border.all(
                      color: isSelected
                          ? AppColors.primary
                          : (isDark ? AppColors.border(context) : const Color(0xFFE2E8F0)),
                      width: isSelected ? 1.5 : 1,
                    ),
                    boxShadow: isDark
                        ? null
                        : [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.03),
                              blurRadius: 4,
                              offset: const Offset(0, 1),
                            ),
                          ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        decoration: BoxDecoration(
                          color: (category['color'] as Color).withValues(alpha: 0.12),
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
            }),
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
                        color: isDark ? AppColors.surface(context) : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: isDark ? AppColors.border(context) : const Color(0xFFE2E8F0),
                        ),
                        boxShadow: isDark
                            ? null
                            : [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.03),
                                  blurRadius: 4,
                                  offset: const Offset(0, 1),
                                ),
                              ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                PhosphorIcons.calendarBlank,
                                size: 12,
                                color: AppColors.textTertiary(context),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'DATA INÍCIO',
                                style: AppTypography.tiny(context).copyWith(
                                  fontSize: 9,
                                  color: AppColors.textTertiary(context),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
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
                        color: isDark ? AppColors.surface(context) : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: isDark ? AppColors.border(context) : const Color(0xFFE2E8F0),
                        ),
                        boxShadow: isDark
                            ? null
                            : [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.03),
                                  blurRadius: 4,
                                  offset: const Offset(0, 1),
                                ),
                              ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                PhosphorIcons.calendarBlank,
                                size: 12,
                                color: AppColors.textTertiary(context),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'DATA FIM',
                                style: AppTypography.tiny(context).copyWith(
                                  fontSize: 9,
                                  color: AppColors.textTertiary(context),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
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
            const SizedBox(height: AppSpacing.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Unidade (Opcional):',
                  style: AppTypography.captionMedium(context).copyWith(
                    color: AppColors.textTertiary(context),
                  ),
                ),
                if (_selectedBloco != null || _selectedApto != null)
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedBloco = null;
                        _selectedApto = null;
                      });
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(PhosphorIcons.xCircle, size: 14, color: AppColors.error),
                          const SizedBox(width: 4),
                          Text(
                            'Limpar unidade',
                            style: AppTypography.tiny(context).copyWith(
                              color: AppColors.error,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () async {
                      if (_apartamentos.isEmpty) {
                        await _loadApartamentos();
                      }
                      if (!context.mounted) return;
                      if (_blocosList.isEmpty) {
                        displayMessage(
                          context,
                          'Informação',
                          'Nenhum bloco cadastrado neste condomínio.',
                        );
                        return;
                      }
                      bottomSheetAptos(
                        context,
                        _blocosList,
                        _selectedBloco ?? '',
                        (selected) {
                          setState(() {
                            if (_selectedBloco != selected) {
                              _selectedApto = null;
                            }
                            _selectedBloco = selected;
                          });
                          Navigator.of(context).pop();
                        },
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.md,
                        horizontal: AppSpacing.md,
                      ),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surface(context) : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: _selectedBloco != null
                              ? AppColors.primary
                              : (isDark ? AppColors.border(context) : const Color(0xFFE2E8F0)),
                          width: _selectedBloco != null ? 1.5 : 1,
                        ),
                        boxShadow: isDark
                            ? null
                            : [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.03),
                                  blurRadius: 4,
                                  offset: const Offset(0, 1),
                                ),
                              ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                PhosphorIcons.buildings,
                                size: 12,
                                color: _selectedBloco != null
                                    ? AppColors.primary
                                    : AppColors.textTertiary(context),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'BLOCO',
                                style: AppTypography.tiny(context).copyWith(
                                  fontSize: 9,
                                  color: _selectedBloco != null
                                      ? AppColors.primary
                                      : AppColors.textTertiary(context),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _selectedBloco != null
                                ? (_selectedBloco!.toLowerCase().startsWith('bloco')
                                    ? _selectedBloco!
                                    : 'Bloco $_selectedBloco')
                                : 'Todos os blocos',
                            style: AppTypography.body(context).copyWith(
                              color: _selectedBloco != null
                                  ? AppColors.textPrimary(context)
                                  : AppColors.textSecondary(context),
                              fontWeight: _selectedBloco != null
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: GestureDetector(
                    onTap: () async {
                      if (_apartamentos.isEmpty) {
                        await _loadApartamentos();
                      }
                      if (!context.mounted) return;
                      final aptos = _getAptosList();
                      if (aptos.isEmpty) {
                        displayMessage(
                          context,
                          'Informação',
                          _selectedBloco != null
                              ? 'Nenhum apartamento encontrado para este bloco.'
                              : 'Nenhum apartamento cadastrado neste condomínio.',
                        );
                        return;
                      }
                      bottomSheetAptos(
                        context,
                        aptos,
                        _selectedApto ?? '',
                        (selected) {
                          setState(() {
                            _selectedApto = selected;
                          });
                          Navigator.of(context).pop();
                        },
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.md,
                        horizontal: AppSpacing.md,
                      ),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surface(context) : Colors.white,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: _selectedApto != null
                              ? AppColors.primary
                              : (isDark ? AppColors.border(context) : const Color(0xFFE2E8F0)),
                          width: _selectedApto != null ? 1.5 : 1,
                        ),
                        boxShadow: isDark
                            ? null
                            : [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.03),
                                  blurRadius: 4,
                                  offset: const Offset(0, 1),
                                ),
                              ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                PhosphorIcons.door,
                                size: 12,
                                color: _selectedApto != null
                                    ? AppColors.primary
                                    : AppColors.textTertiary(context),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'APARTAMENTO',
                                style: AppTypography.tiny(context).copyWith(
                                  fontSize: 9,
                                  color: _selectedApto != null
                                      ? AppColors.primary
                                      : AppColors.textTertiary(context),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _selectedApto != null
                                ? (_selectedApto!.toLowerCase().startsWith('apto')
                                    ? _selectedApto!
                                    : 'Apto $_selectedApto')
                                : 'Todas unidades',
                            style: AppTypography.body(context).copyWith(
                              color: _selectedApto != null
                                  ? AppColors.textPrimary(context)
                                  : AppColors.textSecondary(context),
                              fontWeight: _selectedApto != null
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
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
