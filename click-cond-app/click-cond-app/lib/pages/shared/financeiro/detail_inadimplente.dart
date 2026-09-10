import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/pages/singleton.dart';
import 'package:url_launcher/url_launcher.dart';

class DetailInadimplente extends StatefulWidget {
  const DetailInadimplente({Key? key, required this.bloco, required this.apto}) : super(key: key);
  final String bloco;
  final String apto;

  @override
  _DetailInadimplentePageState createState() => _DetailInadimplentePageState();
}

class _DetailInadimplentePageState extends State<DetailInadimplente> {
  List<dynamic> list = [];
  var _isLoading = false;
  var _notificando = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var locals = await apiGetDetailsInadimplente('financeiro/inadimplente', widget.bloco, widget.apto);
      list = locals;
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) {
        displayMessage(context, getText('alert_error'),
            e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Dispara a cobrança para os moradores da unidade (push + e-mail).
  ///
  /// O botão vivia só na linha de UMA das três listas que levam a esta tela.
  /// Pelos outros dois caminhos — o dashboard POR BLOCO e a
  /// `list_inadimplentes` — não havia como cobrar, e o síndico teria que
  /// voltar e lembrar de usar a listagem certa. Aqui é onde ele vê os meses
  /// em aberto e decide, então é aqui que a ação pertence — mesmo lugar que
  /// o modal de detalhe da portaria-web já usa.
  Future<void> _notificar() async {
    if (_notificando) return;
    setState(() => _notificando = true);

    final res = await apiNotificarInadimplente(widget.bloco, widget.apto);
    if (!mounted) return;
    setState(() => _notificando = false);

    final ok = res is Map && res['success'] == true;

    // Quem explica a falha é o servidor, não esta tela. Ele já distingue
    // "unidade sem morador cadastrado" de "morador sem e-mail nem app" e
    // manda o texto pronto em `message` — repetir a lógica aqui só criaria
    // duas versões da mesma frase para divergirem depois.
    //
    // No sucesso vale mostrar a contagem: "enviado" sozinho não diz se
    // chegou a três moradores ou a um.
    final String mensagem;
    if (ok) {
      final pessoas = int.tryParse('${res['moradoresNotificados'] ?? 0}') ?? 0;
      mensagem = 'Cobrança enviada para $pessoas '
          '${pessoas == 1 ? 'morador' : 'moradores'} do apto ${widget.apto}.';
    } else {
      mensagem = (res is Map ? res['message'] : null)?.toString() ?? 'Falha ao notificar.';
    }

    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(mensagem),
      backgroundColor: ok ? AppColors.primary : AppColors.error,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_inadimplente'),
      // No rodapé, e não dentro do corpo, por dois motivos: fica alcançável
      // sem rolar uma lista longa de meses em aberto, e não desaparece
      // enquanto a lista carrega.
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
        child: ElevatedButton.icon(
          onPressed: _notificando ? null : _notificar,
          icon: _notificando
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(PhosphorIcons.bell, size: 18),
          label: Text(_notificando ? 'Enviando...' : 'Notificar cobrança'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            minimumSize: const Size(double.infinity, 48),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Text(
                      '${getText('lb_bloco')} ${widget.bloco} · ${getText('lb_apartamento')} ${widget.apto}',
                      style: AppTypography.title(context).copyWith(color: AppColors.primary),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _section(getText('financeiro_meses_aberto')),
                  if (list.isEmpty)
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                        child: Text(
                          getText('alert_list_empty_generic'),
                          style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
                        ),
                      ),
                    )
                  else
                    for (var item in list)
                      _MonthCard(
                        item: item,
                        bloco: widget.bloco,
                        apto: widget.apto,
                        onRefresh: load,
                      ),
                  const SizedBox(height: AppSpacing.xxxl),
                ],
              ),
            ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}

class _MonthCard extends StatelessWidget {
  final dynamic item;
  final String bloco;
  final String apto;
  final VoidCallback onRefresh;

  const _MonthCard({
    required this.item,
    required this.bloco,
    required this.apto,
    required this.onRefresh,
  });

  // Sem o separador de milhar, uma dívida acumulada saía como "1250,75".
  String _formatValor(dynamic valor) => formatMoeda(valor);

  @override
  Widget build(BuildContext context) {
    final valorStr = _formatValor(item['valor']);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.orange.withOpacity(0.3),
        ),
      ),
      // Tocar no mes abria o formulario de cobranca do morador. O financeiro
      // do condominio e somente leitura (os lancamentos vem do ERP
      // Superlogica), entao o card so exibe a divida.
      child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  PhosphorIcons.calendarX,
                  color: Colors.orange,
                  size: 22,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${item['mes']}/${item['ano']}',
                      style: AppTypography.bodyMedium(context).copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Vcto: ${item['data_vencimento'] ?? '--/--/----'} • ${Singleton.instance.getCurrentMoeda()} $valorStr',
                      style: AppTypography.caption(context).copyWith(
                        color: AppColors.textSecondary(context),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  (() {
                    final statusVal = item['status'];
                    final statusInt = statusVal is int ? statusVal : int.tryParse(statusVal.toString()) ?? 0;
                    if (statusInt == 2) {
                      return Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.blue.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: Colors.blue.withOpacity(0.3),
                          ),
                        ),
                        child: Text(
                          'Auditoria',
                          style: AppTypography.tiny(context).copyWith(
                            color: Colors.blue,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      );
                    } else {
                      return Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.orange.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: Colors.orange.withOpacity(0.3),
                          ),
                        ),
                        child: Text(
                          'Pendente',
                          style: AppTypography.tiny(context).copyWith(
                            color: Colors.orange,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      );
                    }
                  })(),
                ],
              ),
              if (item['url_comprovante'] != null && item['url_comprovante'].toString().trim().isNotEmpty) ...[
                const SizedBox(width: AppSpacing.sm),
                IconButton(
                  icon: Icon(PhosphorIcons.eye, color: AppColors.primary),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () {
                    launchUrl(Uri.parse(item['url_comprovante'].toString()), mode: LaunchMode.externalApplication);
                  },
                ),
              ],
            ],
          ),
        ),
    );
  }
}
