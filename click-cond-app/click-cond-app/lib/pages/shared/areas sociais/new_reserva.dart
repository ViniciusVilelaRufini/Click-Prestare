import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/rotulo_bloco.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'widgets/convidados_stepper.dart';
import 'widgets/disponibilidade_calendario.dart';
import 'widgets/horario_card.dart';
import 'widgets/reserva_helpers.dart';
import 'widgets/resumo_reserva.dart';

class NewReserva extends StatefulWidget {
  const NewReserva({super.key, required this.obj, this.objEditReserva});
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
    _scroll.dispose();
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

  // ---------------------------------------------------------------------------
  // Tela progressiva: calendário → horários do dia → convidados + regras →
  // resumo, com o botão de ação fixo no rodapé. Só a apresentação mudou; a
  // lógica de save()/delete()/load() e as validações acima são as mesmas.
  // ---------------------------------------------------------------------------

  final _scroll = ScrollController();
  final _chaveHorarios = GlobalKey();
  final _chaveConvidados = GlobalKey();

  static const _duracaoRevelar = Duration(milliseconds: 220);

  bool get _isEdit => widget.objEditReserva != null;

  /// Mesma checagem de horário do save().
  bool get _horarioValido =>
      selectedHour != null && selectedHour.toString().trim() != '-' && selectedHour.toString().contains(' - ');

  bool get _temDia => txtData.text.isNotEmpty;

  /// Botão habilitado só com dia, horário e (se houver regras) aceite.
  bool get _podeSalvar => _temDia && _horarioValido && (!hasRegras || acceptTerms);

  /// Área que exige autorização gera reserva "pendente" na API; sem
  /// autorização a reserva já entra aprovada.
  String get _rotuloAcao =>
      widget.obj['precisa_autorizacao']?.toString() == '1' ? 'Solicitar reserva' : 'Confirmar reserva';

  Set<DateTime> get _diasDisponiveis {
    final livres = widget.obj['horarios_livres'];
    if (livres is! Map) return {};
    return livres.keys.map((k) => convertStringToDateFormat(k.toString())).whereType<DateTime>().toSet();
  }

  void _selecionarDia(DateTime dia) {
    setState(() {
      selectedDay = dia;
      txtData.text = convertDateFormatToString(dia);
      // Horário que não existe no novo dia não pode continuar selecionado
      // (antes ele ficava "escondido" e ia no save).
      if (!getHorariosFromDia().contains(selectedHour)) selectedHour = ' - ';
    });
    _rolarAte(_chaveHorarios);
  }

  void _selecionarHorario(dynamic horario) {
    final primeiraVez = !_horarioValido;
    setState(() => selectedHour = horario);
    if (primeiraVez) _rolarAte(_chaveConvidados);
  }

