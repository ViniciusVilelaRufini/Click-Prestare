import 'dart:async';
import 'dart:convert';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Helper para converter string de foto (URL, caminho relativo ou Base64) em ImageProvider.
ImageProvider? _getVisitorImageProvider(String? photo) {
  if (photo == null || photo.trim().isEmpty || photo == 'null' || photo == 'undefined') {
    return null;
  }
  final clean = photo.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return NetworkImage(clean);
  }
  if (clean.startsWith('data:image')) {
    try {
      final commaIndex = clean.indexOf(',');
      final base64Str = commaIndex != -1 ? clean.substring(commaIndex + 1) : clean;
      return MemoryImage(base64Decode(base64Str.replaceAll(RegExp(r'\s+'), '')));
    } catch (_) {
      return null;
    }
  }
  if (clean.length > 100 && !clean.contains('/') && !clean.contains('.')) {
    try {
      return MemoryImage(base64Decode(clean.replaceAll(RegExp(r'\s+'), '')));
    } catch (_) {
      return null;
    }
  }
  final host = ApiConfig.host;
  final scheme = ApiConfig.useHttps ? 'https' : 'http';
  final relative = clean.startsWith('/') ? clean : '/$clean';
  return NetworkImage('$scheme://$host$relative');
}

/// Constrói o avatar do visitante com foto real ou ícone estilizado.
Widget _buildVisitorAvatar({
  String? photo,
  required bool isPrestador,
  double size = 48,
  double radius = 12,
}) {
  final imageProvider = _getVisitorImageProvider(photo);

  if (imageProvider != null) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
          width: 1,
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius - 1),
        child: Image(
          image: imageProvider,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _buildFallbackAvatar(
            isPrestador: isPrestador,
            size: size,
            radius: radius,
          ),
        ),
      ),
    );
  }

  return _buildFallbackAvatar(
    isPrestador: isPrestador,
    size: size,
    radius: radius,
  );
}

