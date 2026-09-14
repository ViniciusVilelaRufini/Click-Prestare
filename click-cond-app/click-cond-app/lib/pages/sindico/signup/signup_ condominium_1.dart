import 'dart:convert';

import 'package:click/pages/sindico/signup/signup_%20condominium_2.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:easy_mask/easy_mask.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class SignupCondominuim1 extends StatefulWidget {
  const SignupCondominuim1({super.key});

  @override
  _SignupCondominuim1PageState createState() => _SignupCondominuim1PageState();
}

class _SignupCondominuim1PageState extends State<SignupCondominuim1> {
  dynamic _imageFile;
  final _txtNome = TextEditingController();
  final _txtDocumento = TextEditingController();
  final _txtSubsindico = TextEditingController();
  final _txtInicioMandato = TextEditingController();
  final _txtTerminoMandato = TextEditingController();

  @override
  void dispose() {
    _txtNome.dispose();
    _txtDocumento.dispose();
    _txtSubsindico.dispose();
    _txtInicioMandato.dispose();
    _txtTerminoMandato.dispose();
    super.dispose();
  }

  Future<void> _selectPhoto() async {
    final res = await getPhoto(context);
    if (res == null) return;
    setState(() => _imageFile = res);
  }

  ImageProvider _getAvatarImage() {
    if (_imageFile == null) return const AssetImage('assets/images/business_default.png');
    if (kIsWeb) return NetworkImage(_imageFile.path);
    return const AssetImage('assets/images/defaultUser.png');
  }

  Future<void> _nextPage() async {
    var err = "";
    err += validateFieldIsEmpty(_txtNome.text, getText('signup_cond_error_nome'));
    err += validateFieldIsEmpty(_txtDocumento.text, getText('signup_cond_error_doc'));
    err += validateFieldIsEmpty(_txtSubsindico.text, getText('signup_cond_error_subsindico'));
    if (!validateGenericDate(_txtInicioMandato.text)) err += "${getText('signup_cond_error_dt_inicio_mandato')}\n";
    if (!validateGenericDate(_txtTerminoMandato.text)) err += "${getText('signup_cond_error_dt_fim_mandato')}\n";
    if (!dateIsAfter(_txtInicioMandato.text, _txtTerminoMandato.text)) err += "${getText('signup_cond_error_dt_anterior')}\n";

    if (err.isNotEmpty) {
      displayMessage(context, getText('alert_error'), err);
      return;
    }

    final condominio = CondominioRegister(
      nome: _txtNome.text.trim(),
      documento: _txtDocumento.text.trim(),
      subsindico: _txtSubsindico.text.trim(),
      inicioMandato: _txtInicioMandato.text.trim(),
      terminoMandato: _txtTerminoMandato.text.trim(),
      photo: _imageFile?.path,
    );

    if (_imageFile != null) {
      final bytes = await _imageFile.readAsBytes();
      condominio.photoBase64 = "data:image/png;base64,${base64Encode(bytes)}";
    }

    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => SignupCondominuim2(condominio: condominio)));
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
            Center(
              child: GestureDetector(
                onTap: _selectPhoto,
                child: Stack(
                  children: [
                    CircleAvatar(
                      radius: 52,
                      backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                      backgroundImage: _getAvatarImage(),
                    ),
                    Positioned(
                      bottom: 0, right: 0,
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.surface(context), width: 2),
                        ),
                        child: const Icon(PhosphorIcons.camera, color: Colors.white, size: 14),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            AppInput(
              label: getText('signup_cond_nome'),
              controller: _txtNome,
              prefixIcon: PhosphorIcons.buildings,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('user_documento'),
              controller: _txtDocumento,
              prefixIcon: PhosphorIcons.identificationCard,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_subsindico_nome'),
              controller: _txtSubsindico,
              prefixIcon: PhosphorIcons.userCircle,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_ini_mandato'),
              controller: _txtInicioMandato,
              keyboard: TextInputType.number,
              prefixIcon: PhosphorIcons.calendarBlank,
              formatters: [TextInputMask(mask: ['99/99/9999'], reverse: false)],
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('signup_cond_fim_mandato'),
              controller: _txtTerminoMandato,
              keyboard: TextInputType.number,
              prefixIcon: PhosphorIcons.calendarCheck,
              formatters: [TextInputMask(mask: ['99/99/9999'], reverse: false)],
            ),
            const SizedBox(height: AppSpacing.xl),
            _StepIndicator(step: 1, total: 3),
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

class CondominioRegister {
  String? nome;
  String? documento;
  String? subsindico;
  String? inicioMandato;
  String? terminoMandato;
  String? photo;
  String? photoBase64;

  String? cep;
  String? pais;
  String? uf;
  String? bairro;
  String? cidade;
  String? rua;
  String? numero;
  String? complemento;

  int? blocos;
  int? aptos;

  CondominioRegister({
    this.nome,
    this.documento,
    this.subsindico,
    this.inicioMandato,
    this.terminoMandato,
    this.photo,
    this.photoBase64,
  });
}
