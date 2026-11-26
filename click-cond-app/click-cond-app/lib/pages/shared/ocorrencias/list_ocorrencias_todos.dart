import 'dart:async';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/ocorrencia_sla.dart';
import 'package:click/services/atualizacoes_app.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/nome_proprio.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_filtro_chip.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListOcorrenciasTodos extends StatefulWidget {
  final String? statusFilter;
  const ListOcorrenciasTodos({super.key, this.statusFilter});
  @override
  _ListOcorrenciasTodosPageState createState() => _ListOcorrenciasTodosPageState();
}

class _ListOcorrenciasTodosPageState extends State<ListOcorrenciasTodos> {
  List<dynamic> list = [];
  bool _isLoading = false;
  DateTime? _selectedMonth;

  // Helper para gerar os últimos 12 meses em português
  List<Map<String, dynamic>> _getMonths() {
    final monthsPt = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    List<Map<String, dynamic>> res = [];
    final now = DateTime.now();
    for (int i = 0; i < 12; i++) {
      final date = DateTime(now.year, now.month - i, 1);
      res.add({
        'month': date.month,
        'year': date.year,
        'label': "${monthsPt[date.month - 1]} / ${date.year}",
      });
    }
    return res;
  }

  List<dynamic> _getFilteredList() {
    List<dynamic> temp = list;
    if (widget.statusFilter != null) {
      temp = temp.where((item) {
        final s = (item['status']?.toString() ?? '').toLowerCase();
        if (widget.statusFilter == 'Pendente') {
          return s == 'pendente';
        } else if (widget.statusFilter == 'Em andamento') {
          return s == 'ciente' || s == 'em andamento' || s == 'em_andamento';
        } else if (widget.statusFilter == 'Solucionado') {
          return s == 'solucionado' || s == 'resolvida';
        }
        return true;
      }).toList();
    }
    if (_selectedMonth == null) return temp;
    return temp.where((item) {
      if (item['created_at'] == null) return false;
      try {
        final date = DateTime.parse(item['created_at'].toString()).toLocal();
        return date.month == _selectedMonth!.month && date.year == _selectedMonth!.year;
      } catch (_) {
        return false;
      }
    }).toList();
  }

  /// Push de ocorrência ou volta ao app: cada aba aberta recarrega a sua
  /// lista (a tela das abas, [ListOcorrencias], não precisa assinar).
  StreamSubscription<DominioApp>? _atualizacoes;

  @override
  void initState() {
    super.initState();
    _atualizacoes = ouvirAtualizacoes({DominioApp.ocorrencia}, () {
      if (mounted) loadList(recarga: true);
    });
    loadList();
  }

  @override
  void dispose() {
    _atualizacoes?.cancel();
    super.dispose();
  }

  /// [recarga] na atualização automática, na volta do detalhe (depois de
  /// mudar status/atribuir) e no puxar-para-atualizar: se a busca falhar (sem
  /// rede, 401/5xx), fica a lista atual e não abre alerta.
  Future<void> loadList({bool recarga = false}) async {
    try {
      if (list.isEmpty) setState(() => _isLoading = true);
      if (recarga) {
        final novo = await apiGetAllOuNull("ocorrencias/todos");
        if (novo != null) list = novo;
      } else {
        list = await apiGetAll("ocorrencias/todos");
      }
    } catch (e) {
      if (mounted && !recarga) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: 8,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, __) => AppSkeleton.listTile(context),
      );
    }

    final filteredList = _getFilteredList();
    final months = _getMonths();

    return Column(
      children: [
        // Seletor de Meses Premium
        Container(
          height: 52,
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.textTertiary(context).withValues(alpha: 0.08),
                width: 1,
              ),
            ),
          ),
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            children: [
              Padding(
                padding: const EdgeInsets.only(right: AppSpacing.sm),
                child: AppFiltroChip(
                  label: 'Todos os meses',
                  selected: _selectedMonth == null,
                  onTap: () => setState(() => _selectedMonth = null),
                ),
              ),
              ...months.map((m) {
                final isSelected = _selectedMonth != null &&
                    _selectedMonth!.month == m['month'] &&
                    _selectedMonth!.year == m['year'];
                return Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: AppFiltroChip(
                    label: m['label'],
                    selected: isSelected,
                    onTap: () => setState(() {
                      _selectedMonth = isSelected ? null : DateTime(m['year'], m['month']);
                    }),
                  ),
                );
              }),
            ],
          ),
        ),
        
        // Lista
        Expanded(
          child: filteredList.isEmpty
              // Vazio também aceita puxar para atualizar: era exatamente o
              // estado em que o morador ficava preso após abrir a 1ª ocorrência.
              ? RefreshIndicator(
                  onRefresh: () => loadList(recarga: true),
                  child: LayoutBuilder(
                    builder: (context, constraints) => SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      child: SizedBox(
                        height: constraints.maxHeight,
                        child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        widget.statusFilter == 'Solucionado'
                            ? PhosphorIcons.checkCircle
                            : PhosphorIcons.warning,
                        size: 48,
                        color: widget.statusFilter == 'Solucionado'
                            ? AppColors.success
                            : AppColors.textTertiary(context),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        _selectedMonth == null 
                            ? (widget.statusFilter == 'Pendente' 
                                ? 'Nenhuma ocorrência pendente encontrada.' 
                                : widget.statusFilter == 'Em andamento'
                                    ? 'Nenhuma ocorrência em andamento encontrada.'
                                    : widget.statusFilter == 'Solucionado'
                                        ? 'Nenhuma ocorrência solucionada encontrada.'
                                        : getText('alert_list_empty_generic'))
                            : 'Nenhuma ocorrência encontrada neste mês.',
                        style: AppTypography.caption(context),
                      ),
                    ],
                  ),
                        ),
                      ),
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => loadList(recarga: true),
                  child: ListView.separated(
                    // Respiro embaixo: o "+" flutuante não cobre o último card.
                    padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 96),
                    itemCount: filteredList.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) => _OcorrenciaCard(
                      item: filteredList[i],
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => DetailOcorrencia(id: filteredList[i]['id'])),
                      ).then((_) => loadList(recarga: true)),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

}

