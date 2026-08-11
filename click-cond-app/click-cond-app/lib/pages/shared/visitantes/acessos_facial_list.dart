import 'package:click/controllers/controller_facial.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/datas.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Lista compacta dos últimos acessos de um visitante no condomínio.
/// Mostra "Entrou" / "Saiu" / "Negado" com o método usado (Facial / Tag RFID /
/// QR Code / Catraca / Botoeira), data e hora.
/// Usa o endpoint GET /api/facial/acessos/visitante/:id.
class AcessosFacialList extends StatefulWidget {
  final int idVisitante;
  final int limit;

  const AcessosFacialList({
    Key? key,
    required this.idVisitante,
    this.limit = 5,
  }) : super(key: key);

  @override
  State<AcessosFacialList> createState() => _AcessosFacialListState();
}

class _AcessosFacialListState extends State<AcessosFacialList> {
  bool _loading = true;
  List<dynamic> _acessos = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final list = await apiGetAcessosVisitante(widget.idVisitante, limit: widget.limit);
    if (!mounted) return;
    setState(() {
      _acessos = list;
      _loading = false;
    });
  }

  String _formatTs(dynamic ts) {
    if (ts == null) return '';
    final d = parseDataApi(ts);
    if (d == null) return ts.toString();
    final pad = (int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  ({IconData icon, Color color, String label}) _styleForEvento(String evento, String? observacao) {
    // Qualquer acesso negado com observação (anti-passback, sem liberação, etc.) é marcado como BLOQUEADO
    final isBlocked = evento == 'negado' &&
        (observacao ?? '').trim().isNotEmpty;
    switch (evento) {
      case 'entrada':
        return (icon: PhosphorIcons.signIn, color: AppColors.success, label: 'Entrou');
      case 'saida':
        return (icon: PhosphorIcons.signOut, color: AppColors.primary, label: 'Saiu');
      case 'negado':
        return isBlocked
            ? (icon: PhosphorIcons.prohibit, color: Colors.red, label: 'BLOQUEADO')
            : (icon: PhosphorIcons.xCircle, color: Colors.red, label: 'Negado');
      default:
        return (
          icon: PhosphorIcons.scan,
          color: AppColors.textSecondary(context),
          label: evento,
        );
    }
  }

  /// Mapeia o tipo de dispositivo para ícone + rótulo do método.
  /// Espelha labelMetodoDispositivo() do backend (dashboard.service.ts).
  ({IconData icon, String label}) _styleForMetodo(String? tipoDispositivo) {
    switch (tipoDispositivo) {
      case 'tag_reader':
        return (icon: PhosphorIcons.tag, label: 'Tag RFID');
      case 'qrcode_reader':
        return (icon: PhosphorIcons.qrCode, label: 'QR Code');
      case 'catraca':
        return (icon: PhosphorIcons.identificationCard, label: 'Catraca');
      case 'botoeira':
        return (icon: PhosphorIcons.bell, label: 'Botoeira');
      case 'facial':
        return (icon: PhosphorIcons.scan, label: 'Facial');
      case 'pin':
        return (icon: PhosphorIcons.key, label: 'PIN / Manual');
      default:
        // Eventos antigos/sem tipo definido: rótulo genérico para não ficar vazio.
        return (icon: PhosphorIcons.signIn, label: 'Acesso');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primary,
            ),
          ),
        ),
      );
    }

    if (_acessos.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.textSecondary(context).withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(PhosphorIcons.scan, color: AppColors.textTertiary(context), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Nenhum acesso registrado ainda.',
                style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Row(
            children: [
              Icon(PhosphorIcons.clockCounterClockwise, color: AppColors.primary, size: 16),
              const SizedBox(width: 6),
              Text(
                'Últimos acessos',
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: _acessos.map((a) {
              final evento = (a['evento'] ?? '').toString();
              final observacao = a['observacao']?.toString();
              final style = _styleForEvento(evento, observacao);
              final metodo = _styleForMetodo(a['tipo_dispositivo']?.toString());
              final isLast = a == _acessos.last;
              return Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  border: !isLast
                      ? Border(
                          bottom: BorderSide(
                            color: AppColors.textTertiary(context).withOpacity(0.1),
                          ),
                        )
                      : null,
                ),
                child: Row(
                  children: [
                    Icon(style.icon, color: style.color, size: 18),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  style.label,
                                  style: AppTypography.captionMedium(context).copyWith(color: style.color),
                                ),
                              ),
                              const SizedBox(width: 6),
                              // Chip do método (Facial / Tag RFID / QR Code / etc.)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withOpacity(0.10),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(metodo.icon, color: AppColors.primary, size: 11),
                                    const SizedBox(width: 3),
                                    Text(
                                      metodo.label,
                                      style: AppTypography.tiny(context).copyWith(
                                        color: AppColors.primary,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 1),
                          Text(
                            _formatTs(a['timestamp']),
                            style: AppTypography.tiny(context).copyWith(
                              color: AppColors.textSecondary(context),
                            ),
                          ),
                          if (observacao != null && observacao.trim().isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              observacao.trim(),
                              style: AppTypography.tiny(context).copyWith(
                                color: style.color.withOpacity(0.7),
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (a['confianca'] != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.textSecondary(context).withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '${((a['confianca'] as num) * 100).toStringAsFixed(0)}%',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.textSecondary(context),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                  ],
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}
