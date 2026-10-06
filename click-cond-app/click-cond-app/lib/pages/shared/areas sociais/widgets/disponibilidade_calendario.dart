import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:table_calendar/table_calendar.dart';

const _mesesTitulo = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

// Índice = weekday - 1 (segunda primeiro), como DateTime.weekday.
const _diasCabecalho = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

DateTime _soData(DateTime d) => DateTime(d.year, d.month, d.day);

/// Calendário inline (pt-BR, semana começando no domingo) para escolher o dia
/// da reserva.
///
/// - Só os dias de [diasDisponiveis] ficam tocáveis e destacados; os demais
///   aparecem esmaecidos e não disparam [onSelecionar].
/// - A navegação de mês fica limitada entre o menor e o maior dia disponível.
/// - Conjunto vazio mostra o estado vazio "Nenhum dia disponível no momento".
///
/// As datas podem vir com hora (são normalizadas); [onSelecionar] recebe a
/// data sem hora, no fuso local.
class DisponibilidadeCalendario extends StatefulWidget {
  /// Dias com algum horário livre.
  final Set<DateTime> diasDisponiveis;

  /// Dia selecionado (destacado em `AppColors.primary`).
  final DateTime? selecionado;

  /// Toque em um dia disponível.
  final ValueChanged<DateTime> onSelecionar;

  const DisponibilidadeCalendario({
    super.key,
    required this.diasDisponiveis,
    this.selecionado,
    required this.onSelecionar,
  });

  @override
  State<DisponibilidadeCalendario> createState() => _DisponibilidadeCalendarioState();
}

class _DisponibilidadeCalendarioState extends State<DisponibilidadeCalendario> {
  late Set<DateTime> _dias;
  DateTime? _primeiro;
  DateTime? _ultimo;
  late DateTime _foco;

  @override
  void initState() {
    super.initState();
    // O TableCalendar formata com locale; sem os dados do pt_BR carregados o
    // DateFormat lança. A carga é síncrona para os dados locais do intl.
    initializeDateFormatting('pt_BR');
    _recalcular(manterFoco: false);
  }

  @override
  void didUpdateWidget(covariant DisponibilidadeCalendario oldWidget) {
    super.didUpdateWidget(oldWidget);
    final mudouSelecao = widget.selecionado != null &&
        (oldWidget.selecionado == null || !isSameDay(oldWidget.selecionado, widget.selecionado));
    _recalcular(manterFoco: !mudouSelecao);
  }

  void _recalcular({required bool manterFoco}) {
    _dias = widget.diasDisponiveis.map(_soData).toSet();
    if (_dias.isEmpty) {
      _primeiro = null;
      _ultimo = null;
      _foco = _soData(DateTime.now());
      return;
    }
    final ordenados = _dias.toList()..sort();
    _primeiro = ordenados.first;
    _ultimo = ordenados.last;
    final sel = widget.selecionado == null ? null : _soData(widget.selecionado!);
    final base = manterFoco ? _foco : (sel ?? _primeiro!);
    _foco = _limitar(base);
  }

  DateTime _limitar(DateTime d) {
    if (d.isBefore(_primeiro!)) return _primeiro!;
    if (d.isAfter(_ultimo!)) return _ultimo!;
    return d;
  }

  bool _disponivel(DateTime d) => _dias.contains(_soData(d));

  bool _mesmoMes(DateTime a, DateTime b) => a.year == b.year && a.month == b.month;

