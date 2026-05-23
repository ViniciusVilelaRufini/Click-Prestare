import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewFuncionario1 extends StatefulWidget {
  const NewFuncionario1({Key? key, required this.isEdit, this.myId}) : super(key: key);
  final bool isEdit;
  final int? myId;

  @override
  _NewFuncionario1PageState createState() => _NewFuncionario1PageState();
}

class _NewFuncionario1PageState extends State<NewFuncionario1> {
  dynamic imageFile;
  var imageChanged = false;
  var _isLoading = false;
  var _isSaving = false;
  bool _hasPortariaAccess = false;

  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtFuncao = TextEditingController();
  final txtCH = TextEditingController();
  final txtPassword = TextEditingController();
  final txtExtra1 = TextEditingController();
  final txtExtra2 = TextEditingController();

  List<String> permissoes = [];
  late final List<Map<String, String>> opcoesCategorias = [
    {"display": getText('lb_areas_sociais'), "value": "areas_sociais"},
    {"display": getText('lb_comunicados'), "value": "comunicados"},
    {"display": getText('lb_ocorrencias'), "value": "ocorrencias"},
    {"display": getText('lb_manut_programadas'), "value": "manutencoes_programadas"},
    {"display": getText('lb_prestadores_servico'), "value": "prestadores_servico"},
    {"display": getText('lb_agendar_mudanca'), "value": "agendar_mudanca"},
    {"display": getText('lb_cadastrar_visitante'), "value": "cadastrar_visitante"},
    {"display": getText('lb_apartamentos'), "value": "apartamentos"},
  ];

