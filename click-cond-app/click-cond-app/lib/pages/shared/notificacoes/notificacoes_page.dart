import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/comunicados/detail_comunidado.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/datas.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:click/widgets/app/linha_faixa.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Central de notificações: reúne num feed único tudo que aconteceu de
/// relevante para o usuário — encomendas, comunicados, respostas de ocorrência,
/// contas a pagar, reservas e entradas/saídas.
class NotificacoesPage extends StatefulWidget {
  const NotificacoesPage({super.key});

  @override
  State<NotificacoesPage> createState() => _NotificacoesPageState();
}

class _NotificacoesPageState extends State<NotificacoesPage> {
  List<dynamic> _itens = [];
  bool _isLoading = true;
  DateTime? _ultimaVisita;
  String _filtroSelecionado = 'todas';

  @override
  void initState() {
    super.initState();
    _ultimaVisita = getUltimaVisitaNotificacoes();
    _carregar();
  }

  Future<void> _carregar() async {
    final lista = await apiGetNotificacoes();
    if (!mounted) return;
    setState(() {
      _itens = lista;
      _isLoading = false;
    });
    marcarNotificacoesComoVistas();
  }

  bool _isNova(dynamic n) {
    if (_ultimaVisita == null) return true;
    final ts = DateTime.tryParse(n['timestamp']?.toString() ?? '');
    return ts != null && ts.isAfter(_ultimaVisita!);
  }

  ({IconData icon, Color cor, String tag}) _visual(dynamic n) {
    final tipo = n['tipo']?.toString() ?? '';
    final titulo = (n['titulo']?.toString() ?? '').toLowerCase();
    final desc = (n['descricao']?.toString() ?? '').toLowerCase();

    switch (tipo) {
      case 'encomenda':
        return (
          icon: PhosphorIcons.package,
          cor: AppColors.brand,
          tag: 'Encomenda'
        );
      case 'comunicado':
        return (
          icon: PhosphorIcons.megaphone,
          cor: AppColors.warning,
          tag: 'Comunicado'
        );
      case 'ocorrencia':
        return (
          icon: PhosphorIcons.warningCircle,
          cor: AppColors.error,
          tag: 'Ocorrência'
        );
      case 'financeiro':
        return (
          icon: PhosphorIcons.currencyCircleDollar,
          cor: AppColors.success,
          tag: 'Financeiro'
        );
      case 'reserva':
        return (
          icon: PhosphorIcons.calendarCheck,
          cor: AppColors.brand,
          tag: 'Reserva'
        );
      case 'solicitacao':
      case 'autorizacao_visitante':
        return (
          icon: PhosphorIcons.bellRinging,
          cor: AppColors.warning,
          tag: 'Solicitação'
        );
      case 'acesso':
        final isSaida = titulo.contains('saída') || desc.contains('saiu');
        if (isSaida) {
          return (
            icon: PhosphorIcons.signOut,
            cor: AppColors.textTertiary(context),
            tag: 'Saída'
          );
        }
        return (
          icon: PhosphorIcons.signIn,
          cor: AppColors.success,
          tag: 'Entrada'
        );
      default:
        return (
          icon: PhosphorIcons.bell,
          cor: AppColors.textTertiary(context),
          tag: 'Aviso'
        );
    }
  }

  List<dynamic> get _itensFiltrados {
    if (_filtroSelecionado == 'todas') return _itens;
    if (_filtroSelecionado == 'acesso') {
      return _itens.where((i) => i['tipo'] == 'acesso').toList();
    }
    if (_filtroSelecionado == 'encomenda') {
      return _itens.where((i) => i['tipo'] == 'encomenda').toList();
    }
    if (_filtroSelecionado == 'comunicado') {
      return _itens.where((i) => i['tipo'] == 'comunicado').toList();
    }
    return _itens
        .where((i) => !['acesso', 'encomenda', 'comunicado'].contains(i['tipo']))
        .toList();
  }

  int _countTipo(String filtro) {
    if (filtro == 'todas') return _itens.length;
    if (filtro == 'acesso') {
      return _itens.where((i) => i['tipo'] == 'acesso').length;
    }
    if (filtro == 'encomenda') {
      return _itens.where((i) => i['tipo'] == 'encomenda').length;
    }
    if (filtro == 'comunicado') {
      return _itens.where((i) => i['tipo'] == 'comunicado').length;
    }
    return _itens
        .where((i) => !['acesso', 'encomenda', 'comunicado'].contains(i['tipo']))
        .length;
  }

  int? _idNumerico(dynamic n) {
    final raw = n['id']?.toString() ?? '';
    final partes = raw.split('-');
    if (partes.length < 2) return null;
    return int.tryParse(partes.last);
  }

