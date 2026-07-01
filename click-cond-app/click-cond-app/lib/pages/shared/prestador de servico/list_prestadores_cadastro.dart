import 'dart:convert';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/prestador%20de%20servico/new_prestador.dart';
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

class ListPrestadoresCadastro extends StatefulWidget {
  const ListPrestadoresCadastro({Key? key}) : super(key: key);

  @override
  _ListPrestadoresCadastroState createState() => _ListPrestadoresCadastroState();
}

class _ListPrestadoresCadastroState extends State<ListPrestadoresCadastro> {
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
      list = await apiGetAll("prestadores");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = getUserType() == 'sindico';
    return AppScaffold(
      title: getText('lb_funcionarios_condominio'),
      floatingActionButton: canEdit
          ? FloatingActionButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NewPrestador(isEdit: false)),
              ).then((_) => loadList()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 8,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : list.isEmpty
              ? Center(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(PhosphorIcons.users, size: 56, color: AppColors.textTertiary(context)),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      getText('alert_list_empty_generic'),
                      style: AppTypography.caption(context),
                    ),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) => _PrestadorCadastroCard(
                      item: list[i],
                      onTap: canEdit
                          ? () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) =>
                                      NewPrestador(isEdit: true, myId: list[i]['id']),
                                ),
                              ).then((_) => loadList())
                          : null,
                    ),
                  ),
                ),
    );
  }
}

class _PrestadorCadastroCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  const _PrestadorCadastroCard({required this.item, this.onTap});

  @override
  Widget build(BuildContext context) {
    final syncStatus = item['face_sync_status']?.toString() ?? '';
    final hasFace = item['face_id'] != null && item['face_id'].toString().isNotEmpty;
    final cats = (item['categorias'] ?? '').toString();
    final categorias =
        cats.isNotEmpty ? cats.split(',').map((c) => c.trim()).where((c) => c.isNotEmpty).toList() : <String>[];
    final apto = item['apartamento'] as Map<String, dynamic>?;
    final bloco = apto?['bloco']?.toString() ?? '';
    final aptoNum = apto?['apto']?.toString() ?? '';
    final unidade = (bloco.isNotEmpty || aptoNum.isNotEmpty)
        ? [if (bloco.isNotEmpty) bloco, if (aptoNum.isNotEmpty) aptoNum].join(' - ')
        : null;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            _buildAvatar(context, item),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item['nome'] ?? '',
                          style: AppTypography.bodyMedium(context),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (hasFace) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: syncStatus == 'synced'
                                ? AppColors.success.withOpacity(0.12)
                                : AppColors.primary.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                PhosphorIcons.smiley,
                                size: 10,
                                color: syncStatus == 'synced'
                                    ? AppColors.success
                                    : AppColors.primary,
                              ),
                              const SizedBox(width: 3),
                              Text(
                                syncStatus == 'synced' ? 'FACIAL' : 'SYNC',
                                style: AppTypography.tiny(context).copyWith(
                                  color: syncStatus == 'synced'
                                      ? AppColors.success
                                      : AppColors.primary,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (unidade != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        unidade,
                        style: AppTypography.caption(context)
                            .copyWith(color: AppColors.textSecondary(context)),
                      ),
                    ),
                  if (categorias.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: categorias.take(3).map((c) => Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                c,
                                style: AppTypography.tiny(context)
                                    .copyWith(color: AppColors.primary),
                              ),
                            )).toList(),
                      ),
                    ),
                ],
              ),
            ),
            if (onTap != null) ...[
              const SizedBox(width: 4),
              Icon(PhosphorIcons.caretRight,
                  size: 16, color: AppColors.textTertiary(context)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildAvatar(BuildContext context, dynamic item) {
    final nome = (item['nome'] ?? 'F').toString();
    final fotoUrl = item['foto_pessoa']?.toString().trim() ?? '';

    ImageProvider? provider;
    if (fotoUrl.isNotEmpty && fotoUrl != 'null') {
      if (fotoUrl.startsWith('http://') || fotoUrl.startsWith('https://')) {
        provider = NetworkImage(fotoUrl);
      } else if (fotoUrl.startsWith('data:')) {
        final idx = fotoUrl.indexOf(',');
        if (idx > 0) {
          try {
            provider = MemoryImage(base64Decode(fotoUrl.substring(idx + 1)));
          } catch (_) {}
        }
      } else {
        try {
          provider = MemoryImage(base64Decode(fotoUrl));
        } catch (_) {}
      }
    }

    return CircleAvatar(
      radius: 22,
      backgroundColor: AppColors.primary.withOpacity(0.1),
      backgroundImage: provider,
      child: provider == null
          ? Text(
              nome.substring(0, 1).toUpperCase(),
              style:
                  AppTypography.bodyMedium(context).copyWith(color: AppColors.primary),
            )
          : null,
    );
  }
}
