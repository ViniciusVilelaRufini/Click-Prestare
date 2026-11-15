import 'dart:async';
import 'dart:io';

import 'package:click/controllers/controller_wallet.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Seção da carteira na tela "Meu acesso": o morador adiciona o acesso à
/// Carteira da Apple e abre o portão mostrando o passe, sem abrir o app.
///
/// Só no iPhone (o Google não é publicado por enquanto). Aparece só com a
/// opção ligada no condomínio e a carteira disponível na API; enquanto
/// carrega, em erro ou desligada, não desenha nada. A situação é recarregada
/// quando o app volta ao primeiro plano (o morador acabou de sair para a
/// Carteira).
class PasseCarteiraSecao extends StatefulWidget {
  const PasseCarteiraSecao({
    super.key,
    required this.idCondominio,
    this.plataforma,
    this.abrirArquivo,
  });

  final int idCondominio;

  /// Ponto de troca para teste; padrão é a plataforma do aparelho.
  final TargetPlatform? plataforma;

  /// Abre o .pkpass gravado; padrão é a folha do sistema (Quick Look), que
  /// mostra o passe com o botão de adicionar.
  final Future<void> Function(String caminho)? abrirArquivo;

  /// Chave do conteúdo visível (o teste confere quando a seção não desenha nada).
  static const chaveConteudo = ValueKey('passe-carteira-conteudo');

  static const textoAdicionar = 'Adicionar à Carteira da Apple';
  static const confirmacaoCancelar =
      'Cancelar o passe da carteira? Ele deixa de abrir na hora, em todos os aparelhos. O QR desta tela continua funcionando.';
  static const erroPadrao = 'Não foi possível concluir. Tente de novo.';

  // Chamadas à API e ao sistema de arquivos: campos para o teste trocar.
  @visibleForTesting
  static Future<Map<String, dynamic>> Function(int idCondominio) situacao = apiWalletSituacao;
  @visibleForTesting
  static Future<Map<String, dynamic>> Function(int idCondominio) passeApple = apiWalletPasseApple;
  @visibleForTesting
  static Future<Map<String, dynamic>> Function(int idCondominio) cancelar = apiWalletCancelar;
  @visibleForTesting
  static Future<String> Function() diretorioTemporario = _diretorioTemporario;

  @visibleForTesting
  static void restaurarPadroes() {
    situacao = apiWalletSituacao;
    passeApple = apiWalletPasseApple;
    cancelar = apiWalletCancelar;
    diretorioTemporario = _diretorioTemporario;
  }

  static Future<String> _diretorioTemporario() async => (await getTemporaryDirectory()).path;

  @override
  State<PasseCarteiraSecao> createState() => _PasseCarteiraSecaoState();
}

class _PasseCarteiraSecaoState extends State<PasseCarteiraSecao> with WidgetsBindingObserver {
  bool _disponivel = false;
  bool _ativo = false;
  bool _ocupado = false;
  int _geracao = 0;

  bool get _ehIphone => (widget.plataforma ?? defaultTargetPlatform) == TargetPlatform.iOS;

  @override
  void initState() {
    super.initState();
    if (!_ehIphone) return;
    WidgetsBinding.instance.addObserver(this);
    _carregar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _geracao++;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _carregar();
  }

  Future<void> _carregar() async {
    final geracao = ++_geracao;
    Map<String, dynamic> r;
    try {
      r = await PasseCarteiraSecao.situacao(widget.idCondominio);
    } catch (_) {
      r = const {};
    }
    if (!mounted || geracao != _geracao) return;
    final apple = r['apple'];
    final habilitado = r['erro'] == null && r['habilitado'] == true;
    setState(() {
      _disponivel = habilitado && apple is Map && apple['disponivel'] == true;
      _ativo = _disponivel && (apple as Map)['ativo'] == true;
    });
  }

