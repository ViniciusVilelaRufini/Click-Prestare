import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Selfie que o entregador tirou no QR do portão (link assinado do bucket
/// privado). Quadrada, de canto reto, com o carregando e a falha dos outros
/// avatares do app: enquanto baixa, um indicador; sem foto ou com erro, o
/// ícone de pessoa.
class SelfieEntregador extends StatelessWidget {
  final String? url;
  final double tamanho;

  const SelfieEntregador({super.key, required this.url, this.tamanho = 72});

  @override
  Widget build(BuildContext context) {
    final semFoto = Icon(
      PhosphorIcons.user,
      color: AppColors.textTertiary(context),
      size: tamanho * 0.45,
    );
    final link = url;
    return Semantics(
      image: true,
      label: 'Foto do entregador',
      excludeSemantics: true,
      child: Container(
        width: tamanho,
        height: tamanho,
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          border: Border.all(color: AppColors.border(context)),
        ),
        clipBehavior: Clip.hardEdge,
        child: link == null
            ? semFoto
            : Image.network(
                link,
                width: tamanho,
                height: tamanho,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, progresso) {
                  if (progresso == null) return child;
                  return Center(
                    child: SizedBox(
                      width: tamanho * 0.3,
                      height: tamanho * 0.3,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                    ),
                  );
                },
                errorBuilder: (_, __, ___) => semFoto,
              ),
      ),
    );
  }
}
