import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:rflutter_alert/rflutter_alert.dart';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/shared/financeiro/finan_relatorio.dart';
import 'package:click/pages/shared/financeiro/detail_inadimplente.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_despesa.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_receita.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart' show MoradorFinanceiroCategoryDetailPage;
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:flutter_speed_dial/flutter_speed_dial.dart';

enum FinanceiroViewMode { morador, condominio }

class ListFinanceiro extends StatefulWidget {
  final bool hideAppBar;
  final bool showFab;
  const ListFinanceiro({
    Key? key, 
    this.hideAppBar = false,
    this.showFab = true,
  }) : super(key: key);
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

  @override
  void initState() {
    super.initState();
    _viewMode = getUserType() == 'morador' ? FinanceiroViewMode.morador : FinanceiroViewMode.condominio;
    saldoAtual = '${Singleton.instance.getCurrentMoeda()} 0,00';
    totalReceita = '${Singleton.instance.getCurrentMoeda()} 0,00';
    totalDespesa = '${Singleton.instance.getCurrentMoeda()} 0,00';
    loadList();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);

      titlesTabs = _getGeneratedMonths();
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
          // Find in titlesTabs
          var found = titlesTabs.firstWhere((t) => t['periodo'] == tabSelected, orElse: () => <String, dynamic>{});
          if (found.isNotEmpty) {
            mes = found['mes'] ?? '';
            ano = found['ano'] ?? '';
          }
        }
      }
      
      // Carrega dados pessoais caso o síndico seja morador também
      final dynamic personalData = await apiGetFinanceiroByUser();
      if (personalData is List) {
        _personalLancamentos = personalData;
      } else {
        _personalLancamentos = [];
      }

      // Carrega dados gerais do condomínio
      final dynamic locals = await apiGetAllFinanceiro("financeiro", mes, ano);
      
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
      _applyFilter();
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _applyFilter() {
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
    setState(() { tabSelected = month; mes = newMes; ano = newAno; });
    loadList();
  }

  int getCountStatus(int pago) {
    var count = 0;
    for (var data in _allLancamentos.values) {
      for (var l in data) { if (l["pago"] == pago) count++; }
    }
    return count;
  }

  void _openLancamento(dynamic item) {
    if (getUserType() != 'sindico') return;
    Widget page;
    if (item['tipo'] == 'C') {
      page = item['categoria'] == 'Arrecadação'
          ? NewFinanceiroMorador(id: item['id'], apto: null)
          : NewFinanceiroReceita(id: item['id']);
    } else {
      page = NewFinanceiroDespesa(id: item['id']);
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => page)).then((_) => loadList());
  }
  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final personalCategories = ["Aluguel", "Água", "Luz", "Internet", "Outros"];
    final activeItems = _personalLancamentos.where((item) {
      final info = _getMesAno(item);
      return info['mes'] == mes && info['ano'] == ano;
    }).toList();

    return AppScaffold(
      title: getText('lb_financeiro'),
      showBackButton: !widget.hideAppBar,
      safeAreaBottom: !widget.hideAppBar,
      actions: null,
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
                          _buildMonthSelector(),
                          _buildViewToggle(),
                          if (isSindico && _viewMode == FinanceiroViewMode.condominio) ...[
                            const SizedBox(height: AppSpacing.md),
                            Row(
                              children: [
                                Expanded(
                                  child: _ActionCardButton(
                                    label: getText('financeiro_nav_relatorio'),
                                    icon: PhosphorIcons.filePdf,
                                    color: AppColors.primary,
                                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FinanceiroRelatorio())),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Expanded(
                                  child: _ActionCardButton(
                                    label: getText('financeiro_inadimplentes'),
                                    icon: PhosphorIcons.userList,
                                    color: AppColors.error,
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
                            AppInput(
                              label: 'Pesquisar',
                              hint: 'Buscar por morador ou categoria...',
                              controller: _searchController,
                              prefixIcon: PhosphorIcons.magnifyingGlass,
                              onChanged: (v) {
                                _searchQuery = v;
                                _applyFilter();
                              },
                            ),
                            const SizedBox(height: AppSpacing.md),
                            Row(
                              children: [
                                _CountChip(
                                  icon: PhosphorIcons.checkCircle,
                                  color: const Color(0xFF22C55E),
                                  label: '${getCountStatus(1)} ${getText('pagos')}',
                                  context: context,
                                ),
                                const SizedBox(width: AppSpacing.md),
                                _CountChip(
                                  icon: PhosphorIcons.clock,
                                  color: const Color(0xFFF59E0B),
                                  label: '${getCountStatus(0)} ${getText('lb_pendentes')}',
                                  context: context,
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.lg),
                          ],
                        ],
                      ),
                    ),
                  ),
                  if (_viewMode == FinanceiroViewMode.condominio) ...[
                    if (_filteredLancamentos.isEmpty)
                      SliverToBoxAdapter(
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                          padding: const EdgeInsets.all(AppSpacing.xl),
                          decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
                          child: Column(
                            children: [
                              Icon(PhosphorIcons.magnifyingGlass, size: 48, color: AppColors.textTertiary(context)),
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
                    for (final data in _filteredLancamentos.keys)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(data.toUpperCase(), 
                                style: AppTypography.captionMedium(context).copyWith(
                                  color: AppColors.textTertiary(context),
                                  letterSpacing: 1.1,
                                  fontSize: 10
                                )
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              for (var item in _filteredLancamentos[data])
                                _LancamentoCard(item: item, onTap: () => _openLancamento(item)),
                            ],
                          ),
                        ),
                      ),
                  ] else ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              "Contas",
                              style: AppTypography.bodyMedium(context).copyWith(
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 16),
                            _buildCategoriesGrid(activeItems, personalCategories),
                          ],
                        ),
                      ),
                    ),
                  ],
                  const SliverToBoxAdapter(child: SizedBox(height: 100)),
                ],
              ),
            ),
      floatingActionButton: widget.showFab
          // FAB simples (morador) sobe acima da ilha flutuante quando embutido.
          // SpeedDial (sindico) gerencia seu proprio overlay; nao envolver.
          ? (isSindico
              ? _buildFab(isSindico)
              : Container(
                  margin: EdgeInsets.only(bottom: widget.hideAppBar ? 96 : 0),
                  child: _buildFab(isSindico),
                ))
          : null,
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

  Widget _buildFab(bool isSindico) {
    if (_viewMode == FinanceiroViewMode.morador) {
      return FloatingActionButton(
        heroTag: null,
        onPressed: loadList,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        child: const Icon(PhosphorIcons.arrowsClockwise),
      );
    }
    if (!isSindico) return FloatingActionButton(heroTag: null, onPressed: loadList, child: const Icon(PhosphorIcons.arrowsClockwise));

    return SpeedDial(
      heroTag: null,
      icon: PhosphorIcons.plus,
      activeIcon: PhosphorIcons.x,
      backgroundColor: AppColors.primary,
      foregroundColor: Colors.white,
      children: [
        SpeedDialChild(
          child: const Icon(PhosphorIcons.userPlus),
          label: 'Cobrança Morador',
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewFinanceiroMorador(apto: null))).then((_) => loadList()),
        ),
        SpeedDialChild(
          child: const Icon(PhosphorIcons.arrowDown),
          label: 'Nova Receita',
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewFinanceiroReceita())).then((_) => loadList()),
        ),
        SpeedDialChild(
          child: const Icon(PhosphorIcons.arrowUp),
          label: 'Nova Despesa',
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NewFinanceiroDespesa())).then((_) => loadList()),
        ),
      ],
    );
  }

  Widget _buildViewToggle() {
    final isSindico = getUserType() == 'sindico';
    // MEU FINANCEIRO aparece sempre — se o síndico também é morador, ele PRECISA
    // ver as próprias dívidas. Síndico ganha também CONDOMÍNIO. A Inadimplência
    // não fica no toggle: é um botão ao lado de "Resumo".
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          _ToggleItem(
            label: 'MEU FINANCEIRO',
            isSelected: _viewMode == FinanceiroViewMode.morador,
            onTap: () {
              setState(() => _viewMode = FinanceiroViewMode.morador);
              _applyFilter();
            },
          ),
          if (isSindico)
            _ToggleItem(
              label: 'CONDOMÍNIO',
              isSelected: _viewMode == FinanceiroViewMode.condominio,
              onTap: () {
                setState(() => _viewMode = FinanceiroViewMode.condominio);
                _applyFilter();
              },
            ),
        ],
      ),
    );
  }

  /// Converte um valor da API (num, String ou null) em double de forma segura.
  double _parseValor(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString().replaceAll(',', '.')) ?? 0;
  }

  /// Interpreta o campo "pago", que pode vir como int (0/1) ou String ("0"/"1").
  bool _isPago(dynamic value) {
    if (value is num) return value == 1;
    return value?.toString() == '1';
  }

  Widget _buildPersonalSummaryCard(List<dynamic> activeItems) {
    double totalPendente = 0;
    for (var item in activeItems) {
      if (!_isPago(item['pago'])) {
        totalPendente += _parseValor(item['valor']);
      }
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [AppColors.primary, AppColors.primaryDark]),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: AppColors.primary.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 5))]
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Total Pendente", style: AppTypography.caption(context).copyWith(color: Colors.white70)),
          const SizedBox(height: 8),
          Text("${Singleton.instance.getCurrentMoeda()} ${totalPendente.toStringAsFixed(2)}", style: AppTypography.display(context).copyWith(color: Colors.white)),
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
      
      Alert(context: context, title: "Enviando...", desc: "Aguarde um momento", buttons: []).show();
      bool success = await apiUploadComprovante(id, base64File);
      Navigator.pop(context);
      
      if(success) {
        loadList();
        Alert(context: context, title: "Sucesso", desc: "Comprovante enviado para análise!", type: AlertType.success).show();
      } else {
        Alert(context: context, title: "Erro", desc: "Falha ao enviar arquivo.", type: AlertType.error).show();
      }
    }
  }

  Widget _buildStatusBadge(dynamic status, dynamic pago) {
    Color color = Colors.orange;
    String text = "Pendente";

    int intStatus = status is int ? status : (int.tryParse(status?.toString() ?? '') ?? 0);
    int intPago = pago is int ? pago : (int.tryParse(pago?.toString() ?? '') ?? 0);

    if (intPago == 1) {
      color = Colors.green;
      text = "Pago";
    } else if (intStatus == 2) {
      color = Colors.blue;
      text = "Verificando";
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(20), border: Border.all(color: color.withOpacity(0.5))),
      child: Text(text, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildPersonalFinanceiroCard(dynamic item) {
    bool isPago = _isPago(item['pago']);
    final statusVal = item['status'];
    final statusInt = statusVal is int ? statusVal : int.tryParse(statusVal.toString()) ?? 0;
    bool isVerifying = statusInt == 2;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: Colors.white10)
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item['nome'] ?? '', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold), maxLines: 2, overflow: TextOverflow.ellipsis),
                    Text("Vencimento: ${item['data_vencimento'] ?? ''}", style: AppTypography.caption(context)),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Text(item['valorReal'] ?? '', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold, color: isPago ? Colors.green : AppColors.textPrimary(context))),
            ],
          ),
          if (!isPago) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (item['pix_copia_cola'] != null && item['pix_copia_cola'].toString().trim().isNotEmpty)
                  ElevatedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: item['pix_copia_cola'].toString()));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text("Pix Copia e Cola copiado!"),
                          backgroundColor: AppColors.primary,
                        ),
                      );
                    },
                    icon: const Icon(PhosphorIcons.qrCode, size: 14),
                    label: const Text(
                      "Copiar Pix",
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      elevation: 0,
                    ),
                  )
                else if (item['chave_pix'] != null && item['chave_pix'].toString().trim().isNotEmpty)
                  ElevatedButton.icon(
                    onPressed: () {
                      showModalBottomSheet(
                        context: context,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                        ),
                        builder: (context) {
                          return Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  "Chave Pix do Condomínio",
                                  style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  "Utilize a chave Pix abaixo para realizar o pagamento manual:",
                                  textAlign: TextAlign.center,
                                  style: AppTypography.bodyMedium(context),
                                ),
                                const SizedBox(height: 20),
                                Container(
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                    color: AppColors.surface(context),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: AppColors.border(context)),
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: SelectableText(
                                          item['chave_pix'].toString(),
                                          style: AppTypography.bodyMedium(context).copyWith(
                                            fontWeight: FontWeight.bold,
                                            fontFamily: 'monospace',
                                          ),
                                          textAlign: TextAlign.center,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 24),
                                ElevatedButton(
                                  onPressed: () {
                                    Clipboard.setData(ClipboardData(text: item['chave_pix'].toString()));
                                    Navigator.pop(context);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text("Chave Pix copiada com sucesso!"),
                                        backgroundColor: AppColors.primary,
                                      ),
                                    );
                                  },
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.primary,
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(double.infinity, 44),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                  ),
                                  child: const Text("Copiar Chave Pix"),
                                ),
                              ],
                            ),
                          );
                        },
                      );
                    },
                    icon: const Icon(PhosphorIcons.copy, size: 14),
                    label: const Text(
                      "Copiar Pix",
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      elevation: 0,
                    ),
                  ),
                if (item['linha_digitavel'] != null && item['linha_digitavel'].toString().trim().isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: item['linha_digitavel'].toString()));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: const Text("Código de barras copiado!"),
                          backgroundColor: AppColors.textSecondary(context),
                        ),
                      );
                    },
                    icon: const Icon(PhosphorIcons.barcode, size: 14),
                    label: const Text(
                      "Copiar Código",
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textPrimary(context),
                      side: BorderSide(color: AppColors.textSecondary(context).withOpacity(0.3)),
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                if (item['url_boleto'] != null && item['url_boleto'].toString().trim().isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => launchUrl(Uri.parse(item['url_boleto'])),
                    icon: const Icon(PhosphorIcons.filePdf, color: Colors.redAccent, size: 14),
                    label: const Text(
                      "Ver Boleto",
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                      side: const BorderSide(color: Colors.redAccent, width: 0.8),
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
              ],
            ),
          ],
          const Divider(height: 24, color: Colors.white10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStatusBadge(item['status'], item['pago']),
              Row(
                children: [
                  if (!isPago && !isVerifying)
                    ElevatedButton.icon(
                      onPressed: () => _uploadComprovante(item['id']),
                      icon: const Icon(PhosphorIcons.uploadSimple, size: 16),
                      label: const Text("Comprovante"),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))
                      ),
                    ),
                ],
              )
            ],
          )
        ],
      ),
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
        double itemWidth = 52.0; // 46 container width + 6 horizontal margin (3 on each side)
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
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface(context).withOpacity(0.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          IconButton(
            iconSize: 16,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            icon: Icon(
              PhosphorIcons.caretLeft,
              color: selectedIndex > 0 
                  ? AppColors.textPrimary(context) 
                  : AppColors.textTertiary(context).withOpacity(0.3),
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
              height: 44,
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
                    onTap: () {
                      changeMonth(t['periodo'], t['mes'], t['ano']);
                      _scrollToSelectedMonth(index);
                    },
                    child: Container(
                      width: 46,
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            width: 38,
                            height: 26,
                            decoration: BoxDecoration(
                              color: isSelected ? AppColors.primary : Colors.transparent,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Center(
                              child: Text(
                                monthName.toUpperCase(),
                                style: TextStyle(
                                  color: isSelected 
                                      ? Colors.white 
                                      : AppColors.textSecondary(context),
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            yearShort,
                            style: TextStyle(
                              color: isSelected 
                                  ? AppColors.primary 
                                  : AppColors.textTertiary(context),
                              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                              fontSize: 9,
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
            iconSize: 16,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            icon: Icon(
              PhosphorIcons.caretRight,
              color: selectedIndex < titlesTabs.length - 1 
                  ? AppColors.textPrimary(context) 
                  : AppColors.textTertiary(context).withOpacity(0.3),
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

  Map<String, String> _getMesAno(dynamic item) {
    String v = item['data_vencimento']?.toString() ?? '';
    if (v.isEmpty) {
      v = item['data']?.toString() ?? '';
    }
    if (v.isNotEmpty && v.contains('/')) {
      var parts = v.split('/');
      if (parts.length >= 3) {
        return {'mes': parts[1], 'ano': parts[2]};
      }
    }
    
    String nome = item['nome']?.toString() ?? '';
    if (nome.contains('Ref.')) {
      var refPart = nome.split('Ref.').last.trim();
      if (refPart.contains('/')) {
        var parts = refPart.split('/');
        return {'mes': parts[0].padLeft(2, '0'), 'ano': parts[1]};
      } else {
        return {'mes': refPart.padLeft(2, '0'), 'ano': DateTime.now().year.toString()};
      }
    }
    
    var now = DateTime.now();
    return {
      'mes': now.month.toString().padLeft(2, '0'),
      'ano': now.year.toString()
    };
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

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 1.4,
      ),
      itemCount: categories.length,
      itemBuilder: (context, index) {
        final cat = categories[index];
        return _buildCategoryCard(cat, personalCategories);
      },
    );
  }

  Widget _buildCategoryCard(_CategoryItem cat, List<String> personalCategories) {
    final hasPending = cat.pendingCount > 0;

    return GestureDetector(
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
              buildFinanceiroCard: (item) => _buildPersonalFinanceiroCard(item),
            ),
          ),
        ).then((_) {
          setState(() {});
        });
      },
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 6,
              offset: const Offset(0, 3),
            )
          ],
          border: Border.all(
            color: AppColors.border(context),
            width: 1.2,
          ),
        ),
        child: Stack(
          children: [
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: hasPending
                          ? AppColors.error.withOpacity(0.08)
                          : AppColors.primary.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      cat.icon,
                      color: hasPending ? AppColors.error : AppColors.primary,
                      size: 24,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    cat.title,
                    style: AppTypography.bodyMedium(context).copyWith(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
            if (hasPending)
              Positioned(
                top: 10,
                right: 10,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    "${cat.pendingCount}",
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  showContaFormModal({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) {
    final ctx = customContext ?? context;
    final isEditing = item != null;
    final txtNome = TextEditingController(text: isEditing ? item['nome'] : '');
    final txtValor = TextEditingController(text: isEditing ? _parseValor(item['valor']).toStringAsFixed(2) : '');
    final txtVencimento = TextEditingController(text: isEditing ? item['data_vencimento'] : '');
    final allowedCategories = ["Aluguel", "Água", "Luz", "Internet", "Outros"];
    
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
    bool isPago = isEditing ? item['pago'] == 1 : false;

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
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(24),
                  topRight: Radius.circular(24),
                ),
                border: Border(top: BorderSide(color: AppColors.border(context))),
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
                        borderRadius: BorderRadius.circular(12),
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
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: AppColors.border(context)),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
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
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
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
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: BorderSide(color: AppColors.border(context)),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
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
                          activeColor: AppColors.primary,
                          onChanged: (val) {
                            setModalState(() => isPago = val);
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
                          };

                          bool success;
                          if (isEditing) {
                            success = await apiUpdateMoradorFinanceiro(bodyData);
                          } else {
                            success = await apiInsertMoradorFinanceiro(bodyData);
                          }

                          if (success) {
                            if (mounted) Navigator.pop(context);
                            loadList();
                            if (onSuccess != null) onSuccess();
                            messenger.showSnackBar(
                              SnackBar(content: Text(isEditing ? "Conta atualizada!" : "Conta criada com sucesso!")),
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
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
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

class _ToggleItem extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _ToggleItem({required this.label, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: isSelected ? [
              BoxShadow(color: AppColors.primary.withOpacity(0.3), blurRadius: 8, offset: const Offset(0, 4))
            ] : null,
          ),
          child: Center(
            child: Text(
              label,
              style: AppTypography.tiny(context).copyWith(
                color: isSelected ? Colors.white : AppColors.textSecondary(context),
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
        ),
      ),
    );
  }
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

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.xl),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white.withOpacity(0.05)),
          ),
          child: Column(
            children: [
              Text('SALDO ATUAL', 
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.textTertiary(context),
                  letterSpacing: 2
                )
              ),
              const SizedBox(height: 8),
              Text(saldo, 
                style: AppTypography.title(context).copyWith(
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                  color: saldo.contains('-') ? AppColors.error : const Color(0xFF22C55E)
                )
              ),
              const SizedBox(height: 4),
              Text('Última atualização: $data', 
                style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context))
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
              child: _SmallSummaryCard(
                label: 'RECEITAS',
                value: receitas,
                color: const Color(0xFF22C55E),
                icon: PhosphorIcons.arrowDown,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: _SmallSummaryCard(
                label: 'DESPESAS',
                value: despesas,
                color: AppColors.error,
                icon: PhosphorIcons.arrowUp,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SmallSummaryCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  const _SmallSummaryCard({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Text(label, 
                style: AppTypography.tiny(context).copyWith(
                  color: color,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1
                )
              ),
            ],
          ),
          const SizedBox(height: 8),
          FittedBox(
            child: Text(value, 
              style: AppTypography.bodyMedium(context).copyWith(
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary(context)
              )
            ),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final BuildContext context;
  const _CountChip({required this.icon, required this.color, required this.label, required this.context});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05), 
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.15))
      ),
      child: Row(
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(label, style: AppTypography.tiny(context).copyWith(color: color, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _LancamentoCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _LancamentoCard({required this.item, required this.onTap});

  IconData _getIcon(String categoria) {
    switch (categoria.toLowerCase()) {
      case 'água': return PhosphorIcons.drop;
      case 'luz': return PhosphorIcons.lightning;
      case 'internet': return PhosphorIcons.wifiHigh;
      case 'aluguel': return PhosphorIcons.house;
      case 'condomínio': return PhosphorIcons.buildings;
      default: return PhosphorIcons.currencyDollar;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCredito = item['tipo'] == 'C';
    final isPago = item['pago'] is num ? item['pago'] == 1 : item['pago']?.toString() == '1';
    final isVerifying = item['status'] == 2;
    final color = isCredito ? const Color(0xFF22C55E) : AppColors.error;
    final statusColor = isPago ? Colors.green : (isVerifying ? Colors.blue : Colors.orange);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context), 
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.05))
        ),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: AppColors.bg(context), 
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_getIcon(item['categoria'] ?? ''), color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['nome'] ?? '', 
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold), 
                    maxLines: 1, 
                    overflow: TextOverflow.ellipsis
                  ),
                  Text(item['categoria'] ?? 'Geral', 
                    style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context))
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(item['valorString'] ?? '', 
                  style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w800, color: color)
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    isPago ? "PAGO" : (isVerifying ? "ANÁLISE" : "PENDENTE"),
                    style: TextStyle(color: statusColor, fontSize: 9, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionCardButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _ActionCardButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface(context),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  label,
                  style: AppTypography.captionMedium(context).copyWith(
                    fontWeight: FontWeight.w600,
                  ),
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
  const InadimplenciaDashboardPage({Key? key, this.mes = '', this.ano = ''}) : super(key: key);
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
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: sel ? AppColors.primary : AppColors.textSecondary(context).withOpacity(0.1)),
                              ),
                              child: Row(mainAxisSize: MainAxisSize.min, children: [
                                Icon(PhosphorIcons.calendarBlank, size: 14, color: sel ? Colors.white : AppColors.textSecondary(context)),
                                const SizedBox(width: 6),
                                Text(t['periodo'], style: AppTypography.caption(context).copyWith(
                                  color: sel ? Colors.white : AppColors.textSecondary(context),
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
                      icon: PhosphorIcons.checkCircle, color: const Color(0xFF22C55E),
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaListaPage(titulo: 'Arrecadado', itens: _pagas, permitirBaixa: false)))
                        .then((_) => _load()))),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: _InadKpiCard(label: 'Pendente', value: money(r['totalPendente']),
                      icon: PhosphorIcons.clock, color: const Color(0xFFF59E0B),
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) =>
                        InadimplenciaListaPage(titulo: 'Pendente', itens: _pendentes, permitirBaixa: true)))
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
                      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
                      child: Column(children: [
                        Icon(PhosphorIcons.checkCircle, size: 40, color: AppColors.success.withOpacity(0.6)),
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
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: color.withOpacity(0.15)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(10)),
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
        icon = PhosphorIcons.checkCircle; color = const Color(0xFF22C55E); label = 'Pagamento recebido'; break;
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
      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
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
      decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(14)),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: AppColors.error.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
            child: Icon(PhosphorIcons.buildings, color: AppColors.error, size: 18),
          ),
          title: Text('Bloco $nomeBloco', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
          trailing: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: AppColors.error, borderRadius: BorderRadius.circular(20)),
            child: Text('${aptos.length}', style: AppTypography.caption(context).copyWith(color: Colors.white, fontWeight: FontWeight.bold)),
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
class InadimplenciaListaPage extends StatefulWidget {
  final String titulo;
  final List<dynamic> itens;
  final bool permitirBaixa;
  const InadimplenciaListaPage({Key? key, required this.titulo, required this.itens, this.permitirBaixa = false}) : super(key: key);
  @override
  State<InadimplenciaListaPage> createState() => _InadimplenciaListaPageState();
}

