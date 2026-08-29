import 'dart:ui';
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/notificacoes/notificacoes_page.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
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
import 'package:click/utils/datas.dart';
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
          final fetchedPhoto = userDetails['photo']?.toString().trim();
          if (fetchedPhoto != null &&
              fetchedPhoto.isNotEmpty &&
              fetchedPhoto != 'null' &&
              fetchedPhoto != 'undefined') {
            setUserPhoto(fetchedPhoto);
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
    final type = getUserType();

    Widget? page;
    if (module == 'debts') {
      page = type == 'morador'
          ? const MoradorFinanceiroView()
          : const ListFinanceiro();
    } else if (module == 'occurrences') {
      page = const ListOcorrencias();
    } else if (module == 'visits' || module == 'inside_condo') {
      page = ListVisitantes(allCondos: _list.isEmpty);
    } else if (module == 'packages') {
      page = ListEncomendas(allCondos: _list.isEmpty);
    }

    if (page == null) return;

    if (_list.isEmpty) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => page!)).then((_) {
        if (mounted) _loadList();
      });
      return;
    }

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

  /// Abre o assistente a partir da LISTA de condomínios.
  ///
  /// Toda requisição do assistente é escopada por `id_condominio`, que só é
  /// preenchido ao entrar num condomínio. Aberto direto daqui, o chat
  /// respondia "id_condominio é obrigatório" a qualquer pergunta. Com um
  /// condomínio só, escolher por ele é óbvio; com vários, é preciso dizer qual.
  void _abrirAssistente() {
    if (Singleton.instance.id_condominio == null && _list.length == 1) {
      Singleton.instance.id_condominio = _list.first["id"];
    }
    if (Singleton.instance.id_condominio == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Abra um condomínio para falar com o PRESTARE IA.'),
        ),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const ChatIaPage()),
    ).then((_) => _loadList());
  }

  Widget _buildAiNavButton(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: InkWell(
        onTap: _abrirAssistente,
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
                              gaplessPlayback: true,
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
                        child: Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(
                                text: "${getText('ola')} ",
                                style: TextStyle(
                                  color: Colors.white.withOpacity(0.9),
                                  fontSize: 16,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              TextSpan(
                                text: getUsername(),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ],
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(getText('meus_condominios'),
                        style: AppTypography.title(context)),
                    AppSpacing.gapXs,
                    Text(
                        '${_list.length} ${_list.length == 1 ? "condomínio" : "condomínios"}',
                        style: AppTypography.bodySecondary(context)),
                  ],
                ),
              ),
              if (getUserType() == 'sindico')
                FilledButton.icon(
                  onPressed: () {
                    Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => SignupCondominuim1(),
                        )).then((_) {
                      if (mounted) _loadList();
                    });
                  },
                  icon: const Icon(PhosphorIcons.plus, size: 16),
                  label: const Text('Novo'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
            ],
          ),
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
          onPressed: () async {
            await storageLogout();
            if (context.mounted) {
              Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
            }
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
          if (type == 'funcionario') ...[
            Row(
              children: [
                Expanded(
                  child: _DashboardCard(
                    title: 'Encomendas',
                    value: (_summary?['packages'] ?? 0).toString(),
                    subtitle: 'Aguardando retirada',
                    icon: PhosphorIcons.package,
                    color: AppColors.warning,
                    onTap: () => _onDashboardTap('packages'),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: _DashboardCard(
                    title: 'Visitantes Hoje',
                    value: (_summary?['visits_today'] ?? _summary?['visits'] ?? 0).toString(),
                    subtitle: 'Liberados hoje',
                    icon: PhosphorIcons.userList,
                    color: AppColors.primary,
                    onTap: () => _onDashboardTap('visits'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: _DashboardCard(
                    title: 'No Condomínio',
                    value: (_summary?['inside_condo'] ?? 0).toString(),
                    subtitle: 'Presentes agora',
                    icon: PhosphorIcons.door,
                    color: AppColors.success,
                    onTap: () => _onDashboardTap('inside_condo'),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: _DashboardCard(
                    title: 'Ocorrências',
                    value: (_summary?['occurrences'] ?? 0).toString(),
                    subtitle: 'Abertas / Ativas',
                    icon: PhosphorIcons.warningCircle,
                    color: AppColors.error,
                    onTap: () => _onDashboardTap('occurrences'),
                  ),
                ),
              ],
            ),
          ] else ...[
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
      ],
    );
  }

  Widget _buildPendentesBanner(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const PendentesVisitantePage()),
          ).then((_) {
            if (mounted) _carregarPendentes();
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: isDark
                  ? [
                      const Color(0xFF261909),
                      const Color(0xFF1A1104),
                    ]
                  : [
                      const Color(0xFFFFF7ED),
                      const Color(0xFFFFEDD5),
                    ],
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: const Color(0xFFF97316).withOpacity(0.35),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFEA580C).withOpacity(0.08),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFFB923C), Color(0xFFEA580C)],
                  ),
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFEA580C).withOpacity(0.32),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: const Icon(
                  PhosphorIcons.bellRingingFill,
                  color: Colors.white,
                  size: 23,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '$_pendentesCount ${_pendentesCount == 1 ? "Visita na Portaria" : "Visitas na Portaria"}',
                            style: TextStyle(
                              color: isDark ? Colors.white : const Color(0xFF7C2D12),
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              letterSpacing: -0.2,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFDC2626).withOpacity(0.12),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: const Color(0xFFDC2626).withOpacity(0.3),
                              width: 1,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 5.5,
                                height: 5.5,
                                decoration: const BoxDecoration(
                                  color: Color(0xFFDC2626),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 4.5),
                              const Text(
                                'Aguardando',
                                style: TextStyle(
                                  color: Color(0xFFB91C1C),
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Toque para aprovar ou negar a entrada',
                      style: TextStyle(
                        color: isDark ? Colors.white70 : const Color(0xFF9A3412),
                        fontSize: 12.5,
                        height: 1.2,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: const Color(0xFFEA580C).withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  PhosphorIcons.caretRightBold,
                  color: Color(0xFFEA580C),
                  size: 15,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _abrirHistoricoAcessos({int? destacarId}) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => HistoricoAcessosPage(destacarId: destacarId),
      ),
    ).then((_) => _loadList());
  }

  Widget _buildMeusEventos(BuildContext context) {
    if (_eventos.isEmpty) return const SizedBox.shrink();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    const maxLinhas = 4;
    final mostrar = _eventos.take(maxLinhas).toList();
    final restantes = _eventos.length - mostrar.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.xxl),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                'Meus Eventos',
                style: AppTypography.bodyMedium(context).copyWith(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => _abrirHistoricoAcessos(),
                  borderRadius: BorderRadius.circular(20),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Ver todos',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 3),
                        const Icon(
                          PhosphorIcons.caretRightBold,
                          color: AppColors.primary,
                          size: 12,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated(context),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: AppColors.border(context),
              width: 1.1,
            ),
            boxShadow: [
              BoxShadow(
                color: isDark
                    ? Colors.black.withOpacity(0.30)
                    : const Color(0xFF64748B).withOpacity(0.06),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < mostrar.length; i++) ...[
                if (i > 0)
                  Divider(
                    height: 1,
                    thickness: 1,
                    color: AppColors.border(context),
                  ),
                _buildEventoRow(context, mostrar[i]),
              ],
              if (restantes > 0) ...[
                Divider(
                  height: 1,
                  thickness: 1,
                  color: AppColors.border(context),
                ),
                Material(
                  color: isDark
                      ? Colors.white.withOpacity(0.02)
                      : const Color(0xFFF8FAFC),
                  child: InkWell(
                    onTap: () => _abrirHistoricoAcessos(),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Center(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '+ $restantes ${restantes == 1 ? 'evento recente' : 'eventos recentes'}',
                              style: TextStyle(
                                color: isDark ? const Color(0xFF60A5FA) : AppColors.primary,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Icon(
                              PhosphorIcons.arrowRightBold,
                              size: 13,
                              color: isDark ? const Color(0xFF60A5FA) : AppColors.primary,
                            ),
                          ],
                        ),
                      ),
                    ),
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final id = int.tryParse(e['id']?.toString() ?? '');
    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();

    // Paleta de status limpa e refinada para light e dark mode
    final Color iconBg = isDark
        ? (isEntrada
            ? const Color(0xFF064E3B).withOpacity(0.35)
            : const Color(0xFF1E3A8A).withOpacity(0.35))
        : (isEntrada
            ? const Color(0xFF10B981).withOpacity(0.12)
            : AppColors.primary.withOpacity(0.12));

    final Color iconColor = isDark
        ? (isEntrada ? const Color(0xFF34D399) : const Color(0xFF60A5FA))
        : (isEntrada ? const Color(0xFF059669) : AppColors.primary);

    final IconData icon = isEntrada
        ? PhosphorIcons.arrowDownLeftBold
        : PhosphorIcons.arrowUpRightBold;

    final String statusLabel = isEntrada ? 'Entrou' : 'Saiu';

    // Tags refinadas
    final String tag;
    final Color tagBg;
    final Color tagBorder;
    final Color tagTextColor;

    if (isVoce) {
      tag = 'Você';
      tagBg = isDark ? const Color(0xFF1E3A8A).withOpacity(0.3) : const Color(0xFFEFF6FF);
      tagBorder = isDark ? const Color(0xFF2563EB).withOpacity(0.4) : const Color(0xFFBFDBFE);
      tagTextColor = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8);
    } else if (tipoPessoa == 'prestador') {
      tag = 'Prestador';
      tagBg = isDark ? const Color(0xFF7C2D12).withOpacity(0.25) : const Color(0xFFFFF7ED);
      tagBorder = isDark ? const Color(0xFFEA580C).withOpacity(0.35) : const Color(0xFFFED7AA);
      tagTextColor = isDark ? const Color(0xFFFDBA74) : const Color(0xFFC2410C);
    } else {
      tag = 'Visitante';
      tagBg = isDark ? const Color(0xFF4C1D95).withOpacity(0.25) : const Color(0xFFFAF5FF);
      tagBorder = isDark ? const Color(0xFF7C3AED).withOpacity(0.35) : const Color(0xFFE9D5FF);
      tagTextColor = isDark ? const Color(0xFFC4B5FD) : const Color(0xFF6D28D9);
    }

    final String displayName = nome.isNotEmpty
        ? nome
        : (isVoce ? 'Você' : (tipoPessoa == 'prestador' ? 'Prestador' : 'Visitante'));

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _abrirHistoricoAcessos(destacarId: id),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 12,
          ),
          child: Row(
            children: [
              // Badge de status moderno
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  icon,
                  color: iconColor,
                  size: 17,
                ),
              ),
              const SizedBox(width: 12),
              // Nome e status + timestamp
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      displayName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white : const Color(0xFF0F172A),
                        letterSpacing: -0.1,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: iconColor,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 4.5),
                        Text(
                          statusLabel,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: iconColor,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          '•  ${_formatDataHora(e['timestamp'])}',
                          style: TextStyle(
                            fontSize: 11.5,
                            color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Tag de papel
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(
                  color: tagBg,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: tagBorder, width: 0.8),
                ),
                child: Text(
                  tag,
                  style: TextStyle(
                    color: tagTextColor,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                PhosphorIcons.caretRightBold,
                size: 13,
                color: isDark ? const Color(0xFF475569) : const Color(0xFF94A3B8),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Formata o timestamp como "15/07/2026 às 18:24" no fuso local do aparelho.
  String _formatDataHora(dynamic ts) => formatarDataHora(ts);

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
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 14,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.xl),
            border: Border.all(color: color.withOpacity(0.12), width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(icon, color: color, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        value,
                        style: AppTypography.headline(context).copyWith(
                          color: color,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                title,
                style: AppTypography.bodyMedium(context).copyWith(
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: AppTypography.caption(context).copyWith(
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
