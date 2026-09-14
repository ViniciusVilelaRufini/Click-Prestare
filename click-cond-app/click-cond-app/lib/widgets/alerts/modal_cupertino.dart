import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class ModalCupertino extends StatefulWidget {
  final String type;
  final Function(String) onPressed;
  final DateTime? initialDate;
  final DateTime? minimumDate;

  const ModalCupertino({
    super.key,
    required this.onPressed,
    required this.initialDate,
    required this.type,
    this.minimumDate,
  });

  @override
  _ModalCupertinoState createState() => _ModalCupertinoState();
}

class _ModalCupertinoState extends State<ModalCupertino> {
  var date = "";

  @override
  void initState() {
    super.initState();
    final base = widget.initialDate ?? DateTime.now();
    date = _format(base);
  }

  String _format(DateTime d) {
    if (widget.type == "datetime") return convertDateTimeToString(d);
    if (widget.type == "date") return convertDateFormatToString(d);
    return convertTimeFormatToString(d);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = AppColors.surfaceElevated(context);
    final textColor = AppColors.textPrimary(context);

    return SafeArea(
      top: false,
      child: Container(
        decoration: BoxDecoration(
          color: bg,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(top: BorderSide(color: AppColors.border(context))),
        ),
        padding: const EdgeInsets.only(top: AppSpacing.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.textTertiary(context),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(
                      'Cancelar',
                      style: AppTypography.body(context).copyWith(
                        color: AppColors.textSecondary(context),
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () {
                      widget.onPressed(date);
                      Navigator.of(context).pop();
                    },
                    child: Text(
                      'Pronto',
                      style: AppTypography.bodyMedium(context).copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Divider(
              color: AppColors.border(context),
              height: 1,
            ),
            SizedBox(
              height: 260,
              child: CupertinoTheme(
                data: CupertinoThemeData(
                  brightness: isDark ? Brightness.dark : Brightness.light,
                  textTheme: CupertinoTextThemeData(
                    dateTimePickerTextStyle: TextStyle(
                      fontSize: 18,
                      color: textColor,
                    ),
                  ),
                ),
                child: CupertinoDatePicker(
                  initialDateTime: widget.initialDate ?? DateTime.now(),
                  use24hFormat: true,
                  minimumDate: widget.minimumDate ?? widget.initialDate,
                  mode: widget.type == "datetime"
                      ? CupertinoDatePickerMode.dateAndTime
                      : widget.type == "date"
                          ? CupertinoDatePickerMode.date
                          : CupertinoDatePickerMode.time,
                  onDateTimeChanged: (DateTime newDateTime) {
                    date = _format(newDateTime);
                  },
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
  }
}
