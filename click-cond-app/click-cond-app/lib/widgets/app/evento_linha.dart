import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/linha_faixa.dart';
import 'package:flutter/material.dart';

/// Evento de acesso no desenho da portaria web (`.ps-ev`, versão estreita):
/// foto ou inicial sobre a faixa na cor do evento, selo "● ENTRADA/SAÍDA" e
/// o nome com hora e tipo.
class EventoLinha extends StatelessWidget {
  final String nome;
  final bool entrada;
  final String tipo;
  final String hora;
  final String? foto;

  /// Linha extra opcional embaixo (ex.: "PIN / Manual · Boa vista").
  final String? detalhe;
  final VoidCallback onTap;

  const EventoLinha({
    super.key,
    required this.nome,
    required this.entrada,
    required this.tipo,
    required this.hora,
    required this.onTap,
    this.foto,
    this.detalhe,
  });

  @override
  Widget build(BuildContext context) {
    // Entrada em verde; saída no cinza do texto, como na web.
    final tom = entrada ? AppColors.success : AppColors.textTertiary(context);
    final inicial = nome.trim().isEmpty ? '?' : nome.trim()[0].toUpperCase();

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

    return LinhaFaixa(
      tom: tom,
      selo: entrada ? 'ENTRADA' : 'SAÍDA',
      titulo: nome,
      linhas: ['$hora · $tipo', if (detalhe != null) detalhe!],
      onTap: onTap,
      esquerda: foto == null
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
    );
  }
}
