import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/settings/notification_settings.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/financeiro/list_financeiro.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/financeiro/list_inadimplentes.dart';
import 'package:click/pages/shared/funcionarios/edit_funcionario.dart';
import 'package:click/pages/shared/morador/assinatura_morador.dart';
import 'package:click/pages/shared/morador/edit_morador.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/sindico/assinatura_sindico.dart';
import 'package:click/pages/sindico/edit_sindico.dart';
import 'package:click/pages/sindico/signup/signup_%20condominium_1.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListCondomiums extends StatefulWidget {
  const ListCondomiums({Key? key}) : super(key: key);

  @override
  _ListCondomiumsState createState() => _ListCondomiumsState();
}

class _ListCondomiumsState extends State<ListCondomiums> {
  List<dynamic> _list = [];
  Map<String, dynamic>? _summary;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  Future<void> _loadList() async {
    if (!mounted) return;
    final token = getToken();
    if (token.isEmpty) {
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
      return;
    }
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final type = getUserType();
      final detailsRoute = type == 'sindico' 
          ? 'sindico' 
          : (type == 'morador' ? 'moradores' : 'funcionarios');
      
      final results = await Future.wait<dynamic>([
        type == "sindico"
            ? getCondominios()
            : type == "morador"
                ? getCondominiosMorador()
                : getCondominiosFuncionario(),
        getDashboardSummary(),
        apiGetDetails(detailsRoute, 0),
      ]);

      if (!mounted) return;
      if (results[0] is List) {
        if (results.length > 2 && results[2] is Map) {
          final userDetails = results[2] as Map<String, dynamic>;
          final fetchedPhoto = userDetails['photo'];
          if (fetchedPhoto != null && fetchedPhoto.toString().startsWith('http')) {
            setUserPhoto(fetchedPhoto.toString());
          } else {
            setUserPhoto('');
          }
        }
        setState(() {
          _list = results[0] as List;
          _summary = results[1] as Map<String, dynamic>?;
        });
      } else {
        setState(() => _errorMessage = getText('alert_generic_error'));
      }
    } catch (e) {
      print('[ListCondomiums] Error: $e');
      if (mounted) setState(() => _errorMessage = getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _goToNext(dynamic item, {Widget? directPage}) {
    Singleton.instance.id_condominio = item["id"];
    Singleton.instance.apartamento = item["apto"] ?? '';
    Singleton.instance.id_apartamento = item["apto_id"] ?? -1;
    Singleton.instance.bloco = item["apto_bloco"] ?? '';
    Singleton.instance.apto_tipo = item["apto_tipo"];
    Singleton.instance.dias_restantes_morador = item["dias_restantes_morador"] ?? 10;
    Singleton.instance.vencimento_morador = item["vencimento_morador"] ?? "";
    Singleton.instance.moeda = item["moeda"] ?? "";

    if (directPage != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => directPage))
          .then((_) { if (mounted) _loadList(); });
      return;
    }

    _push(item["id"]);
  }

