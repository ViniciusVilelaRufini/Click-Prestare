import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/assembleias/new_assembleia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListAssembleias extends StatefulWidget {
  const ListAssembleias({super.key});
  @override
  _ListAssembleiasPageState createState() => _ListAssembleiasPageState();
}

class _ListAssembleiasPageState extends State<ListAssembleias> {
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
      list = await apiGetAll("assembleias");
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _abrir(dynamic item) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => DetailAssembleia(id: item['id'])))
        .then((_) => loadList());
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    // Folga para o FAB do síndico não cobrir o último card.
    final folgaFinal = isSindico ? 88.0 : AppSpacing.xl;
    final padding = EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, folgaFinal);

    return AppScaffold(
      title: getText('lb_assembleias'),
      floatingActionButton: isSindico
          ? FloatingActionButton(
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewAssembleia(isEdit: false)))
                  .then((_) => loadList()),
              backgroundColor: AppColors.primary,
              tooltip: 'Nova assembleia',
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              physics: const NeverScrollableScrollPhysics(),
              itemCount: 5,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => const _CardSkeleton(),
            )
          : RefreshIndicator(
              onRefresh: loadList,
              child: list.isEmpty
                  ? ListView(
                      // Rolável para o "puxar para atualizar" funcionar no vazio.
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: padding,
                      children: [_EstadoVazio(isSindico: isSindico)],
                    )
                  : ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: padding,
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                      itemBuilder: (_, i) => AssembleiaCard(
                        item: list[i],
                        onTap: () => _abrir(list[i]),
                      ),
                    ),
            ),
    );
  }
}

/// Card de uma assembleia na lista: bloco com dia/mês, título, descrição,
/// data e hora e um selo de "Hoje/Amanhã/Em N dias" para as próximas. Mostra
/// só o que a lista da API devolve (`titulo`, `descricao`, `data`, `hora`) —
/// local e votações ficam no detalhe.
class AssembleiaCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;

  /// "Agora" para o selo de proximidade (testes).
  final DateTime? agora;

  const AssembleiaCard({super.key, required this.item, this.onTap, this.agora});

  static String _txt(dynamic v) {
    final s = (v ?? '').toString().trim();
    return s == 'null' ? '' : s;
  }

  @override
  Widget build(BuildContext context) {
    final m = item is Map ? item as Map : const {};
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final titulo = _txt(m['titulo']);
    final descricao = _txt(m['descricao']);
    final data = dataAssembleia(m['data']);
    final quando = quandoAssembleia(m['data'], agora: agora);
    final passou = assembleiaPassou(m['data'], agora: agora);
    final dataHora = dataHoraAssembleia(m['data'], m['hora']);

    final destaque = corDestaqueVotacao(context);
    final corBloco = passou ? AppColors.textTertiary(context) : destaque;
    final corQuando = quando == 'Hoje'
        ? statusVotacaoInfo(1).corTexto(context)
        : statusVotacaoInfo(0).corTexto(context);
    final secundario = AppTypography.caption(context).copyWith(fontSize: 13);

    final semantica = [
      titulo,
      if (descricao.isNotEmpty) descricao,
      if (dataHora.isNotEmpty) dataHora,
      if (quando.isNotEmpty) quando,
    ].join(', ');

    return Semantics(
      container: true,
      button: onTap != null,
      label: semantica,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surfaceElevated(context),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.rlg,
          side: BorderSide(color: AppColors.border(context)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Bloco de data (dia + mês); sem data válida, o ícone.
                  Container(
                    width: 48,
                    height: 52,
                    decoration: BoxDecoration(
                      color: corBloco.withValues(alpha: isDark ? 0.18 : 0.08),
                      borderRadius: AppRadius.rmd,
                      border: Border.all(color: corBloco.withValues(alpha: isDark ? 0.35 : 0.2)),
                    ),
                    alignment: Alignment.center,
                    child: data == null
                        ? Icon(PhosphorIcons.usersThree, size: 22, color: corBloco)
                        : Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                '${data.day}',
                                style: AppTypography.title(context).copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: corBloco,
                                  height: 1.1,
                                ),
                              ),
                              Text(
                                mesCurtoAssembleia(data),
                                style: AppTypography.tiny(context).copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: corBloco,
                                  letterSpacing: 0.6,
                                  height: 1.2,
                                ),
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          titulo,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600, height: 1.35),
                        ),
                        if (descricao.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(descricao, maxLines: 2, overflow: TextOverflow.ellipsis, style: secundario),
                        ],
                        if (dataHora.isNotEmpty || quando.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.sm),
                          Wrap(
                            spacing: AppSpacing.md,
                            runSpacing: AppSpacing.xs,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              if (dataHora.isNotEmpty)
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(PhosphorIcons.clock, size: 15, color: AppColors.textTertiary(context)),
                                    const SizedBox(width: AppSpacing.xs),
                                    Flexible(
                                      child: Text(dataHora,
                                          maxLines: 1, overflow: TextOverflow.ellipsis, style: secundario),
                                    ),
                                  ],
                                ),
                              if (quando.isNotEmpty)
                                Text(
                                  quando,
                                  style: secundario.copyWith(color: corQuando, fontWeight: FontWeight.w700),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (onTap != null) ...[
                    const SizedBox(width: AppSpacing.sm),
                    Padding(
                      padding: const EdgeInsets.only(top: 14),
                      child: Icon(PhosphorIcons.caretRight, size: 18, color: AppColors.textTertiary(context)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Mesmo contorno do [AssembleiaCard] para a troca skeleton → lista não pular.
class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AppSkeleton(width: 48, height: 52, borderRadius: AppRadius.md),
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
                  AppSkeleton(width: c.maxWidth * 0.45, height: 12),
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
  final bool isSindico;
  const _EstadoVazio({required this.isSindico});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
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
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.usersThree, size: 26, color: corDestaqueVotacao(context)),
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
            isSindico
                ? 'Nenhuma assembleia marcada. Toque em + para criar uma.'
                : 'Nenhuma assembleia marcada no momento.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }
}
