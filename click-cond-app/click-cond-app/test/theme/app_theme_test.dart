import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_theme.dart';
import 'package:click/widgets/app/app_bottom_nav.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app(ThemeData tema, Widget filho) => MaterialApp(
      theme: tema,
      home: Scaffold(body: Center(child: filho)),
    );

Material _materialDe(WidgetTester tester, Finder dentro) => tester.widget<Material>(
      find.descendant(of: dentro, matching: find.byType(Material)).first,
    );

void main() {
  testWidgets('ThemeData sem azul, sem elevação e com cores do próprio brilho',
      (tester) async {
    final escuro = AppTheme.dark();
    final claro = AppTheme.light();

    expect(escuro.colorScheme.primary, AppColors.darkAccent);
    expect(escuro.colorScheme.onPrimary, AppColors.darkOnAccent);
    expect(escuro.scaffoldBackgroundColor, AppColors.darkBg);
    expect(claro.colorScheme.primary, AppColors.lightAccent);
    expect(claro.colorScheme.onPrimary, AppColors.lightOnAccent);
    expect(claro.scaffoldBackgroundColor, AppColors.lightBg);

    for (final t in [escuro, claro]) {
      expect(t.appBarTheme.elevation, 0);
      expect(t.appBarTheme.scrolledUnderElevation, 0);
      expect(t.cardTheme.elevation, 0);
      expect(t.dialogTheme.elevation, 0);
      expect(t.bottomSheetTheme.modalElevation, 0);
      expect(t.snackBarTheme.elevation, 0);
      expect(t.floatingActionButtonTheme.elevation, 0);
      expect(t.colorScheme.shadow, Colors.transparent);
    }
  });

  testWidgets('AppButton primário usa accent e on-accent, em caixa alta',
      (tester) async {
    await tester.pumpWidget(
      _app(AppTheme.dark(), AppButton(label: 'Salvar', onPressed: () {})),
    );
    expect(
      _materialDe(tester, find.byType(AppButton)).color,
      AppColors.darkAccent,
    );
    final texto = tester.widget<Text>(find.text('SALVAR'));
    expect(texto.style?.color, AppColors.darkOnAccent);
  });

  testWidgets('AppButton perigo não usa o sinal como fundo', (tester) async {
    await tester.pumpWidget(
      _app(
        AppTheme.dark(),
        AppButton(
          label: 'Excluir',
          onPressed: () {},
          variant: AppButtonVariant.danger,
        ),
      ),
    );
    expect(
      _materialDe(tester, find.byType(AppButton)).color,
      Colors.transparent,
    );
    expect(
      tester.widget<Text>(find.text('EXCLUIR')).style?.color,
      AppColors.darkSignalDanger,
    );
  });

  testWidgets('AppBottomNav dispara o toque e marca o item selecionado',
      (tester) async {
    var tocou = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          bottomNavigationBar: AppBottomNav(
            items: [
              AppNavItem(
                icon: Icons.home_outlined,
                label: 'Início',
                selected: true,
                onTap: () {},
              ),
              AppNavItem(
                icon: Icons.add,
                label: 'Novo',
                center: true,
                onTap: () => tocou++,
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.text('INÍCIO'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.add));
    expect(tocou, 1);
  });

  testWidgets('primitivas cabem em 320dp', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _app(
        AppTheme.dark(),
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AppCard(
              child: AppTag(label: 'Na portaria', signal: AppSignal.warn),
            ),
            AppList(
              children: [
                AppListItem(
                  leading: const AppIconBox(icon: Icons.mail_outline),
                  title: 'Um título bem longo que precisa de reticências aqui',
                  subtitle: 'Apoio',
                  onTap: () {},
                ),
                const AppListItem(
                  leading: AppAvatar(initials: 'vr'),
                  title: 'Sem toque',
                ),
              ],
            ),
            const AppKpiGrid(
              children: [
                AppKpi(label: 'Encomendas', value: '12'),
                AppKpi(label: 'Visitas', value: '3'),
                AppKpi(label: 'Ocorrências', value: '1'),
              ],
            ),
          ],
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('VR'), findsOneWidget);
    expect(find.text('NA PORTARIA'), findsOneWidget);
  });
}
