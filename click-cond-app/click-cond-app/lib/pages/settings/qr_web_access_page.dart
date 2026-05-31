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
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_scaffold.dart';

class QrWebAccessPage extends StatefulWidget {
  final int idCondominio;
  const QrWebAccessPage({Key? key, required this.idCondominio}) : super(key: key);

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

    // Mostrar loader de autorização
    _showProcessingDialog();

    try {
      final response = await ApiClient.post(
        ApiConfig.buildUri('/auth/qr/authorize'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getToken(),
        },
        body: jsonEncode({
          'qrToken': code,
          'id_condominio': widget.idCondominio,
        }),
      );

      // Fecha o dialog de processamento
      Navigator.of(context).pop();

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
      Navigator.of(context).pop(); // Fecha loader se der exceção
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
                    color: Colors.black.withOpacity(0.8),
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
                      backgroundColor: Colors.black.withOpacity(0.8),
                      child: IconButton(
                        icon: ValueListenableBuilder(
                          valueListenable: _scannerController.torchState,
                          builder: (context, state, child) {
                            switch (state as TorchState) {
                              case TorchState.off:
                                return const Icon(PhosphorIcons.flashlight, color: Colors.white);
                              case TorchState.on:
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
        Colors.black.withOpacity(0.6),
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
