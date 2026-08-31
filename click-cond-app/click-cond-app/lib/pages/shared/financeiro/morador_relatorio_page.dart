import 'dart:io';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/widgets/app/app_scaffold.dart';

class MoradorRelatorioPage extends StatefulWidget {
  final String initialMes;
  final String initialAno;
  final List<dynamic>? items;
  final VoidCallback? onRefresh;

  const MoradorRelatorioPage({
    Key? key,
    required this.initialMes,
    required this.initialAno,
    this.items,
    this.onRefresh,
  }) : super(key: key);

  @override
  State<MoradorRelatorioPage> createState() => _MoradorRelatorioPageState();
}

class _MoradorRelatorioPageState extends State<MoradorRelatorioPage> {
  late String _selectedMes;
  late String _selectedAno;
  String _selectedPeriodoType = 'mes'; // 'mes', 'ano', 'tudo'
  String _selectedCategory = 'Todas';
  String _selectedStatus = 'todos'; // 'todos', 'pendentes', 'pagos'
  String _selectedTipoRelatorio = 'detalhado'; // 'detalhado', 'resumo'

  List<dynamic> _items = [];
  bool _isLoading = false;
  bool _isExporting = false;

  final List<String> _categories = [
    'Todas',
    'Condomínio',
    'Aluguel',
    'Água',
    'Luz',
    'Internet',
    'Outros',
  ];

  final List<Map<String, String>> _meses = [
    {'num': '01', 'name': 'Jan', 'full': 'Janeiro'},
    {'num': '02', 'name': 'Fev', 'full': 'Fevereiro'},
    {'num': '03', 'name': 'Mar', 'full': 'Março'},
    {'num': '04', 'name': 'Abr', 'full': 'Abril'},
    {'num': '05', 'name': 'Mai', 'full': 'Maio'},
    {'num': '06', 'name': 'Jun', 'full': 'Junho'},
    {'num': '07', 'name': 'Jul', 'full': 'Julho'},
    {'num': '08', 'name': 'Ago', 'full': 'Agosto'},
    {'num': '09', 'name': 'Set', 'full': 'Setembro'},
    {'num': '10', 'name': 'Out', 'full': 'Outubro'},
    {'num': '11', 'name': 'Nov', 'full': 'Novembro'},
    {'num': '12', 'name': 'Dez', 'full': 'Dezembro'},
  ];

  final List<String> _anos = [];

  @override
  void initState() {
    super.initState();
    _selectedMes = widget.initialMes.padLeft(2, '0');
    _selectedAno = widget.initialAno;

    final currentYear = DateTime.now().year;
    for (int y = currentYear - 2; y <= currentYear + 2; y++) {
      _anos.add(y.toString());
    }
    if (!_anos.contains(_selectedAno)) {
      _anos.add(_selectedAno);
      _anos.sort();
    }

    if (widget.items != null && widget.items!.isNotEmpty) {
      _items = List.from(widget.items!);
    } else {
      _loadData();
    }
  }