class _OcorrenciaCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _OcorrenciaCard({required this.item, required this.onTap});

  Color _statusColor(dynamic status) {
    final s = (status?.toString() ?? '').toLowerCase();
    if (s == 'solucionado' || s == 'resolvida') {
      return AppColors.success; // Green
    }
    if (s == 'ciente' || s == 'em andamento' || s == 'em_andamento') {
      return AppColors.primary; // Blue
    }
    return AppColors.warning; // Amber / Yellow
  }

  IconData _statusIcon(dynamic status) {
    final s = (status?.toString() ?? '').toLowerCase();
    if (s == 'solucionado' || s == 'resolvida') {
      return PhosphorIcons.checkCircle;
    }
    if (s == 'ciente' || s == 'em andamento' || s == 'em_andamento') {
      return PhosphorIcons.clock;
    }
    return PhosphorIcons.warning;
  }

  String _statusLabel(dynamic status) {
    final s = (status?.toString() ?? '').toLowerCase();
    if (s == 'solucionado' || s == 'resolvida') {
      return 'Solucionada';
    }
    if (s == 'ciente') return 'Ciente';
    if (s == 'em andamento' || s == 'em_andamento') {
      return 'Em andamento';
    }
    return 'Pendente';
  }

  @override
  Widget build(BuildContext context) {
    final statusVal = item['status'];
    // O texto do problema é o principal; o tipo (categoria) vira legenda.
    final categoria = (item['tipo'] ?? '').toString().trim();
    final descricao = (item['descricao'] ?? '').toString().trim();
    final autor = (item['criado_por'] ?? '').toString().trim();
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.zero),
        child: Row(
          children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: _statusColor(statusVal).withValues(alpha: 0.12),
                borderRadius: BorderRadius.zero,
              ),
              child: Icon(_statusIcon(statusVal), color: _statusColor(statusVal), size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (categoria.isNotEmpty)
                    Text(
                      categoria.toUpperCase(),
                      style: AppTypography.label(context).copyWith(color: AppColors.textTertiary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (descricao.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(descricao, style: AppTypography.bodyMedium(context), maxLines: 2, overflow: TextOverflow.ellipsis),
                  ],
                  const SizedBox(height: AppSpacing.xs + 2),
                  Row(
                    children: [
                      _Tag(label: _statusLabel(statusVal), cor: _statusColor(statusVal)),
                      if (ocorrenciaAtrasada(item)) ...[
                        const SizedBox(width: 4),
                        _Tag(label: 'Atrasada', cor: AppColors.error),
                      ],
                    ],
                  ),
                  if (autor.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'Autor: ${nomeProprio(autor)}',
                        style: AppTypography.caption(context).copyWith(fontSize: 10, color: AppColors.textSecondary(context)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}

/// Etiqueta de uma linha (nunca quebra): status e "Atrasada" do card.
class _Tag extends StatelessWidget {
  final String label;
  final Color cor;
  const _Tag({required this.label, required this.cor});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.zero,
      ),
      child: Text(
        label.toUpperCase(),
        maxLines: 1,
        style: AppTypography.tiny(context).copyWith(color: cor, fontWeight: FontWeight.bold),
      ),
    );
  }
}
