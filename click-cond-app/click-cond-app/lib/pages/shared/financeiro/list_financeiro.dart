import 'dart:async';
import 'dart:convert';
import 'package:click/utils/financeiro_constants.dart';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/shared/financeiro/finan_relatorio.dart';
import 'package:click/pages/shared/financeiro/detail_inadimplente.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart' show MoradorFinanceiroCategoryDetailPage;
import 'package:click/pages/shared/financeiro/morador_relatorio_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/boleto_utils.dart';
import 'package:click/pages/shared/financeiro/scan_boleto_page.dart';
import 'package:click/widgets/cells/cell_financeiro_card.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';

enum FinanceiroViewMode { morador, condominio }

class ListFinanceiro extends StatefulWidget {
  final bool hideAppBar;
  final bool showFab;
  const ListFinanceiro({
    super.key, 
    this.hideAppBar = false,
    this.showFab = true,
  });
  @override
  ListFinanceiroState createState() => ListFinanceiroState();
}

class ListFinanceiroState extends State<ListFinanceiro> {
  bool _isLoading = false;
  List<dynamic> titlesTabs = [];
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  
  Map<String, dynamic> _allLancamentos = {};
  Map<String, dynamic> _filteredLancamentos = {};
  List<dynamic> _personalLancamentos = [];
  List<dynamic> _filteredPersonalLancamentos = [];
  
  String tabSelected = "";
  String saldoAtual = '';
  String totalReceita = '';
  String totalDespesa = '';
  String dia = '--/--/----';
  String mes = '';
  String ano = '';
  String _searchQuery = '';
  FinanceiroViewMode _viewMode = FinanceiroViewMode.condominio;
  bool _isChangingMonth = false;

