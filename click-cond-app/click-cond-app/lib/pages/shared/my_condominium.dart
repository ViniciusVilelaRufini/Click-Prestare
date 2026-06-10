import 'dart:convert';
import 'dart:ui';
import 'package:http/http.dart' as http;
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/agenda/list_agenda.dart';
import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/shared/comunicados/list_comunicados.dart';
import 'package:click/pages/shared/configuracoes/configuracoes_view.dart';
import 'package:click/pages/shared/docs/list_docs.dart';
import 'package:click/pages/shared/financeiro/list_financeiro.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/funcionarios/list_funcionarios.dart';
import 'package:click/pages/shared/morador/list_moradores.dart';
import 'package:click/pages/shared/morador/list_moradores_geral.dart';
import 'package:click/pages/shared/morador/my_apartamento_view.dart';
import 'package:click/pages/sindico/link_self_morador_sheet.dart';
import 'package:click/pages/shared/mudancas/list_mudancas.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/sindico/relatorios_page.dart';
import 'package:click/pages/shared/prestador%20de%20servico/list_prestadores.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/enquetes/list_enquetes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class MyCondominium extends StatefulWidget {
  const MyCondominium({Key? key, required this.id}) : super(key: key);
  final int id;

  @override
  _MyCondominiumState createState() => _MyCondominiumState();
}

class _MyCondominiumState extends State<MyCondominium> {
  bool _isLoading = false;
  Map<String, dynamic>? _cond;
  late List<_MenuItem> _menu;
  String _saldo = '';
  String _inadimplencia = '';
  Map<String, dynamic>? _summary;
  int _currentTab = 0;
  bool _isNavBarVisible = true;

  double? _temp;
  String? _weatherDesc;
  IconData? _weatherIcon;
  bool _weatherLoading = false;

  /// True quando há um apartamento vinculado ao usuário neste condomínio
  /// (morador sempre; síndico apenas se já se vinculou como morador).
  bool get _temApto {
    final id = Singleton.instance.id_apartamento;
    return id != null && id is int && id > 0;
  }

  /// Síndico que também é morador deste condomínio (vinculado a um apto).
  bool get _sindicoEhMorador => getUserType() == 'sindico' && _temApto;

  @override
  void initState() {
    super.initState();
    Singleton.instance.id_condominio = widget.id;
    _menu = _buildMenu();
    _loadCond();
  }

  String _normalize(String str) {
    var s = str.toLowerCase();
    s = s.replaceAll(RegExp(r'[àáâãäå]'), 'a');
    s = s.replaceAll(RegExp(r'[èéêë]'), 'e');
    s = s.replaceAll(RegExp(r'[ìíîï]'), 'i');
    s = s.replaceAll(RegExp(r'[òóôõöø]'), 'o');
    s = s.replaceAll(RegExp(r'[ùúûü]'), 'u');
    s = s.replaceAll(RegExp(r'[ç]'), 'c');
    s = s.replaceAll(RegExp(r'[ñ]'), 'n');
    return s;
  }

