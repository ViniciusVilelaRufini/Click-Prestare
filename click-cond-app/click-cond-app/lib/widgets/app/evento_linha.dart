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

    // Uma faixa só, já colorida na borda esquerda e sumindo até o meio: a
    // inicial (ou a foto) fica por cima, sem um quadrado próprio que criava
    // emenda. No claro o tom é mais leve para não sujar o cinza do cartão.
    final escuro = Theme.of(context).brightness == Brightness.dark;
    final forte = escuro ? 0.26 : 0.16;
    final medio = escuro ? 0.10 : 0.06;

    final letra = Padding(
      padding: const EdgeInsets.only(left: 22),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          inicial,
          style: AppTypography.title(context).copyWith(color: tom, fontSize: 26),
        ),
      ),
    );

    return Material(
      color: AppColors.surface(context),
      child: InkWell(
        onTap: onTap,
        child: Stack(
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
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: _largFoto,
              child: foto == null
                  ? letra
                  : ShaderMask(
                      blendMode: BlendMode.dstIn,
                      shaderCallback: (r) => const LinearGradient(
                        colors: [Colors.white, Colors.white, Colors.transparent],
                        stops: [0, 0.3, 1],
                      ).createShader(r),
                      child: Image.network(
                        foto!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => letra,
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
