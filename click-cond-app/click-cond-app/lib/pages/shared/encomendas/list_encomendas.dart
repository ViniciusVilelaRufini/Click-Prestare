import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/models/encomenda_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:intl/intl.dart';

class ListEncomendas extends StatefulWidget {
  const ListEncomendas({Key? key}) : super(key: key);

  @override
  _ListEncomendasState createState() => _ListEncomendasState();
}

class _ListEncomendasState extends State<ListEncomendas> {
  bool _isLoading = false;
  List<EncomendaModel> _encomendas = [];

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  Future<void> _loadList() async {
    setState(() => _isLoading = true);
    try {
      final List<dynamic> result = await apiGetAllEncomendas();
      if (mounted) {
        setState(() {
          _encomendas = result.map((e) => EncomendaModel.fromJson(e)).toList();
        });
      }
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'), 'Erro ao carregar encomendas');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Minhas Encomendas',
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.lg),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              onRefresh: _loadList,
              child: _encomendas.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: _encomendas.length,
                      itemBuilder: (context, index) {
                        return _EncomendaCard(encomenda: _encomendas[index]);
                      },
                    ),
            ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(PhosphorIcons.package, size: 64, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Nenhuma encomenda encontrada',
            style: AppTypography.bodyMedium(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }
}

class _EncomendaCard extends StatelessWidget {
  final EncomendaModel encomenda;

  const _EncomendaCard({required this.encomenda});

  @override
  Widget build(BuildContext context) {
    final isRetirado = encomenda.status?.toLowerCase() == 'retirado';
    final statusColor = isRetirado ? Colors.green : Colors.orange;
    
    String dataFormatada = '';
    if (encomenda.recebidoEm != null) {
      try {
        DateTime dt = DateTime.parse(encomenda.recebidoEm!);
        dataFormatada = DateFormat('dd/MM/yyyy HH:mm').format(dt);
      } catch (_) {
        dataFormatada = encomenda.recebidoEm!;
      }
    }

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(PhosphorIcons.package, color: AppColors.primary, size: 28),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (encomenda.condominioNome != null && encomenda.condominioNome!.isNotEmpty) ...[
                  Text(
                    encomenda.condominioNome!.toUpperCase(),
                    style: AppTypography.tiny(context).copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 2),
                ],
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        encomenda.descricao ?? 'Encomenda sem descrição',
                        style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                        maxLines: 1, overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (encomenda.destinatarioApto != null)
                      Text(
                        '${encomenda.destinatarioBloco ?? ''} - ${encomenda.destinatarioApto}',
                        style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Recebido de: ${encomenda.recebidoDe ?? "N/A"}',
                  style: AppTypography.caption(context),
                ),
                Text(
                  'Em: $dataFormatada',
                  style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
                ),
                if (isRetirado && encomenda.retiradoPor != null)
                   Padding(
                     padding: const EdgeInsets.only(top: 4),
                     child: Text(
                      'Retirado por: ${encomenda.retiradoPor}',
                      style: AppTypography.caption(context).copyWith(color: Colors.green),
                                       ),
                   ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: statusColor.withOpacity(0.3)),
            ),
            child: Text(
              encomenda.status?.toUpperCase() ?? 'PENDENTE',
              style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }
}
