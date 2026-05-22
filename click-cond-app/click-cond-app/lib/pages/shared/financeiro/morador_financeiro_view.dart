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
import 'package:rflutter_alert/rflutter_alert.dart';

enum FinanceiroViewMode { morador, condominio }

class MoradorFinanceiroView extends StatefulWidget {
  const MoradorFinanceiroView({Key? key}) : super(key: key);

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
                if (item is Map && item['tipo'] == 'D' && item['id_apto'] == null) {
                  condoItems.add(item);
                }
              }
            }
          });
        }
      }

      setState(() {
        _items = data is List ? data : [];
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
      
      Alert(context: context, title: "Enviando...", desc: "Aguarde um momento", buttons: []).show();
      bool success = await apiUploadComprovante(id, base64File);
      Navigator.pop(context);
      
      if(success) {
        _loadData();
        Alert(context: context, title: "Sucesso", desc: "Comprovante enviado para análise!", type: AlertType.success).show();
      } else {
        Alert(context: context, title: "Erro", desc: "Falha ao enviar arquivo.", type: AlertType.error).show();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        title: Text(getText('lb_financeiro')),
        backgroundColor: AppColors.bg(context),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(PhosphorIcons.downloadSimple),
            onPressed: () {
              Alert(context: context, title: "Exportar", desc: "Relatório sendo gerado...").show();
            },
          )
        ],
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: () => _loadData(),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildViewToggle(),
                const SizedBox(height: 20),
                if (_viewMode == FinanceiroViewMode.morador) ...[
                  _buildSummaryCard(),
                  const SizedBox(height: 24),
                  _buildSection("Condomínio", PhosphorIcons.buildings),
                  _buildSection("Aluguel", PhosphorIcons.house),
                  _buildSection("Água", PhosphorIcons.drop),
                  _buildSection("Luz", PhosphorIcons.lightning),
                  _buildSection("Internet", PhosphorIcons.wifiHigh),
                  _buildSection("Outros", PhosphorIcons.fileText),
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
      floatingActionButton: _viewMode == FinanceiroViewMode.morador
        ? FloatingActionButton.extended(
            onPressed: () => _showContaFormModal(),
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

  Widget _buildSummaryCard() {
    double totalPendente = 0;
    for(var item in _items) {
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

  Widget _buildSection(String title, IconData icon) {
    var sectionItems = _items.where((i) => i['categoria'] == title).toList();

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
        border: Border.all(color: Colors.white10)
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(item['nome'] ?? 'Despesa', style: AppTypography.bodyMedium(context)),
                      if (item['id_usuario'] != null) ...[
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
                  Text("Vencimento: ${item['data_vencimento'] ?? item['data'] ?? '—'}", style: AppTypography.caption(context)),
                ],
              ),
              Text(item['valorReal'] ?? item['valorString'] ?? 'R\$ 0,00', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold, color: isPago ? Colors.green : AppColors.textPrimary(context))),
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
                        Clipboard.setData(ClipboardData(text: item['pix_copia_cola'].toString()));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text("Pix Copia e Cola copiado!"),
                            backgroundColor: AppColors.primary,
                          ),
                        );
                      },
                      icon: const Icon(PhosphorIcons.qrCode, size: 16),
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
                  if (item['id_usuario'] != null) ...[
                    IconButton(
                      icon: const Icon(PhosphorIcons.pencil, size: 18, color: Colors.blueAccent),
                      onPressed: () => _showContaFormModal(item),
                    ),
                    IconButton(
                      icon: const Icon(PhosphorIcons.trash, size: 18, color: Colors.redAccent),
                      onPressed: () {
                        Alert(
                          context: context,
                          type: AlertType.warning,
                          title: "Remover Conta",
                          desc: "Tem certeza que deseja excluir esta conta pessoal?",
                          buttons: [
                            DialogButton(
                              child: const Text("Cancelar", style: TextStyle(color: Colors.white)),
                              onPressed: () => Navigator.pop(context),
                              color: Colors.grey,
                            ),
                            DialogButton(
                              child: const Text("Excluir", style: TextStyle(color: Colors.white)),
                              onPressed: () async {
                                Navigator.pop(context);
                                setState(() => _isLoading = true);
                                bool success = await apiRemoveMoradorFinanceiro(item['id']);
                                if (success) {
                                  _loadData();
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text("Conta removida com sucesso!")),
                                  );
                                } else {
                                  setState(() => _isLoading = false);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text("Erro ao remover conta.")),
                                  );
                                }
                              },
                              color: Colors.red,
                            )
                          ]
                        ).show();
                      },
                    ),
                  ],
                ],
              )
            ],
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
    final txtValor = TextEditingController(text: isEditing ? (item['valor'] as num).toStringAsFixed(2) : '');
    final txtVencimento = TextEditingController(text: isEditing ? item['data_vencimento'] : '');
    String selectedCategoria = isEditing ? item['categoria'] : 'Luz';
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
                border: const Border(top: BorderSide(color: Colors.white10)),
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
                          icon: const Icon(Icons.close, color: Colors.white70),
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
                        border: Border.all(color: Colors.white10),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: selectedCategoria,
                          dropdownColor: AppColors.bg(context),
                          isExpanded: true,
                          style: AppTypography.bodyMedium(context),
                          items: ["Aluguel", "Água", "Luz", "Internet", "Outros"]
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
                        hintStyle: const TextStyle(color: Colors.white38),
                        fillColor: AppColors.surface(context),
                        filled: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: Colors.white10),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: Colors.white10),
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
                                  hintStyle: const TextStyle(color: Colors.white38),
                                  fillColor: AppColors.surface(context),
                                  filled: true,
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Colors.white10),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Colors.white10),
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
                                  hintStyle: const TextStyle(color: Colors.white38),
                                  fillColor: AppColors.surface(context),
                                  filled: true,
                                  suffixIcon: const Icon(Icons.calendar_today, size: 18, color: Colors.white54),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Colors.white10),
                                  ),
                                  enabledBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                    borderSide: const BorderSide(color: Colors.white10),
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
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () async {
                          if (txtNome.text.trim().isEmpty || txtValor.text.trim().isEmpty || txtVencimento.text.trim().isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text("Preencha todos os campos!")),
                            );
                            return;
                          }

                          Navigator.pop(context);
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
                            _loadData();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(isEditing ? "Conta atualizada!" : "Conta criada com sucesso!")),
                            );
                          } else {
                            setState(() => _isLoading = false);
                            ScaffoldMessenger.of(context).showSnackBar(
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
