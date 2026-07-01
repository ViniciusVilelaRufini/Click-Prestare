import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import '../../singleton.dart';

class NewPrestador extends StatefulWidget {
  const NewPrestador({Key? key, required this.isEdit, this.myId}) : super(key: key);
  final bool isEdit;
  final int? myId;

  @override
  _NewPrestadorPageState createState() => _NewPrestadorPageState();
}

class _NewPrestadorPageState extends State<NewPrestador> {
  var _isLoading = false;
  var _isSaving = false;
  final txtNome = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtOutrasCategorias = TextEditingController();
  var categorias = [];

  // Foto
  dynamic imageFile;
  String? currentFotoUrl;
  bool imageChanged = false;

  // Dias da semana (abreviações usadas pelo backend: seg, ter, qua, qui, sex, sab, dom)
  List<String> diasSemana = ['seg', 'ter', 'qua', 'qui', 'sex'];

  static const _diasOrdem = [
    {'key': 'seg', 'label': 'Seg'},
    {'key': 'ter', 'label': 'Ter'},
    {'key': 'qua', 'label': 'Qua'},
    {'key': 'qui', 'label': 'Qui'},
    {'key': 'sex', 'label': 'Sex'},
    {'key': 'sab', 'label': 'Sáb'},
    {'key': 'dom', 'label': 'Dom'},
  ];

  // Unidade de destino
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  var idMyApartment;
  var list = [];
  var listBlocos = [];

  late final List<Map<String, String>> opcoesCategorias = [
    {"display": getText('prestador_eletricista'), "value": "Eletricista"},
    {"display": getText('prestador_hidraulica'), "value": "Hidraulica"},
    {"display": getText('prestador_pintor'), "value": "Pintor"},
    {"display": getText('prestador_pedreiro'), "value": "Pedreiro"},
    {"display": getText('prestador_limpeza'), "value": "Limpeza"},
    {"display": getText('prestador_dedetizacao'), "value": "Dedetizacao"},
  ];