  @override
  void initState() {
    super.initState();
    _viewMode = isModoCondominioParaPerfil(getUserType())
        ? FinanceiroViewMode.condominio
        : FinanceiroViewMode.morador;
    saldoAtual = '${Singleton.instance.getCurrentMoeda()} 0,00';
    totalReceita = '${Singleton.instance.getCurrentMoeda()} 0,00';
    totalDespesa = '${Singleton.instance.getCurrentMoeda()} 0,00';

    titlesTabs = _getGeneratedMonths();
    var now = DateTime.now();
    String mStr = now.month.toString().padLeft(2, '0');
    String yStr = now.year.toString();
    String monthAbbr = _getMonthAbbr(mStr);
    String yearShort = yStr.substring(2);
    tabSelected = "${monthAbbr.toUpperCase()}/$yearShort";
    mes = mStr;
    ano = yStr;

    loadList();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  /// Identifica cada carregamento. Tocar dois meses em sequencia disparava
  /// duas requisicoes sem cancelar a anterior: a resposta de Marco podia
  /// chegar DEPOIS da de Abril e ser gravada com a aba "ABR" selecionada —
  /// saldo, receitas e despesas de um mes exibidos sob o rotulo de outro,
  /// sem nenhuma pista visual. So a requisicao mais recente pode escrever.
  int _requisicaoAtual = 0;

  Future<void> loadList({bool isMonthChange = false}) async {
    final int minhaRequisicao = ++_requisicaoAtual;
    try {
      if (isMonthChange) {
        setState(() => _isChangingMonth = true);
      } else {
        setState(() => _isLoading = true);
      }

      if (titlesTabs.isEmpty) {
        titlesTabs = _getGeneratedMonths();
      }
      if (tabSelected.isEmpty) {
        var now = DateTime.now();
        String mStr = now.month.toString().padLeft(2, '0');
        String yStr = now.year.toString();
        String monthAbbr = _getMonthAbbr(mStr);
        String yearShort = yStr.substring(2);
        tabSelected = "${monthAbbr.toUpperCase()}/$yearShort";
        mes = mStr;
        ano = yStr;
      } else {
        // Ensure mes/ano are populated from tabSelected if they are empty
        var parts = tabSelected.split('/');
        if (parts.length == 2 && (mes.isEmpty || ano.isEmpty)) {
          var found = titlesTabs.firstWhere((t) => t['periodo'] == tabSelected, orElse: () => <String, dynamic>{});
          if (found.isNotEmpty) {
            mes = found['mes'] ?? '';
            ano = found['ano'] ?? '';
          }
        }
      }
      
      // Carrega dados pessoais apenas se o perfil possuir finanças pessoais
      if (deveCarregarFinanceiroPessoal(getUserType())) {
        if (!isMonthChange || _personalLancamentos.isEmpty) {
          final dynamic personalData = await apiGetFinanceiroByUser();
          if (personalData is List) {
            _personalLancamentos = personalData;
          } else {
            _personalLancamentos = [];
          }
        }
      } else {
        _personalLancamentos = [];
      }

      // Carrega dados gerais do condomínio para o mês selecionado
      final dynamic locals = await apiGetAllFinanceiro("financeiro", mes, ano);
      // Chegou tarde: outro mes ja foi pedido depois deste.
      if (minhaRequisicao != _requisicaoAtual) return;

      if (locals is Map) {
        _allLancamentos = locals['lancamentos'] ?? {};
        saldoAtual = (locals['saldo'] ?? '${Singleton.instance.getCurrentMoeda()} 0,00').toString().replaceAll("R\$", Singleton.instance.getCurrentMoeda());
        totalReceita = (locals['totalReceita'] ?? '0,00').toString().replaceAll("R\$", Singleton.instance.getCurrentMoeda());
        totalDespesa = (locals['totalDespesa'] ?? '0,00').toString().replaceAll("R\$", Singleton.instance.getCurrentMoeda());
        dia = locals['dia'] ?? '--/--/----';
        
        int index = titlesTabs.indexWhere((t) => t['periodo'] == tabSelected);
        if (index != -1) {
          _scrollToSelectedMonth(index);
        }
      } else {
        _allLancamentos = {};
      }
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'),
            e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      // Sem esta guarda, a requisicao obsoleta apagava o indicador de
      // carregamento da requisicao que ainda estava em voo.
      if (minhaRequisicao == _requisicaoAtual && mounted) {
        _applyFilter();
        setState(() {
          _isLoading = false;
          _isChangingMonth = false;
        });
      }
    }
  }

  /// Chamado depois de await: precisa da guarda, senao e setState apos dispose
  /// quando o usuario sai da tela durante o carregamento.
  void _applyFilter() {
    if (!mounted) return;
    final Map<String, dynamic> filtered = {};
    final query = _searchQuery.toLowerCase();
    
    // Filtro para lançamentos pessoais
    _filteredPersonalLancamentos = _personalLancamentos.where((item) {
      if (query.isEmpty) return true;
      final nome = (item['nome'] ?? '').toString().toLowerCase();
      final categoria = (item['categoria'] ?? '').toString().toLowerCase();
      return nome.contains(query) || categoria.contains(query);
    }).toList();

    _allLancamentos.forEach((date, items) {
      final List<dynamic> matchingItems = (items as List).where((item) {
        if (_viewMode == FinanceiroViewMode.morador) {
          return false;
        }

        if (query.isEmpty) return true;
        final nome = (item['nome'] ?? '').toString().toLowerCase();
        final categoria = (item['categoria'] ?? '').toString().toLowerCase();
        return nome.contains(query) || categoria.contains(query);
      }).toList();
      
      if (matchingItems.isNotEmpty) {
        filtered[date] = matchingItems;
      }
    });
    
    _filteredLancamentos = filtered;
    setState(() {});
  }

  void changeMonth(String month, String newMes, String newAno) {
    setState(() {
      tabSelected = month;
      mes = newMes;
      ano = newAno;
      _isChangingMonth = true;
    });
    _applyFilter();
    loadList(isMonthChange: true);
  }

  int getCountStatus(int pago) {
    var count = 0;
    for (var data in _allLancamentos.values) {
      for (var l in data) { if (l["pago"] == pago) count++; }
    }
    return count;
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final personalCategories = kCategoriasPessoais;
    // Parte da lista já filtrada pela busca: `_applyFilter` calculava
    // `_filteredPersonalLancamentos` e ninguém lia — digitar na busca não
    // mexia em nada na aba MEU FINANCEIRO, só na do condomínio.
    final activeItems = _filteredPersonalLancamentos.where((item) {
      // Esta copia nao fazia padLeft no mes: "5/9/2026" virava "9" e nunca
      // casava com o seletor "09" — o lancamento sumia da tela.
      return competenciaDe(item).pertenceAo(mes, ano);
    }).toList();

    return AppScaffold(
      title: getText('lb_financeiro'),
      showBackButton: !widget.hideAppBar,
      safeAreaBottom: !widget.hideAppBar,
      actions: (!isSindico && deveCarregarFinanceiroPessoal(getUserType()))
          ? [
              IconButton(
                style: IconButton.styleFrom(
                  fixedSize: const Size(40, 40),
                  side: BorderSide(color: AppColors.border(context)),
                  shape: const RoundedRectangleBorder(),
                ),
                icon: const Icon(PhosphorIcons.downloadSimple, size: 18),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => MoradorRelatorioPage(
                        initialMes: mes,
                        initialAno: ano,
                        items: _personalLancamentos,
                        onRefresh: () => loadList(),
                      ),
                    ),
                  );
                },
              )
            ]
          : null,
      body: _isLoading
          ? _buildSkeleton(context)
          : RefreshIndicator(
              onRefresh: loadList,
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildViewToggle(),
                          const SizedBox(height: AppSpacing.sm),
                          _buildMonthSelector(),
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            height: _isChangingMonth ? 3.0 : 0.0,
                            margin: EdgeInsets.only(
                              top: 2.0,
                              bottom: _isChangingMonth ? 8.0 : 0.0,
                            ),
                            child: _isChangingMonth
                                ? ClipRRect(
                                    borderRadius: BorderRadius.circular(AppRadius.tag),
                                    child: LinearProgressIndicator(
                                      backgroundColor: Colors.transparent,
                                      valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
                                    ),
                                  )
                                : const SizedBox.shrink(),
                          ),
                          AnimatedOpacity(
                            duration: const Duration(milliseconds: 200),
                            opacity: _isChangingMonth ? 0.6 : 1.0,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (isSindico && _viewMode == FinanceiroViewMode.condominio) ...[
                                  const SizedBox(height: AppSpacing.md),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: _ActionCardButton(
                                          label: getText('financeiro_nav_relatorio'),
                                          icon: PhosphorIcons.filePdf,
                                          color: AppColors.primary,
                                          iconBg: AppColors.surface(context),
                                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FinanceiroRelatorio())),
                                        ),
                                      ),
                                      const SizedBox(width: AppSpacing.md),
                                      Expanded(
                                        child: _ActionCardButton(
                                          label: getText('financeiro_inadimplentes'),
                                          icon: PhosphorIcons.userList,
                                          color: AppColors.error,
                                          iconBg: AppColors.surface(context),
                                          onTap: () => Navigator.push(context, MaterialPageRoute(
                                            builder: (_) => InadimplenciaDashboardPage(mes: mes, ano: ano),
                                          )).then((_) => loadList()),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                                if (_viewMode == FinanceiroViewMode.condominio) ...[
                                  const SizedBox(height: AppSpacing.lg),
                                  _DashboardHeader(
                                    saldo: saldoAtual,
                                    receitas: totalReceita,
                                    despesas: totalDespesa,
                                    data: dia,
                                  ),
                                ] else ...[
                                  const SizedBox(height: AppSpacing.lg),
                                  _buildPersonalSummaryCard(activeItems),
                                ],
                                if (_viewMode == FinanceiroViewMode.condominio) ...[
                                  const SizedBox(height: AppSpacing.lg),
                                  Container(
                                    height: 44,
                                    decoration: BoxDecoration(
                                      color: AppColors.surface(context),
                                      border: Border.all(color: AppColors.border(context)),
                                    ),
                                    child: TextField(
                                      controller: _searchController,
                                      onChanged: (v) {
                                        _searchQuery = v;
                                        _applyFilter();
                                      },
                                      style: AppTypography.bodySecondary(context).copyWith(color: AppColors.textPrimary(context)),
                                      decoration: InputDecoration(
                                        isDense: true,
                                        hintText: 'Pesquisar lançamentos...',
                                        hintStyle: AppTypography.bodySecondary(context).copyWith(color: AppColors.textTertiary(context)),
                                        prefixIcon: Icon(
                                          PhosphorIcons.magnifyingGlass,
                                          size: 18,
                                          color: Theme.of(context).brightness == Brightness.dark ? AppColors.textSecondary(context) : AppColors.textTertiary(context),
                                        ),
                                        border: InputBorder.none,
                                        contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: AppSpacing.md),
                                  Row(
                                    children: [
                                      _CountChip(
                                        icon: PhosphorIcons.checkCircle,
                                        color: AppColors.success,
                                        bgColor: AppColors.surface(context),
                                        borderColor: AppColors.border(context),
                                        label: '${getCountStatus(1)} ${getText('pagos')}',
                                      ),
                                      const SizedBox(width: AppSpacing.sm),
                                      _CountChip(
                                        icon: PhosphorIcons.clock,
                                        color: AppColors.warning,
                                        bgColor: AppColors.surface(context),
                                        borderColor: AppColors.border(context),
                                        label: '${getCountStatus(0)} ${getText('lb_pendentes')}',
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: AppSpacing.lg),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_viewMode == FinanceiroViewMode.condominio) ...[
                    if (_filteredLancamentos.isEmpty)
                      SliverToBoxAdapter(
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 200),
                          opacity: _isChangingMonth ? 0.6 : 1.0,
                          child: Container(
                            margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                            padding: const EdgeInsets.all(AppSpacing.xl),
                            decoration: BoxDecoration(color: AppColors.surface(context), border: Border.all(color: AppColors.border(context))),
                            child: Column(
                              children: [
                                AppIconBox(icon: PhosphorIcons.magnifyingGlass, size: 56, iconSize: 24),
                                const SizedBox(height: AppSpacing.md),
                                Text(
                                  _searchQuery.isEmpty ? getText('financeiro_sem_lancamentos') : 'Nenhum resultado para a busca',
                                  style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    for (final data in _filteredLancamentos.keys)
                      SliverToBoxAdapter(
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 200),
                          opacity: _isChangingMonth ? 0.6 : 1.0,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(data.toUpperCase(), style: AppTypography.section(context)),
                                const SizedBox(height: AppSpacing.sm),
                                Container(height: 1, color: AppColors.border(context)),
                                for (var item in _filteredLancamentos[data])
                                  _LancamentoCard(item: item),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ] else ...[
                    SliverToBoxAdapter(
                      child: AnimatedOpacity(
                        duration: const Duration(milliseconds: 200),
                        opacity: _isChangingMonth ? 0.6 : 1.0,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.xl, AppSpacing.lg, AppSpacing.lg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("Contas".toUpperCase(), style: AppTypography.section(context)),
                              const SizedBox(height: AppSpacing.xl),
                              _buildCategoriesGrid(activeItems, personalCategories),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                  const SliverToBoxAdapter(child: SizedBox(height: 100)),
                ],
              ),
            ),
      floatingActionButton: null,
    );
  }

  Widget _buildSkeleton(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: List.generate(3, (i) => Padding(
              padding: const EdgeInsets.only(right: 12),
              child: AppSkeleton(width: 60, height: 12),
            )),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppSkeleton(width: double.infinity, height: 140, borderRadius: 24),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(child: AppSkeleton(width: double.infinity, height: 80, borderRadius: 20)),
              const SizedBox(width: AppSpacing.md),
              Expanded(child: AppSkeleton(width: double.infinity, height: 80, borderRadius: 20)),
            ],
          ),
          const SizedBox(height: AppSpacing.xl),
          AppSkeleton(width: double.infinity, height: 56, borderRadius: 12),
          const SizedBox(height: AppSpacing.xl),
          ...List.generate(4, (i) => AppSkeleton.listTile(context)),
        ],
      ),
    );
  }

  // O financeiro do condomínio é somente leitura: os lançamentos vêm do ERP
  // Superlógica. O síndico não cria mais cobrança, receita, despesa, rateio
  // nem configura recorrência — o SpeedDial com essas cinco ações saiu, e
  // sobrou o mesmo botão de atualizar que o morador já tinha.
  Widget _buildFab() {
    return FloatingActionButton(
      heroTag: null,
      onPressed: loadList,
      backgroundColor: AppColors.primary,
      foregroundColor: AppColors.onPrimary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      elevation: 0,
      child: const Icon(PhosphorIcons.arrowsClockwise, size: 22),
    );
  }

  Widget _buildViewToggle() {
    if (!deveExibirToggleFinanceiro(getUserType())) {
      return const SizedBox.shrink();
    }
    final isSindico = getUserType() == 'sindico';
    final modos = [
      FinanceiroViewMode.morador,
      if (isSindico) FinanceiroViewMode.condominio,
    ];
    return AppSegmentedControl(
      selectedIndex: modos.indexOf(_viewMode).clamp(0, modos.length - 1),
      onChanged: (i) {
        setState(() => _viewMode = modos[i]);
        _applyFilter();
      },
      segments: [
        const AppSegment(label: 'MEU FINANCEIRO', icon: PhosphorIcons.user),
        if (isSindico) const AppSegment(label: 'CONDOMÍNIO', icon: PhosphorIcons.buildings),
      ],
    );
  }

  /// Interpreta o campo "pago", que pode vir como int (0/1) ou String ("0"/"1").
  /// Delega para a fonte única em financeiro_constants.dart.
  bool _isPago(dynamic value) => isPagoValor(value);

  bool _temValor(dynamic v) => v != null && v.toString().trim().isNotEmpty;

  String? _getProximoVencimento(List<dynamic> activeItems) {
    DateTime? menorData;
    String? menorDataStr;

    for (var item in activeItems) {
      if (_isPago(item['pago'])) continue;

      String raw = (item['data_vencimento'] ?? item['vencimento'] ?? item['data'] ?? '').toString().trim();
      if (raw.isEmpty) continue;

      DateTime? parsed;
      String formatted = '';

      if (raw.contains('/')) {
        var parts = raw.split('/');
        if (parts.length >= 2) {
          int d = int.tryParse(parts[0]) ?? 1;
          int m = int.tryParse(parts[1]) ?? 1;
          int y = parts.length >= 3 ? (int.tryParse(parts[2]) ?? DateTime.now().year) : DateTime.now().year;
          if (y < 100) y += 2000;
          parsed = DateTime(y, m, d);
          formatted = "${parts[0].padLeft(2, '0')}/${parts[1].padLeft(2, '0')}";
        }
      } else if (raw.contains('-')) {
        var parts = raw.split('-');
        if (parts.length >= 3) {
          int y = int.tryParse(parts[0]) ?? DateTime.now().year;
          int m = int.tryParse(parts[1]) ?? 1;
          String dayPart = parts[2].split('T').first.trim();
          int d = int.tryParse(dayPart) ?? 1;
          parsed = DateTime(y, m, d);
          formatted = "${d.toString().padLeft(2, '0')}/${m.toString().padLeft(2, '0')}";
        }
      }

      if (formatted.isNotEmpty) {
        if (parsed != null) {
          if (menorData == null || parsed.isBefore(menorData)) {
            menorData = parsed;
            menorDataStr = formatted;
          }
        } else {
          menorDataStr ??= formatted;
        }
      }
    }

    return menorDataStr;
  }

  void _abrirPixSheet({
    required BuildContext context,
    required String payload,
    String? titulo,
    double? valor,
  }) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface(context),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.borderStrong(context)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 20.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 3,
                  decoration: BoxDecoration(
                          color: AppColors.borderStrong(context),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  titulo ?? "Pague com Pix",
                  style: AppTypography.title(sheetContext).copyWith(
                    fontWeight: FontWeight.bold,
                    fontSize: 19,
                  ),
                ),
                if (valor != null && valor > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                    "R\$ ${formatMoeda(valor)}",
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primary,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  "Escaneie o QR Code abaixo ou copie o código:",
                  style: AppTypography.caption(sheetContext),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                Container(
                  width: 200,
                  height: 200,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.qrPaper,
                    border: Border.all(color: AppColors.border(context)),
                    borderRadius: BorderRadius.zero,
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.zero,
                    child: QrImageView(
                      data: payload,
                      size: 200,
                      backgroundColor: AppColors.qrPaper,
                      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: AppColors.qrInk),
                      dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: AppColors.qrInk),
                      padding: EdgeInsets.zero,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.zero,
                      ),
                    ),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: payload));
                      Navigator.pop(sheetContext);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text("Código Pix Copia e Cola copiado com sucesso!"),
                          backgroundColor: AppColors.success,
                        ),
                      );
                    },
                    icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onPrimary),
                    label: Text(
                      "Copiar Código Pix",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: AppColors.onPrimary,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
              ],
            ),
          ),
        );
      },
    );
  }

  void _abrirChavePixSheet({
    required BuildContext context,
    required String chave,
    double? valor,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface(context),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.borderStrong(context)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 3,
                  decoration: BoxDecoration(
                          color: AppColors.borderStrong(context),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  "Chave Pix do Condomínio",
                  style: AppTypography.title(sheetContext).copyWith(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
                if (valor != null && valor > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                    "R\$ ${formatMoeda(valor)}",
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primary,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Text(
                  "Utilize a chave Pix abaixo para realizar o pagamento:",
                  style: AppTypography.caption(sheetContext),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.zero,
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: Row(
                    children: [
                      Icon(PhosphorIcons.key, color: AppColors.primary, size: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: SelectableText(
                          chave,
                          style: AppTypography.body(context).copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.zero,
                      ),
                    ),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: chave));
                      Navigator.pop(sheetContext);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text("Chave Pix copiada com sucesso!"),
                          backgroundColor: AppColors.success,
                        ),
                      );
                    },
                    icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onPrimary),
                    label: Text(
                      "Copiar Chave Pix",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: AppColors.onPrimary,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _abrirSelecaoContasPix(BuildContext context, List<dynamic> pendingItems) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface(context),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.borderStrong(context)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 3,
                    decoration: BoxDecoration(
                          color: AppColors.borderStrong(context),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  "Contas pendentes",
                  style: AppTypography.title(sheetContext).copyWith(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  "Selecione uma conta para ver os detalhes ou pagar:",
                  style: AppTypography.caption(sheetContext),
                ),
                const SizedBox(height: 16),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.45,
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: pendingItems.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (c, idx) {
                      final it = pendingItems[idx];
                      final cat = (it['categoria'] ?? it['nome'] ?? 'Conta').toString();
                      double val = parseValorMoeda(it['valor']);
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                        leading: CircleAvatar(
                          backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                          child: Icon(PhosphorIcons.receipt, color: AppColors.primary, size: 20),
                        ),
                        title: Text(cat, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        subtitle: Text(it['data_vencimento'] != null ? "Vencimento: ${it['data_vencimento']}" : "Pendente"),
                        trailing: Text(
                          "R\$ ${formatMoeda(val)}",
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.primary),
                        ),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          if (_temValor(it['pix_copia_cola'])) {
                            _abrirPixSheet(
                              context: context,
                              payload: it['pix_copia_cola'].toString(),
                              titulo: cat,
                              valor: val,
                            );
                          } else if (_temValor(it['chave_pix'])) {
                            _abrirChavePixSheet(
                              context: context,
                              chave: it['chave_pix'].toString(),
                              valor: val,
                            );
                          } else {
                            displayMessage(
                              context,
                              cat,
                              "Dados de Pix automático não cadastrados para este lançamento. Use a chave Pix ou anexe o comprovante na categoria.",
                            );
                          }
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _onPagarComPix({
    required List<dynamic> activeItems,
    required dynamic pixItem,
    required double totalPendente,
    required int totalContas,
    required int contasPendentes,
  }) {
    if (totalContas == 0) {
      displayMessage(context, "Financeiro", "Nenhuma conta cadastrada neste mês.");
      return;
    }
    if (contasPendentes == 0) {
      displayMessage(context, "Tudo em dia", "Parabéns! Todas as contas deste mês já foram quitadas.");
      return;
    }
    if (pixItem != null) {
      if (_temValor(pixItem['pix_copia_cola'])) {
        double val = parseValorMoeda(pixItem['valor']);
        _abrirPixSheet(
          context: context,
          payload: pixItem['pix_copia_cola'].toString(),
          titulo: pixItem['categoria']?.toString() ?? "Pague com Pix",
          valor: val > 0 ? val : totalPendente,
        );
        return;
      } else if (_temValor(pixItem['chave_pix'])) {
        double val = parseValorMoeda(pixItem['valor']);
        _abrirChavePixSheet(
          context: context,
          chave: pixItem['chave_pix'].toString(),
          valor: val > 0 ? val : totalPendente,
        );
        return;
      }
    }

    var pendingList = activeItems.where((it) => !_isPago(it['pago'])).toList();
    _abrirSelecaoContasPix(context, pendingList);
  }

  Widget _buildPersonalSummaryCard(List<dynamic> activeItems) {
    double totalPendente = 0;
    double totalPago = 0;
    int contasPagas = 0;
    final int totalContas = activeItems.length;

    for (var item in activeItems) {
      double val = parseValorMoeda(item['valor']);
      if (_isPago(item['pago'])) {
        totalPago += val;
        contasPagas++;
      } else {
        totalPendente += val;
      }
    }

    final int contasPendentes = totalContas - contasPagas;

    double totalGeral = totalPendente + totalPago;
    double progressRatio = 0.0;
    int percentual = 0;

    if (totalGeral > 0) {
      progressRatio = (totalPago / totalGeral).clamp(0.0, 1.0);
      percentual = (progressRatio * 100).round();
    } else if (totalContas > 0) {
      progressRatio = (contasPagas / totalContas).clamp(0.0, 1.0);
      percentual = (progressRatio * 100).round();
    }

    String progressText;
    if (totalContas == 0) {
      progressText = "Nenhuma conta lançada neste mês";
    } else if (contasPendentes == 0) {
      progressText = "100% do mês quitado · Todas as contas pagas";
    } else {
      progressText = "$percentual% do mês já quitado · $contasPagas de $totalContas contas pagas";
    }

    String badgeText = "Tudo em dia";
    IconData badgeIcon = PhosphorIcons.checkCircleFill;
    if (contasPendentes > 0) {
      String? proxVenc = _getProximoVencimento(activeItems);
      if (proxVenc != null && proxVenc.isNotEmpty) {
        badgeText = "Vence $proxVenc";
        badgeIcon = PhosphorIcons.clock;
      } else {
        badgeText = "Pendente";
        badgeIcon = PhosphorIcons.clock;
      }
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border.all(color: AppColors.borderStrong(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: Text("Total pendente".toUpperCase(), style: AppTypography.label(context)),
              ),
              AppTag(
                label: badgeText,
                signal: contasPendentes > 0 ? AppSignal.warn : AppSignal.ok,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text("BRL", style: AppTypography.label(context)),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  formatMoeda(totalPendente),
                  style: AppTypography.display(context).copyWith(
                    fontWeight: FontWeight.w300,
                    fontSize: 48,
                    height: 1,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            height: 2,
            width: double.infinity,
            color: AppColors.border(context),
            alignment: Alignment.centerLeft,
            child: FractionallySizedBox(
              widthFactor: progressRatio.clamp(0.0, 1.0),
              child: Container(height: 2, color: AppColors.primary),
            ),
          ),
          const SizedBox(height: 10),
          Text(progressText, style: AppTypography.tiny(context)),
        ],
      ),
    );
  }

  _uploadComprovante(int id) async {
    FilePickerResult? result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['jpg', 'pdf', 'png'],
      withData: true,
    );

    if (result != null) {
      String base64File = "";
      
      if (kIsWeb) {
        base64File = base64Encode(result.files.first.bytes!);
      } else {
        final file = io.File(result.files.first.path!);
        base64File = base64Encode(await file.readAsBytes());
      }
      
      // Loading + diálogo padrão do app (o rflutter_alert antigo vinha com
      // botão "CANCEL" em inglês num alerta de sucesso).
      // readAsBytes e await: a tela pode ter sido fechada nesse meio tempo.
      if (!mounted) return;
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (c) => const Center(child: CircularProgressIndicator()),
      );
      bool success = await apiUploadComprovante(id, base64File);
      if (mounted) Navigator.pop(context);

      if(success) {
        loadList();
        if (mounted) displayMessage(context, "Sucesso", "Comprovante enviado para análise!");
      } else {
        if (mounted) displayMessage(context, "Erro", "Falha ao enviar arquivo.");
      }
    }
  }

  Widget _buildPersonalFinanceiroCard(dynamic item) {
    // Layout no widget compartilhado — ver widgets/cells/cell_financeiro_card.dart.
    // Antes este card estava duplicado aqui e em morador_financeiro_view.dart,
    // e os dois já tinham divergido: mexer num não mudava o outro.
    return FinanceiroCard(
      item: item,
      // Só conta PESSOAL aceita comprovante. Numa cobrança do condomínio o
      // upload grava status '2' ("aguardando auditoria do síndico") e o
      // síndico não tem mais como aprovar — o financeiro virou somente
      // leitura. Continuar convidando o morador a anexar seria pedir um
      // arquivo que ninguém no mundo pode resolver. Quem dá a baixa da taxa
      // agora é o ERP, pelo retorno do banco.
      onEnviarComprovante: (item['id_usuario'] != null && item['tipo'] == 'D')
          ? () => _uploadComprovante(item['id'])
          : null,
    );
  }


  List<Map<String, dynamic>> _getGeneratedMonths() {
    var now = DateTime.now();
    var list = <Map<String, dynamic>>[];
    for (int i = -6; i <= 5; i++) {
      var date = DateTime(now.year, now.month + i, 1);
      String mStr = date.month.toString().padLeft(2, '0');
      String yStr = date.year.toString();
      String monthAbbr = _getMonthAbbr(mStr);
      String yearShort = yStr.substring(2);
      String periodo = "${monthAbbr.toUpperCase()}/$yearShort";
      list.add({
        'periodo': periodo,
        'mes': mStr,
        'ano': yStr,
      });
    }
    return list;
  }

  String _getMonthAbbr(String mesNum) {
    switch (mesNum) {
      case '01': return 'Jan';
      case '02': return 'Fev';
      case '03': return 'Mar';
      case '04': return 'Abr';
      case '05': return 'Mai';
      case '06': return 'Jun';
      case '07': return 'Jul';
      case '08': return 'Ago';
      case '09': return 'Set';
      case '10': return 'Out';
      case '11': return 'Nov';
      case '12': return 'Dez';
      default: return mesNum;
    }
  }

  void _scrollToSelectedMonth(int index) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        double itemWidth = 58.0; // 50 container width + 8 horizontal margin (4 on each side)
        double viewportWidth = _scrollController.position.viewportDimension;
        double offset = (index * itemWidth) - (viewportWidth / 2) + (itemWidth / 2);
        
        if (offset < 0) offset = 0;
        double maxScroll = _scrollController.position.maxScrollExtent;
        if (offset > maxScroll) offset = maxScroll;
        
        _scrollController.animateTo(
          offset,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
        );
      }
    });
  }

  Widget _buildMonthSelector() {
    if (titlesTabs.isEmpty) return const SizedBox.shrink();

    int selectedIndex = titlesTabs.indexWhere((t) => tabSelected == t['periodo']);
    if (selectedIndex == -1) selectedIndex = 0;

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Row(
        children: [
          IconButton(
            iconSize: 18,
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(),
            icon: Icon(
              PhosphorIcons.caretLeft,
              color: selectedIndex > 0 
                  ? AppColors.textTertiary(context) 
                  : AppColors.border(context).withValues(alpha: 0.4),
            ),
            onPressed: selectedIndex > 0
                ? () {
                    var prev = titlesTabs[selectedIndex - 1];
                    changeMonth(prev['periodo'], prev['mes'], prev['ano']);
                    _scrollToSelectedMonth(selectedIndex - 1);
                  }
                : null,
          ),
          Expanded(
            child: SizedBox(
              height: 58,
              child: ListView.builder(
                controller: _scrollController,
                scrollDirection: Axis.horizontal,
                itemCount: titlesTabs.length,
                physics: const BouncingScrollPhysics(),
                itemBuilder: (context, index) {
                  var t = titlesTabs[index];
                  bool isSelected = tabSelected == t['periodo'];
                  
                  String monthName = t['periodo'].toString().split('/').first;
                  String yearShort = t['periodo'].toString().split('/').last;

                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      changeMonth(t['periodo'], t['mes'], t['ano']);
                      _scrollToSelectedMonth(index);
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 50,
                      height: 54,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: isSelected ? AppColors.primary : Colors.transparent,
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            monthName.toUpperCase(),
                            style: TextStyle(
                              color: isSelected 
                                  ? AppColors.onPrimary 
                                  : (Theme.of(context).brightness == Brightness.dark
                                      ? AppColors.textTertiary(context)
                                      : AppColors.textSecondary(context)),
                              fontWeight: isSelected ? FontWeight.w800 : FontWeight.w700,
                              fontSize: 12.5,
                              letterSpacing: 0.4,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            yearShort,
                            style: TextStyle(
                              color: isSelected 
                                  ? AppColors.onPrimary.withValues(alpha: 0.9)
                                  : (Theme.of(context).brightness == Brightness.dark
                                      ? AppColors.textSecondary(context)
                                      : AppColors.textTertiary(context)),
                              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          IconButton(
            iconSize: 18,
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(),
            icon: Icon(
              PhosphorIcons.caretRight,
              color: selectedIndex < titlesTabs.length - 1 
                  ? AppColors.textTertiary(context) 
                  : AppColors.border(context).withValues(alpha: 0.4),
            ),
            onPressed: selectedIndex < titlesTabs.length - 1
                ? () {
                    var next = titlesTabs[selectedIndex + 1];
                    changeMonth(next['periodo'], next['mes'], next['ano']);
                    _scrollToSelectedMonth(selectedIndex + 1);
                  }
                : null,
          ),
        ],
      ),
    );
  }


  Widget _buildCategoriesGrid(List<dynamic> activeItems, List<String> personalCategories) {
    var condoCharges = activeItems.where((i) {
      final cat = (i['categoria'] ?? '').toString();
      final tipo = (i['tipo'] ?? '').toString();
      return (tipo == 'C' || cat == 'Condomínio' || cat == 'Taxa Condominial') &&
          !personalCategories.contains(cat);
    }).toList();
    final condoIds = <dynamic>{};
    final mergedCondo = <dynamic>[];
    for (var item in condoCharges) {
      if (condoIds.add(item['id'])) mergedCondo.add(item);
    }
    final int condoPendingCount = mergedCondo.where((item) {
      int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      return pago != 1;
    }).length;

    final Map<String, int> pendingCounts = {};
    for (var cat in personalCategories) {
      var sectionItems = activeItems.where((i) => i['categoria'] == cat).toList();
      final secIds = <dynamic>{};
      final mergedSec = <dynamic>[];
      for (var item in sectionItems) {
        if (secIds.add(item['id'])) mergedSec.add(item);
      }
      pendingCounts[cat] = mergedSec.where((item) {
        int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
        return pago != 1;
      }).length;
    }

    final categories = [
      _CategoryItem(title: 'Condomínio', icon: PhosphorIcons.buildings, pendingCount: condoPendingCount),
      _CategoryItem(title: 'Aluguel', icon: PhosphorIcons.house, pendingCount: pendingCounts['Aluguel'] ?? 0),
      _CategoryItem(title: 'Água', icon: PhosphorIcons.drop, pendingCount: pendingCounts['Água'] ?? 0),
      _CategoryItem(title: 'Luz', icon: PhosphorIcons.lightning, pendingCount: pendingCounts['Luz'] ?? 0),
      _CategoryItem(title: 'Internet', icon: PhosphorIcons.wifiHigh, pendingCount: pendingCounts['Internet'] ?? 0),
      _CategoryItem(title: 'Outros', icon: PhosphorIcons.fileText, pendingCount: pendingCounts['Outros'] ?? 0),
    ];

    final linha = AppColors.border(context);
    final celulas = [
      for (final cat in categories) SizedBox(height: 132, child: _buildCategoryCard(cat, personalCategories)),
    ];
    return Container(
      decoration: BoxDecoration(color: linha, border: Border.all(color: linha)),
      child: Column(
        children: [
          for (var i = 0; i < celulas.length; i += 2) ...[
            if (i > 0) const SizedBox(height: 1),
            Row(
              children: [
                Expanded(child: celulas[i]),
                const SizedBox(width: 1),
                Expanded(
                  child: i + 1 < celulas.length
                      ? celulas[i + 1]
                      : ColoredBox(color: AppColors.surface(context), child: const SizedBox(height: 132)),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCategoryCard(_CategoryItem cat, List<String> personalCategories) {
    final hasPending = cat.pendingCount > 0;

    return Material(
      color: AppColors.surface(context),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => MoradorFinanceiroCategoryDetailPage(
                title: cat.title,
                icon: cat.icon,
                getItems: () => _personalLancamentos,
                personalCategories: personalCategories,
                mes: mes,
                ano: ano,
                onRefresh: () => loadList(),
                showContaFormModal: ({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) {
                  showContaFormModal(item: item, initialCategory: initialCategory, customContext: customContext, onSuccess: onSuccess);
                },
                buildFinanceiroCard: (item, {onChanged}) => _buildPersonalFinanceiroCard(item),
              ),
            ),
          ).then((_) {
            setState(() {});
          });
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppIconBox(icon: cat.icon),
                  if (hasPending) AppTag(label: cat.pendingCount.toString(), signal: AppSignal.warn),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(cat.title, style: AppTypography.strong(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(
                    hasPending
                        ? "${cat.pendingCount} pendente${cat.pendingCount > 1 ? 's' : ''}"
                        : "Nenhuma pendência",
                    style: AppTypography.tiny(context).copyWith(color: hasPending ? AppColors.warning : null),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  showContaFormModal({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) {
    final ctx = customContext ?? context;
    final isEditing = item != null;
    final txtNome = TextEditingController(text: isEditing ? item['nome'] : '');
    final txtValor = TextEditingController(text: isEditing ? valorParaInput(item['valor']) : '');
    final txtVencimento = TextEditingController(text: isEditing ? item['data_vencimento'] : '');
    final allowedCategories = kCategoriasPessoais;
    
    String clean(String s) {
      return s.replaceAll('í', 'i')
              .replaceAll('í', 'i')
              .replaceAll('ó', 'o')
              .replaceAll('á', 'a')
              .replaceAll('é', 'e')
              .replaceAll('ú', 'u')
              .toLowerCase()
              .trim();
    }

    String selectedCategoria = initialCategory ?? 'Luz';
    if (isEditing) {
      String cat = item['categoria'] ?? 'Outros';
      String target = clean(cat);
      selectedCategoria = allowedCategories.firstWhere(
        (c) => clean(c) == target,
        orElse: () => allowedCategories.contains(cat) ? cat : 'Outros',
      );
    }
    // isPagoValor, não `== 1`: com "1" (String) o switch abria desmarcado e
    // salvar sem tocar nele despagava a conta.
    bool isPago = isEditing ? isPagoValor(item['pago']) : false;
    String? scannedLinha = isEditing ? item['linha_digitavel']?.toString() : null;
    String? scannedPix = isEditing ? item['pix_copia_cola']?.toString() : null;

    showModalBottomSheet(
      context: ctx,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              decoration: BoxDecoration(
                color: AppColors.bg(context),
                border: Border(top: BorderSide(color: AppColors.borderStrong(context))),
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          isEditing ? "Editar Conta" : "Nova Conta Pessoal",
                          style: AppTypography.bodyMedium(context).copyWith(
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                        IconButton(
                          icon: Icon(Icons.close, color: AppColors.textSecondary(context)),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text("Categoria", style: AppTypography.caption(context)),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.zero,
                        border: Border.all(color: AppColors.border(context)),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: selectedCategoria,
                          dropdownColor: AppColors.bg(context),
                          isExpanded: true,
                          style: AppTypography.bodyMedium(context),
                          items: allowedCategories
                              .map((cat) => DropdownMenuItem(
                                    value: cat,
                                    child: Text(cat),
                                  ))
                              .toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setModalState(() => selectedCategoria = val);
                            }
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text("Nome / Descrição", style: AppTypography.caption(context)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: txtNome,
                      style: AppTypography.bodyMedium(context),
                      decoration: InputDecoration(
                        hintText: "Ex: Conta de Luz - Maio",
                        hintStyle: TextStyle(color: AppColors.textTertiary(context)),
                        fillColor: AppColors.surface(context),
                        filled: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.zero,
                          borderSide: BorderSide(color: AppColors.border(context)),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.zero,
                          borderSide: BorderSide(color: AppColors.border(context)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("Valor (BRL)", style: AppTypography.caption(context)),
                              const SizedBox(height: 8),
                              TextField(
                                controller: txtValor,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                style: AppTypography.bodyMedium(context),
                                decoration: InputDecoration(
                                  hintText: "0.00",
                                  hintStyle: TextStyle(color: AppColors.textTertiary(context)),
                                  fillColor: AppColors.surface(context),
                                  filled: true,
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.zero,
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.zero,
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("Vencimento", style: AppTypography.caption(context)),
                              const SizedBox(height: 8),
                              TextField(
                                controller: txtVencimento,
                                readOnly: true,
                                style: AppTypography.bodyMedium(context),
                                decoration: InputDecoration(
                                  hintText: "DD/MM/AAAA",
                                  hintStyle: TextStyle(color: AppColors.textTertiary(context)),
                                  fillColor: AppColors.surface(context),
                                  filled: true,
                                  suffixIcon: Icon(Icons.calendar_today, size: 18, color: AppColors.textSecondary(context)),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.zero,
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.zero,
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                ),
                                onTap: () async {
                                  DateTime? picked = await showDatePicker(
                                    context: context,
                                    initialDate: DateTime.now(),
                                    firstDate: DateTime(2020),
                                    lastDate: DateTime(2030),
                                  );
                                  if (picked != null) {
                                    String formatted = "${picked.day.toString().padLeft(2, '0')}/${picked.month.toString().padLeft(2, '0')}/${picked.year}";
                                    setModalState(() {
                                      txtVencimento.text = formatted;
                                    });
                                  }
                                },
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Pago", style: AppTypography.bodyMedium(context)),
                        Switch(
                          value: isPago,
                          onChanged: (val) {
                            setModalState(() => isPago = val);
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text("Boleto (opcional)",
                        style: AppTypography.caption(context)
                            .copyWith(color: AppColors.textSecondary(context))),
                    const SizedBox(height: 8),
                    if ((scannedLinha != null && scannedLinha!.trim().isNotEmpty) ||
                        (scannedPix != null && scannedPix!.trim().isNotEmpty))
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.zero,
                          border: Border.all(color: AppColors.primary.withValues(alpha: 0.35)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.zero,
                              ),
                              child: Icon(
                                scannedPix != null && scannedPix!.trim().isNotEmpty
                                    ? PhosphorIcons.qrCode
                                    : PhosphorIcons.barcode,
                                size: 20,
                                color: AppColors.primary,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    scannedPix != null && scannedPix!.trim().isNotEmpty
                                        ? "Pix Copia e Cola Vinculado"
                                        : "Código de Barras Vinculado",
                                    style: AppTypography.caption(context).copyWith(
                                      color: AppColors.primary,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    scannedPix != null && scannedPix!.trim().isNotEmpty
                                        ? "${scannedPix!.substring(0, scannedPix!.length > 25 ? 25 : scannedPix!.length)}..."
                                        : (scannedLinha!.length > 18
                                            ? "${scannedLinha!.substring(0, 8)}...${scannedLinha!.substring(scannedLinha!.length - 8)}"
                                            : scannedLinha!),
                                    style: AppTypography.tiny(context).copyWith(
                                      color: AppColors.textSecondary(context),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.error),
                              tooltip: 'Remover código',
                              onPressed: () => setModalState(() {
                                scannedLinha = null;
                                scannedPix = null;
                              }),
                            ),
                          ],
                        ),
                      )
                    else
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final raw = await Navigator.push<String>(
                              context,
                              MaterialPageRoute(builder: (_) => const ScanBoletoPage()),
                            );
                            if (raw == null || raw.trim().isEmpty) return;
                            final parsed = parseBoletoScan(raw);
                            if (parsed.isEmpty) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Não consegui identificar o código. Tente novamente.')),
                                );
                              }
                              return;
                            }
                            setModalState(() {
                              scannedLinha = parsed.linhaDigitavel;
                              scannedPix = parsed.pixCopiaCola;
                              if (parsed.valorFormatado != null && parsed.valorFormatado!.isNotEmpty) {
                                txtValor.text = parsed.valorFormatado!;
                              }
                              if (parsed.vencimentoFormatado != null && parsed.vencimentoFormatado!.isNotEmpty) {
                                txtVencimento.text = parsed.vencimentoFormatado!;
                              }
                              if (txtNome.text.trim().isEmpty) {
                                if (parsed.bancoOuTipo != null) {
                                  txtNome.text = "$selectedCategoria - ${parsed.bancoOuTipo}";
                                } else {
                                  txtNome.text = selectedCategoria;
                                }
                              }
                            });
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    parsed.pixCopiaCola != null
                                        ? "Pix Copia e Cola vinculado com sucesso!"
                                        : "Código de barras vinculado${parsed.valorFormatado != null ? ' (R\$ ${parsed.valorFormatado})' : ''}!",
                                  ),
                                  backgroundColor: AppColors.success,
                                  duration: const Duration(seconds: 2),
                                ),
                              );
                            }
                          },
                          icon: Icon(PhosphorIcons.barcode, size: 18, color: AppColors.primary),
                          label: Text("Escanear boleto",
                              style: AppTypography.captionMedium(context)
                                  .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold)),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: AppColors.primary.withValues(alpha: 0.4)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
                          ),
                        ),
                      ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: AppColors.onPrimary,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
                        ),
                        onPressed: () async {
                          if (txtNome.text.trim().isEmpty || txtValor.text.trim().isEmpty || txtVencimento.text.trim().isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text("Preencha todos os campos!")),
                            );
                            return;
                          }

                          final messenger = ScaffoldMessenger.of(context);
                          setState(() => _isLoading = true);

                          final bodyData = {
                            if (isEditing) "id": item['id'],
                            "nome": txtNome.text.trim(),
                            "valor": txtValor.text.trim(),
                            "data_vencimento": txtVencimento.text.trim(),
                            "categoria": selectedCategoria,
                            "pago": isPago ? 1 : 0,
                            "linha_digitavel": (scannedLinha != null && scannedLinha!.trim().isNotEmpty) ? scannedLinha!.trim() : '',
                            "pix_copia_cola": (scannedPix != null && scannedPix!.trim().isNotEmpty) ? scannedPix!.trim() : '',
                          };

                          bool success;
                          if (isEditing) {
                            success = await apiUpdateMoradorFinanceiro(bodyData);
                          } else {
                            success = await apiInsertMoradorFinanceiro(bodyData);
                          }

                          if (success) {
                            if (context.mounted) Navigator.pop(context);
                            loadList();
                            if (onSuccess != null) onSuccess();
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text(isEditing ? "Conta atualizada!" : "Conta criada com sucesso!"),
                                backgroundColor: AppColors.success,
                              ),
                            );
                          } else {
                            if (mounted) setState(() => _isLoading = false);
                            messenger.showSnackBar(
                              const SnackBar(content: Text("Erro ao salvar conta.")),
                            );
                          }
                        },
                        child: Text(
                          isEditing ? "Salvar Alterações" : "Adicionar Conta",
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppColors.onPrimary),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _CategoryItem {
  final String title;
  final IconData icon;
  final int pendingCount;
  const _CategoryItem({required this.title, required this.icon, required this.pendingCount});
}

class _DashboardHeader extends StatelessWidget {
  final String saldo;
  final String receitas;
  final String despesas;
  final String data;

  const _DashboardHeader({
    required this.saldo,
    required this.receitas,
    required this.despesas,
    required this.data,
  });

  String _cleanMoeda(String val) {
    var s = val.replaceAll('BRL', 'R\$').trim();
    if (s.startsWith('-')) {
      var rest = s.substring(1).trim();
      if (rest.startsWith('R\$')) {
        var numPart = rest.substring(2).trim();
        return '- R\$ $numPart';
      }
      return '- $rest';
    }
    if (s.startsWith('R\$')) {
      var numPart = s.substring(2).trim();
      return 'R\$ $numPart';
    }
    return s.isEmpty ? 'R\$ 0,00' : s;
  }

  @override
  Widget build(BuildContext context) {
    final isNeg = saldo.contains('-');
    final cleanSaldo = _cleanMoeda(saldo);
    final cleanReceitas = _cleanMoeda(receitas);
    final cleanDespesas = _cleanMoeda(despesas);

    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            border: Border.all(color: AppColors.borderStrong(context)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('SALDO ATUAL', style: AppTypography.label(context)),
                  AppTag(label: isNeg ? 'NEGATIVO' : 'POSITIVO', signal: isNeg ? AppSignal.danger : AppSignal.ok),
                ],
              ),
              const SizedBox(height: 10),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  cleanSaldo,
                  style: AppTypography.display(context).copyWith(
                    fontWeight: FontWeight.w300,
                    fontSize: 48,
                    height: 1,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Container(height: 1, color: AppColors.border(context)),
              const SizedBox(height: 12),
              Text('Última atualização: $data', style: AppTypography.tiny(context)),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        AppKpiGrid(
          children: [
            AppKpi(label: 'RECEITAS', value: cleanReceitas),
            AppKpi(label: 'DESPESAS', value: cleanDespesas),
          ],
        ),
      ],
    );
  }
}

class _CountChip extends StatelessWidget {
  final IconData icon;
  final Color color;
  final Color? bgColor;
  final Color? borderColor;
  final String label;

  const _CountChip({
    required this.icon,
    required this.color,
    this.bgColor,
    this.borderColor,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 34,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.borderStrong(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 8),
          Text(label.toUpperCase(), style: AppTypography.label(context).copyWith(color: AppColors.textSecondary(context))),
        ],
      ),
    );
  }
}

class _LancamentoCard extends StatelessWidget {
  final dynamic item;

  const _LancamentoCard({required this.item});

  IconData _getIcon(String categoria) {
    switch (categoria.toLowerCase()) {
      case 'água': return PhosphorIcons.drop;
      case 'luz': return PhosphorIcons.lightning;
      case 'internet': return PhosphorIcons.wifiHigh;
      case 'aluguel': return PhosphorIcons.house;
      case 'condomínio': return PhosphorIcons.buildings;
      case 'manutenção': return PhosphorIcons.wrench;
      default: return PhosphorIcons.currencyDollar;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCredito = item['tipo'] == 'C';
    final isPago = item['pago'] is num ? item['pago'] == 1 : item['pago']?.toString() == '1';
    final isVerifying = item['status']?.toString() == '2';

    String valorFormatted = (item['valorString'] ?? '').toString().replaceAll('BRL', 'R\$').trim();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border(
          left: BorderSide(color: AppColors.border(context)),
          right: BorderSide(color: AppColors.border(context)),
          bottom: BorderSide(color: AppColors.border(context)),
        ),
      ),
      child: Row(
        children: [
          AppIconBox(icon: _getIcon(item['categoria'] ?? '')),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item['nome'] ?? '',
                  style: AppTypography.strong(context),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(item['categoria'] ?? 'Geral', style: AppTypography.tiny(context)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                valorFormatted,
                style: AppTypography.numeral(context).copyWith(
                  fontSize: 18,
                  height: 1.1,
                  color: isCredito ? AppColors.success : AppColors.textPrimary(context),
                ),
              ),
              const SizedBox(height: 6),
              AppTag(
                label: isPago ? "PAGO" : (isVerifying ? "ANÁLISE" : "PENDENTE"),
                signal: isPago ? AppSignal.ok : (isVerifying ? AppSignal.neutral : AppSignal.warn),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActionCardButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final Color? iconBg;
  final VoidCallback onTap;

  const _ActionCardButton({
    required this.label,
    required this.icon,
    required this.color,
    this.iconBg,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.borderStrong(context)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: AppColors.textPrimary(context), size: 16),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label.toUpperCase(),
                  style: AppTypography.label(context).copyWith(color: AppColors.textPrimary(context)),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ===== Tela de Inadimplência (dashboard) =====
// Aberta pelo botão "Inadimplência" ao lado de "Resumo" no Financeiro do síndico.
class InadimplenciaDashboardPage extends StatefulWidget {
  final String mes;
  final String ano;
  const InadimplenciaDashboardPage({super.key, this.mes = '', this.ano = ''});
  @override
  State<InadimplenciaDashboardPage> createState() => _InadimplenciaDashboardPageState();
}

class _InadimplenciaDashboardPageState extends State<InadimplenciaDashboardPage> {
  bool _loading = true;
  Map<String, dynamic> _resumo = {};
  List<dynamic> _eventos = [];
  List<dynamic> _blocos = [];
  List<dynamic> _pagas = [];
  List<dynamic> _pendentes = [];
  List<dynamic> _aptosDevendo = [];
  List<dynamic> _meses = [];
  String _mes = '';
  String _ano = '';
  String _periodo = '';

  @override
  void initState() {
    super.initState();
    _mes = widget.mes;
    _ano = widget.ano;
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() => _loading = true);
      final dynamic d = await apiGetInadimplenciaDashboard(_mes, _ano);
      if (d is Map) {
        _resumo = (d['resumo'] is Map) ? Map<String, dynamic>.from(d['resumo']) : {};
        _eventos = (d['eventos'] is List) ? d['eventos'] : [];
        _blocos = (d['blocos'] is List) ? d['blocos'] : [];
        _pagas = (d['pagas'] is List) ? d['pagas'] : [];
        _pendentes = (d['pendentes'] is List) ? d['pendentes'] : [];
        _aptosDevendo = (d['aptosDevendo'] is List) ? d['aptosDevendo'] : [];
        _meses = (d['meses'] is List) ? d['meses'] : [];
        if (_periodo.isEmpty && _meses.isNotEmpty) {
          _periodo = _meses.last['periodo'];
          _mes = _meses.last['mes'];
          _ano = _meses.last['ano'];
        }
      }
    } catch (e) {
      _resumo = {}; _eventos = []; _blocos = []; _pagas = []; _pendentes = []; _aptosDevendo = [];
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _changeMonth(String periodo, String mes, String ano) {
    setState(() { _periodo = periodo; _mes = mes; _ano = ano; });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final moeda = Singleton.instance.getCurrentMoeda();
    String money(dynamic v) => (v ?? '$moeda 0,00').toString().replaceAll("R\$", moeda);
    final r = _resumo;

    return AppScaffold(
      title: 'Inadimplência',
      showBackButton: true,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: [
                  // Filtro por mês
                  if (_meses.isNotEmpty)
                    SizedBox(
                      height: 38,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _meses.length,
                        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
                        itemBuilder: (_, i) {
                          final t = _meses[i];
                          final sel = _periodo == t['periodo'];
                          return GestureDetector(
                            onTap: sel ? null : () => _changeMonth(t['periodo'], t['mes'], t['ano']),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              decoration: BoxDecoration(
                                color: sel ? AppColors.primary : AppColors.surface(context),
                                borderRadius: BorderRadius.zero,
                                border: Border.all(color: sel ? AppColors.primary : AppColors.textSecondary(context).withValues(alpha: 0.1)),
                              ),
                              child: Row(mainAxisSize: MainAxisSize.min, children: [
                                Icon(PhosphorIcons.calendarBlank, size: 14, color: sel ? AppColors.onPrimary : AppColors.textSecondary(context)),
                                const SizedBox(width: 6),
                                Text(t['periodo'], style: AppTypography.caption(context).copyWith(
                                  color: sel ? AppColors.onPrimary : AppColors.textSecondary(context),
                                  fontWeight: sel ? FontWeight.bold : FontWeight.normal)),
                              ]),
                            ),
                          );
                        },
                      ),
                    ),
                  const SizedBox(height: AppSpacing.lg),
                  // Cards de resumo (clicáveis → telas de detalhe)
                  Row(children: [
                    Expanded(child: _InadKpiCard(label: 'Arrecadado', value: money(r['totalArrecadado']),
                      icon: PhosphorIcons.checkCircle, color: AppColors.success,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaListaPage(titulo: 'Arrecadado', itens: _pagas)))
                        .then((_) => _load()))),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: _InadKpiCard(label: 'Pendente', value: money(r['totalPendente']),
                      icon: PhosphorIcons.clock, color: AppColors.warning,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaListaPage(titulo: 'Pendente', itens: _pendentes)))
                        .then((_) => _load()))),
                  ]),
                  const SizedBox(height: AppSpacing.md),
                  Row(children: [
                    Expanded(child: _InadKpiCard(label: 'Aptos devendo',
                      value: '${r['qtdAptosDevendo'] ?? 0}/${r['totalAptos'] ?? 0}',
                      icon: PhosphorIcons.buildings, color: AppColors.error,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaAptosPage(itens: _aptosDevendo)))
                        .then((_) => _load()))),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: _InadKpiCard(label: 'Inadimplência',
                      value: '${r['percInadimplencia'] ?? 0}%',
                      icon: PhosphorIcons.chartPie, color: AppColors.primary,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaAptosPage(itens: _aptosDevendo)))
                        .then((_) => _load()))),
                  ]),
                  const SizedBox(height: AppSpacing.lg),
                  // Feed de eventos
                  if (_eventos.isNotEmpty) ...[
                    Text('ATIVIDADE RECENTE', style: AppTypography.captionMedium(context).copyWith(
                      color: AppColors.textSecondary(context), letterSpacing: 0.8)),
                    const SizedBox(height: AppSpacing.sm),
                    ..._eventos.take(8).map((e) => _InadEventoTile(evento: e)),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                  // Lista por bloco
                  Text('POR BLOCO', style: AppTypography.captionMedium(context).copyWith(
                    color: AppColors.textSecondary(context), letterSpacing: 0.8)),
                  const SizedBox(height: AppSpacing.sm),
                  if (_blocos.isEmpty)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(AppSpacing.xl),
                      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
                      child: Column(children: [
                        Icon(PhosphorIcons.checkCircle, size: 40, color: AppColors.success.withValues(alpha: 0.6)),
                        const SizedBox(height: AppSpacing.sm),
                        Text('Nenhuma inadimplência neste período.', textAlign: TextAlign.center,
                          style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
                      ]),
                    )
                  else
                    ..._blocos.map((b) => _InadBlocoTile(
                      bloco: b,
                      onTapApto: (bloco, apto) => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => DetailInadimplente(bloco: bloco, apto: apto)))
                        .then((_) => _load()),
                    )),
                ],
              ),
            ),
    );
  }
}