  List<_MenuItem> _buildMenu() {
    final all = <_MenuItem>[
      _MenuItem(getText('lb_areas_sociais'), PhosphorIcons.usersFour, ListAreasSociais()),
      _MenuItem(getText('lb_financeiro'), PhosphorIcons.wallet, getUserType() == 'morador' ? const MoradorFinanceiroView() : const ListFinanceiro()),
      _MenuItem('Minhas Encomendas', PhosphorIcons.package, const ListEncomendas()),
      _MenuItem(getText('lb_assembleia_votacoes'), PhosphorIcons.usersThree, ListAssembleias()),
      _MenuItem(getText('lb_enquetes'), PhosphorIcons.chartBar, ListEnquetes()),
      _MenuItem(getText('lb_comunicados'), PhosphorIcons.megaphone, ListComunicados()),
      _MenuItem(getText('lb_ocorrencias'), PhosphorIcons.warningCircle, ListOcorrencias()),
      _MenuItem(getText('lb_funcionarios_condominio'), PhosphorIcons.users, ListFuncionarios()),
      _MenuItem(getText('lb_manut_programadas'), PhosphorIcons.wrench, ListAgenda()),
      _MenuItem(getText('lb_prestadores_servico'), PhosphorIcons.handshake, ListPrestadores()),
      _MenuItem(getText('lb_agendar_mudanca'), PhosphorIcons.truck, ListMudancas()),
      _MenuItem(getText('lb_cadastrar_visitante'), PhosphorIcons.userPlus, ListVisitantes()),
      // Morador vê apenas o próprio apartamento ("Meu Apartamento"); síndico/funcionário
      // continuam com a lista de blocos/apartamentos do condomínio.
      getUserType() == 'morador'
          ? _MenuItem(getText('lb_meu_apartamento'), PhosphorIcons.house, const MyApartamentoView())
          : _MenuItem(getText('lb_apartamentos'), PhosphorIcons.house, ListMoradores()),
    ];
    if (getUserType() == 'sindico') {
      all.add(_MenuItem('Moradores', PhosphorIcons.usersThree, const ListMoradoresGeral()));
      all.add(_MenuItem('Relatórios', PhosphorIcons.filePdf, const RelatoriosPage()));
      // Quando o síndico também é morador deste condomínio (vinculado a um apto),
      // ganha o item "Meu Apartamento" como o morador.
      if (_sindicoEhMorador) {
        all.add(_MenuItem(getText('lb_meu_apartamento'), PhosphorIcons.houseLine, const MyApartamentoView()));
      }
    }
    if (getUserType() == 'funcionario') {
      final list = all.where((i) =>
          i.label != getText('lb_financeiro') &&
          i.label != getText('lb_assembleia_votacoes') &&
          i.label != getText('lb_enquetes') &&
          i.label != getText('lb_funcionarios_condominio')).toList();
      list.sort((a, b) => _normalize(a.label).compareTo(_normalize(b.label)));
      return list;
    }
    all.sort((a, b) => _normalize(a.label).compareTo(_normalize(b.label)));
    return all;
  }

  Future<void> _loadCond() async {
    if (!mounted) return;
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait<dynamic>([
        getCondominio(widget.id),
        // Resumo escopado ao condomínio aberto (visitas/encomendas deste condomínio).
        getDashboardSummary(widget.id),
      ]);

      if (!mounted) return;
      
      if (results[0] is Map<String, dynamic>) {
        final cond = results[0] as Map<String, dynamic>;
        final raw = (cond['saldo'] ?? '').toString();
        final rawInadimplencia = (cond['inadimplencia'] ?? '').toString();
        setState(() {
          _cond = cond;
          _saldo = raw.replaceAll("R\$", Singleton.instance.getCurrentMoeda());
          _inadimplencia = rawInadimplencia.replaceAll("R\$", Singleton.instance.getCurrentMoeda());
          _summary = results[1] as Map<String, dynamic>?;
        });

        // Trigger weather fetch
        final String city = cond['cidade'] ?? '';
        final String stateCode = cond['uf'] ?? '';
        if (city.isNotEmpty) {
          _fetchWeather(city, stateCode);
        }
      } else {
        _err();
      }
    } catch (_) {
      if (mounted) _err();
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _err() {
    displayMessage(context, getText('alert_error'), getText('alert_generic_error'))
        .then((_) { if (mounted) Navigator.pop(context); });
  }

  Future<void> _updateCondominiumPhoto() async {
    if (getUserType() != 'sindico') return;

    try {
      final pickedFile = await getPhoto(context);
      if (pickedFile == null) return;

      setState(() => _isLoading = true);

      final base64Photo = convertToBase64(pickedFile, 'image/png');

      final info = await apiGetDetails("condominio/infos", 0);
      if (info == null) throw 'Não foi possível carregar as informações do condomínio.';

      final nome = info["nome"] ?? "";
      final documento = info["identificacao"] ?? "";
      final subsindico = info["subsindico_nome"] ?? "";
      final dtIni = info["data_inicio_mandato"] ?? "";
      final dtFim = info["data_termino_mandato"] ?? "";

      await updateInfosCondominio(nome, documento, subsindico, dtIni, dtFim, base64Photo);
      await _loadCond();
      
      if (mounted) {
        displayMessage(context, getText('alert_success'), 'Imagem do condomínio atualizada com sucesso!');
      }
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'), 'Erro ao atualizar imagem: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _navigate(Widget page) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => page))
        .then((_) => _loadCond());
  }