  /// Traz a seção recém-revelada para a tela, sem esconder todo o contexto de
  /// cima (deixa ~1/4 da tela anterior visível) e só rolando para baixo.
  void _rolarAte(GlobalKey chave) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final ro = chave.currentContext?.findRenderObject();
      if (ro == null) return;
      final viewport = RenderAbstractViewport.maybeOf(ro);
      if (viewport == null) return;
      final pos = _scroll.position;
      final alvo = viewport.getOffsetToReveal(ro, 0.0).offset - pos.viewportDimension * 0.25;
      if (alvo <= pos.pixels + 24) return;
      _scroll.animateTo(
        alvo.clamp(pos.minScrollExtent, double.infinity),
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
      );
    });
  }

  void _escolherBloco() {
    if (listBlocos.isEmpty) {
      displayMessage(context, getText('alert_ops'), getText('alert_nenhum_bloco'));
      return;
    }
    bottomSheetAptos(context, listBlocos, txtBloco.text, (s) {
      if (txtBloco.text != s) txtApto.text = '';
      txtBloco.text = s;
      Navigator.of(context).pop();
      FocusManager.instance.primaryFocus?.unfocus();
    });
  }

  void _escolherApto() {
    if (getListAptos().isEmpty) {
      displayMessage(context, getText('alert_ops'), getText('visitante_erro_bloco'));
      return;
    }
    bottomSheetAptos(context, getListAptos(), txtApto.text, (s) {
      txtApto.text = s;
      Navigator.of(context).pop();
      FocusManager.instance.primaryFocus?.unfocus();
    });
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: _isEdit ? getText('area_social_nav_edit_reserva') : getText('area_social_nav_reservar'),
      body: Column(
        children: [
          Expanded(
            // Bloco/apto mudam pelos bottom sheets direto nos controllers.
            child: ListenableBuilder(
              listenable: Listenable.merge([txtBloco, txtApto]),
              builder: (context, _) => SingleChildScrollView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: _isEdit ? _conteudoEdicao() : _conteudoNovo(),
                ),
              ),
            ),
          ),
          _rodape(),
        ],
      ),
    );
  }

  List<Widget> _conteudoEdicao() => [
        _cabecalho(),
        const SizedBox(height: AppSpacing.xl),
        ResumoReserva(
          area: widget.obj['nome']?.toString() ?? '',
          data: txtData.text,
          horario: selectedHour.toString(),
          convidados: int.tryParse(txtConvidados.text.trim()),
          bloco: txtBloco.text,
          apto: txtApto.text,
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(PhosphorIcons.info, size: 18, color: AppColors.textSecondary(context)),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                'Para mudar o dia ou o horário, exclua esta reserva e faça uma nova.',
                style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
              ),
            ),
          ],
        ),
      ];

  List<Widget> _conteudoNovo() {
    final horarios = getHorariosFromDia();
    return [
      _cabecalho(),
      const SizedBox(height: AppSpacing.xl),
      _section('Escolha o dia'),
      DisponibilidadeCalendario(
        diasDisponiveis: _diasDisponiveis,
        selecionado: selectedDay,
        onSelecionar: _selecionarDia,
      ),
      _Revelar(
        key: _chaveHorarios,
        visivel: _temDia,
        child: Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _section('Escolha o horário'),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                layoutBuilder: _layoutTopo,
                child: KeyedSubtree(
                  key: ValueKey(txtData.text),
                  child: horarios.isEmpty ? _semHorarios() : _listaHorarios(horarios),
                ),
              ),
            ],
          ),
        ),
      ),
      _Revelar(
        key: _chaveConvidados,
        visivel: _temDia && _horarioValido,
        child: Padding(
          padding: const EdgeInsets.only(top: AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _section(getText('lb_convidados')),
              ConvidadosStepper(
                valor: int.tryParse(txtConvidados.text.trim()),
                capacidade: capacidade,
                habilitado: !_isSaving,
                onChanged: (v) => setState(() => txtConvidados.text = v?.toString() ?? ''),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                capacidade > 0
                    ? getText('convidados_dica_capacidade').replaceAll('%CAP%', capacidade.toString())
                    : getText('capacidade_indeterminada'),
                style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
              ),
              if (hasRegras) ...[
                const SizedBox(height: AppSpacing.xl),
                _section(getText('lb_regras_area')),
                _regras(),
              ],
              const SizedBox(height: AppSpacing.xl),
              ResumoReserva(
                area: widget.obj['nome']?.toString() ?? '',
                data: txtData.text,
                horario: selectedHour.toString(),
                convidados: int.tryParse(txtConvidados.text.trim()),
                bloco: txtBloco.text,
                apto: txtApto.text,
              ),
            ],
          ),
        ),
      ),
    ];
  }

  static Widget _layoutTopo(Widget? atual, List<Widget> anteriores) => Stack(
        alignment: Alignment.topCenter,
        children: [...anteriores, if (atual != null) atual],
      );

  Widget _listaHorarios(List<dynamic> horarios) {
    final cards = <Widget>[];
    for (final h in horarios) {
      final partes = separarHorario(h.toString());
      if (partes == null) continue;
      if (cards.isNotEmpty) cards.add(const SizedBox(height: AppSpacing.sm));
      cards.add(HorarioCard(
        de: partes.de,
        ate: partes.ate,
        selecionado: selectedHour == h,
        onTap: _isSaving ? null : () => _selecionarHorario(h),
      ));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: cards);
  }

  Widget _semHorarios() => Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: AppRadius.rlg,
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Row(
          children: [
            Icon(PhosphorIcons.calendarX, size: 24, color: AppColors.textSecondary(context)),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Nenhum horário livre neste dia', style: AppTypography.bodyMedium(context)),
                  Text(
                    'Escolha outro dia no calendário.',
                    style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _regras() => Container(
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: AppRadius.rlg,
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Text(widget.obj['regras'].toString(), style: AppTypography.body(context)),
              ),
            ),
            Divider(height: 1, color: AppColors.border(context)),
            Material(
              type: MaterialType.transparency,
              child: InkWell(
                onTap: _isSaving ? null : () => setState(() => acceptTerms = !acceptTerms),
                borderRadius: BorderRadius.vertical(bottom: Radius.circular(AppRadius.lg)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs, vertical: AppSpacing.xs),
                  child: Row(
                    children: [
                      Checkbox(
                        value: acceptTerms,
                        onChanged: _isSaving ? null : (v) => setState(() => acceptTerms = v ?? false),
                        activeColor: AppColors.primary,
                      ),
                      Expanded(child: Text(getText('lb_li_concordo'), style: AppTypography.body(context))),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      );

  Widget _cabecalho() {
    final morador = getUserType() == 'morador';
    final selecionavel = !_isEdit && !morador;
    final bloco = rotuloBloco(txtBloco.text);
    final apto = txtApto.text.trim();

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: AppRadius.rmd,
                ),
                child: const Icon(PhosphorIcons.mapPin, color: AppColors.primary, size: 22),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.obj['nome']?.toString() ?? '',
                      style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      capacidade > 0 ? 'Até $capacidade pessoas' : getText('capacidade_indeterminada'),
                      style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (selecionavel)
            Row(
              children: [
                Expanded(
                  child: _ChipUnidade(
                    icone: PhosphorIcons.buildings,
                    texto: bloco.isEmpty ? 'Escolher bloco' : bloco,
                    vazio: bloco.isEmpty,
                    carregando: _isLoading,
                    onTap: _isLoading ? null : _escolherBloco,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _ChipUnidade(
                    icone: PhosphorIcons.door,
                    texto: apto.isEmpty ? 'Escolher apto' : 'Apto $apto',
                    vazio: apto.isEmpty,
                    carregando: _isLoading,
                    onTap: _isLoading ? null : _escolherApto,
                  ),
                ),
              ],
            )
          else
            Align(
              alignment: Alignment.centerLeft,
              child: _ChipUnidade(
                icone: PhosphorIcons.house,
                texto: [if (bloco.isNotEmpty) bloco, if (apto.isNotEmpty) 'Apto $apto'].join(' · '),
              ),
            ),
        ],
      ),
    );
  }

  /// Dica curta acima do botão explicando o que ainda falta.
  String? get _dicaPendente {
    if (_diasDisponiveis.isEmpty) return 'Não há dias disponíveis para reserva.';
    if (!_temDia) return 'Escolha um dia no calendário.';
    if (!_horarioValido) return 'Escolha um horário.';
    if (hasRegras && !acceptTerms) return 'Aceite as regras da área para continuar.';
    return null;
  }

  Widget _rodape() {
    final dica = _isEdit ? null : _dicaPendente;
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedSize(
            duration: _duracaoRevelar,
            curve: Curves.easeOutCubic,
            child: dica == null
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Text(
                      dica,
                      textAlign: TextAlign.center,
                      style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                    ),
                  ),
          ),
          if (_isEdit)
            AppButton(
              label: getText('btn_delete'),
              onPressed: _isSaving ? null : delete,
              loading: _isSaving,
              variant: AppButtonVariant.danger,
              icon: PhosphorIcons.trash,
            )
          else
            AppButton(
              label: _rotuloAcao,
              onPressed: _isSaving || !_podeSalvar ? null : save,
              loading: _isSaving,
              icon: PhosphorIcons.calendarCheck,
            ),
        ],
      ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}

