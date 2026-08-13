import 'dart:ui';
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/notificacoes/notificacoes_page.dart';
import 'package:click/pages/shared/financeiro/list_financeiro.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/financeiro/list_inadimplentes.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/pages/shared/funcionarios/edit_funcionario.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/morador/edit_morador.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
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
  List<dynamic> _eventos = [];
  bool _isLoading = false;
  String? _errorMessage;
  int _naoLidas = 0;
  int _pendentesCount = 0;

  @override
  void initState() {
    super.initState();
    _loadList();
    _carregarNaoLidas();
    _carregarPendentes();
  }

  Future<void> _carregarNaoLidas() async {
    final itens = await apiGetNotificacoes();
    if (!mounted) return;
    setState(() => _naoLidas = contarNaoLidas(itens));
  }

  Future<void> _carregarPendentes() async {
    if (getUserType() != 'morador') return;
    try {
      final res = await apiGetPendentes();
      if (!mounted) return;
      if (res is List) {
        setState(() => _pendentesCount = res.length);
      }
    } catch (_) {}
  }

  Future<void> _loadList() async {
    if (!mounted) return;
    final token = getToken();
    if (token.isEmpty) {
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
      return;
    }
    // Stale-while-revalidate: só mostra o skeleton no PRIMEIRO carregamento
    // (sem dados em cache). Ao voltar para a tela, mantém o conteúdo atual
    // visível e atualiza em segundo plano — nada de skeleton "piscando".
    setState(() {
      if (_list.isEmpty) _isLoading = true;
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
        getMeusEventos(),
      ]);

      if (!mounted) return;
      if (results[0] is List) {
        if (results.length > 2 && results[2] is Map) {
          final userDetails = results[2] as Map<String, dynamic>;
          final fetchedPhoto = userDetails['photo'];
          if (fetchedPhoto != null &&
              fetchedPhoto.toString().startsWith('http')) {
            setUserPhoto(fetchedPhoto.toString());
          } else {
            setUserPhoto('');
          }
        }
        setState(() {
          _list = results[0] as List;
          _summary = results[1] as Map<String, dynamic>?;
          _eventos = results.length > 3 && results[3] is List
              ? results[3] as List
              : [];
        });
      } else {
        setState(() => _errorMessage = getText('alert_generic_error'));
      }
    } catch (e) {
      print('[ListCondomiums] Error: $e');
      if (mounted)
        setState(() => _errorMessage = getText('alert_generic_error'));
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
    Singleton.instance.dias_restantes_morador =
        item["dias_restantes_morador"] ?? 10;
    Singleton.instance.vencimento_morador = item["vencimento_morador"] ?? "";
    Singleton.instance.moeda = item["moeda"] ?? "";

    if (directPage != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => directPage))
          .then((_) {
        if (mounted) _loadList();
      });
      return;
    }

    _push(item["id"]);
  }

  void _push(int id) {
    Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => MyCondominium(id: id),
        )).then((_) {
      if (mounted) _loadList();
    });
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
      page = type == 'morador'
          ? const MoradorFinanceiroView()
          : const ListInadimplentes();
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
          padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.md, horizontal: AppSpacing.lg),
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
                            border:
                                Border.all(color: AppColors.border(context)),
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
                                      style:
                                          AppTypography.body(context).copyWith(
                                        fontWeight: FontWeight.w600,
                                        color: textColor,
                                      ),
                                    ),
                                    if (cond['apto'] != null) ...[
                                      const SizedBox(height: 2),
                                      Text(
                                        '${cond['apto_bloco'] != null ? "${cond['apto_bloco']} / " : ""}${cond['apto']}',
                                        style: AppTypography.caption(context)
                                            .copyWith(
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
    Navigator.push(context, MaterialPageRoute(builder: (_) => page)).then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final navBarSpace = 68.0 + 8.0 + 12.0;
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: Stack(
        children: [
          SafeArea(
            bottom: false,
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
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: AppSpacing.md),
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
                          AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.lg),
                      sliver: SliverList.separated(
                        itemCount: _list.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: AppSpacing.md),
                        itemBuilder: (_, i) => _CondominioCard(
                          item: _list[i],
                          onTap: () => _goToNext(_list[i]),
                        ),
                      ),
                    ),
                  if (!_isLoading && _errorMessage == null && _eventos.isNotEmpty)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                            AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.lg),
                        child: _buildMeusEventos(context),
                      ),
                    ),
                  SliverToBoxAdapter(
                    child: SizedBox(height: navBarSpace + bottomInset + 16.0),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _buildFixedBottomNavigationBar(context),
          ),
        ],
      ),
      floatingActionButton: getUserType() == 'sindico'
          ? Container(
              margin: EdgeInsets.only(bottom: navBarSpace + 12.0),
              child: FloatingActionButton.extended(
                onPressed: () {
                  Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => SignupCondominuim1(),
                      )).then((_) {
                    if (mounted) _loadList();
                  });
                },
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                icon: Icon(PhosphorIcons.plus),
                label: Text(
                  'Novo',
                  style: AppTypography.button(context).copyWith(color: Colors.white),
                ),
              ),
            )
          : null,
    );
  }

  /// Ilha Flutuante FIXA (Travada) - Translúcida com efeito Vidro Fosco (Glassmorphism)
  Widget _buildFixedBottomNavigationBar(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.only(
          left: 18.0,
          right: 18.0,
          bottom: 12.0,
          top: 8.0,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(isDark ? 0.30 : 0.07),
                blurRadius: 20,
                spreadRadius: 0,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            clipBehavior: Clip.antiAlias,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(
                height: 68.0,
                decoration: BoxDecoration(
                  color: isDark
                      ? Colors.black.withOpacity(0.35)
                      : Colors.white.withOpacity(0.65),
                  border: Border.all(
                    color: isDark
                        ? Colors.white.withOpacity(0.15)
                        : Colors.white.withOpacity(0.65),
                    width: 1,
                  ),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildFixedNavItem(
                      key: const ValueKey('nav_home_fixed'),
                      isSelected: true,
                      icon: PhosphorIcons.house,
                      activeIcon: PhosphorIcons.houseFill,
                      label: 'Início',
                      onTap: () => _loadList(),
                    ),
                    _buildFixedNavItem(
                      key: const ValueKey('nav_encomendas_fixed'),
                      isSelected: false,
                      icon: PhosphorIcons.package,
                      activeIcon: PhosphorIcons.packageFill,
                      label: 'Encomendas',
                      onTap: () => _onDashboardTap('packages'),
                    ),
                    _buildAiNavButton(context),
                    _buildFixedNavItem(
                      key: const ValueKey('nav_visitantes_fixed'),
                      isSelected: false,
                      icon: PhosphorIcons.userList,
                      activeIcon: PhosphorIcons.userListFill,
                      label: 'Visitantes',
                      onTap: () => _onDashboardTap('visits'),
                    ),
                    _buildFixedNavItem(
                      key: const ValueKey('nav_financeiro_fixed'),
                      isSelected: false,
                      icon: PhosphorIcons.wallet,
                      activeIcon: PhosphorIcons.walletFill,
                      label: 'Financeiro',
                      onTap: () => _onDashboardTap('debts'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAiNavButton(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const ChatIaPage()),
          ).then((_) => _loadList());
        },
        customBorder: const CircleBorder(),
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              colors: [AppColors.primary, AppColors.primaryDark],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withOpacity(0.45),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: const Icon(PhosphorIcons.buildingsFill, color: Colors.white, size: 24),
        ),
      ),
    );
  }

  Widget _buildFixedNavItem({
    required Key key,
    required bool isSelected,
    required IconData icon,
    required IconData activeIcon,
    required String label,
    required VoidCallback onTap,
  }) {
    final activeColor = AppColors.primary;
    final inactiveColor = AppColors.textSecondary(context);

    return Expanded(
      child: InkWell(
        key: key,
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.primary.withOpacity(0.12)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(
                isSelected ? activeIcon : icon,
                color: isSelected ? activeColor : inactiveColor,
                size: 22,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected ? activeColor : inactiveColor,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  String _getFormattedHeaderDate() {
    final now = DateTime.now();
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const diasSemana = [
      'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'
    ];
    final diaSemana = diasSemana[now.weekday - 1];
    final mes = meses[now.month - 1];
    return '$diaSemana, ${now.day} de $mes';
  }

  Widget _buildHeader(BuildContext context) {
    final sw = MediaQuery.of(context).size.width;
    final avatarRadius = sw < 360 ? 22.0 : 26.0;
    final iconSize = sw < 360 ? 18.0 : 20.0;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [
                  AppColors.primaryGradientStart,
                  AppColors.primaryGradientEnd,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withOpacity(0.35),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.white.withOpacity(0.4),
                      width: 2,
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(avatarRadius),
                    child: Container(
                      width: avatarRadius * 2,
                      height: avatarRadius * 2,
                      color: Colors.white.withOpacity(0.2),
                      child: getUserPhoto().isNotEmpty
                          ? Image.network(
                              getUserPhoto().trim(),
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) {
                                print(
                                    "[ListCondomiums] Error loading photo: $error");
                                return Icon(
                                  PhosphorIcons.user,
                                  color: Colors.white,
                                  size: avatarRadius,
                                );
                              },
                            )
                          : Icon(
                              PhosphorIcons.user,
                              color: Colors.white,
                              size: avatarRadius,
                            ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          getText('ola'),
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.85),
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      const SizedBox(height: 1),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          getUsername(),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.3,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              PhosphorIcons.calendarBlank,
                              size: 11,
                              color: Colors.white.withOpacity(0.9),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  _getFormattedHeaderDate(),
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.95),
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.2,
                                  ),
                                  maxLines: 1,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                _buildHeaderActions(context, iconSize),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xxl),
          _buildDashboard(context),
          const SizedBox(height: AppSpacing.xxl),
          Text(getText('meus_condominios'),
              style: AppTypography.title(context)),
          AppSpacing.gapXs,
          Text(
              '${_list.length} ${_list.length == 1 ? "condomínio" : "condomínios"}',
              style: AppTypography.bodySecondary(context)),
          AppSpacing.gapXl,
        ],
      ),
    );
  }

  /// Ações do topo estilizadas para o card azul do perfil.
  Widget _buildHeaderActions(BuildContext context, double iconSize) {
    Widget acao({
      required IconData icon,
      required VoidCallback onPressed,
      required String tooltip,
      Widget? badge,
    }) {
      final botao = Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.full),
          onTap: onPressed,
          child: Tooltip(
            message: tooltip,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: iconSize),
            ),
          ),
        ),
      );
      if (badge == null) return botao;
      return Stack(clipBehavior: Clip.none, children: [botao, badge]);
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        acao(
          icon: PhosphorIcons.pencilSimple,
          onPressed: _editProfile,
          tooltip: getText('editar_infos'),
        ),
        const SizedBox(width: AppSpacing.xs),
        acao(
          icon: PhosphorIcons.bell,
          tooltip: 'Notificações',
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const NotificacoesPage()),
            ).then((_) {
              if (mounted) _carregarNaoLidas();
            });
          },
          badge: _naoLidas == 0
              ? null
              : Positioned(
                  right: -2,
                  top: -2,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    constraints: const BoxConstraints(minWidth: 16),
                    decoration: BoxDecoration(
                      color: AppColors.error,
                      borderRadius: BorderRadius.circular(AppRadius.full),
                      border:
                          Border.all(color: AppColors.primary, width: 1.5),
                    ),
                    child: Text(
                      _naoLidas > 9 ? '9+' : '$_naoLidas',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                        height: 1.3,
                      ),
                    ),
                  ),
                ),
        ),
        const SizedBox(width: AppSpacing.xs),
        acao(
          icon: PhosphorIcons.signOut,
          tooltip: getText('lb_logout'),
          onPressed: () {
            storageLogout();
            Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
          },
        ),
      ],
    );
  }

  Widget _buildDashboard(BuildContext context) {
    if (_summary == null && _pendentesCount == 0) return const SizedBox.shrink();
    final type = getUserType();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_pendentesCount > 0) ...[
          _buildPendentesBanner(context),
          if (_summary != null) const SizedBox(height: AppSpacing.md),
        ],
        if (_summary != null) ...[
          Text('Resumo Geral',
              style: AppTypography.bodyMedium(context)
                  .copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              if (type == 'sindico') ...[
                Expanded(
                  child: _DashboardCard(
                    title: 'Inadimplência',
                    value: 'R\$ ${formatMoeda(_summary?['debts']?['total'])}',
                    subtitle: '${_summary?['debts']?['count'] ?? 0} pendências',
                    icon: PhosphorIcons.money,
                    color: AppColors.error,
                    onTap: () => _onDashboardTap('debts'),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: _DashboardCard(
                    title: 'Ocorrências',
                    value: (_summary?['occurrences'] ?? 0).toString(),
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
                    value: (_summary?['visits'] ?? 0).toString(),
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
                    value: (_summary?['packages'] ?? 0).toString(),
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
      ],
    );
  }

  Widget _buildPendentesBanner(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const PendentesVisitantePage()),
          ).then((_) {
            if (mounted) _carregarPendentes();
          });
        },
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: const Color(0xFFFFFBEB),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFF59E0B), width: 1.5),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFF59E0B).withOpacity(0.12),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: const BoxDecoration(
                  color: Color(0xFFF59E0B),
                  shape: BoxShape.circle,
                ),
                child: const Icon(PhosphorIcons.bellRinging, color: Colors.white, size: 22),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '$_pendentesCount ${_pendentesCount == 1 ? "Solicitação na Portaria" : "Solicitações na Portaria"}',
                            style: const TextStyle(
                              color: Color(0xFF92400E),
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDC2626),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Text(
                            'AGUARDANDO',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    const Text(
                      'Toque para aprovar ou negar a entrada do visitante',
                      style: TextStyle(
                        color: Color(0xFFB45309),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(PhosphorIcons.caretRight, color: Color(0xFFD97706), size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMeusEventos(BuildContext context) {
    if (_eventos.isEmpty) return const SizedBox.shrink();
    const maxLinhas = 4;
    final mostrar = _eventos.take(maxLinhas).toList();
    final restantes = _eventos.length - mostrar.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.xl),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Row(
            children: [
              Icon(PhosphorIcons.clockCounterClockwise,
                  color: AppColors.primary, size: 15),
              const SizedBox(width: 6),
              Text(
                'MEUS EVENTOS',
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(AppRadius.lg),
          ),
          child: Column(
            children: [
              for (var i = 0; i < mostrar.length; i++) ...[
                if (i > 0)
                  Divider(
                      height: 1,
                      color: AppColors.textTertiary(context).withOpacity(0.1)),
                _buildEventoRow(context, mostrar[i]),
              ],
              if (restantes > 0) ...[
                Divider(
                    height: 1,
                    color: AppColors.textTertiary(context).withOpacity(0.1)),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  child: Text(
                    '+ $restantes ${restantes == 1 ? 'evento' : 'eventos'} recentes',
                    style: AppTypography.tiny(context)
                        .copyWith(color: AppColors.textTertiary(context)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEventoRow(BuildContext context, dynamic e) {
    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();

    final Color cor = isEntrada ? AppColors.success : AppColors.primary;
    final IconData icon =
        isEntrada ? PhosphorIcons.signIn : PhosphorIcons.signOut;

    final String tag = isVoce
        ? 'Você'
        : (tipoPessoa == 'prestador' ? 'Prestador' : 'Visitante');
    final Color tagColor = isVoce ? AppColors.primary : Colors.orange;

    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      child: Row(
        children: [
          Icon(icon, color: cor, size: 18),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      isEntrada ? 'Entrou' : 'Saiu',
                      style: AppTypography.captionMedium(context)
                          .copyWith(color: cor),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        nome.isNotEmpty
                            ? nome
                            : (isVoce ? 'Você' : 'Visitante'),
                        style: AppTypography.caption(context)
                            .copyWith(color: AppColors.textSecondary(context)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 1),
                Text(
                  _formatDataHora(e['timestamp']),
                  style: AppTypography.tiny(context)
                      .copyWith(color: AppColors.textTertiary(context)),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: tagColor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(5),
            ),
            child: Text(tag,
                style: AppTypography.tiny(context)
                    .copyWith(color: tagColor, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  /// Formata o timestamp como "15/07/2026 às 18:24".
  String _formatDataHora(dynamic ts) {
    final d = DateTime.tryParse(ts?.toString() ?? '');
    if (d == null) return '';
    final pad = (int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  Widget _buildError() {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Icon(PhosphorIcons.warningCircle, size: 56, color: AppColors.error),
          AppSpacing.gapLg,
          Text(_errorMessage!,
              style: AppTypography.body(context), textAlign: TextAlign.center),
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
          Text('Nenhum condomínio', style: AppTypography.headline(context)),
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
                  width: 64,
                  height: 64,
                  child: item['photo'] != null &&
                          item['photo'].toString().isNotEmpty
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
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
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
      child:
          Icon(PhosphorIcons.buildingsFill, color: AppColors.primary, size: 32),
    );
  }
}
