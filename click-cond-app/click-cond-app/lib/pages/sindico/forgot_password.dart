import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/recuperar_senha_codigo_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/grid_background.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ForgotPassword extends StatefulWidget {
  final String loginType;
  const ForgotPassword({super.key, required this.loginType});

  @override
  State<ForgotPassword> createState() => _ForgotPasswordState();
}

class _ForgotPasswordState extends State<ForgotPassword> {
  final _txtEmail = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _txtEmail.dispose();
    super.dispose();
  }

  IconData _typeIcon() {
    switch (widget.loginType) {
      case 'morador':
        return PhosphorIcons.house;
      case 'funcionario':
        return PhosphorIcons.identificationCard;
      default:
        return PhosphorIcons.buildings;
    }
  }

  String _typeLabel() {
    switch (widget.loginType) {
      case 'morador':
        return 'Morador';
      case 'funcionario':
        return 'Funcionário';
      default:
        return 'Síndico';
    }
  }

  Future<void> _solicitarCodigo() async {
    final email = _txtEmail.text.trim();
    if (email.isEmpty) {
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: 'Por favor, insira o seu e-mail cadastrado.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    try {
      setState(() => _isLoading = true);
      final res = await solicitarCodigoRedefinicaoApi(email, widget.loginType);
      if (!mounted) return;

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => RecuperarSenhaCodigoPage(
            ticketId: res['ticket_id']?.toString() ?? '',
            emailMasked: res['email_masked']?.toString() ?? email,
            loginType: widget.loginType,
            email: email,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: e.toString(),
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF04060A) : const Color(0xFFF8FAFC),
      body: Stack(
        children: [
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: isDark
                      ? [const Color(0xFF0A1628), const Color(0xFF04060A)]
                      : [const Color(0xFFFFFFFF), const Color(0xFFEEF4FD)],
                ),
              ),
            ),
          ),
          const Positioned.fill(child: GridBackground()),
          Positioned.fill(
            child: SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.xxl,
                      vertical: AppSpacing.sm,
                    ),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight - AppSpacing.sm * 2,
                      ),
                      child: IntrinsicHeight(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: _buildBackButton(context),
                            ),
                            const SizedBox(height: AppSpacing.xxl),
                            _buildBrand(context),
                            const SizedBox(height: AppSpacing.xxl),
                            _buildFormCard(context),
                            const Spacer(),
                            const SizedBox(height: AppSpacing.xl),
                            Text(
                              '© 2026 Prestare Gestão e Tecnologia.',
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.textTertiary(context),
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: AppSpacing.sm),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBackButton(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.full),
      child: Material(
        color: AppColors.surfaceElevated(context),
        child: InkWell(
          onTap: () => Navigator.pop(context),
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border(context), width: 1.2),
              shape: BoxShape.circle,
            ),
            child: Icon(
              PhosphorIcons.caretLeft,
              color: AppColors.textPrimary(context),
              size: 20,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBrand(BuildContext context) {
    final marca = AppTypography.title(context).copyWith(
      fontSize: 20,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.8,
    );

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.08),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.16),
                blurRadius: 22,
                spreadRadius: -4,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: Image.asset(
              'assets/images/logo_prestare_gestao.png',
              width: 68,
              height: 68,
              fit: BoxFit.cover,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'PRESTARE ', style: marca),
                TextSpan(
                  text: 'GESTÃO',
                  style: marca.copyWith(color: AppColors.primary),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(AppRadius.xxl),
        border: Border.all(color: AppColors.border(context), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 24,
            spreadRadius: -6,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(AppRadius.full),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_typeIcon(), size: 15, color: AppColors.primary),
                  const SizedBox(width: 6),
                  Text(
                    _typeLabel(),
                    style: AppTypography.tiny(context).copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            'Recuperar Senha',
            style: AppTypography.title(context),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Digite o e-mail cadastrado da sua conta. Você receberá um código numérico de 6 dígitos para redefinir sua senha.',
            style: AppTypography.caption(context),
          ),
          const SizedBox(height: AppSpacing.xl),
          AppInput(
            label: 'E-mail cadastrado',
            controller: _txtEmail,
            keyboard: TextInputType.emailAddress,
            prefixIcon: PhosphorIcons.envelope,
          ),
          const SizedBox(height: AppSpacing.xl),
          AppButton(
            label: 'ENVIAR CÓDIGO',
            loading: _isLoading,
            trailingIcon: PhosphorIcons.arrowRight,
            onPressed: _solicitarCodigo,
          ),
        ],
      ),
    );
  }
}
