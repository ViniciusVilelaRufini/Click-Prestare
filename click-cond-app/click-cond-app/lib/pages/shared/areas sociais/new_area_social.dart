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
                  _section('REGRAS & OBRIGATORIEDADES'),
                  _ObrigatoriedadeCard(
                    icon: PhosphorIcons.shieldCheckBold,
                    title: getText('area_social_precisa_autorizacao'),
                    subtitle: 'Exige aprovação do síndico ou administração para cada reserva',
                    value: autorizacao == '1',
                    onChanged: (v) => setState(() => autorizacao = v ? '1' : '0'),
                  ),
                  _ObrigatoriedadeCard(
                    icon: PhosphorIcons.creditCardBold,
                    title: getText('area_social_precisa_pagamento'),
                    subtitle: 'Gera cobrança ou taxa pelo uso do espaço para o morador',
                    value: pagamento == '1',
                    onChanged: (v) => setState(() => pagamento = v ? '1' : '0'),
                  ),
                  _ObrigatoriedadeCard(
                    icon: PhosphorIcons.calendarCheckBold,
                    title: getText('area_social_precisa_agendamento'),
                    subtitle: 'Controla reservas por data e intervalos de horários de funcionamento',
                    value: agendamento == '1',
                    onChanged: (v) => setState(() => agendamento = v ? '1' : '0'),
                  ),

                  if (agendamento == '1') ...[
                    const SizedBox(height: AppSpacing.xl),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        _section('HORÁRIOS DE FUNCIONAMENTO'),
                        if (daysOfWeek.any((d) => d.horarios.isNotEmpty))
                          TextButton.icon(
                            style: TextButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              foregroundColor: const Color(0xFFEF4444),
                            ),
                            onPressed: () => _applyPreset('limpar'),
                            icon: const Icon(PhosphorIcons.trashBold, size: 14),
                            label: const Text('Limpar todos', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                          ),
                      ],
                    ),

                    // Modelos Rápidos (Atalhos com 1 toque)
                    _buildQuickPresetsBar(),

                    const SizedBox(height: AppSpacing.md),

                    // Lista dos 7 dias da semana
                    Column(
                      children: [
                        for (var i = 0; i < daysOfWeek.length; i++)
                          _buildDayCard(i),
                      ],
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

  Widget _buildQuickPresetsBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B).withOpacity(0.4) : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(PhosphorIcons.lightningBold, size: 14, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                'MODELOS RÁPIDOS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildPresetChip(
                  label: 'Todos os dias (08h às 22h)',
                  onTap: () => _applyPreset('todos_08_22'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: 'Seg a Sex (08h-22h) + Fim de semana (09h-23h)',
                  onTap: () => _applyPreset('seg_sex_fim_semana'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: 'Seg a Sex apenas (08h às 22h)',
                  onTap: () => _applyPreset('seg_sex_only'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: '24 Horas (Livre)',
                  onTap: () => _applyPreset('24h'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPresetChip({required String label, required VoidCallback onTap}) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: isDark ? const Color(0xFF0F172A) : Colors.white,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: AppColors.primary.withOpacity(0.3),
              width: 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(PhosphorIcons.magicWandBold, size: 13, color: AppColors.primary),
              const SizedBox(width: 5),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _applyPreset(String preset) {
    setState(() {
      if (preset == 'todos_08_22') {
        for (var d in daysOfWeek) {
          d.horarios = [HorarioModel(horarioDe: '08:00', horarioAte: '22:00')];
        }
      } else if (preset == 'seg_sex_fim_semana') {
        for (var i = 0; i < daysOfWeek.length; i++) {
          if (i < 5) {
            daysOfWeek[i].horarios = [HorarioModel(horarioDe: '08:00', horarioAte: '22:00')];
          } else {
            daysOfWeek[i].horarios = [HorarioModel(horarioDe: '09:00', horarioAte: '23:00')];
          }
        }
      } else if (preset == 'seg_sex_only') {
        for (var i = 0; i < daysOfWeek.length; i++) {
          if (i < 5) {
            daysOfWeek[i].horarios = [HorarioModel(horarioDe: '08:00', horarioAte: '22:00')];
          } else {
            daysOfWeek[i].horarios = [];
          }
        }
      } else if (preset == '24h') {
        for (var d in daysOfWeek) {
          d.horarios = [HorarioModel(horarioDe: '00:00', horarioAte: '23:59')];
        }
      } else if (preset == 'limpar') {
        for (var d in daysOfWeek) {
          d.horarios = [];
        }
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          preset == 'limpar' ? 'Horários limpos com sucesso.' : 'Modelo de horários aplicado!',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Widget _buildDayCard(int index) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final dia = daysOfWeek[index];
    final hasHorarios = dia.horarios.isNotEmpty;

    // Abreviaturas para os badges
    const abrevs = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
    final abrev = index < abrevs.length ? abrevs[index] : dia.nome.substring(0, 3).toUpperCase();

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasHorarios
              ? (isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1))
              : AppColors.border(context),
          width: hasHorarios ? 1.2 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: hasHorarios && index == 0,
        tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: hasHorarios
                ? AppColors.primary.withOpacity(0.12)
                : (isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0)),
            borderRadius: BorderRadius.circular(10),
          ),
          alignment: Alignment.center,
          child: Text(
            abrev,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: hasHorarios ? AppColors.primary : AppColors.textSecondary(context),
            ),
          ),
        ),
        title: Text(
          dia.nome,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary(context),
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: hasHorarios ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  hasHorarios
                      ? (dia.horarios.length == 1
                          ? '${dia.horarios[0].horarioDe} às ${dia.horarios[0].horarioAte}'
                          : '${dia.horarios.length} intervalos de horário')
                      : 'Fechado / Não funciona',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: hasHorarios ? FontWeight.w600 : FontWeight.w400,
                    color: hasHorarios
                        ? (isDark ? const Color(0xFF34D399) : const Color(0xFF059669))
                        : AppColors.textSecondary(context),
                  ),
                ),
              ),
            ],
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Switch rápido para ativar/desativar o dia
            Switch(
              value: hasHorarios,
              activeColor: AppColors.primary,
              onChanged: (val) {
                setState(() {
                  if (val) {
                    if (dia.horarios.isEmpty) {
                      dia.horarios.add(HorarioModel(horarioDe: '08:00', horarioAte: '22:00'));
                    }
                  } else {
                    dia.horarios.clear();
                  }
                });
              },
            ),
          ],
        ),
        children: [
          const Divider(height: 1, thickness: 1),
          const SizedBox(height: 12),

          if (!hasHorarios) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF0F172A).withOpacity(0.5) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(PhosphorIcons.info, size: 18, color: AppColors.textSecondary(context)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Este dia está marcado como fechado. Clique no botão abaixo para adicionar um horário.',
                      style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary(context)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ] else ...[
            for (var i = 0; i < dia.horarios.length; i++)
              CellHorarioAreaSocial(
                horario: dia.horarios[i],
                onDelete: () => setState(() => dia.horarios.removeAt(i)),
                onChangeDe: () => _pickTime(
                  context,
                  dia.horarios[i].horarioDe,
                  (newVal) => setState(() => dia.horarios[i].horarioDe = newVal),
                  title: 'Horário de Início (${dia.nome})',
                ),
                onChangeAte: () => _pickTime(
                  context,
                  dia.horarios[i].horarioAte,
                  (newVal) => setState(() => dia.horarios[i].horarioAte = newVal),
                  title: 'Horário de Término (${dia.nome})',
                ),
              ),
          ],

          // Barra de ações do dia
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Adicionar intervalo
              InkWell(
                onTap: () => setState(() => dia.horarios.add(HorarioModel(horarioDe: '08:00', horarioAte: '22:00'))),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Icon(PhosphorIcons.plusCircleBold, size: 16, color: AppColors.primary),
                      SizedBox(width: 5),
                      Text(
                        'Adicionar Horário',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Replicar horário para outros dias
              if (hasHorarios)
                InkWell(
                  onTap: () => _openCopyModal(index),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(PhosphorIcons.copyBold, size: 15, color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B)),
                        const SizedBox(width: 4),
                        Text(
                          'Copiar para outros dias',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  void _openCopyModal(int fromIndex) {
    final fromDay = daysOfWeek[fromIndex];
    final selectedIndices = <int>{};

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final isDark = Theme.of(context).brightness == Brightness.dark;

            return Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated(context),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                border: Border(top: BorderSide(color: AppColors.border(context))),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.textTertiary(context),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Copiar horários de ${fromDay.nome}',
                    style: AppTypography.headline(context),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Selecione quais dias da semana receberão estes mesmos horários:',
                    style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                  ),
                  const SizedBox(height: 16),

                  // Atalhos de seleção
                  Row(
                    children: [
                      ActionChip(
                        label: const Text('Seg a Sex', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        onPressed: () {
                          setModalState(() {
                            for (var i = 0; i < 5; i++) {
                              if (i != fromIndex) selectedIndices.add(i);
                            }
                          });
                        },
                      ),
                      const SizedBox(width: 8),
                      ActionChip(
                        label: const Text('Todos os dias', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        onPressed: () {
                          setModalState(() {
                            for (var i = 0; i < daysOfWeek.length; i++) {
                              if (i != fromIndex) selectedIndices.add(i);
                            }
                          });
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Lista de dias
                  for (var i = 0; i < daysOfWeek.length; i++)
                    if (i != fromIndex)
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(daysOfWeek[i].nome, style: AppTypography.body(context)),
                        value: selectedIndices.contains(i),
                        activeColor: AppColors.primary,
                        onChanged: (val) {
                          setModalState(() {
                            if (val == true) {
                              selectedIndices.add(i);
                            } else {
                              selectedIndices.remove(i);
                            }
                          });
                        },
                      ),

                  const SizedBox(height: 16),
                  AppButton(
                    label: 'Aplicar para ${selectedIndices.length} ${selectedIndices.length == 1 ? 'dia' : 'dias'}',
                    onPressed: selectedIndices.isEmpty
                        ? null
                        : () {
                            setState(() {
                              for (var i in selectedIndices) {
                                daysOfWeek[i].horarios = fromDay.horarios
                                    .map((h) => HorarioModel(horarioDe: h.horarioDe, horarioAte: h.horarioAte))
                                    .toList();
                              }
                            });
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Horários replicados com sucesso!'),
                                duration: Duration(seconds: 2),
                                behavior: SnackBarBehavior.floating,
                              ),
                            );
                          },
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _pickTime(
    BuildContext context,
    String currentTime,
    ValueChanged<String> onSelected, {
    String title = 'Selecionar Horário',
  }) {
    // Parse hora e minuto inicial
    int initH = 8;
    int initM = 0;
    try {
      final parts = currentTime.split(':');
      if (parts.length >= 2) {
        initH = int.parse(parts[0]);
        initM = int.parse(parts[1]);
      }
    } catch (_) {}

    DateTime selectedDateTime = DateTime(2026, 1, 1, initH, initM);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final isDark = Theme.of(context).brightness == Brightness.dark;

        return StatefulBuilder(
          builder: (context, setPickerState) {
            final formattedNow =
                '${selectedDateTime.hour.toString().padLeft(2, '0')}:${selectedDateTime.minute.toString().padLeft(2, '0')}';

            return Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              decoration: BoxDecoration(
                color: AppColors.surfaceElevated(context),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                border: Border(top: BorderSide(color: AppColors.border(context))),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Center(
                    child: Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.textTertiary(context),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      TextButton(
                        onPressed: () => Navigator.of(ctx).pop(),
                        child: Text(
                          'Cancelar',
                          style: TextStyle(color: AppColors.textSecondary(context), fontSize: 15),
                        ),
                      ),
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textPrimary(context),
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          onSelected(formattedNow);
                          Navigator.of(ctx).pop();
                        },
                        child: const Text(
                          'Pronto',
                          style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700, fontSize: 15),
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 1),
                  const SizedBox(height: 12),

                  // Atalhos de Horários Comuns
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (var preset in [
                          '06:00', '07:00', '08:00', '09:00', '10:00',
                          '12:00', '14:00', '18:00', '22:00', '23:00', '23:59'
                        ])
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(
                              label: Text(preset, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                              selected: formattedNow == preset,
                              selectedColor: AppColors.primary.withOpacity(0.15),
                              onSelected: (_) {
                                final parts = preset.split(':');
                                setPickerState(() {
                                  selectedDateTime = DateTime(2026, 1, 1, int.parse(parts[0]), int.parse(parts[1]));
                                });
                              },
                            ),
                          ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 10),

                  // Seletor Cupertino
                  SizedBox(
                    height: 200,
                    child: CupertinoTheme(
                      data: CupertinoThemeData(
                        brightness: isDark ? Brightness.dark : Brightness.light,
                        textTheme: CupertinoTextThemeData(
                          dateTimePickerTextStyle: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textPrimary(context),
                          ),
                        ),
                      ),
                      child: CupertinoDatePicker(
                        mode: CupertinoDatePickerMode.time,
                        use24hFormat: true,
                        initialDateTime: selectedDateTime,
                        onDateTimeChanged: (newDate) {
                          setPickerState(() => selectedDateTime = newDate);
                        },
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(
          title.toUpperCase(),
          style: AppTypography.captionMedium(context).copyWith(
            color: AppColors.primary,
            letterSpacing: 0.8,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}

class _ObrigatoriedadeCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _ObrigatoriedadeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: value
              ? (isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1))
              : AppColors.border(context),
          width: value ? 1.2 : 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: value
                  ? AppColors.primary.withOpacity(0.12)
                  : (isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0)),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              icon,
              size: 20,
              color: value ? AppColors.primary : AppColors.textSecondary(context),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary(context),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary(context),
                  ),
                ),
              ],
            ),
          ),
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
  int? limiteMensalApto;
  String? imagem;
  String? agendar;
  String? autorizacao;
  String? pagar;
  List<DiasDaSemanaAreaSocialModel>? horarios;
  String? regras;

  AreaSocialModel({
    this.id,
    this.nome,
    this.capacidade,
    this.limiteMensalApto,
    this.imagem,
    this.agendar,
    this.autorizacao,
    this.pagar,
    this.horarios,
    this.regras,
  });

  Map toJson() => {
        'id': id,
        'nome': nome,
        'capacidade': capacidade,
        'limite_mensal_apto': limiteMensalApto,
        'imagem': imagem,
        'agendar': agendar,
        'autorizacao': autorizacao,
        'pagar': pagar,
        'horarios': horarios,
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