  Future<void> _adicionar() async {
    if (_ocupado) return;
    setState(() => _ocupado = true);
    String? caminho;
    String? erro;
    try {
      final r = await PasseCarteiraSecao.passeApple(widget.idCondominio);
      final bytes = r['bytes'];
      if (bytes is List<int> && bytes.isNotEmpty) {
        final dir = await PasseCarteiraSecao.diretorioTemporario();
        caminho = '$dir${Platform.pathSeparator}prestare.pkpass';
        File(caminho).writeAsBytesSync(bytes, flush: true);
      } else {
        erro = '${r['erro'] ?? ''}';
      }
    } catch (_) {
      caminho = null;
      erro = '';
    }
    if (!mounted) return;
    setState(() => _ocupado = false);
    if (caminho == null) {
      _avisar(erro);
      return;
    }
    try {
      await (widget.abrirArquivo ?? _abrirPkpass)(caminho);
    } catch (_) {
      if (mounted) _avisar(null);
    }
    // A folha do sistema é aberta dentro do app (sem sair para o segundo
    // plano): ao fechar, a situação é lida de novo para mostrar o passe ativo.
    if (mounted) await _carregar();
  }

  static Future<void> _abrirPkpass(String caminho) async {
    final r = await OpenFilex.open(caminho, type: 'application/vnd.apple.pkpass', uti: 'com.apple.pkpass');
    if (r.type != ResultType.done) throw Exception('Não abriu o passe.');
  }

  Future<void> _cancelar() async {
    if (_ocupado) return;
    final ok = await showAppConfirmDialog(
      context,
      title: 'Cancelar o passe?',
      message: PasseCarteiraSecao.confirmacaoCancelar,
      confirmLabel: 'Cancelar passe',
      cancelLabel: 'Voltar',
      isDanger: true,
      icon: PhosphorIcons.wallet,
    );
    if (!ok || !mounted) return;
    setState(() => _ocupado = true);
    Map<String, dynamic> r;
    try {
      r = await PasseCarteiraSecao.cancelar(widget.idCondominio);
    } catch (_) {
      r = const {'erro': ''};
    }
    if (!mounted) return;
    setState(() => _ocupado = false);
    if (r['ok'] != true) {
      _avisar('${r['erro'] ?? ''}');
      return;
    }
    await _carregar();
  }

  void _avisar(String? mensagem) {
    final texto = (mensagem == null || mensagem.trim().isEmpty) ? PasseCarteiraSecao.erroPadrao : mensagem.trim();
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(texto)));
  }

  @override
  Widget build(BuildContext context) {
    if (!_ehIphone || !_disponivel) return const SizedBox.shrink();
    return ConstrainedBox(
      key: PasseCarteiraSecao.chaveConteudo,
      constraints: const BoxConstraints(maxWidth: 400),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: AppSpacing.xxl),
          Divider(height: 1, thickness: 1, color: AppColors.border(context)),
          const SizedBox(height: AppSpacing.xl),
          Text(
            'Abra o portão mostrando o passe da Carteira, sem abrir o app. O código do passe muda uma vez por dia.',
            textAlign: TextAlign.center,
            style: AppTypography.bodySecondary(context),
          ),
          const SizedBox(height: AppSpacing.lg),
          if (_ativo)
            ..._ativoNaCarteira(context)
          else
            _botao(PasseCarteiraSecao.textoAdicionar, PhosphorIcons.wallet, _adicionar, AppButtonVariant.secondary),
        ],
      ),
    );
  }

  List<Widget> _ativoNaCarteira(BuildContext context) => [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(PhosphorIcons.checkCircle, size: 16, color: AppColors.signalOk(context)),
            const SizedBox(width: AppSpacing.sm),
            Flexible(
              child:
                  Text('Passe ativo na carteira.', textAlign: TextAlign.center, style: AppTypography.strong(context)),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
                child: _botao('Adicionar novamente', PhosphorIcons.wallet, _adicionar, AppButtonVariant.secondary)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: _botao('Cancelar passe', null, _cancelar, AppButtonVariant.ghost)),
          ],
        ),
      ];

  Widget _botao(String texto, IconData? icone, VoidCallback acao, AppButtonVariant variante) {
    return Semantics(
      button: true,
      label: texto,
      excludeSemantics: true,
      child: AppButton(
        label: texto,
        icon: icone,
        variant: variante,
        loading: _ocupado,
        onPressed: _ocupado ? null : acao,
      ),
    );
  }
}
