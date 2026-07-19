import 'dart:async';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Portaria remota — tela "Solicitações pendentes" (inbox do morador).
/// Lista visitantes aguardando autorização e permite Autorizar/Negar.
class PendentesVisitantePage extends StatefulWidget {
  const PendentesVisitantePage({Key? key}) : super(key: key);

  @override
  State<PendentesVisitantePage> createState() => _PendentesVisitantePageState();
}

class _PendentesVisitantePageState extends State<PendentesVisitantePage> {
  List<dynamic> _list = [];
  bool _isLoading = true;
  int? _respondendoId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // Atualiza a lista periodicamente (a portaria pode enviar novos pedidos).
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);
    final data = await apiGetPendentes();
    if (!mounted) return;
    setState(() {
      _list = data is List ? data : [];
      _isLoading = false;
    });
  }

  Future<void> _responder(dynamic item, bool autorizar) async {
    final id = item['id'];
    if (id == null) return;
    setState(() => _respondendoId = id as int);
    final res = await apiResponderAutorizacao(id as int, autorizar);
    if (!mounted) return;
    setState(() => _respondendoId = null);
    if (res is Map) {
      setState(() => _list.removeWhere((e) => e['id'] == id));
      final nome = (item['nome'] ?? 'Visitante').toString();
      displayMessage(
        context,
        autorizar ? 'Autorizado' : 'Negado',
        autorizar
            ? '$nome foi autorizado a entrar.'
            : '$nome foi negado.',
      );
    } else {
      displayMessage(context, 'Erro', res.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Solicitações',
      body: RefreshIndicator(
        onRefresh: _load,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _list.isEmpty
                ? _empty(context)
                : ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    itemCount: _list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, i) => _card(context, _list[i]),
                  ),
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 120),
        Icon(PhosphorIcons.bellSlash, size: 48, color: AppColors.textTertiary(context)),
        const SizedBox(height: AppSpacing.md),
        Center(
          child: Text('Nenhuma solicitação pendente',
              style: AppTypography.bodyMedium(context)),
        ),
      ],
    );
  }

  Widget _card(BuildContext context, dynamic item) {
    final nome = (item['nome'] ?? 'Visitante').toString();
    final apto = (item['apto'] ?? '').toString();
    final bloco = (item['apto_bloco'] ?? '').toString();
    final isPrestador = item['is_prestador'] == 1 || item['is_prestador'] == true;
    final aptoLabel = bloco.isNotEmpty ? 'Bloco $bloco, Apto $apto' : 'Apto $apto';
    final respondendo = _respondendoId == item['id'];

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(isPrestador ? PhosphorIcons.wrench : PhosphorIcons.userCircle,
                  color: AppColors.warning, size: 28),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(nome,
                        style: AppTypography.bodyMedium(context)
                            .copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text('${isPrestador ? "Prestador" : "Visitante"} na portaria • $aptoLabel',
                        style: AppTypography.caption(context)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (respondendo)
            const Center(
                child: Padding(
              padding: EdgeInsets.all(8),
              child: SizedBox(
                  width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
            ))
          else
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _responder(item, false),
                    icon: Icon(PhosphorIcons.x, size: 18, color: AppColors.error),
                    label: Text('Negar', style: TextStyle(color: AppColors.error)),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(color: AppColors.error),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _responder(item, true),
                    icon: const Icon(PhosphorIcons.check, size: 18, color: Colors.white),
                    label: const Text('Autorizar', style: TextStyle(color: Colors.white)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.success,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// Diálogo acionável disparado por um push de autorização (portaria remota).
/// Usa o navigatorKey global — pode ser chamado do handler FCM sem context.
Future<void> mostrarDialogoAutorizacaoVisitante({
  required int id,
  String? nome,
}) async {
  final ctx = NavigationService.navigatorKey.currentContext;
  if (ctx == null) return;
  final nomeLabel = (nome != null && nome.isNotEmpty) ? nome : 'Um visitante';
  final autorizar = await showDialog<bool>(
    context: ctx,
    builder: (c) => AlertDialog(
      title: const Text('Visitante na portaria'),
      content: Text('$nomeLabel está na portaria pedindo autorização para entrar.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c, false),
          child: Text('Negar', style: TextStyle(color: AppColors.error)),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
          onPressed: () => Navigator.pop(c, true),
          child: const Text('Autorizar', style: TextStyle(color: Colors.white)),
        ),
      ],
    ),
  );
  if (autorizar == null) return; // fechou sem escolher
  final res = await apiResponderAutorizacao(id, autorizar);
  final ctx2 = NavigationService.navigatorKey.currentContext;
  if (ctx2 == null) return;
  if (res is Map) {
    displayMessage(ctx2, autorizar ? 'Autorizado' : 'Negado',
        autorizar ? '$nomeLabel foi autorizado.' : '$nomeLabel foi negado.');
  } else {
    displayMessage(ctx2, 'Erro', res.toString());
  }
}
