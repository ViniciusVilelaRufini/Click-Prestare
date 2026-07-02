import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:io' as io;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:click/utils/financeiro_constants.dart';

enum FinanceiroViewMode { morador, condominio }

class MoradorFinanceiroView extends StatefulWidget {
  final bool hideAppBar;
  final bool showFab;
  const MoradorFinanceiroView({
    Key? key, 
    this.hideAppBar = false,
    this.showFab = true,
  }) : super(key: key);

  @override
  MoradorFinanceiroViewState createState() => MoradorFinanceiroViewState();
}

class MoradorFinanceiroViewState extends State<MoradorFinanceiroView> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  List<dynamic> _condoItems = [];
  FinanceiroViewMode _viewMode = FinanceiroViewMode.morador;
  String? mes;
  String? ano;
  final ScrollController _monthScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _monthScrollController.dispose();
    super.dispose();
  }

  bool _isFaturaDeApto(String name) {
    final clean = name.toLowerCase().trim();
    return clean.startsWith('apto ') && clean.contains('bloco');
  }

  bool _isFaturaDesteMorador(dynamic item) {
    final nome = (item['nome'] ?? '').toString();
    final idUsuario = item['id_usuario'];
    final loggedUserId = getUserId();
    
    // Se o id_usuario bater com o do morador logado, é dele!
    if (idUsuario != null && idUsuario.toString() == loggedUserId) {
      return true;
    }
    
    // Se for uma fatura de apartamento (inicia com "Apto" e contém "Bloco"),
    // mas está órfã (sem id_usuario), podemos tentar associar pelo apartamento e bloco do Singleton.
    if (_isFaturaDeApto(nome)) {
      final cleanNome = nome.toLowerCase();
      final myApto = Singleton.instance.apartamento?.toString().toLowerCase() ?? '';
      final myBloco = Singleton.instance.bloco?.toString().toLowerCase() ?? '';
      
      if (myApto.isNotEmpty && myBloco.isNotEmpty) {
        final aptoPat = 'apto $myApto';
        final blocoPat = 'bloco $myBloco';
        return cleanNome.contains(aptoPat) && cleanNome.contains(blocoPat);
      }
    }
    
    // Se idUsuario for nulo e NÃO for fatura de apartamento, então é uma despesa/receita global do condomínio.
    // Essas despesas globais NÃO devem aparecer no "Meu Financeiro", apenas na aba "Condomínio".
    return false;
  }

  _loadData() async {
    try {
      setState(() => _isLoading = true);
      final dynamic data = await apiGetFinanceiroByUser();
      final dynamic condoData = await apiGetAllFinanceiro("financeiro", mes ?? "", ano ?? ""); 
      
      List<dynamic> condoItems = [];
      if (condoData is Map) {
        final dynamic lancamentos = condoData['lancamentos'];
        if (lancamentos is Map) {
          lancamentos.forEach((k, v) {
            if (v is List) {
              for (var item in v) {
                if (item is Map) {
                  final nome = (item['nome'] ?? '').toString();
                  if (!_isFaturaDeApto(nome)) {
                    condoItems.add(item);
                  }
                }
              }
            }
          });
        }
      }

      List<dynamic> filteredItems = [];
      if (data is List) {
        for (var item in data) {
          if (item is Map) {
            if (_isFaturaDesteMorador(item)) {
              filteredItems.add(item);
            }
          }
        }
      }

      setState(() {
        _items = filteredItems;
        _condoItems = condoItems;
        
        if (mes == null || ano == null) {
          var months = _getAvailableMonths();
          if (months.isNotEmpty) {
            var now = DateTime.now();
            var currentMonthStr = now.month.toString().padLeft(2, '0');
            var currentYearStr = now.year.toString();
            
            var found = months.firstWhere(
              (m) => m['mes'] == currentMonthStr && m['ano'] == currentYearStr,
              orElse: () => months.first,
            );
            mes = found['mes'];
            ano = found['ano'];
          }
        }
        _isLoading = false;
      });

      if (mes != null && ano != null) {
        var months = _getAvailableMonths();
        int idx = months.indexWhere((m) => m['mes'] == mes && m['ano'] == ano);
        if (idx != -1) {
          _scrollToSelectedMonth(idx);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        displayMessage(context, getText('alert_error'),
            e.toString().replaceFirst('Exception: ', ''));
      }
    }
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
      
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (c) => const Center(child: CircularProgressIndicator()),
      );
      bool success = await apiUploadComprovante(id, base64File);
      Navigator.pop(context);
      
      if(success) {
        _loadData();
        displayMessage(context, "Sucesso", "Comprovante enviado para análise!");
      } else {
        displayMessage(context, "Erro", "Falha ao enviar arquivo.");
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (mes == null || ano == null) {
      var now = DateTime.now();
      mes = now.month.toString().padLeft(2, '0');
      ano = now.year.toString();
    }

    // Categorias que o morador pode criar manualmente (contas pessoais)
    const personalCategories = kCategoriasPessoais;

    List<dynamic> activeItems = _items.where((item) {
      var info = _getMesAno(item);
      return info['mes'] == mes && info['ano'] == ano;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        title: Text(getText('lb_financeiro')),
        backgroundColor: AppColors.bg(context),
        elevation: 0,
        automaticallyImplyLeading: !widget.hideAppBar,
        actions: [
          IconButton(
            icon: const Icon(PhosphorIcons.downloadSimple),
            onPressed: () {
              displayMessage(context, "Exportar", "Relatório sendo gerado...");
            },
          )
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: false,
        child: _isLoading 
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () => _loadData(),
              child: ListView(
                padding: const EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 120),
                children: [
                  _buildViewToggle(),
                  _buildMonthSelector(),
                  const SizedBox(height: 20),
                  if (_viewMode == FinanceiroViewMode.morador) ...[
                    _buildSummaryCard(activeItems),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Text(
                        "Contas",
                        style: AppTypography.bodyMedium(context).copyWith(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    _buildCategoriesGrid(activeItems, personalCategories),
                  ] else ...[
                    Text("Despesas do Condomínio", style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    if (_condoItems.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
                        child: Text("Nenhuma despesa registrada", style: AppTypography.caption(context)),
                      )
                    else
                      ..._condoItems.map((item) => _buildFinanceiroCard(item)).toList(),
                  ],
                ],
              ),
            ),
      ),
      floatingActionButton: widget.showFab && _viewMode == FinanceiroViewMode.morador
        ? FloatingActionButton.extended(
            heroTag: null,
            onPressed: () => showContaFormModal(),
            icon: const Icon(PhosphorIcons.plus, color: Colors.white),
            label: const Text("Nova Conta", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            backgroundColor: AppColors.primary,
          )
        : null,
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
            onTap: () => setState(() => _viewMode = FinanceiroViewMode.morador),
          ),
          _ToggleItem(
            label: 'CONDOMÍNIO',
            isSelected: _viewMode == FinanceiroViewMode.condominio,
            onTap: () => setState(() => _viewMode = FinanceiroViewMode.condominio),
          ),
        ],
      ),
    );
  }

  /// Converte um valor da API (num, String ou null) em double de forma segura.
  double _parseValorMorador(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString().replaceAll(',', '.')) ?? 0;
  }

  Widget _buildSummaryCard(List<dynamic> activeItems) {
    double totalPendente = 0;
    for(var item in activeItems) {
      int intPago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      if(intPago == 0) {
        double val = 0;
        if (item['valor'] is num) {
          val = (item['valor'] as num).toDouble();
        } else if (item['valor'] != null) {
          val = double.tryParse(item['valor'].toString()) ?? 0;
        }
        totalPendente += val;
      }
    }

    return Container(
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

  Widget _buildCondoChargesSection(List<dynamic> activeItems, List<String> personalCategories) {
    // Mostra cobranças do síndico: tipo 'C' e cuja categoria não é uma das categorias pessoais conhecidas,
    // ou categoria explícita "Condomínio" ou "Taxa Condominial".
    var condoCharges = activeItems.where((i) {
      final cat = (i['categoria'] ?? '').toString();
      final tipo = (i['tipo'] ?? '').toString();
      // É cobrança do condomínio se: tipo C, OU categoria Condomínio/Taxa Condominial,
      // E a categoria não é uma categoria pessoal do morador
      return (tipo == 'C' || cat == 'Condomínio' || cat == 'Taxa Condominial') &&
          !personalCategories.contains(cat);
    }).toList();

    // União sem duplicatas
    final allIds = <dynamic>{};
    final merged = <dynamic>[];
    for (var item in condoCharges) {
      if (allIds.add(item['id'])) merged.add(item);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              Icon(PhosphorIcons.buildings, color: AppColors.primary, size: 20),
              const SizedBox(width: 8),
              Text('Condomínio', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        if (merged.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
            child: Text('Nenhuma cobrança pendente', style: AppTypography.caption(context)),
          )
        else
          ...merged.map((item) => _buildFinanceiroCard(item)).toList(),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildCategoriesGrid(List<dynamic> activeItems, List<String> personalCategories) {
    // 1. Condomínio
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

    // 2. Personal categories
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
              getItems: () => _items,
              personalCategories: personalCategories,
              mes: mes ?? '',
              ano: ano ?? '',
              onRefresh: () => _loadData(),
              showContaFormModal: ({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) {
                showContaFormModal(item: item, initialCategory: initialCategory, customContext: customContext, onSuccess: onSuccess);
              },
              buildFinanceiroCard: (item) => _buildFinanceiroCard(item),
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
                      color: AppColors.primary.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(cat.icon, color: AppColors.primary, size: 24),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    cat.title,
                    style: TextStyle(
                      color: AppColors.textPrimary(context),
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
            if (hasPending)
              Positioned(
                top: 8,
                right: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  constraints: const BoxConstraints(
                    minWidth: 16,
                    minHeight: 16,
                  ),
                  child: Center(
                    child: Text(
                      cat.pendingCount.toString(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(String title, IconData icon, List<dynamic> activeItems) {
    var sectionItems = activeItems.where((i) => i['categoria'] == title).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              Icon(icon, color: AppColors.primary, size: 20),
              const SizedBox(width: 8),
              Text(title, style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        if (sectionItems.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
            child: Text("Nenhuma conta pendente", style: AppTypography.caption(context)),
          )
        else
          ...sectionItems.map((item) => _buildFinanceiroCard(item)).toList(),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildFinanceiroCard(dynamic item) {
    int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
    int status = item['status'] is int ? item['status'] : (int.tryParse(item['status']?.toString() ?? '') ?? 0);
    bool isPago = pago == 1;
    bool isVerifying = status == 2;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border(context))
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
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            item['nome'] ?? 'Despesa',
                            style: AppTypography.bodyMedium(context),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (item['id_usuario'] != null && item['tipo'] == 'D') ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              "Pessoal",
                              style: TextStyle(color: AppColors.primary, fontSize: 8, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text("Vencimento: ${item['data_vencimento'] ?? item['data'] ?? '—'}", style: AppTypography.caption(context)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                item['valorReal'] ?? item['valorString'] ?? 'R\$ 0,00',
                style: AppTypography.bodyMedium(context).copyWith(
                  fontWeight: FontWeight.bold,
                  color: isPago ? Colors.green : AppColors.textPrimary(context),
                ),
              ),
            ],
          ),
          if (!isPago) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                if (item['pix_copia_cola'] != null && item['pix_copia_cola'].toString().trim().isNotEmpty)
                  Expanded(
                    child: ElevatedButton.icon(
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
                                    "Pague com o Pix",
                                    style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    "Escaneie o QR Code abaixo para pagar",
                                    style: AppTypography.caption(context),
                                  ),
                                  const SizedBox(height: 20),
                                  Container(
                                    width: 200,
                                    height: 200,
                                    decoration: BoxDecoration(
                                      border: Border.all(color: Colors.grey.shade300),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(12),
                                      // QR gerado localmente (qr_flutter): funciona
                                      // offline e sem depender do qrserver.com.
                                      child: QrImageView(
                                        data: item['pix_copia_cola'].toString(),
                                        size: 200,
                                        backgroundColor: Colors.white,
                                        padding: const EdgeInsets.all(12),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 20),
                                  ElevatedButton(
                                    onPressed: () {
                                      Clipboard.setData(ClipboardData(text: item['pix_copia_cola'].toString()));
                                      Navigator.pop(context);
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        const SnackBar(
                                          content: Text("Pix Copia e Cola copiado!"),
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
                                    child: const Text("Copiar Código Pix"),
                                  ),
                                ],
                              ),
                            );
                          },
                        );
                      },
                      icon: const Icon(PhosphorIcons.qrCode, size: 16),
                      label: const Text(
                        "Pagar Pix",
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        elevation: 0,
                      ),
                    ),
                  )
                else if (item['chave_pix'] != null && item['chave_pix'].toString().trim().isNotEmpty)
                  Expanded(
                    child: ElevatedButton.icon(
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
                      icon: const Icon(PhosphorIcons.copy, size: 16),
                      label: const Text(
                        "Copiar Pix",
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        elevation: 0,
                      ),
                    ),
                  ),
                if (item['linha_digitavel'] != null && item['linha_digitavel'].toString().trim().isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: item['linha_digitavel'].toString()));
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: const Text("Código de barras copiado!"),
                            backgroundColor: AppColors.textSecondary(context),
                          ),
                        );
                      },
                      icon: const Icon(PhosphorIcons.barcode, size: 16),
                      label: const Text(
                        "Copiar Código",
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.textPrimary(context),
                        side: BorderSide(color: AppColors.textSecondary(context).withOpacity(0.3)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                  ),
                ],
                if (item['url_boleto'] != null && item['url_boleto'].toString().trim().isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => launchUrl(Uri.parse(item['url_boleto'])),
                      icon: const Icon(PhosphorIcons.filePdf, color: Colors.redAccent, size: 16),
                      label: const Text(
                        "Ver Boleto",
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.redAccent,
                        side: const BorderSide(color: Colors.redAccent, width: 0.8),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
          Divider(height: 24, color: AppColors.border(context)),
          LayoutBuilder(
            builder: (context, constraints) {
              final fits = constraints.maxWidth >= 260;
              final statusWidget = _buildStatusBadge(item['status'], item['pago']);
              
              final buttonsList = <Widget>[
                if (!isPago && !isVerifying)
                  ElevatedButton.icon(
                    onPressed: () => _uploadComprovante(item['id']),
                    icon: const Icon(PhosphorIcons.uploadSimple, size: 14),
                    label: const Text("Comprovante", style: TextStyle(fontSize: 12)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                  ),
                if (item['id_usuario'] != null && item['tipo'] == 'D') ...[
                  IconButton(
                    icon: const Icon(PhosphorIcons.pencil, size: 18, color: Colors.blueAccent),
                    onPressed: () => showContaFormModal(item: item),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  IconButton(
                    icon: const Icon(PhosphorIcons.trash, size: 18, color: Colors.redAccent),
                    onPressed: () async {
                      bool? confirm = await showConfirmDialog(
                        context,
                        text: "Tem certeza que deseja excluir esta conta pessoal?",
                      );
                      if (confirm == true) {
                        final messenger = ScaffoldMessenger.of(context);
                        setState(() => _isLoading = true);
                        bool success = await apiRemoveMoradorFinanceiro(item['id']);
                        if (success) {
                          _loadData();
                          messenger.showSnackBar(
                            const SnackBar(content: Text("Conta pessoal removida com sucesso!")),
                          );
                        } else {
                          setState(() => _isLoading = false);
                          messenger.showSnackBar(
                            const SnackBar(content: Text("Erro ao remover conta pessoal.")),
                          );
                        }
                      }
                    },
                  ),
                ],
              ];

              if (fits) {
                return Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Flexible(child: statusWidget),
                    const SizedBox(width: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: buttonsList,
                    )
                  ],
                );
              } else {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: statusWidget,
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        for (int idx = 0; idx < buttonsList.length; idx++) ...[
                          if (idx > 0) const SizedBox(width: 8),
                          if (buttonsList[idx] is ElevatedButton)
                            Expanded(child: buttonsList[idx])
                          else
                            buttonsList[idx],
                        ],
                      ],
                    ),
                  ],
                );
              }
            },
          )
        ],
      ),
    );
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

  showContaFormModal({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) {
    final ctx = customContext ?? context;
    final isEditing = item != null;
    final txtNome = TextEditingController(text: isEditing ? item['nome'] : '');
    final txtValor = TextEditingController(text: isEditing ? _parseValorMorador(item['valor']).toStringAsFixed(2) : '');
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
                            _loadData();
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

  List<Map<String, String>> _getAvailableMonths() {
    var now = DateTime.now();
    var list = <Map<String, String>>[];
    for (int i = -6; i <= 5; i++) {
      var date = DateTime(now.year, now.month + i, 1);
      String mStr = date.month.toString().padLeft(2, '0');
      String yStr = date.year.toString();
      list.add({
        'mes': mStr,
        'ano': yStr,
      });
    }
    return list;
  }

  String _getMonthName(String mesNum) {
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
      if (_monthScrollController.hasClients) {
        double itemWidth = 52.0; // 46 container width + 6 horizontal margin (3 on each side)
        double viewportWidth = _monthScrollController.position.viewportDimension;
        double offset = (index * itemWidth) - (viewportWidth / 2) + (itemWidth / 2);
        
        if (offset < 0) offset = 0;
        double maxScroll = _monthScrollController.position.maxScrollExtent;
        if (offset > maxScroll) offset = maxScroll;
        
        _monthScrollController.animateTo(
          offset,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
        );
      }
    });
  }

  Widget _buildMonthSelector() {
    var months = _getAvailableMonths();
    if (months.isEmpty) return const SizedBox.shrink();

    int selectedIndex = months.indexWhere((m) => m['mes'] == mes && m['ano'] == ano);
    if (selectedIndex == -1) selectedIndex = 0;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12),
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
                    var prev = months[selectedIndex - 1];
                    setState(() {
                      mes = prev['mes'];
                      ano = prev['ano'];
                    });
                    _loadData();
                    _scrollToSelectedMonth(selectedIndex - 1);
                  }
                : null,
          ),
          Expanded(
            child: SizedBox(
              height: 44,
              child: ListView.builder(
                controller: _monthScrollController,
                scrollDirection: Axis.horizontal,
                itemCount: months.length,
                physics: const BouncingScrollPhysics(),
                itemBuilder: (context, index) {
                  var m = months[index];
                  bool isSelected = m['mes'] == mes && m['ano'] == ano;
                  
                  String monthName = _getMonthName(m['mes'] ?? '');
                  String yearShort = m['ano']?.substring(2) ?? '';

                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        mes = m['mes'];
                        ano = m['ano'];
                      });
                      _loadData();
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
              color: selectedIndex < months.length - 1 
                  ? AppColors.textPrimary(context) 
                  : AppColors.textTertiary(context).withOpacity(0.3),
            ),
            onPressed: selectedIndex < months.length - 1
                ? () {
                    var next = months[selectedIndex + 1];
                    setState(() {
                      mes = next['mes'];
                      ano = next['ano'];
                    });
                    _loadData();
                    _scrollToSelectedMonth(selectedIndex + 1);
                  }
                : null,
          ),
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

