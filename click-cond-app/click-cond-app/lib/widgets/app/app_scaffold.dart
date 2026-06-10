import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Scaffold padrão do app com AppBar moderna e fundo correto por tema.
class AppScaffold extends StatelessWidget {
  final String? title;
  final Widget body;
  final List<Widget>? actions;
  final Widget? floatingActionButton;
  final bool showBackButton;
  final VoidCallback? onBack;
  final Widget? bottomNavigationBar;
  final Color? backgroundColor;
  final bool extendBodyBehindAppBar;
  final bool safeAreaBottom;

  const AppScaffold({
    Key? key,
    this.title,
    required this.body,
    this.actions,
    this.floatingActionButton,
    this.showBackButton = true,
    this.onBack,
    this.bottomNavigationBar,
    this.backgroundColor,
    this.extendBodyBehindAppBar = false,
    this.safeAreaBottom = true,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: backgroundColor ?? AppColors.bg(context),
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      appBar: title == null && !showBackButton
          ? null
          : AppBar(
              title: title != null
                  ? FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(title!, style: AppTypography.headline(context)),
                    )
                  : null,
              leading: showBackButton && Navigator.canPop(context)
                  ? IconButton(
                      icon: Icon(
                        PhosphorIcons.caretLeft,
                        color: AppColors.textPrimary(context),
                      ),
                      onPressed: onBack ?? () => Navigator.pop(context),
                    )
                  : null,
              automaticallyImplyLeading: false,
              actions: actions,
            ),
      body: SafeArea(
        bottom: safeAreaBottom,
        child: body,
      ),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottomNavigationBar,
    );
  }
}
