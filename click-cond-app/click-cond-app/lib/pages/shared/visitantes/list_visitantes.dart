import 'dart:async';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/visitantes/new_visitante.dart';
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

class ListVisitantes extends StatefulWidget {
  final bool allCondos;
  const ListVisitantes({Key? key, this.allCondos = false}) : super(key: key);
  @override
  _ListVisitantesPageState createState() => _ListVisitantesPageState();
}

class _ListVisitantesPageState extends State<ListVisitantes> {
  final txtSearch = TextEditingController();
  Timer? _timerSearch;
  List<dynamic> list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  @override
  void dispose() {
    txtSearch.dispose();
    _timerSearch?.cancel();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAllVisitantes(txtSearch.text, allCondos: widget.allCondos);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = (getUserType() != 'funcionario') || getUserPermission('cadastrar_visitante') == 1;

    // Filtrar quem está no condomínio atualmente OU possui liberação ativa para hoje
    final now = DateTime.now();
    final listInside = list.where((e) {
      // 1. Está no local fisicamente
      final isInside = e['data_entrada'] != null && e['data_saida'] == null;
      if (isInside) return true;

      // 2. Liberação ativa agendada (período atual e sem registro de saída)
      final startStr = e['data_hora_inicio'];
      final endStr = e['data_hora_termino'];
      if (startStr != null && endStr != null && e['data_saida'] == null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          return now.isAfter(start) && now.isBefore(end);
        }
      }
      return false;
    }).toList();

