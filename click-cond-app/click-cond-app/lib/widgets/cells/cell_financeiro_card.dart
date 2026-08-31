import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/boleto_utils.dart';

/// Card moderno e estruturado de uma conta ou cobrança no app do morador.
class FinanceiroCard extends StatelessWidget {
  const FinanceiroCard({
    super.key,
    required this.item,
    this.onEnviarComprovante,
    this.onEditar,
    this.onExcluir,
    this.mostrarSeloPessoal = false,
  });

  final dynamic item;

  /// Envio de comprovante. Nulo esconde o botão.
  final VoidCallback? onEnviarComprovante;

  /// Edição da conta pessoal. Nulo esconde o botão.
  final VoidCallback? onEditar;

  /// Exclusão da conta pessoal. Nulo esconde o botão.
  final VoidCallback? onExcluir;

  /// Selo "Pessoal" — conta que o próprio morador lançou.
  final bool mostrarSeloPessoal;

  static bool _temValor(dynamic v) => v != null && v.toString().trim().isNotEmpty;

  static int _paraInt(dynamic v) =>
      v is int ? v : (int.tryParse(v?.toString() ?? '') ?? 0);

  static bool _isVencido(dynamic item, bool isPago) {
    if (isPago) return false;
    final String? v = item['data_vencimento']?.toString();
    if (v == null || v.isEmpty || v == '—') return false;
    try {
      if (v.contains('/')) {
        final parts = v.split('/');
        if (parts.length == 3) {
          final day = int.parse(parts[0]);
          final month = int.parse(parts[1]);
          final year = int.parse(parts[2]);
          final dueDate = DateTime(year, month, day, 23, 59, 59);
          return dueDate.isBefore(DateTime.now());
        }
      }
      final parsed = DateTime.tryParse(v);
      if (parsed != null) {
        return parsed.isBefore(DateTime.now());
      }
    } catch (_) {}
    return false;
  }

  static IconData _getIconForCategory(String? categoria, String? tipo) {
    if (tipo == 'C') return PhosphorIcons.buildings;
    final cat = (categoria ?? '').toLowerCase();
    if (cat.contains('água') || cat.contains('agua')) return PhosphorIcons.drop;
    if (cat.contains('luz') || cat.contains('energia') || cat.contains('elétr')) return PhosphorIcons.lightning;
    if (cat.contains('gás') || cat.contains('gas')) return PhosphorIcons.fire;
    if (cat.contains('internet') || cat.contains('net') || cat.contains('wifi')) return PhosphorIcons.wifiHigh;
    if (cat.contains('condom')) return PhosphorIcons.buildings;
    return PhosphorIcons.receipt;
  }