  @override
  void dispose() {
    txtNome.dispose();
    txtTelefone.dispose();
    txtOutrasCategorias.dispose();
    txtBloco.dispose();
    txtApto.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) {
      load();
    } else {
      categorias = [];
    }
    if (getUserType() == 'morador') {
      txtBloco.text = Singleton.instance.bloco;
      txtApto.text = Singleton.instance.apartamento;
      idMyApartment = Singleton.instance.id_apartamento;
    } else {
      loadListAptos();
    }
  }

  Future<void> loadListAptos() async {
    try {
      var aptos = await apiGetAll("apartamentos");
      list = aptos;
      listBlocos.clear();
      for (var item in list) {
        if (!listBlocos.contains(item['bloco'])) listBlocos.add(item['bloco']);
      }
      if (mounted) setState(() {});
    } catch (e) {
      // silencioso — o seletor fica vazio e o save valida a unidade
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

  int? getIdApto() {
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && item["apto"] == txtApto.text) return item["id"];
    }
    return null;
  }

  Future<void> _pickPhoto() async {
    final picked = await getPhoto(context);
    if (picked == null) return;
    setState(() {
      imageFile = picked;
      imageChanged = true;
    });
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("prestadores", widget.myId!);
      txtNome.text = obj["nome"] ?? '';
      txtTelefone.text = obj["telefone"] ?? '';
      final cats = obj["categorias"]?.toString().trim() ?? '';
      categorias = cats.isNotEmpty ? cats.split(",") : [];
      final foto = obj["foto_pessoa"]?.toString().trim() ?? '';
      currentFotoUrl = foto.isNotEmpty && foto != 'null' ? foto : null;
      final dias = obj["dias_semana"]?.toString().trim() ?? '';
      diasSemana = dias.isNotEmpty
          ? dias.split(',').map((d) => d.trim()).where((d) => d.isNotEmpty).toList()
          : [];
      if (obj["apto_bloco"] != null) txtBloco.text = obj["apto_bloco"].toString();
      if (obj["apto"] != null) txtApto.text = obj["apto"].toString();
      if (obj["id_apartamento"] != null) idMyApartment = obj["id_apartamento"];
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      final idApto = idMyApartment ?? getIdApto();
      if (idApto == null) {
        displayMessage(context, getText('alert_ops'), 'Selecione a unidade de destino do prestador.');
        return;
      }
      setState(() => _isSaving = true);
      if (txtOutrasCategorias.text.isNotEmpty) categorias.add(txtOutrasCategorias.text);
      List<String> categsToAdd = List<String>.from(categorias)..remove('');

      String? foto;
      if (imageChanged && imageFile != null) {
        foto = convertToBase64(imageFile, 'image/jpeg');
      } else {
        foto = currentFotoUrl;
      }

      var obj = PrestadorModel(
        id: widget.myId ?? -1,
        nome: txtNome.text,
        telefone: txtTelefone.text,
        categorias: categsToAdd,
        id_apartamento: idApto,
        foto_pessoa: foto,
        dias_semana: diasSemana.join(','),
      );
      var res = await apiSaveObject("prestadores", "prestador", obj, widget.isEdit);
      if (res.toString().isEmpty) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
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
      var res = await apiDeleteObject('prestadores', widget.myId!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  ImageProvider? _resolveImageProvider() {
    if (imageChanged && imageFile != null) {
      if (!kIsWeb) {
        try {
          return FileImage(io.File(imageFile.path as String));
        } catch (_) {}
      }
      return null;
    }
    final f = currentFotoUrl ?? '';
    if (f.isEmpty || f == 'null') return null;
    if (f.startsWith('http://') || f.startsWith('https://')) return NetworkImage(f);
    if (f.startsWith('data:')) {
      final idx = f.indexOf(',');
      if (idx > 0) {
        try { return MemoryImage(base64Decode(f.substring(idx + 1))); } catch (_) {}
      }
    }
    try { return MemoryImage(base64Decode(f)); } catch (_) {}
    return null;
  }

  Widget _buildPhotoSection() {
    final provider = _resolveImageProvider();
    return Center(
      child: GestureDetector(
        onTap: _pickPhoto,
        child: Stack(
          children: [
            CircleAvatar(
              radius: 48,
              backgroundColor: AppColors.primary.withOpacity(0.1),
              backgroundImage: provider,
              child: provider == null
                  ? Icon(PhosphorIcons.userCircle, size: 48, color: AppColors.primary.withOpacity(0.5))
                  : null,
            ),
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  shape: BoxShape.circle,
                ),
                child: const Icon(PhosphorIcons.camera, size: 14, color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
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
              border: Border.all(
                color: sel ? AppColors.primary : AppColors.border(context),
              ),
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.isEdit ? getText('prestador_nav_edit') : getText('prestador_nav_new'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: AppSpacing.md),
                  _buildPhotoSection(),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('prestador_infos')),
                  AppInput(
                    label: getText('user_nome_completo'),
                    controller: txtNome,
                    prefixIcon: PhosphorIcons.user,
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('telefone'),
                    controller: txtTelefone,
                    prefixIcon: PhosphorIcons.phone,
                    keyboard: TextInputType.phone,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('prestador_funcoes')),
                  Text(
                    getText('prestador_selecione_categoria'),
                    style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
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
                              if (categorias.contains(cat["display"])) {
                                categorias.remove(cat["display"]);
                              } else {
                                categorias.add(cat["display"]);
                              }
                            });
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                            decoration: BoxDecoration(
                              color: categorias.contains(cat["display"])
                                  ? AppColors.primary
                                  : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: categorias.contains(cat["display"])
                                    ? AppColors.primary
                                    : AppColors.border(context),
                              ),
                            ),
                            child: Text(
                              cat["display"]!,
                              style: AppTypography.captionMedium(context).copyWith(
                                color: categorias.contains(cat["display"])
                                    ? Colors.white
                                    : AppColors.textSecondary(context),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('prestador_categoria_desc'),
                    controller: txtOutrasCategorias,
                    prefixIcon: PhosphorIcons.plusCircle,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section('Dias de Acesso'),
                  Text(
                    'Dias em que este funcionário pode entrar no condomínio.',
                    style: AppTypography.caption(context)
                        .copyWith(color: AppColors.textSecondary(context)),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _buildDiasSemana(),
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
                          onTap: getUserType() == 'morador'
                              ? null
                              : () {
                                  if (listBlocos.isEmpty) {
                                    displayMessage(context, getText('alert_ops'),
                                        getText('alert_nenhum_bloco'));
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
                          onTap: getUserType() == 'morador'
                              ? null
                              : () {
                                  if (getListAptos().isEmpty) {
                                    displayMessage(context, getText('alert_ops'),
                                        getText('visitante_erro_bloco'));
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
        child: Text(
          title.toUpperCase(),
          style: AppTypography.captionMedium(context)
              .copyWith(color: AppColors.primary, letterSpacing: 0.8),
        ),
      );
}

class PrestadorModel {
  int? id;
  String? nome, telefone;
  List<String>? categorias;
  int? id_apartamento;
  String? foto_pessoa;
  String? dias_semana;

  PrestadorModel({
    this.id,
    this.nome,
    this.telefone,
    this.categorias,
    this.id_apartamento,
    this.foto_pessoa,
    this.dias_semana,
  });

  Map toJson() => {
        'id': id,
        'nome': nome,
        'telefone': telefone,
        'categorias': categorias,
        'id_apartamento': id_apartamento,
        'foto_pessoa': foto_pessoa,
        'dias_semana': dias_semana,
      };
}
