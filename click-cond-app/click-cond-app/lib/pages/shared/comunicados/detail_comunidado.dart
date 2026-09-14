import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/comunicados/new_Comunicado.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DetailComunicado extends StatefulWidget {
  const DetailComunicado({super.key, required this.id});
  final int id;
  @override
  _DetailComunicadoPageState createState() => _DetailComunicadoPageState();
}

class _DetailComunicadoPageState extends State<DetailComunicado> {
  bool _isLoading = false;
  dynamic obj;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      obj = await apiGetDetails('comunicados', widget.id);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = (getUserType() == 'sindico') || getUserPermission('comunicados') == 1;
    return AppScaffold(
      title: getText('lb_comunicado'),
      floatingActionButton: canEdit
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewComunicado(isEdit: true, myId: widget.id)))
                  .then((_) => load()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.pencilSimple, color: Colors.white),
            )
          : null,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : obj == null
              ? const SizedBox()
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 52, height: 52,
                        decoration: BoxDecoration(
                          color: AppColors.primary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(PhosphorIcons.megaphone, color: AppColors.primary, size: 26),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(obj['titulo'] ?? '', style: AppTypography.title(context)),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Icon(PhosphorIcons.clock, size: 14, color: AppColors.textTertiary(context)),
                          const SizedBox(width: 4),
                          Text(obj['created_at'] ?? '', style: AppTypography.tiny(context)),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(AppSpacing.lg),
                        decoration: BoxDecoration(
                          color: AppColors.surface(context),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(obj['descricao'] ?? '', style: AppTypography.body(context)),
                      ),
                    ],
                  ),
                ),
    );
  }
}
