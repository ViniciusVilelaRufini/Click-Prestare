import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/new_votacao.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_filtro_meses.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/widgets/votacao/votacao_card.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListEnquetes extends StatefulWidget {
  const ListEnquetes({super.key});
  @override
  _ListEnquetesPageState createState() => _ListEnquetesPageState();
}

class _ListEnquetesPageState extends State<ListEnquetes> {
  List<dynamic> list = [];
  bool _isLoading = false;
  // Nulo = "Todos os meses" (padrão): todas as enquetes aparecem ao abrir.
  DateTime? _selectedMonth;

  @override
  void initState() {
    super.initState();
    initializeDateFormatting('pt_BR');
    loadList();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAll("assembleias/votacoes/enquetes");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Data de início/término ("dd/MM/yyyy") da enquete, ou nulo se ilegível.
  static DateTime? dataEnquete(dynamic item) {
    final raw = (item['data_inicio'] ?? item['data_termino'] ?? '').toString();
    final parts = raw.split('/');
    if (parts.length != 3) return null;
    final d = int.tryParse(parts[0]), m = int.tryParse(parts[1]), y = int.tryParse(parts[2]);
    if (d == null || m == null || y == null) return null;
    return DateTime(y, m, d);
  }

  /// Mais recentes primeiro; sem data vão para o fim (ordem original mantida).
  List<dynamic> get _filteredList {
    final sel = _selectedMonth;
    final itens = list.where((item) {
      if (sel == null) return true;
      final d = dataEnquete(item);
      // Sem data legível: continua aparecendo, como antes.
      return d == null || (d.month == sel.month && d.year == sel.year);
    }).toList();
    final indexados = [for (var i = 0; i < itens.length; i++) (i, itens[i])];
    indexados.sort((a, b) {
      final da = dataEnquete(a.$2), db = dataEnquete(b.$2);
      if (da == null && db == null) return a.$1.compareTo(b.$1);
      if (da == null) return 1;
      if (db == null) return -1;
      final c = db.compareTo(da);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
    return [for (final e in indexados) e.$2];
  }

  void _abrir(dynamic item) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => DetailEnquete(id: item['id'])))
        .then((_) => loadList());
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final filtered = _filteredList;
    // Folga para o FAB do síndico não cobrir o último card.
    final folgaFinal = isSindico ? 88.0 : AppSpacing.xl;

    return AppScaffold(
      title: getText('lb_enquetes'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewVotacao(isEnquete: true)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.brand,
              child: Icon(PhosphorIcons.plus, color: AppColors.onBrand),
            )
          : null,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppFiltroMeses(
            selecionado: _selectedMonth,
            onChanged: (m) => setState(() => _selectedMonth = m),
          ),
          // ── List ─────────────────────────────────────────────────────
          Expanded(
            child: _isLoading
                ? ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: 5,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, __) => const _CardSkeleton(),
                  )
                : RefreshIndicator(
                    onRefresh: loadList,
                    child: filtered.isEmpty
                        ? ListView(
                            // Rolável para o "puxar para atualizar" funcionar no vazio.
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, folgaFinal),
                            children: [
                              _EstadoVazio(mes: _selectedMonth),
                            ],
                          )
                        : ListView.separated(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, folgaFinal),
                            itemCount: filtered.length,
                            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                            itemBuilder: (_, i) {
                              final item = filtered[i];
                              final descricao = (item['descricao'] ?? '').toString().trim();
                              return VotacaoCard.fromItem(
                                item,
                                subtitulo: descricao.isEmpty || descricao == 'null' ? null : descricao,
                                onTap: () => _abrir(item),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}

// ── Estados ──────────────────────────────────────────────────────────────────

/// Mesmo contorno do [VotacaoCard] para a troca skeleton → lista não pular.
class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AppSkeleton(width: 44, height: 44, borderRadius: AppRadius.md),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: LayoutBuilder(
              builder: (_, c) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AppSkeleton(width: c.maxWidth * 0.85, height: 14),
                  const SizedBox(height: AppSpacing.sm),
                  AppSkeleton(width: c.maxWidth * 0.55, height: 12),
                  const SizedBox(height: AppSpacing.md),
                  const AppSkeleton(width: 96, height: 22, borderRadius: 0),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EstadoVazio extends StatelessWidget {
  final DateTime? mes;
  const _EstadoVazio({required this.mes});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final mesTxt = mes == null ? null : DateFormat("MMMM 'de' y", 'pt_BR').format(mes!);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xxl),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
            ),
            child: Icon(PhosphorIcons.chartBar, size: 26, color: corDestaqueVotacao(context)),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            getText('alert_list_empty_generic'),
            textAlign: TextAlign.center,
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            mesTxt == null
                ? 'Nenhuma enquete criada ainda.'
                : 'Não há enquetes em $mesTxt. Escolha outro mês acima.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }
}
