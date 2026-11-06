import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';

class RecuperarSenhaNovaSenhaPage extends StatefulWidget {
  final String resetToken;
  final String loginType;

  const RecuperarSenhaNovaSenhaPage({
    super.key,
    required this.resetToken,
    required this.loginType,
  });

  @override
  State<RecuperarSenhaNovaSenhaPage> createState() => _RecuperarSenhaNovaSenhaPageState();
}

class _RecuperarSenhaNovaSenhaPageState extends State<RecuperarSenhaNovaSenhaPage> {
  final _txtNovaSenha = TextEditingController();
  final _txtConfirmarSenha = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _txtNovaSenha.dispose();
    _txtConfirmarSenha.dispose();
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

  Future<void> _salvarNovaSenha() async {
    final novaSenha = _txtNovaSenha.text.trim();
    final confirmarSenha = _txtConfirmarSenha.text.trim();

    if (novaSenha.isEmpty || confirmarSenha.isEmpty) {
      showAppDialog(
        context,
        title: 'Campos obrigatórios',
        message: 'Por favor, preencha a nova senha e a confirmação.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.warning,
      );
      return;
    }

    if (novaSenha.length < 6) {
      showAppDialog(
        context,
        title: 'Senha muito curta',
        message: 'A nova senha deve ter no mínimo 6 caracteres.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.warning,
      );
      return;
    }

    if (novaSenha != confirmarSenha) {
      showAppDialog(
        context,
        title: 'Senhas divergentes',
        message: 'A confirmação de senha não confere com a nova senha digitada.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.warning,
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      await redefinirSenhaComAutoLoginApi(
        widget.resetToken,
        novaSenha,
        widget.loginType,
      );

      if (!mounted) return;

      // Registra push notification após login automático
      try {
        await FirebaseService.instance.registrarNoServidor();
      } catch (_) {}

      if (!mounted) return;

      // Entrada direta no aplicativo sem precisar relogar manualmente
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const PortaDeEntrada()),
        (route) => false,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      showAppDialog(
        context,
        title: 'Não foi possível salvar',
        message: e.toString(),
        icon: PhosphorIcons.shieldWarning,
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
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(AppRadius.xxl),
        border: Border.all(color: AppColors.border(context), width: 1),
      ),
      child: Column(
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
            'Criar Nova Senha'.toUpperCase(),
            style: AppTypography.title(context),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Escolha uma senha forte com no mínimo 6 caracteres para acessar sua conta.',
            style: AppTypography.caption(context),
          ),
          const SizedBox(height: AppSpacing.xl),
          AppInput(
            label: 'Nova Senha',
            controller: _txtNovaSenha,
            isPassword: true,
            prefixIcon: PhosphorIcons.lock,
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(
            label: 'Confirmar Nova Senha',
            controller: _txtConfirmarSenha,
            isPassword: true,
            prefixIcon: PhosphorIcons.lockKey,
          ),
          const SizedBox(height: AppSpacing.xl),
          AppButton(
            label: 'SALVAR E ENTRAR',
            loading: _isLoading,
            trailingIcon: PhosphorIcons.arrowRight,
            onPressed: _salvarNovaSenha,
          ),
        ],
      ),
    );
  }
}
