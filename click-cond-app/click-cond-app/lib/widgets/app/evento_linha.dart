import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Linha de evento de acesso no desenho da portaria web (`.ps-ev`, versão
/// estreita): foto ou inicial dissolvendo à esquerda, uma faixa da cor do
/// evento passando por trás, selo "● ENTRADA/SAÍDA" e o nome com hora e tipo.
class EventoLinha extends StatelessWidget {
  final String nome;
  final bool entrada;
  final String tipo;
  final String hora;
  final String? foto;
  final VoidCallback onTap;

  const EventoLinha({
    super.key,
    required this.nome,
    required this.entrada,
    required this.tipo,
    required this.hora,
    required this.onTap,
    this.foto,
  });

  static const double _largFoto = 104;
  static const double _inicioTexto = 88;

  @override
  Widget build(BuildContext context) {
    // Entrada em verde; saída no cinza do texto, como na web.
    final tom = entrada ? AppColors.success : AppColors.textTertiary(context);
    final inicial = nome.trim().isEmpty ? '?' : nome.trim()[0].toUpperCase();

    final semFoto = Container(
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.only(left: 22),
      color: Color.alphaBlend(tom.withValues(alpha: 0.18), AppColors.surfaceElevated(context)),
      child: Text(
        inicial,
        style: AppTypography.title(context).copyWith(color: tom, fontSize: 26),
      ),
    );

    return Material(
      color: AppColors.surface(context),
      child: InkWell(
        onTap: onTap,
        child: Stack(
          children: [
            // Faixa da cor do evento, mais forte logo depois da foto.
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      tom.withValues(alpha: 0),
                      tom.withValues(alpha: 0.22),
                      tom.withValues(alpha: 0.07),
                      tom.withValues(alpha: 0),
                    ],
                    stops: const [0.18, 0.34, 0.6, 0.85],
                  ),
                ),
              ),
            ),
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: _largFoto,
              child: ShaderMask(
                blendMode: BlendMode.dstIn,
                shaderCallback: (r) => const LinearGradient(
                  colors: [Colors.white, Colors.white, Colors.transparent],
                  stops: [0, 0.3, 1],
                ).createShader(r),
                child: foto == null
                    ? semFoto
                    : Image.network(
                        foto!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => semFoto,
                      ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(_inicioTexto, 12, 16, 12),
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
                            Text(
                              entrada ? 'ENTRADA' : 'SAÍDA',
                              style: AppTypography.label(context).copyWith(
                                color: tom,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 11 * 0.14,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          nome,
                          style: AppTypography.bodyMedium(context),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$hora · $tipo',
                          style: AppTypography.tiny(context)
                              .copyWith(color: AppColors.textSecondary(context)),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(PhosphorIcons.caretRight, color: AppColors.textTertiary(context), size: 16),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