    // Filtrar visitantes cadastrados únicos para histórico e liberação rápida
    final Map<String, Map<String, dynamic>> uniqueVisitors = {};
    for (var item in list) {
      final String key = (item['doc_identificacao'] != null && item['doc_identificacao'].toString().trim().isNotEmpty)
          ? item['doc_identificacao'].toString().trim()
          : item['nome'].toString().trim();
      
      if (key.isNotEmpty && !uniqueVisitors.containsKey(key)) {
        uniqueVisitors[key] = Map<String, dynamic>.from(item);
      }
    }
    final listCadastrados = uniqueVisitors.values.toList();

    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: getText('visitantes_list'),
        floatingActionButton: canAdd
            ? FloatingActionButton(
                onPressed: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => NewVisitante(isEdit: false)))
                    .then((_) => loadList()),
                backgroundColor: AppColors.primary,
                child: const Icon(PhosphorIcons.plus, color: Colors.white),
              )
            : null,
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
              child: TextField(
                controller: txtSearch,
                onChanged: (v) {
                  _timerSearch?.cancel();
                  _timerSearch = Timer(const Duration(milliseconds: 600), loadList);
                },
                style: AppTypography.body(context),
                cursorColor: AppColors.primary,
                decoration: InputDecoration(
                  hintText: getText('lb_buscar'),
                  hintStyle: AppTypography.body(context).copyWith(color: AppColors.textTertiary(context)),
                  prefixIcon: Icon(PhosphorIcons.magnifyingGlass, size: 20, color: AppColors.textSecondary(context)),
                  filled: true,
                  fillColor: AppColors.surface(context),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
              child: Container(
                height: 48,
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: AppColors.surface(context),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: TabBar(
                  dividerColor: Colors.transparent,
                  unselectedLabelColor: AppColors.textSecondary(context),
                  labelColor: Colors.white,
                  labelStyle: AppTypography.caption(context).copyWith(fontWeight: FontWeight.bold),
                  unselectedLabelStyle: AppTypography.caption(context),
                  indicatorSize: TabBarIndicatorSize.tab,
                  indicator: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  tabs: [
                    Tab(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(PhosphorIcons.houseLine, size: 16),
                          const SizedBox(width: 6),
                          Text('No Local / Ativos (${listInside.length})'),
                        ],
                      ),
                    ),
                    Tab(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(PhosphorIcons.identificationCard, size: 16),
                          const SizedBox(width: 6),
                          Text('Cadastrados (${listCadastrados.length})'),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: _isLoading
                  ? ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: 8,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, __) => AppSkeleton.listTile(context),
                    )
                  : TabBarView(
                      children: [
                        // ABA 1: No Condomínio
                        RefreshIndicator(
                          onRefresh: loadList,
                          child: listInside.isEmpty
                              ? _EmptyState('Nenhum visitante no local no momento.', PhosphorIcons.houseLine)
                              : ListView.separated(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  itemCount: listInside.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                                  itemBuilder: (_, i) => _VisitanteCard(
                                    item: listInside[i],
                                    onTap: canAdd
                                        ? () => Navigator.push(context,
                                                MaterialPageRoute(builder: (_) => NewVisitante(isEdit: true, myId: listInside[i]['id'])))
                                            .then((_) => loadList())
                                        : null,
                                  ),
                                ),
                        ),
                        // ABA 2: Cadastrados (Histórico / Liberar Novamente)
                        RefreshIndicator(
                          onRefresh: loadList,
                          child: listCadastrados.isEmpty
                              ? _EmptyState('Nenhum visitante cadastrado.', PhosphorIcons.identificationCard)
                              : ListView.separated(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  itemCount: listCadastrados.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                                  itemBuilder: (_, i) => _VisitanteCard(
                                    item: listCadastrados[i],
                                    onTap: canAdd
                                        ? () => Navigator.push(context,
                                                MaterialPageRoute(builder: (_) => NewVisitante(isEdit: true, myId: listCadastrados[i]['id'])))
                                            .then((_) => loadList())
                                        : null,
                                    onQuickRelease: canAdd
                                        ? () => Navigator.push(
                                              context,
                                              MaterialPageRoute(
                                                builder: (_) => NewVisitante(
                                                  isEdit: false,
                                                  reUseData: listCadastrados[i],
                                                ),
                                              ),
                                            ).then((_) => loadList())
                                        : null,
                                  ),
                                ),
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VisitanteCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  final VoidCallback? onQuickRelease;
  const _VisitanteCard({required this.item, this.onTap, this.onQuickRelease});

  @override
  Widget build(BuildContext context) {
    final isInside = item['data_entrada'] != null && item['data_saida'] == null;
    
    // Verificar se é agendado (está ativo no período, mas não entrou ainda)
    bool isAuthorized = false;
    if (!isInside && item['data_saida'] == null) {
      final startStr = item['data_hora_inicio'];
      final endStr = item['data_hora_termino'];
      if (startStr != null && endStr != null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          isAuthorized = DateTime.now().isAfter(start) && DateTime.now().isBefore(end);
        }
      }
    }
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            Stack(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.primary.withOpacity(0.1),
                  child: Text(
                    (item['nome'] ?? 'V').substring(0, 1).toUpperCase(),
                    style: AppTypography.bodyMedium(context).copyWith(color: AppColors.primary),
                  ),
                ),
                if (isInside)
                  Positioned(
                    right: 0, bottom: 0,
                    child: Container(
                      width: 12, height: 12,
                      decoration: BoxDecoration(
                        color: AppColors.success,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.surface(context), width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item['condominio_nome'] != null && item['condominio_nome'].toString().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2.0),
                      child: Text(
                        item['condominio_nome'].toString().toUpperCase(),
                        style: AppTypography.tiny(context).copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  Row(
                    children: [
                      Expanded(child: Text(item['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis)),
                      if (item['apto'] != null)
                        Text(
                          '${(item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim().isNotEmpty && (item['apto_bloco'] ?? item['bloco'] ?? '').toString() != 'null' ? (item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim() + ' - ' : ''}${item['apto']}',
                          style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
                        ),
                      if (isInside) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.success.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                          child: Text('NO LOCAL', style: AppTypography.tiny(context).copyWith(color: AppColors.success, fontWeight: FontWeight.bold)),
                        ),
                      ] else if (isAuthorized) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                          child: Text('AUTORIZADO', style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ],
                  ),
                  if (item['codigo_acesso'] != null && item['data_saida'] == null) ...[
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(PhosphorIcons.key, size: 12, color: AppColors.primary),
                        const SizedBox(width: 4),
                        Text(
                          'PIN: ${item['codigo_acesso'].toString().length == 6 ? "${item['codigo_acesso'].toString().substring(0, 3)}-${item['codigo_acesso'].toString().substring(3, 6)}" : item['codigo_acesso']}',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ],
                  Row(
                    children: [
                      if (item['data_hora'] != null)
                        Text(item['data_hora'], style: AppTypography.caption(context)),
                      if (item['hora_entrada'] != null) ...[
                        Text(' • ', style: AppTypography.caption(context)),
                        Icon(PhosphorIcons.signIn, size: 12, color: AppColors.textTertiary(context)),
                        const SizedBox(width: 2),
                        Text(item['hora_entrada'], style: AppTypography.caption(context)),
                      ],
                      if (item['hora_saida'] != null) ...[
                        Text(' • ', style: AppTypography.caption(context)),
                        Icon(PhosphorIcons.signOut, size: 12, color: AppColors.textTertiary(context)),
                        const SizedBox(width: 2),
                        Text(item['hora_saida'], style: AppTypography.caption(context)),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            if (onQuickRelease != null) ...[
              const SizedBox(width: AppSpacing.sm),
              Material(
                color: Colors.transparent,
                child: IconButton(
                  icon: const Icon(PhosphorIcons.paperPlaneTilt, size: 20),
                  color: AppColors.primary,
                  onPressed: onQuickRelease,
                  splashRadius: 20,
                  tooltip: 'Liberar Novamente',
                ),
              ),
            ] else if (onTap != null)
              Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String message;
  final IconData icon;
  const _EmptyState(this.message, this.icon);
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 56, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text(message, style: AppTypography.caption(context), textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
