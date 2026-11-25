import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Valor monetário de destaque do Prestare Dark: prefixo da moeda pequeno
/// (estilo rótulo) e o número grande, leve, com algarismos tabulares.
///
/// Usado nos saldos "herói" (Meu financeiro e Financeiro do condomínio) para
/// que o dinheiro tenha a mesma cara em todas as telas.
class ValorDestaque extends StatelessWidget {
  /// Símbolo da moeda, ex.: `R$`.
  final String moeda;

  /// Número já formatado e sem sinal, ex.: `1.250,75`.
  final String valor;

  /// Negativo mostra o sinal de menos e usa a cor de erro.
  final bool negativo;

  const ValorDestaque({
    super.key,
    required this.moeda,
    required this.valor,
    this.negativo = false,
  });

  /// Separa um texto como `- R$ 1.250,75` ou `R$ 0,00` em partes.
  /// Zero nunca é negativo.
  factory ValorDestaque.doTexto(String texto, {Key? key}) {
    var s = texto.replaceAll('BRL', 'R\$').trim();
    var neg = false;
    if (s.startsWith('-') || s.startsWith('−')) {
      neg = true;
      s = s.substring(1).trim();
    }
    var moeda = 'R\$';
    if (s.startsWith('R\$')) {
      s = s.substring(2).trim();
    }
    if (s.isEmpty) s = '0,00';
    if (neg && !RegExp(r'[1-9]').hasMatch(s)) neg = false;
    return ValorDestaque(key: key, moeda: moeda, valor: s, negativo: neg);
  }

  @override
  Widget build(BuildContext context) {
    final cor = negativo ? AppColors.error : AppColors.textPrimary(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text(moeda, style: AppTypography.label(context)),
        const SizedBox(width: 8),
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              negativo ? '-$valor' : valor,
              style: AppTypography.display(context).copyWith(
                fontWeight: FontWeight.w300,
                fontSize: 48,
                height: 1,
                color: cor,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
