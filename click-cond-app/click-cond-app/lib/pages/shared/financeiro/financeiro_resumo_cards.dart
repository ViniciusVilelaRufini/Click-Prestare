import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class FinanceiroResumoCards extends StatelessWidget {
  final String receita;
  final String despesa;
  final String saldo;
  final String? percentualReceita;
  final String? percentualDespesa;

  const FinanceiroResumoCards({
    super.key,
    required this.receita,
    required this.despesa,
    required this.saldo,
    this.percentualReceita,
    this.percentualDespesa,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(color: AppColors.primary.withValues(alpha: 0.22), blurRadius: 18, offset: const Offset(0, 8)),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(PhosphorIcons.chartLineUp, color: Colors.white, size: 18),
                const SizedBox(width: AppSpacing.sm),
                Text('Saldo do período', style: AppTypography.captionMedium(context).copyWith(color: Colors.white.withValues(alpha: .82))),
              ]),
              const SizedBox(height: AppSpacing.sm),
              Text(saldo, style: AppTypography.headline(context).copyWith(color: Colors.white, fontSize: 27, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Row(children: [
          Expanded(child: _ValorCard(titulo: 'Receitas', valor: receita, percentual: percentualReceita, icone: PhosphorIcons.trendUp, cor: const Color(0xFF16A34A))),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: _ValorCard(titulo: 'Despesas', valor: despesa, percentual: percentualDespesa, icone: PhosphorIcons.trendDown, cor: AppColors.error)),
        ]),
      ],
    );
  }
}

class _ValorCard extends StatelessWidget {
  final String titulo;
  final String valor;
  final String? percentual;
  final IconData icone;
  final Color cor;

  const _ValorCard({required this.titulo, required this.valor, required this.percentual, required this.icone, required this.cor});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(AppSpacing.md),
    decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16), border: Border.all(color: cor.withValues(alpha: .14))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icone, size: 18, color: cor),
      const SizedBox(height: AppSpacing.sm),
      Text(titulo, style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
      const SizedBox(height: 2),
      Text(valor, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppTypography.captionMedium(context).copyWith(color: cor)),
      if (percentual != null && percentual!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(percentual!, style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)))),
    ]),
  );
}
