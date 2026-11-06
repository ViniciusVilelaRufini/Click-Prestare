import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/recuperar_senha_codigo_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
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
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: Stack(
        children: [
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
    // `.iconbtn`: quadrado de 40px com contorno line-100.
    return InkWell(
      onTap: () => Navigator.pop(context),
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Icon(
          PhosphorIcons.caretLeft,
          color: AppColors.textPrimary(context),
          size: 18,
        ),
      ),
    );
  }

  Widget _buildBrand(BuildContext context) {
    final tinta = AppColors.textPrimary(context);
    return Row(
      children: [
        Image.asset(
          'assets/images/logo_prestare_mono.png',
          height: 48,
          color: tinta,
          colorBlendMode: BlendMode.srcIn,
          fit: BoxFit.contain,
        ),
        const SizedBox(width: AppSpacing.lg),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'PRESTARE\n'),
                TextSpan(
                  text: 'GESTÃO',
                  style: TextStyle(fontWeight: FontWeight.w300, color: tinta),
                ),
              ],
            ),
            style: GoogleFonts.barlowCondensed(
              fontSize: 28,
              height: 1,
              fontWeight: FontWeight.w600,
              letterSpacing: 28 * 0.06,
              color: tinta,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              height: 22,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.borderStrong(context)),
                borderRadius: BorderRadius.circular(AppRadius.tag),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_typeIcon(),
                      size: 13, color: AppColors.textSecondary(context)),
                  const SizedBox(width: 6),
                  Text(
                    _typeLabel().toUpperCase(),
                    style: GoogleFonts.barlowCondensed(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 10 * 0.18,
                      color: AppColors.textSecondary(context),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            'Recuperar Senha'.toUpperCase(),
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
    );
  }
}
