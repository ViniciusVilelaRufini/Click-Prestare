import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Linha de lista no desenho dos eventos da portaria web: uma faixa em
/// degradê na cor do item a partir da borda esquerda, algo por cima dela
/// (foto, inicial ou ícone), o selo "● TIPO" e o texto. Usada por "Meus
/// eventos", "Eventos de Acesso" e Notificações, para as telas não divergirem.
class LinhaFaixa extends StatelessWidget {
  final Color tom;

  /// Cor do texto do selo, quando o [tom] não serve como texto (ex.: o
  /// amarelo da marca no tema claro).
  final Color? corSelo;
  final String selo;
  final String titulo;

  /// Linhas embaixo do título: a primeira em cinza médio, as outras mais
  /// claras. Vazias são ignoradas.
  final List<String> linhas;

  /// Conteúdo dos 104px da esquerda, sobre a faixa.
  final Widget esquerda;

  /// Marca discreta "NOVA" ao lado do selo.
  final bool nova;

  /// Sem toque não mostra a seta.
  final VoidCallback? onTap;

  const LinhaFaixa({
    super.key,
    required this.tom,
    required this.selo,
    required this.titulo,
    required this.esquerda,
    this.corSelo,
    this.linhas = const [],
    this.nova = false,
    this.onTap,
  });

  static const double largEsquerda = 104;
  static const double inicioTexto = 88;

  @override
  Widget build(BuildContext context) {
    // No claro o tom é mais leve para não sujar o cinza do cartão.
    final escuro = Theme.of(context).brightness == Brightness.dark;
    final forte = escuro ? 0.26 : 0.16;
    final medio = escuro ? 0.10 : 0.06;
    final linhasVisiveis = linhas.where((l) => l.trim().isNotEmpty).toList();
    final textoSelo = corSelo ?? tom;

    final corpo = Stack(
      children: [
        Positioned.fill(
          child: DecoratedBox(
            key: const ValueKey('evento-faixa'),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  tom.withValues(alpha: forte),
                  tom.withValues(alpha: medio),
                  tom.withValues(alpha: 0),
                ],
                stops: const [0, 0.35, 0.75],
              ),
            ),
          ),
        ),
        Positioned(left: 0, top: 0, bottom: 0, width: largEsquerda, child: esquerda),
        Padding(
          padding: const EdgeInsets.fromLTRB(inicioTexto, 12, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(color: tom, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            selo.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.label(context).copyWith(
                              color: textoSelo,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 11 * 0.14,
                            ),
                          ),
                        ),
                        if (nova) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              border: Border.all(color: textoSelo.withValues(alpha: 0.6)),
                            ),
                            child: Text(
                              'NOVA',
                              style: AppTypography.label(context).copyWith(
                                color: textoSelo,
                                fontSize: 9,
                                letterSpacing: 9 * 0.14,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      titulo,
                      style: AppTypography.bodyMedium(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    for (var i = 0; i < linhasVisiveis.length; i++) ...[
                      SizedBox(height: i == 0 ? 2 : 1),
                      Text(
                        linhasVisiveis[i],
                        style: AppTypography.tiny(context).copyWith(
                          color: i == 0
                              ? AppColors.textSecondary(context)
                              : AppColors.textTertiary(context),
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null) ...[
                const SizedBox(width: 8),
                Icon(PhosphorIcons.caretRight, color: AppColors.textTertiary(context), size: 16),
              ],
            ],
          ),
        ),
      ],
    );

    return Material(
      color: AppColors.surface(context),
      child: onTap == null ? corpo : InkWell(onTap: onTap, child: corpo),
    );
  }
}
