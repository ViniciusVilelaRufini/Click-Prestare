import 'package:click/utils/rotulo_bloco.dart';
import 'package:click/utils/autorizacoes_controle.dart';
import 'dart:async';
import 'dart:convert';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/services/atualizacoes_app.dart';
import 'package:click/services/card_ao_vivo/card_android.dart' show respostaRecusadaFechaCard;
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
  /// Condomínio do push tocado: lista os pendentes dele sem trocar o
  /// condomínio aberto no app. Null = o condomínio aberto.
  final int? idCondominio;
  const PendentesVisitantePage({super.key, this.idCondominio});

  @override
  State<PendentesVisitantePage> createState() => _PendentesVisitantePageState();
}

class _PendentesVisitantePageState extends State<PendentesVisitantePage>
    with WidgetsBindingObserver {
  List<dynamic> _list = [];
  bool _isLoading = true;

  /// A última busca falhou e não havia nada na tela: o vazio vira "não foi
  /// possível carregar", não "nenhuma solicitação".
  bool _falhou = false;
  int? _respondendoId;
  Timer? _poll;

  /// Push de visitante (pedido novo, respondido em outro aparelho, AUTORIZAR
  /// pela notificação): recarrega sem esperar o poll.
  StreamSubscription<DominioApp>? _atualizacoes;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _atualizacoes = ouvirAtualizacoes({DominioApp.visitante}, () {
      if (mounted) _load(silent: true);
    });
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
    _atualizacoes?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);
    final data = await apiGetPendentesOuNull(idCondominio: widget.idCondominio);
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      // Falha (rede, 401/5xx): fica o que está na tela. Antes virava `[]` e os
      // cards de Autorizar/Negar sumiam com o visitante no portão (A3).
      if (data == null) {
        _falhou = _list.isEmpty;
        return;
      }
      _falhou = false;
      // Filtra o que ja foi decidido: a resposta pode ter saido do servidor
      // ANTES da decisao e, sem isto, o card ressuscita e o morador autoriza
      // de novo o mesmo visitante. A rodada separa o pedido refeito para o
      // mesmo id (a API reaproveita a visita), que precisa aparecer (F3).
      _list = data
          .where((e) => !ControleAutorizacoes.instance.jaDecidido(_idDe(e), rodada: _rodadaDe(e)))
          .toList();
    });
  }

  int? _rodadaDe(dynamic item) => item is Map ? rodadaDoPedido(item['auth_solicitado_em']) : null;

  int _idDe(dynamic item) {
    final id = item is Map ? item['id'] : null;
    if (id is int) return id;
    return int.tryParse(id?.toString() ?? '') ?? -1;
  }

  Future<void> _responder(dynamic item, bool autorizar, {bool darEntrada = false}) async {
    final id = item['id'];
    if (id == null) return;
    final rodada = _rodadaDe(item);
    // O diálogo do push pode estar decidindo este mesmo id neste instante:
    // quem assume primeiro responde, o outro desiste em silêncio.
    if (!ControleAutorizacoes.instance.assumirDecisao(id as int, rodada: rodada)) return;
    setState(() => _respondendoId = id);
    final r = await apiResponderAutorizacaoComStatus(id, autorizar, darEntrada: darEntrada);
    final ok = r.erro == null;
    // 400/409: o pedido já não aceita resposta (outro morador respondeu,
    // venceu, a portaria cancelou). Sai da lista em vez de ficar ali.
    final encerrado = !ok && respostaRecusadaFechaCard(r.statusCode);
    if (ok || encerrado) {
      ControleAutorizacoes.instance.decidiu(id, rodada: rodada);
    } else {
      ControleAutorizacoes.instance.desistiuDaDecisao(id);
    }
    if (!mounted) return;
    setState(() => _respondendoId = null);
    if (encerrado) {
      setState(() => _list.removeWhere((e) => e['id'] == id));
      displayMessage(context, 'Aviso', '${r.erro}');
      _load(silent: true);
      return;
    }
    if (ok) {
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
      displayMessage(context, 'Erro', '${r.erro}');
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
            (_falhou ? 'Não foi possível carregar' : 'Nenhuma solicitação pendente').toUpperCase(),
            style: AppTypography.section(context),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Center(
          child: Text(
            _falhou
                ? 'Verifique a conexão. Puxe para baixo para tentar de novo.'
                : 'Quando um visitante chegar na portaria, o pedido aparecerá aqui.',
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

/// Texto mostrado quando o diálogo fecha porque o pedido acabou por fora
/// (push de fase final do card: outro morador respondeu, venceu, a portaria
/// encerrou).
String textoPedidoEncerradoPorFora(String nome, String fase) => switch (fase) {
      'liberado' => 'A entrada de $nome já foi autorizada.',
      'entrou' => '$nome já entrou.',
      'negado' => 'A entrada de $nome já foi negada.',
      'expirado' => 'O pedido de $nome expirou.',
      _ => 'O pedido de $nome não está mais aguardando resposta.',
    };

/// Busca o pedido na lista de pendentes do servidor (foto e rodada que o push
/// não trouxe). Null em falha ou se ele não estiver mais pendente.
Future<Map?> _pendenteDoServidor(int id) async {
  try {
    final pendentes = await apiGetPendentesOuNull();
    if (pendentes == null) return null;
    for (final e in pendentes) {
      if (e is Map && '${e['id']}' == '$id') return e;
    }
  } catch (_) {}
  return null;
}

/// Diálogo acionável disparado por um push de autorização (portaria remota em primeiro plano).
/// Usa o navigatorKey global — pode ser chamado do handler FCM sem context.
///
/// [rodada]: a do pedido ([rodadaDoPedido]); o card manda `chegouEm`. O
/// push comum não manda, e a rodada vem da lista de pendentes.
Future<void> mostrarDialogoAutorizacaoVisitante({
  required int id,
  String? nome,
  String? photo,
  int? rodada,
}) async {
  final controle = ControleAutorizacoes.instance;
  Map? doServidor;
  bool buscou = false;
  // O FCM reentrega mensagens e dois visitantes podem chegar juntos: sem esta
  // guarda, os dialogos se empilham sobre o mesmo navigator.
  if (!controle.podeAbrirDialogo(id, rodada: rodada)) {
    // Id já decidido e push sem rodada (push comum): pode ser o porteiro
    // pedindo de novo para o mesmo visitante. O servidor diz a rodada (F3).
    if (rodada != null || !controle.jaDecidido(id)) return;
    doServidor = await _pendenteDoServidor(id);
    buscou = true;
    rodada = rodadaDoPedido(doServidor?['auth_solicitado_em']);
    if (rodada == null || !controle.podeAbrirDialogo(id, rodada: rodada)) return;
  }

  final ctx = NavigationService.navigatorKey.currentContext;
  if (ctx == null || !ctx.mounted) return;

  // Fechamento por fora (fase final por push, AUTORIZAR pela notificação):
  // antes do diálogo aparecer só marca; com ele na tela, tira da tela.
  String? encerradoPorFora;
  BuildContext? ctxDialogo;
  controle.abriu(id, fechar: (fase) {
    encerradoPorFora = fase;
    final c = ctxDialogo;
    if (c != null && c.mounted) Navigator.of(c).pop();
  });
  final nomeLabel = (nome != null && nome.isNotEmpty) ? nome : 'Um visitante';

  String? fotoFinal = photo;
  if ((fotoFinal == null || fotoFinal.isEmpty || rodada == null) && !buscou) {
    doServidor = await _pendenteDoServidor(id);
  }
  if (fotoFinal == null || fotoFinal.isEmpty) {
    fotoFinal = (doServidor?['photo'] ?? doServidor?['foto_pessoa'])?.toString();
  }
  rodada ??= rodadaDoPedido(doServidor?['auth_solicitado_em']);

  // barrierDismissible false de proposito: com true, encostar na tela fechava
  // o dialogo sem enviar nada e sem avisar ninguem — o porteiro seguia
  // esperando com o visitante no portao. Quem quer adiar usa "Decidir depois".
  // O ctx foi capturado antes do await que busca a foto: revalida.
  if (!ctx.mounted || encerradoPorFora != null) {
    controle.fechou(id);
    return;
  }
  final decisao = await showDialog<DecisaoAutorizacao?>(
    context: ctx,
    barrierDismissible: false,
    builder: (c) {
      ctxDialogo = c;
      return Dialog(
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
                  color: Theme.of(c).brightness == Brightness.dark
                      ? AppColors.textTertiary(c)
                      : AppColors.textSecondary(c),
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      ),
    );
    },
  );
  ctxDialogo = null;
  final fase = encerradoPorFora;
  if (fase != null) {
    // O pedido acabou por fora com o diálogo na tela (F13): avisa e sai.
    final ctxAviso = NavigationService.navigatorKey.currentContext;
    if (ctxAviso != null && ctxAviso.mounted) {
      ScaffoldMessenger.maybeOf(ctxAviso)
          ?.showSnackBar(SnackBar(content: Text(textoPedidoEncerradoPorFora(nomeLabel, fase))));
    }
    return;
  }
  if (decisao == null) {
    // "Decidir depois": segue pendente e reabrivel pela tela de pendentes.
    controle.fechou(id);
    return;
  }
  // A tela de pendentes faz poll a cada 10s e pode estar aberta ao mesmo
  // tempo: quem assume primeiro decide, o outro desiste.
  if (!controle.assumirDecisao(id, rodada: rodada)) {
    controle.fechou(id);
    return;
  }
  final bool autorizar = decisao != DecisaoAutorizacao.negar;
  final bool darEntrada = decisao == DecisaoAutorizacao.autorizarEntrada;
  final r = await apiResponderAutorizacaoComStatus(id, autorizar, darEntrada: darEntrada);
  final ok = r.erro == null;
  // 400/409: o pedido já não aceita resposta (outro morador respondeu,
  // venceu): conta como resolvido e a tela de pendentes recarrega (F13).
  final encerrado = !ok && respostaRecusadaFechaCard(r.statusCode);
  if (ok || encerrado) {
    controle.decidiu(id, rodada: rodada);
  } else {
    // Falhou: devolve o id para o morador poder tentar de novo.
    controle.desistiuDaDecisao(id);
    controle.fechou(id);
  }
  if (encerrado) AtualizacoesApp.avisar(DominioApp.visitante);
  final ctx2 = NavigationService.navigatorKey.currentContext;
  if (ctx2 == null || !ctx2.mounted) return;
  if (encerrado) {
    displayMessage(ctx2, 'Aviso', '${r.erro}');
    return;
  }
  if (ok) {
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
    displayMessage(ctx2, 'Erro', '${r.erro}');
  }
}
