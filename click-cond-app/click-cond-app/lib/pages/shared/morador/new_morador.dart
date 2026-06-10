import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;

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
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewMorador extends StatefulWidget {
  const NewMorador({
    Key? key,
    required this.isEdit,
    this.obj,
    required this.apto,
    required this.bloco,
    required this.tipo,
    required this.id_apto,
  }) : super(key: key);
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
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    // Validações básicas antes de tentar enviar
    if (txtNome.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe o nome do morador.');
      return;
    }

    // E-mail só é obrigatório quando o usuário opta por enviar credenciais/acesso ao app.
    if (_sendCredentials && txtEmail.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe o e-mail para enviar o acesso ao app.');
      return;
    }

    setState(() => _isSaving = true);

    try {
      final morador = MoradorModel(
        id: myId,
        nome: txtNome.text.trim(),
        documento: txtDocumento.text.trim(),
        email: txtEmail.text.trim(),
        telefone: txtTelefone.text.trim(),
        tipo: widget.tipo,
        data_nascimento: txtDN.text.trim(),
        id_apto: widget.id_apto,
        extra1: txtExtra1.text.trim(),
        extra2: txtExtra2.text.trim(),
        extra3: txtExtra3.text.trim(),
        extra4: txtExtra4.text.trim(),
        photo: imageFile != null && imageChanged
            ? convertToBase64(imageFile, "image/jpeg")
            : (imageFile is String ? imageFile : null),
        sendCredentials: _sendCredentials,
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
      // ignore: avoid_print
      print('Erro ao salvar morador: $e\n$st');
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

  Future<void> _selectPhoto() async {
    var res = await getPhoto(context);
    imageFile = res;
    imageChanged = true;
    setState(() {});
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
                    child: GestureDetector(
                      onTap: _selectPhoto,
                      child: Stack(
                        children: [
                          CircleAvatar(
                            radius: 52,
                            backgroundColor: AppColors.primary.withOpacity(0.1),
                            backgroundImage: imageFile == null
                                ? const AssetImage('assets/images/defaultUser.png')
                                : (imageFile is String
                                    ? NetworkImage(imageFile)
                                    : (kIsWeb
                                        ? NetworkImage(imageFile.path)
                                        : FileImage(io.File(imageFile.path)))) as ImageProvider,
                          ),
                          Positioned(
                            bottom: 0, right: 0,
                            child: Container(
                              width: 30, height: 30,
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(color: AppColors.bg(context), width: 2),
                              ),
                              child: const Icon(PhosphorIcons.camera, size: 16, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
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
                  AppInput(label: getText('user_nome_completo'), controller: txtNome, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('user_documento'), controller: txtDocumento, prefixIcon: PhosphorIcons.identificationCard,
                      formatters: [FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9]'))]),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('data_nascimento'),
                    controller: txtDN,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtDN.text = text),
                        initialDate: null,
                        type: 'date',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('signup_infos_contato')),
                  AppInput(label: getText('email'), controller: txtEmail, prefixIcon: PhosphorIcons.envelope, keyboard: TextInputType.emailAddress),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('telefone'), controller: txtTelefone, prefixIcon: PhosphorIcons.phone, keyboard: TextInputType.phone),
                  const SizedBox(height: AppSpacing.xl),
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
