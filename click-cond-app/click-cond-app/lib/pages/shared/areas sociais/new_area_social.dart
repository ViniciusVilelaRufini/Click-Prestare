import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/cells/cell_horario_area_social.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewAreaSocial extends StatefulWidget {
  const NewAreaSocial({Key? key, required this.isEdit, this.myId, this.obj}) : super(key: key);
  final bool isEdit;
  final int? myId;
  final dynamic obj;

  @override
  _NewAreaSocialPageState createState() => _NewAreaSocialPageState();
}

class _NewAreaSocialPageState extends State<NewAreaSocial> {
  var _isLoading = false;
  var _isSaving = false;
  final txtNome = TextEditingController();
  final txtCapacidade = TextEditingController();
  final txtLimiteMensalApto = TextEditingController();
  final txtRegras = TextEditingController();
  var autorizacao = '0';
  var pagamento = '0';
  var agendamento = '0';
  dynamic imageFile;

  late List<DiasDaSemanaAreaSocialModel> daysOfWeek = [
    DiasDaSemanaAreaSocialModel(nome: getText('segunda'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('terca'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('quarta'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('quinta'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('sexta'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('sabado'), horarios: []),
    DiasDaSemanaAreaSocialModel(nome: getText('domingo'), horarios: []),
  ];

  @override
  void dispose() {
    txtNome.dispose();
    txtCapacidade.dispose();
    txtLimiteMensalApto.dispose();
    txtRegras.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
  }

  Future<void> load() async {
    setState(() => _isLoading = true);
    daysOfWeek.clear();
    if (widget.obj != null && widget.obj['horarios'] != null) {
      for (var horario in widget.obj['horarios']) {
        List<HorarioModel> list = [];
        if (horario['horarios'] != null) {
          for (var d in horario['horarios']) {
            list.add(HorarioModel(horarioDe: d['horarioDe'], horarioAte: d['horarioAte']));
          }
        }
        daysOfWeek.add(DiasDaSemanaAreaSocialModel(nome: horario['nome'], horarios: list));
      }
    }
    if (widget.obj != null) {
      txtNome.text = widget.obj['nome']?.toString() ?? '';
      txtCapacidade.text = widget.obj['capacidade']?.toString() ?? '';
      // Null ou 0 vindos da API significam "sem limite" — campo fica vazio,
      // não "0", senão o síndico acha que já está limitando a área.
      final limiteObj = widget.obj['limite_mensal_apto'];
      final limiteInt = limiteObj is int ? limiteObj : int.tryParse(limiteObj?.toString() ?? '');
      txtLimiteMensalApto.text = (limiteInt == null || limiteInt <= 0) ? '' : limiteInt.toString();
      autorizacao = widget.obj['precisa_autorizacao']?.toString() ?? '0';
      pagamento = widget.obj['precisa_pagamento']?.toString() ?? '0';
      agendamento = widget.obj['precisa_agendar']?.toString() ?? '0';
      imageFile = widget.obj['imagem'];
      txtRegras.text = widget.obj['regras']?.toString() ?? '';
    }
    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      String? base64;
      if (imageFile != null) {
        if (imageFile is String && imageFile.toString().startsWith('http')) {
          base64 = imageFile;
        } else {
          base64 = convertToBase64(imageFile, 'image/png');
        }
      }
      var obj = AreaSocialModel(
        id: widget.myId ?? -1,
        nome: txtNome.text,
        capacidade: int.parse(txtCapacidade.text.isNotEmpty ? txtCapacidade.text : '-1'),
        // Vazio = sem limite (null); a API já trata null/0 como "não bloqueia".
        limiteMensalApto: txtLimiteMensalApto.text.trim().isEmpty ? null : int.tryParse(txtLimiteMensalApto.text.trim()),
        agendar: agendamento,
        pagar: pagamento,
        autorizacao: autorizacao,
        imagem: base64,
        horarios: daysOfWeek,
        regras: txtRegras.text,
      );
      var res = await apiSaveObject('areas-sociais', 'areaSocial', obj, widget.isEdit);
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
      var res = await apiDeleteObject('areas-sociais', widget.myId!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) {
          Navigator.of(context).pop(true);
          Navigator.of(context).pop(true);
        }
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  Future<void> _selectPhoto() async {
    var res = await getPhoto(context);
    if (res != null) {
      imageFile = res;
      setState(() {});
    }
  }

  Widget _buildImagePreview() {
    if (imageFile == null) {
      return Container(
        width: double.infinity,
        height: 180,
        color: AppColors.primary.withOpacity(0.08),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(PhosphorIcons.imageSquare, size: 48, color: AppColors.primary),
            const SizedBox(height: AppSpacing.sm),
            Text(getText('area_social_nav_new'),
                style: AppTypography.body(context).copyWith(color: AppColors.primary)),
          ],
        ),
      );
    }

    if (imageFile is String && (imageFile as String).startsWith('http')) {
      return Image.network(
        imageFile as String,
        width: double.infinity,
        height: 180,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(
          width: double.infinity,
          height: 180,
          color: Colors.grey.shade200,
          child: const Icon(Icons.broken_image, size: 50, color: Colors.grey),
        ),
      );
    }

    final String path = imageFile is String ? imageFile : (imageFile.path ?? '');
    if (path.isEmpty) return const SizedBox.shrink();

    if (kIsWeb) {
      return Image.network(
        path,
        width: double.infinity,
        height: 180,
        fit: BoxFit.cover,
      );
    } else {
      return Image.file(
        File(path),
        width: double.infinity,
        height: 180,
        fit: BoxFit.cover,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('area_social_nav_new'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  GestureDetector(
                    onTap: _selectPhoto,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: _buildImagePreview(),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('area_social_dados_iniciais')),
                  AppInput(label: getText('nome'), controller: txtNome, prefixIcon: PhosphorIcons.buildings, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('area_social_capacidade_maxima'),
                    controller: txtCapacidade,
                    prefixIcon: PhosphorIcons.usersThree,
                    keyboard: TextInputType.number,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('area_social_limite_mensal'),
                    controller: txtLimiteMensalApto,
                    prefixIcon: PhosphorIcons.calendarCheck,
                    keyboard: TextInputType.number,
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4, left: 4),
                    child: Text(
                      getText('area_social_limite_mensal_vazio'),
                      style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('lb_regras_area'),
                    controller: txtRegras,
                    prefixIcon: PhosphorIcons.notepad,
                    maxLines: 6,
                    textCapitalization: TextCapitalization.sentences,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('area_social_obrigatoriedades')),
                  _Toggle(
                    label: getText('area_social_precisa_autorizacao'),
                    value: autorizacao == '1',
                    onChanged: (v) => setState(() => autorizacao = v ? '1' : '0'),
                  ),
                  _Toggle(
                    label: getText('area_social_precisa_pagamento'),
                    value: pagamento == '1',
                    onChanged: (v) => setState(() => pagamento = v ? '1' : '0'),
                  ),
                  _Toggle(
                    label: getText('area_social_precisa_agendamento'),
                    value: agendamento == '1',
                    onChanged: (v) => setState(() => agendamento = v ? '1' : '0'),
                  ),
                  if (agendamento == '1') ...[
                    const SizedBox(height: AppSpacing.xl),
                    _section('FUNCIONAMENTO'),
                    Theme(
                      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                      child: Column(
                        children: [
                          for (var dia in daysOfWeek)
                            Container(
                              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                              decoration: BoxDecoration(
                                color: AppColors.surface(context),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: AppColors.border(context)),
                              ),
                              child: ExpansionTile(
                                tilePadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                                title: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(dia.nome, style: AppTypography.bodyMedium(context)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: AppColors.primary.withOpacity(0.1),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(dia.horarios.length.toString(),
                                          style: AppTypography.caption(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.w600)),
                                    ),
                                  ],
                                ),
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                                    child: Column(
                                      children: [
                                        InkWell(
                                          onTap: () => setState(() => dia.horarios.add(HorarioModel(horarioDe: '08:00', horarioAte: '17:00'))),
                                          child: Row(
                                            mainAxisAlignment: MainAxisAlignment.end,
                                            children: [
                                              Text(getText('area_social_novo_horario'),
                                                  style: AppTypography.body(context).copyWith(color: AppColors.primary)),
                                              const SizedBox(width: AppSpacing.xs),
                                              Icon(PhosphorIcons.plusCircle, size: 20, color: AppColors.primary),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(height: AppSpacing.sm),
                                        for (var i = 0; i < dia.horarios.length; i++)
                                          CellHorarioAreaSocial(
                                            horario: dia.horarios[i],
                                            onDelete: () => setState(() => dia.horarios.removeAt(i)),
                                            onChangeDe: () => showCupertinoModalPopup(
                                              context: context,
                                              builder: (_) => ModalCupertino(
                                                onPressed: (text) => setState(() => dia.horarios[i].horarioDe = text),
                                                initialDate: null, type: 'time',
                                              ),
                                            ),
                                            onChangeAte: () => showCupertinoModalPopup(
                                              context: context,
                                              builder: (_) => ModalCupertino(
                                                onPressed: (text) => setState(() => dia.horarios[i].horarioAte = text),
                                                initialDate: null, type: 'time',
                                              ),
                                            ),
                                          ),
                                        const SizedBox(height: AppSpacing.sm),
                                      ],
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

class _Toggle extends StatelessWidget {
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  const _Toggle({required this.label, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppTypography.body(context))),
          Switch(
            value: value,
            onChanged: onChanged,
            activeColor: AppColors.primary,
          ),
        ],
      ),
    );
  }
}

class AreaSocialModel {
  int? id;
  String? nome;
  int? capacidade;
  // Teto de reservas pendente/aprovado por apartamento no mês. Null = sem
  // limite — mesmo estado de hoje para toda área que o síndico não configurar.
  int? limiteMensalApto;
  String? imagem;
  String? agendar;
  String? autorizacao;
  String? pagar;
  List<DiasDaSemanaAreaSocialModel>? horarios;
  String? regras;

  AreaSocialModel({this.id, this.nome, this.capacidade, this.limiteMensalApto, this.imagem,
      this.agendar, this.autorizacao, this.pagar, this.horarios, this.regras});

  Map toJson() => {
        'id': id, 'nome': nome, 'capacidade': capacidade, 'limite_mensal_apto': limiteMensalApto, 'imagem': imagem,
        'agendar': agendar, 'autorizacao': autorizacao, 'pagar': pagar, 'horarios': horarios,
        'regras': regras,
      };
}

class DiasDaSemanaAreaSocialModel {
  String nome;
  List<HorarioModel> horarios;

  DiasDaSemanaAreaSocialModel({required this.nome, required this.horarios});

  Map toJson() => {'nome': nome, 'horarios': horarios};
}

class HorarioModel {
  String horarioDe;
  String horarioAte;

  HorarioModel({required this.horarioDe, required this.horarioAte});

  Map toJson() => {'horarioDe': horarioDe, 'horarioAte': horarioAte};
}