  void _abrir(dynamic n) {
    final tipo = n['tipo']?.toString() ?? '';
    final id = _idNumerico(n);
    Widget? destino;
    switch (tipo) {
      case 'encomenda':
        destino = ListEncomendas(destacarId: id);
        break;
      case 'comunicado':
        if (id == null) return;
        destino = DetailComunicado(id: id);
        break;
      case 'ocorrencia':
        if (id == null) return;
        destino = DetailOcorrencia(id: id);
        break;
      case 'financeiro':
        destino = const MoradorFinanceiroView();
        break;
      case 'solicitacao':
      case 'autorizacao_visitante':
        destino = const PendentesVisitantePage();
        break;
      case 'acesso':
        destino = HistoricoAcessosPage(destacarId: id);
        break;
    }
    if (destino == null) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => destino!));
  }

  String _tempoRelativo(String? iso) {
    final ts = parseDataApi(iso);
    if (ts == null) return '';
    final diff = DateTime.now().difference(ts);

    if (diff.isNegative) {
      final dias = -diff.inDays;
      if (dias >= 1) return 'em $dias ${dias == 1 ? 'dia' : 'dias'}';
      return 'em breve';
    }
    if (diff.inMinutes < 1) return 'agora';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min atrás';
    if (diff.inHours < 24) return '${diff.inHours} h atrás';
    if (diff.inDays == 1) return 'ontem';
    if (diff.inDays < 7) return '${diff.inDays} dias atrás';
    return '${ts.day.toString().padLeft(2, '0')}/${ts.month.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final exibidos = _itensFiltrados;

    return AppScaffold(
      title: 'Notificações',
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _carregar,
              child: Column(
                children: [
                  _buildFilterBar(),
                  Expanded(
                    child: exibidos.isEmpty
                        ? _vazio()
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(
                              AppSpacing.lg,
                              AppSpacing.xs,
                              AppSpacing.lg,
                              AppSpacing.xl,
                            ),
                            itemCount: exibidos.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: AppSpacing.md),
                            itemBuilder: (_, i) => _card(exibidos[i]),
                          ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilterBar() {
    final filtros = [
      {'key': 'todas', 'label': 'Todas'},
      {'key': 'acesso', 'label': 'Acessos'},
      {'key': 'encomenda', 'label': 'Encomendas'},
      {'key': 'comunicado', 'label': 'Comunicados'},
      {'key': 'outros', 'label': 'Outros'},
    ];

    // Mesmas abas sublinhadas de Encomendas; com rolagem porque são 5.
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.md),
      child: AppSegmentedControl(
        scrollable: true,
        selectedIndex:
            filtros.indexWhere((f) => f['key'] == _filtroSelecionado),
        onChanged: (i) =>
            setState(() => _filtroSelecionado = filtros[i]['key']!),
        segments: [
          for (final f in filtros)
            AppSegment(
              label: f['label']!,
              count: _countTipo(f['key']!) > 0 ? _countTipo(f['key']!) : null,
            ),
        ],
      ),
    );
  }

  Widget _vazio() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.18),
        Icon(
          PhosphorIcons.bellSlash,
          size: 52,
          color: AppColors.textTertiary(context),
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          _filtroSelecionado == 'todas'
              ? 'Nenhuma notificação por aqui'
              : 'Nenhuma notificação nesta categoria',
          textAlign: TextAlign.center,
          style: AppTypography.bodyMedium(context)
              .copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: AppSpacing.xs),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
          child: Text(
            'Avisos sobre encomendas, comunicados, contas e acessos aparecem aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context),
          ),
        ),
      ],
    );
  }

  /// Aviso no desenho dos eventos: faixa em degradê na cor do tipo com o
  /// ícone por cima, selo "● TIPO" e "NOVA" discreto.
  Widget _card(dynamic n) {
    final v = _visual(n);
    final nova = _isNova(n);
    final descricao = (n['descricao']?.toString() ?? '').trim();
    final tipo = n['tipo']?.toString() ?? '';
    final navegavel = tipo != 'reserva';
    // O amarelo da marca não serve como texto no tema claro.
    final corTexto = v.cor == AppColors.brand ? AppColors.brandInkOf(context) : null;

    return DecoratedBox(
      decoration: BoxDecoration(border: Border.all(color: AppColors.border(context))),
      child: LinhaFaixa(
        tom: v.cor,
        corSelo: corTexto,
        selo: v.tag,
        titulo: n['titulo']?.toString() ?? '',
        linhas: [descricao, _tempoRelativo(n['timestamp']?.toString())],
        nova: nova,
        onTap: navegavel ? () => _abrir(n) : null,
        esquerda: Padding(
          padding: const EdgeInsets.only(left: 24),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Icon(v.icon, color: corTexto ?? v.cor, size: 24),
          ),
        ),
      ),
    );
  }
}
