import 'package:click/controllers/controller_facial.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Lista compacta de acessos faciais de um visitante.
/// Mostra "Entrou" / "Saiu" / "Negado" com data e hora.
/// Usa o endpoint GET /api/facial/acessos/visitante/:id.
class AcessosFacialList extends StatefulWidget {
  final int idVisitante;
  final int limit;

  const AcessosFacialList({
    Key? key,
    required this.idVisitante,
    this.limit = 20,
  }) : super(key: key);

  @override
  State<AcessosFacialList> createState() => _AcessosFacialListState();
}

class _AcessosFacialListState extends State<AcessosFacialList> {
  bool _loading = true;
  List<dynamic> _acessos = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final list = await apiGetAcessosVisitante(widget.idVisitante, limit: widget.limit);
    if (!mounted) return;
    setState(() {
      _acessos = list;
      _loading = false;
    });
  }

  String _formatTs(dynamic ts) {
    if (ts == null) return '';
    final d = DateTime.tryParse(ts.toString());
    if (d == null) return ts.toString();
    final pad = (int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  ({IconData icon, Color color, String label}) _styleForEvento(String evento) {
    switch (evento) {
      case 'entrada':
        return (icon: PhosphorIcons.signIn, color: AppColors.success, label: 'Entrou');
      case 'saida':
        return (icon: PhosphorIcons.signOut, color: AppColors.primary, label: 'Saiu');
      case 'negado':
        return (icon: PhosphorIcons.xCircle, color: Colors.red, label: 'Negado');
      default:
        return (
          icon: PhosphorIcons.scan,
          color: AppColors.textSecondary(context),
          label: evento,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primary,
            ),
          ),
        ),
      );
    }

    if (_acessos.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.textSecondary(context).withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(PhosphorIcons.scan, color: AppColors.textTertiary(context), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Nenhum acesso registrado no terminal facial.',
                style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Row(
            children: [
              Icon(PhosphorIcons.scan, color: AppColors.primary, size: 16),
              const SizedBox(width: 6),
              Text(
                'Histórico no Terminal Facial',
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: _acessos.map((a) {
              final evento = (a['evento'] ?? '').toString();
              final style = _styleForEvento(evento);
              final isLast = a == _acessos.last;
              return Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  border: !isLast
                      ? Border(
                          bottom: BorderSide(
                            color: AppColors.textTertiary(context).withOpacity(0.1),
                          ),
                        )
                      : null,
                ),
                child: Row(
                  children: [
                    Icon(style.icon, color: style.color, size: 18),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            style.label,
                            style: AppTypography.captionMedium(context).copyWith(color: style.color),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            _formatTs(a['timestamp']),
                            style: AppTypography.tiny(context).copyWith(
                              color: AppColors.textSecondary(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (a['confianca'] != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.textSecondary(context).withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '${((a['confianca'] as num) * 100).toStringAsFixed(0)}%',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.textSecondary(context),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                  ],
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}
