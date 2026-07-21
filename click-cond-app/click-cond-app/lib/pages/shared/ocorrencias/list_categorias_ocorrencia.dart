import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Gestão de categorias de ocorrência (síndico): nome, prioridade e SLA em horas.
/// O SLA define o prazo automático das ocorrências abertas nessa categoria.
class ListCategoriasOcorrencia extends StatefulWidget {
  const ListCategoriasOcorrencia({Key? key}) : super(key: key);
  @override
  State<ListCategoriasOcorrencia> createState() => _ListCategoriasOcorrenciaState();
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
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openEditor({dynamic categoria}) async {
    final isEdit = categoria != null;
    final nomeCtrl = TextEditingController(text: categoria?['nome']?.toString() ?? '');
    final prioridadeCtrl = TextEditingController(text: (categoria?['prioridade'] ?? 0).toString());
    final slaCtrl = TextEditingController(
      text: (categoria?['sla_horas'] == null) ? '' : categoria!['sla_horas'].toString(),
    );

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: AppSpacing.lg,
          right: AppSpacing.lg,
          top: AppSpacing.lg,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(isEdit ? 'Editar categoria' : 'Nova categoria',
                style: AppTypography.bodyMedium(ctx).copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: AppSpacing.lg),
            AppInput(label: 'Nome', controller: nomeCtrl, prefixIcon: PhosphorIcons.tag),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: 'Prioridade (0 = mais alta)',
              controller: prioridadeCtrl,
              prefixIcon: PhosphorIcons.sortAscending,
              keyboard: TextInputType.number,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: 'SLA em horas (vazio = sem prazo)',
              controller: slaCtrl,
              prefixIcon: PhosphorIcons.timer,
              keyboard: TextInputType.number,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Ex.: 24 = ocorrências dessa categoria vencem em 24h.',
              style: AppTypography.caption(ctx).copyWith(color: AppColors.textSecondary(ctx)),
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: getText('btn_save'),
              icon: PhosphorIcons.floppyDisk,
              onPressed: () async {
                if (nomeCtrl.text.trim().isEmpty) {
                  displayMessage(ctx, getText('alert_ops'), 'Informe o nome da categoria.');
                  return;
                }
                final payload = {
                  if (isEdit) 'id': categoria['id'],
                  'nome': nomeCtrl.text.trim(),
                  'prioridade': int.tryParse(prioridadeCtrl.text.trim()) ?? 0,
                  'sla_horas': slaCtrl.text.trim().isEmpty ? null : int.tryParse(slaCtrl.text.trim()),
                };
                final res = await apiSaveObject('ocorrencias/categorias', 'categoria', payload, isEdit);
                if (res == "") {
                  if (ctx.mounted) Navigator.pop(ctx, true);
                } else {
                  if (ctx.mounted) displayMessage(ctx, getText('alert_error'), res.toString());
                }
              },
            ),
          ],
        ),
      ),
    );
    if (saved == true) loadList();
  }

  Future<void> _remove(dynamic categoria) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface(ctx),
        title: Text('Remover categoria', style: AppTypography.bodyMedium(ctx).copyWith(fontWeight: FontWeight.bold)),
        content: Text('Remover "${categoria['nome']}"? Ocorrências existentes não são apagadas.',
            style: AppTypography.body(ctx)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );
    if (ok == true) {
      final res = await apiDeleteObject('ocorrencias/categorias', categoria['id']);
      if (res == true) {
        loadList();
      } else if (mounted) {
        displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Categorias de Ocorrência',
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openEditor(),
        backgroundColor: AppColors.primary,
        child: const Icon(PhosphorIcons.plus, color: Colors.white),
      ),
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : list.isEmpty
              ? Center(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(PhosphorIcons.tag, size: 56, color: AppColors.textTertiary(context)),
                    const SizedBox(height: AppSpacing.md),
                    Text('Nenhuma categoria cadastrada.', style: AppTypography.caption(context)),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) {
                      final c = list[i];
                      final sla = c['sla_horas'];
                      return GestureDetector(
                        onTap: () => _openEditor(categoria: c),
                        child: Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.surface(context),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 44, height: 44,
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(PhosphorIcons.tag, color: AppColors.primary, size: 22),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(c['nome'] ?? '', style: AppTypography.bodyMedium(context)),
                                    const SizedBox(height: 2),
                                    Row(
                                      children: [
                                        Icon(PhosphorIcons.timer, size: 13, color: AppColors.textSecondary(context)),
                                        const SizedBox(width: 4),
                                        Text(
                                          sla == null ? 'Sem prazo (SLA)' : 'SLA: ${sla}h',
                                          style: AppTypography.caption(context)
                                              .copyWith(color: AppColors.textSecondary(context)),
                                        ),
                                        const SizedBox(width: 10),
                                        Icon(PhosphorIcons.sortAscending, size: 13, color: AppColors.textSecondary(context)),
                                        const SizedBox(width: 4),
                                        Text('Prio ${c['prioridade'] ?? 0}',
                                            style: AppTypography.caption(context)
                                                .copyWith(color: AppColors.textSecondary(context))),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                onPressed: () => _remove(c),
                                icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.error),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
