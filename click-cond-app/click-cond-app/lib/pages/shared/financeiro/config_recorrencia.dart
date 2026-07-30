import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Configuração da cobrança automática (recorrência) do condomínio.
///
/// É aqui que o síndico define o valor da taxa condominial — o backend
/// rejeita ativar recorrência com valor zero (era a origem das cobranças
/// de R$ 0,00 que poluíam a inadimplência).
class ConfigRecorrencia extends StatefulWidget {
  const ConfigRecorrencia({Key? key}) : super(key: key);

  @override
  ConfigRecorrenciaState createState() => ConfigRecorrenciaState();
}

class ConfigRecorrenciaState extends State<ConfigRecorrencia> {
  bool _isLoading = true;
  bool _isSaving = false;

  bool _recorrenciaAtiva = false;
  bool _cobrancaAutoWhats = false;
  final txtValor = TextEditingController();
  final txtDiaGeracao = TextEditingController(text: '1');
  final txtDiaVencimento = TextEditingController(text: '10');
  final txtCategoria = TextEditingController(text: 'Taxa Condominial');
  final txtChavePix = TextEditingController();
  final txtAviso1 = TextEditingController(text: '3');
  final txtAviso2 = TextEditingController(text: '7');
  final txtAviso3 = TextEditingController(text: '15');

