import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/alerts/modal_agenda_reserva.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewReserva extends StatefulWidget {
  const NewReserva({Key? key, required this.obj, this.objEditReserva}) : super(key: key);
  final dynamic obj;
  final dynamic objEditReserva;

  @override
  _NewReservaPageState createState() => _NewReservaPageState();
}

class _NewReservaPageState extends State<NewReserva> {
  final txtData = TextEditingController();
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtConvidados = TextEditingController();
  var _isLoading = false;
  var _isSaving = false;
  var list = [];
  var listBlocos = [];
  var acceptTerms = false;
  DateTime? selectedDay;
  dynamic selectedHour = ' - ';

  // Sem regras cadastradas não há o que aceitar — o checkbox some e o save
  // não pode ficar bloqueado esperando um aceite que não faz sentido pedir.
  bool get hasRegras => widget.obj['regras'] != null && widget.obj['regras'].toString().trim().isNotEmpty;

  // Capacidade 0/nula = área sem limite configurado — mesma regra da API.
  int get capacidade => int.tryParse(widget.obj['capacidade']?.toString() ?? '') ?? 0;

  @override
  void dispose() {
    txtData.dispose(); txtBloco.dispose(); txtApto.dispose(); txtConvidados.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.objEditReserva != null) load();
    if (getUserType() == 'morador') {
      txtBloco.text = Singleton.instance.bloco;
      txtApto.text = Singleton.instance.apartamento;
    } else {
      loadListAptos();
    }
  }

  Future<void> load() async {
    txtData.text = widget.objEditReserva['data'];
    txtApto.text = widget.objEditReserva['apto'];
    txtBloco.text = widget.objEditReserva['bloco'];
    selectedHour = '${widget.objEditReserva['horaDe']} - ${widget.objEditReserva['horaAte']}';
    final convidadosSalvo = widget.objEditReserva['convidados'];
    txtConvidados.text = convidadosSalvo != null ? convidadosSalvo.toString() : '';
    acceptTerms = true;
    if (mounted) setState(() {});
  }

  Future<void> save() async {
    if (txtData.text.isEmpty) {
      displayMessage(context, getText('alert'), 'Selecione uma data.');
      return;
    }
    if (selectedHour == null || selectedHour.toString().trim() == '-' || !selectedHour.toString().contains(' - ')) {
      displayMessage(context, getText('alert'), 'Selecione um horário.');
      return;
    }
    if (txtBloco.text.isEmpty || txtApto.text.isEmpty) {
      displayMessage(context, getText('alert'), 'Bloco e apartamento são obrigatórios.');
      return;
    }
    final aptoId = getAptoId();
    if (aptoId.isEmpty) {
      displayMessage(context, getText('alert'), 'Apartamento inválido.');
      return;
    }
    if (hasRegras && !acceptTerms) {
      displayMessage(context, getText('alert'), getText('area_social_erro_normas'));
      return;
    }
    // Convidados é opcional — string vazia não valida nada (reserva do jeito
    // antigo continua funcionando). Só entra na checagem quando preenchido.
    int? convidados;
    if (txtConvidados.text.trim().isNotEmpty) {
      convidados = int.tryParse(txtConvidados.text.trim());
      if (convidados == null || convidados <= 0) {
        displayMessage(context, getText('alert'), getText('convidados_erro_invalido'));
        return;
      }
      if (capacidade > 0 && convidados > capacidade) {
        displayMessage(
          context,
          getText('alert'),
          getText('convidados_erro_capacidade').replaceAll('%CAP%', capacidade.toString()),
        );
        return;
      }
    }
    try {
      setState(() => _isSaving = true);
      final partes = selectedHour.toString().split(' - ');
      var obj = AreaSocialReservaModel(
        id: -1,
        id_area_social: widget.obj['id'],
        data: txtData.text,
        horaDe: partes[0].trim(),
        horaAte: partes[1].trim(),
        id_apartamento: aptoId,
        convidados: convidados,
      );
      var res = await apiSaveObject('areas-sociais/agendamento', 'agendamento', obj, widget.objEditReserva != null);
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
      var res = await apiDeleteObject('areas-sociais/agendamento', widget.objEditReserva['id']);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  Future<void> loadListAptos() async {
    try {
      setState(() => _isLoading = true);
      var aptos = await apiGetAll('apartamentos');
      list = aptos;
      listBlocos.clear();
      for (var item in list) {
        if (!listBlocos.contains(item['bloco'])) listBlocos.add(item['bloco']);
      }
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<dynamic> getListAptos() {
    var listAptos = [];
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && !listAptos.contains(item['apto'])) {
        listAptos.add(item['apto']);
      }
    }
    return listAptos;
  }

  Map<DateTime?, int> getAllDias() {
    var map = <DateTime?, int>{};
    widget.obj['horarios_livres'].forEach((k, v) {
      map[convertStringToDateFormat(k)] = 0;
    });
    return map;
  }

  List<dynamic> getHorariosFromDia() {
    if (widget.objEditReserva != null) return [selectedHour];
    try {
      if (txtData.text.isEmpty) return [];
      var list = [];
      for (var horario in widget.obj['horarios_livres'][txtData.text]) {
        list.add('${horario['horarioDe']} - ${horario['horarioAte']}');
      }
      return list;
    } catch (e) {
      return [];
    }
  }

  String getAptoId() {
    if (getUserType() == 'morador') return Singleton.instance.id_apartamento.toString();
    for (var apto in list) {
      if (apto['bloco'] == txtBloco.text && apto['apto'] == txtApto.text) return apto['id'].toString();
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.objEditReserva != null;

    return AppScaffold(
      title: isEdit ? getText('area_social_nav_edit_reserva') : getText('area_social_nav_reservar'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section(getText('lb_area_social')),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border(context)),
              ),
              child: Row(
                children: [
                  Icon(PhosphorIcons.mapPin, color: AppColors.primary, size: 20),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.obj['nome'], style: AppTypography.bodyMedium(context)),
                        Text(
                          '${widget.obj['capacidade']} ${getText('pessoas')}',
                          style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
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
                    onTap: isEdit || getUserType() == 'morador'
                        ? null
                        : () {
                            if (listBlocos.isEmpty) {
                              return displayMessage(context, getText('alert_ops'), getText('alert_nenhum_bloco'));
                            }
                            bottomSheetAptos(context, listBlocos, txtBloco.text, (s) {
                              if (txtBloco.text != s) txtApto.text = '';
                              txtBloco.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
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
                    onTap: isEdit || getUserType() == 'morador'
                        ? null
                        : () {
                            if (getListAptos().isEmpty) {
                              return displayMessage(context, getText('alert_ops'), getText('visitante_erro_bloco'));
                            }
                            bottomSheetAptos(context, getListAptos(), txtApto.text, (s) {
                              txtApto.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
                            });
                          },
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            _section(getText('dia_e_hora')),
            AppInput(
              label: getText('dia'),
              controller: txtData,
              prefixIcon: PhosphorIcons.calendarBlank,
              readOnly: true,
              onTap: isEdit
                  ? null
                  : () => showDialog(
                        context: context,
                        builder: (_) => ModalAgendaReserva(
                          allowedDays: getAllDias(),
                          selected: selectedDay,
                          onPressed: (selectedDate) {
                            selectedDay = selectedDate;
                            txtData.text = convertDateFormatToString(selectedDate);
                            setState(() {});
                            Navigator.pop(context);
                          },
                        ),
                      ),
            ),
            const SizedBox(height: AppSpacing.md),
            if (getHorariosFromDia().isNotEmpty)
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (var horario in getHorariosFromDia())
                    GestureDetector(
                      onTap: () => setState(() => selectedHour = horario),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                        decoration: BoxDecoration(
                          color: selectedHour == horario ? AppColors.primary : AppColors.surface(context),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: selectedHour == horario ? AppColors.primary : AppColors.border(context),
                          ),
                        ),
                        child: Text(
                          horario,
                          style: AppTypography.body(context).copyWith(
                            color: selectedHour == horario ? Colors.white : AppColors.textSecondary(context),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            const SizedBox(height: AppSpacing.xl),
            _section(getText('lb_convidados')),
            AppInput(
              label: getText('lb_convidados'),
              controller: txtConvidados,
              prefixIcon: PhosphorIcons.users,
              keyboard: TextInputType.number,
              formatters: [FilteringTextInputFormatter.digitsOnly],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              capacidade > 0
                  ? getText('convidados_dica_capacidade').replaceAll('%CAP%', capacidade.toString())
                  : getText('capacidade_indeterminada'),
              style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
            ),
            if (hasRegras) ...[
              const SizedBox(height: AppSpacing.md),
              _section(getText('lb_regras_area')),
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.surface(context),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border(context)),
                ),
                constraints: const BoxConstraints(maxHeight: 220),
                child: SingleChildScrollView(
                  child: Text(
                    widget.obj['regras'].toString(),
                    style: AppTypography.body(context),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Row(
                children: [
                  Checkbox(
                    value: acceptTerms,
                    onChanged: isEdit ? null : (v) => setState(() => acceptTerms = v ?? false),
                    activeColor: AppColors.primary,
                  ),
                  Expanded(
                    child: Text(getText('lb_li_concordo'), style: AppTypography.body(context)),
                  ),
                ],
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            if (!isEdit)
              AppButton(
                label: getText('btn_save'),
                onPressed: _isSaving ? null : save,
                loading: _isSaving,
                icon: PhosphorIcons.floppyDisk,
              ),
            if (isEdit) ...[
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

class AreaSocialReservaModel {
  int? id;
  int? id_area_social;
  String? data;
  String? horaDe;
  String? horaAte;
  String? id_apartamento;
  int? convidados;

  AreaSocialReservaModel({
    this.id,
    this.id_area_social,
    this.data,
    this.horaDe,
    this.horaAte,
    this.id_apartamento,
    this.convidados,
  });

  Map toJson() => {
        'id': id, 'id_area_social': id_area_social, 'data': data,
        'horaDe': horaDe, 'horaAte': horaAte, 'id_apartamento': id_apartamento,
        'convidados': convidados,
      };
}
