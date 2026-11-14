import 'dart:async';

import 'package:click/pages/singleton.dart';
import 'package:click/services/credencial_acesso.dart';
import 'package:click/services/tela_segura.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:screen_brightness/screen_brightness.dart';

/// "Meu acesso": o QR que o morador mostra no leitor do portão.
///
/// O código é gerado no aparelho e muda a cada 30 s (um print deixa de valer
/// em no máximo 90 s e não abre duas vezes no mesmo leitor). Depois da
/// primeira emissão funciona sem internet. Enquanto a tela está aberta, o
/// brilho vai ao máximo (leitor lê melhor) e, no Android, a captura de tela
/// fica bloqueada.
///
/// O item de menu aparece sempre para o morador: é esta tela que explica
/// quando o QR não está disponível, sem uma chamada a mais ao abrir o menu.
class MeuAcessoPage extends StatefulWidget {
  const MeuAcessoPage({super.key});

  /// Brilho da tela só deste app (não mexe no ajuste do sistema). Campos para
  /// o teste trocar.
  @visibleForTesting
  static Future<void> Function() brilhoMaximo =
      () => ScreenBrightness.instance.setApplicationScreenBrightness(1.0);
  @visibleForTesting
  static Future<void> Function() restaurarBrilho =
      () => ScreenBrightness.instance.resetApplicationScreenBrightness();

  @override
  State<MeuAcessoPage> createState() => _MeuAcessoPageState();
}

class _MeuAcessoPageState extends State<MeuAcessoPage> with WidgetsBindingObserver {
  SituacaoCredencial? _situacao; // null = preparando
  CredencialLocal? _credencial;
  Timer? _relogio;
  bool _brilhoAlto = false;
  int _geracao = 0;

  int? get _idCondominio => int.tryParse('${Singleton.instance.id_condominio ?? ''}');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    TelaSegura.ligar();
    _aumentarBrilho();
    _preparar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _relogio?.cancel();
    _geracao++;
    TelaSegura.desligar();
    _voltarBrilho();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // A tela segura fica ligada em segundo plano: assim a miniatura da lista
    // de apps recentes também sai sem o QR. Ela é desligada ao sair da tela.
    switch (state) {
      case AppLifecycleState.resumed:
        _aumentarBrilho();
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        _voltarBrilho();
      case AppLifecycleState.inactive:
        break;
    }
  }

  void _aumentarBrilho() {
    if (_brilhoAlto) return;
    _brilhoAlto = true;
    _semFalha(MeuAcessoPage.brilhoMaximo);
  }

  void _voltarBrilho() {
    if (!_brilhoAlto) return;
    _brilhoAlto = false;
    _semFalha(MeuAcessoPage.restaurarBrilho);
  }

  static void _semFalha(Future<void> Function() acao) {
    try {
      acao().catchError((_) {});
    } catch (_) {}
  }

  Future<void> _preparar() async {
    final geracao = ++_geracao;
    if (_situacao != null) setState(() => _situacao = null);
    final id = _idCondominio;
    if (id == null) {
      setState(() => _situacao = SituacaoCredencial.erro);
      return;
    }
    final r = await CredencialAcesso.preparar(id, aoAtualizar: (situacao, credencial) {
      if (!mounted || geracao != _geracao) return;
      setState(() {
        _situacao = situacao;
        _credencial = credencial;
      });
      _ajustarRelogio();
    });
    if (!mounted || geracao != _geracao) return;
    setState(() {
      _situacao = r.situacao;
      _credencial = r.credencial;
    });
    _ajustarRelogio();
  }

  /// Redesenha a cada segundo para o contador; o código em si só muda quando
  /// o intervalo de 30 s vira.
  void _ajustarRelogio() {
    final precisa = _situacao == SituacaoCredencial.pronta && _credencial != null;
    if (!precisa) {
      _relogio?.cancel();
      _relogio = null;
      return;
    }
    _relogio ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Meu acesso',
      body: _conteudo(context),
    );
  }

  Widget _conteudo(BuildContext context) {
    final credencial = _credencial;
    switch (_situacao) {
      case null:
        return Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 1.5, color: AppColors.textPrimary(context)),
          ),
        );
      case SituacaoCredencial.pronta when credencial != null:
        return _qr(context, credencial);
      case SituacaoCredencial.semInternetNaPrimeiraVez:
        return _aviso(
          context,
          icone: PhosphorIcons.wifiSlash,
          mensagem: 'Conecte-se à internet uma vez para ativar seu QR de acesso.',
          tentarDeNovo: true,
        );
      case SituacaoCredencial.indisponivelNoCondominio:
        return _aviso(
          context,
          icone: PhosphorIcons.qrCode,
          mensagem: 'O QR de acesso não está ativo neste condomínio.',
        );
      case SituacaoCredencial.semMorador:
        return _aviso(
          context,
          icone: PhosphorIcons.house,
          mensagem: 'Seu usuário não tem unidade vinculada neste condomínio.',
        );
      case SituacaoCredencial.pronta:
      case SituacaoCredencial.erro:
        return _aviso(
          context,
          icone: PhosphorIcons.warningCircle,
          mensagem: 'Não foi possível preparar seu QR de acesso.',
          tentarDeNovo: true,
        );
    }
  }

  Widget _qr(BuildContext context, CredencialLocal credencial) {
    final codigo = CredencialAcesso.codigoAtual(credencial);
    final segundos = CredencialAcesso.segundosAteTrocar(credencial);
    final nome = Singleton.instance.condominio_nome.toString().trim();
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (nome.isNotEmpty) ...[
              Text(
                nome,
                textAlign: TextAlign.center,
                style: AppTypography.section(context),
              ),
              const SizedBox(height: AppSpacing.xl),
            ],
            Container(
              color: AppColors.qrPaper,
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: QrImageView(
                key: ValueKey('qr-$codigo'),
                data: codigo,
                version: QrVersions.auto,
                size: 260,
                padding: EdgeInsets.zero,
                backgroundColor: AppColors.qrPaper,
                // Sem o código no rótulo de acessibilidade.
                semanticsLabel: 'QR de acesso',
                eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: AppColors.qrInk),
                dataModuleStyle: const QrDataModuleStyle(
                  dataModuleShape: QrDataModuleShape.square,
                  color: AppColors.qrInk,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              'Novo código em $segundos s',
              style: AppTypography.strong(context).copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Mostre este QR no leitor do portão. O código muda a cada 30 segundos.',
              textAlign: TextAlign.center,
              style: AppTypography.bodySecondary(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _aviso(
    BuildContext context, {
    required IconData icone,
    required String mensagem,
    bool tentarDeNovo = false,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIconBox(icon: icone, size: 56, iconSize: 24),
            const SizedBox(height: AppSpacing.md),
            Text(
              mensagem,
              textAlign: TextAlign.center,
              style: AppTypography.bodySecondary(context),
            ),
            if (tentarDeNovo) ...[
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Tentar de novo',
                icon: PhosphorIcons.arrowClockwise,
                variant: AppButtonVariant.secondary,
                onPressed: _preparar,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
