import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/animations/validation_alert_wrapper.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Input padrão do app — fundo de superfície, sem borda externa, label flutuante.
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
      cursorColor: AppColors.primary,
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        prefixIcon: widget.prefixIcon != null
            ? Icon(
                widget.prefixIcon,
                size: 20,
                color: AppColors.textSecondary(context),
              )
            : null,
        suffixIcon: _suffixIcon(context),
        filled: true,
        fillColor: AppColors.surface(context),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.lg,
        ),
        labelStyle: AppTypography.body(context).copyWith(
          color: AppColors.textSecondary(context),
        ),
        floatingLabelStyle: AppTypography.captionMedium(context).copyWith(
          color: hasCustomError
              ? AppColors.error.withValues(alpha: 0.8)
              : AppColors.primary,
        ),
        hintStyle: AppTypography.body(context).copyWith(
          color: AppColors.textTertiary(context),
        ),
        border: OutlineInputBorder(
          borderRadius: AppRadius.rlg,
          borderSide: hasCustomError
              ? BorderSide(
                  color: AppColors.error.withValues(alpha: 0.5),
                  width: 1.0,
                )
              : BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.rlg,
          borderSide: hasCustomError
              ? BorderSide(
                  color: AppColors.error.withValues(alpha: 0.5),
                  width: 1.0,
                )
              : BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.rlg,
          borderSide: BorderSide(
            color: hasCustomError
                ? AppColors.error.withValues(alpha: 0.7)
                : AppColors.primary,
            width: hasCustomError ? 1.2 : 1.5,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.rlg,
          borderSide: BorderSide(
            color: AppColors.error.withValues(alpha: 0.5),
            width: 1.0,
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadius.rlg,
          borderSide: BorderSide(
            color: AppColors.error.withValues(alpha: 0.7),
            width: 1.2,
          ),
        ),
      ),
    );

    return ValidationAlertWrapper(
      scrollKey: widget.fieldKey,
      errorText: widget.errorText,
      child: field,
    );
  }

  Widget? _suffixIcon(BuildContext context) {
    if (widget.isPassword) {
      return IconButton(
        icon: Icon(
          _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          size: 20,
          color: AppColors.textSecondary(context),
        ),
        onPressed: () => setState(() => _obscure = !_obscure),
      );
    }
    if (widget.suffixIcon != null) {
      return IconButton(
        icon: Icon(widget.suffixIcon, size: 20, color: AppColors.textSecondary(context)),
        onPressed: widget.onSuffixTap,
      );
    }
    return null;
  }
}
