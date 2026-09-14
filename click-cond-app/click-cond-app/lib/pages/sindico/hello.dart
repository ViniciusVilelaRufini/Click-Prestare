import 'package:click/pages/sindico/login.dart';
import 'package:click/pages/sindico/signup/signup_sindico.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class Hello extends StatelessWidget {
  const Hello({super.key});

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppSpacing.xxl),
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(AppRadius.lg),
              ),
              child: Row(
                children: [
                  Icon(PhosphorIcons.userCircleFill,
                      size: 32, color: AppColors.primary),
                  AppSpacing.gapMd,
                  Expanded(
                    child: Text(
                      getText('sindico'),
                      style: AppTypography.bodyMedium(context).copyWith(
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xxxl),
            Text(
              '${getText('ola')}, ${getText('sindico')}',
              style: AppTypography.display(context),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              getText('view_hello_text'),
              style: AppTypography.bodySecondary(context),
            ),
            const SizedBox(height: AppSpacing.huge),
            AppButton(
              label: getText('vamos_cadastrar').toString().toUpperCase(),
              trailingIcon: PhosphorIcons.arrowRight,
              onPressed: () {
                Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const SignupSindico()));
              },
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: getText('possuo_cadastro').toString().toUpperCase(),
              variant: AppButtonVariant.secondary,
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const LoginSindico(loginType: 'sindico'),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
