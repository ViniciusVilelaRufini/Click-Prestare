import 'package:click/controllers/controller_condominio.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Histórico completo de entradas/saídas do morador e de seus
/// visitantes/prestadores. Aberto a partir da home (MEUS EVENTOS) ou de uma
/// notificação de acesso — nesse caso [destacarId] identifica o evento que
/// disparou o toque, para o usuário achar exatamente o que veio ver.
class HistoricoAcessosPage extends StatefulWidget {
  final int? destacarId;
  const HistoricoAcessosPage({Key? key, this.destacarId}) : super(key: key);

  @override
  State<HistoricoAcessosPage> createState() => _HistoricoAcessosPageState();
}

class _HistoricoAcessosPageState extends State<HistoricoAcessosPage> {
  List<dynamic> _eventos = [];
  bool _isLoading = true;
  final Map<int, GlobalKey> _keys = {};

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    final lista = await getMeusEventos(limit: 50);
    if (!mounted) return;
    setState(() {
      _eventos = lista is List ? lista : [];
      _isLoading = false;
    });
    if (widget.destacarId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _rolarAteDestacado());
    }
  }

  void _rolarAteDestacado() {
    final key = _keys[widget.destacarId];
    final ctx = key?.currentContext;
    if (ctx == null) return;
    Scrollable.ensureVisible(ctx,
        duration: const Duration(milliseconds: 400), alignment: 0.3);
  }

  String _formatDataHora(dynamic ts) {
    final d = DateTime.tryParse(ts?.toString() ?? '');
    if (d == null) return '';
    final pad = (int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Histórico de Acessos',
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
              child: _eventos.isEmpty
                  ? _vazio()
                  : ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: _eventos.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, i) => _eventoCard(_eventos[i]),
                    ),
            ),
    );
  }

  Widget _vazio() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.22),
        Icon(PhosphorIcons.signIn,
            size: 56, color: AppColors.textTertiary(context)),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Nenhum acesso registrado',
          textAlign: TextAlign.center,
          style: AppTypography.bodyMedium(context)
              .copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: AppSpacing.xs),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
          child: Text(
            'Suas entradas e saídas e as de visitantes/prestadores aparecem aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context),
          ),
        ),
      ],
    );
  }

  Widget _eventoCard(dynamic e) {
    final id = int.tryParse(e['id']?.toString() ?? '');
    final destacado = id != null && id == widget.destacarId;
    final key = id != null ? (_keys[id] ??= GlobalKey()) : null;

    final isEntrada = (e['evento'] ?? '').toString() == 'entrada';
    final isVoce = (e['categoria'] ?? '').toString() == 'voce';
    final tipoPessoa = (e['tipo_pessoa'] ?? '').toString();
    final nome = (e['nome'] ?? '').toString();
    final condominio = (e['condominio'] ?? '').toString();

    final Color cor = isEntrada ? AppColors.success : AppColors.primary;
    final IconData icon = isEntrada ? PhosphorIcons.signIn : PhosphorIcons.signOut;
    final String tag =
        isVoce ? 'Você' : (tipoPessoa == 'prestador' ? 'Prestador' : 'Visitante');
    final Color tagColor = isVoce ? AppColors.primary : Colors.orange;

    return Container(
      key: key,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: destacado ? cor.withOpacity(0.08) : AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: destacado
            ? Border.all(color: cor.withOpacity(0.4))
            : Border.all(color: Colors.transparent),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: cor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(icon, color: cor, size: 20),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      isEntrada ? 'Entrou' : 'Saiu',
                      style: AppTypography.bodyMedium(context)
                          .copyWith(color: cor, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        nome.isNotEmpty ? nome : (isVoce ? 'Você' : 'Visitante'),
                        style: AppTypography.caption(context)
                            .copyWith(color: AppColors.textSecondary(context)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
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
                const SizedBox(height: 2),
                Text(
                  _formatDataHora(e['timestamp']),
                  style: AppTypography.tiny(context)
                      .copyWith(color: AppColors.textTertiary(context)),
                ),
                if (condominio.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    condominio,
                    style: AppTypography.tiny(context)
                        .copyWith(color: AppColors.textTertiary(context)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
