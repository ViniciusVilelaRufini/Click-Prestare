import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_client.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_scaffold.dart';

/// Pergunta ao usuário antes de liberar a sessão web e só então chama
/// POST /auth/qr/authorize. Devolve null quando ele cancela — nada chega ao
/// servidor.
///
/// O QR do console é só um código de sessão: quem estiver com a tela dele
/// recebe o acesso. Autorizar no instante da leitura deixava um golpista
/// repassar o QR da tela de login DELE e entrar no console com o acesso de
/// quem escaneou (QRLjacking).
Future<http.Response?> confirmarEAutorizarQrWeb(
  BuildContext context, {
  required String qrToken,
  required int idCondominio,
  VoidCallback? aoConfirmar,
}) async {
  final confirmou = await showAppConfirmDialog(
    context,
    title: 'Liberar acesso ao console web?',
    message: 'Só autorize se foi VOCÊ quem acabou de abrir a tela de login do console, '
        'em um computador à sua frente. Se alguém te enviou este QR Code ou pediu '
        'para você escaneá-lo, cancele: quem estiver com essa tela entra no console '
        'com o seu acesso.',
    confirmLabel: 'Autorizar',
    cancelLabel: 'Cancelar',
    icon: PhosphorIcons.warningCircleFill,
    iconColor: AppColors.warning,
  );
  if (!confirmou) return null;
  aoConfirmar?.call();
  return ApiClient.post(
    ApiConfig.buildUri('/auth/qr/authorize'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'qrToken': qrToken, 'id_condominio': idCondominio}),
  );
}

class QrWebAccessPage extends StatefulWidget {
  final int idCondominio;
  const QrWebAccessPage({super.key, required this.idCondominio});

  @override
  _QrWebAccessPageState createState() => _QrWebAccessPageState();
}

class _QrWebAccessPageState extends State<QrWebAccessPage> {
  final MobileScannerController _scannerController = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );
  bool _isProcessing = false;

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final String? code = barcodes.first.rawValue;
    if (code == null || !code.startsWith('qr_')) {
      // Ignorar QR codes inválidos que não começam com nosso prefixo de sessão
      return;
    }

    setState(() => _isProcessing = true);
    _scannerController.stop();

    // Sem esta flag, o jsonDecode lancando (corpo nao-JSON, HTML de proxy)
    // levava o fluxo ao catch, que dava um SEGUNDO pop: o primeiro fechou o
    // loader, o segundo desempilhava a propria tela do scanner. O usuario via
    // a tela sumir sem explicacao — numa tela de autorizacao de sessao web.
    // O loader só abre depois que o usuário confirma.
    var loaderAberto = false;
    void fecharLoader() {
      if (loaderAberto && mounted) {
        loaderAberto = false;
        Navigator.of(context).pop();
      }
    }

    try {
      final response = await confirmarEAutorizarQrWeb(
        context,
        qrToken: code,
        idCondominio: widget.idCondominio,
        aoConfirmar: () {
          loaderAberto = true;
          _showProcessingDialog();
        },
      );

      if (!mounted) return;
      if (response == null) {
        // Cancelou: nada foi enviado ao servidor. Volta a escanear.
        setState(() => _isProcessing = false);
        _scannerController.start();
        return;
      }
      fecharLoader();

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          await showAppDialog(
            context,
            title: 'Sucesso!',
            message: 'Acesso web autorizado com sucesso! O painel no computador será liberado em instantes.',
            icon: PhosphorIcons.checkCircleFill,
            iconColor: AppColors.success,
          );
          if (mounted) {
            Navigator.of(context).pop(); // Retorna para configurações
          }
          return;
        }
      }

      final errorMsg = _getErrorMessage(response);
      await _showErrorAndResume(errorMsg);
    } catch (e) {
      fecharLoader();
      if (!mounted) return;
      await _showErrorAndResume('Não foi possível conectar ao servidor. Verifique sua conexão.');
    }
  }

  String _getErrorMessage(http.Response response) {
    try {
      final body = jsonDecode(response.body);
      return body['message'] ?? 'Erro desconhecido ao autorizar login.';
    } catch (_) {
      return 'Erro na autorização do login (${response.statusCode}).';
    }
  }

  void _showProcessingDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (c) => PopScope(
        canPop: false,
        child: AlertDialog(
          backgroundColor: AppColors.surface(context),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
          content: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(color: AppColors.primary),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'Autorizando Acesso Web...',
                  style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Estamos conectando seu computador de forma segura.',
                  style: AppTypography.caption(context),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showErrorAndResume(String message) async {
    await showAppDialog(
      context,
      title: 'Falha na Autorização',
      message: message,
      icon: PhosphorIcons.warningCircleFill,
      iconColor: AppColors.error,
    );
    
    if (mounted) {
      setState(() => _isProcessing = false);
      _scannerController.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Acesso Web por QR Code',
      body: Stack(
        children: [
          // Visualizador da Câmera do Mobile Scanner
          MobileScanner(
            controller: _scannerController,
            onDetect: _onDetect,
          ),

          // Máscara Escura Translúcida com Janela Central Transparente
          _buildScannerOverlay(context),

          // Controles Flutuantes da Câmera (ex: Lanterna) e Instruções
          Positioned(
            bottom: AppSpacing.xxxl,
            left: AppSpacing.xl,
            right: AppSpacing.xl,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.8),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                  ),
                  child: Text(
                    'Aponte a câmera para o QR Code que aparece na tela de login do console web.',
                    style: AppTypography.bodySecondary(context).copyWith(color: Colors.white),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Botão da Lanterna
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: Colors.black.withValues(alpha: 0.8),
                      child: IconButton(
                        icon: ValueListenableBuilder(
                          valueListenable: _scannerController,
                          builder: (context, state, child) {
                            switch (state.torchState) {
                              case TorchState.off:
                              case TorchState.unavailable:
                                return const Icon(PhosphorIcons.flashlight, color: Colors.white);
                              case TorchState.on:
                              case TorchState.auto:
                                return const Icon(PhosphorIcons.flashlightFill, color: AppColors.warning);
                            }
                          },
                        ),
                        iconSize: 24,
                        onPressed: () => _scannerController.toggleTorch(),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScannerOverlay(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final scanAreaSize = size.width * 0.7;

    return ColorFiltered(
      colorFilter: ColorFilter.mode(
        Colors.black.withValues(alpha: 0.6),
        BlendMode.srcOut,
      ),
      child: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(
              color: Colors.transparent,
              backgroundBlendMode: BlendMode.dstOut,
            ),
          ),
          Center(
            child: Container(
              height: scanAreaSize,
              width: scanAreaSize,
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(AppRadius.xl),
              ),
            ),
          ),
          // Borda brilhante simulada ao redor da mira
          Center(
            child: Container(
              height: scanAreaSize + 4,
              width: scanAreaSize + 4,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primary, width: 3),
                borderRadius: BorderRadius.circular(AppRadius.xl),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