  Future<void> _loadData() async {
    try {
      setState(() => _isLoading = true);
      final dynamic data = await apiGetFinanceiroByUser();
      if (data is List) {
        final loggedUserId = getUserId();
        final filtered = <dynamic>[];
        for (var item in data) {
          if (item is Map) {
            final idUsuario = item['id_usuario'];
            if (idUsuario != null && idUsuario.toString() == loggedUserId) {
              filtered.add(item);
            } else {
              // Também aceita se for fatura de apto deste morador
              final nome = (item['nome'] ?? '').toString().toLowerCase();
              final myApto = Singleton.instance.apartamento?.toString().toLowerCase() ?? '';
              final myBloco = Singleton.instance.bloco?.toString().toLowerCase() ?? '';
              if (myApto.isNotEmpty && myBloco.isNotEmpty) {
                if (nome.contains('apto $myApto') && nome.contains('bloco $myBloco')) {
                  filtered.add(item);
                }
              }
            }
          }
        }
        setState(() => _items = filtered);
      }
    } catch (e) {
      debugPrint('Erro ao carregar dados para relatório: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Map<String, String> _getMesAno(dynamic item) {
    String v = item['data_vencimento']?.toString() ?? '';
    if (v.isEmpty) v = item['data']?.toString() ?? '';
    if (v.isNotEmpty && v.contains('/')) {
      var parts = v.split('/');
      if (parts.length >= 3) {
        return {'mes': parts[1].padLeft(2, '0'), 'ano': parts[2]};
      }
    }
    String nome = item['nome']?.toString() ?? '';
    if (nome.contains('Ref.')) {
      var refPart = nome.split('Ref.').last.trim();
      if (refPart.contains('/')) {
        var parts = refPart.split('/');
        return {'mes': parts[0].padLeft(2, '0'), 'ano': parts[1]};
      }
    }
    var now = DateTime.now();
    return {'mes': now.month.toString().padLeft(2, '0'), 'ano': now.year.toString()};
  }

  Color _corCategoria(String cat) {
    switch (cat) {
      case 'Condomínio':
      case 'Taxa Condominial':
        return const Color(0xFF2563EB);
      case 'Aluguel':
        return const Color(0xFF6366F1);
      case 'Água':
        return const Color(0xFF0EA5E9);
      case 'Luz':
        return const Color(0xFFF59E0B);
      case 'Internet':
        return const Color(0xFF8B5CF6);
      default:
        return const Color(0xFF10B981);
    }
  }

  IconData _iconeCategoria(String cat) {
    switch (cat) {
      case 'Condomínio':
      case 'Taxa Condominial':
        return PhosphorIcons.buildings;
      case 'Aluguel':
        return PhosphorIcons.house;
      case 'Água':
        return PhosphorIcons.drop;
      case 'Luz':
        return PhosphorIcons.lightning;
      case 'Internet':
        return PhosphorIcons.wifiHigh;
      default:
        return PhosphorIcons.fileText;
    }
  }

  List<dynamic> _getFilteredItems() {
    final allIds = <dynamic>{};
    final uniqueItems = <dynamic>[];
    for (var item in _items) {
      if (allIds.add(item['id'])) {
        uniqueItems.add(item);
      }
    }

    return uniqueItems.where((item) {
      // 1. Filtro de Categoria
      if (_selectedCategory != 'Todas') {
        final cat = (item['categoria'] ?? '').toString();
        final tipo = (item['tipo'] ?? '').toString();
        if (_selectedCategory == 'Condomínio') {
          if (cat != 'Condomínio' && cat != 'Taxa Condominial' && tipo != 'C') {
            return false;
          }
        } else if (cat != _selectedCategory) {
          return false;
        }
      }

      // 2. Filtro de Status
      final int pago = item['pago'] is int
          ? item['pago']
          : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      if (_selectedStatus == 'pendentes' && pago == 1) return false;
      if (_selectedStatus == 'pagos' && pago != 1) return false;

      // 3. Filtro de Período
      final info = _getMesAno(item);
      if (_selectedPeriodoType == 'mes') {
        if (info['mes'] != _selectedMes || info['ano'] != _selectedAno) {
          return false;
        }
      } else if (_selectedPeriodoType == 'ano') {
        if (info['ano'] != _selectedAno) {
          return false;
        }
      }
      return true;
    }).toList();
  }

  double _getValor(dynamic item) {
    if (item['valor'] is num) {
      return (item['valor'] as num).toDouble();
    }
    if (item['valor'] != null) {
      return double.tryParse(item['valor'].toString()) ?? 0.0;
    }
    return 0.0;
  }

  Future<void> _exportarRelatorio() async {
    final filtered = _getFilteredItems();
    if (filtered.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Nenhuma conta encontrada para o filtro selecionado."),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
      return;
    }

    try {
      setState(() => _isExporting = true);

      final buffer = StringBuffer();
      // UTF-8 BOM para garantir compatibilidade com Microsoft Excel
      buffer.write('\uFEFF');

      final moeda = Singleton.instance.getCurrentMoeda();
      final userName = getUsername();
      final apto = Singleton.instance.apartamento;
      final bloco = Singleton.instance.bloco;
      final dataAtual = DateFormat('dd/MM/yyyy HH:mm').format(DateTime.now());

      String periodoTexto = '';
      if (_selectedPeriodoType == 'mes') {
        final mesNome = _meses.firstWhere((m) => m['num'] == _selectedMes, orElse: () => {'full': _selectedMes})['full'];
        periodoTexto = '$mesNome / $_selectedAno';
      } else if (_selectedPeriodoType == 'ano') {
        periodoTexto = 'Ano de $_selectedAno';
      } else {
        periodoTexto = 'Todo o Histórico';
      }

      // Cabeçalho institucional do relatório
      buffer.writeln('CLICK - RELATÓRIO FINANCEIRO PESSOAL DO MORADOR');
      buffer.writeln('Data de Emissão:;$dataAtual');
      buffer.writeln('Morador:;${userName.isNotEmpty ? userName : 'Morador'}');
      if (apto.isNotEmpty || bloco.isNotEmpty) {
        buffer.writeln('Unidade:;Bloco $bloco - Apto $apto');
      }
      buffer.writeln('Período:;$periodoTexto');
      buffer.writeln('Categoria Filtrada:;$_selectedCategory');
      buffer.writeln('Status Filtrado:;${_selectedStatus.toUpperCase()}');
      buffer.writeln('');

      double totalPago = 0;
      double totalPendente = 0;

      if (_selectedTipoRelatorio == 'resumo') {
        // Relatório resumido por categoria
        buffer.writeln('CATEGORIA;QTD DE CONTAS;TOTAL PAGO ($moeda);TOTAL PENDENTE ($moeda);TOTAL GERAL ($moeda)');
        
        final Map<String, List<dynamic>> porCategoria = {};
        for (var item in filtered) {
          final cat = (item['categoria'] ?? 'Outros').toString();
          porCategoria.putIfAbsent(cat, () => []).add(item);
        }

        porCategoria.forEach((cat, lista) {
          double catPago = 0;
          double catPendente = 0;
          for (var i in lista) {
            final val = _getValor(i);
            final int p = i['pago'] is int ? i['pago'] : (int.tryParse(i['pago']?.toString() ?? '') ?? 0);
            if (p == 1) {
              catPago += val;
              totalPago += val;
            } else {
              catPendente += val;
              totalPendente += val;
            }
          }
          final catTotal = catPago + catPendente;
          buffer.writeln('$cat;${lista.length};${catPago.toStringAsFixed(2).replaceAll('.', ',')};${catPendente.toStringAsFixed(2).replaceAll('.', ',')};${catTotal.toStringAsFixed(2).replaceAll('.', ',')}');
        });
      } else {
        // Relatório detalhado item a item
        buffer.writeln('CATEGORIA;DESCRIÇÃO;VENCIMENTO;VALOR ($moeda);STATUS;DATA PAGAMENTO;LINHA DIGITÁVEL / PIX');

        for (var item in filtered) {
          final cat = (item['categoria'] ?? 'Outros').toString();
          final nome = (item['nome'] ?? '').toString().replaceAll(';', ' - ');
          final venc = (item['data_vencimento'] ?? item['data'] ?? '').toString();
          final valor = _getValor(item);
          final int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
          final statusStr = pago == 1 ? 'PAGO' : 'PENDENTE';
          final dataPagamento = (item['data_pagamento'] ?? '-').toString();
          final codigo = (item['linha_digitavel'] ?? item['pix_copia_cola'] ?? '-').toString().replaceAll(';', ' ');

          if (pago == 1) {
            totalPago += valor;
          } else {
            totalPendente += valor;
          }

          buffer.writeln('$cat;$nome;$venc;${valor.toStringAsFixed(2).replaceAll('.', ',')};$statusStr;$dataPagamento;$codigo');
        }
      }

      // Resumo final de consolidação
      buffer.writeln('');
      buffer.writeln('RESUMO GERAL DO PERÍODO;');
      buffer.writeln('Total de Lançamentos:;${filtered.length}');
      buffer.writeln('Total Pago:;$moeda ${totalPago.toStringAsFixed(2).replaceAll('.', ',')}');
      buffer.writeln('Total Pendente:;$moeda ${totalPendente.toStringAsFixed(2).replaceAll('.', ',')}');
      buffer.writeln('Total Consolidado:;$moeda ${(totalPago + totalPendente).toStringAsFixed(2).replaceAll('.', ',')}');

      final dir = await getTemporaryDirectory();
      final sanitizedPeriod = periodoTexto.replaceAll('/', '-').replaceAll(' ', '_');
      final fileName = 'Relatorio_Financeiro_${sanitizedPeriod}_${DateTime.now().millisecondsSinceEpoch}.csv';
      final file = File('${dir.path}/$fileName');
      await file.writeAsString(buffer.toString());

      if (mounted) {
        setState(() => _isExporting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: const [
                Icon(PhosphorIcons.checkCircleFill, color: Colors.white, size: 20),
                SizedBox(width: 10),
                Expanded(child: Text("Relatório gerado com sucesso! Abrindo...")),
              ],
            ),
            backgroundColor: const Color(0xFF10B981),
            duration: const Duration(seconds: 3),
          ),
        );
        await OpenFilex.open(file.path);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isExporting = false);
        displayMessage(context, "Erro ao Exportar", e.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _getFilteredItems();
    final moeda = Singleton.instance.getCurrentMoeda();

    double totalPago = 0;
    double totalPendente = 0;
    for (var item in filtered) {
      final val = _getValor(item);
      final int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
      if (pago == 1) {
        totalPago += val;
      } else {
        totalPendente += val;
      }
    }
    final double totalGeral = totalPago + totalPendente;

    return AppScaffold(
      title: "Exportar Relatório",
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
              children: [
                // Card de Introdução e Resumo Rápido
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppColors.primary, AppColors.primaryDark],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withOpacity(0.3),
                        blurRadius: 12,
                        offset: const Offset(0, 5),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(PhosphorIcons.fileCsv, color: Colors.white, size: 24),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  "Relatório Pessoal",
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  "Personalize os filtros para exportar seus dados",
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.85),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _buildMiniSummary("Total Geral", "$moeda ${formatMoeda(totalGeral)}"),
                            Container(width: 1, height: 28, color: Colors.white24),
                            _buildMiniSummary("Pendente", "$moeda ${formatMoeda(totalPendente)}"),
                            Container(width: 1, height: 28, color: Colors.white24),
                            _buildMiniSummary("Contas", "${filtered.length}"),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                // 1. Tipo de Relatório
                _buildSectionHeader("1. Modelo de Relatório", PhosphorIcons.files),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _buildSelectCard(
                        title: "Extrato Detalhado",
                        subtitle: "Conta a conta com códigos",
                        icon: PhosphorIcons.listNumbers,
                        isSelected: _selectedTipoRelatorio == 'detalhado',
                        onTap: () => setState(() => _selectedTipoRelatorio = 'detalhado'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildSelectCard(
                        title: "Resumo por Categoria",
                        subtitle: "Totais consolidados",
                        icon: PhosphorIcons.chartPieSlice,
                        isSelected: _selectedTipoRelatorio == 'resumo',
                        onTap: () => setState(() => _selectedTipoRelatorio = 'resumo'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),

                // 2. Filtro de Conta / Categoria
                _buildSectionHeader("2. Conta / Categoria", PhosphorIcons.tag),
                const SizedBox(height: 10),
                SizedBox(
                  height: 40,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _categories.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, i) {
                      final cat = _categories[i];
                      final isSelected = _selectedCategory == cat;
                      final cor = cat == 'Todas' ? AppColors.primary : _corCategoria(cat);

                      return GestureDetector(
                        onTap: () => setState(() => _selectedCategory = cat),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: isSelected ? cor : AppColors.surface(context),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: isSelected ? cor : AppColors.border(context),
                              width: 1.2,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                cat == 'Todas' ? PhosphorIcons.squaresFour : _iconeCategoria(cat),
                                size: 16,
                                color: isSelected ? Colors.white : cor,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                cat,
                                style: TextStyle(
                                  color: isSelected ? Colors.white : AppColors.textPrimary(context),
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 22),

                // 3. Período / Mês
                _buildSectionHeader("3. Período do Relatório", PhosphorIcons.calendar),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: Row(
                    children: [
                      _buildPeriodoTab("Mês Específico", 'mes'),
                      _buildPeriodoTab("Ano Completo", 'ano'),
                      _buildPeriodoTab("Histórico Geral", 'tudo'),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                if (_selectedPeriodoType == 'mes') ...[
                  // Seletor de Meses
                  SizedBox(
                    height: 48,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _meses.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (context, index) {
                        final m = _meses[index];
                        final isSelected = m['num'] == _selectedMes;

                        return GestureDetector(
                          onTap: () => setState(() => _selectedMes = m['num']!),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            width: 54,
                            decoration: BoxDecoration(
                              color: isSelected ? AppColors.primary : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected ? AppColors.primary : AppColors.border(context),
                              ),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  m['name']!.toUpperCase(),
                                  style: TextStyle(
                                    color: isSelected ? Colors.white : AppColors.textPrimary(context),
                                    fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Seletor de Ano
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text("Ano: ", style: AppTypography.caption(context)),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.surface(context),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.border(context)),
                        ),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: _selectedAno,
                            isDense: true,
                            items: _anos.map((a) {
                              return DropdownMenuItem(
                                value: a,
                                child: Text(a, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                              );
                            }).toList(),
                            onChanged: (v) {
                              if (v != null) setState(() => _selectedAno = v);
                            },
                          ),
                        ),
                      ),
                    ],
                  ),
                ] else if (_selectedPeriodoType == 'ano') ...[
                  Row(
                    children: [
                      Text("Selecione o ano: ", style: AppTypography.body(context)),
                      const Spacer(),
                      Wrap(
                        spacing: 8,
                        children: _anos.map((a) {
                          final isSelected = a == _selectedAno;
                          return ChoiceChip(
                            label: Text(a),
                            selected: isSelected,
                            onSelected: (_) => setState(() => _selectedAno = a),
                            selectedColor: AppColors.primary,
                            labelStyle: TextStyle(
                              color: isSelected ? Colors.white : AppColors.textPrimary(context),
                              fontWeight: FontWeight.bold,
                            ),
                          );
                        }).toList(),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 22),

                // 4. Status de Pagamento
                _buildSectionHeader("4. Status das Contas", PhosphorIcons.checkCircle),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _buildStatusChip("Todas", 'todos', PhosphorIcons.listBullets),
                    const SizedBox(width: 8),
                    _buildStatusChip("Pendentes", 'pendentes', PhosphorIcons.warningCircle),
                    const SizedBox(width: 8),
                    _buildStatusChip("Pagas", 'pagos', PhosphorIcons.checkCircle),
                  ],
                ),
                const SizedBox(height: 26),

                // Pré-visualização dos Itens Filtrados
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        "Prévia dos Lançamentos (${filtered.length})",
                        style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (filtered.isNotEmpty)
                      Text(
                        "$moeda ${formatMoeda(totalGeral)}",
                        style: const TextStyle(
                          color: AppColors.primary,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),

                if (filtered.isEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
                    decoration: BoxDecoration(
                      color: AppColors.surface(context),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.border(context)),
                    ),
                    child: Column(
                      children: [
                        Icon(PhosphorIcons.folderNotchOpen, size: 40, color: AppColors.textTertiary(context)),
                        const SizedBox(height: 10),
                        Text(
                          "Nenhuma conta encontrada com os filtros selecionados.",
                          style: AppTypography.caption(context),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                else
                  ...filtered.take(10).map((item) {
                    final cat = (item['categoria'] ?? 'Outros').toString();
                    final cor = _corCategoria(cat);
                    final icon = _iconeCategoria(cat);
                    final nome = (item['nome'] ?? '').toString();
                    final valor = _getValor(item);
                    final int pago = item['pago'] is int ? item['pago'] : (int.tryParse(item['pago']?.toString() ?? '') ?? 0);
                    final venc = (item['data_vencimento'] ?? item['data'] ?? '').toString();

                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border(context)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              color: cor.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(icon, color: cor, size: 20),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  nome.isNotEmpty ? nome : cat,
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  "Venc: $venc",
                                  style: TextStyle(color: AppColors.textTertiary(context), fontSize: 11.5),
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                "$moeda ${formatMoeda(valor)}",
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                              const SizedBox(height: 2),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: pago == 1
                                      ? const Color(0xFF10B981).withOpacity(0.12)
                                      : const Color(0xFFEF4444).withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  pago == 1 ? "PAGO" : "PENDENTE",
                                  style: TextStyle(
                                    color: pago == 1 ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  }).toList(),

                if (filtered.length > 10)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      "+ ${filtered.length - 10} outras contas serão incluídas no arquivo exportado.",
                      style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
                      textAlign: TextAlign.center,
                    ),
                  ),
              ],
            ),
      bottomNavigationBar: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        decoration: BoxDecoration(
          color: AppColors.bg(context),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.06),
              blurRadius: 10,
              offset: const Offset(0, -3),
            ),
          ],
        ),
        child: ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            minimumSize: const Size(double.infinity, 52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            elevation: 2,
          ),
          onPressed: _isExporting ? null : _exportarRelatorio,
          icon: _isExporting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                )
              : const Icon(PhosphorIcons.downloadSimpleBold, size: 20),
          label: Text(
            _isExporting ? "Gerando Relatório..." : "Gerar e Baixar Relatório",
            style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.bold),
          ),
        ),
      ),
    );
  }

  Widget _buildMiniSummary(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: TextStyle(color: Colors.white.withOpacity(0.8), fontSize: 11),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 13.5,
          ),
        ),
      ],
    );
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 17, color: AppColors.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: AppTypography.bodyMedium(context).copyWith(
            fontWeight: FontWeight.bold,
            fontSize: 15,
          ),
        ),
      ],
    );
  }

  Widget _buildSelectCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary.withOpacity(0.08) : AppColors.surface(context),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.border(context),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icon,
              size: 22,
              color: isSelected ? AppColors.primary : AppColors.textSecondary(context),
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: isSelected ? AppColors.primary : AppColors.textPrimary(context),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 10.5,
                color: AppColors.textTertiary(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPeriodoTab(String label, String value) {
    final isSelected = _selectedPeriodoType == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedPeriodoType = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                color: isSelected ? Colors.white : AppColors.textSecondary(context),
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStatusChip(String label, String value, IconData icon) {
    final isSelected = _selectedStatus == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedStatus = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 8),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.border(context),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 14,
                color: isSelected ? Colors.white : AppColors.textSecondary(context),
              ),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppColors.textPrimary(context),
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