  @override
  Widget build(BuildContext context) {
    if (_dias.isEmpty) return const _EstadoVazio();

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final chevronAtivo = AppColors.textPrimary(context);

    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.sm, AppSpacing.xs, AppSpacing.sm, AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TableCalendar(
            locale: 'pt_BR',
            firstDay: _primeiro!,
            lastDay: _ultimo!,
            focusedDay: _foco,
            startingDayOfWeek: StartingDayOfWeek.sunday,
            availableCalendarFormats: const {CalendarFormat.month: ''},
            availableGestures: AvailableGestures.horizontalSwipe,
            rowHeight: 48,
            daysOfWeekHeight: 28,
            enabledDayPredicate: _disponivel,
            selectedDayPredicate: (d) => widget.selecionado != null && isSameDay(d, widget.selecionado),
            onDaySelected: (dia, foco) {
              if (!_disponivel(dia)) return;
              setState(() => _foco = _limitar(_soData(foco)));
              widget.onSelecionar(_soData(dia));
            },
            onPageChanged: (foco) => setState(() => _foco = _limitar(_soData(foco))),
            headerStyle: HeaderStyle(
              formatButtonVisible: false,
              titleCentered: true,
              titleTextFormatter: (d, _) => '${_mesesTitulo[d.month - 1]} de ${d.year}',
              titleTextStyle: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
              headerPadding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
              leftChevronVisible: !_mesmoMes(_foco, _primeiro!),
              rightChevronVisible: !_mesmoMes(_foco, _ultimo!),
              leftChevronPadding: const EdgeInsets.all(AppSpacing.md),
              rightChevronPadding: const EdgeInsets.all(AppSpacing.md),
              leftChevronIcon: Icon(PhosphorIcons.caretLeft, size: 20, color: chevronAtivo),
              rightChevronIcon: Icon(PhosphorIcons.caretRight, size: 20, color: chevronAtivo),
            ),
            daysOfWeekStyle: DaysOfWeekStyle(
              dowTextFormatter: (d, _) => _diasCabecalho[d.weekday - 1],
              weekdayStyle: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
              weekendStyle: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context)),
            ),
            calendarStyle: const CalendarStyle(outsideDaysVisible: false),
            calendarBuilders: CalendarBuilders(
              defaultBuilder: (c, d, _) => _Dia(dia: d, disponivel: _disponivel(d), isDark: isDark),
              todayBuilder: (c, d, _) => _Dia(dia: d, disponivel: _disponivel(d), hoje: true, isDark: isDark),
              selectedBuilder: (c, d, _) => _Dia(dia: d, disponivel: true, selecionado: true, isDark: isDark),
              disabledBuilder: (c, d, _) => _Dia(dia: d, disponivel: false, isDark: isDark),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _Legenda(isDark: isDark),
        ],
      ),
    );
  }
}

class _Dia extends StatelessWidget {
  final DateTime dia;
  final bool disponivel;
  final bool selecionado;
  final bool hoje;
  final bool isDark;

  const _Dia({
    required this.dia,
    required this.disponivel,
    required this.isDark,
    this.selecionado = false,
    this.hoje = false,
  });

  @override
  Widget build(BuildContext context) {
    final Color fundo;
    final Color texto;
    Border? borda;

    if (selecionado) {
      fundo = AppColors.primary;
      texto = Colors.white;
    } else if (disponivel) {
      fundo = AppColors.primary.withValues(alpha: isDark ? 0.22 : 0.1);
      texto = isDark ? const Color(0xFF93B4F8) : AppColors.primaryDark;
    } else {
      fundo = Colors.transparent;
      texto = AppColors.textTertiary(context).withValues(alpha: isDark ? 0.8 : 0.7);
    }
    if (hoje && !selecionado) {
      borda = Border.all(color: AppColors.textSecondary(context).withValues(alpha: 0.6), width: 1.2);
    }

    return Center(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: fundo, shape: BoxShape.circle, border: borda),
        child: Text(
          '${dia.day}',
          style: AppTypography.captionMedium(context).copyWith(
            color: texto,
            fontWeight: selecionado || disponivel ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

class _Legenda extends StatelessWidget {
  final bool isDark;

  const _Legenda({required this.isDark});

  @override
  Widget build(BuildContext context) {
    Widget item(Color cor, String texto) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 12, height: 12, decoration: BoxDecoration(color: cor, shape: BoxShape.circle)),
            const SizedBox(width: 6),
            Text(texto, style: AppTypography.tiny(context).copyWith(color: AppColors.textSecondary(context))),
          ],
        );

    return Wrap(
      alignment: WrapAlignment.center,
      spacing: AppSpacing.lg,
      runSpacing: AppSpacing.xs,
      children: [
        item(AppColors.primary.withValues(alpha: isDark ? 0.35 : 0.18), 'Disponível'),
        item(AppColors.primary, 'Selecionado'),
      ],
    );
  }
}

class _EstadoVazio extends StatelessWidget {
  const _EstadoVazio();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xxxl),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(PhosphorIcons.calendarX, size: 40, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Nenhum dia disponível no momento',
            textAlign: TextAlign.center,
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }
}
