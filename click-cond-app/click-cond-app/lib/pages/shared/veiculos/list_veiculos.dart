import 'package:click/controllers/controller_veiculos.dart';
import 'package:click/controllers/controller_vagas.dart';
import 'package:click/models/veiculo_model.dart';
import 'package:click/models/vaga_model.dart';
import 'package:click/pages/shared/veiculos/new_veiculo.dart';
import 'package:click/pages/shared/veiculos/list_vagas.dart';
import 'package:click/pages/shared/veiculos/liberar_vaga_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Aba selecionada na tela combinada de Veículos/Vagas.
enum _VeiculosTab { veiculos, vagas }

/// Tela unificada "Meus Veículos" + "Minhas Vagas", com um toggle no topo
/// (mesmo padrão da tela de Financeiro: Meu Financeiro / Condomínio).
class ListVeiculos extends StatefulWidget {
  const ListVeiculos({Key? key}) : super(key: key);

  @override
  State<ListVeiculos> createState() => _ListVeiculosState();
}

class _ListVeiculosState extends State<ListVeiculos> {
  _VeiculosTab _tab = _VeiculosTab.veiculos;

  // Veículos
  List<VeiculoModel> _veiculos = [];
  bool _loadingVeiculos = false;

  // Vagas
  VagasResumo _resumoVagas = VagasResumo.empty();
  bool _loadingVagas = false;
  bool _loadedVagas = false;

  @override
  void initState() {
    super.initState();
    _loadVeiculos();
    _loadVagas();
  }

  Future<void> _loadVeiculos() async {
    // Stale-while-revalidate: skeleton só sem cache; ao voltar, mantém a lista.
    if (_veiculos.isEmpty) setState(() => _loadingVeiculos = true);
    try {
      final raw = await apiGetAllVeiculos();
      _veiculos = (raw as List).map((e) => VeiculoModel.fromJson(e)).toList();
    } catch (_) {
      _veiculos = [];
    } finally {
      if (mounted) setState(() => _loadingVeiculos = false);
    }
  }

  Future<void> _loadVagas() async {
    if (!_loadedVagas) setState(() => _loadingVagas = true);
    try {
      _resumoVagas = await apiGetVagas();
      _loadedVagas = true;
    } catch (_) {
      _resumoVagas = VagasResumo.empty();
    } finally {
      if (mounted) setState(() => _loadingVagas = false);
    }
  }