class _InadimplenciaListaPageState extends State<InadimplenciaListaPage> {
  late List<dynamic> _itens;

  @override
  void initState() {
    super.initState();
    _itens = List<dynamic>.from(widget.itens);
  }

  Future<void> _darBaixa(dynamic item) async {
    final ok = await showConfirmDialog(context, text: 'Confirmar baixa (marcar como PAGO) da cobrança do Apto ${item['apto']}${(item['bloco'] ?? '').toString().isNotEmpty ? ' · Bloco ${item['bloco']}' : ''}?');
    if (ok != true) return;
    final res = await apiUpdateFinanceiroStatus(item['id'] is int ? item['id'] : int.tryParse('${item['id']}') ?? 0, 1);
    if (!mounted) return;
    if (res == true) {
      setState(() => _itens.remove(item));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Baixa registrada.'), backgroundColor: Color(0xFF22C55E)));
    } else {
      displayMessage(context, 'Ops', 'Não foi possível dar baixa. (Verifique se a competência não está fechada.)');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.titulo,
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
                  decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(14)),
                  child: Row(children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: (pago ? const Color(0xFF22C55E) : const Color(0xFFF59E0B)).withOpacity(0.12),
                        borderRadius: BorderRadius.circular(10)),
                      child: Icon(pago ? PhosphorIcons.checkCircle : PhosphorIcons.clock,
                        color: pago ? const Color(0xFF22C55E) : const Color(0xFFF59E0B), size: 18),
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
                          color: pago ? const Color(0xFF22C55E) : AppColors.error)),
                      if (widget.permitirBaixa && !pago) ...[
                        const SizedBox(height: 6),
                        GestureDetector(
                          onTap: () => _darBaixa(item),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: const Color(0xFF22C55E).withOpacity(0.12),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFF22C55E).withOpacity(0.3))),
                            child: Text('Dar baixa', style: AppTypography.tiny(context).copyWith(
                              color: const Color(0xFF16A34A), fontWeight: FontWeight.bold)),
                          ),
                        ),
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
  const InadimplenciaAptosPage({Key? key, required this.itens}) : super(key: key);

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
                Icon(PhosphorIcons.checkCircle, size: 48, color: AppColors.success.withOpacity(0.6)),
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
                  decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(14)),
                  child: Row(children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: AppColors.error.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
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
                          color: AppColors.primary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.primary.withOpacity(0.3))),
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
