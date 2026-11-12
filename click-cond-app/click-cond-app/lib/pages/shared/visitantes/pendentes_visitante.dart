import 'package:click/utils/rotulo_bloco.dart';
import 'package:click/utils/autorizacoes_controle.dart';
import 'dart:async';
import 'dart:convert';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/navigation_service.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_tag.dart';
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
Widget _buildVisitorAvatar(
  BuildContext context, {
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
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: AppColors.border(context),
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
            context,
            isPrestador: isPrestador,
            size: size,
            radius: radius,
          ),
        ),
      ),
    );
  }

  return _buildFallbackAvatar(
    context,
    isPrestador: isPrestador,
    size: size,
    radius: radius,
  );
}

Widget _buildFallbackAvatar(
  BuildContext context, {
  required bool isPrestador,
  double size = 48,
  double radius = 12,
}) {
  return Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: AppColors.surface(context),
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.surface(context), width: 1),
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
  const PendentesVisitantePage({super.key});

  @override
  State<PendentesVisitantePage> createState() => _PendentesVisitantePageState();
}

class _PendentesVisitantePageState extends State<PendentesVisitantePage>
    with WidgetsBindingObserver {
  List<dynamic> _list = [];
  bool _isLoading = true;
  int? _respondendoId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _iniciarPoll();
  }

  void _iniciarPoll() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _load(silent: true));
  }

  /// O timer rodava mesmo com o app em segundo plano: seis requisicoes por
  /// minuto, indefinidamente, gastando bateria e dados para atualizar uma tela
  /// que ninguem esta vendo.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _load(silent: true);
      _iniciarPoll();
    } else {
      _poll?.cancel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);
    final data = await apiGetPendentes();
    if (!mounted) return;
    setState(() {
      // Filtra o que ja foi decidido: a resposta pode ter saido do servidor
      // ANTES da decisao e, sem isto, o card ressuscita e o morador autoriza
      // de novo o mesmo visitante.
      _list = data is List
          ? data.where((e) => !ControleAutorizacoes.instance.jaDecidido(_idDe(e))).toList()
          : [];
      _isLoading = false;
    });
  }

  int _idDe(dynamic item) {
    final id = item is Map ? item['id'] : null;
    if (id is int) return id;
    return int.tryParse(id?.toString() ?? '') ?? -1;
  }

  Future<void> _responder(dynamic item, bool autorizar, {bool darEntrada = false}) async {
    final id = item['id'];
    if (id == null) return;
    // O diálogo do push pode estar decidindo este mesmo id neste instante:
    // quem assume primeiro responde, o outro desiste em silêncio.
    if (!ControleAutorizacoes.instance.assumirDecisao(id as int)) return;
    setState(() => _respondendoId = id);
    final res = await apiResponderAutorizacao(id, autorizar, darEntrada: darEntrada);
    if (res is Map) {
      ControleAutorizacoes.instance.decidiu(id);
    } else {
      ControleAutorizacoes.instance.desistiuDaDecisao(id);
    }
    if (!mounted) return;
    setState(() => _respondendoId = null);
    if (res is Map) {
      setState(() => _list.removeWhere((e) => e['id'] == id));
      final nome = (item['nome'] ?? 'Visitante').toString();
      final msg = !autorizar
          ? '$nome foi negado.'
          : darEntrada
              ? 'Entrada registrada! $nome foi liberado e a entrada foi confirmada.'
              : '$nome foi autorizado a entrar (facial/acesso liberado).';
      final titulo = !autorizar
          ? 'Negado'
          : darEntrada
              ? 'Entrada Registrada'
              : 'Autorizado';
      displayMessage(context, titulo, msg);
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
                : ListView(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    children: [
                      Row(
                        children: [
                          Text('Pendentes'.toUpperCase(), style: AppTypography.label(context)),
                          const SizedBox(width: 8),
                          Text(
                            _list.length.toString().padLeft(2, '0'),
                            style: AppTypography.label(context).copyWith(color: AppColors.textPrimary(context)),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                      for (var i = 0; i < _list.length; i++) ...[
                        if (i > 0) const SizedBox(height: AppSpacing.md),
                        _card(context, _list[i]),
                      ],
                    ],
                  ),
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 120),
        Center(child: AppIconBox(icon: PhosphorIcons.bellSlash, size: 56, iconSize: 24)),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: Text(
            'Nenhuma solicitação pendente'.toUpperCase(),
            style: AppTypography.section(context),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Center(
          child: Text(
            'Quando um visitante chegar na portaria, o pedido aparecerá aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.bodySecondary(context),
          ),
        ),
      ],
    );
  }

  Widget _card(BuildContext context, dynamic item) {
    final nome = (item['nome'] ?? 'Visitante').toString();
    final apto = (item['apto'] ?? '').toString();
    final bloco = (item['apto_bloco'] ?? '').toString();
    final isPrestador = item['is_prestador'] == 1 || item['is_prestador'] == true;
    final photo = (item['photo'] ?? item['foto_pessoa'])?.toString();
    final aptoLabel = bloco.isNotEmpty ? '${rotuloBloco(bloco)}, Apto $apto' : 'Apto $apto';
    final respondendo = _respondendoId == item['id'];

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.zero,
        border: Border.all(
          color: AppColors.border(context),
          width: 1,
        ),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildVisitorAvatar(
                context,
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
                            style: AppTypography.strong(context),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const AppTag(label: 'Aguardando', signal: AppSignal.warn),
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
                            style: AppTypography.tiny(context),
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
            Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () => _responder(item, false),
                          child: Container(
                            height: 48,
                            decoration: BoxDecoration(
                              border: Border.all(color: AppColors.borderStrong(context)),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(PhosphorIcons.x, size: 16, color: AppColors.textPrimary(context)),
                                const SizedBox(width: 6),
                                Text(
                                  'Negar'.toUpperCase(),
                                  style: AppTypography.label(context).copyWith(color: AppColors.textPrimary(context)),
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
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () => _responder(item, true, darEntrada: false),
                          child: Container(
                            height: 48,
                            decoration: BoxDecoration(
                              border: Border.all(color: AppColors.borderStrong(context)),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(PhosphorIcons.check, size: 16, color: AppColors.textPrimary(context)),
                                const SizedBox(width: 6),
                                Text(
                                  'Autorizar'.toUpperCase(),
                                  style: AppTypography.label(context).copyWith(color: AppColors.textPrimary(context)),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Material(
                  color: AppColors.brand,
                  borderRadius: BorderRadius.zero,
                  child: InkWell(
                    borderRadius: BorderRadius.zero,
                    onTap: () => _responder(item, true, darEntrada: true),
                    child: Container(
                      height: 48,
                      width: double.infinity,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(PhosphorIcons.signIn, size: 18, color: AppColors.onBrand),
                          SizedBox(width: 8),
                          Text(
                            'Autorizar e Dar Entrada'.toUpperCase(),
                            style: AppTypography.button(context).copyWith(color: AppColors.onBrand),
                          ),
                        ],
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

enum DecisaoAutorizacao { negar, autorizar, autorizarEntrada }

/// Diálogo acionável disparado por um push de autorização (portaria remota em primeiro plano).
/// Usa o navigatorKey global — pode ser chamado do handler FCM sem context.
Future<void> mostrarDialogoAutorizacaoVisitante({
  required int id,
  String? nome,
  String? photo,
}) async {
  // O FCM reentrega mensagens e dois visitantes podem chegar juntos: sem esta
  // guarda, os dialogos se empilham sobre o mesmo navigator.
  if (!ControleAutorizacoes.instance.podeAbrirDialogo(id)) return;

  final ctx = NavigationService.navigatorKey.currentContext;
  if (ctx == null) return;
  ControleAutorizacoes.instance.abriu(id);
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

  // barrierDismissible false de proposito: com true, encostar na tela fechava
  // o dialogo sem enviar nada e sem avisar ninguem — o porteiro seguia
  // esperando com o visitante no portao. Quem quer adiar usa "Decidir depois".
  // O ctx foi capturado antes do await que busca a foto: revalida.
  if (!ctx.mounted) {
    ControleAutorizacoes.instance.fechou(id);
    return;
  }
  final decisao = await showDialog<DecisaoAutorizacao?>(
    context: ctx,
    barrierDismissible: false,
    builder: (c) => Dialog(
      backgroundColor: AppColors.surface(c),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      elevation: 0,
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
                  c,
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
                          color: AppColors.surface(c),
                          borderRadius: BorderRadius.zero,
                          border: Border.all(color: AppColors.border(c), width: 1),
                        ),
                        child: Text(
                          'Aguardando liberação',
                          style: TextStyle(
                            color: AppColors.error,
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
                color: AppColors.surface(c),
                borderRadius: BorderRadius.zero,
                border: Border.all(
                  color: AppColors.border(c),
                ),
              ),
              child: RichText(
                text: TextSpan(
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary(c),
                    height: 1.4,
                  ),
                  children: [
                    TextSpan(
                      text: nomeLabel,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AppColors.textPrimary(c),
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
                    color: AppColors.surface(c),
                    borderRadius: BorderRadius.zero,
                    child: InkWell(
                      borderRadius: BorderRadius.zero,
                      onTap: () => Navigator.pop(c, DecisaoAutorizacao.negar),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.zero,
                          border: Border.all(
                            color: AppColors.border(c),
                            width: 1,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(PhosphorIcons.x, size: 16, color: AppColors.error),
                            SizedBox(width: 6),
                            Text(
                              'Negar',
                              style: TextStyle(
                                color: AppColors.error,
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
                    color: AppColors.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.zero,
                    child: InkWell(
                      borderRadius: BorderRadius.zero,
                      onTap: () => Navigator.pop(c, DecisaoAutorizacao.autorizar),
                      child: Container(
                        height: 44,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.zero,
                          border: Border.all(
                            color: AppColors.primary.withValues(alpha: 0.35),
                            width: 1,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(PhosphorIcons.check, size: 17, color: AppColors.primary),
                            const SizedBox(width: 6),
                            Text(
                              'Autorizar',
                              style: TextStyle(
                                color: AppColors.primary,
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
            const SizedBox(height: 8),
            Material(
              color: AppColors.brand,
              borderRadius: BorderRadius.zero,
              child: InkWell(
                borderRadius: BorderRadius.zero,
                onTap: () => Navigator.pop(c, DecisaoAutorizacao.autorizarEntrada),
                child: Container(
                  height: 48,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.zero,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(PhosphorIcons.signIn, size: 18, color: AppColors.onBrand),
                      SizedBox(width: 8),
                      Text(
                            'Autorizar e Dar Entrada'.toUpperCase(),
                            style: AppTypography.button(c).copyWith(color: AppColors.onBrand),
                          ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            // Saída explícita, já que o toque fora não fecha mais. Sem ela, o
            // morador que não quer decidir agora ficaria preso no diálogo.
            TextButton(
              onPressed: () => Navigator.pop(c, null),
              child: Text(
                'Decidir depois',
                style: TextStyle(
                  color: isDark ? AppColors.textTertiary(c) : AppColors.textSecondary(c),
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
  if (decisao == null) {
    // "Decidir depois": segue pendente e reabrivel pela tela de pendentes.
    ControleAutorizacoes.instance.fechou(id);
    return;
  }
  // A tela de pendentes faz poll a cada 10s e pode estar aberta ao mesmo
  // tempo: quem assume primeiro decide, o outro desiste.
  if (!ControleAutorizacoes.instance.assumirDecisao(id)) {
    ControleAutorizacoes.instance.fechou(id);
    return;
  }
  final bool autorizar = decisao != DecisaoAutorizacao.negar;
  final bool darEntrada = decisao == DecisaoAutorizacao.autorizarEntrada;
  final res = await apiResponderAutorizacao(id, autorizar, darEntrada: darEntrada);
  if (res is Map) {
    ControleAutorizacoes.instance.decidiu(id);
  } else {
    // Falhou: devolve o id para o morador poder tentar de novo.
    ControleAutorizacoes.instance.desistiuDaDecisao(id);
    ControleAutorizacoes.instance.fechou(id);
  }
  final ctx2 = NavigationService.navigatorKey.currentContext;
  if (ctx2 == null || !ctx2.mounted) return;
  if (res is Map) {
    final msg = !autorizar
        ? '$nomeLabel foi negado.'
        : darEntrada
            ? 'Entrada registrada! $nomeLabel foi liberado e a entrada foi confirmada.'
            : '$nomeLabel foi autorizado a entrar (facial/acesso liberado).';
    final titulo = !autorizar
        ? 'Negado'
        : darEntrada
            ? 'Entrada Registrada'
            : 'Autorizado';
    displayMessage(ctx2, titulo, msg);
  } else {
    displayMessage(ctx2, 'Erro', res.toString());
  }
}
