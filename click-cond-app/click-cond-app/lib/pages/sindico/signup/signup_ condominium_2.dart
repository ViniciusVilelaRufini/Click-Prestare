import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/pages/sindico/signup/signup_%20condominium_1.dart';
import 'package:click/pages/sindico/signup/signup_%20condominium_3.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class SignupCondominuim2 extends StatefulWidget {
  const SignupCondominuim2({Key? key, required this.condominio}) : super(key: key);
  final CondominioRegister condominio;

  @override
  _SignupCondominuim2PageState createState() => _SignupCondominuim2PageState();
}

class _SignupCondominuim2PageState extends State<SignupCondominuim2> {
  final txtCep = TextEditingController();
  final txtPais = TextEditingController();
  final txtUF = TextEditingController();
  final txtCidade = TextEditingController();
  final txtBairro = TextEditingController();
  final txtRua = TextEditingController();
  final txtNumero = TextEditingController();
  final txtComplemento = TextEditingController();

  String _lastCep = "";

  @override
  void initState() {
    super.initState();
    txtCep.addListener(_onCepChanged);
  }

  void _onCepChanged() {
    final cleanCep = txtCep.text.replaceAll(RegExp(r'\D'), '');
    if (cleanCep.length == 8 && cleanCep != _lastCep) {
      _lastCep = cleanCep;
      _lookupCep(cleanCep);
    }
  }

  Future<void> _lookupCep(String cep) async {
    try {
      final response = await http.get(Uri.parse("https://viacep.com.br/ws/$cep/json/"));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data != null && data['erro'] != true) {
          setState(() {
            txtPais.text = "Brasil";
            txtUF.text = data['uf'] ?? "";
            txtCidade.text = data['localidade'] ?? "";
            txtBairro.text = data['bairro'] ?? "";
            txtRua.text = data['logradouro'] ?? "";
          });
        }
      }
    } catch (_) {
      // Silently ignore errors
    }
  }

  @override
  void dispose() {
    txtCep.removeListener(_onCepChanged);
    txtCep.dispose();
    txtPais.dispose();
    txtUF.dispose();
    txtCidade.dispose();
    txtBairro.dispose();
    txtRua.dispose();
    txtNumero.dispose();
    txtComplemento.dispose();
    super.dispose();
  }

  void _nextPage() {
    var err = "";
    err += validateFieldIsEmpty(txtCep.text, getText('signup_cond_error_cep'));
    err += validateFieldIsEmpty(txtPais.text, getText('signup_cond_error_pais'));
    err += validateFieldIsEmpty(txtUF.text, getText('signup_cond_error_estado'));
    err += validateFieldIsEmpty(txtCidade.text, getText('signup_cond_error_estado'));
    err += validateFieldIsEmpty(txtBairro.text, getText('signup_cond_error_bairro'));
    err += validateFieldIsEmpty(txtRua.text, getText('signup_cond_error_rua'));
    err += validateFieldIsEmpty(txtNumero.text, getText('signup_cond_error_numero'));

    widget.condominio.cep = txtCep.text;
    widget.condominio.pais = txtPais.text;
    widget.condominio.uf = txtUF.text;
    widget.condominio.cidade = txtCidade.text;
    widget.condominio.bairro = txtBairro.text;
    widget.condominio.rua = txtRua.text;
    widget.condominio.numero = txtNumero.text;
    widget.condominio.complemento = txtComplemento.text;

    if (err.isNotEmpty) {
      displayMessage(context, getText('alert_error'), err);
      return;
    }

    Navigator.push(context, MaterialPageRoute(builder: (_) => SignupCondominuim3(condominio: widget.condominio)));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('signup_cond_nav'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: AppColors.primary.withOpacity(0.12),
                  backgroundImage: widget.condominio.photo != null
                      ? (kIsWeb
                          ? NetworkImage(widget.condominio.photo!)
                          : NetworkImage(widget.condominio.photo!)) as ImageProvider
                      : const AssetImage('assets/images/business_default.png'),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    widget.condominio.nome ?? '',
                    style: AppTypography.headline(context),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            AppInput(
              label: getText('signup_cond_cep'),
              controller: txtCep,
              keyboard: TextInputType.number,
              prefixIcon: PhosphorIcons.mapPin,
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: AppInput(
                    label: getText('signup_cond_pais'),
                    controller: txtPais,
                    textCapitalization: TextCapitalization.characters,
                    prefixIcon: PhosphorIcons.globe,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppInput(
                    label: getText('signup_cond_uf'),
                    controller: txtUF,
                    textCapitalization: TextCapitalization.characters,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_cidade'),
              controller: txtCidade,
              prefixIcon: PhosphorIcons.buildings,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_bairro'),
              controller: txtBairro,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_rua'),
              controller: txtRua,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: AppInput(
                    label: getText('signup_cond_numero'),
                    controller: txtNumero,
                    keyboard: TextInputType.number,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  flex: 2,
                  child: AppInput(
                    label: getText('signup_cond_complemento'),
                    controller: txtComplemento,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            _StepIndicator(step: 2, total: 3),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: getText('btn_proximo'),
              onPressed: _nextPage,
              size: AppButtonSize.lg,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}

class _StepIndicator extends StatelessWidget {
  final int step;
  final int total;
  const _StepIndicator({required this.step, required this.total});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$step de $total',
          style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary),
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: step / total,
            minHeight: 6,
            backgroundColor: AppColors.border(context),
            valueColor: const AlwaysStoppedAnimation<Color>(AppColors.primary),
          ),
        ),
      ],
    );
  }
}