  /// Abre o fluxo de auto-vínculo do síndico como morador. Em sucesso, popula o
  /// Singleton com o apto vinculado e reconstrói o menu (libera "Meu Apartamento").
  Future<void> _onLinkSelfMorador() async {
    final res = await showLinkSelfMoradorSheet(context);
    if (res == null || !mounted) return;
    Singleton.instance.id_apartamento = res['apto_id'];
    Singleton.instance.apartamento = (res['apto'] ?? '').toString();
    Singleton.instance.bloco = (res['apto_bloco'] ?? '').toString();
    Singleton.instance.apto_tipo = res['apto_tipo'];
    setState(() => _menu = _buildMenu());
    displayMessage(context, getText('alert_success'), 'Vínculo criado! Você agora é morador deste apartamento.');
  }

  Future<void> _fetchWeather(String city, String stateCode) async {
    if (city.isEmpty) return;
    setState(() => _weatherLoading = true);
    try {
      final geoUrl = Uri.parse("https://nominatim.openstreetmap.org/search?city=${Uri.encodeComponent(city)}&state=${Uri.encodeComponent(stateCode)}&country=Brazil&format=json&limit=1");
      final geoResponse = await http.get(geoUrl, headers: {'User-Agent': 'ClickCondominioWeatherApp/1.0'});
      if (geoResponse.statusCode == 200) {
        final geoData = jsonDecode(geoResponse.body) as List<dynamic>;
        if (geoData.isNotEmpty) {
          final lat = geoData[0]['lat'];
          final lon = geoData[0]['lon'];

          final weatherUrl = Uri.parse("https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,weather_code&timezone=auto");
          final weatherResponse = await http.get(weatherUrl);
          if (weatherResponse.statusCode == 200) {
            final weatherData = jsonDecode(weatherResponse.body) as Map<String, dynamic>;
            final current = weatherData['current'] as Map<String, dynamic>?;
            if (current != null) {
              final double temp = (current['temperature_2m'] ?? 0.0).toDouble();
              final int code = current['weather_code'] ?? 0;
              
              String desc = "Limpo";
              IconData icon = PhosphorIcons.sun;

              if (code == 0) {
                desc = "Céu Limpo";
                icon = PhosphorIcons.sun;
              } else if (code >= 1 && code <= 3) {
                desc = "Parcialmente Nublado";
                icon = PhosphorIcons.cloudSun;
              } else if (code == 45 || code == 48) {
                desc = "Névoa";
                icon = PhosphorIcons.cloudFog;
              } else if ((code >= 51 && code <= 55) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) {
                desc = "Chuva";
                icon = PhosphorIcons.cloudRain;
              } else if (code >= 71 && code <= 75) {
                desc = "Neve";
                icon = PhosphorIcons.snowflake;
              } else if (code >= 95) {
                desc = "Tempestade";
                icon = PhosphorIcons.cloudLightning;
              }

              setState(() {
                _temp = temp;
                _weatherDesc = desc;
                _weatherIcon = icon;
              });
            }
          }
        }
      }
    } catch (e) {
      print("[Weather] Error: $e");
    } finally {
      setState(() => _weatherLoading = false);
    }
  }

