import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/models/encomenda_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class NewEncomenda extends StatefulWidget {
  final EncomendaModel? encomenda;
  const NewEncomenda({Key? key, this.encomenda}) : super(key: key);

  @override
  _NewEncomendaState createState() => _NewEncomendaState();
}

class _NewEncomendaState extends State<NewEncomenda> {
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtDescricao = TextEditingController();
  final txtCodigoRastreio = TextEditingController();

  String selectedCarrier = 'Correios';
  Uint8List? fotoBytes;
  String? existingPhotoUrl;

  bool _isLoading = false;
  bool _isSaving = false;

  List<dynamic> listAptos = [];
  List<String> listBlocos = [];
  String? moradoresDetectados;

  bool get isEdit => widget.encomenda != null;

  @override
  void initState() {
    super.initState();
    _initData();
  }

  @override
  void dispose() {
    txtBloco.dispose();
    txtApto.dispose();
    txtDescricao.dispose();
    txtCodigoRastreio.dispose();
    super.dispose();
  }

  Future<void> _initData() async {
    if (isEdit) {
      final enc = widget.encomenda!;
      txtDescricao.text = enc.descricao ?? '';
      txtApto.text = enc.destinatarioApto ?? '';
      txtBloco.text = enc.destinatarioBloco ?? '';
      txtCodigoRastreio.text = enc.codigoRastreio ?? '';
      selectedCarrier = enc.recebidoDe ?? 'Correios';
      existingPhotoUrl = enc.fotoVolume;
    }

    await _loadApartamentos();
  }

