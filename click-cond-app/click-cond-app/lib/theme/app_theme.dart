import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

/// Tokens de um tema, lidos das constantes e não dos getters de [AppColors]:
/// o `ThemeData` de cada brilho não pode depender do brilho em vigor.
class _Tokens {
  final Brightness brightness;
  final Color bg000, bg100, bg200, bg300, line100, line200;
  final Color ink, inkMuted, inkSubtle, accent, onAccent, ghost;
  final Color ok, warn, danger, scrim, brand;

  const _Tokens.dark()
      : brightness = Brightness.dark,
        bg000 = AppColors.darkBg,
        bg100 = AppColors.darkBg100,
        bg200 = AppColors.darkSurface,
        bg300 = AppColors.darkSurfaceElevated,
        line100 = AppColors.darkBorder,
        line200 = AppColors.darkBorderStrong,
        ink = AppColors.darkTextPrimary,
        inkMuted = AppColors.darkTextSecondary,
        inkSubtle = AppColors.darkTextTertiary,
        accent = AppColors.darkAccent,
        onAccent = AppColors.darkOnAccent,
        ghost = AppColors.darkAccentGhost,
        ok = AppColors.darkSignalOk,
        warn = AppColors.darkSignalWarn,
        danger = AppColors.darkSignalDanger,
        scrim = AppColors.darkScrim,
        brand = AppColors.darkBrand;

  const _Tokens.light()
      : brightness = Brightness.light,
        bg000 = AppColors.lightBg,
        bg100 = AppColors.lightBg100,
        bg200 = AppColors.lightSurface,
        bg300 = AppColors.lightSurfaceElevated,
        line100 = AppColors.lightBorder,
        line200 = AppColors.lightBorderStrong,
        ink = AppColors.lightTextPrimary,
        inkMuted = AppColors.lightTextSecondary,
        inkSubtle = AppColors.lightTextTertiary,
        accent = AppColors.lightAccent,
        onAccent = AppColors.lightOnAccent,
        ghost = AppColors.lightAccentGhost,
        ok = AppColors.lightSignalOk,
        warn = AppColors.lightSignalWarn,
        danger = AppColors.lightSignalDanger,
        scrim = AppColors.lightScrim,
        brand = AppColors.lightBrand;
}

