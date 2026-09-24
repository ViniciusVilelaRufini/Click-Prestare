import 'package:click/controllers/controller_sindico.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class RedefinirSenhaPage extends StatefulWidget {
  final String token;

  const RedefinirSenhaPage({super.key, required this.token});

  @override
  State<RedefinirSenhaPage> createState() => _RedefinirSenhaPageState();
}

class _RedefinirSenhaPageState extends State<RedefinirSenhaPage> {
  final _txtNovaSenha = TextEditingController();
  final _txtConfirmarSenha = TextEditingController();

  bool _isLoading = false;

  @override
  void dispose() {
    _txtNovaSenha.dispose();
    _txtConfirmarSenha.dispose();
    super.dispose();
  }

  Future<void> _salvarNovaSenha() async {
    final nova = _txtNovaSenha.text.trim();
    final confirma = _txtConfirmarSenha.text.trim();

    if (widget.token.trim().isEmpty) {
      showAppDialog(
        context,
        title: 'Link Inválido',
        message: 'O token de redefinição não foi encontrado ou é inválido. Solicite um novo link.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    if (nova.length < 6) {
      showAppDialog(
        context,
        title: 'Senha muito curta',
        message: 'A nova senha deve ter no mínimo 6 caracteres.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    if (nova != confirma) {
      showAppDialog(
        context,
        title: 'Senhas divergentes',
        message: 'A confirmação de senha não confere com a nova senha digitada.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final msg = await redefinirSenhaApi(widget.token, nova);
      if (!mounted) return;

      await showAppDialog(
        context,
        title: 'Senha Redefinida!',
        message: msg.isNotEmpty ? msg : 'Sua senha foi redefinida com sucesso! Você já pode fazer login.',
        icon: PhosphorIcons.checkCircle,
        iconColor: AppColors.success,
      );

      if (!mounted) return;
      // Volta para a tela inicial / login
      Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
    } catch (e) {
      if (!mounted) return;
      showAppDialog(
        context,
        title: 'Não foi possível alterar a senha',
        message: e.toString().replaceAll('Exception:', '').trim(),
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Redefinir Senha',
      showBackButton: true,
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppSpacing.xl),
            Center(
              child: Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                ),
                child: Icon(
                  PhosphorIcons.key,
                  size: 36,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              'Crie sua Nova Senha',
              style: AppTypography.display(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Digite e confirme sua nova senha de acesso. O link é de uso único e expira em 30 minutos.',
              style: AppTypography.bodySecondary(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxxl),
            AppInput(
              label: 'Nova Senha',
              controller: _txtNovaSenha,
              isPassword: true,
              prefixIcon: PhosphorIcons.lock,
            ),
            const SizedBox(height: AppSpacing.lg),
            AppInput(
              label: 'Confirmar Nova Senha',
              controller: _txtConfirmarSenha,
              isPassword: true,
              prefixIcon: PhosphorIcons.lockKey,
            ),
            const SizedBox(height: AppSpacing.xxl),
            AppButton(
              label: 'Salvar Nova Senha',
              loading: _isLoading,
              onPressed: _salvarNovaSenha,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}
