import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';

/// Card de uma conta ou cobrança na tela financeira do morador.
///
/// Existia duplicado em `list_financeiro.dart` e `morador_financeiro_view.dart`,
/// com layouts que já tinham divergido entre si — mexer num não mudava o outro.
/// Aqui é a única implementação; as duas telas passaram a usar esta.
///
/// As ações de pagamento (Pix, código de barras, boleto) são autocontidas,
/// porque dependem só do próprio lançamento. O que envolve estado da tela
/// (enviar comprovante, editar, excluir) entra por callback — quando o callback
/// é nulo, o botão simplesmente não aparece.
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

  /// Nenhum meio de pagamento anexado à cobrança.
  bool get _semCodigoPagamento =>
      !_temValor(item['pix_copia_cola']) &&
      !_temValor(item['linha_digitavel']) &&
      !_temValor(item['url_boleto']);

  @override
  Widget build(BuildContext context) {
    final bool isPago = _paraInt(item['pago']) == 1;
    final bool isVerifying = _paraInt(item['status']) == 2;

    final Color statusColor =
        isPago ? Colors.green : (isVerifying ? Colors.blue : Colors.orange);

    // O nome vem do backend como "Apto 1 Bloco a - Ref. 08/2026". Separar a
    // unidade da referência dá hierarquia ao card; conta pessoal ("Conta de
    // Água") não tem o hífen e cai no fallback.
    final String nomeCompleto = (item['nome'] ?? 'Lançamento').toString();
    final int corte = nomeCompleto.indexOf(' - ');
    final String titulo = corte > 0 ? nomeCompleto.substring(0, corte) : nomeCompleto;
    final String? referencia =
        corte > 0 ? nomeCompleto.substring(corte + 3).trim() : null;

    final String vencimento =
        (item['data_vencimento'] ?? item['data'] ?? '—').toString();

    final bool temRodape =
        (!isPago && !isVerifying && onEnviarComprovante != null) ||
            onEditar != null ||
            onExcluir != null;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      // A faixa de status é a borda esquerda do card inteiro, em vez de um
      // tracinho solto ao lado do título: o estado se lê antes do texto.
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(width: 4, color: statusColor),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _cabecalho(context, titulo, referencia, vencimento, isPago),
                      if (!isPago) ...[
                        const SizedBox(height: 14),
                        _acoesDePagamento(context),
                      ],
                      if (temRodape) ...[
                        const SizedBox(height: 14),
                        _rodape(context, isPago, isVerifying),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Título à esquerda; valor e status juntos à direita, que é onde o olho vai
  /// primeiro — "quanto" e "estou devendo?" na mesma leitura.
  Widget _cabecalho(
    BuildContext context,
    String titulo,
    String? referencia,
    String vencimento,
    bool isPago,
  ) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      titulo,
                      style: AppTypography.bodyMedium(context)
                          .copyWith(fontWeight: FontWeight.w700, height: 1.25),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (mostrarSeloPessoal) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        "Pessoal",
                        style: TextStyle(
                          color: AppColors.primary,
                          fontSize: 8,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 6),
              // Referência e vencimento na mesma linha: são a mesma informação
              // temporal, e separá-las só inchava o card.
              Row(
                children: [
                  Icon(PhosphorIcons.calendarBlank,
                      size: 13, color: AppColors.textTertiary(context)),
                  const SizedBox(width: 5),
                  Flexible(
                    child: Text(
                      referencia != null
                          ? "$referencia · vence $vencimento"
                          : "Vence em $vencimento",
                      style: AppTypography.caption(context),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              item['valorReal'] ?? item['valorString'] ?? 'R\$ 0,00',
              style: AppTypography.bodyMedium(context).copyWith(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                height: 1.1,
                color: isPago ? Colors.green : AppColors.textPrimary(context),
              ),
            ),
            const SizedBox(height: 6),
            _seloStatus(context),
          ],
        ),
      ],
    );
  }

  Widget _seloStatus(BuildContext context) {
    final bool isPago = _paraInt(item['pago']) == 1;
    final bool isVerifying = _paraInt(item['status']) == 2;

    final Color cor =
        isPago ? Colors.green : (isVerifying ? Colors.blue : Colors.orange);
    final String texto = isPago ? "Pago" : (isVerifying ? "Verificando" : "Pendente");

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: cor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: cor.withOpacity(0.45)),
      ),
      child: Text(
        texto,
        style: TextStyle(color: cor, fontSize: 11, fontWeight: FontWeight.bold),
      ),
    );
  }

  /// Chips dos meios de pagamento disponíveis.
  ///
  /// `Wrap` e não `Row` com `Expanded`: com um meio só, o botão esticava pela
  /// largura inteira e ficava boiando no meio do card.
  Widget _acoesDePagamento(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (_temValor(item['pix_copia_cola']))
              _chip(
                context,
                icone: PhosphorIcons.qrCode,
                texto: "Pagar Pix",
                destaque: true,
                onTap: () => _abrirSheetPixQrCode(context),
              )
            else if (_temValor(item['chave_pix']))
              _chip(
                context,
                icone: PhosphorIcons.copy,
                texto: "Copiar Pix",
                destaque: true,
                onTap: () => _abrirSheetChavePix(context),
              ),
            if (_temValor(item['linha_digitavel']))
              _chip(
                context,
                icone: PhosphorIcons.barcode,
                texto: "Copiar código",
                onTap: () {
                  Clipboard.setData(
                      ClipboardData(text: item['linha_digitavel'].toString()));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: const Text("Código de barras copiado!"),
                      backgroundColor: AppColors.textSecondary(context),
                    ),
                  );
                },
              ),
            if (_temValor(item['url_boleto']))
              _chip(
                context,
                icone: PhosphorIcons.filePdf,
                texto: "Ver boleto",
                cor: Colors.redAccent,
                onTap: () => launchUrl(Uri.parse(item['url_boleto'].toString())),
              ),
          ],
        ),
        if (_semCodigoPagamento && !_temValor(item['chave_pix'])) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.textTertiary(context).withOpacity(0.08),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(PhosphorIcons.info, size: 14, color: AppColors.textTertiary(context)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Aguardando os dados de pagamento (PIX ou boleto) do síndico.',
                    style: AppTypography.tiny(context)
                        .copyWith(color: AppColors.textTertiary(context)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _rodape(BuildContext context, bool isPago, bool isVerifying) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (!isPago && !isVerifying && onEnviarComprovante != null)
          Expanded(
            child: ElevatedButton.icon(
              onPressed: onEnviarComprovante,
              icon: const Icon(PhosphorIcons.uploadSimple, size: 16),
              label: const Text(
                "Enviar comprovante",
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                // Sem foregroundColor o tema escuro pintava o texto da mesma
                // cor do fundo — botão azul "vazio".
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        if (onEditar != null) ...[
          const SizedBox(width: 8),
          _botaoIcone(PhosphorIcons.pencil, Colors.blueAccent, 'Editar conta', onEditar!),
        ],
        if (onExcluir != null) ...[
          const SizedBox(width: 6),
          _botaoIcone(PhosphorIcons.trash, Colors.redAccent, 'Excluir conta', onExcluir!),
        ],
      ],
    );
  }

  Widget _chip(
    BuildContext context, {
    required IconData icone,
    required String texto,
    required VoidCallback onTap,
    bool destaque = false,
    Color? cor,
  }) {
    final Color base = cor ?? AppColors.primary;
    return Material(
      color: destaque ? base : base.withOpacity(0.08),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icone, size: 15, color: destaque ? Colors.white : base),
              const SizedBox(width: 6),
              Text(
                texto,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: destaque ? Colors.white : base,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Área de toque decente para editar/excluir — antes eram `IconButton` sem
  /// padding, difíceis de acertar com o dedo.
  Widget _botaoIcone(IconData icone, Color cor, String tooltip, VoidCallback onTap) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: cor.withOpacity(0.10),
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Icon(icone, size: 18, color: cor),
          ),
        ),
      ),
    );
  }

  /// Pix copia-e-cola da cobrança. O QR é gerado localmente (qr_flutter):
  /// funciona offline e sem depender de serviço externo.
  void _abrirSheetPixQrCode(BuildContext context) {
    final String payload = item['pix_copia_cola'].toString();
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Pague com o Pix",
                style: AppTypography.title(sheetContext).copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                "Escaneie o QR Code abaixo para pagar",
                style: AppTypography.caption(sheetContext),
              ),
              const SizedBox(height: 20),
              Container(
                width: 200,
                height: 200,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: QrImageView(
                    data: payload,
                    size: 200,
                    backgroundColor: Colors.white,
                    padding: const EdgeInsets.all(12),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: payload));
                  Navigator.pop(sheetContext);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text("Pix Copia e Cola copiado!"),
                      backgroundColor: AppColors.primary,
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: const Text("Copiar Código Pix"),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Chave Pix do condomínio, para pagamento manual quando a cobrança não tem
  /// copia-e-cola próprio.
  void _abrirSheetChavePix(BuildContext context) {
    final String chave = item['chave_pix'].toString();
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Chave Pix do Condomínio",
                style: AppTypography.title(sheetContext).copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Text(
                "Utilize a chave Pix abaixo para realizar o pagamento manual:",
                textAlign: TextAlign.center,
                style: AppTypography.bodyMedium(sheetContext),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface(sheetContext),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border(sheetContext)),
                ),
                child: SelectableText(
                  chave,
                  style: AppTypography.bodyMedium(sheetContext).copyWith(
                    fontWeight: FontWeight.bold,
                    fontFamily: 'monospace',
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: chave));
                  Navigator.pop(sheetContext);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text("Chave Pix copiada com sucesso!"),
                      backgroundColor: AppColors.primary,
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: const Text("Copiar Chave Pix"),
              ),
            ],
          ),
        );
      },
    );
  }
}