/// Tema Prestare Dark: cantos retos, sem elevação nem sombra, primário sólido.
class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(ThemeData.light(), const _Tokens.light());

  static ThemeData dark() => _build(ThemeData.dark(), const _Tokens.dark());

  static TextStyle _display(
    double size,
    double line,
    double spacing,
    Color color, {
    FontWeight weight = FontWeight.w600,
  }) =>
      GoogleFonts.barlowCondensed(
        fontSize: size,
        height: line / size,
        letterSpacing: size * spacing,
        fontWeight: weight,
        color: color,
      );

  static TextStyle _sans(
    double size,
    double line,
    FontWeight weight,
    Color color,
  ) =>
      GoogleFonts.barlow(
        fontSize: size,
        height: line / size,
        fontWeight: weight,
        color: color,
      );

  static ThemeData _build(ThemeData base, _Tokens t) {
    const reto = RoundedRectangleBorder();
    final contorno = RoundedRectangleBorder(
      side: BorderSide(color: t.line100),
    );
    final contornoForte = RoundedRectangleBorder(
      side: BorderSide(color: t.line200),
    );
    final botaoTexto = _display(13, 16, 0.2, t.ink);

    OutlineInputBorder campo(Color cor) => OutlineInputBorder(
          borderRadius: BorderRadius.zero,
          borderSide: BorderSide(color: cor),
        );

    final colorScheme = ColorScheme(
      brightness: t.brightness,
      primary: t.accent,
      onPrimary: t.onAccent,
      primaryContainer: t.bg300,
      onPrimaryContainer: t.ink,
      secondary: t.accent,
      onSecondary: t.onAccent,
      secondaryContainer: t.bg300,
      onSecondaryContainer: t.ink,
      tertiary: t.accent,
      onTertiary: t.onAccent,
      error: t.danger,
      onError: t.onAccent,
      surface: t.bg200,
      onSurface: t.ink,
      onSurfaceVariant: t.inkMuted,
      surfaceContainerLowest: t.bg000,
      surfaceContainerLow: t.bg100,
      surfaceContainer: t.bg200,
      surfaceContainerHigh: t.bg200,
      surfaceContainerHighest: t.bg300,
      surfaceTint: Colors.transparent,
      outline: t.line200,
      outlineVariant: t.line100,
      shadow: Colors.transparent,
      scrim: t.scrim,
      inverseSurface: t.accent,
      onInverseSurface: t.onAccent,
      inversePrimary: t.onAccent,
    );

    final conteudo = GoogleFonts.barlowTextTheme(base.textTheme).apply(
      bodyColor: t.ink,
      displayColor: t.ink,
    );
    TextStyle? estrutura(TextStyle? s) => s == null
        ? null
        : GoogleFonts.barlowCondensed(textStyle: s, fontWeight: FontWeight.w600);
    final textTheme = conteudo.copyWith(
      displayLarge: estrutura(conteudo.displayLarge),
      displayMedium: estrutura(conteudo.displayMedium),
      displaySmall: estrutura(conteudo.displaySmall),
      headlineLarge: estrutura(conteudo.headlineLarge),
      headlineMedium: estrutura(conteudo.headlineMedium),
      headlineSmall: estrutura(conteudo.headlineSmall),
      titleLarge: estrutura(conteudo.titleLarge),
    );

    final botaoCheio = ButtonStyle(
      elevation: const WidgetStatePropertyAll(0),
      shadowColor: const WidgetStatePropertyAll(Colors.transparent),
      surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
      shape: const WidgetStatePropertyAll(reto),
      minimumSize: const WidgetStatePropertyAll(Size(64, 48)),
      textStyle: WidgetStatePropertyAll(botaoTexto),
      backgroundColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.disabled) ? t.bg300 : t.brand,
      ),
      foregroundColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.disabled)
            ? t.inkSubtle
            : AppColors.onBrandColor,
      ),
      overlayColor:
          WidgetStatePropertyAll(AppColors.onBrandColor.withValues(alpha: 0.08)),
    );

    return base.copyWith(
      brightness: t.brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: t.bg000,
      canvasColor: t.bg000,
      primaryColor: t.accent,
      primaryColorDark: t.accent,
      primaryColorLight: t.accent,
      cardColor: t.bg200,
      dividerColor: t.line100,
      hintColor: t.inkSubtle,
      disabledColor: t.inkSubtle,
      unselectedWidgetColor: t.inkMuted,
      shadowColor: Colors.transparent,
      applyElevationOverlayColor: false,
      splashFactory: InkRipple.splashFactory,
      splashColor: t.ghost,
      highlightColor: t.ghost,
      hoverColor: t.ghost,
      focusColor: t.ghost,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      iconTheme: IconThemeData(color: t.inkMuted),
      primaryIconTheme: IconThemeData(color: t.ink),
      appBarTheme: AppBarTheme(
        backgroundColor: t.bg000,
        foregroundColor: t.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        centerTitle: true,
        systemOverlayStyle: t.brightness == Brightness.dark
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
        titleTextStyle: _display(22, 26, 0.1, t.ink),
        iconTheme: IconThemeData(color: t.ink, size: 20),
        actionsIconTheme: IconThemeData(color: t.ink, size: 20),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(style: botaoCheio),
      filledButtonTheme: FilledButtonThemeData(style: botaoCheio),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          elevation: const WidgetStatePropertyAll(0),
          shape: const WidgetStatePropertyAll(reto),
          minimumSize: const WidgetStatePropertyAll(Size(64, 48)),
          textStyle: WidgetStatePropertyAll(botaoTexto),
          side: WidgetStatePropertyAll(BorderSide(color: t.line200)),
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.disabled) ? t.inkSubtle : t.ink,
          ),
          overlayColor: WidgetStatePropertyAll(t.ghost),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          shape: const WidgetStatePropertyAll(reto),
          textStyle: WidgetStatePropertyAll(botaoTexto),
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.disabled) ? t.inkSubtle : t.ink,
          ),
          overlayColor: WidgetStatePropertyAll(t.ghost),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          shape: const WidgetStatePropertyAll(reto),
          overlayColor: WidgetStatePropertyAll(t.ghost),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: t.brand,
        foregroundColor: AppColors.onBrandColor,
        elevation: 0,
        focusElevation: 0,
        hoverElevation: 0,
        highlightElevation: 0,
        disabledElevation: 0,
        shape: reto,
        extendedTextStyle: botaoTexto,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: t.bg200,
        labelStyle: _sans(14, 20, FontWeight.w400, t.inkMuted),
        floatingLabelStyle: _display(11, 14, 0.2, t.inkSubtle),
        hintStyle: _sans(14, 20, FontWeight.w400, t.inkSubtle),
        helperStyle: _sans(12, 16, FontWeight.w400, t.inkSubtle),
        errorStyle: _sans(12, 16, FontWeight.w400, t.danger),
        prefixIconColor: t.inkSubtle,
        suffixIconColor: t.inkSubtle,
        border: campo(t.line100),
        enabledBorder: campo(t.line100),
        disabledBorder: campo(t.line100),
        focusedBorder: campo(t.ink),
        errorBorder: campo(t.danger),
        focusedErrorBorder: campo(t.danger),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: t.ink,
        selectionHandleColor: t.ink,
        selectionColor: t.ink.withValues(alpha: 0.2),
      ),
      cardTheme: CardThemeData(
        color: t.bg200,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: contorno,
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: t.ink,
        unselectedLabelColor: t.inkSubtle,
        labelStyle: _display(11, 14, 0.18, t.ink),
        unselectedLabelStyle: _display(11, 14, 0.18, t.inkSubtle),
        indicator: UnderlineTabIndicator(
          borderSide: BorderSide(color: t.brand, width: 2),
        ),
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: t.line100,
        overlayColor: WidgetStatePropertyAll(t.ghost),
        splashBorderRadius: BorderRadius.zero,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: t.bg100,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: contornoForte,
        barrierColor: t.scrim,
        titleTextStyle: _display(22, 26, 0.1, t.ink),
        contentTextStyle: _sans(14, 20, FontWeight.w400, t.inkMuted),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: t.bg100,
        modalBackgroundColor: t.bg100,
        modalBarrierColor: t.scrim,
        elevation: 0,
        modalElevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        dragHandleColor: t.line200,
        dragHandleSize: const Size(40, 3),
        shape: Border(top: BorderSide(color: t.line200)),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: t.brand,
        actionTextColor: AppColors.onBrandColor,
        closeIconColor: AppColors.onBrandColor,
        contentTextStyle:
            _sans(14, 20, FontWeight.w500, AppColors.onBrandColor),
        elevation: 0,
        shape: reto,
        behavior: SnackBarBehavior.floating,
      ),
      dividerTheme: DividerThemeData(color: t.line100, thickness: 1, space: 1),
      listTileTheme: ListTileThemeData(
        iconColor: t.ink,
        textColor: t.ink,
        titleTextStyle: _sans(16, 22, FontWeight.w500, t.ink),
        subtitleTextStyle: _sans(14, 20, FontWeight.w400, t.inkMuted),
        shape: reto,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: Colors.transparent,
        selectedColor: t.brand,
        disabledColor: t.bg300,
        checkmarkColor: AppColors.onBrandColor,
        labelStyle: _display(11, 14, 0.16, t.inkMuted),
        secondaryLabelStyle:
            _display(11, 14, 0.16, AppColors.onBrandColor),
        side: BorderSide(color: t.line200),
        shape: reto,
        elevation: 0,
        pressElevation: 0,
        shadowColor: Colors.transparent,
        selectedShadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
      ),
      checkboxTheme: CheckboxThemeData(
        shape: reto,
        checkColor: WidgetStatePropertyAll(t.onAccent),
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? t.accent : Colors.transparent,
        ),
        side: BorderSide(color: t.line200),
        overlayColor: WidgetStatePropertyAll(t.ghost),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? t.accent : t.line200,
        ),
        overlayColor: WidgetStatePropertyAll(t.ghost),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? t.onAccent : t.inkSubtle,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? t.accent : t.bg300,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? t.accent : t.line200,
        ),
        overlayColor: WidgetStatePropertyAll(t.ghost),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: t.accent,
        linearTrackColor: t.bg300,
        circularTrackColor: Colors.transparent,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: t.bg100,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: contornoForte,
        textStyle: _sans(14, 20, FontWeight.w400, t.ink),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(color: t.accent),
        textStyle: _sans(12, 16, FontWeight.w400, t.onAccent),
      ),
      badgeTheme: BadgeThemeData(
        backgroundColor: t.danger,
        textColor: t.onAccent,
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: t.bg100,
        elevation: 0,
        type: BottomNavigationBarType.fixed,
        selectedItemColor: t.ink,
        unselectedItemColor: t.inkSubtle,
        selectedLabelStyle: _display(10, 12, 0.16, t.ink),
        unselectedLabelStyle: _display(10, 12, 0.16, t.inkSubtle),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: t.bg100,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        indicatorColor: Colors.transparent,
        labelTextStyle: WidgetStatePropertyAll(_display(10, 12, 0.16, t.ink)),
      ),
      datePickerTheme: DatePickerThemeData(
        backgroundColor: t.bg100,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: contornoForte,
        headerBackgroundColor: t.bg100,
        headerForegroundColor: t.ink,
        dividerColor: t.line100,
        dayShape: const WidgetStatePropertyAll(reto),
      ),
      timePickerTheme: TimePickerThemeData(
        backgroundColor: t.bg100,
        elevation: 0,
        shape: contornoForte,
        hourMinuteShape: reto,
        dayPeriodShape: reto,
      ),
    );
  }
}
