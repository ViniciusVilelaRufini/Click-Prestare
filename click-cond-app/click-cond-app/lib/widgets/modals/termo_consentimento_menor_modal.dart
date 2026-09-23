import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Exibe o modal bottom sheet com o Termo de Consentimento de Biometria para Menores (LGPD Art. 14).
/// Retorna `true` se o responsável legal aceitou expressamente e prosseguiu para a captura,
/// ou `false`/`null` se cancelou.
Future<bool?> showTermoConsentimentoMenorModal({
  required BuildContext context,
  required String nomeMenor,
  required String nomeResponsavel,
  String? dataNascimentoMenor,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => TermoConsentimentoMenorModal(
      nomeMenor: nomeMenor,
      nomeResponsavel: nomeResponsavel,
      dataNascimentoMenor: dataNascimentoMenor,
    ),
  );
}

class TermoConsentimentoMenorModal extends StatefulWidget {
  final String nomeMenor;
  final String nomeResponsavel;
  final String? dataNascimentoMenor;

  const TermoConsentimentoMenorModal({
    super.key,
    required this.nomeMenor,
    required this.nomeResponsavel,
    this.dataNascimentoMenor,
  });

  @override
  State<TermoConsentimentoMenorModal> createState() => _TermoConsentimentoMenorModalState();
}

class _TermoConsentimentoMenorModalState extends State<TermoConsentimentoMenorModal> {
  bool _aceitouTermos = false;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final maxSheetHeight = MediaQuery.of(context).size.height * 0.88;

    return Container(
      constraints: BoxConstraints(maxHeight: maxSheetHeight),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Drag Handle
            const SizedBox(height: AppSpacing.sm),
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: (isDark ? Colors.white : Colors.black).withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            // Header com Ícone de Proteção
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      PhosphorIcons.shieldCheck,
                      color: AppColors.primary,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Termo de Consentimento',
                          style: AppTypography.headline(context).copyWith(
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Biometria Facial para Menores (LGPD Art. 14)',
                          style: AppTypography.caption(context).copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(PhosphorIcons.x, size: 20),
                    onPressed: () => Navigator.of(context).pop(false),
                    splashRadius: 20,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            const Divider(height: 1),

            // Conteúdo Rolável
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Card de Identificação das Partes
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceElevated(context),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: AppColors.border(context).withValues(alpha: 0.5),
                        ),
                      ),
                      child: Column(
                        children: [
                          _buildInfoRow(
                            context,
                            icon: PhosphorIcons.user,
                            label: 'Responsável Legal',
                            value: widget.nomeResponsavel.isNotEmpty
                                ? widget.nomeResponsavel
                                : 'Responsável pela unidade',
                          ),
                          const Divider(height: 16),
                          _buildInfoRow(
                            context,
                            icon: PhosphorIcons.baby,
                            label: 'Menor de Idade',
                            value: widget.nomeMenor.isNotEmpty
                                ? widget.nomeMenor
                                : 'Nome do menor a cadastrar',
                          ),
                          if (widget.dataNascimentoMenor != null &&
                              widget.dataNascimentoMenor!.isNotEmpty) ...[
                            const Divider(height: 16),
                            _buildInfoRow(
                              context,
                              icon: PhosphorIcons.calendarBlank,
                              label: 'Data de Nascimento',
                              value: widget.dataNascimentoMenor!,
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Cláusulas Explicativas
                    Text(
                      'CONDIÇÕES DO TRATAMENTO BIOMÉTRICO',
                      style: AppTypography.captionMedium(context).copyWith(
                        color: AppColors.textSecondary(context),
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    _buildClauseItem(
                      context,
                      number: '1',
                      title: 'Finalidade Específica',
                      description:
                          'A fotografia e a biometria facial do menor serão utilizadas única e exclusivamente para controle e liberação segura de acesso nas portarias, catracas e portões do condomínio.',
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    _buildClauseItem(
                      context,
                      number: '2',
                      title: 'Amparo Legal (LGPD Art. 14)',
                      description:
                          'O tratamento de dados de crianças e adolescentes é realizado no seu melhor interesse, mediante consentimento específico e em destaque concedido por pelo menos um dos pais ou responsável legal.',
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    _buildClauseItem(
                      context,
                      number: '3',
                      title: 'Segurança e Não Compartilhamento',
                      description:
                          'Os dados biométricos são criptografados, intransferíveis a terceiros para fins comerciais e protegidos contra acessos não autorizados.',
                    ),
                    const SizedBox(height: AppSpacing.sm),

                    _buildClauseItem(
                      context,
                      number: '4',
                      title: 'Revogação a Qualquer Momento',
                      description:
                          'O consentimento poderá ser revogado a qualquer tempo pelo responsável legal, mediante solicitação no aplicativo ou junto à administração.',
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Checkbox de Declaração Ativa
                    Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () => setState(() => _aceitouTermos = !_aceitouTermos),
                        borderRadius: BorderRadius.circular(14),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _aceitouTermos
                                ? AppColors.primary.withValues(alpha: 0.08)
                                : AppColors.surfaceElevated(context),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: _aceitouTermos
                                  ? AppColors.primary
                                  : AppColors.border(context),
                              width: _aceitouTermos ? 1.5 : 1.0,
                            ),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Checkbox(
                                value: _aceitouTermos,
                                onChanged: (v) => setState(() => _aceitouTermos = v ?? false),
                                activeColor: AppColors.primary,
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Declaro, sob as penas da lei, que sou pai, mãe ou responsável legal de '
                                  '${widget.nomeMenor.isNotEmpty ? widget.nomeMenor : "deste menor"} '
                                  'e autorizo expressamente a coleta e o tratamento de sua biometria facial para controle de acesso ao condomínio.',
                                  style: AppTypography.caption(context).copyWith(
                                    color: AppColors.textPrimary(context),
                                    fontWeight: _aceitouTermos ? FontWeight.w600 : FontWeight.normal,
                                    height: 1.35,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Rodapé com Ações
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                border: Border(
                  top: BorderSide(color: AppColors.border(context).withValues(alpha: 0.5)),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: AppButton(
                      label: 'Cancelar',
                      variant: AppButtonVariant.ghost,
                      onPressed: () => Navigator.of(context).pop(false),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    flex: 3,
                    child: AppButton(
                      label: 'Autorizar e Capturar',
                      icon: PhosphorIcons.camera,
                      variant: AppButtonVariant.primary,
                      onPressed: _aceitouTermos ? () => Navigator.of(context).pop(true) : null,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppColors.primary),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.textSecondary(context),
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                value,
                style: AppTypography.caption(context).copyWith(
                  color: AppColors.textPrimary(context),
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildClauseItem(
    BuildContext context, {
    required String number,
    required String title,
    required String description,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          margin: const EdgeInsets.only(top: 2),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            number,
            style: TextStyle(
              color: AppColors.primary,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: AppTypography.captionMedium(context).copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: AppTypography.caption(context).copyWith(
                  color: AppColors.textSecondary(context),
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
