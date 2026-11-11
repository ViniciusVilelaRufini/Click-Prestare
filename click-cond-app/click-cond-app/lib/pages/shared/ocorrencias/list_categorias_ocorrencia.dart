import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Categorias de ocorrência (síndico/funcionário): nome, prioridade e SLA em
/// horas. O SLA define o prazo automático das ocorrências abertas nessa
/// categoria.
///
/// Só consulta: as categorias são definidas pela Prestare e a API recusa
/// criar, editar ou excluir pelo app (403). Por isso a tela não tem mais o
/// botão de nova categoria, o editor nem a lixeira.
class ListCategoriasOcorrencia extends StatefulWidget {
  const ListCategoriasOcorrencia({super.key});
  @override
  State<ListCategoriasOcorrencia> createState() =>
      _ListCategoriasOcorrenciaState();
}

class _ListCategoriasOcorrenciaState extends State<ListCategoriasOcorrencia> {
  List<dynamic> list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      if (list.isEmpty) setState(() => _isLoading = true);
      list = await apiGetAll("ocorrencias/categorias");
    } catch (_) {
      if (mounted) {
        displayMessage(
            context, getText('alert_error'), getText('alert_generic_error'));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Categorias de Ocorrência',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 0),
            child: Text(
              getText('categorias_definidas_prestare'),
              style: AppTypography.caption(context)
                  .copyWith(color: AppColors.textSecondary(context)),
            ),
          ),
          Expanded(child: _lista(context)),
        ],
      ),
    );
  }

  Widget _lista(BuildContext context) {
    return _isLoading
        ? ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.lg),
            itemCount: 6,
            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
            itemBuilder: (_, __) => AppSkeleton.listTile(context),
          )
        : list.isEmpty
            ? Center(
                child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(PhosphorIcons.tag,
                          size: 56, color: AppColors.textTertiary(context)),
                      const SizedBox(height: AppSpacing.md),
                      Text('Nenhuma categoria cadastrada.',
                          style: AppTypography.caption(context)),
                    ]),
              )
            : RefreshIndicator(
                onRefresh: loadList,
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  itemCount: list.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (_, i) {
                    final c = list[i];
                    final sla = c['sla_horas'];
                    return Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.zero,
                            ),
                            child: Icon(PhosphorIcons.tag,
                                color: AppColors.primary, size: 22),
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c['nome'] ?? '',
                                    style: AppTypography.bodyMedium(context)),
                                const SizedBox(height: 2),
                                Row(
                                  children: [
                                    Icon(PhosphorIcons.timer,
                                        size: 13,
                                        color:
                                            AppColors.textSecondary(context)),
                                    const SizedBox(width: 4),
                                    Text(
                                      sla == null
                                          ? 'Sem prazo (SLA)'
                                          : 'SLA: ${sla}h',
                                      style: AppTypography.caption(context)
                                          .copyWith(
                                              color: AppColors.textSecondary(
                                                  context)),
                                    ),
                                    const SizedBox(width: 10),
                                    Icon(PhosphorIcons.sortAscending,
                                        size: 13,
                                        color:
                                            AppColors.textSecondary(context)),
                                    const SizedBox(width: 4),
                                    Text('Prio ${c['prioridade'] ?? 0}',
                                        style: AppTypography.caption(context)
                                            .copyWith(
                                                color: AppColors.textSecondary(
                                                    context))),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              );
  }
}