  List<dynamic> _aptos = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    txtValor.dispose(); txtDiaGeracao.dispose(); txtDiaVencimento.dispose();
    txtCategoria.dispose(); txtChavePix.dispose();
    txtAviso1.dispose(); txtAviso2.dispose(); txtAviso3.dispose();
    super.dispose();
  }

  double get _valorAtual => parseValorMoeda(txtValor.text);

  Future<void> _load() async {
    try {
      setState(() => _isLoading = true);
      final cfg = await apiGetConfigAuto();
      final aptos = await apiGetApartamentosConfig();
      if (cfg is Map) {
        _recorrenciaAtiva = cfg['recorrencia_ativa'] == true;
        _cobrancaAutoWhats = cfg['cobranca_auto_whats'] == true;
        final valor = double.tryParse((cfg['valor_condominio'] ?? '0').toString()) ?? 0.0;
        txtValor.text = valorParaInput(valor);
        txtDiaGeracao.text = (cfg['dia_geracao'] ?? 1).toString();
        txtDiaVencimento.text = (cfg['dia_vencimento'] ?? 10).toString();
        txtCategoria.text = (cfg['categoria_padrao'] ?? 'Taxa Condominial').toString();
        txtChavePix.text = (cfg['chave_pix'] ?? '').toString();
        txtAviso1.text = (cfg['dias_atraso_aviso_1'] ?? 3).toString();
        txtAviso2.text = (cfg['dias_atraso_aviso_2'] ?? 7).toString();
        txtAviso3.text = (cfg['dias_atraso_aviso_3'] ?? 15).toString();
      }
      _aptos = aptos is List ? aptos : [];
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

  Future<void> _save() async {
    if (_recorrenciaAtiva && _valorAtual <= 0) {
      displayMessage(context, getText('alert'),
          'Para ativar a recorrência, informe o valor da taxa condominial (maior que zero).');
      return;
    }
    setState(() => _isSaving = true);
    final res = await apiUpdateConfigAuto({
      'recorrencia_ativa': _recorrenciaAtiva,
      'valor_condominio': _valorAtual,
      'dia_geracao': int.tryParse(txtDiaGeracao.text) ?? 1,
      'dia_vencimento': int.tryParse(txtDiaVencimento.text) ?? 10,
      'categoria_padrao': txtCategoria.text.trim().isEmpty ? 'Taxa Condominial' : txtCategoria.text.trim(),
      'cobranca_auto_whats': _cobrancaAutoWhats,
      'dias_atraso_aviso_1': int.tryParse(txtAviso1.text) ?? 3,
      'dias_atraso_aviso_2': int.tryParse(txtAviso2.text) ?? 7,
      'dias_atraso_aviso_3': int.tryParse(txtAviso3.text) ?? 15,
      'chave_pix': txtChavePix.text.trim(),
    });
    if (mounted) setState(() => _isSaving = false);
    if (!mounted) return;
    if (res['ok'] == true) {
      await displayMessage(context, getText('alert'),
          _recorrenciaAtiva
              ? 'Configuração salva! As faturas do mês atual serão geradas automaticamente.'
              : 'Configuração salva!');
      if (mounted) Navigator.of(context).pop(true);
    } else {
      displayMessage(context, getText('alert_error'), res['message'].toString());
    }
  }

  Future<void> _toggleApto(dynamic apto, bool ignorar) async {
    final res = await apiUpdateApartamentoRecorrencia(apto['id'], ignorar);
    if (!mounted) return;
    if (res['ok'] == true) {
      setState(() => apto['ignorar_recorrencia'] = ignorar);
    } else {
      displayMessage(context, getText('alert_error'), res['message'].toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final valorZeradoComRecorrencia = _recorrenciaAtiva && _valorAtual <= 0;
    return AppScaffold(
      title: 'Cobrança Automática',
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section('Recorrência mensal'),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text('Gerar cobrança mensal automática para todos os apartamentos',
                            style: AppTypography.body(context)),
                      ),
                      Switch(
                        value: _recorrenciaAtiva,
                        activeColor: AppColors.primary,
                        onChanged: (v) => setState(() => _recorrenciaAtiva = v),
                      ),
                    ],
                  ),
                  if (valorZeradoComRecorrencia)
                    Container(
                      margin: const EdgeInsets.only(bottom: AppSpacing.md),
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.error.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.error),
                      ),
                      child: Row(
                        children: [
                          const Icon(PhosphorIcons.warning, color: AppColors.error),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              'Informe o valor da taxa condominial. Recorrência com valor zero não gera faturas.',
                              style: AppTypography.caption(context).copyWith(color: AppColors.error),
                            ),
                          ),
                        ],
                      ),
                    ),
                  AppInput(
                    label: 'Valor da taxa condominial',
                    controller: txtValor,
                    prefixIcon: PhosphorIcons.currencyDollar,
                    keyboard: TextInputType.number,
                    formatters: [CurrencyTextInputFormatter.currency(decimalDigits: 2, symbol: '', locale: 'pt_BR')],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: 'Dia de geração',
                          controller: txtDiaGeracao,
                          prefixIcon: PhosphorIcons.calendarPlus,
                          keyboard: TextInputType.number,
                          formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(2)],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: 'Dia de vencimento',
                          controller: txtDiaVencimento,
                          prefixIcon: PhosphorIcons.calendarX,
                          keyboard: TextInputType.number,
                          formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(2)],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: 'Categoria das cobranças',
                    controller: txtCategoria,
                    prefixIcon: PhosphorIcons.tag,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: 'Chave Pix do condomínio (opcional)',
                    controller: txtChavePix,
                    prefixIcon: PhosphorIcons.qrCode,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section('Régua de cobrança (WhatsApp)'),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text('Cobrar automaticamente por WhatsApp após o vencimento',
                            style: AppTypography.body(context)),
                      ),
                      Switch(
                        value: _cobrancaAutoWhats,
                        activeColor: AppColors.primary,
                        onChanged: (v) => setState(() => _cobrancaAutoWhats = v),
                      ),
                    ],
                  ),
                  if (_cobrancaAutoWhats) ...[
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        Expanded(
                          child: AppInput(
                            label: '1º aviso (dias)',
                            controller: txtAviso1,
                            keyboard: TextInputType.number,
                            formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: AppInput(
                            label: '2º aviso',
                            controller: txtAviso2,
                            keyboard: TextInputType.number,
                            formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: AppInput(
                            label: '3º aviso',
                            controller: txtAviso3,
                            keyboard: TextInputType.number,
                            formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: getText('btn_save'),
                    onPressed: _isSaving ? null : _save,
                    loading: _isSaving,
                    icon: PhosphorIcons.floppyDisk,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section('Apartamentos (ignorar cobrança)'),
                  Text(
                    'Unidades marcadas abaixo não recebem a cobrança automática (ex.: unidade do zelador).',
                    style: AppTypography.caption(context),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  ..._aptos.map((a) => SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(
                          'Apto ${a['apto']}${(a['bloco'] ?? '').toString().isNotEmpty ? ' · Bloco ${a['bloco']}' : ''}',
                          style: AppTypography.body(context),
                        ),
                        activeColor: AppColors.primary,
                        value: a['ignorar_recorrencia'] == true,
                        onChanged: (v) => _toggleApto(a, v),
                      )),
                  const SizedBox(height: AppSpacing.xxxl),
                ],
              ),
            ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.tiny(context).copyWith(
                color: AppColors.primary, letterSpacing: 0.8, fontWeight: FontWeight.bold)),
      );
}