  void _push(int id) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => MyCondominium(id: id),
    )).then((_) { if (mounted) _loadList(); });
  }

  /// Converte um valor da API (que pode vir como num, String ou null) em double.
  double _toDouble(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString().replaceAll(',', '.')) ?? 0;
  }

  void _onDashboardTap(String module) {
    if (_list.isEmpty) return;
    
    final type = getUserType();
    
    Widget? page;
    if (module == 'debts') {
      page = type == 'morador' ? const MoradorFinanceiroView() : const ListInadimplestes();
    } else if (module == 'occurrences') {
      page = const ListOcorrencias();
    } else if (module == 'visits') {
      page = const ListVisitantes();
    } else if (module == 'packages') {
      page = const ListEncomendas();
    }
    
    if (page == null) return;

    if (_list.length == 1) {
      _goToNext(_list.first, directPage: page);
    } else {
      _showCondominiumSelectionSheet(context, page);
    }
  }

  void _showCondominiumSelectionSheet(BuildContext context, Widget targetPage) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        final bg = AppColors.surfaceElevated(context);
        final textColor = AppColors.textPrimary(context);
        final textSecondary = AppColors.textSecondary(context);
        
        return Container(
          decoration: BoxDecoration(
            color: bg,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            border: Border(top: BorderSide(color: AppColors.border(context))),
          ),
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md, horizontal: AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.textTertiary(context),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                'Selecione o Condomínio',
                style: AppTypography.headline(context).copyWith(
                  fontWeight: FontWeight.w600,
                  color: textColor,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Escolha um condomínio para ver os detalhes.',
                style: AppTypography.caption(context).copyWith(
                  color: textSecondary,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _list.length,
                  itemBuilder: (context, index) {
                    final cond = _list[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: InkWell(
                        onTap: () {
                          Navigator.pop(context);
                          _goToNext(cond, directPage: targetPage);
                        },
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.border(context)),
                            color: AppColors.surface(context),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Icon(
                                  Icons.business,
                                  color: AppColors.primary,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      cond['nome'] ?? '',
                                      style: AppTypography.body(context).copyWith(
                                        fontWeight: FontWeight.w600,
                                        color: textColor,
                                      ),
                                    ),
                                    if (cond['apto'] != null) ...[
                                      const SizedBox(height: 2),
                                      Text(
                                        '${cond['apto_bloco'] != null ? "${cond['apto_bloco']} / " : ""}${cond['apto']}',
                                        style: AppTypography.caption(context).copyWith(
                                          color: textSecondary,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                              Icon(
                                Icons.chevron_right,
                                color: textSecondary,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        );
      },
    );
  }

  void _editProfile() {
    final type = getUserType();
    Widget page;
    if (type == 'sindico') {
      page = EditSindico();
    } else if (type == 'morador') {
      page = EditMorador();
    } else {
      page = EditFuncionario();
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => page))
        .then((_) { if (mounted) setState(() {}); });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: _loadList,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(child: _buildHeader(context)),
              if (_isLoading)
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                  sliver: SliverList.separated(
                    itemCount: 5,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, __) => AppSkeleton.listTile(context),
                  ),
                )
              else if (_errorMessage != null)
                SliverToBoxAdapter(child: _buildError())
              else if (_list.isEmpty)
                SliverToBoxAdapter(child: _buildEmpty())
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.xxxl),
                  sliver: SliverList.separated(
                    itemCount: _list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, i) => _CondominioCard(
                      item: _list[i],
                      onTap: () => _goToNext(_list[i]),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
      floatingActionButton: getUserType() == 'sindico'
          ? FloatingActionButton.extended(
              onPressed: () {
                Navigator.push(context, MaterialPageRoute(
                  builder: (_) => SignupCondominuim1(),
                )).then((_) { if (mounted) _loadList(); });
              },
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              icon: Icon(PhosphorIcons.plus),
              label: Text(
                'Novo',
                style: AppTypography.button(context).copyWith(color: Colors.white),
              ),
            )
          : null,
    );
  }

  Widget _buildHeader(BuildContext context) {
    final sw = MediaQuery.of(context).size.width;
    final avatarRadius = sw < 360 ? 22.0 : 28.0;
    final iconSize = sw < 360 ? 20.0 : 24.0;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(avatarRadius),
                child: Container(
                  width: avatarRadius * 2,
                  height: avatarRadius * 2,
                  color: AppColors.primaryLight,
                  child: getUserPhoto().isNotEmpty
                      ? Image.network(
                          getUserPhoto().trim(),
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) {
                            print("[ListCondomiums] Error loading photo: $error");
                            return Icon(
                              PhosphorIcons.user,
                              color: AppColors.primary,
                              size: avatarRadius,
                            );
                          },
                        )
                      : Icon(
                          PhosphorIcons.user,
                          color: AppColors.primary,
                          size: avatarRadius,
                        ),
                ),
              ),
              AppSpacing.gapMd,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(getText('ola'),
                          style: AppTypography.bodySecondary(context)),
                    ),
                    const SizedBox(height: 2),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        getUsername(),
                        style: AppTypography.headline(context),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: Icon(PhosphorIcons.pencilSimple,
                    color: AppColors.textSecondary(context), size: iconSize),
                onPressed: _editProfile,
                tooltip: getText('editar_infos'),
                padding: const EdgeInsets.all(6),
                constraints: const BoxConstraints(),
              ),
              const SizedBox(width: 4),
              IconButton(
                icon: Icon(PhosphorIcons.bell,
                    color: AppColors.textSecondary(context), size: iconSize),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const NotificationSettingsPage()),
                  );
                },
                tooltip: 'Notificações',
                padding: const EdgeInsets.all(6),
                constraints: const BoxConstraints(),
              ),
              const SizedBox(width: 4),
              IconButton(
                icon: Icon(PhosphorIcons.signOut,
                    color: AppColors.textSecondary(context), size: iconSize),
                tooltip: getText('lb_logout'),
                padding: const EdgeInsets.all(6),
                constraints: const BoxConstraints(),
                onPressed: () {
                  storageLogout();
                  Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
                },
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xxl),
          _buildDashboard(context),
          const SizedBox(height: AppSpacing.xxl),
          Text(getText('meus_condominios'),
              style: AppTypography.title(context)),
          AppSpacing.gapXs,
          Text('${_list.length} ${_list.length == 1 ? "condomínio" : "condomínios"}',
              style: AppTypography.bodySecondary(context)),
          AppSpacing.gapXl,
        ],
      ),
    );
  }

  Widget _buildDashboard(BuildContext context) {
    if (_summary == null) return const SizedBox.shrink();
    final type = getUserType();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Resumo Geral', style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            if (type == 'sindico') ...[
              Expanded(
                child: _DashboardCard(
                  title: 'Inadimplência',
                  value: 'R\$ ${_toDouble(_summary!['debts']['total']).toStringAsFixed(2)}',
                  subtitle: '${_summary!['debts']['count']} pendências',
                  icon: PhosphorIcons.money,
                  color: AppColors.error,
                  onTap: () => _onDashboardTap('debts'),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _DashboardCard(
                  title: 'Ocorrências',
                  value: _summary!['occurrences'].toString(),
                  subtitle: 'Aguardando resposta',
                  icon: PhosphorIcons.warningCircle,
                  color: AppColors.warning,
                  onTap: () => _onDashboardTap('occurrences'),
                ),
              ),
            ] else if (type == 'morador') ...[
              Expanded(
                child: _DashboardCard(
                  title: 'Visitas Hoje',
                  value: _summary!['visits'].toString(),
                  subtitle: 'Agendadas para hoje',
                  icon: PhosphorIcons.userList,
                  color: AppColors.primary,
                  onTap: () => _onDashboardTap('visits'),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _DashboardCard(
                  title: 'Encomendas',
                  value: _summary!['packages'].toString(),
                  subtitle: 'Aguardando retirada',
                  icon: PhosphorIcons.package,
                  color: AppColors.success,
                  onTap: () => _onDashboardTap('packages'),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _buildError() {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Icon(PhosphorIcons.warningCircle,
              size: 56, color: AppColors.error),
          AppSpacing.gapLg,
          Text(_errorMessage!,
              style: AppTypography.body(context),
              textAlign: TextAlign.center),
          AppSpacing.gapXl,
          AppButton(
            label: 'Tentar novamente',
            icon: PhosphorIcons.arrowClockwise,
            variant: AppButtonVariant.secondary,
            onPressed: _loadList,
            fullWidth: false,
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    final isSindico = getUserType() == 'sindico';
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          AppSpacing.gapXxxl,
          Container(
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.buildings,
                size: 48, color: AppColors.primary),
          ),
          AppSpacing.gapLg,
          Text('Nenhum condomínio',
              style: AppTypography.headline(context)),
          AppSpacing.gapSm,
          Text(
            isSindico
                ? 'Toque em "Novo" para cadastrar seu primeiro condomínio'
                : 'Você ainda não possui condomínios vinculados',
            style: AppTypography.bodySecondary(context),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _DashboardCard extends StatelessWidget {
  final String title;
  final String value;
  final String subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _DashboardCard({
    required this.title,
    required this.value,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface(context),
      borderRadius: BorderRadius.circular(AppRadius.xl),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        child: Container(
          height: 140,
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.xl),
            border: Border.all(color: color.withOpacity(0.1), width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const Spacer(),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: AppTypography.headline(context).copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                title,
                style: AppTypography.captionMedium(context),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.textTertiary(context),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CondominioCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  const _CondominioCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isMorador = getUserType() == 'morador';
    Widget subtitleWidget;

    if (isMorador) {
      final apto = item['apto']?.toString() ?? '';
      final bloco = item['apto_bloco']?.toString() ?? '';
      String details = '';
      if (apto.isNotEmpty) {
        details = bloco.isNotEmpty ? 'Bloco $bloco - Apto $apto' : 'Apto $apto';
      } else {
        details = 'Morador';
      }
      subtitleWidget = Text(
        details,
        style: AppTypography.caption(context).copyWith(
          color: AppColors.textSecondary(context),
          fontWeight: FontWeight.normal,
        ),
      );
    } else {
      final numBlocos = item['num_blocos'] ?? 0;
      final numAptos = item['num_aptos'] ?? 0;
      final blocoText = numBlocos == 1 ? 'bloco' : 'blocos';
      final aptoText = numAptos == 1 ? 'unidade' : 'unidades';

      subtitleWidget = Text(
        '$numBlocos $blocoText · $numAptos $aptoText',
        style: AppTypography.caption(context).copyWith(
          color: AppColors.textSecondary(context),
          fontWeight: FontWeight.normal,
        ),
      );
    }

    return Material(
      color: AppColors.surface(context),
      borderRadius: BorderRadius.circular(AppRadius.xl),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.lg),
                child: SizedBox(
                  width: 64, height: 64,
                  child: item['photo'] != null && item['photo'].toString().isNotEmpty
                      ? Image.network(
                          item['photo'],
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => _placeholder(),
                        )
                      : _placeholder(),
                ),
              ),
              AppSpacing.gapLg,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item['nome'] ?? '',
                        style: AppTypography.bodyMedium(context),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    AppSpacing.gapXs,
                    subtitleWidget,
                  ],
                ),
              ),
              Icon(PhosphorIcons.caretRight,
                  color: AppColors.textTertiary(context), size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeholder() {
    return Container(
      color: AppColors.primaryLight,
      child: Icon(PhosphorIcons.buildingsFill,
          color: AppColors.primary, size: 32),
    );
  }
}
