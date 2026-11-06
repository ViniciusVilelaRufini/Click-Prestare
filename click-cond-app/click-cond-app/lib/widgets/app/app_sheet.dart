import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// `.sheet`: folha inferior com o traço de arrastar. O fundo, a linha do topo e
/// o véu vêm de `bottomSheetTheme`.
Future<T?> showAppSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  bool isScrollControlled = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    builder: (c) => SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          12,
          16,
          16 + MediaQuery.viewInsetsOf(c).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 3,
                color: AppColors.borderStrong(c),
              ),
            ),
            const SizedBox(height: 16),
            Flexible(child: builder(c)),
          ],
        ),
      ),
    ),
  );
}

/// `.toast`: aviso curto, sólido `accent`. O estilo vem de `snackBarTheme`.
void showAppToast(BuildContext context, String message, {IconData? icon}) {
  final messenger = ScaffoldMessenger.of(context);
  final tinta = AppColors.onAccent(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      content: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18, color: tinta),
            const SizedBox(width: 10),
          ],
          Expanded(child: Text(message)),
        ],
      ),
    ),
  );
}
