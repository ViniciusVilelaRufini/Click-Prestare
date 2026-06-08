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

  // Unidade de destino (obrigatória). Para morador: preenchida com o próprio apto.
  // Para síndico/funcionário: seletor bloco/apto (mesmo padrão de Visitantes).
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
    txtNome.dispose(); txtTelefone.dispose(); txtOutrasCategorias.dispose();
    txtBloco.dispose(); txtApto.dispose();
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
    // Morador cadastra só para o próprio apto; demais escolhem no seletor.
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

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("prestadores", widget.myId!);
      txtNome.text = obj["nome"] ?? '';
      txtTelefone.text = obj["telefone"] ?? '';
      categorias = obj["categorias"].split(",");
      // Pré-preenche a unidade na edição (síndico/funcionário). O bloco/apto vêm do
      // apartamento relacionado quando o backend os envia.
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
      // Unidade de destino é obrigatória (morador usa o próprio apto; demais o seletor).
      final idApto = idMyApartment ?? getIdApto();
      if (idApto == null) {
        displayMessage(context, getText('alert_ops'), 'Selecione a unidade de destino do prestador.');
        return;
      }
      setState(() => _isSaving = true);
      if (txtOutrasCategorias.text.isNotEmpty) categorias.add(txtOutrasCategorias.text);
      List<String> categsToAdd = List<String>.from(categorias)..remove('');
      var obj = PrestadorModel(id: widget.myId ?? -1, nome: txtNome.text, telefone: txtTelefone.text, categorias: categsToAdd, id_apartamento: idApto);
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
                  _section(getText('prestador_infos')),
                  AppInput(label: getText('user_nome_completo'), controller: txtNome, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('telefone'), controller: txtTelefone, prefixIcon: PhosphorIcons.phone, keyboard: TextInputType.phone),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('prestador_funcoes')),
                  Text(getText('prestador_selecione_categoria'),
                      style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
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
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                            decoration: BoxDecoration(
                              color: categorias.contains(cat["display"]) ? AppColors.primary : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: categorias.contains(cat["display"]) ? AppColors.primary : AppColors.border(context),
                              ),
                            ),
                            child: Text(cat["display"]!,
                                style: AppTypography.captionMedium(context).copyWith(
                                    color: categorias.contains(cat["display"]) ? Colors.white : AppColors.textSecondary(context))),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('prestador_categoria_desc'), controller: txtOutrasCategorias, prefixIcon: PhosphorIcons.plusCircle),
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

class PrestadorModel {
  int? id;
  String? nome, telefone;
  List<String>? categorias;
  int? id_apartamento;

  PrestadorModel({this.id, this.nome, this.telefone, this.categorias, this.id_apartamento});

  Map toJson() => {'id': id, 'nome': nome, 'telefone': telefone, 'categorias': categorias, 'id_apartamento': id_apartamento};
}
