import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/mudancas/new_mudanca.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListMudancas extends StatefulWidget {
  const ListMudancas({Key? key}) : super(key: key);
  @override
  _ListMudancasPageState createState() => _ListMudancasPageState();
}

class _ListMudancasPageState extends State<ListMudancas> {
  List<dynamic> list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAll("mudancas");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> updateStatus(idItem, status, motivo) async {
    try {
      setState(() => _isLoading = true);
      final res = await apiUpdateStatus("mudancas", idItem, status, motivo);
      if (res.toString().isEmpty) {
        loadList();
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = (getUserType() != 'funcionario') || getUserPermission('agendar_mudanca') == 1;
    return AppScaffold(
      title: getText('mudanca_nav'),
      floatingActionButton: canAdd
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewMudanca(isEdit: false)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
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
                    Icon(PhosphorIcons.truck, size: 56, color: AppColors.textTertiary(context)),
                    const SizedBox(height: AppSpacing.md),
                    Text(getText('alert_list_empty_generic'), style: AppTypography.caption(context), maxLines: 2),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) {
                      final item = list[i];
                      final canEdit = canAdd && item['status'] == 'pendente';
                      return _MudancaCard(
                        item: item,
                        onTap: canAdd
                            ? () {
                                if (item['status'] != 'pendente') {
                                  displayMessage(context, getText('alert'), getText('mudanca_pendente_aprovacao'));
                                  return;
                                }
                                Navigator.push(context,
                                        MaterialPageRoute(builder: (_) => NewMudanca(isEdit: true, myId: item['id'])))
                                    .then((_) => loadList());
                              }
                            : null,
                        onStatusChange: (id, status, motivo) => updateStatus(id, status, motivo),
                      );
                    },
                  ),
                ),
    );
  }
}

class _MudancaCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  final Function(dynamic, dynamic, dynamic) onStatusChange;
  const _MudancaCard({required this.item, this.onTap, required this.onStatusChange});

  Color _statusColor(String? s) {
    switch (s?.toLowerCase()) {
      case 'aprovada':
      case 'aceito': return const Color(0xFF22C55E);
      case 'rejeitada':
      case 'recusado': return const Color(0xFFEF4444);
      default: return const Color(0xFFF59E0B);
    }
  }

  Future<void> _recusar(BuildContext context) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface(ctx),
        title: Text('Recusar mudança', style: AppTypography.bodyMedium(ctx).copyWith(fontWeight: FontWeight.bold)),
        content: TextField(
          controller: ctrl,
          maxLines: 3,
          style: AppTypography.body(ctx),
          decoration: InputDecoration(
            hintText: 'Motivo da recusa (opcional)',
            hintStyle: AppTypography.caption(ctx),
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFEF4444), foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Recusar'),
          ),
        ],
      ),
    );
    if (ok == true) onStatusChange(item['id'], false, ctrl.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final status = item['status']?.toString() ?? 'pendente';
    // Síndico/funcionário podem aprovar/recusar mudanças pendentes.
    final isManager = getUserType() != 'morador';
    final canDecide = isManager && status.toLowerCase() == 'pendente';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(color: _statusColor(status).withOpacity(0.12), borderRadius: BorderRadius.circular(12)),
                  child: Icon(PhosphorIcons.truck, color: _statusColor(status), size: 22),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Apto ${item['apto'] ?? ''} - Bloco ${item['bloco'] ?? ''}', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                      if (item['data'] != null)
                        Text('${item['data']}${item['hora_inicio'] != null ? ' às ${item['hora_inicio']}' : ''}',
                            style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
                      Text(status.toUpperCase(), style: AppTypography.tiny(context).copyWith(color: _statusColor(status))),
                    ],
                  ),
                ),
                if (onTap != null && !canDecide)
                  Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
              ],
            ),
            if (canDecide) ...[
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _recusar(context),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFFEF4444),
                        side: const BorderSide(color: Color(0x33EF4444)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      icon: const Icon(PhosphorIcons.x, size: 16),
                      label: const Text('Recusar'),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => onStatusChange(item['id'], true, ''),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      icon: const Icon(PhosphorIcons.check, size: 16),
                      label: const Text('Aceitar'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