Widget _buildFallbackAvatar({
  required bool isPrestador,
  double size = 48,
  double radius = 12,
}) {
  return Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: const Color(0xFFEFF6FF),
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: const Color(0xFFDBEAFE), width: 1),
    ),
    child: Icon(
      isPrestador ? PhosphorIcons.wrench : PhosphorIcons.user,
      color: AppColors.primary,
      size: size * 0.5,
    ),
  );
}

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
        Center(
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.bellSlash, size: 36, color: AppColors.primary),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: Text(
            'Nenhuma solicitação pendente',
            style: AppTypography.title(context).copyWith(fontSize: 17),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Center(
          child: Text(
            'Quando um visitante chegar na portaria, o pedido aparecerá aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context),
          ),
        ),
      ],
    );
  }

  Widget _card(BuildContext context, dynamic item) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final nome = (item['nome'] ?? 'Visitante').toString();
    final apto = (item['apto'] ?? '').toString();
    final bloco = (item['apto_bloco'] ?? '').toString();
    final isPrestador = item['is_prestador'] == 1 || item['is_prestador'] == true;
    final photo = (item['photo'] ?? item['foto_pessoa'])?.toString();
    final aptoLabel = bloco.isNotEmpty ? 'Bloco $bloco, Apto $apto' : 'Apto $apto';
    final respondendo = _respondendoId == item['id'];

    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildVisitorAvatar(
                photo: photo,
                isPrestador: isPrestador,
                size: 48,
                radius: 12,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            nome,
                            style: AppTypography.title(context).copyWith(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF2F2),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                              color: const Color(0xFFFECACA),
                              width: 1,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: const [
                              Text(
                                'Aguardando',
                                style: TextStyle(
                                  color: Color(0xFFDC2626),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          PhosphorIcons.mapPin,
                          size: 14,
                          color: AppColors.textSecondary(context),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            '${isPrestador ? "Prestador de serviço" : "Visitante na portaria"} • $aptoLabel',
                            style: AppTypography.caption(context).copyWith(
                              color: AppColors.textSecondary(context),
                              fontSize: 12.5,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (respondendo)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(12),
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            Row(
              children: [
                Expanded(
                  child: Material(
                    color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => _responder(item, false),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                            width: 1,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            Icon(PhosphorIcons.x, size: 16, color: Color(0xFFDC2626)),
                            SizedBox(width: 6),
                            Text(
                              'Negar',
                              style: TextStyle(
                                color: Color(0xFFDC2626),
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Material(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => _responder(item, true),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            Icon(PhosphorIcons.check, size: 16, color: Colors.white),
                            SizedBox(width: 6),
                            Text(
                              'Autorizar',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
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

/// Diálogo acionável disparado por um push de autorização (portaria remota em primeiro plano).
/// Usa o navigatorKey global — pode ser chamado do handler FCM sem context.
Future<void> mostrarDialogoAutorizacaoVisitante({
  required int id,
  String? nome,
  String? photo,
}) async {
  final ctx = NavigationService.navigatorKey.currentContext;
  if (ctx == null) return;
  final isDark = Theme.of(ctx).brightness == Brightness.dark;
  final nomeLabel = (nome != null && nome.isNotEmpty) ? nome : 'Um visitante';

  String? fotoFinal = photo;
  if (fotoFinal == null || fotoFinal.isEmpty) {
    try {
      final pendentes = await apiGetPendentes();
      if (pendentes is List) {
        final match = pendentes.firstWhere((e) => e['id'] == id, orElse: () => null);
        if (match != null) {
          fotoFinal = (match['photo'] ?? match['foto_pessoa'])?.toString();
        }
      }
    } catch (_) {}
  }

  final autorizar = await showDialog<bool?>(
    context: ctx,
    barrierDismissible: true,
    builder: (c) => Dialog(
      backgroundColor: isDark ? const Color(0xFF1E293B) : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      elevation: 8,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _buildVisitorAvatar(
                  photo: fotoFinal,
                  isPrestador: false,
                  size: 48,
                  radius: 12,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Visitante na Portaria',
                        style: AppTypography.title(c).copyWith(
                          fontWeight: FontWeight.bold,
                          fontSize: 17,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFFFECACA), width: 1),
                        ),
                        child: const Text(
                          'Aguardando liberação',
                          style: TextStyle(
                            color: Color(0xFFDC2626),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0),
                ),
              ),
              child: RichText(
                text: TextSpan(
                  style: TextStyle(
                    fontSize: 14,
                    color: isDark ? Colors.white70 : const Color(0xFF334155),
                    height: 1.4,
                  ),
                  children: [
                    TextSpan(
                      text: nomeLabel,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isDark ? Colors.white : const Color(0xFF0F172A),
                      ),
                    ),
                    const TextSpan(
                      text: ' está na portaria aguardando autorização para entrar no condomínio.',
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: Material(
                    color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => Navigator.pop(c, false),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                            width: 1,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            Icon(PhosphorIcons.x, size: 16, color: Color(0xFFDC2626)),
                            SizedBox(width: 6),
                            Text(
                              'Negar',
                              style: TextStyle(
                                color: Color(0xFFDC2626),
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Material(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => Navigator.pop(c, true),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            Icon(PhosphorIcons.check, size: 16, color: Colors.white),
                            SizedBox(width: 6),
                            Text(
                              'Autorizar',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  if (autorizar == null) return;
  final res = await apiResponderAutorizacao(id, autorizar);
  final ctx2 = NavigationService.navigatorKey.currentContext;
  if (ctx2 == null) return;
  if (res is Map) {
    displayMessage(ctx2, autorizar ? 'Autorizado' : 'Negado',
        autorizar ? '$nomeLabel foi autorizado a entrar.' : '$nomeLabel foi negado.');
  } else {
    displayMessage(ctx2, 'Erro', res.toString());
  }
}
