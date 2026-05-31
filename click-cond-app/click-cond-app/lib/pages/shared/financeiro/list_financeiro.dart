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
import 'package:click/pages/shared/financeiro/list_inadimplentes.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_despesa.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_receita.dart';
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
  const ListFinanceiro({Key? key, this.hideAppBar = false}) : super(key: key);
  @override
  _ListFinanceiroPageState createState() => _ListFinanceiroPageState();
}

class _ListFinanceiroPageState extends State<ListFinanceiro> {
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
        titlesTabs = locals['meses'] ?? [];
        
        if (tabSelected.isEmpty && titlesTabs.isNotEmpty) {
          tabSelected = titlesTabs.last['periodo'];
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (_scrollController.hasClients) {
              _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
            }
          });
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
    return AppScaffold(
      title: widget.hideAppBar ? null : getText('lb_financeiro'),
      showBackButton: !widget.hideAppBar,
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
                          if (_viewMode == FinanceiroViewMode.condominio) ...[
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
                          ],
                          _buildViewToggle(),
                          if (isSindico && _viewMode == FinanceiroViewMode.condominio) ...[
                            const SizedBox(height: AppSpacing.md),
                            Row(
                              children: [
                                Expanded(
                                  child: _ActionCardButton(
                                    label: getText('financeiro_inadimplentes'),
                                    icon: PhosphorIcons.userList,
                                    color: AppColors.error,
                                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ListInadimplestes())).then((_) => loadList()),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Expanded(
                                  child: _ActionCardButton(
                                    label: getText('financeiro_nav_relatorio'),
                                    icon: PhosphorIcons.filePdf,
                                    color: AppColors.primary,
                                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FinanceiroRelatorio())),
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
                            _buildPersonalSummaryCard(),
                          ],
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
                          if (isSindico && _viewMode == FinanceiroViewMode.condominio)
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
                          if (_viewMode == FinanceiroViewMode.condominio)
                            const SizedBox(height: AppSpacing.lg),
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
                    if (_filteredPersonalLancamentos.isEmpty)
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
                                _searchQuery.isEmpty ? 'Nenhuma cobrança pessoal encontrada' : 'Nenhum resultado para a busca',
                                style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                      )
                    else
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("MINHAS COBRANÇAS", 
                                style: AppTypography.captionMedium(context).copyWith(
                                  color: AppColors.textTertiary(context),
                                  letterSpacing: 1.1,
                                  fontSize: 10
                                )
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              ..._filteredPersonalLancamentos.map((item) => _buildPersonalFinanceiroCard(item)).toList(),
                            ],
                          ),
                        ),
                      ),
                  ],
                  const SliverToBoxAdapter(child: SizedBox(height: 100)),
                ],
              ),
            ),
      floatingActionButton: _buildFab(isSindico),
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
    if (!isSindico) return FloatingActionButton(onPressed: loadList, child: const Icon(PhosphorIcons.arrowsClockwise));

    return SpeedDial(
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

  Widget _buildPersonalSummaryCard() {
    double totalPendente = 0;
    for (var item in _personalLancamentos) {
      if (item['pago'] == 0) {
        if (item['valor'] != null) {
          totalPendente += (item['valor'] as num).toDouble();
        }
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

  Widget _buildStatusBadge(dynamic status, int pago) {
    Color color = Colors.orange;
    String text = "Pendente";

    final statusInt = status is int ? status : int.tryParse(status.toString()) ?? 0;

    if (pago == 1) {
      color = Colors.green;
      text = "Pago";
    } else if (statusInt == 2) {
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
    bool isPago = item['pago'] == 1;
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
                  if (!isPago && !isVerifying &&
                      (item['pix_copia_cola'] == null || item['pix_copia_cola'].toString().trim().isEmpty) &&
                      (item['linha_digitavel'] == null || item['linha_digitavel'].toString().trim().isEmpty))
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
    final isPago = item['pago'] == 1;
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
