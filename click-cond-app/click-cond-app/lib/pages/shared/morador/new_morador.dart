import 'package:click/utils/log.dart';
import 'dart:io' as io;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/modals/termo_consentimento_menor_modal.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewMorador extends StatefulWidget {
  const NewMorador({
    super.key,
    required this.isEdit,
    this.obj,
    required this.apto,
    required this.bloco,
    required this.tipo,
    required this.id_apto,
  });
  final bool isEdit;
  final dynamic obj;
  final String apto, bloco, tipo, id_apto;

  @override
  _NewMoradorPageState createState() => _NewMoradorPageState();
}

class _NewMoradorPageState extends State<NewMorador> {
  var _isLoading = false;
  var _isSaving = false;
  var _sendCredentials = true;
  bool _isMenor = false;
  bool _termoConsentimentoAceito = false;
  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtDN = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtExtra1 = TextEditingController();
  final txtExtra2 = TextEditingController();
  final txtExtra3 = TextEditingController();
  final txtExtra4 = TextEditingController();
  dynamic imageFile;
  var imageChanged = false;
  var myId = -1;

  @override
  void dispose() {
    txtNome.dispose(); txtDocumento.dispose(); txtDN.dispose();
    txtEmail.dispose(); txtTelefone.dispose(); txtBloco.dispose();
    txtApto.dispose(); txtExtra1.dispose(); txtExtra2.dispose();
    txtExtra3.dispose(); txtExtra4.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    txtBloco.text = widget.bloco;
    txtApto.text = widget.apto;
    if (widget.isEdit) load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      
      final int targetId = widget.obj != null ? (widget.obj["id"] ?? -1) : -1;
      dynamic detailObj = widget.obj;
      
      if (targetId > 0) {
        final apiDetails = await apiGetDetails("moradores", targetId);
        if (apiDetails != null) {
          detailObj = apiDetails;
        }
      }

      txtNome.text = detailObj["nome"] ?? '';
      txtDocumento.text = detailObj["documento"] ?? '';
      txtEmail.text = detailObj["email"] ?? '';
      
      final String dn = detailObj["data_nascimento"]?.toString() ?? '';
      if (dn.isNotEmpty) {
        if (dn.contains('/')) {
          txtDN.text = dn;
        } else {
          try {
            txtDN.text = convertDateToString(dn);
          } catch (_) {
            txtDN.text = '';
          }
        }
      } else {
        txtDN.text = '';
      }
      
      txtTelefone.text = detailObj["telefone"] ?? '';
      txtExtra1.text = detailObj["extra1"] ?? '';
      txtExtra2.text = detailObj["extra2"] ?? '';
      txtExtra3.text = detailObj["extra3"] ?? '';
      txtExtra4.text = detailObj["extra4"] ?? '';
      myId = detailObj["id"] ?? targetId;
      imageFile = detailObj['photo'] != null && detailObj['photo'].toString().isNotEmpty ? detailObj['photo'] : null;

      if (txtExtra1.text == 'MENOR_DE_IDADE' || _calcularSeMenor(txtDN.text)) {
        _isMenor = true;
        _sendCredentials = false;
      }
      if (txtExtra2.text.contains('CONSENTIMENTO_BIOMETRIA')) {
        _termoConsentimentoAceito = true;
      }

      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  bool _calcularSeMenor(String dataStr) {
    if (dataStr.trim().isEmpty) return false;
    try {
      final parts = dataStr.trim().split('/');
      if (parts.length == 3) {
        final day = int.parse(parts[0]);
        final month = int.parse(parts[1]);
        final year = int.parse(parts[2]);
        final birthDate = DateTime(year, month, day);
        final today = DateTime.now();
        int age = today.year - birthDate.year;
        if (today.month < birthDate.month ||
            (today.month == birthDate.month && today.day < birthDate.day)) {
          age--;
        }
        return age < 18;
      }
    } catch (_) {}
    return false;
  }

  void _onDataNascimentoChanged(String text) {
    txtDN.text = text;
    final menorDetectado = _calcularSeMenor(text);
    setState(() {
      _isMenor = menorDetectado;
      if (menorDetectado) {
        _sendCredentials = false;
      }
    });
  }

  Future<void> _handleFotoBiometria() async {
    // Se for menor de idade, exige o Termo de Consentimento de Biometria para Menores (LGPD Art. 14)
    if (_isMenor) {
      if (txtNome.text.trim().isEmpty) {
        displayMessage(
          context,
          getText('alert'),
          'Por favor, informe o nome completo do menor antes de prosseguir com o termo de consentimento.',
        );
        return;
      }

      final responsavelNome = getUserFullName();
      final aceitou = await showTermoConsentimentoMenorModal(
        context: context,
        nomeMenor: txtNome.text.trim(),
        nomeResponsavel: responsavelNome.isNotEmpty ? responsavelNome : 'Responsável pela unidade',
        dataNascimentoMenor: txtDN.text.trim(),
      );

      if (aceitou != true) {
        return;
      }

      _termoConsentimentoAceito = true;
      txtExtra1.text = 'MENOR_DE_IDADE';
      txtExtra2.text = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:${DateTime.now().toIso8601String()}';
    }

    // Captura a foto exclusivamente no app do responsável
    var res = await getPhoto(context);
    if (res != null) {
      imageFile = res;
      imageChanged = true;
      if (mounted) setState(() {});
    }
  }

  Future<void> save() async {
    // Validações básicas antes de tentar enviar
    if (txtNome.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe o nome do morador.');
      return;
    }

    if (txtDocumento.text.trim().isEmpty) {
      displayMessage(
        context,
        getText('alert'),
        _isMenor
            ? 'Informe o documento do menor (RG, CPF ou Certidão de Nascimento).'
            : 'Informe o documento do morador.',
      );
      return;
    }

    // E-mail só é obrigatório quando o usuário opta por enviar credenciais/acesso ao app (não aplicável a menores).
    if (_sendCredentials && !_isMenor && txtEmail.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe o e-mail para enviar o acesso ao app.');
      return;
    }

    setState(() => _isSaving = true);

    try {
      final morador = MoradorModel(
        id: myId,
        nome: txtNome.text.trim(),
        documento: txtDocumento.text.trim(),
        email: _isMenor ? '' : txtEmail.text.trim(),
        telefone: txtTelefone.text.trim(),
        tipo: widget.tipo,
        data_nascimento: txtDN.text.trim(),
        id_apto: widget.id_apto,
        extra1: _isMenor ? 'MENOR_DE_IDADE' : txtExtra1.text.trim(),
        extra2: _isMenor && _termoConsentimentoAceito
            ? (txtExtra2.text.isNotEmpty
                ? txtExtra2.text
                : 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:${DateTime.now().toIso8601String()}')
            : txtExtra2.text.trim(),
        extra3: txtExtra3.text.trim(),
        extra4: txtExtra4.text.trim(),
        photo: imageFile != null && imageChanged
            ? convertToBase64(imageFile, "image/jpeg")
            : (imageFile is String ? imageFile : null),
        sendCredentials: _isMenor ? false : _sendCredentials,
      );

      // Quando é o próprio morador cadastrando um familiar (tipo "Membro"),
      // usamos o endpoint restrito ao proprietário; síndico/funcionário seguem o fluxo padrão.
      final bool isFamiliarByMorador =
          !widget.isEdit && getUserType() == 'morador' && widget.tipo == 'Membro';

      final res = isFamiliarByMorador
          ? await apiSaveFamiliar(morador)
          : await apiSaveObject('moradores', 'morador', morador, widget.isEdit);

      if (!mounted) return;

      if (res is String && res.isEmpty) {
        if (!widget.isEdit) {
          await displayMessage(
            context,
            getText('alert_success'),
            isFamiliarByMorador
                ? getText('apto_familiar_criado_msg')
                : getText('apto_usuario_criado_msg'),
          );
        }
        if (mounted) Navigator.of(context).pop(true);
      } else {
        displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e, st) {
      // Loga o stack no console para diagnóstico de erros web
      logDebug('Erro ao salvar morador: $e\n$st');
      if (mounted) {
        displayMessage(
          context,
          getText('alert_error'),
          'Não foi possível salvar. Tente novamente.',
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> delete() async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('moradores', widget.obj['id']);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.tipo == 'Membro' ? getText('lb_membro') : widget.tipo,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Column(
                      children: [
                        GestureDetector(
                          onTap: _handleFotoBiometria,
                          child: Stack(
                            children: [
                              CircleAvatar(
                                radius: 52,
                                backgroundColor: AppColors.primary.withValues(alpha: 0.1),
                                backgroundImage: imageFile == null
                                    ? const AssetImage('assets/images/defaultUser.png')
                                    : (imageFile is String
                                        ? NetworkImage(imageFile)
                                        : (kIsWeb
                                            ? NetworkImage(imageFile.path)
                                            : FileImage(io.File(imageFile.path)))) as ImageProvider,
                              ),
                              Positioned(
                                bottom: 0,
                                right: 0,
                                child: Container(
                                  width: 32,
                                  height: 32,
                                  decoration: BoxDecoration(
                                    color: _isMenor ? AppColors.primary : AppColors.primary,
                                    shape: BoxShape.circle,
                                    border: Border.all(color: AppColors.bg(context), width: 2),
                                  ),
                                  child: Icon(
                                    _isMenor ? PhosphorIcons.shieldCheck : PhosphorIcons.camera,
                                    size: 16,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        TextButton.icon(
                          onPressed: _handleFotoBiometria,
                          icon: Icon(
                            imageFile != null
                                ? PhosphorIcons.arrowsClockwise
                                : (_isMenor ? PhosphorIcons.shieldCheck : PhosphorIcons.camera),
                            size: 15,
                            color: AppColors.primary,
                          ),
                          label: Text(
                            _isMenor
                                ? (imageFile != null
                                    ? 'Alterar Biometria Facial'
                                    : 'Registrar Facial (Termo LGPD)')
                                : (imageFile != null ? 'Alterar Foto' : 'Tirar Foto / Biometria'),
                            style: AppTypography.captionMedium(context).copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: TextButton.styleFrom(
                            backgroundColor: AppColors.primary.withValues(alpha: 0.08),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_infos_apto')),
                  Row(
                    children: [
                      Expanded(child: AppInput(label: getText('lb_bloco'), controller: txtBloco, readOnly: true, prefixIcon: PhosphorIcons.buildings)),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(child: AppInput(label: getText('lb_apartamento'), controller: txtApto, readOnly: true, prefixIcon: PhosphorIcons.door)),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_pessoais')),
                  AppInput(
                    label: _isMenor ? 'Nome Completo do Menor' : getText('user_nome_completo'),
                    controller: txtNome,
                    prefixIcon: _isMenor ? PhosphorIcons.baby : PhosphorIcons.user,
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: _isMenor
                        ? 'Documento (RG, CPF ou Certidão)'
                        : getText('user_documento'),
                    controller: txtDocumento,
                    prefixIcon: PhosphorIcons.identificationCard,
                    formatters: [FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9]'))],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('data_nascimento'),
                    controller: txtDN,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => _onDataNascimentoChanged(text),
                        initialDate: null,
                        type: 'date',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  SwitchListTile(
                    title: Row(
                      children: [
                        Text(
                          'Menor de idade',
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                        ),
                        if (_isMenor) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Text(
                              'LGPD Art. 14',
                              style: TextStyle(
                                color: AppColors.primary,
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    subtitle: Text(
                      _isMenor
                          ? 'A biometria é capturada no app dos pais mediante termo de consentimento.'
                          : 'Ative caso este familiar tenha menos de 18 anos.',
                      style: AppTypography.caption(context),
                    ),
                    value: _isMenor,
                    onChanged: (val) {
                      setState(() {
                        _isMenor = val;
                        if (val) _sendCredentials = false;
                      });
                    },
                    activeColor: AppColors.primary,
                    contentPadding: EdgeInsets.zero,
                  ),
                  if (_isMenor) ...[
                    const SizedBox(height: AppSpacing.xs),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(PhosphorIcons.shieldCheck, color: AppColors.primary, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Cadastro Protegido de Menor',
                                  style: AppTypography.captionMedium(context).copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.primary,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'O menor não possui login individual. A foto e a biometria facial são capturadas no aparelho dos pais/responsáveis legais sob termo de consentimento.',
                                  style: AppTypography.caption(context).copyWith(
                                    color: AppColors.textSecondary(context),
                                    height: 1.3,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('signup_infos_contato')),
                  // Menor não tem conta no app: e-mail aqui virava login do menor
                  // e a API recusava o cadastro. Sem campo de e-mail para menor.
                  if (!_isMenor) ...[
                    AppInput(
                      label: getText('email'),
                      controller: txtEmail,
                      prefixIcon: PhosphorIcons.envelope,
                      keyboard: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  AppInput(
                    label: _isMenor ? 'Telefone do responsável (opcional)' : getText('telefone'),
                    controller: txtTelefone,
                    prefixIcon: PhosphorIcons.phone,
                    keyboard: TextInputType.phone,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  if (!_isMenor) ...[
                    SwitchListTile(
                      title: Text(
                        'Enviar credenciais e acesso por e-mail',
                        style: AppTypography.bodyMedium(context),
                      ),
                      subtitle: Text(
                        'Envia link do App, login e senha inicial ao morador.',
                        style: AppTypography.caption(context),
                      ),
                      value: _sendCredentials,
                      onChanged: (val) => setState(() => _sendCredentials = val),
                      activeColor: AppColors.primary,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black)
                            .withValues(alpha: 0.03),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black)
                              .withValues(alpha: 0.06),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(PhosphorIcons.info, size: 18, color: AppColors.primary),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Menores de idade não possuem acesso de login individual ao aplicativo. Os acessos são geridos pelos responsáveis.',
                              style: AppTypography.caption(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: getText('btn_save'),
                    onPressed: _isSaving ? null : save,
                    loading: _isSaving,
                    icon: PhosphorIcons.floppyDisk,
                  ),
                  if (widget.isEdit) ...[
                    const SizedBox(height: AppSpacing.md),
                    AppButton(
                      label: getText('btn_delete'),
                      onPressed: _isSaving ? null : delete,
                      variant: AppButtonVariant.danger,
                      icon: PhosphorIcons.trash,
                    ),
                  ],
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

class MoradorModel {
  int? id;
  String? nome, documento, data_nascimento, email, telefone, tipo, id_apto;
  String? extra1, extra2, extra3, extra4, photo;
  bool? sendCredentials;

  MoradorModel({this.id, this.nome, this.documento, this.data_nascimento,
      this.email, this.telefone, this.tipo, this.id_apto,
      this.extra1, this.extra2, this.extra3, this.extra4, this.photo,
      this.sendCredentials});

  Map toJson() => {
        'id': id, 'nome': nome, 'email': email, 'data_nascimento': data_nascimento,
        'documento': documento, 'telefone': telefone, 'tipo': tipo, 'id_apto': id_apto,
        'extra1': extra1, 'extra2': extra2, 'extra3': extra3, 'extra4': extra4, 'photo': photo,
        'sendCredentials': sendCredentials,
      };
}
