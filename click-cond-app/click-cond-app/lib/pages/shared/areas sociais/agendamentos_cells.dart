import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/cells/cell_agendamento.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class AgendamentosCells extends StatefulWidget {
  const AgendamentosCells({
    Key? key,
    required this.list,
    required this.reload,
  }) : super(key: key);

  final List<dynamic> list;
  final Future<void> Function() reload;

  @override
  State<AgendamentosCells> createState() => _AgendamentosCellsState();
}

class _AgendamentosCellsState extends State<AgendamentosCells> {
  bool _isLoading = false;

  Future<void> _updateStatus(int idItem, String status, String motivo) async {
    try {
      setState(() => _isLoading = true);
      final res = await apiUpdateStatusAgendamento(idItem, status, motivo: motivo);
      if (res.toString().isEmpty) {
        await widget.reload();
        if (mounted) {
          String msg = 'Reserva aprovada com sucesso!';
          Color cor = const Color(0xFF10B981);
          if (status == 'recusado') {
            msg = 'Reserva recusada.';
            cor = const Color(0xFFEF4444);
          } else if (status == 'cancelado') {
            msg = 'Reserva cancelada.';
            cor = const Color(0xFF64748B);
          }
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                msg,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              backgroundColor: cor,
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
                getText('alert_list_empty_generic'),
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
          return CellAgendamento(
            item: item,
            onStatusChange: _updateStatus,
          );
        },
      ),
    );
  }
}


