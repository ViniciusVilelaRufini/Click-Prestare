import 'package:click/pages/shared/prestador%20de%20servico/new_prestador.dart';
import 'package:click/pages/shared/visitantes/new_visitante.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Fluxo de "novo visitante" compartilhado pela aba Visitantes, pelo atalho
/// LIBERAR da home e pelo botão flutuante. Síndico e funcionário escolhem entre
/// visitante e prestador; morador vai direto para o formulário de visitante.
Future<void> abrirCadastroVisitante(BuildContext context, {VoidCallback? onDone}) async {
  final tipo = getUserType();
  if (tipo == 'funcionario' || tipo == 'sindico') {
    showCadastrarVisitanteOuPrestadorSheet(context, onDone: onDone);
    return;
  }
  await Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => const NewVisitante(isEdit: false)),
  );
  onDone?.call();
}

void showCadastrarVisitanteOuPrestadorSheet(BuildContext context, {VoidCallback? onDone}) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (ctx) {
      return Container(
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.zero,
        ),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 3,
                decoration: BoxDecoration(
                  color: AppColors.textTertiary(context)
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'Novo Cadastro'.toUpperCase(),
              style: AppTypography.title(context),
            ),
            const SizedBox(height: 4),
            Text(
              'Escolha o tipo de liberação para registrar no condomínio:',
              style: TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary(context),
              ),
            ),
            const SizedBox(height: 16),
            Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppRadius.md),
                onTap: () {
                  Navigator.pop(ctx);
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const NewVisitante(isEdit: false)),
                  ).then((_) {
                    onDone?.call();
                  });
                },
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: AppColors.border(context),
                    ),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppColors.brandSoft,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Icon(PhosphorIcons.userPlus, color: AppColors.brandInkOf(context), size: 22),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Cadastrar Visitante',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary(context),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Visita avulsa, familiar ou convidado para uma unidade',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary(context),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Icon(
                        PhosphorIcons.caretRightBold,
                        size: 16,
                        color: AppColors.textTertiary(context),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppRadius.md),
                onTap: () {
                  Navigator.pop(ctx);
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const NewPrestador(isEdit: false)),
                  ).then((_) {
                    onDone?.call();
                  });
                },
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: AppColors.border(context),
                    ),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppColors.primaryLight,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Icon(PhosphorIcons.wrench, color: AppColors.textPrimary(context), size: 22),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Cadastrar Prestador de Serviço',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary(context),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Técnicos, diaristas, reformas, entregadores ou obras',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary(context),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Icon(
                        PhosphorIcons.caretRightBold,
                        size: 16,
                        color: AppColors.textTertiary(context),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