  // ---- Veículos ----
  void _abrirFormVeiculo({VeiculoModel? veiculo}) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NewVeiculo(veiculo: veiculo)),
    ).then((_) => _loadVeiculos());
  }

  Future<void> _removerVeiculo(VeiculoModel v) async {
    final ok = await showConfirmDialog(
      context,
      text: 'O veículo ${v.placa} será removido.',
    );
    if (ok != true) return;
    final success = await apiRemoverVeiculo(v.id!);
    if (!mounted) return;
    if (success) {
      _loadVeiculos();
    } else {
      displayMessage(context, 'Erro', 'Não foi possível remover o veículo.');
    }
  }

  // ---- Vagas ----
  void _abrirLiberarVaga() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const LiberarVagaPage()),
    ).then((ok) {
      if (ok == true) _loadVagas();
    });
  }

  Future<void> _revogarVaga(VagaModel v) async {
    final ok = await showConfirmDialog(
      context,
      text: 'A vaga de ${v.ocupanteNome ?? 'beneficiário'} será liberada de volta.',
    );
    if (ok != true) return;
    final success = await apiRevogarVaga(v.id!);
    if (!mounted) return;
    if (success) {
      _loadVagas();
    } else {
      displayMessage(context, 'Erro', 'Não foi possível revogar a vaga.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isVeiculos = _tab == _VeiculosTab.veiculos;
    return AppScaffold(
      title: 'Meus Veículos',
      floatingActionButton: isVeiculos
          ? FloatingActionButton(
              onPressed: () => _abrirFormVeiculo(),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.plus, color: Colors.white),
            )
          : (_resumoVagas.livres > 0
              ? FloatingActionButton.extended(
                  onPressed: _abrirLiberarVaga,
                  backgroundColor: AppColors.primary,
                  icon: const Icon(PhosphorIcons.key, color: Colors.white),
                  label: Text('Liberar vaga',
                      style: AppTypography.button(context).copyWith(color: Colors.white)),
                )
              : null),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 0),
            child: _buildViewToggle(),
          ),
          Expanded(
            child: isVeiculos ? _buildVeiculosBody() : _buildVagasBody(),
          ),
        ],
      ),
    );
  }

  Widget _buildViewToggle() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          _ToggleItem(
            label: 'MEUS VEÍCULOS',
            isSelected: _tab == _VeiculosTab.veiculos,
            onTap: () => setState(() => _tab = _VeiculosTab.veiculos),
          ),
          _ToggleItem(
            label: 'MINHAS VAGAS',
            isSelected: _tab == _VeiculosTab.vagas,
            onTap: () => setState(() => _tab = _VeiculosTab.vagas),
          ),
        ],
      ),
    );
  }

  Widget _buildVeiculosBody() {
    if (_loadingVeiculos) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: 4,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, __) => AppSkeleton.listTile(context),
      );
    }
    if (_veiculos.isEmpty) return _emptyVeiculos(context);
    return RefreshIndicator(
      onRefresh: _loadVeiculos,
      child: ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: _veiculos.length,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, i) => _VeiculoCard(
          veiculo: _veiculos[i],
          onTap: () => _abrirFormVeiculo(veiculo: _veiculos[i]),
          onRemove: () => _removerVeiculo(_veiculos[i]),
        ),
      ),
    );
  }

  Widget _buildVagasBody() {
    if (_loadingVagas) {
      return ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: 4,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (_, __) => AppSkeleton.listTile(context),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadVagas,
      child: VagasBody(
        resumo: _resumoVagas,
        onLiberar: _abrirLiberarVaga,
        onRevogar: _revogarVaga,
      ),
    );
  }

  Widget _emptyVeiculos(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(PhosphorIcons.car, size: 56, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text('Nenhum veículo cadastrado',
              style: AppTypography.bodyMedium(context)),
          const SizedBox(height: 4),
          Text('Toque em + para adicionar o seu carro',
              style: AppTypography.caption(context)),
        ],
      ),
    );
  }
}

/// Item do toggle superior (mesmo estilo da tela de Financeiro).
class _ToggleItem extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _ToggleItem({required this.label, required this.isSelected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                        color: AppColors.primary.withOpacity(0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 4))
                  ]
                : null,
          ),
          child: Center(
            child: Text(
              label,
              style: AppTypography.tiny(context).copyWith(
                color: isSelected ? Colors.white : AppColors.textSecondary(context),
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _VeiculoCard extends StatelessWidget {
  final VeiculoModel veiculo;
  final VoidCallback onTap;
  final VoidCallback onRemove;
  const _VeiculoCard({required this.veiculo, required this.onTap, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
                color: AppColors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(PhosphorIcons.car, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    veiculo.placa ?? '',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold, letterSpacing: 1.5),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [veiculo.cor, veiculo.marcaModelo]
                        .where((e) => e != null && e.isNotEmpty)
                        .join(' · '),
                    style: AppTypography.caption(context),
                  ),
                  if (veiculo.tagCodigo != null && veiculo.tagCodigo!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text('Tag: ${veiculo.tagCodigo}',
                          style: AppTypography.tiny(context)
                              .copyWith(color: AppColors.primary)),
                    ),
                  ],
                ],
              ),
            ),
            IconButton(
              icon: Icon(PhosphorIcons.trash, size: 18, color: AppColors.textTertiary(context)),
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}