// ===== Widgets do dashboard de Inadimplência =====

class _InadKpiCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;
  const _InadKpiCard({required this.label, required this.value, required this.icon, required this.color, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.zero,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.zero,
            border: Border.all(color: AppColors.border(context)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: AppColors.accentGhost(context), borderRadius: BorderRadius.zero),
                    child: Icon(icon, color: color, size: 18),
                  ),
                  const Spacer(),
                  if (onTap != null)
                    Icon(PhosphorIcons.caretRight, size: 14, color: AppColors.textTertiary(context)),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(value, style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold, color: color)),
              const SizedBox(height: 2),
              Text(label, style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
            ],
          ),
        ),
      ),
    );
  }
}

class _InadEventoTile extends StatelessWidget {
  final dynamic evento;
  const _InadEventoTile({required this.evento});

  @override
  Widget build(BuildContext context) {
    final tipo = (evento['tipo'] ?? '').toString();
    IconData icon; Color color; String label;
    switch (tipo) {
      case 'pagamento':
        icon = PhosphorIcons.checkCircle; color = AppColors.success; label = 'Pagamento recebido'; break;
      case 'vencido':
        icon = PhosphorIcons.warningCircle; color = AppColors.error; label = 'Cobrança vencida'; break;
      default:
        icon = PhosphorIcons.receipt; color = AppColors.textSecondary(context); label = 'Cobrança gerada';
    }
    final apto = (evento['apto'] ?? '').toString();
    final bloco = (evento['bloco'] ?? '').toString();
    final unidade = bloco.isNotEmpty ? 'Apto $apto · Bloco $bloco' : (apto.isNotEmpty ? 'Apto $apto' : '');
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
      child: Row(
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppTypography.captionMedium(context).copyWith(color: color)),
                if (unidade.isNotEmpty)
                  Text(unidade, style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text((evento['valorString'] ?? '').toString(), style: AppTypography.captionMedium(context)),
              Text((evento['data'] ?? '').toString(), style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context))),
            ],
          ),
        ],
      ),
    );
  }
}

