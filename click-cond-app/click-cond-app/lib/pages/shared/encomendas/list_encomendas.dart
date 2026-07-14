import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/models/encomenda_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:intl/intl.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class ListEncomendas extends StatefulWidget {
  final bool allCondos;
  final bool hideAppBar;
  final bool showFab;
  const ListEncomendas({
    Key? key, 
    this.allCondos = false, 
    this.hideAppBar = false,
    this.showFab = true,
  }) : super(key: key);

  @override
  ListEncomendasState createState() => ListEncomendasState();
}

class ListEncomendasState extends State<ListEncomendas> {
  bool _isLoading = false;
  List<EncomendaModel> _encomendas = [];

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  Future<void> _loadList() async {
    setState(() => _isLoading = true);
    try {
      final List<dynamic> result = await apiGetAllEncomendas(allCondos: widget.allCondos);
      if (mounted) {
        setState(() {
          _encomendas = result.map((e) => EncomendaModel.fromJson(e)).toList();
        });
      }
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'), 'Erro ao carregar encomendas');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }
  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Minhas Encomendas',
      showBackButton: !widget.hideAppBar,
      safeAreaBottom: !widget.hideAppBar,
      floatingActionButton: widget.showFab
          ? FloatingActionButton(
              heroTag: 'register_tracking',
              backgroundColor: AppColors.primary,
              onPressed: () => showRegisterTrackingDialog(context),
              child: const Icon(PhosphorIcons.plus, color: Colors.black),
            )
          : null,
      body: _isLoading
          ? ListView.separated(
              padding: const EdgeInsets.only(
                left: AppSpacing.lg,
                right: AppSpacing.lg,
                top: AppSpacing.lg,
                bottom: 120,
              ),
              itemCount: 6,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, __) => AppSkeleton.listTile(context),
            )
          : RefreshIndicator(
              onRefresh: _loadList,
              child: _encomendas.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: const EdgeInsets.only(
                        left: AppSpacing.lg,
                        right: AppSpacing.lg,
                        top: AppSpacing.lg,
                        bottom: 120,
                      ),
                      itemCount: _encomendas.length,
                      itemBuilder: (context, index) {
                        return _EncomendaCard(encomenda: _encomendas[index]);
                      },
                    ),
            ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(PhosphorIcons.package, size: 64, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(
              'Nenhuma encomenda encontrada',
              style: AppTypography.bodyMedium(context).copyWith(color: AppColors.textSecondary(context)),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }

  /// iFood e delivery de comida usam código de validação (não rastreio).
  bool _isDeliveryCarrier(String carrier) {
    final c = carrier.toLowerCase();
    return c.contains('ifood') || c.contains('food') || c.contains('delivery');
  }

  /// Ícone + cor de marca de cada transportadora (para os chips do seletor).
  ({IconData icon, Color color}) _carrierVisual(String carrier) {
    final c = carrier.toLowerCase();
    if (c.contains('ifood') || c.contains('food') || c.contains('delivery')) {
      return (icon: PhosphorIcons.hamburger, color: const Color(0xFFEA1D2C));
    }
    if (c.contains('mercado')) {
      return (icon: PhosphorIcons.handshake, color: const Color(0xFFF2C200));
    }
    if (c.contains('amazon')) {
      return (icon: PhosphorIcons.shoppingCart, color: const Color(0xFFFF9900));
    }
    if (c.contains('correios') || c.contains('sedex')) {
      return (icon: PhosphorIcons.envelopeSimple, color: const Color(0xFF005DA5));
    }
    if (c.contains('shopee')) {
      return (icon: PhosphorIcons.shoppingCart, color: const Color(0xFFEE4D2D));
    }
    if (c.contains('dhl')) {
      return (icon: PhosphorIcons.truck, color: const Color(0xFFD40511));
    }
    if (c.contains('fedex')) {
      return (icon: PhosphorIcons.truck, color: const Color(0xFF4D148C));
    }
    if (c.contains('loggi')) {
      return (icon: PhosphorIcons.truck, color: const Color(0xFF00A3E0));
    }
    if (c.contains('jadlog')) {
      return (icon: PhosphorIcons.truck, color: const Color(0xFFE30613));
    }
    return (icon: PhosphorIcons.package, color: AppColors.primary);
  }

  void showRegisterTrackingDialog(BuildContext context) {
    final formKey = GlobalKey<FormState>();
    final txtDescricao = TextEditingController();
    final txtCodigo = TextEditingController();
    final txtValidacao = TextEditingController();
    String selectedCarrier = 'Correios';

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              backgroundColor: AppColors.surface(context),
              title: Text(
                'Aviso de Encomenda',
                style: AppTypography.body(context).copyWith(fontWeight: FontWeight.bold),
              ),
              content: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Avise que uma encomenda vai chegar. Para iFood/delivery, informe o código de validação (se o pedido exigir) para o porteiro receber por você.',
                        style: AppTypography.caption(context),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: txtDescricao,
                        decoration: InputDecoration(
                          labelText: 'Descrição (Ex: Livro, Roupa)',
                          labelStyle: AppTypography.caption(context),
                          border: const OutlineInputBorder(),
                        ),
                        validator: (value) => value == null || value.isEmpty ? 'Campo obrigatório' : null,
                      ),
                      const SizedBox(height: 12),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Transportadora', style: AppTypography.caption(context)),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: ['iFood', 'Correios', 'Mercado Livre', 'Amazon', 'Loggi', 'Outro']
                            .map((c) {
                          final selected = selectedCarrier == c;
                          final vis = _carrierVisual(c);
                          return GestureDetector(
                            onTap: () => setState(() => selectedCarrier = c),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 150),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: selected
                                    ? AppColors.primary.withOpacity(0.12)
                                    : AppColors.bg(context),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: selected ? AppColors.primary : AppColors.border(context),
                                  width: selected ? 1.5 : 1,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(vis.icon,
                                      size: 16,
                                      color: selected ? AppColors.primary : vis.color),
                                  const SizedBox(width: 6),
                                  Text(
                                    c,
                                    style: AppTypography.bodySecondary(context).copyWith(
                                      color: selected
                                          ? AppColors.primary
                                          : AppColors.textSecondary(context),
                                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 12),
                      if (_isDeliveryCarrier(selectedCarrier))
                        // iFood/delivery: código de validação (opcional) que o entregador pede.
                        TextFormField(
                          controller: txtValidacao,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: 'Código de validação (opcional)',
                            hintText: 'Ex.: código que o iFood pede na entrega',
                            labelStyle: AppTypography.caption(context),
                            border: const OutlineInputBorder(),
                          ),
                        )
                      else
                        // Transportadora: código de rastreio (opcional) p/ notificações de status.
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: txtCodigo,
                                decoration: InputDecoration(
                                  labelText: 'Código de Rastreio (opcional)',
                                  labelStyle: AppTypography.caption(context),
                                  border: const OutlineInputBorder(),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            IconButton(
                              icon: const Icon(PhosphorIcons.barcode, color: AppColors.primary),
                              onPressed: () async {
                                final scannedCode = await Navigator.push<String>(
                                  context,
                                  MaterialPageRoute(builder: (_) => _BarcodeScannerPage()),
                                );
                                if (scannedCode != null) {
                                  setState(() {
                                    txtCodigo.text = scannedCode;
                                  });
                                }
                              },
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
              actions: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: AppColors.textTertiary(context).withOpacity(0.3)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      child: Text('Cancelar', style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        elevation: 0,
                      ),
                      onPressed: () async {
                        if (formKey.currentState?.validate() ?? false) {
                          final isDelivery = _isDeliveryCarrier(selectedCarrier);
                          final success = await apiCadastrarRastreio(
                            txtDescricao.text,
                            selectedCarrier,
                            codigoRastreio: isDelivery ? null : (txtCodigo.text.trim().isEmpty ? null : txtCodigo.text.trim()),
                            codigoValidacao: isDelivery ? (txtValidacao.text.trim().isEmpty ? null : txtValidacao.text.trim()) : null,
                          );
                          if (success) {
                            Navigator.pop(context);
                            _loadList();
                            displayMessage(context, 'Sucesso', 'Encomenda cadastrada com sucesso!');
                          } else {
                            displayMessage(context, 'Erro', 'Não foi possível cadastrar encomenda.');
                          }
                        }
                      },
                      child: const Text(
                        'Cadastrar',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            );
          },
        );
      },
    );
  }
}

class _EncomendaCard extends StatelessWidget {
  final EncomendaModel encomenda;

