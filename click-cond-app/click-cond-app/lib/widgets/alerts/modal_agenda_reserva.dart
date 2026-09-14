import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:table_calendar/table_calendar.dart';

class ModalAgendaReserva extends StatefulWidget {
  const ModalAgendaReserva({
    super.key,
    required this.onPressed,
    this.selected,
    required this.allowedDays,
  });

  final Function(DateTime) onPressed;
  final DateTime? selected;
  final Map allowedDays;

  @override
  _ModalAgendaReservaState createState() => _ModalAgendaReservaState();
}

class _ModalAgendaReservaState extends State<ModalAgendaReserva> {
  late DateTime _focusedDay;
  DateTime? _selectedDay;

  @override
  void initState() {
    super.initState();
    initializeDateFormatting();
    _focusedDay = widget.selected ?? DateTime.now();
    _selectedDay = widget.selected;
  }

  bool _isAllowed(DateTime item) {
    final date = DateTime(item.year, item.month, item.day);
    return widget.allowedDays.containsKey(date);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.surfaceElevated(context),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border(context)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.25),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Selecione uma data',
                style: AppTypography.headline(context),
              ),
              const SizedBox(height: AppSpacing.md),
              TableCalendar(
                firstDay: DateTime.now().subtract(const Duration(days: 1)),
                lastDay: DateTime.utc(2100, 12, 31),
                focusedDay: _focusedDay,
                locale: 'pt_BR',
                availableCalendarFormats: const {CalendarFormat.month: ''},
                startingDayOfWeek: StartingDayOfWeek.sunday,
                selectedDayPredicate: (day) =>
                    _selectedDay != null && isSameDay(day, _selectedDay!),
                onDaySelected: (selectedDay, focusedDay) {
                  if (!_isAllowed(selectedDay)) return;
                  setState(() {
                    _selectedDay = selectedDay;
                    _focusedDay = focusedDay;
                  });
                  widget.onPressed(selectedDay);
                },
                onPageChanged: (focusedDay) {
                  setState(() => _focusedDay = focusedDay);
                },
                headerStyle: HeaderStyle(
                  formatButtonVisible: false,
                  titleCentered: true,
                  titleTextStyle: AppTypography.bodyMedium(context).copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  leftChevronIcon: Icon(
                    Icons.chevron_left,
                    color: AppColors.textPrimary(context),
                  ),
                  rightChevronIcon: Icon(
                    Icons.chevron_right,
                    color: AppColors.textPrimary(context),
                  ),
                ),
                daysOfWeekStyle: DaysOfWeekStyle(
                  weekdayStyle: AppTypography.caption(context).copyWith(
                    color: AppColors.textSecondary(context),
                    fontWeight: FontWeight.w600,
                  ),
                  weekendStyle: AppTypography.caption(context).copyWith(
                    color: AppColors.textSecondary(context),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                calendarStyle: const CalendarStyle(
                  outsideDaysVisible: false,
                ),
                calendarBuilders: CalendarBuilders(
                  defaultBuilder: (context, day, _) =>
                      _buildDay(context, day, isToday: false),
                  todayBuilder: (context, day, _) =>
                      _buildDay(context, day, isToday: true),
                  selectedBuilder: (context, day, _) =>
                      _buildDay(context, day, isSelected: true),
                  disabledBuilder: (context, day, _) => _buildDay(
                    context,
                    day,
                    disabled: true,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    'Cancelar',
                    style: AppTypography.body(context).copyWith(
                      color: AppColors.textSecondary(context),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDay(
    BuildContext context,
    DateTime day, {
    bool isToday = false,
    bool isSelected = false,
    bool disabled = false,
  }) {
    final allowed = _isAllowed(day);
    final Color bg;
    final Color fg;
    Border? border;

    if (isSelected) {
      bg = AppColors.primary;
      fg = Colors.white;
    } else if (allowed) {
      bg = AppColors.primary.withValues(alpha: 0.15);
      fg = AppColors.primary;
      border = Border.all(color: AppColors.primary.withValues(alpha: 0.35));
    } else {
      bg = Colors.transparent;
      fg = AppColors.textTertiary(context);
    }

    return Container(
      margin: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: isToday && !isSelected
            ? Border.all(color: AppColors.primary, width: 1.5)
            : border,
      ),
      alignment: Alignment.center,
      child: Text(
        '${day.day}',
        style: AppTypography.body(context).copyWith(
          color: fg,
          fontWeight: isSelected || allowed ? FontWeight.w600 : FontWeight.w400,
        ),
      ),
    );
  }
}
