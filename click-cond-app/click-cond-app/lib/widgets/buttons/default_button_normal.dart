import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/material.dart';

class DefaultButtonNormal extends StatelessWidget {
  final String title;
  final VoidCallback? onPressed;
  final bool hasArrow;
  final FractionalOffset? aligment;
  final bool? isRed;

  const DefaultButtonNormal({
    super.key,
    required this.title,
    this.onPressed,
    required this.hasArrow,
    this.aligment, 
    this.isRed
  });

  @override
  Widget build(BuildContext context) {
    return AppButton(
      label: title,
      onPressed: onPressed,
      size: AppButtonSize.md,
      trailingIcon: hasArrow ? Icons.arrow_right_alt : null,
      variant: isRed == true ? AppButtonVariant.danger : AppButtonVariant.primary,
    );
  }
}
