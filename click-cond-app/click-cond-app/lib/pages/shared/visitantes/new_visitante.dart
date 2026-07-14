import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../singleton.dart';

class NewVisitante extends StatefulWidget {
  final bool isEdit;
  final int? myId;
  final Map<String, dynamic>? reUseData;
  final String? defaultType;

  const NewVisitante({Key? key, required this.isEdit, this.myId, this.reUseData, this.defaultType}) : super(key: key);

  @override
  _NewVisitantePageState createState() => _NewVisitantePageState();
}

class _NewVisitantePageState extends State<NewVisitante> {
  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtDataInicio = TextEditingController();
  final txtDataTermino = TextEditingController();
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtObs = TextEditingController();

  var idMyApartment;
  var currentTipo = '';
  // Dias da semana em que o prestador pode entrar (só para prestador).
  List<String> diasSemana = [];
  static const _diasOrdem = [
    {'key': 'seg', 'label': 'Seg'},
    {'key': 'ter', 'label': 'Ter'},
    {'key': 'qua', 'label': 'Qua'},
    {'key': 'qui', 'label': 'Qui'},
    {'key': 'sex', 'label': 'Sex'},
    {'key': 'sab', 'label': 'Sáb'},
    {'key': 'dom', 'label': 'Dom'},
  ];
  dynamic imageFile;
  var imageChanged = false;
  var _isLoading = false;
  var _isSaving = false;
  var list = [];
  var listBlocos = [];

  @override
  void dispose() {
    txtNome.dispose(); txtDocumento.dispose(); txtDataInicio.dispose();
    txtDataTermino.dispose(); txtBloco.dispose(); txtApto.dispose(); txtObs.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) {
      load();
    } else {
      currentTipo = widget.defaultType ?? 'visitante';
      // Prestador novo já vem com os dias úteis pré-selecionados.
      if (currentTipo == 'prestador') diasSemana = ['seg', 'ter', 'qua', 'qui', 'sex'];
      if (widget.reUseData != null) {
        txtNome.text = widget.reUseData!["nome"] ?? "";
        txtDocumento.text = widget.reUseData!["doc_identificacao"]?.toString() ?? "";
        txtApto.text = widget.reUseData!["apto"] ?? "";
        txtBloco.text = widget.reUseData!["apto_bloco"] ?? "";
        txtObs.text = widget.reUseData!["observacoes"] ?? "";
        currentTipo = widget.reUseData!["is_visitante"] == 1 ? 'visitante' : 'prestador';
        diasSemana = _parseDias(widget.reUseData!["dias_semana"]);
        idMyApartment = widget.reUseData!["apto_id"];
        final rawPhoto = widget.reUseData!["foto_pessoa"] ?? widget.reUseData!["photo"];
        imageFile = rawPhoto != null && rawPhoto.toString().isNotEmpty && rawPhoto.toString() != 'null'
            ? rawPhoto.toString()
            : null;
      }
    }
    if (getUserType() == 'morador') {
      txtBloco.text = Singleton.instance.bloco;
      txtApto.text = Singleton.instance.apartamento;
      idMyApartment = Singleton.instance.id_apartamento;
    } else {
      loadListAptos();
    }
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("visitantes", widget.myId!);
      txtNome.text = obj["nome"] ?? "";
      txtDocumento.text = obj["doc_identificacao"]?.toString() ?? "";
      txtDataInicio.text = obj["data_inicio"] ?? "";
      txtDataTermino.text = obj["data_termino"] ?? "";
      txtApto.text = obj["apto"] ?? "";
      txtBloco.text = obj["apto_bloco"] ?? "";
      txtObs.text = obj["observacoes"] ?? "";
      currentTipo = obj["is_visitante"] == 1 ? 'visitante' : 'prestador';
      diasSemana = _parseDias(obj["dias_semana"]);
      imageFile = obj['photo'] != null && obj['photo'].toString().isNotEmpty ? obj['photo'] : null;
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

