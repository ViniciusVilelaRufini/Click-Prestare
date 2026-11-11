import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Pede a senha atual antes de salvar a troca do e-mail de acesso.
/// Devolve a senha digitada, ou `null` se o usuário cancelar.
Future<String?> pedirSenhaAtualParaTrocaDeEmail(BuildContext context) {
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const DialogSenhaAtual(),
  );
}

class DialogSenhaAtual extends StatefulWidget {
  const DialogSenhaAtual({super.key});

  @override
  State<DialogSenhaAtual> createState() => _DialogSenhaAtualState();
}

class _DialogSenhaAtualState extends State<DialogSenhaAtual> {
  final _senha = TextEditingController();
  String? _erro;

  @override
  void dispose() {
    _senha.dispose();
    super.dispose();
  }

  void _confirmar() {
    // Quem valida de verdade é o servidor; aqui só evita a ida à rede com o
    // campo em branco.
    if (_senha.text.isEmpty) {
      setState(() => _erro = getText('config_senha_atual_obrigatoria'));
      return;
    }
    Navigator.pop(context, _senha.text);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              getText('troca_email_titulo').toUpperCase(),
              style: AppTypography.title(context),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapSm,
            Text(
              getText('troca_email_mensagem'),
              style: AppTypography.bodySecondary(context),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapLg,
            AppInput(
              label: getText('config_senha_atual'),
              controller: _senha,
              prefixIcon: PhosphorIcons.lockKeyOpen,
              isPassword: true,
              errorText: _erro,
              onChanged: (_) {
                if (_erro != null) setState(() => _erro = null);
              },
            ),
            AppSpacing.gapXl,
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: getText('btn_cancelar'),
                    variant: AppButtonVariant.secondary,
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
                AppSpacing.gapSm,
                Expanded(
                  child: AppButton(
                    label: getText('btn_confirmar'),
                    onPressed: _confirmar,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
