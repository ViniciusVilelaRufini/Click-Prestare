import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/pages/singleton.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';

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

  double get _totalDivida {
    double total = 0;
    for (var item in list) {
      total += double.tryParse((item['valor'] ?? '0').toString()) ?? 0;
    }
    return total;
  }

  /// Acordo de parcelamento: o backend marca os débitos atuais como
  /// renegociados (status 3) e cria as parcelas novas com Pix.
  Future<void> _abrirAcordo() async {
    final txtValor = TextEditingController(
        text: _totalDivida.toStringAsFixed(2).replaceAll('.', ','));
    final txtParcelas = TextEditingController(text: '3');

    final confirmou = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        backgroundColor: AppColors.surface(c),
        title: Text('Acordo de Parcelamento', style: AppTypography.title(c)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Os débitos em aberto serão marcados como renegociados e substituídos '
              'por novas parcelas mensais (vencimento todo dia 10).',
              style: AppTypography.caption(c),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: txtValor,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Valor total do acordo'),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: txtParcelas,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Número de parcelas'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Firmar Acordo'),
          ),
        ],
      ),
    );
    if (confirmou != true || !mounted) return;

    final valor = double.tryParse(txtValor.text.replaceAll('.', '').replaceAll(',', '.')) ?? 0;
    final parcelas = int.tryParse(txtParcelas.text) ?? 0;
    if (valor <= 0 || parcelas <= 0) {
      displayMessage(context, getText('alert'), 'Informe valor e número de parcelas válidos.');
      return;
    }

    setState(() => _isLoading = true);
    final res = await apiCreateAcordoInadimplente({
      'apto': widget.apto,
      'bloco': widget.bloco,
      'parcelas': parcelas,
      'valorTotal': valor,
    });
    if (!mounted) return;
    setState(() => _isLoading = false);
    if (res['ok'] == true) {
      await displayMessage(context, getText('alert'), res['message'].toString());
      load();
    } else {
      displayMessage(context, getText('alert_error'), res['message'].toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_inadimplente'),
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
                  if (list.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.xl),
                      child: OutlinedButton.icon(
                        onPressed: _abrirAcordo,
                        icon: const Icon(PhosphorIcons.handshake, color: AppColors.primary),
                        label: const Text('Firmar Acordo de Parcelamento',
                            style: TextStyle(color: AppColors.primary)),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 44),
                          side: const BorderSide(color: AppColors.primary),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
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

  String _formatValor(dynamic valor) {
    if (valor == null) return '0,00';
    try {
      double val = double.parse(valor.toString());
      return val.toStringAsFixed(2).replaceAll('.', ',');
    } catch (_) {
      return valor.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasRecord = item['id'] != null;
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
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          Widget page;
          if (hasRecord) {
            page = NewFinanceiroMorador(id: item['id'], apto: null);
          } else {
            page = NewFinanceiroMorador(
              id: null,
              apto: {
                "bloco": bloco,
                "apto": apto,
                "mes": item['mes'],
                "ano": item['ano'],
                "pago": 0,
                "financeiro_id": -1,
                "valor": item['valor'].toString(),
                "data_vencimento": item['data_vencimento'] ?? '',
                "descricao": "",
                "conta": "",
                "linha_digitavel": "",
                "pix_copia_cola": "",
                "categoria": "Condomínio"
              },
            );
          }
          Navigator.push(context, MaterialPageRoute(builder: (_) => page)).then((value) {
            onRefresh();
          });
        },
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
              const SizedBox(width: AppSpacing.sm),
              Icon(
                PhosphorIcons.caretRight,
                size: 16,
                color: AppColors.textTertiary(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
