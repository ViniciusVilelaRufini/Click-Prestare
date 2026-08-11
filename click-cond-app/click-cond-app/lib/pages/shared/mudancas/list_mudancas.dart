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
      if (list.isEmpty) setState(() => _isLoading = true);
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
      case 'aceito':
        return const Color(0xFF10B981); // Emerald
      case 'rejeitada':
      case 'recusado':
        return const Color(0xFFEF4444); // Red
      default:
        return const Color(0xFFF59E0B); // Amber
    }
  }

  IconData _statusIcon(String? s) {
    switch (s?.toLowerCase()) {
      case 'aprovada':
      case 'aceito':
        return PhosphorIcons.checkCircle;
      case 'rejeitada':
      case 'recusado':
        return PhosphorIcons.xCircle;
      default:
        return PhosphorIcons.clock;
    }
  }

  String _statusLabel(String? s) {
    switch (s?.toLowerCase()) {
      case 'aprovada':
      case 'aceito':
        return 'ACEITO';
      case 'rejeitada':
      case 'recusado':
        return 'RECUSADO';
      default:
        return 'PENDENTE';
    }
  }

  Future<void> _recusar(BuildContext context) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface(ctx),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('Recusar Mudança',
            style: AppTypography.bodyMedium(ctx).copyWith(fontWeight: FontWeight.bold)),
        content: TextField(
          controller: ctrl,
          maxLines: 3,
          style: AppTypography.body(ctx),
          decoration: InputDecoration(
            hintText: 'Motivo da recusa (opcional)',
            hintStyle: AppTypography.caption(ctx),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text('Cancelar', style: TextStyle(color: AppColors.textSecondary(ctx)))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
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
    final rawStatus = item['status']?.toString() ?? 'pendente';
    final color = _statusColor(rawStatus);
    final icon = _statusIcon(rawStatus);
    final label = _statusLabel(rawStatus);

    final String apto = item['apto']?.toString() ?? '';
    final String blocoRaw = item['bloco']?.toString() ?? '';
    String blocoText = '';
    if (blocoRaw.isNotEmpty) {
      final bLower = blocoRaw.toLowerCase();
      if (bLower.contains('bloco') || bLower.contains('bloque') || bLower.contains('block')) {
        blocoText = blocoRaw;
      } else {
        blocoText = 'Bloco $blocoRaw';
      }
    }
    final String aptoBloco = apto.isNotEmpty
        ? 'Apto $apto ${blocoText.isNotEmpty ? "- $blocoText" : ""}'
        : (blocoText.isNotEmpty ? blocoText : 'Mudança');

    final data = item['data']?.toString() ?? '';
    final hora = item['hora_inicio']?.toString() ?? '';

    // Síndico/funcionário podem aprovar/recusar mudanças pendentes.
    final isManager = getUserType() != 'morador';
    final canDecide = isManager && rawStatus.toLowerCase() == 'pendente';

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Borda lateral com cor do status
              Container(
                width: 4,
                color: color,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Top Row: Ícone de Caminhão + Unidade e Badge de Status
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: color.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(PhosphorIcons.truck, color: color, size: 20),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: GestureDetector(
                              onTap: onTap,
                              child: Text(
                                aptoBloco,
                                style: TextStyle(
                                  color: AppColors.textPrimary(context),
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Status Pill Badge
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            decoration: BoxDecoration(
                              color: color.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: color.withOpacity(0.3)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(icon, size: 12, color: color),
                                const SizedBox(width: 4),
                                Text(
                                  label,
                                  style: TextStyle(
                                    color: color,
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      // Data e Hora Box
                      if (data.isNotEmpty || hora.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppColors.bg(context),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            children: [
                              if (data.isNotEmpty) ...[
                                Icon(PhosphorIcons.calendarBlank, size: 15, color: AppColors.primary),
                                const SizedBox(width: 6),
                                Text(
                                  data,
                                  style: TextStyle(
                                    color: AppColors.textPrimary(context),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                              if (data.isNotEmpty && hora.isNotEmpty)
                                const SizedBox(width: 14),
                              if (hora.isNotEmpty) ...[
                                Icon(PhosphorIcons.clock, size: 15, color: AppColors.primary),
                                const SizedBox(width: 6),
                                Text(
                                  'às $hora',
                                  style: TextStyle(
                                    color: AppColors.textPrimary(context),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      // Action buttons se o usuário puder aceitar/recusar
                      if (canDecide) ...[
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () => _recusar(context),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: const Color(0xFFEF4444),
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                  side: const BorderSide(color: Color(0x44EF4444)),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                ),
                                icon: const Icon(PhosphorIcons.x, size: 16),
                                label: const Text('Recusar', style: TextStyle(fontWeight: FontWeight.bold)),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed: () => onStatusChange(item['id'], true, ''),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF10B981),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                ),
                                icon: const Icon(PhosphorIcons.check, size: 16),
                                label: const Text('Aceitar', style: TextStyle(fontWeight: FontWeight.bold)),
                              ),
                            ),
                          ],
                        ),
                      ] else if (onTap != null) ...[
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            Text(
                              'Ver detalhes',
                              style: TextStyle(
                                color: AppColors.textTertiary(context),
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(PhosphorIcons.caretRight, size: 14, color: AppColors.textTertiary(context)),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