class _InadBlocoTile extends StatelessWidget {
  final dynamic bloco;
  final void Function(String bloco, String apto) onTapApto;
  const _InadBlocoTile({required this.bloco, required this.onTapApto});

  @override
  Widget build(BuildContext context) {
    final nomeBloco = (bloco['bloco'] ?? '').toString();
    final aptos = (bloco['aptos'] is List) ? bloco['aptos'] as List : [];
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: AppColors.accentGhost(context), borderRadius: BorderRadius.zero),
            child: Icon(PhosphorIcons.buildings, color: AppColors.error, size: 18),
          ),
          title: Text('Bloco $nomeBloco', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
          trailing: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: AppColors.error, borderRadius: BorderRadius.zero),
            child: Text('${aptos.length}', style: AppTypography.caption(context).copyWith(color: AppColors.onPrimary, fontWeight: FontWeight.bold)),
          ),
          children: aptos.map<Widget>((a) {
            final apto = (a['apto'] ?? '').toString();
            final qtd = a['qtd'] ?? 0;
            return ListTile(
              onTap: () => onTapApto(nomeBloco, apto),
              leading: Icon(PhosphorIcons.door, size: 18, color: AppColors.textSecondary(context)),
              title: Text('Apto $apto', style: AppTypography.body(context)),
              subtitle: Text('$qtd ${qtd == 1 ? 'mês em aberto' : 'meses em aberto'}',
                style: AppTypography.tiny(context).copyWith(color: AppColors.error)),
              trailing: Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
            );
          }).toList(),
        ),
      ),
    );
  }
}

