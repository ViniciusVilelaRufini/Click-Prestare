import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Selo oficial "powered by aws" (kit do AWS Marketing Central): branco no tema
/// escuro e cinza-escuro no claro. Não recolorir: o arquivo é o da própria AWS.
class PoweredByAws extends StatelessWidget {
  const PoweredByAws({super.key, this.height = 20});

  final double height;

  @override
  Widget build(BuildContext context) {
    final escuro = Theme.of(context).brightness == Brightness.dark;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 1,
          height: height * 1.6,
          color: AppColors.border(context),
        ),
        const SizedBox(width: 14),
        Flexible(
          child: Image.asset(
            escuro
                ? 'assets/images/powered_by_aws_white.png'
                : 'assets/images/powered_by_aws_gray.png',
            height: height,
            fit: BoxFit.contain,
            semanticLabel: 'Powered by AWS',
          ),
        ),
      ],
    );
  }
}
