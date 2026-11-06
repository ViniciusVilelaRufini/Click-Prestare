import 'package:click/main.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Só lê o getter: não depende do Theme nem de nada que o reconstrua sozinho.
class _Amostra extends StatelessWidget {
  const _Amostra();

  @override
  Widget build(BuildContext context) => ColoredBox(color: AppColors.primary);
}

class _Raiz extends StatelessWidget {
  const _Raiz();

  @override
  Widget build(BuildContext context) => const _Amostra();
}

void main() {
  tearDown(() => ThemeController.instance.debugSetMode(ThemeMode.system));

  testWidgets('widget const com cor pelo getter troca com reconstruirArvore',
      (tester) async {
    Color cor() => tester.widget<ColoredBox>(find.byType(ColoredBox)).color;

    ThemeController.instance.debugSetMode(ThemeMode.dark);
    await tester.pumpWidget(const _Raiz());
    expect(cor(), AppColors.darkAccent);

    // Sem a reconstrução, o widget const fica com a cor antiga.
    ThemeController.instance.debugSetMode(ThemeMode.light);
    await tester.pump();
    expect(cor(), AppColors.darkAccent);

    reconstruirArvore(tester.element(find.byType(_Raiz)));
    await tester.pump();
    expect(cor(), AppColors.lightAccent);

    ThemeController.instance.debugSetMode(ThemeMode.dark);
    reconstruirArvore(tester.element(find.byType(_Raiz)));
    await tester.pump();
    expect(cor(), AppColors.darkAccent);
  });
}