/// Revela/oculta uma seção com fade + animação de altura.
class _Revelar extends StatelessWidget {
  final bool visivel;
  final Widget child;

  const _Revelar({super.key, required this.visivel, required this.child});

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: _NewReservaPageState._duracaoRevelar,
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: AnimatedSwitcher(
        duration: _NewReservaPageState._duracaoRevelar,
        layoutBuilder: _NewReservaPageState._layoutTopo,
        child: visivel
            ? KeyedSubtree(key: const ValueKey(true), child: child)
            : const SizedBox(key: ValueKey(false), width: double.infinity),
      ),
    );
  }
}

/// Chip de unidade (bloco/apto). Com [onTap] vira um seletor (48dp).
class _ChipUnidade extends StatelessWidget {
  final IconData icone;
  final String texto;
  final bool vazio;
  final bool carregando;
  final VoidCallback? onTap;

  const _ChipUnidade({
    required this.icone,
    required this.texto,
    this.vazio = false,
    this.carregando = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final selecionavel = onTap != null || carregando;
    final conteudo = Row(
      mainAxisSize: selecionavel ? MainAxisSize.max : MainAxisSize.min,
      children: [
        Icon(icone, size: 18, color: AppColors.textSecondary(context)),
        const SizedBox(width: AppSpacing.sm),
        Flexible(
          fit: selecionavel ? FlexFit.tight : FlexFit.loose,
          child: Text(
            texto,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.body(context).copyWith(
              fontWeight: FontWeight.w500,
              color: vazio ? AppColors.textSecondary(context) : AppColors.textPrimary(context),
            ),
          ),
        ),
        if (carregando) ...[
          const SizedBox(width: AppSpacing.xs),
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
        ] else if (onTap != null) ...[
          const SizedBox(width: AppSpacing.xs),
          Icon(PhosphorIcons.caretDown, size: 16, color: AppColors.textSecondary(context)),
        ],
      ],
    );

    return Semantics(
      button: onTap != null,
      child: Material(
        color: AppColors.surface(context),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.rmd,
          side: BorderSide(color: AppColors.border(context)),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.rmd,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: selecionavel ? 48 : 36),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
              child: Align(alignment: Alignment.centerLeft, widthFactor: 1, child: conteudo),
            ),
          ),
        ),
      ),
    );
  }
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
