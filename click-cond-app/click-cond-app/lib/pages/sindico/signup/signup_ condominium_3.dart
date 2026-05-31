import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_condominio.dart';
import 'package:click/pages/sindico/signup/signup_%20condominium_1.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_signup_success.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class SignupCondominuim3 extends StatefulWidget {
  const SignupCondominuim3({Key? key, required this.condominio}) : super(key: key);
  final CondominioRegister condominio;

  @override
  _SignupCondominuim3PageState createState() => _SignupCondominuim3PageState();
}

class _SignupCondominuim3PageState extends State<SignupCondominuim3> {
  var _isLoading = false;

  Future<void> _register() async {
    widget.condominio.blocos = 0;
    widget.condominio.aptos = 0;

    setState(() => _isLoading = true);
    try {
      final message = await registerCondominio(widget.condominio);
      if (!mounted) return;
      setState(() => _isLoading = false);

      if (message == "") {
        showDialog(
          context: context,
          builder: (_) => CustomDialogBox(),
        );
      } else {
        displayMessage(context, getText('alert_error'), message);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      displayMessage(context, getText('alert_error'), getText('alert_invalid_value'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('signup_cond_nav'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: AppColors.primary.withOpacity(0.12),
                  backgroundImage: widget.condominio.photo != null
                      ? (kIsWeb
                          ? NetworkImage(widget.condominio.photo!)
                          : NetworkImage(widget.condominio.photo!)) as ImageProvider
                      : const AssetImage('assets/images/business_default.png'),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    widget.condominio.nome ?? '',
                    style: AppTypography.headline(context),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            _buildSummaryCard(context),
            const SizedBox(height: AppSpacing.xl),
            _StepIndicator(step: 3, total: 3),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: getText('btn_save'),
              onPressed: _isLoading ? null : _register,
              loading: _isLoading,
              size: AppButtonSize.lg,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryCard(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Revise os dados de cadastro:',
          style: AppTypography.bodyMedium(context).copyWith(
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary(context),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        
        // Dados Gerais
        _buildSectionCard(
          context,
          title: 'Informações Gerais',
          icon: PhosphorIcons.info,
          children: [
            _buildDetailRow(context, 'CNPJ/Documento', widget.condominio.documento ?? ''),
            _buildDetailRow(context, 'Subsíndico', widget.condominio.subsindico ?? ''),
            _buildDetailRow(context, 'Início do Mandato', widget.condominio.inicioMandato ?? ''),
            _buildDetailRow(context, 'Término do Mandato', widget.condominio.terminoMandato ?? ''),
          ],
        ),
        
        const SizedBox(height: AppSpacing.md),
        
        // Localização
        _buildSectionCard(
          context,
          title: 'Endereço',
          icon: PhosphorIcons.mapPin,
          children: [
            _buildDetailRow(context, 'CEP', widget.condominio.cep ?? ''),
            _buildDetailRow(context, 'Rua/Número', '${widget.condominio.rua ?? ''}, ${widget.condominio.numero ?? ''}'),
            if (widget.condominio.complemento != null && widget.condominio.complemento!.isNotEmpty)
              _buildDetailRow(context, 'Complemento', widget.condominio.complemento ?? ''),
            _buildDetailRow(context, 'Bairro', widget.condominio.bairro ?? ''),
            _buildDetailRow(context, 'Cidade/UF', '${widget.condominio.cidade ?? ''} - ${widget.condominio.uf ?? ''}'),
            _buildDetailRow(context, 'País', widget.condominio.pais ?? ''),
          ],
        ),
      ],
    );
  }

  Widget _buildSectionCard(
    BuildContext context, {
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.primary, size: 20),
              const SizedBox(width: 8),
              Text(
                title,
                style: AppTypography.bodyMedium(context).copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Divider(height: 1, thickness: 1),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _buildDetailRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(
              label,
              style: AppTypography.caption(context).copyWith(
                color: AppColors.textSecondary(context),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 3,
            child: Text(
              value,
              style: AppTypography.bodySecondary(context).copyWith(
                fontWeight: FontWeight.w500,
                color: AppColors.textPrimary(context),
              ),
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepIndicator extends StatelessWidget {
  final int step;
  final int total;
  const _StepIndicator({required this.step, required this.total});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$step de $total',
          style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary),
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: step / total,
            minHeight: 6,
            backgroundColor: AppColors.border(context),
            valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primary),
          ),
        ),
      ],
    );
  }
}
