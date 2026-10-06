import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Seletor de convidados com botões − e + (48dp) e o valor no centro.
///
/// - [valor] nulo = não informado: mostra "Opcional" e o − fica desabilitado;
///   o + vai para 1.
/// - Mínimo 1: o − no valor 1 volta para nulo.
/// - [capacidade] > 0 limita o máximo (+ desabilitado no limite) e mostra
///   "de N" ao lado do valor; 0 = sem limite.
class ConvidadosStepper extends StatelessWidget {
  /// Chave do botão − (testes).
  static const chaveMenos = Key('convidados-menos');

  /// Chave do botão + (testes).
  static const chaveMais = Key('convidados-mais');

  /// Quantidade atual; nulo = não informado.
  final int? valor;

  /// Capacidade da área; 0 ou menos = sem limite.
  final int capacidade;

  /// Novo valor (nulo quando volta para "Opcional").
  final ValueChanged<int?> onChanged;

  /// Falso bloqueia os dois botões (ex.: salvando).
  final bool habilitado;

  const ConvidadosStepper({
    super.key,
    required this.valor,
    required this.capacidade,
    required this.onChanged,
    this.habilitado = true,
  });

  bool get _podeDiminuir => habilitado && valor != null;
  bool get _podeAumentar => habilitado && (capacidade <= 0 || (valor ?? 0) < capacidade);

  void _diminuir() {
    final v = valor;
    if (v == null) return;
    onChanged(v <= 1 ? null : v - 1);
  }

  void _aumentar() => onChanged((valor ?? 0) + 1);

  @override
  Widget build(BuildContext context) {
    final vazio = valor == null;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        children: [
          _Botao(
            chave: chaveMenos,
            icone: PhosphorIcons.minus,
            tooltip: 'Remover convidado',
            onPressed: _podeDiminuir ? _diminuir : null,
          ),
          Expanded(
            child: Semantics(
              liveRegion: true,
              label: vazio
                  ? 'Convidados: opcional'
                  : 'Convidados: $valor${capacidade > 0 ? ' de $capacidade' : ''}',
              excludeSemantics: true,
              child: Center(
                child: vazio
                    ? Text(
                        'Opcional',
                        style: AppTypography.bodySecondary(context).copyWith(color: AppColors.textTertiary(context)),
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            '$valor',
                            style: AppTypography.title(context).copyWith(fontWeight: FontWeight.w700),
                          ),
                          if (capacidade > 0) ...[
                            const SizedBox(width: 6),
                            Text('de $capacidade', style: AppTypography.caption(context)),
                          ],
                        ],
                      ),
              ),
            ),
          ),
          _Botao(
            chave: chaveMais,
            icone: PhosphorIcons.plus,
            tooltip: 'Adicionar convidado',
            onPressed: _podeAumentar ? _aumentar : null,
          ),
        ],
      ),
    );
  }
}

class _Botao extends StatelessWidget {
  final Key chave;
  final IconData icone;
  final String tooltip;
  final VoidCallback? onPressed;

  const _Botao({required this.chave, required this.icone, required this.tooltip, this.onPressed});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return IconButton(
      key: chave,
      onPressed: onPressed,
      tooltip: tooltip,
      icon: Icon(icone, size: 20),
      style: IconButton.styleFrom(
        minimumSize: const Size(48, 48),
        fixedSize: const Size(48, 48),
        backgroundColor: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
        foregroundColor: isDark ? const Color(0xFF93B4F8) : AppColors.primary,
        disabledBackgroundColor: AppColors.surface(context),
        disabledForegroundColor: AppColors.textTertiary(context),
        shape: RoundedRectangleBorder(borderRadius: AppRadius.rmd),
      ),
    );
  }
}