  Widget _buildWeatherWidget() {
    if (_weatherLoading) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.sm),
        child: AppSkeleton(width: double.infinity, height: 60, borderRadius: AppRadius.lg),
      );
    }

    if (_temp == null) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.xl, AppSpacing.md, AppSpacing.xl, 0),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(
            color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.06),
          ),
        ),
        child: Row(
          children: [
            Icon(
              _weatherIcon ?? PhosphorIcons.sun,
              color: AppColors.primary,
              size: 28,
            ),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _weatherDesc ?? 'Tempo Limpo',
                    style: AppTypography.bodySecondary(context).copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Previsão para ${_cond?['cidade'] ?? 'o condomínio'}',
                    style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
                  ),
                ],
              ),
            ),
            Text(
              '${_temp!.toStringAsFixed(1)}°C',
              style: AppTypography.title(context).copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.textPrimary(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHomeTab(BuildContext context) {
    final saldoNeg = _saldo.contains('-');
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _loadCond,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(child: _buildHeader(context)),
            SliverToBoxAdapter(
              child: _isLoading
                  ? Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                      child: AppSkeleton(width: double.infinity, height: 160, borderRadius: AppRadius.xxl),
                    )
                  : _buildStats(context, saldoNeg),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
              sliver: SliverToBoxAdapter(
                child: Row(
                  children: [
                    Expanded(child: Text('Gerenciar', style: AppTypography.title(context))),
                    if (!_isLoading)
                      Text('${_menu.length} módulos', style: AppTypography.tiny(context)),
                  ],
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.lg)),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.xl, 0, AppSpacing.xl, 120),
              sliver: _isLoading
                  ? SliverList.separated(
                      itemCount: 6,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, __) => AppSkeleton.listTile(context),
                    )
                  : SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (_, i) {
                          if (i.isOdd) return const SizedBox(height: AppSpacing.sm);
                          final idx = i ~/ 2;
                          return _MenuRow(
                            item: _menu[idx],
                            onTap: () => _navigate(_menu[idx].page),
                          );
                        },
                        childCount: _menu.length * 2 - 1,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final financeiroPage = getUserType() == 'morador'
        ? MoradorFinanceiroView(hideAppBar: true, showFab: _currentTab == 3)
        : ListFinanceiro(hideAppBar: true, showFab: _currentTab == 3);

    final tabs = [
      _buildHomeTab(context),
      const ListEncomendas(hideAppBar: true),
      ListVisitantes(hideAppBar: true, showFab: _currentTab == 2),
      financeiroPage,
    ];

    // Altura ocupada pela navbar flutuante (container 68 + top 8 + bottom 12)
    // somada ao safe area inferior. As páginas recebem esse espaço via
    // MediaQuery para que listas/FABs não fiquem escondidos atrás da ilha.
    final navBarSpace = 68.0 + 8.0 + 12.0;
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: NotificationListener<ScrollNotification>(
        onNotification: (ScrollNotification notification) {
          if (notification.metrics.axis == Axis.vertical) {
            if (notification is ScrollUpdateNotification) {
              final double delta = notification.scrollDelta ?? 0;
              if (delta > 3.0 && _isNavBarVisible) {
                setState(() {
                  _isNavBarVisible = false;
                });
              } else if (delta < -3.0 && !_isNavBarVisible) {
                setState(() {
                  _isNavBarVisible = true;
                });
              }
            }
          }
          return false;
        },
        child: Stack(
          children: [
            MediaQuery(
              data: MediaQuery.of(context).copyWith(
                padding: MediaQuery.of(context).padding.copyWith(
                      bottom: 0.0,
                    ),
              ),
              child: IndexedStack(
                index: _currentTab,
                children: tabs,
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: AnimatedScale(
                scale: _isNavBarVisible ? 1.0 : 0.92,
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOutCubic,
                child: AnimatedOpacity(
                  opacity: _isNavBarVisible ? 1.0 : 0.90,
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeOut,
                  child: _buildBottomNavigationBar(context),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNavigationBar(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return SafeArea(
      top: false,
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOutCubic,
        padding: EdgeInsets.only(
          left: _isNavBarVisible ? 18.0 : 36.0,
          right: _isNavBarVisible ? 18.0 : 36.0,
          bottom: _isNavBarVisible ? 12.0 : 8.0,
          top: 8.0,
        ),
        child: DecoratedBox(
          // Sombra fica no nivel externo; cor/borda vao DENTRO do ClipRRect
          // para que nada (nem o blur, nem a pilula azul do item ativo) vaze
          // pelos cantos arredondados da ilha.
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(isDark ? 0.30 : 0.06),
                blurRadius: 22,
                spreadRadius: 0,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            clipBehavior: Clip.antiAlias,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOutCubic,
                height: _isNavBarVisible ? 68.0 : 52.0,
                decoration: BoxDecoration(
                  color: isDark
                      ? Colors.black.withOpacity(0.20)
                      : Colors.white.withOpacity(0.35),
                  border: Border.all(
                    color: isDark
                        ? Colors.white.withOpacity(0.12)
                        : Colors.white.withOpacity(0.45),
                    width: 1,
                  ),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildBottomNavItem(
                      index: 0,
                      icon: PhosphorIcons.house,
                      activeIcon: PhosphorIcons.houseFill,
                      label: 'Início',
                    ),
                    _buildBottomNavItem(
                      index: 1,
                      icon: PhosphorIcons.package,
                      activeIcon: PhosphorIcons.packageFill,
                      label: 'Encomendas',
                    ),
                    _buildBottomNavItem(
                      index: 2,
                      icon: PhosphorIcons.userList,
                      activeIcon: PhosphorIcons.userListFill,
                      label: 'Visitantes',
                    ),
                    _buildBottomNavItem(
                      index: 3,
                      icon: PhosphorIcons.wallet,
                      activeIcon: PhosphorIcons.walletFill,
                      label: 'Financeiro',
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

  Widget _buildBottomNavItem({
    required int index,
    required IconData icon,
    required IconData activeIcon,
    required String label,
  }) {
    final isSelected = _currentTab == index;
    final activeColor = AppColors.primary;
    final inactiveColor = AppColors.textSecondary(context);
    
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            _currentTab = index;
            _isNavBarVisible = true;
          });
        },
        borderRadius: BorderRadius.circular(16),
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Pílula do ícone: padding contido para não espremer/estourar com
            // 4 itens em telas estreitas. Largura segue o ícone, centralizada.
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 12),
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.primary.withOpacity(0.12)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                isSelected ? activeIcon : icon,
                color: isSelected ? activeColor : inactiveColor,
                size: 22,
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              height: _isNavBarVisible ? 3.0 : 0.0,
              child: const SizedBox(),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              height: _isNavBarVisible ? 14.0 : 0.0,
              child: AnimatedOpacity(
                duration: const Duration(milliseconds: 200),
                opacity: _isNavBarVisible ? 1.0 : 0.0,
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: AppTypography.tiny(context).copyWith(
                    color: isSelected ? activeColor : inactiveColor,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    fontSize: 10,
                    height: 1.1,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl, AppSpacing.lg, AppSpacing.xl, AppSpacing.lg),
      child: Row(
        children: [
          Material(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(AppRadius.full),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadius.full),
              onTap: () => Navigator.pop(context),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                child: Icon(PhosphorIcons.caretLeft,
                    color: AppColors.textPrimary(context)),
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
                  child: Text('${getText('ola')} ${getUsername()}',
                      style: AppTypography.bodySecondary(context)),
                ),
                if (_cond != null)
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(_cond!['nome'] ?? '',
                        style: AppTypography.headline(context),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
              ],
            ),
          ),
          if (_isLoading)
            const SizedBox(
              width: 24, height: 24,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary),
            )
          else
            Material(
              color: AppColors.surface(context),
              borderRadius: BorderRadius.circular(AppRadius.full),
              child: InkWell(
                borderRadius: BorderRadius.circular(AppRadius.full),
                onTap: () {
                  Navigator.push(context, MaterialPageRoute(
                    builder: (_) => ConfiguracoesView(condominio: _cond),
                  )).then((_) => _loadCond());
                },
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  child: Icon(PhosphorIcons.gearSix,
                      color: AppColors.textPrimary(context)),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStats(BuildContext context, bool saldoNeg) {
    final type = getUserType();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.xl),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft, end: Alignment.bottomRight,
            colors: [AppColors.primaryGradientStart, AppColors.primaryGradientEnd],
          ),
          borderRadius: BorderRadius.circular(AppRadius.xxl),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withOpacity(0.25),
              blurRadius: 20, offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          children: [
            Row(
              children: [
                GestureDetector(
                  onTap: getUserType() == 'sindico' ? _updateCondominiumPhoto : null,
                  child: Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        child: SizedBox(
                          width: 56, height: 56,
                          child: _cond != null && (_cond!['photo'] ?? '').toString().isNotEmpty
                              ? Image.network(
                                  _cond!['photo'],
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => _condFallback(),
                                )
                              : _condFallback(),
                        ),
                      ),
                      if (getUserType() == 'sindico')
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: Container(
                            padding: const EdgeInsets.all(2),
                            decoration: const BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              PhosphorIcons.camera,
                              size: 12,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                AppSpacing.gapMd,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_cond != null)
                        Text(_cond!['nome'] ?? '',
                            style: AppTypography.headline(context).copyWith(color: Colors.white),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                      AppSpacing.gapXs,
                      Text(type == 'morador'
                              ? '${getText('lb_apto')} ${Singleton.instance.apartamento}'
                              : '${(_cond?['num_aptos'] ?? 0)} ${getText('lb_apartamentos')}',
                          style: AppTypography.caption(context).copyWith(
                              color: Colors.white.withOpacity(0.85))),
                    ],
                  ),
                ),
              ],
            ),
            if (type == 'sindico') ...[
              AppSpacing.gapXl,
              Container(height: 1, color: Colors.white.withOpacity(0.2)),
              AppSpacing.gapLg,
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Inadimplência'.toUpperCase(),
                            style: AppTypography.tiny(context).copyWith(
                                color: Colors.white.withOpacity(0.7),
                                letterSpacing: 1)),
                        AppSpacing.gapXs,
                        Text(_inadimplencia.isEmpty ? '${Singleton.instance.getCurrentMoeda()} 0,00' : _inadimplencia,
                            style: AppTypography.title(context).copyWith(
                                color: const Color(0xFFFFB4BC))),
                      ],
                    ),
                  ),
                  Material(
                    color: Colors.white.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      onTap: () => _navigate(ListDocs()),
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Icon(PhosphorIcons.fileText,
                            color: Colors.white, size: 20),
                      ),
                    ),
                  ),
                ],
              ),
              // Se o síndico também mora aqui, oferece o auto-vínculo como morador.
              if (!_temApto) ...[
                AppSpacing.gapLg,
                Material(
                  color: Colors.white.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    onTap: _onLinkSelfMorador,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md, vertical: AppSpacing.md),
                      child: Row(
                        children: [
                          Icon(PhosphorIcons.houseLine, color: Colors.white, size: 18),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text('Vincular-me como morador',
                                style: AppTypography.bodyMedium(context)
                                    .copyWith(color: Colors.white, fontWeight: FontWeight.w600)),
                          ),
                          Icon(PhosphorIcons.caretRight,
                              color: Colors.white.withOpacity(0.8), size: 16),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ] else if (type == 'morador') ...[
              AppSpacing.gapXl,
              Container(height: 1, color: Colors.white.withOpacity(0.2)),
              AppSpacing.gapLg,
              LayoutBuilder(
                builder: (context, constraints) {
                  final isNarrow = constraints.maxWidth < 240;
                  if (isNarrow) {
                    return Column(
                      children: [
                        _AlertItem(
                          count: _summary?['packages'] ?? 0,
                          label: 'Encomendas',
                          icon: PhosphorIcons.package,
                          onTap: () => _navigate(const ListEncomendas()),
                          isExpanded: false,
                        ),
                        const SizedBox(height: 12),
                        Container(height: 1, color: Colors.white.withOpacity(0.15)),
                        const SizedBox(height: 12),
                        _AlertItem(
                          count: _summary?['visits'] ?? 0,
                          label: 'Visitas Hoje',
                          icon: PhosphorIcons.userList,
                          onTap: () => _navigate(const ListVisitantes()),
                          isExpanded: false,
                        ),
                      ],
                    );
                  } else {
                    return Row(
                      children: [
                        _AlertItem(
                          count: _summary?['packages'] ?? 0,
                          label: 'Encomendas',
                          icon: PhosphorIcons.package,
                          onTap: () => _navigate(const ListEncomendas()),
                          isExpanded: true,
                        ),
                        Container(
                          width: 1,
                          height: 40,
                          color: Colors.white.withOpacity(0.2),
                          margin: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                        ),
                        _AlertItem(
                          count: _summary?['visits'] ?? 0,
                          label: 'Visitas Hoje',
                          icon: PhosphorIcons.userList,
                          onTap: () => _navigate(const ListVisitantes()),
                          isExpanded: true,
                        ),
                      ],
                    );
                  }
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _condFallback() => Container(
        color: Colors.white.withOpacity(0.2),
        child: Icon(PhosphorIcons.buildingsFill,
            color: Colors.white, size: 28),
      );
}

class _MenuItem {
  final String label;
  final IconData icon;
  final Widget page;
  _MenuItem(this.label, this.icon, this.page);
}

class _MenuRow extends StatelessWidget {
  final _MenuItem item;
  final VoidCallback onTap;
  const _MenuRow({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface(context),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
          child: Row(
            children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(item.icon, color: AppColors.primary, size: 22),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  item.label,
                  style: AppTypography.bodyMedium(context),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
            ],
          ),
        ),
      ),
    );
  }
}
class _AlertItem extends StatelessWidget {
  final int count;
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool isExpanded;

  const _AlertItem({
    required this.count,
    required this.label,
    required this.icon,
    required this.onTap,
    this.isExpanded = true,
  });

  @override
  Widget build(BuildContext context) {
    final content = InkWell(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, color: Colors.white, size: 24),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    count.toString(),
                    style: AppTypography.headline(context).copyWith(color: Colors.white),
                  ),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    label,
                    style: AppTypography.tiny(context).copyWith(color: Colors.white.withOpacity(0.8)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );

    if (isExpanded) {
      return Expanded(child: content);
    }
    return content;
  }
}
