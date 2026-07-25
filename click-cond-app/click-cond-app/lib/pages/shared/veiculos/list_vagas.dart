import 'package:click/controllers/controller_vagas.dart';
import 'package:click/models/vaga_model.dart';
import 'package:click/pages/shared/veiculos/liberar_vaga_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListVagas extends StatefulWidget {
  const ListVagas({Key? key}) : super(key: key);

  @override
  State<ListVagas> createState() => _ListVagasState();
}

class _ListVagasState extends State<ListVagas> {
  VagasResumo _resumo = VagasResumo.empty();
  bool _isLoading = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Stale-while-revalidate: skeleton só no 1º load; ao voltar, mantém o cache.
    if (!_loaded) setState(() => _isLoading = true);
    try {
      _resumo = await apiGetVagas();
      _loaded = true;
    } catch (_) {
      _resumo = VagasResumo.empty();
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _abrirLiberar() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const LiberarVagaPage()),
    ).then((ok) {
      if (ok == true) _load();
    });
  }

  Future<void> _revogar(VagaModel v) async {
    final ok = await showConfirmDialog(
      context,
      text: 'A vaga de ${v.ocupanteNome ?? 'beneficiário'} será liberada de volta.',
    );
    if (ok != true) return;
    final success = await apiRevogarVaga(v.id!);
    if (!mounted) return;
    if (success) {
      _load();
    } else {
      displayMessage(context, 'Erro', 'Não foi possível revogar a vaga.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Minhas Vagas',
      floatingActionButton: (_resumo.livres > 0)
          ? FloatingActionButton.extended(
              onPressed: _abrirLiberar,
              backgroundColor: AppColors.primary,
              icon: const Icon(PhosphorIcons.key, color: Colors.white),
              label: Text('Liberar vaga',
                  style: AppTypography.button(context).copyWith(color: Colors.white)),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 4,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: VagasBody(
                resumo: _resumo,
                onLiberar: _abrirLiberar,
                onRevogar: _revogar,
              ),
            ),
    );
  }
}

/// Corpo reutilizável da aba "Minhas Vagas" (header + cards + vagas livres),
/// sem Scaffold, para ser embutido na tela combinada de Veículos/Vagas.
class VagasBody extends StatelessWidget {
  final VagasResumo resumo;
  final VoidCallback onLiberar;
  final void Function(VagaModel vaga) onRevogar;
  const VagasBody({
    Key? key,
    required this.resumo,
    required this.onLiberar,
    required this.onRevogar,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        _header(context),
        const SizedBox(height: AppSpacing.lg),
        if (resumo.qtdVagas == 0)
          _empty(context)
        else ...[
          ...resumo.vagas.map((v) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: VagaCard(vaga: v, onRevogar: () => onRevogar(v)),
              )),
          // Vagas livres (representadas como slots vazios).
          ...List.generate(
              resumo.livres,
              (_) => Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: VagaLivreCard(onTap: onLiberar),
                  )),
        ],
      ],
    );
  }

  Widget _header(BuildContext context) {
    final total = resumo.qtdVagas;
    final ocup = resumo.ocupadas;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.primary.withOpacity(0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primary.withOpacity(0.15)),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(PhosphorIcons.carSimple, color: AppColors.primary, size: 26),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$ocup de $total ${total == 1 ? 'vaga ocupada' : 'vagas ocupadas'}',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 2),
                Text(
                    resumo.livres > 0
                        ? '${resumo.livres} ${resumo.livres == 1 ? 'vaga livre' : 'vagas livres'} para liberar'
                        : 'Todas as vagas estão ocupadas',
                    style: AppTypography.caption(context)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
      alignment: Alignment.center,
      child: Column(
        children: [
          Icon(PhosphorIcons.carSimple, size: 48, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text('Nenhuma vaga cadastrada', style: AppTypography.bodyMedium(context)),
          const SizedBox(height: 4),
          Text('A quantidade de vagas é definida pela administração do condomínio.',
              textAlign: TextAlign.center, style: AppTypography.caption(context)),
        ],
      ),
    );
  }
}

class VagaCard extends StatelessWidget {
  final VagaModel vaga;
  final VoidCallback onRevogar;
  const VagaCard({Key? key, required this.vaga, required this.onRevogar}) : super(key: key);

  ({IconData icon, Color color, String label}) get _tag {
    if (vaga.isVisitante) {
      return (icon: PhosphorIcons.userCircle, color: Colors.orange, label: 'Visitante');
    }
    if (vaga.isInquilino) {
      return (icon: PhosphorIcons.house, color: Colors.blue, label: 'Inquilino');
    }
    return (icon: PhosphorIcons.car, color: AppColors.primary, label: 'Meu veículo');
  }

  String? get _periodo {
    if (vaga.inicio == null && vaga.fim == null) return null;
    String f(DateTime? d) => d == null
        ? '—'
        : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
    return '${f(vaga.inicio)} – ${f(vaga.fim)}';
  }

  @override
  Widget build(BuildContext context) {
    final t = _tag;
    final canRevogar = vaga.isVisitante || vaga.isInquilino;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: t.color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(t.icon, color: t.color, size: 22),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  vaga.ocupanteNome?.isNotEmpty == true ? vaga.ocupanteNome! : t.label,
                  style: AppTypography.bodyMedium(context)
                      .copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: t.color.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(t.label,
                          style: AppTypography.tiny(context).copyWith(color: t.color)),
                    ),
                    if (vaga.placa != null && vaga.placa!.isNotEmpty) ...[
                      const SizedBox(width: 6),
                      Text(vaga.placa!,
                          style: AppTypography.caption(context)
                              .copyWith(letterSpacing: 1.2)),
                    ],
                  ],
                ),
                if (_periodo != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(PhosphorIcons.calendarBlank,
                          size: 12, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Text(_periodo!, style: AppTypography.tiny(context)),
                    ],
                  ),
                ],
              ],
            ),
          ),
          if (canRevogar)
            IconButton(
              icon: Icon(PhosphorIcons.x, size: 18, color: AppColors.textTertiary(context)),
              tooltip: 'Revogar',
              onPressed: onRevogar,
            ),
        ],
      ),
    );
  }
}

class VagaLivreCard extends StatelessWidget {
  final VoidCallback onTap;
  const VagaLivreCard({Key? key, required this.onTap}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: DottedBorderBox(
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.textTertiary(context).withOpacity(0.08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(PhosphorIcons.plus,
                  color: AppColors.textTertiary(context), size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Vaga livre',
                      style: AppTypography.bodyMedium(context)
                          .copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text('Toque para liberar a um visitante ou inquilino',
                      style: AppTypography.caption(context)),
                ],
              ),
            ),
            Icon(PhosphorIcons.caretRight,
                size: 18, color: AppColors.textTertiary(context)),
          ],
        ),
      ),
    );
  }
}

/// Caixa com borda tracejada simples (sem dependência externa).
class DottedBorderBox extends StatelessWidget {
  final Widget child;
  const DottedBorderBox({Key? key, required this.child}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context).withOpacity(0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.border(context),
          width: 1.2,
        ),
      ),
      child: child,
    );
  }
}