class _CategoryItem {
  final String title;
  final IconData icon;
  final int pendingCount;
  const _CategoryItem({required this.title, required this.icon, required this.pendingCount});
}

class MoradorFinanceiroCategoryDetailPage extends StatefulWidget {
  final String title;
  final IconData icon;
  final List<dynamic> Function() getItems;
  final List<String> personalCategories;
  final String mes;
  final String ano;
  final VoidCallback onRefresh;
  final Function({dynamic item, String? initialCategory, BuildContext? customContext, VoidCallback? onSuccess}) showContaFormModal;
  final Function(dynamic item) buildFinanceiroCard;

  const MoradorFinanceiroCategoryDetailPage({
    Key? key,
    required this.title,
    required this.icon,
    required this.getItems,
    required this.personalCategories,
    required this.mes,
    required this.ano,
    required this.onRefresh,
    required this.showContaFormModal,
    required this.buildFinanceiroCard,
  }) : super(key: key);

  @override
  State<MoradorFinanceiroCategoryDetailPage> createState() => _MoradorFinanceiroCategoryDetailPageState();
}

class _MoradorFinanceiroCategoryDetailPageState extends State<MoradorFinanceiroCategoryDetailPage> {
  @override
  Widget build(BuildContext context) {
    final isCondo = widget.title == 'Condomínio';
    final allItems = widget.getItems();
    
    // Filter items based on selected month/year
    final activeItems = allItems.where((item) {
      // For Condo charges, we always show unpaid items, OR items matching the month.
      // But to be consistent with the month selector, we filter by mes and ano.
      // In the original, the month selector is global, so we use widget.mes and widget.ano
      String v = item['data_vencimento']?.toString() ?? '';
      if (v.isEmpty) {
        v = item['data']?.toString() ?? '';
      }
      if (v.isNotEmpty && v.contains('/')) {
        var parts = v.split('/');
        if (parts.length >= 3) {
          return parts[1] == widget.mes && parts[2] == widget.ano;
        }
      }
      
      String nome = item['nome']?.toString() ?? '';
      if (nome.contains('Ref.')) {
        var refPart = nome.split('Ref.').last.trim();
        if (refPart.contains('/')) {
          var parts = refPart.split('/');
          return parts[0].padLeft(2, '0') == widget.mes && parts[1] == widget.ano;
        }
      }
      return false;
    }).toList();

    List<dynamic> categoryItems;
    if (isCondo) {
      categoryItems = activeItems.where((i) {
        final cat = (i['categoria'] ?? '').toString();
        final tipo = (i['tipo'] ?? '').toString();
        return (tipo == 'C' || cat == 'Condomínio' || cat == 'Taxa Condominial') &&
            !widget.personalCategories.contains(cat);
      }).toList();
    } else {
      categoryItems = activeItems.where((i) => i['categoria'] == widget.title).toList();
    }

    // Merge duplicates by id
    final allIds = <dynamic>{};
    final mergedItems = <dynamic>[];
    for (var item in categoryItems) {
      if (allIds.add(item['id'])) mergedItems.add(item);
    }

    // Calculate total pending for this category
    double totalPendente = 0;
    for (var item in mergedItems) {
      int intPago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      if (intPago == 0) {
        double val = 0;
        if (item['valor'] is num) {
          val = (item['valor'] as num).toDouble();
        } else if (item['valor'] != null) {
          val = double.tryParse(item['valor'].toString()) ?? 0;
        }
        totalPendente += val;
      }
    }

    return AppScaffold(
      title: widget.title,
      floatingActionButton: !isCondo
          ? FloatingActionButton.extended(
              heroTag: null,
              onPressed: () {
                widget.showContaFormModal(
                  initialCategory: widget.title,
                  customContext: context,
                  onSuccess: () {
                    setState(() {});
                  },
                );
              },
              icon: const Icon(PhosphorIcons.plus, color: Colors.white),
              label: const Text("Adicionar Conta", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              backgroundColor: AppColors.primary,
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          widget.onRefresh();
          await Future.delayed(const Duration(milliseconds: 500));
          if (mounted) setState(() {});
        },
        child: ListView(
          padding: const EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 120),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [AppColors.primary, AppColors.primaryDark]),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withOpacity(0.3),
                    blurRadius: 10,
                    offset: const Offset(0, 5),
                  )
                ]
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(widget.icon, color: Colors.white, size: 28),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Total Pendente (${widget.title})",
                          style: AppTypography.caption(context).copyWith(color: Colors.white70),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          "${Singleton.instance.getCurrentMoeda()} ${totalPendente.toStringAsFixed(2)}",
                          style: AppTypography.display(context).copyWith(color: Colors.white, fontSize: 24),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Text(
              "Contas e Cobranças",
              style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            if (mergedItems.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppColors.surface(context),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border(context)),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(PhosphorIcons.folderNotchOpen, size: 48, color: AppColors.textTertiary(context)),
                    const SizedBox(height: 12),
                    Text(
                      isCondo ? "Nenhuma cobrança registrada neste mês." : "Nenhuma conta registrada nesta categoria.",
                      style: AppTypography.caption(context),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              )
            else
              ...mergedItems.map((item) {
                return widget.buildFinanceiroCard(item);
              }).toList(),
          ],
        ),
      ),
    );
  }
}