// ===== Tela: lista de cobranças (Arrecadado / Pendente) =====
//
// Era uma StatefulWidget porque a baixa manual removia o item da lista. A
// baixa saiu — quem marca uma cobrança como paga agora é o ERP Superlógica
// (ou o webhook de pagamento), então a lista só exibe.
class InadimplenciaListaPage extends StatelessWidget {
  final String titulo;
  final List<dynamic> itens;
  const InadimplenciaListaPage({super.key, required this.titulo, required this.itens});

  @override
  Widget build(BuildContext context) {
    final _itens = itens;
    return AppScaffold(
      title: titulo,
      showBackButton: true,
      body: _itens.isEmpty
          ? Center(child: Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(PhosphorIcons.tray, size: 48, color: AppColors.textTertiary(context)),
                const SizedBox(height: AppSpacing.md),
                Text('Nenhuma cobrança aqui.', style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
              ]),
            ))
          : ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: _itens.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, i) {
                final item = _itens[i];
                final apto = (item['apto'] ?? '').toString();
                final bloco = (item['bloco'] ?? '').toString();
                final pago = item['pago'] == 1;
                return Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
                  child: Row(children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: (pago ? AppColors.success : AppColors.warning).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.zero),
                      child: Icon(pago ? PhosphorIcons.checkCircle : PhosphorIcons.clock,
                        color: pago ? AppColors.success : AppColors.warning, size: 18),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(bloco.isNotEmpty ? 'Apto $apto · Bloco $bloco' : 'Apto $apto',
                        style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
                      if ((item['data_vencimento'] ?? '').toString().isNotEmpty)
                        Text('Vencimento: ${item['data_vencimento']}',
                          style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context))),
                    ])),
                    const SizedBox(width: AppSpacing.sm),
                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text((item['valorString'] ?? '').toString(),
                        style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w800,
                          color: pago ? AppColors.success : AppColors.error)),
                      // Nenhuma cobrança aceita baixa pelo Clique: quem marca
                      // como paga é o arquivo de retorno do banco, no ERP.
                      // O selo diz onde a baixa acontece, em vez de oferecer
                      // um botão que o backend recusaria.
                      if (!pago) ...[
                        const SizedBox(height: 6),
                        Text('Baixa pelo ERP',
                          style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context))),
                      ],
                    ]),
                  ]),
                );
              },
            ),
    );
  }
}

