import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/boleto_utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Escaneia o boleto/conta: QR (PIX copia-e-cola) ou código de barras do boleto.
/// Retorna o valor bruto lido (String) via Navigator.pop.
class ScanBoletoPage extends StatefulWidget {
  const ScanBoletoPage({Key? key}) : super(key: key);

  @override
  State<ScanBoletoPage> createState() => _ScanBoletoPageState();
}

class _ScanBoletoPageState extends State<ScanBoletoPage> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
  );
  bool _scanned = false;
  bool _isTorchOn = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_scanned) return;
    for (final barcode in capture.barcodes) {
      final code = barcode.rawValue ?? barcode.displayValue;
      if (code != null && code.trim().isNotEmpty) {
        _scanned = true;
        HapticFeedback.mediumImpact();
        Navigator.pop(context, code.trim());
        break;
      }
    }
  }

  void _abrirModalDigitarCodigo() {
    final txt = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(sheetCtx).viewInsets.bottom,
          ),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppColors.bg(sheetCtx),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "Digitar ou Colar Código",
                      style: AppTypography.title(sheetCtx).copyWith(fontSize: 18),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(sheetCtx),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  "Insira a linha digitável do boleto ou o código Pix Copia e Cola:",
                  style: AppTypography.caption(sheetCtx),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: txt,
                  autofocus: true,
                  maxLines: 3,
                  style: AppTypography.body(sheetCtx),
                  decoration: InputDecoration(
                    hintText: "Cole ou digite os números aqui...",
                    fillColor: AppColors.surface(sheetCtx),
                    filled: true,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: AppColors.border(sheetCtx)),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: () {
                      final input = txt.text.trim();
                      if (input.isNotEmpty) {
                        Navigator.pop(sheetCtx); // Fecha o modal
                        Navigator.pop(context, input); // Retorna o código
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      "Confirmar Código",
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Escanear Boleto / Pix',
      actions: [
        IconButton(
          icon: Icon(_isTorchOn ? Icons.flash_on : Icons.flash_off),
          tooltip: 'Lanterna',
          onPressed: () async {
            await _controller.toggleTorch();
            setState(() => _isTorchOn = !_isTorchOn);
          },
        ),
        IconButton(
          icon: const Icon(Icons.cameraswitch),
          tooltip: 'Alternar Câmera',
          onPressed: () => _controller.switchCamera(),
        ),
      ],
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          // Máscara com moldura central
          Center(
            child: Container(
              width: 300,
              height: 200,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primary, width: 3),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withOpacity(0.3),
                    blurRadius: 16,
                    spreadRadius: 2,
                  ),
                ],
              ),
            ),
          ),
          // Rodapé com instruções e opção de digitação manual
          Positioned(
            left: 0,
            right: 0,
            bottom: 30,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.7),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(PhosphorIcons.scan, size: 18, color: Colors.white),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            'Aponte para o código de barras ou QR Code Pix',
                            textAlign: TextAlign.center,
                            style: AppTypography.caption(context)
                                .copyWith(color: Colors.white, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _abrirModalDigitarCodigo,
                      icon: const Icon(PhosphorIcons.keyboard, size: 18),
                      label: const Text(
                        "Digitar ou colar código",
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.surface(context),
                        foregroundColor: AppColors.textPrimary(context),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        elevation: 2,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: AppColors.border(context)),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
