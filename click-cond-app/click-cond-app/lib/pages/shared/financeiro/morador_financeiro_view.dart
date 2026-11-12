import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:io' as io;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/shared/financeiro/scan_boleto_page.dart';
import 'package:click/utils/boleto_utils.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:file_picker/file_picker.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/utils/vencimento_financeiro.dart';
import 'package:click/widgets/cells/cell_financeiro_card.dart';
import 'package:click/pages/shared/financeiro/morador_relatorio_page.dart';

enum FinanceiroViewMode { morador, condominio }

class MoradorFinanceiroView extends StatefulWidget {
  final bool hideAppBar;
  final bool showFab;
  const MoradorFinanceiroView({
    super.key, 
    this.hideAppBar = false,
    this.showFab = true,
  });

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
    return clean.startsWith('apto ') || clean.startsWith('apartamento ');
  }

  bool _isFaturaDesteMorador(dynamic item) {
    final nome = (item['nome'] ?? '').toString();
    final idUsuario = item['id_usuario'];
    final loggedUserId = getUserId();
    
    // Se o id_usuario bater com o do morador logado, é dele!
    if (idUsuario != null && idUsuario.toString() == loggedUserId) {
      return true;
    }
    
    // Se for uma fatura da unidade (com ou sem bloco),
    // associamos pelo apartamento e bloco do morador com correspondência exata.
    if (faturaDeAptoCorresponde(
      nome,
      Singleton.instance.apartamento.toString(),
      Singleton.instance.bloco.toString(),
    )) {
      return true;
    }

    // Se idUsuario for nulo e NÃO for da unidade deste morador,
    // não deve aparecer no "Meu Financeiro", apenas na aba "Condomínio" se for despesa global.
    return false;
  }

  /// Mesma corrida do financeiro do sindico: tocar dois meses em sequencia
  /// disparava duas requisicoes e a mais antiga podia chegar por ultimo,
  /// gravando os lancamentos de um mes sob o rotulo de outro.
  int _requisicaoAtual = 0;

  _loadData({bool showLoading = true}) async {
    final int minhaRequisicao = ++_requisicaoAtual;
    try {
      if (showLoading) {
        setState(() => _isLoading = true);
      }
      final dynamic data = await apiGetFinanceiroByUser();
      final dynamic condoData = await apiGetAllFinanceiro("financeiro", mes ?? "", ano ?? ""); 
      // Chegou tarde: outro mes ja foi pedido depois deste.
      if (minhaRequisicao != _requisicaoAtual || !mounted) return;
      
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
      if (minhaRequisicao == _requisicaoAtual && mounted) {
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
      
      // readAsBytes e await: a tela pode ter sido fechada nesse meio tempo.
      if (!mounted) return;
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (c) => const Center(child: CircularProgressIndicator()),
      );
      bool success = await apiUploadComprovante(id, base64File);
      // O upload de um PDF em base64 demora: se o morador sair da tela nesse
      // meio tempo, este pop fechava a rota errada.
      if (!mounted) return;
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
      return competenciaDe(item).pertenceAo(mes ?? '', ano ?? '');
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: AppBar(
        title: Text(getText('lb_financeiro').toUpperCase(), style: AppTypography.title(context)),
        centerTitle: true,
        backgroundColor: AppColors.bg(context),
        elevation: 0,
        automaticallyImplyLeading: !widget.hideAppBar,
        actions: [
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
                    initialMes: mes ?? DateTime.now().month.toString().padLeft(2, '0'),
                    initialAno: ano ?? DateTime.now().year.toString(),
                    items: _items,
                    onRefresh: () => _loadData(),
                  ),
                ),
              );
            },
          ),
          const SizedBox(width: 8),
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
                padding: EdgeInsets.only(left: 16, right: 16, top: 2, bottom: fabClearance(context)),
                children: [
                  _buildViewToggle(),
                  _buildMonthSelector(),
                  const SizedBox(height: 6),
                  if (_viewMode == FinanceiroViewMode.morador) ...[
                    _buildSummaryCard(activeItems),
                    const SizedBox(height: 18),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Contas".toUpperCase(), style: AppTypography.section(context)),
                        Builder(builder: (_) {
                          final pend = activeItems.where((i) {
                            int p = i['pago'] is int ? i['pago'] : (int.tryParse(i['pago']?.toString() ?? '') ?? 0);
                            return p != 1;
                          }).length;
                          return Text(
                            "$pend pendente(s)".toUpperCase(),
                            style: AppTypography.label(context).copyWith(
                              color: pend > 0 ? AppColors.warning : AppColors.success,
                            ),
                          );
                        }),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _buildCategoriesGrid(activeItems, personalCategories),
                  ] else ...[
                    Text("Despesas do Condomínio".toUpperCase(), style: AppTypography.section(context)),
                    const SizedBox(height: 16),
                    if (_condoItems.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: AppColors.surface(context),
                          border: Border.all(color: AppColors.border(context)),
                        ),
                        child: Center(
                          child: Text("Nenhuma despesa registrada", style: AppTypography.bodySecondary(context)),
                        ),
                      )
                    else
                      ..._condoItems.map((item) => _buildFinanceiroCard(item)),
                  ],
                ],
              ),
            ),
      ),
      floatingActionButton: widget.showFab && _viewMode == FinanceiroViewMode.morador
        ? Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.zero,
            ),
            child: FloatingActionButton.extended(
              heroTag: null,
              elevation: 0,
              highlightElevation: 0,
              onPressed: () => showContaFormModal(),
              icon: Icon(PhosphorIcons.plusBold, color: AppColors.onBrand, size: 18),
              label: Text(
                "Nova Conta".toUpperCase(),
                style: AppTypography.button(context).copyWith(color: AppColors.onBrand),
              ),
              backgroundColor: AppColors.brand,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.zero,
              ),
            ),
          )
        : null,
    );
  }

  Widget _buildViewToggle() {
    return AppSegmentedControl(
      selectedIndex: _viewMode == FinanceiroViewMode.morador ? 0 : 1,
      onChanged: (i) => setState(() => _viewMode =
          i == 0 ? FinanceiroViewMode.morador : FinanceiroViewMode.condominio),
      segments: const [
        AppSegment(label: 'MEU FINANCEIRO'),
        AppSegment(label: 'CONDOMÍNIO'),
      ],
    );
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
                      backgroundColor: AppColors.brand,
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
                    icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onBrand),
                    label: Text(
                      "Copiar Código Pix",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: AppColors.onBrand,
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
                      backgroundColor: AppColors.brand,
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
                    icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onBrand),
                    label: Text(
                      "Copiar Chave Pix",
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: AppColors.onBrand,
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
                      final double val = parseValorMoeda(it['valor']);
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
        double val = 0;
        if (pixItem['valor'] is num) {
          val = (pixItem['valor'] as num).toDouble();
        } else if (pixItem['valor'] != null) {
          val = double.tryParse(pixItem['valor'].toString()) ?? 0;
        }
        _abrirPixSheet(
          context: context,
          payload: pixItem['pix_copia_cola'].toString(),
          titulo: pixItem['categoria']?.toString() ?? "Pague com Pix",
          valor: val > 0 ? val : totalPendente,
        );
        return;
      } else if (_temValor(pixItem['chave_pix'])) {
        double val = 0;
        if (pixItem['valor'] is num) {
          val = (pixItem['valor'] as num).toDouble();
        } else if (pixItem['valor'] != null) {
          val = double.tryParse(pixItem['valor'].toString()) ?? 0;
        }
        _abrirChavePixSheet(
          context: context,
          chave: pixItem['chave_pix'].toString(),
          valor: val > 0 ? val : totalPendente,
        );
        return;
      }
    }

    var pendingList = activeItems.where((it) {
      int p = it['pago'] is int ? it['pago'] : (int.tryParse(it['pago']?.toString() ?? '') ?? 0);
      return p != 1;
    }).toList();

    _abrirSelecaoContasPix(context, pendingList);
  }

  Widget _buildSummaryCard(List<dynamic> activeItems) {
    // parseValorMoeda via totaisFinanceiro: o double.tryParse cru devolvia
    // null para "1.250,75" e a parcela sumia do Total pendente em silêncio.
    final totais = totaisFinanceiro(activeItems);
    final double totalPendente = totais.pendente;
    final double totalPago = totais.pago;
    final int contasPagas = totais.contasPagas;
    final int totalContas = totais.totalContas;

    final int contasPendentes = totalContas - contasPagas;

    // Cálculo do progresso pago
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

    // Texto de progresso
    String progressText;
    if (totalContas == 0) {
      progressText = "Nenhuma conta lançada neste mês";
    } else if (contasPendentes == 0) {
      progressText = "100% do mês quitado · Todas as contas pagas";
    } else {
      progressText = "$percentual% do mês já quitado · $contasPagas de $totalContas contas pagas";
    }

    // Badge de vencimento / status
    String badgeText = "Tudo em dia";
    IconData badgeIcon = PhosphorIcons.checkCircleFill;
    bool vencido = false;
    if (contasPendentes > 0) {
      final proxVenc = proximoVencimentoPendente(activeItems);
      if (proxVenc != null) {
        badgeText = proxVenc.rotulo;
        vencido = proxVenc.situacao == SituacaoVencimento.vencido;
        badgeIcon = vencido ? PhosphorIcons.warningCircle : PhosphorIcons.clock;
      } else {
        badgeText = "Pendente";
        badgeIcon = PhosphorIcons.clock;
      }
    }

    // Identifica item para pagamento Pix prioritário
    dynamic pixItem;
    for (var item in activeItems) {
      int p = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      if (p == 1) continue;
      final cat = (item['categoria'] ?? '').toString();
      final tipo = (item['tipo'] ?? '').toString();
      bool isCondo = tipo == 'C' || cat == 'Condomínio' || cat == 'Taxa Condominial';
      if (isCondo && (_temValor(item['pix_copia_cola']) || _temValor(item['chave_pix']))) {
        pixItem = item;
        break;
      }
    }
    if (pixItem == null) {
      for (var item in activeItems) {
        int p = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
        if (p == 1) continue;
        if (_temValor(item['pix_copia_cola']) || _temValor(item['chave_pix'])) {
          pixItem = item;
          break;
        }
      }
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: cartaoDestaque(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  "Total pendente".toUpperCase(),
                  style: AppTypography.label(context),
                ),
              ),
              AppTag(
                label: badgeText,
                signal: vencido ? AppSignal.danger : (contasPendentes > 0 ? AppSignal.warn : AppSignal.ok),
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

  Color _corCategoria(String title) {
    switch (title.toLowerCase()) {
      case 'condomínio':
      case 'condominio':
        return AppColors.primary; // Royal Blue
      case 'aluguel':
        return AppColors.textSecondary(context); // Indigo
      case 'água':
      case 'agua':
        return AppColors.textSecondary(context); // Sky Cyan
      case 'luz':
        return AppColors.warning; // Amber
      case 'internet':
        return AppColors.textSecondary(context); // Purple
      case 'outros':
      default:
        return AppColors.success; // Emerald
    }
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
    final bool hasPending = cat.pendingCount > 0;

    return Container(
      color: AppColors.surface(context),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
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
                  buildFinanceiroCard: (item, {onChanged}) => _buildFinanceiroCard(item, onChanged: onChanged),
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
                    if (hasPending)
                      AppTag(label: cat.pendingCount.toString(), signal: AppSignal.warn),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      cat.title,
                      style: AppTypography.strong(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      hasPending
                          ? "${cat.pendingCount} pendente${cat.pendingCount > 1 ? 's' : ''}"
                          : "Nenhuma pendência",
                      style: AppTypography.tiny(context).copyWith(
                        color: hasPending ? AppColors.warning : null,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Campo preenchido de verdade (nulo, vazio ou só espaços não conta).
  bool _temValor(dynamic v) => v != null && v.toString().trim().isNotEmpty;

  Widget _buildFinanceiroCard(dynamic item, {VoidCallback? onChanged}) {
    return FinanceiroCard(
      item: item,
      onEnviarComprovante: (item['id_usuario'] != null && item['tipo'] == 'D')
          ? () => _uploadComprovante(item['id'])
          : null,
      onEditar: (item['id_usuario'] != null && item['tipo'] == 'D')
          ? () => showContaFormModal(item: item)
          : null,
      onExcluir: (item['id_usuario'] != null && item['tipo'] == 'D')
          ? () => _confirmarExclusaoContaPessoal(item)
          : null,
      mostrarSeloPessoal: item['id_usuario'] != null && item['tipo'] == 'D',
    );
  }

  Future<void> _confirmarExclusaoContaPessoal(dynamic item) async {
    final bool? confirm = await showConfirmDialog(
      context,
      text: "Tem certeza que deseja excluir esta conta pessoal?",
    );
    if (confirm != true) return;
    // O dialogo de confirmacao e await: revalida antes de tocar no context.
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    setState(() => _isLoading = true);
    final bool success = await apiRemoveMoradorFinanceiro(item['id']);
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
    // Código escaneado do boleto (opcional): fica salvo junto com a conta.
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
                          backgroundColor: AppColors.brand,
                          foregroundColor: AppColors.onBrand,
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
                            _loadData();
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
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppColors.onBrand),
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
        double itemWidth = 58.0; // 50 container width + 8 horizontal margin (4 on each side)
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
                    var prev = months[selectedIndex - 1];
                    setState(() {
                      mes = prev['mes'];
                      ano = prev['ano'];
                    });
                    _loadData(showLoading: false);
                    _scrollToSelectedMonth(selectedIndex - 1);
                  }
                : null,
          ),
          Expanded(
            child: SizedBox(
              height: 58,
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
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      setState(() {
                        mes = m['mes'];
                        ano = m['ano'];
                      });
                      _loadData(showLoading: false);
                      _scrollToSelectedMonth(index);
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 50,
                      height: 54,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: isSelected ? AppColors.brand : Colors.transparent,
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            monthName.toUpperCase(),
                            style: AppTypography.label(context).copyWith(
                              color: isSelected ? AppColors.onBrand : AppColors.textSecondary(context),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            yearShort,
                            style: AppTypography.tiny(context).copyWith(
                              color: isSelected ? AppColors.onBrand : AppColors.textTertiary(context),
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
              color: selectedIndex < months.length - 1 
                  ? AppColors.textTertiary(context) 
                  : AppColors.border(context).withValues(alpha: 0.4),
            ),
            onPressed: selectedIndex < months.length - 1
                ? () {
                    var next = months[selectedIndex + 1];
                    setState(() {
                      mes = next['mes'];
                      ano = next['ano'];
                    });
                    _loadData(showLoading: false);
                    _scrollToSelectedMonth(selectedIndex + 1);
                  }
                : null,
          ),
        ],
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
  final Function(dynamic item, {VoidCallback? onChanged}) buildFinanceiroCard;

  const MoradorFinanceiroCategoryDetailPage({
    super.key,
    required this.title,
    required this.icon,
    required this.getItems,
    required this.personalCategories,
    required this.mes,
    required this.ano,
    required this.onRefresh,
    required this.showContaFormModal,
    required this.buildFinanceiroCard,
  });

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
      // Esta copia devolvia false para data ISO, enquanto as outras jogavam o
      // item no mes corrente: o card dizia "1 pendente" e o detalhe abria vazio.
      return competenciaDe(item).pertenceAo(widget.mes, widget.ano);
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
    // isPagoValor (não `== 0`): um item com pago=2 sumia deste total mas
    // contava como pendente no badge do grid, e os dois números discordavam.
    for (var item in mergedItems) {
      if (!isPagoValor(item['pago'])) {
        totalPendente += parseValorMoeda(item['valor']);
      }
    }

    return AppScaffold(
      title: widget.title,
      floatingActionButton: !isCondo
          ? Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.zero,
              ),
              child: FloatingActionButton.extended(
                heroTag: null,
                elevation: 0,
                highlightElevation: 0,
                onPressed: () {
                  widget.showContaFormModal(
                    initialCategory: widget.title,
                    customContext: context,
                    onSuccess: () {
                      setState(() {});
                    },
                  );
                },
                icon: Icon(PhosphorIcons.plusBold, color: AppColors.onBrand, size: 18),
                label: Text(
                  "Adicionar Conta",
                  style: TextStyle(
                    color: AppColors.onBrand,
                    fontWeight: FontWeight.w800,
                    fontSize: 14.5,
                    letterSpacing: 0.2,
                  ),
                ),
                backgroundColor: AppColors.brand,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.zero,
                ),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () async {
          widget.onRefresh();
          await Future.delayed(const Duration(milliseconds: 500));
          if (mounted) setState(() {});
        },
        child: ListView(
          padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: fabClearance(context)),
          children: [
            // Mesmo cartão amarelo do resumo do Financeiro (antes era o bloco
            // preto da paleta antiga); ícone na moldura amarela dos módulos.
            Container(
              padding: const EdgeInsets.all(20),
              decoration: cartaoDestaque(context),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(border: Border.all(color: AppColors.brand, width: 1.5)),
                    child: Icon(widget.icon, color: AppColors.textPrimary(context), size: 24),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Total pendente · ${widget.title}'.toUpperCase(),
                          style: AppTypography.label(context),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          "${Singleton.instance.getCurrentMoeda()} ${formatMoeda(totalPendente)}",
                          style: AppTypography.display(context).copyWith(
                            color: AppColors.textPrimary(context),
                            fontSize: 28,
                            fontWeight: FontWeight.w300,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
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
                  borderRadius: BorderRadius.zero,
                  border: Border.all(
                    color: AppColors.border(context),
                    width: 1.1,
                  ),
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
                return widget.buildFinanceiroCard(item, onChanged: () {
                  if (mounted) setState(() {});
                  widget.onRefresh();
                });
              }),
          ],
        ),
      ),
    );
  }
}
