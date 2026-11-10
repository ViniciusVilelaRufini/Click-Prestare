import 'package:click/widgets/app/app_card.dart';
import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/utils/rotulo_bloco.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/log.dart';
import 'dart:convert';
import 'dart:typed_data';
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/notificacoes/notificacoes_page.dart';
import 'package:click/widgets/app/evento_linha.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/shared/financeiro/list_financeiro.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/pages/shared/funcionarios/edit_funcionario.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/morador/edit_morador.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/pages/sindico/edit_sindico.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/cond_cache.dart';
import 'package:click/utils/datas.dart';
import 'package:click/utils/eventos_utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListCondomiums extends StatefulWidget {
  const ListCondomiums({super.key});

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
      // Esta função roda dentro do initState: navegar aqui mexe no Overlay no
      // meio do build, a asserção deixa o Navigator travado e nenhuma navegação
      // seguinte funciona. Depois do frame, é seguro.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
      });
      WidgetsBinding.instance.ensureVisualUpdate();
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
      // Resposta de uma sessão que já saiu não vai para o cache nem para a tela.
      if (getToken() != token) return;
      if (results[0] is List) {
        if (results.length > 2 && results[2] is Map) {
          final userDetails = results[2] as Map<String, dynamic>;
          final fetchedPhoto = (userDetails['foto_pessoa'] ??
                  userDetails['photo'] ??
                  userDetails['profile_image'])
              ?.toString()
              .trim();
          if (fetchedPhoto != null &&
              fetchedPhoto.isNotEmpty &&
              fetchedPhoto != 'null' &&
              fetchedPhoto != 'undefined') {
            setUserPhoto(fetchedPhoto);
          }
        }
        final fetchedList = results[0] as List;
        final fetchedSummary = results[1] as Map<String, dynamic>?;

        // Pré-aquece o cache do condomínio com dados já conhecidos (elimina o skeleton)
        for (final item in fetchedList) {
          if (item is Map && item['id'] != null) {
            final cid = item['id'] as int;
            final existing = CondCache.get(cid);
            CondCache.put(
              cid,
              CondCacheEntry(
                cond: Map<String, dynamic>.from(item),
                summary: fetchedSummary ?? existing?.summary,
                saldo: item['saldo']?.toString() ?? existing?.saldo ?? '',
                ocorrenciasAbertas: existing?.ocorrenciasAbertas ?? 0,
                temp: existing?.temp,
                weatherDesc: existing?.weatherDesc,
                weatherIcon: existing?.weatherIcon,
              ),
            );
          }
        }

        setState(() {
          _list = fetchedList;
          _summary = fetchedSummary;
          _eventos = results.length > 3 && results[3] is List
              ? results[3] as List
              : [];
        });
      } else {
        setState(() => _errorMessage = getText('alert_generic_error'));
      }
    } catch (e) {
      logDebug('[ListCondomiums] Error: $e');
      if (mounted)
        setState(() => _errorMessage = getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _goToNext(dynamic item, {Widget? directPage, int aba = 0}) {
    Singleton.instance.id_condominio = item["id"];
    Singleton.instance.apartamento = item["apto"] ?? '';
    Singleton.instance.id_apartamento = item["apto_id"] ?? -1;
    Singleton.instance.bloco = item["apto_bloco"] ?? '';
    Singleton.instance.apto_tipo = item["apto_tipo"];
    Singleton.instance.dias_restantes_morador =
        item["dias_restantes_morador"] ?? 10;
    Singleton.instance.vencimento_morador = item["vencimento_morador"] ?? "";
    Singleton.instance.moeda = item["moeda"] ?? "";

    Singleton.instance.condominio_nome = (item["nome"] ?? '').toString();
    Singleton.instance.condominio_photo = (item["photo"] ?? '').toString();

    if (directPage != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => directPage))
          .then((_) {
        if (mounted) _loadList();
      });
      return;
    }

    final condMap = item is Map<String, dynamic> ? item : (item is Map ? Map<String, dynamic>.from(item) : null);
    final condId = item["id"] is int ? item["id"] as int : int.tryParse(item["id"]?.toString() ?? '') ?? 0;
    if (condMap != null && condId > 0) {
      final existing = CondCache.get(condId);
      CondCache.put(
        condId,
        CondCacheEntry(
          cond: condMap,
          summary: _summary ?? existing?.summary,
          saldo: condMap["saldo"]?.toString() ?? existing?.saldo ?? '',
          ocorrenciasAbertas: existing?.ocorrenciasAbertas ?? 0,
          temp: existing?.temp,
          weatherDesc: existing?.weatherDesc,
          weatherIcon: existing?.weatherIcon,
        ),
      );
    }

    _push(condId, initialCond: condMap, initialSummary: _summary, initialTab: aba);
  }

  void _push(int id, {Map<String, dynamic>? initialCond, Map<String, dynamic>? initialSummary, int initialTab = 0}) {
    Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => MyCondominium(
            id: id,
            initialCond: initialCond,
            initialSummary: initialSummary,
            initialTab: initialTab,
          ),
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
    } else if (module == 'areas') {
      page = ListAreasSociais();
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

  void _showCondominiumSelectionSheet(BuildContext context, Widget? targetPage, {int aba = 0}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) {
        return Container(
          decoration: BoxDecoration(
            color: AppColors.bg100(context),
            border: Border(top: BorderSide(color: AppColors.borderStrong(context))),
          ),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 3,
                  margin: const EdgeInsets.only(bottom: 16),
                  color: AppColors.borderStrong(context),
                ),
              ),
              Text(
                'SELECIONE O CONDOMÍNIO',
                style: _dTxt(context, 15, lh: 20, ls: 0.16),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Escolha um condomínio para ver os detalhes.',
                style: _bTxt(context, 14, lh: 20),
              ),
              const SizedBox(height: AppSpacing.lg),
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _list.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, index) {
                    final cond = _list[index];
                    return Material(
                      color: AppColors.surface(context),
                      shape: Border.all(color: AppColors.border(context)),
                      child: InkWell(
                        onTap: () {
                          Navigator.pop(context);
                          _goToNext(cond, directPage: targetPage, aba: aba);
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                color: AppColors.brandSoftOf(context),
                                child: Icon(
                                  PhosphorIcons.buildings,
                                  size: 20,
                                  color: AppColors.brandInkOf(context),
                                ),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      cond['nome'] ?? '',
                                      style: _bTxt(context, 16,
                                          lh: 22,
                                          w: FontWeight.w500,
                                          color: AppColors.textPrimary(context)),
                                    ),
                                    if (cond['apto'] != null)
                                      Text(
                                        '${cond['apto_bloco'] != null ? "${cond['apto_bloco']} / " : ""}${cond['apto']}',
                                        style: _bTxt(context, 12,
                                            lh: 16,
                                            color: AppColors.textTertiary(context)),
                                      ),
                                  ],
                                ),
                              ),
                              Icon(
                                PhosphorIcons.caretRight,
                                size: 16,
                                color: AppColors.textTertiary(context),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
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
    // Barra de navegação: 58px de conteúdo + área do gesto do sistema.
    const navBarSpace = 58.0;
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: Stack(
        children: [
          SafeArea(
            bottom: false,
            child: RefreshIndicator(
              color: AppColors.textPrimary(context),
              backgroundColor: AppColors.surface(context),
              onRefresh: _loadList,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(child: _buildHeader(context)),
                  if (_isLoading)
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
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
                          AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                      sliver: SliverToBoxAdapter(child: _buildCondominioList(context)),
                    ),
                  if (!_isLoading && _errorMessage == null && _eventos.isNotEmpty)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                            AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                        child: _buildMeusEventos(context),
                      ),
                    ),
                  SliverToBoxAdapter(
                    child: SizedBox(height: navBarSpace + bottomInset + 24.0),
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

  /// `.list`: itens colados, separados por 1px de line-100 e com contorno.
  /// Cada condomínio em um cartão de destaque próprio, com respiro entre eles.
  Widget _buildCondominioList(BuildContext context) {
    return Column(
        children: [
          for (var i = 0; i < _list.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            _CondominioCard(
              item: _list[i],
              onTap: () => _goToNext(_list[i]),
              summary: _summary,
              isFirst: i == 0,
            ),
          ],
        ],
    );
  }

  /// Item da barra do início: abre o condomínio já na aba ([aba] do
  /// MyCondominium), para a barra continuar embaixo. Abrir a lista solta
  /// (como fazem os atalhos) fazia a barra sumir. Sem condomínio, cai no
  /// comportamento antigo.
  void _abrirAba(int aba, String modulo) {
    if (_list.isEmpty) {
      _onDashboardTap(modulo);
    } else if (_list.length == 1) {
      _goToNext(_list.first, aba: aba);
    } else {
      _showCondominiumSelectionSheet(context, null, aba: aba);
    }
  }

  /// `.nav`: faixa bg-100 com filete line-100 no topo, sem vidro nem sombra.
  Widget _buildFixedBottomNavigationBar(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bg100(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      child: Padding(
        padding: EdgeInsets.only(bottom: navBarBottomPadding(context)),
        child: SizedBox(
          height: 58,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
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
                onTap: () => _abrirAba(1, 'packages'),
              ),
              _buildAiNavButton(context),
              _buildFixedNavItem(
                key: const ValueKey('nav_visitantes_fixed'),
                isSelected: false,
                icon: PhosphorIcons.userList,
                activeIcon: PhosphorIcons.userListFill,
                label: 'Visitantes',
                onTap: () => _abrirAba(2, 'visits'),
              ),
              _buildFixedNavItem(
                key: const ValueKey('nav_financeiro_fixed'),
                isSelected: false,
                icon: PhosphorIcons.wallet,
                activeIcon: PhosphorIcons.walletFill,
                label: 'Financeiro',
                onTap: () => _abrirAba(3, 'debts'),
              ),
            ],
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

  /// Botão central da barra: quadrado sólido `brand` com ícone `on-brand`.
  Widget _buildAiNavButton(BuildContext context) {
    return SizedBox(
      width: 64,
      child: Align(
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: InkWell(
            onTap: _abrirAssistente,
            child: Container(
              width: 48,
              height: 48,
              color: AppColors.brand,
              child: Icon(PhosphorIcons.buildings,
                  color: AppColors.onBrand, size: 22),
            ),
          ),
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
    final cor = isSelected
        ? AppColors.brandInk
        : AppColors.textTertiary(context);

    return Expanded(
      child: InkWell(
        key: key,
        onTap: onTap,
        splashColor: Colors.transparent,
        highlightColor: Colors.transparent,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Filete de 2px sobre o item ativo, colado ao topo da barra.
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: isSelected ? 24 : 0,
              height: 2,
              color: AppColors.brand,
            ),
            const SizedBox(height: 10),
            Icon(isSelected ? activeIcon : icon, color: cor, size: 20),
            const SizedBox(height: 6),
            SizedBox(
              height: 13,
              child: Text(
                label.toUpperCase(),
                style: _dTxt(context, 9.5, ls: 0.06, color: cor),
                maxLines: 1,
                overflow: TextOverflow.clip,
              ),
            ),
            if (isSelected) ...[
              const SizedBox(height: 2),
              Container(width: 4, height: 4, color: AppColors.brand),
            ],
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

  /// `.avatar`: círculo bg-300 com contorno line-200; sem foto, as iniciais.
  Widget _buildAvatar(BuildContext context, double size) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.surfaceElevated(context),
        border: Border.all(color: AppColors.borderStrong(context)),
      ),
      child: ClipOval(child: _buildAvatarImage(size / 2)),
    );
  }

  Widget _avatarIniciais(double avatarRadius) {
    final partes = getUsername()
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    String ini = '';
    if (partes.isNotEmpty) {
      ini = partes.first[0];
      if (partes.length > 1) ini += partes.last[0];
    }
    return Center(
      child: Text(
        ini.toUpperCase(),
        style: _dTxt(context, 14, ls: 0.08),
      ),
    );
  }

  Widget _buildAvatarImage(double avatarRadius) {
    final photo = getUserPhoto().trim();
    if (photo.isEmpty || photo == 'null' || photo == 'undefined') {
      return _avatarIniciais(avatarRadius);
    }

    if (photo.startsWith('data:image') ||
        (!photo.startsWith('http://') &&
            !photo.startsWith('https://') &&
            photo.length > 100)) {
      try {
        String base64Str = photo;
        if (photo.contains('base64,')) {
          base64Str = photo.substring(photo.indexOf('base64,') + 7);
        }
        final Uint8List bytes =
            base64Decode(base64Str.replaceAll(RegExp(r'\s+'), ''));
        return Image.memory(
          bytes,
          width: avatarRadius * 2,
          height: avatarRadius * 2,
          fit: BoxFit.cover,
          gaplessPlayback: true,
          errorBuilder: (context, error, stackTrace) =>
              _avatarIniciais(avatarRadius),
        );
      } catch (e) {
        logDebug("[ListCondomiums] Base64 decode error: $e");
        return _avatarIniciais(avatarRadius);
      }
    }

    return Image.network(
      photo,
      width: avatarRadius * 2,
      height: avatarRadius * 2,
      fit: BoxFit.cover,
      gaplessPlayback: true,
      errorBuilder: (context, error, stackTrace) {
        logDebug("[ListCondomiums] Error loading photo: $error");
        return _avatarIniciais(avatarRadius);
      },
    );
  }

  Widget _buildHeader(BuildContext context) {
    final sw = MediaQuery.of(context).size.width;
    final saudacao = '${getText('ola')} ${getUsername()}'.toUpperCase();
    return Padding(
      // 12 embaixo: o mesmo vão título → conteúdo das outras seções (antes
      // 24 + 12 da lista deixavam um buraco sob "MEUS CONDOMÍNIOS").
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _buildAvatar(context, sw < 360 ? 40 : 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _getFormattedHeaderDate().toUpperCase(),
                      style: _dTxt(context, 11,
                          lh: 14, ls: 0.2, color: AppColors.textTertiary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        saudacao,
                        style: _dTxt(context, 22, lh: 26, ls: 0.1),
                        maxLines: 1,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _buildHeaderActions(context, sw < 360 ? 36 : 40),
            ],
          ),
          const SizedBox(height: 12),
          _buildAtalhos(context),
          const SizedBox(height: 24),
          _buildDashboard(context),
          SizedBox(height: (_summary == null && _pendentesCount == 0) ? 0 : 24),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'MEUS CONDOMÍNIOS',
                style: _dTxt(context, 15, lh: 20, ls: 0.16),
              ),
              Text(
                '${_list.length}',
                style: _bTxt(context, 12,
                    lh: 16, color: AppColors.textTertiary(context)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// `.iconbtn`: quadrado de 1px em line-100, ícone fino em ink.
  Widget _buildHeaderActions(BuildContext context, double lado) {
    Widget acao({
      required IconData icon,
      required VoidCallback onPressed,
      required String tooltip,
      Widget? badge,
    }) {
      final botao = Tooltip(
        message: tooltip,
        child: InkWell(
          onTap: onPressed,
          child: Container(
            width: lado,
            height: lado,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border(context)),
            ),
            child: Icon(icon, color: AppColors.textPrimary(context), size: 18),
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
        const SizedBox(width: 6),
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
                  right: -6,
                  top: -6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    constraints:
                        const BoxConstraints(minWidth: 18, minHeight: 18),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.error,
                      borderRadius: BorderRadius.circular(AppRadius.full),
                    ),
                    child: Text(
                      _naoLidas > 9 ? '9+' : '$_naoLidas',
                      textAlign: TextAlign.center,
                      style: _bTxt(context, 10,
                          w: FontWeight.w600, color: AppColors.onPrimary),
                    ),
                  ),
                ),
        ),
        const SizedBox(width: 6),
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

  /// `.kpis`: grade de duas colunas, células separadas por 1px de line-100.
  Widget _kpiGrid(BuildContext context, List<Widget> cells) {
    final linha = AppColors.border(context);
    final rows = <Widget>[];
    for (var i = 0; i < cells.length; i += 2) {
      if (rows.isNotEmpty) {
        rows.add(SizedBox(height: 1, width: double.infinity, child: ColoredBox(color: linha)));
      }
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: cells[i]),
              SizedBox(width: 1, child: ColoredBox(color: linha)),
              Expanded(
                child: i + 1 < cells.length ? cells[i + 1] : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(color: linha, border: Border.all(color: linha)),
      child: Column(children: rows),
    );
  }

  /// Atalhos em grade 2x2, no padrão das ações do topo do console: o primeiro
  /// (liberar visitante) em destaque na cor de marca. O último muda com o
  /// perfil: o morador paga, o síndico administra e o funcionário não tem
  /// financeiro no início.
  Widget _buildAtalhos(BuildContext context) {
    final type = getUserType();
    final encomendas = int.tryParse('${_summary?['packages'] ?? 0}') ?? 0;

    Widget atalho({
      required IconData icone,
      required String titulo,
      required String apoio,
      required String modulo,
      bool destaque = false,
    }) {
      final tinta = destaque ? AppColors.onBrand : AppColors.textPrimary(context);
      final tintaApoio = destaque
          ? AppColors.onBrand.withValues(alpha: 0.65)
          : AppColors.textTertiary(context);
      return Expanded(
        child: Material(
          color: destaque ? AppColors.brand : AppColors.surface(context),
          shape: destaque
              ? const RoundedRectangleBorder()
              : RoundedRectangleBorder(side: BorderSide(color: AppColors.border(context))),
          child: InkWell(
            onTap: () => _onDashboardTap(modulo),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    color: destaque
                        ? Colors.black.withValues(alpha: 0.12)
                        : AppColors.brandSoft,
                    child: Icon(icone,
                        size: 18, color: destaque ? AppColors.onBrand : AppColors.brandInk),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          titulo.toUpperCase(),
                          style: _dTxt(context, 13, ls: 0.12, color: tinta),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          apoio,
                          style: _bTxt(context, 11, lh: 14, color: tintaApoio),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final ultimo = type == 'funcionario'
        ? atalho(
            icone: PhosphorIcons.warningCircle,
            titulo: 'Ocorrências',
            apoio: 'Abertas e em andamento',
            modulo: 'occurrences',
          )
        : atalho(
            icone: PhosphorIcons.wallet,
            titulo: type == 'morador' ? 'Pagar' : 'Financeiro',
            apoio: type == 'morador' ? 'Boletos e contas' : 'Contas do condomínio',
            modulo: 'debts',
          );

    return Column(
      children: [
        Row(
          children: [
            atalho(
              icone: PhosphorIcons.userPlus,
              titulo: 'Liberar',
              apoio: 'Novo visitante',
              modulo: 'visits',
              destaque: true,
            ),
            const SizedBox(width: 8),
            atalho(
              icone: PhosphorIcons.package,
              titulo: 'Encomendas',
              apoio: encomendas > 0
                  ? '$encomendas aguardando retirada'
                  : 'Nada aguardando',
              modulo: 'packages',
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            atalho(
              icone: PhosphorIcons.calendarBlank,
              titulo: 'Reservar',
              apoio: 'Áreas sociais',
              modulo: 'areas',
            ),
            const SizedBox(width: 8),
            ultimo,
          ],
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
          const SizedBox(height: 24),
        ],
        if (_summary != null) ...[
          Text('RESUMO GERAL', style: _dTxt(context, 15, lh: 20, ls: 0.16)),
          const SizedBox(height: 12),
          if (type == 'funcionario')
            _kpiGrid(context, [
              _DashboardCard(
                title: 'Encomendas',
                value: contador2(_summary?['packages'] ?? 0),
                subtitle: 'Aguardando retirada',
                icon: PhosphorIcons.package,
                color: AppColors.warning,
                onTap: () => _onDashboardTap('packages'),
              ),
              _DashboardCard(
                title: 'Visitantes Hoje',
                value: contador2(_summary?['visits_today'] ?? _summary?['visits'] ?? 0),
                subtitle: 'Liberados hoje',
                icon: PhosphorIcons.userList,
                color: AppColors.primary,
                onTap: () => _onDashboardTap('visits'),
              ),
              _DashboardCard(
                title: 'No Condomínio',
                value: contador2(_summary?['inside_condo'] ?? 0),
                subtitle: 'Presentes agora',
                icon: PhosphorIcons.door,
                color: AppColors.success,
                onTap: () => _onDashboardTap('inside_condo'),
              ),
              _DashboardCard(
                title: 'Ocorrências',
                value: contador2(_summary?['occurrences'] ?? 0),
                subtitle: 'Abertas / Ativas',
                icon: PhosphorIcons.warningCircle,
                color: AppColors.error,
                onTap: () => _onDashboardTap('occurrences'),
              ),
            ])
          else if (type == 'sindico')
            _kpiGrid(context, [
              _DashboardCard(
                title: 'Inadimplência',
                value: 'R\$ ${formatMoeda(_summary?['debts']?['total'])}',
                subtitle: '${_summary?['debts']?['count'] ?? 0} pendências',
                icon: PhosphorIcons.money,
                color: AppColors.error,
                onTap: () => _onDashboardTap('debts'),
              ),
              _DashboardCard(
                title: 'Ocorrências',
                value: contador2(_summary?['occurrences'] ?? 0),
                subtitle: 'Aguardando resposta',
                icon: PhosphorIcons.warningCircle,
                color: AppColors.warning,
                onTap: () => _onDashboardTap('occurrences'),
              ),
            ])
          else if (type == 'morador')
            _kpiGrid(context, [
              _DashboardCard(
                title: 'Visitas Hoje',
                value: contador2(_summary?['visits'] ?? 0),
                subtitle: 'Agendadas para hoje',
                icon: PhosphorIcons.userList,
                color: AppColors.primary,
                onTap: () => _onDashboardTap('visits'),
              ),
              _DashboardCard(
                title: 'Encomendas',
                value: contador2(_summary?['packages'] ?? 0),
                subtitle: 'Aguardando retirada',
                icon: PhosphorIcons.package,
                color: AppColors.primary,
                onTap: () => _onDashboardTap('packages'),
              ),
            ]),
        ],
      ],
    );
  }

  /// Aviso de visita na portaria: `.card` com contorno line-200 e ponto de
  /// alerta. Antes era um bloco laranja com gradiente.
  Widget _buildPendentesBanner(BuildContext context) {
    return Material(
      color: AppColors.surface(context),
      shape: Border.all(color: AppColors.borderStrong(context)),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const PendentesVisitantePage()),
          ).then((_) {
            if (mounted) _carregarPendentes();
          });
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              _sinal(AppColors.warning),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '$_pendentesCount ${_pendentesCount == 1 ? "Visita na Portaria" : "Visitas na Portaria"}'
                                .toUpperCase(),
                            style: _dTxt(context, 11, lh: 14, ls: 0.2),
                          ),
                        ),
                        const SizedBox(width: 8),
                        _tag(context, label: 'Aguardando'),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Toque para aprovar ou negar a entrada',
                      style: _bTxt(context, 12,
                          lh: 16, color: AppColors.textTertiary(context)),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                PhosphorIcons.caretRight,
                color: AppColors.textTertiary(context),
                size: 16,
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
    const maxLinhas = 4;
    final mostrar = _eventos.take(maxLinhas).toList();
    final restantes = _eventos.length - mostrar.length;
    final linha = AppColors.border(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Text(
                tituloSecaoEventos(getUserType()).toUpperCase(),
                style: _dTxt(context, 15, lh: 20, ls: 0.16),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            InkWell(
              onTap: () => _abrirHistoricoAcessos(),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'VER TODOS',
                      style: _dTxt(context, 11, lh: 14, ls: 0.2),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      PhosphorIcons.caretRight,
                      color: AppColors.textPrimary(context),
                      size: 12,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'HOJE',
                style: _dTxt(context, 11,
                    lh: 14, ls: 0.2, color: AppColors.textTertiary(context)),
              ),
              Text(
                _formatDateToday(),
                style: _bTxt(context, 12,
                    lh: 16, color: AppColors.textTertiary(context)),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: linha,
            border: Border.all(color: linha),
          ),
          child: Column(
            children: [
              for (var i = 0; i < mostrar.length; i++) ...[
                if (i > 0) SizedBox(height: 1, width: double.infinity, child: ColoredBox(color: linha)),
                _buildEventoRow(context, mostrar[i]),
              ],
              if (restantes > 0) ...[
                SizedBox(height: 1, width: double.infinity, child: ColoredBox(color: linha)),
                Material(
                  color: AppColors.bg100(context),
                  child: InkWell(
                    onTap: () => _abrirHistoricoAcessos(),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Center(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '+ $restantes ${restantes == 1 ? 'evento recente' : 'eventos recentes'}'
                                  .toUpperCase(),
                              style: _dTxt(context, 11, lh: 14, ls: 0.2),
                            ),
                            const SizedBox(width: 6),
                            Icon(
                              PhosphorIcons.arrowRight,
                              size: 13,
                              color: AppColors.textPrimary(context),
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
    final id = int.tryParse(e['id']?.toString() ?? '');
    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();

    final String tag;
    if (isVoce) {
      tag = 'Você';
    } else if (tipoPessoa == 'prestador') {
      tag = 'Prestador';
    } else {
      tag = 'Visitante';
    }

    final String displayName = nome.isNotEmpty
        ? nome
        : (isVoce ? 'Você' : (tipoPessoa == 'prestador' ? 'Prestador' : 'Visitante'));

    final horaStr = _formatHora(e['timestamp']);

    final foto = (e['foto'] ?? '').toString().trim();
    // Mesmo desenho das linhas de evento da portaria web.
    return EventoLinha(
      nome: displayName,
      entrada: isEntrada,
      tipo: tag,
      hora: horaStr,
      foto: foto.isEmpty ? null : foto,
      onTap: () => _abrirHistoricoAcessos(destacarId: id),
    );
  }

  /// Formata a hora como "HH:mm" no fuso local do aparelho.
  String _formatHora(dynamic ts) {
    final d = parseDataApi(ts);
    if (d == null) return '--:--';
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${pad(d.hour)}:${pad(d.minute)}';
  }

  /// Formata a data de hoje como "12 de setembro".
  String _formatDateToday() {
    final now = DateTime.now();
    const meses = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];
    return '${now.day} de ${meses[now.month - 1]}';
  }

  /// Formata o timestamp como "15/07/2026 às 18:24" no fuso local do aparelho.
  String _formatDataHora(dynamic ts) => formatarDataHora(ts);

  Widget _buildError() {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Icon(PhosphorIcons.warningCircle, size: 48, color: AppColors.error),
          AppSpacing.gapLg,
          Text(_errorMessage!,
              style: _bTxt(context, 16,
                  lh: 22, w: FontWeight.w500, color: AppColors.textPrimary(context)),
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
            width: 52,
            height: 52,
            color: AppColors.brandSoftOf(context),
            child: Icon(PhosphorIcons.buildings,
                size: 24, color: AppColors.brandInkOf(context)),
          ),
          AppSpacing.gapLg,
          Text('NENHUM CONDOMÍNIO',
              style: _dTxt(context, 15, lh: 20, ls: 0.16)),
          AppSpacing.gapSm,
          Text(
            isSindico
                ? 'Toque em "Novo" para cadastrar seu primeiro condomínio'
                : 'Você ainda não possui condomínios vinculados',
            style: _bTxt(context, 14, lh: 20),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Estilos locais do tema Prestare Dark: Barlow Condensed em maiúsculas para a
/// estrutura, Barlow para o conteúdo. `lh` é a altura de linha em px.
TextStyle _dTxt(BuildContext c, double size,
    {double lh = 0, double ls = 0.1, FontWeight w = FontWeight.w600, Color? color}) {
  return GoogleFonts.barlowCondensed(
    fontSize: size,
    fontWeight: w,
    letterSpacing: size * ls,
    height: lh == 0 ? null : lh / size,
    color: color ?? AppColors.textPrimary(c),
  );
}

TextStyle _bTxt(BuildContext c, double size,
    {double lh = 0, FontWeight w = FontWeight.w400, Color? color}) {
  return GoogleFonts.barlow(
    fontSize: size,
    fontWeight: w,
    height: lh == 0 ? null : lh / size,
    color: color ?? AppColors.textSecondary(c),
  );
}

/// Ponto de 6px: a única cor decorativa permitida, só para sinalizar.
Widget _sinal(Color color) => Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );

/// `.tag`: contorno line-200, canto de 2px, texto curto em maiúsculas.
Widget _tag(BuildContext context, {Widget? leading, required String label}) {
  return Container(
    height: 22,
    padding: const EdgeInsets.symmetric(horizontal: 8),
    decoration: BoxDecoration(
      border: Border.all(color: AppColors.borderStrong(context)),
      borderRadius: BorderRadius.circular(2),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (leading != null) ...[leading, const SizedBox(width: 6)],
        Text(
          label.toUpperCase(),
          style: _dTxt(context, 10, ls: 0.18, color: AppColors.textSecondary(context)),
          maxLines: 1,
        ),
      ],
    ),
  );
}

/// `.kpi`: rótulo, numeral leve e legenda. O [sinal] só pinta o ponto.
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
    // Cor só sinaliza: o primário (preto/branco) não ganha ponto.
    final sinal = color == AppColors.primary ? null : color;
    return Material(
      color: AppColors.surface(context),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title.toUpperCase(),
                      style: _dTxt(context, 11,
                          lh: 14, ls: 0.2, color: AppColors.textTertiary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(icon, size: 16, color: AppColors.textTertiary(context)),
                ],
              ),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: _dTxt(context, 40, lh: 42, ls: 0.02, w: FontWeight.w300)
                      .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                  maxLines: 1,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  if (sinal != null) ...[_sinal(sinal), const SizedBox(width: 6)],
                  Expanded(
                    child: Text(
                      subtitle,
                      style: _bTxt(context, 12,
                          lh: 16, color: AppColors.textTertiary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `.item` de condomínio dentro da `.list`.
class _CondominioCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback onTap;
  final Map<String, dynamic>? summary;
  final bool isFirst;

  const _CondominioCard({
    required this.item,
    required this.onTap,
    this.summary,
    this.isFirst = false,
  });

  @override
  Widget build(BuildContext context) {
    final isMorador = getUserType() == 'morador';
    final String subtitleText;

    if (isMorador) {
      final apto = item['apto']?.toString() ?? '';
      final bloco = item['apto_bloco']?.toString() ?? '';
      if (apto.isNotEmpty) {
        subtitleText = bloco.isNotEmpty ? '${rotuloBloco(bloco)} · Apto $apto' : 'Apto $apto';
      } else {
        subtitleText = 'Morador';
      }
    } else {
      final numBlocos = item['num_blocos'] ?? 0;
      final numAptos = item['num_aptos'] ?? 0;
      final blocoText = numBlocos == 1 ? 'bloco' : 'blocos';
      final aptoText = numAptos == 1 ? 'unidade' : 'unidades';
      subtitleText = '$numBlocos $blocoText · $numAptos $aptoText';
    }

    return Material(
      type: MaterialType.transparency,
      child: Ink(
        decoration: cartaoDestaque(context),
        child: InkWell(
        onTap: onTap,
        child: Stack(
          children: [
            // Foto ocupando a altura do cartão e sumindo em degradê sob o texto.
            // Fica dentro da faixa de 3px do topo e da borda de 1px.
            Positioned(
              left: 1,
              top: 3,
              bottom: 1,
              width: 150,
              child: ShaderMask(
                blendMode: BlendMode.dstIn,
                shaderCallback: (r) => const LinearGradient(
                  colors: [Colors.black, Colors.black, Colors.transparent],
                  stops: [0, 0.45, 1],
                ).createShader(r),
                child: item['photo'] != null &&
                        item['photo'].toString().trim().isNotEmpty &&
                        item['photo'].toString() != 'null'
                    ? Image.network(
                        item['photo'].toString().trim(),
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _placeholder(context),
                      )
                    : _placeholder(context),
              ),
            ),
            Padding(
          padding: const EdgeInsets.fromLTRB(128, 18, 16, 18),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      item['nome'] ?? '',
                      style: _bTxt(context, 16,
                          lh: 22, w: FontWeight.w500, color: AppColors.textPrimary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      subtitleText,
                      style: _bTxt(context, 12,
                          lh: 16, color: AppColors.textTertiary(context)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 8),
                    _buildBadges(context),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                PhosphorIcons.caretRight,
                color: AppColors.textTertiary(context),
                size: 18,
              ),
            ],
          ),
        ),
          ],
        ),
        ),
      ),
    );
  }

  Widget _buildBadges(BuildContext context) {
    int noLocalCount = 0;
    if (item['no_local'] != null) {
      noLocalCount = int.tryParse(item['no_local'].toString()) ?? 0;
    } else if (item['inside_condo'] != null) {
      noLocalCount = int.tryParse(item['inside_condo'].toString()) ?? 0;
    } else if (item['visitantes_ativos'] != null) {
      noLocalCount = int.tryParse(item['visitantes_ativos'].toString()) ?? 0;
    } else if (item['moradores_no_local'] != null) {
      noLocalCount = int.tryParse(item['moradores_no_local'].toString()) ?? 0;
    } else if (isFirst && summary != null) {
      // Só presença real: visitas do dia incluem quem ainda nem chegou.
      noLocalCount = int.tryParse((summary?['inside_condo'] ?? summary?['visitantesAtivos'])?.toString() ?? '0') ?? 0;
    }

    int packageCount = 0;
    if (item['packages'] != null) {
      packageCount = int.tryParse(item['packages'].toString()) ?? 0;
    } else if (item['encomendas'] != null) {
      packageCount = int.tryParse(item['encomendas'].toString()) ?? 0;
    } else if (item['encomendas_aguardando'] != null) {
      packageCount = int.tryParse(item['encomendas_aguardando'].toString()) ?? 0;
    } else if (isFirst && summary != null) {
      packageCount = int.tryParse((summary?['packages'] ?? summary?['encomendasAguardando'] ?? summary?['encomendas'])?.toString() ?? '0') ?? 0;
    }

    final hasBadges = noLocalCount > 0 || packageCount > 0;

    if (!hasBadges) {
      return _tag(context, label: 'Sem novidades');
    }

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        if (noLocalCount > 0)
          _tag(
            context,
            leading: _sinal(AppColors.success),
            label: '$noLocalCount no local',
          ),
        if (packageCount > 0)
          _tag(
            context,
            leading: Icon(PhosphorIcons.package,
                size: 13, color: AppColors.textSecondary(context)),
            label: '$packageCount',
          ),
      ],
    );
  }

  /// `.ico`: quadrado accent-ghost com o ícone em ink.
  Widget _placeholder(BuildContext context) {
    return Container(
      color: AppColors.brandSoftOf(context),
      padding: const EdgeInsets.only(left: 24),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Icon(
          PhosphorIcons.buildings,
          color: AppColors.brandInkOf(context),
          size: 22,
        ),
      ),
    );
  }
}
