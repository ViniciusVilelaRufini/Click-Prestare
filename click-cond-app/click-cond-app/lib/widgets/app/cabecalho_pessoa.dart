import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Estado do visitante/prestador mostrado no selo.
enum StatusPessoa { noLocal, autorizado, agendado, finalizado }

/// Topo do cartão de pessoa (visitante/prestador) no desenho dos eventos: a
/// foto ocupa a esquerda de ponta a ponta e se dissolve no cartão — o
/// degradê fica só na imagem, sem pintar a linha, como em Visitantes na
/// portaria web. Sem foto, as iniciais em cinza. Ao lado, o selo de status,
/// o nome e o tipo com a unidade.
class CabecalhoPessoa extends StatelessWidget {
  final String nome;
  final String subtitulo;
  final StatusPessoa status;
  final ImageProvider? foto;

  const CabecalhoPessoa({
    super.key,
    required this.nome,
    required this.subtitulo,
    required this.status,
    this.foto,
  });

  static const double altura = 80;
  static const double _largFoto = 104;
  static const double _inicioTexto = 92;

  (String, Color) _selo(BuildContext context) {
    switch (status) {
      case StatusPessoa.noLocal:
        return ('NO LOCAL', AppColors.success);
      case StatusPessoa.autorizado:
        return ('AUTORIZADO', AppColors.success);
      case StatusPessoa.agendado:
        return ('AGENDADO', AppColors.signalWarn(context));
      case StatusPessoa.finalizado:
        return ('FINALIZADO', AppColors.textTertiary(context));
    }
  }

  String get _iniciais {
    final palavras = nome.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (palavras.length >= 2) return '${palavras[0][0]}${palavras[1][0]}'.toUpperCase();
    if (palavras.isNotEmpty) return palavras[0][0].toUpperCase();
    return '?';
  }

  @override
  Widget build(BuildContext context) {
    final (rotulo, cor) = _selo(context);

    final iniciais = Padding(
      padding: const EdgeInsets.only(left: 18),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          _iniciais,
          style: AppTypography.title(context)
              .copyWith(color: AppColors.textTertiary(context), fontSize: 24),
        ),
      ),
    );

    // Altura mínima, não fixa: com fonte aumentada o texto cresce sem estourar.
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: altura),
      child: Stack(
        alignment: Alignment.centerLeft,
        children: [
          Positioned(
            left: 0,
            top: 0,
            bottom: 0,
            width: _largFoto,
            child: foto == null
                ? iniciais
                : ShaderMask(
                    blendMode: BlendMode.dstIn,
                    shaderCallback: (r) => const LinearGradient(
                      colors: [Colors.white, Colors.white, Colors.transparent],
                      stops: [0, 0.35, 1],
                    ).createShader(r),
                    child: Image(
                      image: foto!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => iniciais,
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(_inicioTexto, 12, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(color: cor, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      rotulo,
                      style: AppTypography.label(context).copyWith(
                        color: cor,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 11 * 0.14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  nome,
                  style: AppTypography.strong(context),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  subtitulo,
                  style: AppTypography.tiny(context)
                      .copyWith(color: AppColors.textSecondary(context)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
