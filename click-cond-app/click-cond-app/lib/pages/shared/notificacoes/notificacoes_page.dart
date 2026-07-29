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

  @override
  void initState() {
    super.initState();
    // Guarda o marcador ANTES de atualizar: é o que decide quais itens ainda
    // aparecem como novos nesta abertura.
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

  ({IconData icon, Color cor}) _visual(String tipo) {
    switch (tipo) {
      case 'encomenda':
        return (icon: PhosphorIcons.package, cor: AppColors.primary);
      case 'comunicado':
        return (icon: PhosphorIcons.megaphone, cor: Colors.orange);
      case 'ocorrencia':
        return (icon: PhosphorIcons.warningCircle, cor: Colors.redAccent);
      case 'financeiro':
        return (icon: PhosphorIcons.currencyCircleDollar, cor: Colors.green);
      case 'reserva':
        return (icon: PhosphorIcons.calendarCheck, cor: Colors.purple);
      case 'acesso':
        return (icon: PhosphorIcons.signIn, cor: Colors.teal);
      default:
        return (icon: PhosphorIcons.bell, cor: AppColors.primary);
    }
  }

  /// Extrai o id numérico do item a partir do id composto que a API monta
  /// (ex.: "encomenda-123" -> 123).
  int? _idNumerico(dynamic n) {
    final raw = n['id']?.toString() ?? '';
    final partes = raw.split('-');
    if (partes.length < 2) return null;
    return int.tryParse(partes.last);
  }

  /// Leva direto para o item específico que gerou o aviso, não só para a
  /// tela em geral.
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
    if (diff.inMinutes < 60) return '${diff.inMinutes} min';
    if (diff.inHours < 24) return '${diff.inHours} h';
    if (diff.inDays == 1) return 'ontem';
    if (diff.inDays < 7) return '${diff.inDays} dias';
    return '${ts.day.toString().padLeft(2, '0')}/${ts.month.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Notificações',
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _carregar,
              child: _itens.isEmpty
                  ? _vazio()
                  : ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: _itens.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, i) => _card(_itens[i]),
                    ),
            ),
    );
  }

  Widget _vazio() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.22),
        Icon(PhosphorIcons.bellSlash,
            size: 56, color: AppColors.textTertiary(context)),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Nenhuma notificação por aqui',
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
    final tipo = n['tipo']?.toString() ?? '';
    final v = _visual(tipo);
    final nova = _isNova(n);
    final descricao = (n['descricao']?.toString() ?? '').trim();
    // Reservas ainda não têm uma tela de detalhe por id — a única navegável
    // por enquanto que fica de fora.
    final navegavel = tipo != 'reserva';

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: navegavel ? () => _abrir(n) : null,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: nova
              ? v.cor.withOpacity(0.06)
              : AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: nova ? v.cor.withOpacity(0.25) : AppColors.border(context),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: v.cor.withOpacity(0.12),
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Icon(v.icon, color: v.cor, size: 22),
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
                          n['titulo']?.toString() ?? '',
                          style: AppTypography.bodyMedium(context)
                              .copyWith(fontWeight: FontWeight.w600),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (nova) ...[
                        const SizedBox(width: 6),
                        Container(
                          width: 8,
                          height: 8,
                          decoration:
                              BoxDecoration(color: v.cor, shape: BoxShape.circle),
                        ),
                      ],
                    ],
                  ),
                  if (descricao.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      descricao,
                      style: AppTypography.caption(context),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 6),
                  Text(
                    _tempoRelativo(n['timestamp']?.toString()),
                    style: AppTypography.tiny(context),
                  ),
                ],
              ),
            ),
            if (navegavel)
              Padding(
                padding: const EdgeInsets.only(left: 4, top: 4),
                child: Icon(PhosphorIcons.caretRight,
                    size: 16, color: AppColors.textTertiary(context)),
              ),
          ],
        ),
      ),
    );
  }
}
