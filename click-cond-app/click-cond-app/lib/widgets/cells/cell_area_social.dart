import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellAreaSocial extends StatelessWidget {
  final bool? hasArrow;
  final dynamic item;

  const CellAreaSocial({
    Key? key,
    required this.item,
    this.hasArrow,
  }) : super(key: key);

  IconData _getAreaIcon(String nome) {
    final n = nome.toLowerCase();
    if (n.contains('gourmet') || n.contains('churrasc') || n.contains('parrilla')) {
      return PhosphorIcons.fire;
    }
    if (n.contains('jogo') || n.contains('game')) {
      return PhosphorIcons.gameController;
    }
    if (n.contains('festa') || n.contains('salão') || n.contains('evento')) {
      return PhosphorIcons.confetti;
    }
    if (n.contains('piscina') || n.contains('pool')) {
      return PhosphorIcons.drop;
    }
    if (n.contains('academia') || n.contains('fit') || n.contains('gym')) {
      return PhosphorIcons.barbell;
    }
    return PhosphorIcons.calendarCheck;
  }

  @override
  Widget build(BuildContext context) {
    final nome = item["nome"]?.toString() ?? '';
    final areaIcon = _getAreaIcon(nome);
    final isImagemValida = item["imagem"] != null &&
        item["imagem"].toString().trim().isNotEmpty &&
        !item["imagem"].toString().contains('unsplash');

    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xs + 2,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Imagem de capa com overlay e ícone
            Stack(
              children: [
                Container(
                  height: 160,
                  width: double.infinity,
                  color: AppColors.primaryLight,
                  child: isImagemValida
                      ? Image.network(
                          item["imagem"],
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              _placeholderImage(context, areaIcon),
                        )
                      : _placeholderImage(context, areaIcon),
                ),
                // Gradient Overlay
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.black.withOpacity(0.2),
                          Colors.transparent,
                          Colors.black.withOpacity(0.65),
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                ),
                // Badge de Categoria/Ícone no canto superior esquerdo
                Positioned(
                  top: 12,
                  left: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.5),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(areaIcon, size: 14, color: Colors.white),
                        const SizedBox(width: 5),
                        const Text(
                          'Área Social',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                // Badge de Ocupação no canto superior direito
                if (item["tem_monitoramento"] == true)
                  _OcupacaoBadge(
                      ocupacao: int.tryParse('${item["ocupacao"] ?? 0}') ?? 0),
                // Nome em destaque sobre o gradiente inferior da foto
                Positioned(
                  bottom: 12,
                  left: 14,
                  right: 14,
                  child: Text(
                    nome,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.3,
                      shadows: [
                        Shadow(
                          color: Colors.black45,
                          blurRadius: 4,
                          offset: Offset(0, 1),
                        ),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            // Rodapé do Card com ação rápida de reserva
            Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Row(
                    children: [
                      Icon(PhosphorIcons.calendarPlus,
                          size: 16, color: AppColors.primary),
                      const SizedBox(width: 6),
                      Text(
                        'Clique para agendar',
                        style: TextStyle(
                          color: AppColors.textSecondary(context),
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'Reservar',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 12.5,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(PhosphorIcons.caretRight,
                            size: 14, color: AppColors.primary),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _placeholderImage(BuildContext context, IconData icon) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.primaryGradientStart,
            AppColors.primaryGradientEnd,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Icon(icon, size: 48, color: Colors.white.withOpacity(0.85)),
      ),
    );
  }
}

/// Selo sobre a imagem da área mostrando quantas pessoas estão dentro agora
class _OcupacaoBadge extends StatelessWidget {
  final int ocupacao;
  const _OcupacaoBadge({Key? key, required this.ocupacao}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final vazia = ocupacao <= 0;
    return Positioned(
      top: 12,
      right: 12,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.6),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(PhosphorIcons.users, size: 14, color: Colors.white),
            const SizedBox(width: 5),
            Text(
              vazia
                  ? 'Vazio'
                  : '$ocupacao ${ocupacao == 1 ? 'pessoa' : 'pessoas'}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
