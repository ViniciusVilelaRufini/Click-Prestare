import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/financeiro/detail_inadimplente.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListInadimplentes extends StatefulWidget {
  const ListInadimplentes({Key? key}) : super(key: key);
  @override
  _ListInadimplentesPageState createState() => _ListInadimplentesPageState();
}

class _ListInadimplentesPageState extends State<ListInadimplentes> {
  List<dynamic> blocos = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      final list = await apiGetAll("financeiro/inadimplentes");
      // Resposta inesperada (ou sem blocos) virava atribuição de null numa
      // List não-nulável — TypeError caindo no catch como "erro genérico".
      blocos = (list is Map && list['blocos'] is List) ? list['blocos'] as List : [];
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_inadimplentes'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : blocos.isEmpty
              ? Center(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(PhosphorIcons.checkCircle, size: 56, color: const Color(0xFF22C55E)),
                    const SizedBox(height: AppSpacing.md),
                    Text(getText('financeiro_nenhum_inadimplente'), style: AppTypography.caption(context), textAlign: TextAlign.center),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: loadList,
                  child: ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      for (final bloco in blocos)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.md),
                          child: Container(
                            decoration: BoxDecoration(
                              color: AppColors.surface(context),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.error.withOpacity(0.15)),
                            ),
                            child: Theme(
                              data: Theme.of(context).copyWith(
                                dividerColor: Colors.transparent,
                                hoverColor: Colors.transparent,
                                splashColor: Colors.transparent,
                              ),
                              child: ExpansionTile(
                                tilePadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
                                iconColor: AppColors.error,
                                collapsedIconColor: AppColors.textSecondary(context),
                                title: Row(
                                  children: [
                                    Container(
                                      width: 40, height: 40,
                                      decoration: BoxDecoration(
                                        color: AppColors.error.withOpacity(0.08), 
                                        borderRadius: BorderRadius.circular(10)
                                      ),
                                      child: Icon(PhosphorIcons.buildings, color: AppColors.error, size: 20),
                                    ),
                                    const SizedBox(width: AppSpacing.md),
                                    Expanded(
                                      child: Text(
                                        '${getText('lb_bloco')} ${bloco['bloco']}', 
                                        style: AppTypography.bodyMedium(context).copyWith(
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: AppColors.error, 
                                        borderRadius: BorderRadius.circular(12)
                                      ),
                                      child: Text(
                                        '${bloco['aptos'].length}', 
                                        style: AppTypography.tiny(context).copyWith(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                children: [
                                  for (final apto in bloco['aptos'])
                                    Column(
                                      children: [
                                        const Divider(height: 1, color: Colors.white10, indent: AppSpacing.md, endIndent: AppSpacing.md),
                                        InkWell(
                                          onTap: () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => DetailInadimplente(apto: apto['apto'].toString(), bloco: apto['bloco'].toString()),
                                            ),
                                          ).then((_) => loadList()),
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 12),
                                            child: Row(
                                              children: [
                                                Container(
                                                  padding: const EdgeInsets.all(8),
                                                  decoration: BoxDecoration(
                                                    color: AppColors.textSecondary(context).withOpacity(0.05),
                                                    borderRadius: BorderRadius.circular(8),
                                                  ),
                                                  child: Icon(PhosphorIcons.door, size: 18, color: AppColors.textSecondary(context)),
                                                ),
                                                const SizedBox(width: AppSpacing.md),
                                                Expanded(
                                                  child: Text(
                                                    'Apto ${apto['apto']}',
                                                    style: AppTypography.bodyMedium(context).copyWith(
                                                      fontWeight: FontWeight.bold,
                                                    ),
                                                    overflow: TextOverflow.ellipsis,
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Flexible(
                                                  child: Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                                    decoration: BoxDecoration(
                                                      color: AppColors.error.withOpacity(0.08),
                                                      borderRadius: BorderRadius.circular(12),
                                                      border: Border.all(color: AppColors.error.withOpacity(0.25)),
                                                    ),
                                                    child: FittedBox(
                                                      fit: BoxFit.scaleDown,
                                                      // `qtd` conta COBRANÇAS,
                                                      // não meses: taxa +
                                                      // rateio no mesmo mês
                                                      // saía como "2 meses em
                                                      // aberto".
                                                      child: Text(
                                                        '${apto['qtd']} ${apto['qtd'] == 1 ? 'cobrança em aberto' : 'cobranças em aberto'}',
                                                        style: AppTypography.tiny(context).copyWith(
                                                          color: AppColors.error,
                                                          fontWeight: FontWeight.bold,
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }
}