  @override
  void dispose() {
    txtNome.dispose(); txtDocumento.dispose(); txtEmail.dispose();
    txtTelefone.dispose(); txtFuncao.dispose(); txtCH.dispose();
    txtPassword.dispose(); txtExtra1.dispose(); txtExtra2.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
    txtFuncao.addListener(() {
      if (mounted) setState(() {});
    });
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("funcionarios", widget.myId!);
      txtNome.text = obj["nome"] ?? '';
      txtDocumento.text = obj["documento"] ?? '';
      txtEmail.text = obj["email"] ?? '';
      txtTelefone.text = obj["telefone"] ?? '';
      txtFuncao.text = obj["funcao"] ?? '';
      txtCH.text = obj["ch"] ?? '';
      txtExtra1.text = obj["extra1"] ?? '';
      txtExtra2.text = obj["extra2"] ?? '';
      imageFile = obj['photo'] != null && obj['photo'].toString().isNotEmpty ? obj['photo'] : null;
      for (var key in ["areas_sociais","comunicados","ocorrencias","manutencoes_programadas",
                        "prestadores_servico","agendar_mudanca","cadastrar_visitante","apartamentos"]) {
        if (obj[key] == 1) permissoes.add(key);
      }
      _hasPortariaAccess = obj["hasPortariaAccess"] == true || obj["hasPortariaAccess"] == 1;
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _selectPhoto() async {
    var res = await getPhoto(context);
    if (res != null) {
      imageFile = res;
      imageChanged = true;
      setState(() {});
    }
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      String? base64;
      if (imageFile != null && imageChanged) {
        base64 = convertToBase64(imageFile, "image/jpeg");
      } else if (imageFile is String) {
        base64 = imageFile;
      }
      var obj = FuncionarioModel(
        id: widget.myId ?? -1, nome: txtNome.text, documento: txtDocumento.text,
        email: txtEmail.text, telefone: txtTelefone.text, funcao: txtFuncao.text,
        ch: txtCH.text, senha: txtPassword.text, photo: base64,
        permissoes: permissoes, extra1: txtExtra1.text, extra2: txtExtra2.text,
        hasPortariaAccess: _hasPortariaAccess,
      );
      var message = await apiSaveObject('funcionarios', 'funcionario', obj, widget.isEdit);
      if (message == "") {
        if (mounted) Navigator.pop(context);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), message);
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> delete() async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('funcionarios', widget.myId!);
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
      title: widget.isEdit ? getText('funcionario_nav_edit') : getText('funcionario_nav_new'),
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
                                color: AppColors.primary, shape: BoxShape.circle,
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
                  _section(getText('funcionario_infos_pessoais')),
                  AppInput(label: getText('user_nome_completo'), controller: txtNome, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('user_documento'), controller: txtDocumento, prefixIcon: PhosphorIcons.identificationCard),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('email'), controller: txtEmail, prefixIcon: PhosphorIcons.envelope, keyboard: TextInputType.emailAddress),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('telefone'), controller: txtTelefone, prefixIcon: PhosphorIcons.phone, keyboard: TextInputType.phone),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_funcao')),
                  AppInput(label: getText('funcionario_funcao'), controller: txtFuncao, prefixIcon: PhosphorIcons.briefcase),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var funcOption in [
                        "Porteiro",
                        "Zelador",
                        "Faxineiro",
                        "Segurança",
                        "Síndico",
                        "Administrador",
                        "Recepcionista"
                      ])
                        GestureDetector(
                          onTap: () {
                            setState(() {
                              txtFuncao.text = funcOption;
                            });
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
                            decoration: BoxDecoration(
                              color: txtFuncao.text.trim().toLowerCase() == funcOption.toLowerCase()
                                  ? AppColors.primary
                                  : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: txtFuncao.text.trim().toLowerCase() == funcOption.toLowerCase()
                                    ? AppColors.primary
                                    : AppColors.border(context),
                              ),
                            ),
                            child: Text(
                              funcOption,
                              style: AppTypography.captionMedium(context).copyWith(
                                color: txtFuncao.text.trim().toLowerCase() == funcOption.toLowerCase()
                                    ? Colors.white
                                    : AppColors.textSecondary(context),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('funcionario_horario_trabalho'), controller: txtCH, prefixIcon: PhosphorIcons.clock, maxLines: 3),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_permissoes')),
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.error.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(PhosphorIcons.warningCircle, color: AppColors.error, size: 18),
                        const SizedBox(width: 8),
                        Expanded(child: Text(getText('funcionario_permissoes_sobre'),
                            style: AppTypography.caption(context).copyWith(color: AppColors.error))),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var cat in opcoesCategorias)
                        GestureDetector(
                          onTap: () {
                            setState(() {
                              if (permissoes.contains(cat["value"])) {
                                permissoes.remove(cat["value"]);
                              } else {
                                permissoes.add(cat["value"]!);
                              }
                            });
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                            decoration: BoxDecoration(
                              color: permissoes.contains(cat["value"]) ? AppColors.primary : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: permissoes.contains(cat["value"]) ? AppColors.primary : AppColors.border(context),
                              ),
                            ),
                            child: Text(cat["display"]!,
                                style: AppTypography.captionMedium(context).copyWith(
                                    color: permissoes.contains(cat["value"]) ? Colors.white : AppColors.textSecondary(context))),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_extra')),
                  AppInput(label: getText('funcionario_infos_extra_1'), controller: txtExtra1, maxLines: 2),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('funcionario_infos_extra_2'), controller: txtExtra2, maxLines: 2),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_acesso')),
                  AppInput(label: getText('funcionario_senha'), controller: txtPassword, prefixIcon: PhosphorIcons.lock, isPassword: true),
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    title: Text("Acesso Portaria Web", style: AppTypography.captionMedium(context)),
                    subtitle: Text("Permite acessar o sistema web usando o e-mail cadastrado acima e esta senha.", style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
                    value: _hasPortariaAccess,
                    onChanged: (val) => setState(() => _hasPortariaAccess = val),
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

class FuncionarioModel {
  int? id;
  String? nome, documento, email, telefone, funcao, ch, matricula, senha, photo, extra1, extra2;
  List<String>? permissoes;
  bool? hasPortariaAccess;

  FuncionarioModel({this.id, this.nome, this.documento, this.email, this.telefone,
      this.funcao, this.ch, this.senha, this.photo, this.permissoes, this.extra1, this.extra2, this.hasPortariaAccess});

  Map toJson() => {
        'id': id, 'nome': nome, 'documento': documento, 'email': email,
        'telefone': telefone, 'funcao': funcao, 'ch': ch, 'senha': senha,
        'photo': photo, 'permissoes': permissoes, 'extra1': extra1, 'extra2': extra2,
        'hasPortariaAccess': hasPortariaAccess,
      };
}
