import 'package:flutter/material.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
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

  /// Conta que o próprio morador lançou: tipo 'D' + id_usuario. A cobrança do
  /// condomínio também pode trazer id_usuario (tipo 'C'), por isso só o id não basta.
  static bool _ehContaPessoal(dynamic item) =>
      item['tipo']?.toString() == 'D' && item['id_usuario'] != null;

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
        ? AppColors.success // Emerald
        : (isVerifying
            ? AppColors.textSecondary(context) // Blue
            : (isVencido
                ? AppColors.error // Red
                : AppColors.warning)); // Amber

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

    // `url_boleto` guarda duas coisas diferentes, e a origem é o que decide
    // qual delas:
    //
    //  - vinda da Superlógica, é o `link_segundavia` do ERP: uma PÁGINA de
    //    pagamento, que aceita boleto, Pix e cartão de crédito.
    //  - vinda do Clique, é um arquivo (PDF/imagem) que alguém anexou.
    //
    // Só a primeira paga. Oferecer "pagar com cartão" em cima de um PDF
    // manda o morador para um documento e promete o que o link não faz.
    final bool ehSuperlogica = (item['origem']?.toString() ?? '') == 'superlogica';
    final bool pagaOnline = ehSuperlogica && temUrlBoleto;
    final bool temComprovante = _temValor(item['url_comprovante']) || _temValor(item['photo']);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 1. HEADER: Ícone da categoria + Título + Status Pill
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Ícone temático com squircle suave
                      AppIconBox(icon: _getIconForCategory(categoria, tipo)),
                      const SizedBox(width: 14),
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
                                    style: AppTypography.strong(context),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (mostrarSeloPessoal || tipo == 'D') ...[
                                  const SizedBox(width: 6),
                                  const AppTag(label: "Pessoal"),
                                ],
                              ],
                            ),
                            if (subtituloInfo != null && subtituloInfo.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                subtituloInfo,
                                style: AppTypography.tiny(context),
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
                    padding: const EdgeInsets.only(top: 12),
                    decoration: BoxDecoration(
                      border: Border(top: BorderSide(color: AppColors.border(context))),
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
                              (isPago ? "PAGAMENTO" : "VENCIMENTO"),
                              style: AppTypography.label(context),
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
                                      ? AppColors.success
                                      : (isVencido ? AppColors.error : AppColors.textSecondary(context)),
                                ),
                                const SizedBox(width: 5),
                                Text(
                                  vencimento,
                                  style: AppTypography.captionMedium(context).copyWith(
                                    color: isVencido && !isPago
                                        ? AppColors.error
                                        : AppColors.textPrimary(context),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(width: 12),
                        // Coluna de Valor
                        Flexible(
                          child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              (isPago ? "VALOR PAGO" : "VALOR TOTAL"),
                              style: AppTypography.label(context),
                            ),
                            const SizedBox(height: 2),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerRight,
                              child: Text(
                                valorFormatado,
                                maxLines: 1,
                                softWrap: false,
                                style: AppTypography.numeral(context).copyWith(fontSize: 22, height: 1.1),
                              ),
                            ),
                          ],
                        ),
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
                        corFundo: AppColors.brand,
                        onTap: () => _abrirSheetPixQrCode(context),
                      )
                    else if (temBoletoOuCodigo)
                      _botaoPrincipalPagamento(
                        context,
                        icone: PhosphorIcons.barcode,
                        texto: "Copiar código do boleto",
                        corFundo: AppColors.brand,
                        onTap: () => copiarLinhaDigitavelOuExtrair(context, item),
                      )
                    else if (temChavePix)
                      _botaoPrincipalPagamento(
                        context,
                        icone: PhosphorIcons.copy,
                        texto: "Copiar chave Pix do condomínio",
                        corFundo: AppColors.brand,
                        onTap: () => _abrirSheetChavePix(context),
                      ),

                    // A escolha do botão principal acima é um if/else: quando há
                    // Pix, o código de barras nunca aparecia. E a taxa vinda da
                    // Superlógica traz SEMPRE as duas coisas — Pix e boleto —,
                    // então quem prefere pagar por código de barras ficava só
                    // com "Ver boleto", que abre o documento mas não dá o número
                    // para colar no app do banco.
                    //
                    // Vale a pena consertar porque o número existe e custa caro:
                    // a linha digitável não vem na listagem do ERP, ela é raspada
                    // do HTML da 2ª via a cada sincronização.
                    if (temPix && temBoletoOuCodigo) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: _botaoSecundario(
                              context,
                              icone: PhosphorIcons.barcode,
                              texto: "Copiar código de barras",
                              corIcone: AppColors.primary,
                              onTap: () => copiarLinhaDigitavelOuExtrair(context, item),
                            ),
                          ),
                        ],
                      ),
                    ],

                    // Cartão de crédito. Fica abaixo do Pix de propósito: o Pix
                    // é instantâneo e não cobra taxa de cartão do condomínio,
                    // então é ele quem merece o destaque. O cartão é a
                    // alternativa de quem precisa parcelar.
                    if (pagaOnline) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: _botaoSecundario(
                              context,
                              icone: PhosphorIcons.creditCard,
                              texto: "Pagar com cartão",
                              corIcone: AppColors.textSecondary(context),
                              onTap: () => launchUrl(
                                Uri.parse(item['url_boleto'].toString()),
                                mode: LaunchMode.externalApplication,
                              ),
                            ),
                          ),
                        ],
                      ),
                      // O pagamento acontece fora do app e a baixa só chega na
                      // próxima sincronização. Sem este aviso, o morador paga,
                      // volta, vê "Pendente" e acha que não funcionou — no
                      // cartão isso é ainda mais provável que no Pix.
                      const SizedBox(height: 6),
                      Text(
                        'O pagamento abre no navegador. A baixa pode levar alguns minutos para aparecer aqui.',
                        style: AppTypography.tiny(context).copyWith(
                          color: AppColors.textTertiary(context),
                        ),
                      ),
                    ],

                    // LINHA DE AÇÕES SECUNDÁRIAS (VER BOLETO, ENVIAR COMPROVANTE, EDITAR/EXCLUIR)
                    if (temUrlBoleto || onEnviarComprovante != null || onEditar != null || onExcluir != null) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          if (temUrlBoleto)
                            Expanded(
                              child: _botaoSecundario(
                                context,
                                // Da Superlógica o link é a página de 2ª via do
                                // ERP, não um PDF. Ícone de documento e o
                                // rótulo "Ver boleto" descreviam errado o que
                                // está do outro lado.
                                icone: pagaOnline ? PhosphorIcons.arrowSquareOut : PhosphorIcons.filePdf,
                                texto: pagaOnline ? "Abrir 2ª via" : "Ver boleto",
                                corIcone: pagaOnline ? AppColors.primary : AppColors.error,
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
                              cor: AppColors.primary,
                              tooltip: 'Editar conta',
                              onTap: onEditar!,
                            ),
                          ],
                          if (onExcluir != null) ...[
                            const SizedBox(width: 6),
                            _botaoAcaoIcone(
                              icone: PhosphorIcons.trash,
                              cor: AppColors.error,
                              tooltip: 'Excluir conta',
                              onTap: onExcluir!,
                            ),
                          ],
                        ],
                      ),
                    ],

                    // Aviso quando não há dados de pagamento
                    // (só cobrança do condomínio: conta pessoal não tem o que aguardar)
                    if (!temPix && !temBoletoOuCodigo && !temChavePix && !_ehContaPessoal(item)) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                        decoration: BoxDecoration(
                          color: AppColors.textTertiary(context).withValues(alpha: 0.08),
                          borderRadius: BorderRadius.zero,
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
                              corIcone: AppColors.success,
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
                              corIcone: AppColors.error,
                              onTap: () => launchUrl(Uri.parse(item['url_boleto'].toString())),
                            ),
                          ),
                        if (onEditar != null) ...[
                          const SizedBox(width: 8),
                          _botaoAcaoIcone(
                            icone: PhosphorIcons.pencil,
                            cor: AppColors.primary,
                            tooltip: 'Editar conta',
                            onTap: onEditar!,
                          ),
                        ],
                        if (onExcluir != null) ...[
                          const SizedBox(width: 6),
                          _botaoAcaoIcone(
                            icone: PhosphorIcons.trash,
                            cor: AppColors.error,
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
    String texto;

    if (isPago) {
      texto = "Pago";
    } else if (isVerifying) {
      texto = "Em análise";
    } else if (isVencido) {
      texto = "Vencido";
    } else {
      texto = "Pendente";
    }

    final signal = isPago
        ? AppSignal.ok
        : (isVerifying ? AppSignal.neutral : (isVencido ? AppSignal.danger : AppSignal.warn));
    return AppTag(label: texto, signal: signal);
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
      color: AppColors.brand,
      child: InkWell(
        onTap: onTap,
        child: Container(
          width: double.infinity,
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icone, size: 18, color: AppColors.onBrand),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  texto.toUpperCase(),
                  style: AppTypography.button(context).copyWith(color: AppColors.onBrand),
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
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.borderStrong(context)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icone, size: 15, color: AppColors.textPrimary(context)),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  texto.toUpperCase(),
                  style: AppTypography.label(context).copyWith(color: AppColors.textPrimary(context)),
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
        color: cor.withValues(alpha: 0.10),
        borderRadius: BorderRadius.zero,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.zero,
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
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.borderStrong(context)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 3,
                decoration: BoxDecoration(
                          color: AppColors.borderStrong(context),
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
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.qrPaper,
                  border: Border.all(color: AppColors.border(context)),
                  borderRadius: BorderRadius.zero,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.zero,
                  child: QrImageView(
                    data: payload,
                    size: 190,
                    backgroundColor: AppColors.qrPaper,
                      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: AppColors.qrInk),
                      dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: AppColors.qrInk),
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
                    SnackBar(
                      content: Text("Código Pix Copia e Cola copiado!"),
                    ),
                  );
                },
                icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onBrand),
                label: const Text(
                  "Copiar Código Pix",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brand,
                  foregroundColor: AppColors.onBrand,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.zero,
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
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.borderStrong(context)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 3,
                decoration: BoxDecoration(
                          color: AppColors.borderStrong(context),
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
                  borderRadius: BorderRadius.zero,
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
                    SnackBar(
                      content: Text("Chave Pix copiada com sucesso!"),
                    ),
                  );
                },
                icon: Icon(PhosphorIcons.copy, size: 18, color: AppColors.onBrand),
                label: const Text(
                  "Copiar Chave Pix",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brand,
                  foregroundColor: AppColors.onBrand,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.zero,
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