  Future<void> _loadApartamentos() async {
    setState(() => _isLoading = true);
    try {
      final res = await apiGetAll('apartamentos');
      if (res is List) {
        listAptos = res;
        final blocosSet = <String>{};
        for (var item in listAptos) {
          final b = item['bloco']?.toString()?.trim() ?? '';
          if (b.isNotEmpty) {
            blocosSet.add(b);
          }
        }
        listBlocos = blocosSet.toList()..sort();

        // Se houver apenas 1 bloco e estiver vazio no input, preenche automaticamente
        if (listBlocos.length == 1 && txtBloco.text.isEmpty) {
          txtBloco.text = listBlocos.first;
        }

        _atualizarMoradoresDetectados();
      }
    } catch (e) {
      // Falha silenciosa ou fallback
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _atualizarMoradoresDetectados() {
    final aptoStr = txtApto.text.trim();
    final blocoStr = txtBloco.text.trim();

    if (aptoStr.isEmpty) {
      setState(() => moradoresDetectados = null);
      return;
    }

    final match = listAptos.firstWhere(
      (a) {
        final aApto = a['apto']?.toString() ?? a['numero']?.toString() ?? '';
        final aBloco = a['bloco']?.toString() ?? '';
        if (blocoStr.isNotEmpty && aBloco.isNotEmpty) {
          return aApto == aptoStr && aBloco == blocoStr;
        }
        return aApto == aptoStr;
      },
      orElse: () => null,
    );

    if (match != null && match['moradores'] != null) {
      final m = match['moradores'];
      if (m is List && m.isNotEmpty) {
        final names = m
            .map((item) => item is Map ? (item['name'] ?? item['nome'] ?? '') : item.toString())
            .where((s) => s.isNotEmpty)
            .join(', ');
        setState(() => moradoresDetectados = names.isNotEmpty ? names : null);
        return;
      } else if (m is String && m.trim().isNotEmpty) {
        setState(() => moradoresDetectados = m.trim());
        return;
      }
    }

    setState(() => moradoresDetectados = null);
  }

  List<String> _getAptosDoBloco() {
    final blocoStr = txtBloco.text.trim();
    final aptosSet = <String>{};

    for (var item in listAptos) {
      final aBloco = item['bloco']?.toString()?.trim() ?? '';
      final aApto = item['apto']?.toString() ?? item['numero']?.toString() ?? '';
      if (aApto.isNotEmpty) {
        if (blocoStr.isEmpty || aBloco == blocoStr || listBlocos.isEmpty) {
          aptosSet.add(aApto);
        }
      }
    }

    return aptosSet.toList()..sort((a, b) => int.tryParse(a)?.compareTo(int.tryParse(b) ?? 0) ?? a.compareTo(b));
  }

  Future<void> _tirarFoto() async {
    final img = await getPhoto(context);
    if (img != null) {
      final bytes = await img.readAsBytes();
      setState(() {
        fotoBytes = bytes;
        existingPhotoUrl = null;
      });
    }
  }

  Future<void> _salvar() async {
    final apto = txtApto.text.trim();
    final bloco = txtBloco.text.trim();
    final desc = txtDescricao.text.trim();
    final rastreio = txtCodigoRastreio.text.trim();

    if (apto.isEmpty) {
      displayMessage(context, 'Atenção', 'Selecione o Apartamento de destino.');
      return;
    }

    if (desc.isEmpty) {
      displayMessage(context, 'Atenção', 'Informe a descrição da encomenda.');
      return;
    }

    setState(() => _isSaving = true);

    try {
      final fotoBase64 = fotoBytes != null ? 'data:image/jpeg;base64,${base64Encode(fotoBytes!)}' : null;

      final payload = {
        'destinatario_apto': apto,
        'destinatario_bloco': bloco.isNotEmpty ? bloco : null,
        'descricao': desc,
        'recebido_de': selectedCarrier,
        'codigo_rastreio': rastreio.isNotEmpty ? rastreio : null,
        if (fotoBase64 != null) 'foto_volume': fotoBase64,
        if (existingPhotoUrl != null && fotoBytes == null) 'foto_volume': existingPhotoUrl,
      };

      bool success;
      if (isEdit && widget.encomenda?.id != null) {
        success = await apiUpdateEncomenda(widget.encomenda!.id!, payload);
      } else {
        success = await apiInsertEncomenda(payload);
      }

      if (mounted) {
        setState(() => _isSaving = false);
        if (success) {
          Navigator.pop(context, true);
          displayMessage(
            context,
            'Sucesso',
            isEdit
                ? 'Encomenda atualizada com sucesso!'
                : 'Encomenda registrada e moradores notificados!',
          );
        } else {
          displayMessage(context, 'Erro', 'Falha ao salvar encomenda. Verifique a conexão.');
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        displayMessage(context, 'Erro', 'Ocorreu um erro ao salvar a encomenda: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: isEdit ? 'Editar Encomenda' : 'Nova Encomenda',
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 120),
              physics: const BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildCardDestino(),
                  const SizedBox(height: AppSpacing.lg),
                  _buildCardFoto(),
                  const SizedBox(height: AppSpacing.lg),
                  _buildCardDescricao(),
                  const SizedBox(height: AppSpacing.lg),
                  _buildCardTransportadora(),
                  const SizedBox(height: AppSpacing.lg),
                  _buildCardRastreio(),
                  const SizedBox(height: AppSpacing.xxl),
                  AppButton(
                    label: isEdit ? 'Salvar Alterações' : 'Cadastrar e Notificar Moradores',
                    onPressed: _isSaving ? null : _salvar,
                    loading: _isSaving,
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildCardDestino() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(PhosphorIcons.buildings, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Destino da Encomenda',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Informe a unidade que irá receber o volume',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              if (listBlocos.isNotEmpty) ...[
                Expanded(
                  flex: 1,
                  child: AppInput(
                    label: 'Bloco',
                    controller: txtBloco,
                    prefixIcon: PhosphorIcons.buildings,
                    readOnly: true,
                    onTap: () {
                      bottomSheetAptos(context, listBlocos, txtBloco.text, (s) {
                        if (txtBloco.text != s) {
                          txtApto.text = '';
                        }
                        txtBloco.text = s;
                        Navigator.of(context).pop();
                        _atualizarMoradoresDetectados();
                        setState(() {});
                      });
                    },
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
              ],
              Expanded(
                flex: 2,
                child: AppInput(
                  label: 'Apartamento *',
                  controller: txtApto,
                  prefixIcon: PhosphorIcons.door,
                  readOnly: true,
                  onTap: () {
                    final aptos = _getAptosDoBloco();
                    if (aptos.isEmpty) {
                      displayMessage(context, 'Atenção', 'Nenhum apartamento encontrado.');
                      return;
                    }
                    bottomSheetAptos(context, aptos, txtApto.text, (s) {
                      txtApto.text = s;
                      Navigator.of(context).pop();
                      _atualizarMoradoresDetectados();
                      setState(() {});
                    });
                  },
                ),
              ),
            ],
          ),
          if (moradoresDetectados != null && moradoresDetectados!.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.green.withOpacity(0.25)),
              ),
              child: Row(
                children: [
                  const Icon(PhosphorIcons.users, color: Colors.green, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Moradores cadastrados:',
                          style: AppTypography.tiny(context).copyWith(
                            color: Colors.green,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          moradoresDetectados!,
                          style: AppTypography.caption(context).copyWith(
                            color: AppColors.textPrimary(context),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCardFoto() {
    final hasBytes = fotoBytes != null;
    final hasUrl = existingPhotoUrl != null && existingPhotoUrl!.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(PhosphorIcons.camera, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Foto do Volume (opcional)',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Tire uma foto para o morador identificar o pacote',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (hasBytes) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.memory(
                fotoBytes!,
                height: 180,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: _tirarFoto,
                  icon: const Icon(PhosphorIcons.arrowsClockwise, size: 16),
                  label: const Text('Trocar Foto'),
                ),
                TextButton.icon(
                  onPressed: () => setState(() => fotoBytes = null),
                  icon: const Icon(PhosphorIcons.trash, size: 16, color: Colors.redAccent),
                  label: const Text('Remover', style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
          ] else if (hasUrl) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                existingPhotoUrl!,
                height: 180,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const Center(
                  child: Icon(PhosphorIcons.warningCircle, color: Colors.grey, size: 36),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: _tirarFoto,
                  icon: const Icon(PhosphorIcons.arrowsClockwise, size: 16),
                  label: const Text('Alterar Foto'),
                ),
                TextButton.icon(
                  onPressed: () => setState(() => existingPhotoUrl = null),
                  icon: const Icon(PhosphorIcons.trash, size: 16, color: Colors.redAccent),
                  label: const Text('Remover', style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
          ] else ...[
            InkWell(
              onTap: _tirarFoto,
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.04),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: AppColors.primary.withOpacity(0.3),
                    style: BorderStyle.solid,
                    width: 1.5,
                  ),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(PhosphorIcons.camera, color: AppColors.primary, size: 28),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Tirar foto do pacote',
                      style: AppTypography.bodyMedium(context).copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Toque para abrir a câmera',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCardDescricao() {
    final sugestoes = [
      'Caixa Amazon',
      'Envelope Correios',
      'Mercado Livre',
      'Sacola Shopee',
      'Caixa Grande',
      'Delivery / iFood',
      'Documento / Cartão',
    ];

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(PhosphorIcons.package, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Descrição da Encomenda *',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Identificação do que chegou',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(
            label: 'Descrição do Volume *',
            controller: txtDescricao,
            prefixIcon: PhosphorIcons.pencilSimple,
            hint: 'Ex.: Caixa Amazon grande, Envelope...',
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: sugestoes.map((sug) {
              return ActionChip(
                label: Text(sug, style: const TextStyle(fontSize: 11)),
                backgroundColor: AppColors.surfaceElevated(context),
                side: BorderSide(color: AppColors.border(context)),
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
                onPressed: () {
                  setState(() {
                    txtDescricao.text = sug;
                  });
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildCardTransportadora() {
    final carriers = [
      {'name': 'Correios', 'icon': PhosphorIcons.envelopeSimple, 'color': const Color(0xFF005DA5)},
      {'name': 'Mercado Livre', 'icon': PhosphorIcons.handshake, 'color': const Color(0xFFF2C200)},
      {'name': 'Amazon', 'icon': PhosphorIcons.shoppingCart, 'color': const Color(0xFFFF9900)},
      {'name': 'Shopee', 'icon': PhosphorIcons.shoppingBag, 'color': const Color(0xFFEE4D2D)},
      {'name': 'Loggi', 'icon': PhosphorIcons.truck, 'color': const Color(0xFF00A3E0)},
      {'name': 'Sedex', 'icon': PhosphorIcons.envelopeSimple, 'color': const Color(0xFF005DA5)},
      {'name': 'iFood', 'icon': PhosphorIcons.hamburger, 'color': const Color(0xFFEA1D2C)},
      {'name': 'Jadlog', 'icon': PhosphorIcons.truck, 'color': const Color(0xFFE30613)},
      {'name': 'Outro', 'icon': PhosphorIcons.package, 'color': AppColors.primary},
    ];

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(PhosphorIcons.truck, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Transportadora / Entregador *',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Quem realizou a entrega',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: carriers.map((c) {
              final name = c['name'] as String;
              final icon = c['icon'] as IconData;
              final color = c['color'] as Color;
              final isSelected = selectedCarrier == name;

              return InkWell(
                onTap: () => setState(() => selectedCarrier = name),
                borderRadius: BorderRadius.circular(12),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isSelected ? color.withOpacity(0.15) : AppColors.surfaceElevated(context),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isSelected ? color : AppColors.border(context),
                      width: isSelected ? 1.8 : 1.0,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(icon, size: 16, color: isSelected ? color : AppColors.textSecondary(context)),
                      const SizedBox(width: 6),
                      Text(
                        name,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                          color: isSelected ? (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black87) : AppColors.textSecondary(context),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildCardRastreio() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(PhosphorIcons.barcode, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Código de Rastreio (opcional)',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Digite ou escaneie o código de barras',
                      style: AppTypography.caption(context),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: AppInput(
                  label: 'Código de Rastreio',
                  controller: txtCodigoRastreio,
                  prefixIcon: PhosphorIcons.barcode,
                  hint: 'Ex.: BR1234567890',
                ),
              ),
              const SizedBox(width: 8),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: IconButton(
                  icon: const Icon(PhosphorIcons.barcode, color: AppColors.primary),
                  tooltip: 'Escanear código de barras',
                  onPressed: () async {
                    final scannedCode = await Navigator.push<String>(
                      context,
                      MaterialPageRoute(builder: (_) => _BarcodeScannerPage()),
                    );
                    if (scannedCode != null) {
                      setState(() {
                        txtCodigoRastreio.text = scannedCode;
                      });
                    }
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BarcodeScannerPage extends StatefulWidget {
  @override
  __BarcodeScannerPageState createState() => __BarcodeScannerPageState();
}

class __BarcodeScannerPageState extends State<_BarcodeScannerPage> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );
  bool _scanned = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Escanear Código de Barras',
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              if (_scanned) return;
              final List<Barcode> barcodes = capture.barcodes;
              if (barcodes.isNotEmpty) {
                final code = barcodes.first.rawValue;
                if (code != null && code.isNotEmpty) {
                  setState(() => _scanned = true);
                  Navigator.pop(context, code);
                }
              }
            },
          ),
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primary, width: 3),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