// ===== Tela: aptos inadimplentes (Notificar + detalhe) =====
class InadimplenciaAptosPage extends StatelessWidget {
  final List<dynamic> itens;
  const InadimplenciaAptosPage({super.key, required this.itens});

  Future<void> _notificar(BuildContext context, String bloco, String apto) async {
    final res = await apiNotificarInadimplente(bloco, apto);
    if (!context.mounted) return;
    final ok = res is Map && (res['success'] == true);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok ? 'Notificação enviada ao Apto $apto.' : (res is Map ? (res['message'] ?? 'Falha ao notificar') : 'Falha ao notificar').toString()),
      backgroundColor: ok ? AppColors.primary : AppColors.error,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Aptos devendo',
      showBackButton: true,
      body: itens.isEmpty
          ? Center(child: Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(PhosphorIcons.checkCircle, size: 48, color: AppColors.success.withValues(alpha: 0.6)),
                const SizedBox(height: AppSpacing.md),
                Text('Nenhum apto inadimplente.', style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
              ]),
            ))
          : ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: itens.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, i) {
                final a = itens[i];
                final apto = (a['apto'] ?? '').toString();
                final bloco = (a['bloco'] ?? '').toString();
                final qtd = a['qtd'] ?? 0;
                return Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
                  child: Row(children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: AppColors.accentGhost(context), borderRadius: BorderRadius.zero),
                      child: Icon(PhosphorIcons.buildings, color: AppColors.error, size: 18),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: GestureDetector(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DetailInadimplente(bloco: bloco, apto: apto))),
                      behavior: HitTestBehavior.opaque,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(bloco.isNotEmpty ? 'Apto $apto · Bloco $bloco' : 'Apto $apto',
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
                        Text('$qtd ${qtd == 1 ? 'cobrança' : 'cobranças'} · ${a['totalString'] ?? ''}',
                          style: AppTypography.tiny(context).copyWith(color: AppColors.error)),
                      ]),
                    )),
                    const SizedBox(width: AppSpacing.sm),
                    GestureDetector(
                      onTap: () => _notificar(context, bloco, apto),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.zero,
                          border: Border.all(color: AppColors.primary.withValues(alpha: 0.3))),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(PhosphorIcons.bell, size: 12, color: AppColors.primary),
                          const SizedBox(width: 4),
                          Text('Notificar', style: AppTypography.tiny(context).copyWith(
                            color: AppColors.primary, fontWeight: FontWeight.bold)),
                        ]),
                      ),
                    ),
                  ]),
                );
              },
            ),
    );
  }
}
