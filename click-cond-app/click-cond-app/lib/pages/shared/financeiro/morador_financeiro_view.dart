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
  _MoradorFinanceiroViewState createState() => _MoradorFinanceiroViewState();
}

class _MoradorFinanceiroViewState extends State<MoradorFinanceiroView> {
  bool _isLoading = true;
  List<dynamic> _items = [];
  List<dynamic> _condoItems = [];
  FinanceiroViewMode _viewMode = FinanceiroViewMode.morador;
  String? mes;
  String? ano;

  @override
  void initState() {
    super.initState();
    _loadData();
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
        _isLoading = false;
      });
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
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
    const personalCategories = ["Aluguel", "Água", "Luz", "Internet", "Outros"];

    List<dynamic> activeItems = _items.where((item) {
      var info = _getMesAno(item);
      return info['mes'] == mes && info['ano'] == ano;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: widget.hideAppBar
          ? null
          : AppBar(
              title: Text(getText('lb_financeiro')),
              backgroundColor: AppColors.bg(context),
              elevation: 0,
              actions: [
                IconButton(
                  icon: const Icon(PhosphorIcons.downloadSimple),
                  onPressed: () {
                    displayMessage(context, "Exportar", "Relatório sendo gerado...");
                  },
                )
              ],
            ),
      body: _isLoading 
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
                  // Cobranças do síndico: passa TODOS os itens (sem filtro de mês)
                  // pois dívidas pendentes devem sempre aparecer independente do mês
                  _buildCondoChargesSection(_items, personalCategories),
                  _buildSection("Aluguel", PhosphorIcons.house, activeItems),
                  _buildSection("Água", PhosphorIcons.drop, activeItems),
                  _buildSection("Luz", PhosphorIcons.lightning, activeItems),
                  _buildSection("Internet", PhosphorIcons.wifiHigh, activeItems),
                  _buildSection("Outros", PhosphorIcons.fileText, activeItems),
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
      floatingActionButton: widget.showFab && _viewMode == FinanceiroViewMode.morador
        ? Container(
            // Sobe o FAB acima da ilha flutuante quando embutido no IndexedStack.
            margin: EdgeInsets.only(bottom: widget.hideAppBar ? 96 : 0),
            child: FloatingActionButton.extended(
              heroTag: null,
              onPressed: () => _showContaFormModal(),
              icon: const Icon(PhosphorIcons.plus, color: Colors.white),
              label: const Text("Nova Conta", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              backgroundColor: AppColors.primary,
            ),
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
                                      child: Image.network(
                                        "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${Uri.encodeComponent(item['pix_copia_cola'].toString())}",
                                        fit: BoxFit.cover,
                                        loadingBuilder: (context, child, progress) {
                                          if (progress == null) return child;
                                          return const Center(child: CircularProgressIndicator());
                                        },
                                        errorBuilder: (context, error, stackTrace) =>
                                            const Center(child: Icon(Icons.qr_code, size: 64)),
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
                    onPressed: () => _showContaFormModal(item),
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

  _showContaFormModal([dynamic item]) {
    final isEditing = item != null;
    final txtNome = TextEditingController(text: isEditing ? item['nome'] : '');
    final txtValor = TextEditingController(text: isEditing ? _parseValorMorador(item['valor']).toStringAsFixed(2) : '');
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

    String selectedCategoria = 'Luz';
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
      context: context,
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
    var monthsMap = <String, Map<String, String>>{};
    
    String curKey = "${now.year}-${now.month.toString().padLeft(2, '0')}";
    monthsMap[curKey] = {
      'mes': now.month.toString().padLeft(2, '0'),
      'ano': now.year.toString(),
    };

    for (var item in _items) {
      var info = _getMesAno(item);
      String key = "${info['ano']}-${info['mes']}";
      monthsMap[key] = info;
    }
    
    var sortedKeys = monthsMap.keys.toList()..sort();
    sortedKeys = sortedKeys.reversed.toList();
    
    return sortedKeys.map((k) => monthsMap[k]!).toList();
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

  Widget _buildMonthSelector() {
    var months = _getAvailableMonths();
    if (months.isEmpty) return const SizedBox.shrink();

    return Container(
      height: 40,
      margin: const EdgeInsets.only(top: 16),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: months.length,
        itemBuilder: (context, index) {
          var m = months[index];
          bool isSelected = m['mes'] == mes && m['ano'] == ano;
          
          String monthName = _getMonthName(m['mes'] ?? '');
          String yearShort = m['ano']?.substring(2) ?? '';
          String label = "$monthName/$yearShort";

          return GestureDetector(
            onTap: () {
              setState(() {
                mes = m['mes'];
                ano = m['ano'];
              });
              _loadData();
            },
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: isSelected ? AppColors.primary : AppColors.surface(context),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isSelected ? AppColors.primary : AppColors.border(context),
                ),
              ),
              child: Center(
                child: Text(
                  label.toUpperCase(),
                  style: AppTypography.tiny(context).copyWith(
                    color: isSelected ? Colors.white : AppColors.textSecondary(context),
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
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