  const _EncomendaCard({required this.encomenda});

  Widget _buildBrandIcon(BuildContext context) {
    final recebidoDe = (encomenda.recebidoDe ?? '').toLowerCase();
    
    IconData iconData = PhosphorIcons.package;
    Color iconColor = AppColors.primary;
    Color bgColor = AppColors.primary.withOpacity(0.1);

    if (recebidoDe.contains('ifood') || recebidoDe.contains('food') || recebidoDe.contains('delivery') || recebidoDe.contains('pizza') || recebidoDe.contains('lanche')) {
      iconData = PhosphorIcons.hamburger;
      iconColor = Colors.red;
      bgColor = Colors.red.withOpacity(0.1);
    } else if (recebidoDe.contains('mercado livre') || recebidoDe.contains('mercado') || recebidoDe.contains('ml')) {
      iconData = PhosphorIcons.handshake;
      iconColor = const Color(0xFFFEE600);
      bgColor = const Color(0xFFFEE600).withOpacity(0.1);
    } else if (recebidoDe.contains('amazon')) {
      iconData = PhosphorIcons.shoppingCart;
      iconColor = const Color(0xFFFF9900);
      bgColor = const Color(0xFFFF9900).withOpacity(0.1);
    } else if (recebidoDe.contains('correios') || recebidoDe.contains('sedex') || recebidoDe.contains('pac')) {
      iconData = PhosphorIcons.envelopeSimple;
      iconColor = const Color(0xFF005DA5);
      bgColor = const Color(0xFF005DA5).withOpacity(0.1);
    } else if (recebidoDe.contains('shopee')) {
      iconData = PhosphorIcons.shoppingBag;
      iconColor = const Color(0xFFEE4D2D);
      bgColor = const Color(0xFFEE4D2D).withOpacity(0.1);
    } else if (recebidoDe.contains('dhl')) {
      iconData = PhosphorIcons.truck;
      iconColor = const Color(0xFFFFCC00);
      bgColor = const Color(0xFFFFCC00).withOpacity(0.1);
    } else if (recebidoDe.contains('fedex')) {
      iconData = PhosphorIcons.truck;
      iconColor = const Color(0xFF4D148C);
      bgColor = const Color(0xFF4D148C).withOpacity(0.1);
    }

    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(iconData, color: iconColor, size: 28),
    );
  }

