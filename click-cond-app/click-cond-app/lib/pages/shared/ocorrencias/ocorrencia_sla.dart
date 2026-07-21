import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Lê o prazo (SLA) de um item de ocorrência, tolerando os dois formatos de
/// backend: `prazo` (NestJS/prod, ISO) e `prazo_raw` (Express/dev, DATETIME).
DateTime? parsePrazoOcorrencia(dynamic item) {
  final raw = item is Map ? (item['prazo'] ?? item['prazo_raw']) : null;
  if (raw == null || raw.toString().isEmpty) return null;
  return DateTime.tryParse(raw.toString());
}

bool _isSolucionado(dynamic status) {
  final s = (status?.toString() ?? '').toLowerCase();
  return s == 'solucionado' || s == 'resolvida';
}

/// Selo visual do SLA de uma ocorrência.
/// - Solucionada  → neutro ("Concluída")
/// - Sem prazo    → neutro ("Sem prazo")
/// - Atrasada     → vermelho ("Atrasada")
/// - No prazo     → âmbar/verde ("Vence em Xh" / "Vence em Xd")
class OcorrenciaSlaBadge extends StatelessWidget {
  final dynamic item;
  final bool compact;
  const OcorrenciaSlaBadge({Key? key, required this.item, this.compact = false}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final data = _resolve();
    if (data == null) return const SizedBox.shrink();
    final fontSize = compact ? 9.0 : 11.0;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 8, vertical: compact ? 2 : 3),
      decoration: BoxDecoration(
        color: data.color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(data.icon, size: fontSize + 2, color: data.color),
          const SizedBox(width: 3),
          Text(
            data.label,
            style: AppTypography.captionMedium(context).copyWith(
              color: data.color,
              fontSize: fontSize,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  _SlaData? _resolve() {
    if (_isSolucionado(item is Map ? item['status'] : null)) {
      return _SlaData(const Color(0xFF6B7280), PhosphorIcons.checkCircle, 'Concluída');
    }
    final prazo = parsePrazoOcorrencia(item);
    if (prazo == null) {
      return _SlaData(const Color(0xFF6B7280), PhosphorIcons.minusCircle, 'Sem prazo');
    }
    final now = DateTime.now();
    if (now.isAfter(prazo)) {
      return _SlaData(const Color(0xFFEF4444), PhosphorIcons.warningCircle, 'Atrasada');
    }
    final diff = prazo.difference(now);
    final String txt;
    if (diff.inHours >= 48) {
      txt = 'Vence em ${diff.inDays}d';
    } else if (diff.inHours >= 1) {
      txt = 'Vence em ${diff.inHours}h';
    } else {
      txt = 'Vence em ${diff.inMinutes}min';
    }
    // Verde se folgado (>24h), âmbar se apertado.
    final color = diff.inHours >= 24 ? const Color(0xFF22C55E) : const Color(0xFFF59E0B);
    return _SlaData(color, PhosphorIcons.clock, txt);
  }
}

class _SlaData {
  final Color color;
  final IconData icon;
  final String label;
  _SlaData(this.color, this.icon, this.label);
}
