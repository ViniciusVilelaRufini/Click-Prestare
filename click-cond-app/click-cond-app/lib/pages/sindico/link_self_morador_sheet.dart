import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Abre o fluxo "Vincular-me como morador" para o síndico.
/// Retorna o Map de resposta da API ({id_condominio, apto_id, apto, apto_bloco, apto_tipo})
/// em caso de sucesso, ou `null` se o usuário cancelar.
Future<Map<String, dynamic>?> showLinkSelfMoradorSheet(BuildContext context) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.bg(context),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => const _LinkSelfMoradorSheet(),
  );
}

class _LinkSelfMoradorSheet extends StatefulWidget {
  const _LinkSelfMoradorSheet({Key? key}) : super(key: key);

  @override
  State<_LinkSelfMoradorSheet> createState() => _LinkSelfMoradorSheetState();
}

class _LinkSelfMoradorSheetState extends State<_LinkSelfMoradorSheet> {
  bool _loading = true;
  bool _saving = false;
  List<dynamic> _aptos = [];
  dynamic _selectedAptoId;
  String _tipo = 'Proprietário';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await apiGetAll('apartamentos');
      _aptos = list is List ? list : [];
    } catch (_) {
      _aptos = [];
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _aptoLabel(dynamic a) {
    final bloco = (a['bloco'] ?? '').toString();
    final apto = (a['apto'] ?? a['numero'] ?? '').toString();
    return bloco.isNotEmpty ? 'Bloco $bloco - Apto $apto' : 'Apto $apto';
  }

  Future<void> _submit() async {
    if (_selectedAptoId == null) {
      displayMessage(context, getText('alert'), 'Selecione o seu apartamento.');
      return;
    }
    setState(() => _saving = true);
    try {
      final res = await apiLinkSindicoMorador(_selectedAptoId, _tipo);
      if (!mounted) return;
      Navigator.of(context).pop(res as Map<String, dynamic>);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.lg + bottomInset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(PhosphorIcons.house, color: AppColors.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text('Vincular-me como morador',
                    style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Selecione o apartamento em que você mora neste condomínio e o seu vínculo.',
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
          const SizedBox(height: AppSpacing.lg),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_aptos.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Text('Nenhum apartamento cadastrado neste condomínio.',
                  style: AppTypography.body(context)),
            )
          else ...[
            Text('APARTAMENTO',
                style: AppTypography.tiny(context)
                    .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold, letterSpacing: 0.8)),
            const SizedBox(height: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.textSecondary(context).withOpacity(0.1)),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<dynamic>(
                  isExpanded: true,
                  value: _selectedAptoId,
                  hint: const Text('Selecione o apartamento'),
                  items: _aptos
                      .map((a) => DropdownMenuItem(value: a['id'], child: Text(_aptoLabel(a))))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedAptoId = v),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text('VÍNCULO',
                style: AppTypography.tiny(context)
                    .copyWith(color: AppColors.primary, fontWeight: FontWeight.bold, letterSpacing: 0.8)),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                _tipoChip('Proprietário'),
                const SizedBox(width: AppSpacing.sm),
                _tipoChip('Inquilino'),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: 'Vincular',
              onPressed: _saving ? null : _submit,
              loading: _saving,
              icon: PhosphorIcons.check,
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }

  Widget _tipoChip(String value) {
    final selected = _tipo == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tipo = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: selected ? AppColors.primary : AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.textSecondary(context).withOpacity(0.15),
            ),
          ),
          child: Center(
            child: Text(
              value,
              style: AppTypography.bodyMedium(context).copyWith(
                color: selected ? Colors.white : AppColors.textPrimary(context),
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