  Future<void> loadListAptos() async {
    try {
      setState(() => _isLoading = true);
      var aptos = await apiGetAll("apartamentos");
      list = aptos;
      listBlocos.clear();
      for (var item in list) {
        if (!listBlocos.contains(item['bloco'])) listBlocos.add(item['bloco']);
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      var visitante = VisitanteModel(
        id: widget.myId ?? -1,
        nome: txtNome.text,
        doc_identificacao: txtDocumento.text,
        data_inicio: convertStringToDateTime(txtDataInicio.text),
        data_termino: convertStringToDateTime(txtDataTermino.text),
        avisar: true,
        observacoes: txtObs.text,
        id_apartamento: idMyApartment ?? getIdApto(),
        is_visitante: currentTipo == 'visitante',
        is_prestador: currentTipo == 'prestador',
        dias_semana: currentTipo == 'prestador' ? diasSemana.join(',') : null,
        photo: imageFile != null && imageChanged
            ? convertToBase64(imageFile, "image/jpeg")
            : (imageFile is String ? imageFile : null),
      );
      setState(() => _isSaving = true);
      final result = await apiSaveVisitante(visitante, widget.isEdit);
      if (result is Map) {
        final code = result['codigo_acesso']?.toString();
        if (!widget.isEdit && code != null) {
          if (mounted) _showSuccessDialog(code);
        } else {
          if (mounted) Navigator.pop(context);
        }
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), result.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _showSuccessDialog(String code) {
    final moradorName = getUsername();
    final blocoText = txtBloco.text;
    final aptoText = txtApto.text;
    
    final formattedCode = code.length == 6 ? "${code.substring(0, 3)}-${code.substring(3, 6)}" : code;
    
    final inviteText = 
      "🔑 *Convite de Acesso - Click Portaria*\n\n"
      "Olá! Sua liberação de acesso foi cadastrada.\n\n"
      "📍 *Destino:* Bloco $blocoText, Apto $aptoText\n"
      "👤 *Autorizado por:* ${moradorName.isNotEmpty ? moradorName : 'Morador'}\n"
      "🔑 *Código de Acesso (PIN):* $formattedCode\n\n"
      "Apresente este código ao chegar na portaria para liberação da sua entrada.";

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          backgroundColor: AppColors.surface(context),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.success.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    PhosphorIcons.circleWavyCheck,
                    color: AppColors.success,
                    size: 54,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  "Liberação Gerada!",
                  style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  "Compartilhe o código abaixo com o seu ${isPrestador ? 'prestador' : 'visitante'} para agilizar a entrada na portaria.",
                  textAlign: TextAlign.center,
                  style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
                ),
                const SizedBox(height: AppSpacing.xl),
                
                // Container do PIN
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceElevated(context),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.primary.withOpacity(0.2)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        formattedCode,
                        style: AppTypography.title(context).copyWith(
                          fontSize: 32,
                          letterSpacing: 2,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      IconButton(
                        icon: Icon(PhosphorIcons.copy, color: AppColors.primary),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: code));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Código copiado para a área de transferência!')),
                          );
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                
                // Botão Compartilhar via WhatsApp
                AppButton(
                  label: "Enviar via WhatsApp",
                  icon: PhosphorIcons.whatsappLogo,
                  onPressed: () async {
                    final url = Uri.parse("https://wa.me/?text=${Uri.encodeComponent(inviteText)}");
                    if (await canLaunchUrl(url)) {
                      await launchUrl(url, mode: LaunchMode.externalApplication);
                    }
                  },
                ),
                const SizedBox(height: AppSpacing.md),
                
                // Botão Fechar / Concluir
                TextButton(
                  onPressed: () {
                    Navigator.pop(context); // fecha o dialog
                    Navigator.pop(this.context); // fecha a tela de cadastro
                  },
                  child: Text(
                    "Concluir",
                    style: AppTypography.bodyMedium(context).copyWith(
                      color: AppColors.textSecondary(context),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> delete() async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('visitantes', widget.myId!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  List getListAptos() {
    var listAptos = [];
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && !listAptos.contains(item["apto"])) {
        listAptos.add(item["apto"]);
      }
    }
    return listAptos;
  }

  getIdApto() {
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && item["apto"] == txtApto.text) return item["id"];
    }
    throw getText('mudanca_selecione_apto');
  }

  ImageProvider _getAvatarImageProvider() {
    if (imageFile == null) {
      return const AssetImage('assets/images/defaultUser.png');
    }
    if (imageFile is String) {
      final s = imageFile.toString().trim();
      if (s.isEmpty || s == 'null') {
        return const AssetImage('assets/images/defaultUser.png');
      }
      if (s.startsWith('http://') || s.startsWith('https://')) {
        return NetworkImage(s);
      }
      if (s.startsWith('data:')) {
        final commaIdx = s.indexOf(',');
        if (commaIdx > 0) {
          try {
            return MemoryImage(base64Decode(s.substring(commaIdx + 1)));
          } catch (_) {}
        }
      }
      // base64 puro
      try {
        return MemoryImage(base64Decode(s));
      } catch (_) {}
      return const AssetImage('assets/images/defaultUser.png');
    }
    
    // Se for File/XFile
    if (kIsWeb) {
      return NetworkImage(imageFile.path);
    } else {
      return FileImage(io.File(imageFile.path));
    }
  }

  // Esta tela é reusada para Prestador de Serviço (defaultType == 'prestador').
  // Nesse caso o título e os textos refletem "prestador" e o seletor de tipo
  // (Visitante/Prestador) é ocultado, pois o tipo já está definido.
  bool get isPrestador => (widget.defaultType ?? currentTipo) == 'prestador';

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: isPrestador
          ? (widget.isEdit ? getText('prestador_nav_edit') : getText('prestador_nav_new'))
          : (widget.isEdit ? getText('visitantes_nav_edit') : getText('visitantes_nav_new')),
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
                            backgroundImage: _getAvatarImageProvider(),
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
                  const SizedBox(height: AppSpacing.sm),
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                      margin: const EdgeInsets.only(top: AppSpacing.sm),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.06),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.primary.withOpacity(0.2)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(PhosphorIcons.scan, color: AppColors.primary, size: 14),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              'Foto necessária para acesso facial automático na portaria',
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w500,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_pessoais')),
                  AppInput(
                    label: getText('user_nome_completo'),
                    controller: txtNome,
                    prefixIcon: PhosphorIcons.user,
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('user_documento'),
                    controller: txtDocumento,
                    prefixIcon: PhosphorIcons.identificationCard,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('visitantes_infos')),
                  AppInput(
                    label: getText('visitantes_data_hora_inicio'),
                    controller: txtDataInicio,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtDataInicio.text = text),
                        initialDate: DateTime.now(),
                        type: 'datetime',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('visitantes_data_hora_termino'),
                    controller: txtDataTermino,
                    prefixIcon: PhosphorIcons.calendarCheck,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtDataTermino.text = text),
                        initialDate: convertStringToDateTimeFormat(txtDataInicio.text) ?? DateTime.now(),
                        type: 'datetime',
                      ),
                    ),
                  ),
                  // Seletor de tipo só aparece no fluxo de Visitante. No fluxo de
                  // Prestador o tipo já está fixo, então é ocultado.
                  if (!isPrestador) ...[
                    const SizedBox(height: AppSpacing.md),
                    Text(getText('lb_tipo'), style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context))),
                    const SizedBox(height: AppSpacing.sm),
                    _TipoPicker(
                      currentTipo: currentTipo,
                      onChanged: (v) => setState(() => currentTipo = v),
                    ),
                  ],
                  if (isPrestador) ...[
                    const SizedBox(height: AppSpacing.xl),
                    _section('Dias de Acesso'),
                    Text(
                      'Dias em que este prestador pode entrar no condomínio.',
                      style: AppTypography.caption(context)
                          .copyWith(color: AppColors.textSecondary(context)),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _buildDiasSemana(),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_infos_apto')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('lb_bloco'),
                          controller: txtBloco,
                          prefixIcon: PhosphorIcons.buildings,
                          readOnly: true,
                          onTap: getUserType() == 'morador' ? null : () {
                            if (listBlocos.isEmpty) {
                              displayMessage(context, getText('alert_ops'), getText('alert_nenhum_bloco'));
                              return;
                            }
                            bottomSheetAptos(context, listBlocos, txtBloco.text, (s) {
                              if (txtBloco.text != s) txtApto.text = '';
                              txtBloco.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
                              setState(() {});
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('lb_apartamento'),
                          controller: txtApto,
                          prefixIcon: PhosphorIcons.door,
                          readOnly: true,
                          onTap: getUserType() == 'morador' ? null : () {
                            if (getListAptos().isEmpty) {
                              displayMessage(context, getText('alert_ops'), getText('visitante_erro_bloco'));
                              return;
                            }
                            bottomSheetAptos(context, getListAptos(), txtApto.text, (s) {
                              txtApto.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
                              setState(() {});
                            });
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_observacoes_opcional')),
                  AppInput(
                    label: getText('lb_observacoes'),
                    controller: txtObs,
                    prefixIcon: PhosphorIcons.notepad,
                    keyboard: TextInputType.multiline,
                    maxLines: 3,
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

  List<String> _parseDias(dynamic raw) {
    final s = raw?.toString().trim() ?? '';
    if (s.isEmpty) return [];
    return s.split(',').map((e) => e.trim().toLowerCase()).where((e) => e.isNotEmpty).toList();
  }

  Widget _buildDiasSemana() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _diasOrdem.map((d) {
        final key = d['key']!;
        final label = d['label']!;
        final sel = diasSemana.contains(key);
        return GestureDetector(
          onTap: () => setState(() {
            if (sel) {
              diasSemana.remove(key);
            } else {
              diasSemana.add(key);
            }
          }),
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: sel ? AppColors.primary : AppColors.surface(context),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: sel ? AppColors.primary : AppColors.border(context)),
            ),
            child: Text(
              label,
              style: AppTypography.captionMedium(context).copyWith(
                color: sel ? Colors.white : AppColors.textSecondary(context),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}

class _TipoPicker extends StatelessWidget {
  final String currentTipo;
  final void Function(String) onChanged;
  const _TipoPicker({required this.currentTipo, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.md,
      runSpacing: AppSpacing.sm,
      children: [
        _Chip(
          label: getText('visitante'),
          selected: currentTipo == 'visitante',
          onTap: () => onChanged('visitante'),
        ),
        _Chip(
          label: getText('visitante_prestador_servico'),
          selected: currentTipo == 'prestador',
          onTap: () => onChanged('prestador'),
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _Chip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: BoxConstraints(maxWidth: screenWidth - 48),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.surface(context),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border(context)),
        ),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            label,
            style: AppTypography.captionMedium(context).copyWith(
              color: selected ? Colors.white : AppColors.textSecondary(context),
            ),
          ),
        ),
      ),
    );
  }
}

class VisitanteModel {
  int? id;
  String? nome, doc_identificacao, data_inicio, data_termino, observacoes, photo, dias_semana;
  int? id_apartamento;
  bool? avisar, is_visitante, is_prestador;

  VisitanteModel({this.id, this.nome, this.doc_identificacao, this.data_inicio,
      this.data_termino, this.avisar, this.id_apartamento, this.is_visitante,
      this.is_prestador, this.observacoes, this.photo, this.dias_semana});

  Map toJson() => {
        'id': id, 'nome': nome, 'doc_identificacao': doc_identificacao,
        'data_inicio': data_inicio, 'data_termino': data_termino,
        'observacoes': observacoes, 'id_apartamento': id_apartamento,
        'avisar': avisar, 'is_visitante': is_visitante, 'is_prestador': is_prestador,
        'dias_semana': dias_semana, 'photo': photo,
      };
}
