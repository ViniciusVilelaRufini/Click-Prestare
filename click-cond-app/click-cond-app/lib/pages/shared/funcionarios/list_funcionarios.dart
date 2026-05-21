import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/funcionarios/new_funcionario_1.dart';
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

class ListFuncionarios extends StatefulWidget {
  const ListFuncionarios({Key? key}) : super(key: key);
  @override
  _ListFuncionariosPageState createState() => _ListFuncionariosPageState();
}

class _ListFuncionariosPageState extends State<ListFuncionarios> {
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
      list = await apiGetAll("funcionarios");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    return AppScaffold(
      title: getText('lb_funcionarios'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewFuncionario1(isEdit: false)))
                  .then((_) => loadList()),
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
                    Icon(PhosphorIcons.userList, size: 56, color: AppColors.textTertiary(context)),
                    const SizedBox(height: AppSpacing.md),
                    Text(getText('alert_list_empty_generic'), style: AppTypography.caption(context)),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) => _FuncionarioCard(
                      item: list[i],
                      onTap: isSindico
                          ? () => Navigator.push(context,
                                  MaterialPageRoute(builder: (_) => NewFuncionario1(isEdit: true, myId: list[i]['id'])))
                              .then((_) => loadList())
                          : null,
                    ),
                  ),
                ),
    );
  }
}

class _FuncionarioCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  const _FuncionarioCard({required this.item, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: AppColors.primary.withOpacity(0.1),
              backgroundImage: (item['photo'] != null && item['photo'].toString().isNotEmpty)
                  ? NetworkImage(item['photo']) as ImageProvider
                  : null,
              child: (item['photo'] == null || item['photo'].toString().isEmpty)
                  ? Text(
                      (item['nome'] ?? 'F').substring(0, 1).toUpperCase(),
                      style: AppTypography.bodyMedium(context).copyWith(color: AppColors.primary),
                    )
                  : null,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (item['funcao'] != null && item['funcao'].toString().isNotEmpty)
                    Text(
                      item['funcao'].toString(),
                      style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            if (onTap != null)
              Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}
