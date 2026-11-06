import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/animations/validation_alert_wrapper.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Input padrão do app: fundo `bg-200`, contorno `line-100`, rótulo flutuante.
class AppInput extends StatefulWidget {
  final String label;
  final String? hint;
  final TextEditingController controller;
  final bool isPassword;
  final TextInputType? keyboard;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? formatters;
  final IconData? prefixIcon;
  final IconData? suffixIcon;
  final VoidCallback? onSuffixTap;
  final String? Function(String?)? validator;
  final void Function(String)? onChanged;
  final bool readOnly;
  final VoidCallback? onTap;
  final int maxLines;
  final String? errorText;
  final GlobalKey? fieldKey;

  const AppInput({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.isPassword = false,
    this.keyboard,
    this.textCapitalization = TextCapitalization.none,
    this.formatters,
    this.prefixIcon,
    this.suffixIcon,
    this.onSuffixTap,
    this.validator,
    this.onChanged,
    this.readOnly = false,
    this.onTap,
    this.maxLines = 1,
    this.errorText,
    this.fieldKey,
  });

  @override
  State<AppInput> createState() => _AppInputState();
}

class _AppInputState extends State<AppInput> {
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    final hasCustomError =
        widget.errorText != null && widget.errorText!.trim().isNotEmpty;

    final linha = hasCustomError
        ? AppColors.signalDanger(context)
        : AppColors.border(context);

    final field = TextFormField(
      controller: widget.controller,
      obscureText: widget.isPassword && _obscure,
      keyboardType: widget.keyboard,
      textCapitalization: widget.textCapitalization,
      inputFormatters: widget.formatters,
      validator: widget.validator,
      onChanged: widget.onChanged,
      readOnly: widget.readOnly,
      onTap: widget.onTap,
      maxLines: widget.isPassword ? 1 : widget.maxLines,
      style: AppTypography.body(context),
      cursorColor: AppColors.textPrimary(context),
      decoration: InputDecoration(
        labelText: widget.label.toUpperCase(),
        hintText: widget.hint,
        prefixIcon: widget.prefixIcon != null
            ? Icon(
                widget.prefixIcon,
                size: 18,
                color: AppColors.textTertiary(context),
              )
            : null,
        suffixIcon: _suffixIcon(context),
        filled: true,
        fillColor: AppColors.surface(context),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.lg,
        ),
        labelStyle: AppTypography.label(context).copyWith(
          color: AppColors.textSecondary(context),
          fontSize: 13,
          letterSpacing: 13 * 0.16,
        ),
        floatingLabelStyle: AppTypography.label(context).copyWith(
          color: hasCustomError
              ? AppColors.signalDanger(context)
              : AppColors.textPrimary(context),
        ),
        hintStyle: AppTypography.bodySecondary(context).copyWith(
          color: AppColors.textTertiary(context),
        ),
        border: _borda(linha),
        enabledBorder: _borda(linha),
        focusedBorder: _borda(
          hasCustomError
              ? AppColors.signalDanger(context)
              : AppColors.textPrimary(context),
        ),
        errorBorder: _borda(AppColors.signalDanger(context)),
        focusedErrorBorder: _borda(AppColors.signalDanger(context)),
      ),
    );

    return ValidationAlertWrapper(
      scrollKey: widget.fieldKey,
      errorText: widget.errorText,
      child: field,
    );
  }

  OutlineInputBorder _borda(Color cor) => OutlineInputBorder(
        borderRadius: BorderRadius.zero,
        borderSide: BorderSide(color: cor),
      );

  Widget? _suffixIcon(BuildContext context) {
    if (widget.isPassword) {
      return IconButton(
        icon: Icon(
          _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          size: 18,
          color: AppColors.textTertiary(context),
        ),
        onPressed: () => setState(() => _obscure = !_obscure),
      );
    }
    if (widget.suffixIcon != null) {
      return IconButton(
        icon: Icon(widget.suffixIcon, size: 18, color: AppColors.textTertiary(context)),
        onPressed: widget.onSuffixTap,
      );
    }
    return null;
  }
}