  @override
  Widget build(BuildContext context) {
    final bool isPago = _paraInt(item['pago']) == 1;
    final bool isVerifying = _paraInt(item['status']) == 2;
    final bool isVencido = _isVencido(item, isPago);

    final Color statusColor = isPago
        ? const Color(0xFF10B981) // Emerald
        : (isVerifying
            ? const Color(0xFF3B82F6) // Blue
            : (isVencido
                ? const Color(0xFFEF4444) // Red
                : const Color(0xFFF59E0B))); // Amber

    final String nomeCompleto = (item['nome'] ?? 'Lançamento').toString();
    final int corte = nomeCompleto.indexOf(' - ');
    final String parteApto = corte > 0 ? nomeCompleto.substring(0, corte).trim() : nomeCompleto.trim();
    final String? referencia = corte > 0 ? nomeCompleto.substring(corte + 3).trim() : null;

    final String tipo = (item['tipo'] ?? 'C').toString();
    final String categoria = (item['categoria'] ?? (tipo == 'C' ? 'Taxa Condominial' : 'Conta Pessoal')).toString();

    // Título e Subtítulo elegantes
    String tituloPrincipal;
    String? subtituloInfo;

    if (tipo == 'C') {
      tituloPrincipal = categoria.isNotEmpty ? categoria : 'Taxa Condominial';
      subtituloInfo = parteApto.isNotEmpty
          ? (referencia != null ? '$parteApto • $referencia' : parteApto)
          : referencia;
    } else {
      tituloPrincipal = parteApto;
      subtituloInfo = referencia ?? categoria;
    }

    final String vencimento = (item['data_vencimento'] ?? item['data'] ?? '—').toString();
    final String valorFormatado = (item['valorReal'] ?? item['valorString'] ?? 'R\$ 0,00').toString();

    final bool temPix = _temValor(item['pix_copia_cola']);
    final bool temChavePix = _temValor(item['chave_pix']);
    final bool temBoletoOuCodigo = _temValor(item['linha_digitavel']) || _temValor(item['url_boleto']);
    final bool temUrlBoleto = _temValor(item['url_boleto']);
    final bool temComprovante = _temValor(item['url_comprovante']) || _temValor(item['photo']);

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppColors.border(context).withOpacity(0.8),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top status highlight line (subtle and sleek)
            Container(
              height: 3.5,
              width: double.infinity,
              color: statusColor.withOpacity(0.85),
            ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 1. HEADER: Ícone da categoria + Título + Status Pill
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Ícone temático com squircle suave
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: statusColor.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(
                          _getIconForCategory(categoria, tipo),
                          size: 22,
                          color: statusColor,
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Título e Subtítulo
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    tituloPrincipal,
                                    style: AppTypography.body(context).copyWith(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 15.5,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (mostrarSeloPessoal || tipo == 'D') ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppColors.primary.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: const Text(
                                      "Pessoal",
                                      style: TextStyle(
                                        color: AppColors.primary,
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            if (subtituloInfo != null && subtituloInfo.isNotEmpty) ...[
                              const SizedBox(height: 3),
                              Text(
                                subtituloInfo,
                                style: AppTypography.caption(context).copyWith(
                                  color: AppColors.textSecondary(context),
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w500,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Badge de Status moderno com ícone
                      _buildStatusPill(context, isPago, isVerifying, isVencido),
                    ],
                  ),

                  const SizedBox(height: 16),

                  // 2. PAINEL DE VALOR E VENCIMENTO
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.bg(context).withOpacity(0.55),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: AppColors.border(context).withOpacity(0.6),
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        // Coluna de Vencimento
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isPago ? "PAGAMENTO" : "VENCIMENTO",
                              style: TextStyle(
                                fontSize: 10.5,
                                letterSpacing: 0.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textTertiary(context),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Icon(
                                  isPago
                                      ? PhosphorIcons.checkCircle
                                      : (isVencido ? PhosphorIcons.warningCircle : PhosphorIcons.calendarBlank),
                                  size: 14,
                                  color: isPago
                                      ? Colors.green
                                      : (isVencido ? Colors.redAccent : AppColors.textSecondary(context)),
                                ),
                                const SizedBox(width: 5),
                                Text(
                                  vencimento,
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: isVencido && !isPago
                                        ? Colors.redAccent
                                        : AppColors.textPrimary(context),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                        // Coluna de Valor
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              isPago ? "VALOR PAGO" : "VALOR TOTAL",
                              style: TextStyle(
                                fontSize: 10.5,
                                letterSpacing: 0.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textTertiary(context),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              valorFormatado,
                              style: TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.w800,
                                color: isPago ? const Color(0xFF10B981) : AppColors.textPrimary(context),
                                letterSpacing: -0.5,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // 3. AÇÕES DE PAGAMENTO E COMPROVANTE
                  if (!isPago) ...[
                    const SizedBox(height: 16),
                    // BOTÃO PRINCIPAL DE PAGAMENTO (COPIAR CÓDIGO OU PAGAR PIX)
                    if (temPix)
                      _botaoPrincipalPagamento(
                        context,
                        icone: PhosphorIcons.qrCode,
                        texto: "Pagar com Pix (QR Code)",
                        corFundo: const Color(0xFF00A868),
                        onTap: () => _abrirSheetPixQrCode(context),
                      )
                    else if (temBoletoOuCodigo)
                      _botaoPrincipalPagamento(
                        context,
                        icone: PhosphorIcons.barcode,
                        texto: "Copiar código do boleto",
                        corFundo: AppColors.primary,
                        onTap: () => copiarLinhaDigitavelOuExtrair(context, item),
                      )
                    else if (temChavePix)
                      _botaoPrincipalPagamento(
                        context,
                        icone: PhosphorIcons.copy,
                        texto: "Copiar chave Pix do condomínio",
                        corFundo: AppColors.primary,
                        onTap: () => _abrirSheetChavePix(context),
                      ),

                    // LINHA DE AÇÕES SECUNDÁRIAS (VER BOLETO, ENVIAR COMPROVANTE, EDITAR/EXCLUIR)
                    if (temUrlBoleto || onEnviarComprovante != null || onEditar != null || onExcluir != null) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          if (temUrlBoleto)
                            Expanded(
                              child: _botaoSecundario(
                                context,
                                icone: PhosphorIcons.filePdf,
                                texto: "Ver boleto",
                                corIcone: Colors.redAccent,
                                onTap: () => launchUrl(Uri.parse(item['url_boleto'].toString())),
                              ),
                            ),
                          if (temUrlBoleto && onEnviarComprovante != null) const SizedBox(width: 8),
                          if (onEnviarComprovante != null)
                            Expanded(
                              child: _botaoSecundario(
                                context,
                                icone: PhosphorIcons.uploadSimple,
                                texto: "Comprovante",
                                corIcone: AppColors.primary,
                                onTap: onEnviarComprovante!,
                              ),
                            ),
                          if (onEditar != null) ...[
                            const SizedBox(width: 8),
                            _botaoAcaoIcone(
                              icone: PhosphorIcons.pencil,
                              cor: Colors.blueAccent,
                              tooltip: 'Editar conta',
                              onTap: onEditar!,
                            ),
                          ],
                          if (onExcluir != null) ...[
                            const SizedBox(width: 6),
                            _botaoAcaoIcone(
                              icone: PhosphorIcons.trash,
                              cor: Colors.redAccent,
                              tooltip: 'Excluir conta',
                              onTap: onExcluir!,
                            ),
                          ],
                        ],
                      ),
                    ],

                    // Aviso quando não há dados de pagamento
                    if (!temPix && !temBoletoOuCodigo && !temChavePix) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                        decoration: BoxDecoration(
                          color: AppColors.textTertiary(context).withOpacity(0.08),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Icon(PhosphorIcons.info, size: 15, color: AppColors.textTertiary(context)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Aguardando dados de pagamento (Pix ou boleto) do condomínio.',
                                style: AppTypography.tiny(context).copyWith(
                                  color: AppColors.textTertiary(context),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ] else ...[
                    // Se já estiver pago: mostra confirmação visual e ações
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        if (temComprovante)
                          Expanded(
                            child: _botaoSecundario(
                              context,
                              icone: PhosphorIcons.fileText,
                              texto: "Ver comprovante",
                              corIcone: Colors.green,
                              onTap: () {
                                final url = item['url_comprovante'] ?? item['photo'];
                                if (_temValor(url)) {
                                  launchUrl(Uri.parse(url.toString()));
                                }
                              },
                            ),
                          ),
                        if (temComprovante && temUrlBoleto) const SizedBox(width: 8),
                        if (temUrlBoleto)
                          Expanded(
                            child: _botaoSecundario(
                              context,
                              icone: PhosphorIcons.filePdf,
                              texto: "Ver boleto",
                              corIcone: Colors.redAccent,
                              onTap: () => launchUrl(Uri.parse(item['url_boleto'].toString())),
                            ),
                          ),
                        if (onEditar != null) ...[
                          const SizedBox(width: 8),
                          _botaoAcaoIcone(
                            icone: PhosphorIcons.pencil,
                            cor: Colors.blueAccent,
                            tooltip: 'Editar conta',
                            onTap: onEditar!,
                          ),
                        ],
                        if (onExcluir != null) ...[
                          const SizedBox(width: 6),
                          _botaoAcaoIcone(
                            icone: PhosphorIcons.trash,
                            cor: Colors.redAccent,
                            tooltip: 'Excluir conta',
                            onTap: onExcluir!,
                          ),
                        ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Badge de Status estilizado (Pill com ícone e cores suaves)
  Widget _buildStatusPill(BuildContext context, bool isPago, bool isVerifying, bool isVencido) {
    Color cor;
    IconData icone;
    String texto;

    if (isPago) {
      cor = const Color(0xFF10B981);
      icone = PhosphorIcons.checkCircleFill;
      texto = "Pago";
    } else if (isVerifying) {
      cor = const Color(0xFF3B82F6);
      icone = PhosphorIcons.arrowsClockwise;
      texto = "Em análise";
    } else if (isVencido) {
      cor = const Color(0xFFEF4444);
      icone = PhosphorIcons.warningCircleFill;
      texto = "Vencido";
    } else {
      cor = const Color(0xFFF59E0B);
      icone = PhosphorIcons.clock;
      texto = "Pendente";
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4.5),
      decoration: BoxDecoration(
        color: cor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: cor.withOpacity(0.35), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icone, size: 13, color: cor),
          const SizedBox(width: 4),
          Text(
            texto,
            style: TextStyle(
              color: cor,
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }

  /// Botão Principal de Pagamento destacado (Largura total, ícone grande e feedback)
  Widget _botaoPrincipalPagamento(
    BuildContext context, {
    required IconData icone,
    required String texto,
    required Color corFundo,
    required VoidCallback onTap,
  }) {
    return Material(
      color: corFundo,
      borderRadius: BorderRadius.circular(13),
      elevation: 0,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icone, size: 19, color: Colors.white),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  texto,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: 0.2,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Botão Secundário (Ver boleto, Enviar comprovante)
  Widget _botaoSecundario(
    BuildContext context, {
    required IconData icone,
    required String texto,
    required Color corIcone,
    required VoidCallback onTap,
  }) {
    return Material(
      color: AppColors.bg(context).withOpacity(0.6),
      borderRadius: BorderRadius.circular(11),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(11),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(11),
            border: Border.all(
              color: AppColors.border(context).withOpacity(0.7),
              width: 1,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icone, size: 15, color: corIcone),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  texto,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary(context),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Botão de Ação Ícone (Editar, Excluir)
  Widget _botaoAcaoIcone({
    required IconData icone,
    required Color cor,
    required String tooltip,
    required VoidCallback onTap,
  }) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: cor.withOpacity(0.10),
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.all(9),
            child: Icon(icone, size: 17, color: cor),
          ),
        ),
      ),
    );
  }

  /// Pix copia-e-cola da cobrança com QR Code
  void _abrirSheetPixQrCode(BuildContext context) {
    final String payload = (item['pix_copia_cola'] ?? '').toString();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border(context),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                "Pague com Pix",
                style: AppTypography.title(sheetContext).copyWith(
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                "Escaneie o QR Code abaixo ou copie o código:",
                style: AppTypography.caption(sheetContext),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              Container(
                width: 190,
                height: 190,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: Colors.grey.shade200),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 10,
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: QrImageView(
                    data: payload,
                    size: 190,
                    backgroundColor: Colors.white,
                    padding: EdgeInsets.zero,
                  ),
                ),
              ),
              const SizedBox(height: 22),
              ElevatedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: payload));
                  Navigator.pop(sheetContext);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text("Código Pix Copia e Cola copiado!"),
                      backgroundColor: Colors.green,
                    ),
                  );
                },
                icon: const Icon(PhosphorIcons.copy, size: 18, color: Colors.white),
                label: const Text(
                  "Copiar Código Pix",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00A868),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Chave Pix do condomínio
  void _abrirSheetChavePix(BuildContext context) {
    final String chave = (item['chave_pix'] ?? '').toString();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border(context),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                "Chave Pix do Condomínio",
                style: AppTypography.title(sheetContext).copyWith(
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                "Utilize a chave Pix abaixo para realizar o pagamento manual:",
                textAlign: TextAlign.center,
                style: AppTypography.body(sheetContext).copyWith(fontSize: 13),
              ),
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.bg(sheetContext),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border(sheetContext)),
                ),
                child: SelectableText(
                  chave,
                  style: AppTypography.body(sheetContext).copyWith(
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 22),
              ElevatedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: chave));
                  Navigator.pop(sheetContext);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text("Chave Pix copiada com sucesso!"),
                      backgroundColor: Colors.green,
                    ),
                  );
                },
                icon: const Icon(PhosphorIcons.copy, size: 18, color: Colors.white),
                label: const Text(
                  "Copiar Chave Pix",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
