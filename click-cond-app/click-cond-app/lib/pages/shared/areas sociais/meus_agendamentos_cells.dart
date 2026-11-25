import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/cells/cell_my_agendamento.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class MeusAgendamentosCells extends StatefulWidget {
  const MeusAgendamentosCells({
    super.key,
    required this.list,
    required this.reload,
  });

  final List<dynamic> list;
  final Future<void> Function() reload;

  @override
  State<MeusAgendamentosCells> createState() => _MeusAgendamentosCellsState();
}

class _MeusAgendamentosCellsState extends State<MeusAgendamentosCells> {
  bool _isLoading = false;

  Future<void> _cancelAgendamento(int idItem) async {
    try {
      setState(() => _isLoading = true);
      final res = await apiUpdateStatusAgendamento(idItem, "cancelado", motivo: "Cancelado pelo morador");
      if (res.toString().isEmpty) {
        await widget.reload();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Agendamento cancelado com sucesso.',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              backgroundColor: AppColors.info,
              duration: const Duration(seconds: 2),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// "Confirmar presença" na área que exige confirmação: sem ela, a API
  /// cancela a reserva aprovada quando o horário começa.
  Future<void> _confirmarPresenca(int idItem) async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final res = await apiConfirmarAgendamento(idItem);
      if (!mounted) return;
      if (res.ok) {
        await widget.reload();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text(
              'Presença confirmada. Sua reserva está mantida.',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            backgroundColor: AppColors.success,
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      } else {
        displayMessage(context, getText('alert_error'),
            res.mensagemOu('Não foi possível confirmar a presença. Tente novamente.'));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.xl),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (widget.list.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(PhosphorIcons.calendarX, size: 56, color: AppColors.textTertiary(context)),
              const SizedBox(height: AppSpacing.md),
              Text(
                getText('area_social_nenhum_agendamento'),
                style: TextStyle(
                  color: AppColors.textSecondary(context),
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: widget.reload,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        itemCount: widget.list.length,
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.xs),
        itemBuilder: (_, i) {
          final item = widget.list[i];
          return CellMyAgendamento(
            item: item,
            onCancel: _cancelAgendamento,
            onConfirmar: _confirmarPresenca,
          );
        },
      ),
    );
  }
}


