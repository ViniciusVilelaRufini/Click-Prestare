import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/pages/shared/comunicados/detail_comunidado.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/notificacoes/historico_acessos_page.dart';
import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Central de notificações: reúne num feed único tudo que aconteceu de
/// relevante para o usuário — encomendas, comunicados, respostas de ocorrência,
/// contas a pagar, reservas e entradas/saídas.
class NotificacoesPage extends StatefulWidget {
  const NotificacoesPage({Key? key}) : super(key: key);

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
          cor: const Color(0xFF2563EB),
          tag: 'Encomenda'
        );
      case 'comunicado':
        return (
          icon: PhosphorIcons.megaphone,
          cor: const Color(0xFFF97316),
          tag: 'Comunicado'
        );
      case 'ocorrencia':
        return (
          icon: PhosphorIcons.warningCircle,
          cor: const Color(0xFFEF4444),
          tag: 'Ocorrência'
        );
      case 'financeiro':
        return (
          icon: PhosphorIcons.currencyCircleDollar,
          cor: const Color(0xFF059669),
          tag: 'Financeiro'
        );
      case 'reserva':
        return (
          icon: PhosphorIcons.calendarCheck,
          cor: const Color(0xFF8B5CF6),
          tag: 'Reserva'
        );
      case 'acesso':
        final isSaida = titulo.contains('saída') || desc.contains('saiu');
        if (isSaida) {
          return (
            icon: PhosphorIcons.signOut,
            cor: const Color(0xFF0EA5E9),
            tag: 'Saída'
          );
        }
        return (
          icon: PhosphorIcons.signIn,
          cor: const Color(0xFF10B981),
          tag: 'Entrada'
        );
      default:
        return (
          icon: PhosphorIcons.bell,
          cor: AppColors.primary,
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
      case 'acesso':
        destino = HistoricoAcessosPage(destacarId: id);
        break;
    }
    if (destino == null) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => destino!));
  }

  String _tempoRelativo(String? iso) {
    final ts = DateTime.tryParse(iso ?? '');
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

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: filtros.map((f) {
          final key = f['key']!;
          final isSelected = _filtroSelecionado == key;
          final count = _countTipo(key);

          return Padding(
            padding: const EdgeInsets.only(right: AppSpacing.xs),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () {
                  setState(() {
                    _filtroSelecionado = key;
                  });
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppColors.primary
                        : AppColors.surface(context),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: isSelected
                          ? AppColors.primary
                          : AppColors.border(context),
                      width: 1,
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: AppColors.primary.withOpacity(0.25),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            )
                          ]
                        : null,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        f['label']!,
                        style: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : AppColors.textPrimary(context),
                          fontWeight:
                              isSelected ? FontWeight.w600 : FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                      if (count > 0) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? Colors.white.withOpacity(0.25)
                                : AppColors.primary.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '$count',
                            style: TextStyle(
                              color: isSelected
                                  ? Colors.white
                                  : AppColors.primary,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
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

  Widget _card(dynamic n) {
    final v = _visual(n);
    final nova = _isNova(n);
    final descricao = (n['descricao']?.toString() ?? '').trim();
    final tipo = n['tipo']?.toString() ?? '';
    final navegavel = tipo != 'reserva';

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: nova ? v.cor.withOpacity(0.4) : AppColors.border(context),
          width: nova ? 1.2 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Linha lateral de destaque para novas notificações
              Container(
                width: 4,
                color: nova ? v.cor : Colors.transparent,
              ),
              Expanded(
                child: InkWell(
                  onTap: navegavel ? () => _abrir(n) : null,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        // Ícone com círculo suavizado
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: v.cor.withOpacity(0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(v.icon, color: v.cor, size: 22),
                        ),
                        const SizedBox(width: 14),
                        // Conteúdo
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      n['titulo']?.toString() ?? '',
                                      style: TextStyle(
                                        color: AppColors.textPrimary(context),
                                        fontSize: 14.5,
                                        fontWeight: FontWeight.w600,
                                        height: 1.2,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (nova) ...[
                                    const SizedBox(width: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 2,
                                      ),
                                      decoration: BoxDecoration(
                                        color: v.cor,
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: const Text(
                                        'NOVA',
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 9,
                                          fontWeight: FontWeight.bold,
                                          letterSpacing: 0.5,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              if (descricao.isNotEmpty) ...[
                                const SizedBox(height: 3),
                                Text(
                                  descricao,
                                  style: TextStyle(
                                    color: AppColors.textSecondary(context),
                                    fontSize: 13,
                                    height: 1.25,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  Icon(
                                    PhosphorIcons.clock,
                                    size: 12,
                                    color: AppColors.textTertiary(context),
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    _tempoRelativo(n['timestamp']?.toString()),
                                    style: TextStyle(
                                      color: AppColors.textTertiary(context),
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        if (navegavel) ...[
                          const SizedBox(width: 8),
                          Container(
                            width: 28,
                            height: 28,
                            decoration: BoxDecoration(
                              color: AppColors.bg(context),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              PhosphorIcons.caretRight,
                              size: 14,
                              color: AppColors.textSecondary(context),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
