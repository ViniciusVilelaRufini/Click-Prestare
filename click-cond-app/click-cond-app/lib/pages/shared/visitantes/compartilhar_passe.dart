import 'package:click/controllers/controller_credencial.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/access_invite_message.dart';
import 'package:click/utils/datas.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

/// Passe do visitante e do prestador (que é uma visita com `is_prestador`).
///
/// O QR que a lista mostrava era o próprio PIN desenhado: um print valia tanto
/// quanto o original, e a imagem enviada pelo WhatsApp era gerada em
/// um serviço de QR de terceiro, ou seja, o PIN saía da Prestare. Agora o morador
/// compartilha um link; a página do link mostra um QR que muda a cada 30 s,
/// buscado na API. O PIN continua na mensagem como alternativa.
///
/// A URL do passe abre o portão para quem a tiver: não vai para log.
class CompartilharPasse {
  static Future<Map<String, dynamic>> Function(int idVisita) pedirLink = apiLinkPasseVisita;
  static Future<Map<String, dynamic>> Function(int idVisita) invalidarLink = apiInvalidarLinkPasse;
  static Future<bool> Function(Uri uri) abrirWhatsApp = _abrirExterno;

  /// Texto do convite. Com o link da API, leva o link do passe; sem ele (erro,
  /// sem rede, opção desligada), só o PIN, para não travar o morador.
  static Future<String> mensagem(dynamic item) async {
    final id = _idDaVisita(item);
    String? passeUrl;
    if (id != null) {
      try {
        final r = await pedirLink(id);
        final url = r['url'];
        if (r['erro'] == null && url is String && url.startsWith('https://')) passeUrl = url;
      } catch (_) {}
    }
    return _montar(item, passeUrl);
  }

  /// Monta a mensagem e abre o WhatsApp (direto no número do visitante, se
  /// houver). Sem WhatsApp, copia o texto.
  static Future<void> compartilhar(BuildContext context, dynamic item) async {
    final texto = await mensagem(item);
    final uri = Uri.parse(_linkWhatsApp(item, texto));
    var abriu = false;
    try {
      abriu = await abrirWhatsApp(uri);
    } catch (_) {
      abriu = false;
    }
    if (abriu) return;
    await Clipboard.setData(ClipboardData(text: texto));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('WhatsApp não aberto. Convite copiado para a área de transferência.'),
        duration: Duration(seconds: 3),
      ),
    );
  }

  /// Invalida o link já enviado, depois de confirmar.
  static Future<void> cancelarLink(BuildContext context, dynamic item) async {
    final id = _idDaVisita(item);
    if (id == null) return;
    final confirmou = await showAppConfirmDialog(
      context,
      title: 'Cancelar o link do passe?',
      message: 'O link enviado deixa de funcionar. Continuar?',
      confirmLabel: 'Cancelar link',
      cancelLabel: 'Voltar',
      isDanger: true,
      icon: PhosphorIcons.linkBreak,
    );
    if (!confirmou) return;
    Map<String, dynamic> r;
    try {
      r = await invalidarLink(id);
    } catch (_) {
      r = {'erro': 'Sem conexão com a internet.'};
    }
    if (!context.mounted) return;
    final erro = r['erro'];
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(erro == null ? 'Link cancelado. Envie o passe de novo se precisar.' : erro.toString()),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  static int? _idDaVisita(dynamic item) {
    final v = item is Map ? item['id'] : null;
    if (v is int) return v;
    return int.tryParse('${v ?? ''}');
  }

  static String _montar(dynamic item, String? passeUrl) {
    final nomeVisitante = (item['nome'] ?? 'Visitante').toString().trim();
    final isPrestador = item['is_prestador'] == 1;

    final condNome = (item['condominio_nome'] ?? '').toString().trim().isNotEmpty
        ? item['condominio_nome'].toString().trim()
        : (Singleton.instance.condominio_nome.isNotEmpty ? Singleton.instance.condominio_nome : 'Condomínio');

    final moradorNome = (item['morador_nome'] ?? '').toString().trim().isNotEmpty
        ? item['morador_nome'].toString().trim()
        : (getUsername().isNotEmpty ? getUsername() : 'Morador');

    final rawCode = (item['codigo_acesso'] ?? '').toString().trim();
    final codigo = rawCode.length == 6 ? '${rawCode.substring(0, 3)}-${rawCode.substring(3, 6)}' : rawCode;

    return buildVisitorAccessInvite(
      condominioNome: condNome,
      bloco: (item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim(),
      apartamento: (item['apto'] ?? '').toString().trim(),
      autorizadoPor: moradorNome,
      codigo: codigo,
      visitanteNome: nomeVisitante,
      tipoPessoa: isPrestador ? 'Prestador(a) de Serviço' : 'Visitante',
      periodo: periodoDoConvite(item['data_hora_inicio'], item['data_hora_termino']),
      passeUrl: passeUrl,
    );
  }

  static String _linkWhatsApp(dynamic item, String texto) {
    String? phone = (item['telefone'] ?? item['celular'] ?? item['whatsapp'] ?? item['phone'])?.toString();
    phone = phone?.replaceAll(RegExp(r'\D'), '');
    if (phone != null && phone.isNotEmpty && !phone.startsWith('55') && (phone.length == 10 || phone.length == 11)) {
      phone = '55$phone';
    }
    return (phone != null && phone.isNotEmpty)
        ? 'https://wa.me/$phone?text=${Uri.encodeComponent(texto)}'
        : 'https://wa.me/?text=${Uri.encodeComponent(texto)}';
  }

  static Future<bool> _abrirExterno(Uri uri) async {
    if (!await canLaunchUrl(uri)) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// Período liberado como aparece no convite e no detalhe da visita.
String periodoDoConvite(dynamic start, dynamic end) {
  if (start == null) return 'Qualquer data';
  final s = parseDataApi(start);
  final e = parseDataApi(end);
  if (s == null) return 'Qualquer data';

  String pad(int n) => n.toString().padLeft(2, '0');
  String format(DateTime d) => '${pad(d.day)}/${pad(d.month)}/${d.year} ${pad(d.hour)}:${pad(d.minute)}';

  if (e == null) return 'A partir de ${format(s)}';
  return '${format(s)} até ${format(e)}';
}

/// "Compartilhar passe" e "Cancelar link", usados no detalhe do visitante e do
/// prestador.
class BotoesPasse extends StatefulWidget {
  final dynamic item;
  const BotoesPasse({super.key, required this.item});

  @override
  State<BotoesPasse> createState() => _BotoesPasseState();
}

class _BotoesPasseState extends State<BotoesPasse> {
  bool _enviando = false;

  Future<void> _compartilhar() async {
    setState(() => _enviando = true);
    try {
      await CompartilharPasse.compartilhar(context, widget.item);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        AppButton(
          label: 'Compartilhar passe',
          icon: PhosphorIcons.whatsappLogo,
          loading: _enviando,
          onPressed: _compartilhar,
        ),
        const SizedBox(height: AppSpacing.sm),
        AppButton(
          label: 'Cancelar link',
          icon: PhosphorIcons.linkBreak,
          variant: AppButtonVariant.ghost,
          size: AppButtonSize.sm,
          onPressed: _enviando ? null : () => CompartilharPasse.cancelarLink(context, widget.item),
        ),
      ],
    );
  }
}
