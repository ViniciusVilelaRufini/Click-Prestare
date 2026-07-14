import 'package:click/controllers/controller_veiculos.dart';
import 'package:click/models/veiculo_model.dart';
import 'package:click/pages/shared/veiculos/new_veiculo.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ListVeiculos extends StatefulWidget {
  const ListVeiculos({Key? key}) : super(key: key);

  @override
  State<ListVeiculos> createState() => _ListVeiculosState();
}

class _ListVeiculosState extends State<ListVeiculos> {
  List<VeiculoModel> _list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  Future<void> _loadList() async {
    setState(() => _isLoading = true);
    try {
      final raw = await apiGetAllVeiculos();
      _list = (raw as List).map((e) => VeiculoModel.fromJson(e)).toList();
    } catch (_) {
      _list = [];
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _abrirForm({VeiculoModel? veiculo}) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NewVeiculo(veiculo: veiculo)),
    ).then((_) => _loadList());
  }

  Future<void> _remover(VeiculoModel v) async {
    final ok = await showConfirmDialog(
      context,
      text: 'O veículo ${v.placa} será removido.',
    );
    if (ok != true) return;
    final success = await apiRemoverVeiculo(v.id!);
    if (!mounted) return;
    if (success) {
      _loadList();
    } else {
      displayMessage(context, 'Erro', 'Não foi possível remover o veículo.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Meus Veículos',
      floatingActionButton: FloatingActionButton(
        onPressed: () => _abrirForm(),
        backgroundColor: AppColors.primary,
        child: const Icon(PhosphorIcons.plus, color: Colors.white),
      ),
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 4,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : _list.isEmpty
              ? _empty(context)
              : RefreshIndicator(
                  onRefresh: _loadList,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: _list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (_, i) => _VeiculoCard(
                      veiculo: _list[i],
                      onTap: () => _abrirForm(veiculo: _list[i]),
                      onRemove: () => _remover(_list[i]),
                    ),
                  ),
                ),
    );
  }

  Widget _empty(BuildContext context) {
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