  @override
  Widget build(BuildContext context) {
    final statusLower = encomenda.status?.toLowerCase() ?? '';
    final isRetirado = statusLower == 'retirado' || statusLower == 'retirada' || statusLower == 'entregue';
    Color statusColor;
    if (isRetirado) {
      statusColor = Colors.green;
    } else if (statusLower == 'cancelado' || statusLower == 'recusado') {
      statusColor = Colors.red;
    } else if (statusLower == 'esperando') {
      statusColor = Colors.blue;
    } else {
      statusColor = Colors.orange;
    }
    
    String dataFormatada = '';
    if (encomenda.recebidoEm != null) {
      try {
        DateTime dt = DateTime.parse(encomenda.recebidoEm!);
        dataFormatada = DateFormat('dd/MM/yyyy HH:mm').format(dt);
      } catch (_) {
        dataFormatada = encomenda.recebidoEm!;
      }
    } else if (statusLower == 'esperando') {
      dataFormatada = 'Aguardando chegada';
    }

    return GestureDetector(
      onTap: () => _showEncomendaDetails(context, dataFormatada, statusColor),
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.05)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildBrandIcon(context),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (encomenda.condominioNome != null && encomenda.condominioNome!.isNotEmpty) ...[
                    Text(
                      encomenda.condominioNome!.toUpperCase(),
                      style: AppTypography.tiny(context).copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                  ],
                  Text(
                    encomenda.descricao ?? 'Encomenda sem descrição',
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                    maxLines: 2, overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(PhosphorIcons.truck, size: 14, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Recebido de: ${encomenda.recebidoDe ?? "N/A"}',
                          style: AppTypography.caption(context),
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Icon(PhosphorIcons.calendar, size: 14, color: AppColors.textTertiary(context)),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          statusLower == 'esperando' ? dataFormatada : 'Em: $dataFormatada',
                          style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  if (isRetirado && encomenda.retiradoPor != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(PhosphorIcons.checkCircle, size: 14, color: Colors.green),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            'Retirado por: ${encomenda.retiradoPor}',
                            style: AppTypography.caption(context).copyWith(color: Colors.green, fontWeight: FontWeight.w500),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: statusColor.withOpacity(0.3)),
                  ),
                  child: Text(
                    statusLower == 'esperando' ? 'A CHEGAR' : (encomenda.status?.toUpperCase() ?? 'PENDENTE'),
                    style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(height: 12),
                if (encomenda.destinatarioApto != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${encomenda.destinatarioBloco != null && encomenda.destinatarioBloco!.isNotEmpty ? encomenda.destinatarioBloco! + ' - ' : ''}${encomenda.destinatarioApto}',
                      style: AppTypography.tiny(context).copyWith(
                        color: AppColors.primary, 
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _showEncomendaDetails(BuildContext context, String dataFormatada, Color statusColor) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final hasFoto = encomenda.fotoVolume != null && encomenda.fotoVolume!.isNotEmpty;
        return Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          decoration: BoxDecoration(
            color: AppColors.surface(context),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 15,
                offset: const Offset(0, -5),
              ),
            ],
          ),
          padding: EdgeInsets.fromLTRB(
            AppSpacing.xl,
            AppSpacing.md,
            AppSpacing.xl,
            MediaQuery.of(context).padding.bottom + AppSpacing.xl,
          ),
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.textTertiary(context).withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'Detalhes da Encomenda',
                  style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.lg),
                if (hasFoto) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      height: 220,
                      width: double.infinity,
                      color: AppColors.surfaceElevated(context),
                      child: Image.network(
                        encomenda.fotoVolume!,
                        fit: BoxFit.cover,
                        loadingBuilder: (context, child, loadingProgress) {
                          if (loadingProgress == null) return child;
                          return const Center(
                            child: CircularProgressIndicator(color: AppColors.primary),
                          );
                        },
                        errorBuilder: (_, __, ___) {
                          return Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(PhosphorIcons.warningCircle, color: AppColors.error, size: 36),
                                const SizedBox(height: 8),
                                Text(
                                  'Erro ao carregar imagem',
                                  style: AppTypography.caption(context),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ] else ...[
                  Container(
                    height: 120,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.primary.withOpacity(0.1)),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(PhosphorIcons.package, color: AppColors.primary.withOpacity(0.6), size: 40),
                        const SizedBox(height: 8),
                        Text(
                          'Sem foto registrada do volume',
                          style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
                Container(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated(context),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withOpacity(0.03)),
                  ),
                  child: Column(
                    children: [
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.package,
                        label: 'Descrição',
                        value: encomenda.descricao ?? 'Sem descrição',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.package,
                        label: 'Status',
                        widgetValue: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: statusColor.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: statusColor.withOpacity(0.3)),
                          ),
                          child: Text(
                            encomenda.status?.toUpperCase() ?? 'PENDENTE',
                            style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.house,
                        label: 'Destinatário',
                        value: 'Apto ${encomenda.destinatarioApto}${encomenda.destinatarioBloco != null && encomenda.destinatarioBloco!.isNotEmpty ? " — Bloco " + encomenda.destinatarioBloco! : ""}',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.truck,
                        label: 'Entregador / Remetente',
                        value: encomenda.recebidoDe ?? 'Não informado',
                      ),
                      const Divider(height: 24),
                      _buildDetailRow(
                        context,
                        icon: PhosphorIcons.calendar,
                        label: 'Data de Recebimento',
                        value: dataFormatada,
                      ),
                      if (encomenda.codigoRastreio != null && encomenda.codigoRastreio!.isNotEmpty) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.barcode,
                          label: 'Código de Rastreio',
                          value: encomenda.codigoRastreio!,
                        ),
                      ],
                      if (encomenda.codigoValidacao != null && encomenda.codigoValidacao!.isNotEmpty) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.key,
                          label: 'Código de validação',
                          value: encomenda.codigoValidacao!,
                        ),
                      ],
                      if (encomenda.retiradoPor != null) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.checkCircle,
                          label: 'Retirado por',
                          value: encomenda.retiradoPor!,
                        ),
                      ],
                      if (encomenda.retiradoEm != null) ...[
                        const Divider(height: 24),
                        _buildDetailRow(
                          context,
                          icon: PhosphorIcons.calendar,
                          label: 'Data de Retirada',
                          value: () {
                            try {
                              DateTime dt = DateTime.parse(encomenda.retiradoEm!);
                              return DateFormat('dd/MM/yyyy HH:mm').format(dt);
                            } catch (_) {
                              return encomenda.retiradoEm!;
                            }
                          }(),
                        ),
                      ],
                    ],
                  ),
                ),
                if (encomenda.retiradoFoto != null && encomenda.retiradoFoto!.isNotEmpty ||
                    encomenda.retiradoAssinatura != null && encomenda.retiradoAssinatura!.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    'Comprovante de Retirada',
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceElevated(context),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white.withOpacity(0.03)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (encomenda.retiradoFoto != null && encomenda.retiradoFoto!.isNotEmpty) ...[
                          Text(
                            'Foto do Recebedor',
                            style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 8),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              height: 180,
                              width: double.infinity,
                              color: AppColors.surface(context),
                              child: Image.network(
                                encomenda.retiradoFoto!,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => const Center(
                                  child: Icon(PhosphorIcons.imageSquare, size: 32, color: Colors.grey),
                                ),
                              ),
                            ),
                          ),
                          if (encomenda.retiradoAssinatura != null && encomenda.retiradoAssinatura!.isNotEmpty)
                            const SizedBox(height: AppSpacing.md),
                        ],
                        if (encomenda.retiradoAssinatura != null && encomenda.retiradoAssinatura!.isNotEmpty) ...[
                          Text(
                            'Assinatura Digital',
                            style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 8),
                          Container(
                            height: 100,
                            width: double.infinity,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            padding: const EdgeInsets.all(8),
                            child: Image.network(
                              encomenda.retiradoAssinatura!,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => const Center(
                                child: Icon(Icons.border_color, size: 32, color: Colors.grey),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Voltar', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildDetailRow(
    BuildContext context, {
    required IconData icon,
    required String label,
    String? value,
    Widget? widgetValue,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: AppColors.primary, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
              ),
              const SizedBox(height: 2),
              widgetValue ??
                  Text(
                    value ?? '',
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w500),
                  ),
            ],
          ),
        ),
      ],
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
      title: 'Escanear Código',
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
          // Borda do scanner no centro
          Center(
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primary, width: 3),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
