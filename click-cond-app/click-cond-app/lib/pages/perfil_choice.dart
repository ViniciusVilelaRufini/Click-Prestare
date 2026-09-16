import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/pages/sindico/login.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/grid_background.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:google_fonts/google_fonts.dart';

import '../utils/local_storage.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  _HomePageState createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String _appVersion = "";
  bool _didAutoLogin = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final results = await Future.wait([
      getAppVersion(),
      _requestCameraPermission(),
    ]);
    if (!mounted) return;
    setState(() => _appVersion = results[0] as String);
    _verifyUserLogin();
  }

  Future<void> _requestCameraPermission() async {
    if (kIsWeb) return; // permission_handler não funciona no Web
    try {
      if (!await Permission.camera.isGranted) {
        await Permission.camera.request();
      }
    } catch (_) {}
  }

  void _verifyUserLogin() {
    if (_didAutoLogin) return;
    final token = getToken();
    if (token.isNotEmpty) {
      _didAutoLogin = true;
      Navigator.pushReplacement(
        context,
        // Passa pela PortaDeEntrada, não direto: é ela que decide entre a
        // tela de aceite de privacidade e o app. Os dois caminhos de entrada
        // (login e auto-login) precisam do mesmo gate.
        MaterialPageRoute(builder: (_) => const PortaDeEntrada()),
      );
    }
  }

  void _abrirLogin(String tipo) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => LoginSindico(loginType: tipo)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.bg(context),
        body: Stack(
          children: [
            // Fundo: no claro é branco puro no topo (a marca respira sobre ele)
            // e esfria para um azul bem lavado na base.
            Positioned.fill(
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: isDark
                        ? [const Color(0xFF0A1628), const Color(0xFF04060A)]
                        : [const Color(0xFFFFFFFF), const Color(0xFFEEF4FD)],
                  ),
                ),
              ),
            ),
            if (isDark)
              Positioned(
                top: -200,
                left: -140,
                child: Container(
                  width: 420,
                  height: 420,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        AppColors.primary.withValues(alpha: 0.18),
                        AppColors.primary.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
              ),
            Positioned.fill(
              child: const GridBackground(),
            ),
            Positioned.fill(
              child: SafeArea(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      child: ConstrainedBox(
                        constraints:
                            BoxConstraints(minHeight: constraints.maxHeight),
                        child: IntrinsicHeight(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: AppSpacing.xxl),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                const SizedBox(height: AppSpacing.sm),

                                // Topo enxuto: só o controle de tema. A marca
                                // agora é o herói da tela, não um item de barra.
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: _buildThemeToggle(context),
                                ),

                                const Spacer(flex: 2),

                                _buildBrandBlock(context),

                                const SizedBox(height: AppSpacing.xxxl),

                                _buildSectionLabel(context),
                                const SizedBox(height: AppSpacing.md),

                                _PerfilCard(
                                  icon: PhosphorIcons.shieldCheckBold,
                                  titulo: 'Síndico',
                                  descricao: 'Gestão completa do condomínio',
                                  destaque: true,
                                  onTap: () => _abrirLogin('sindico'),
                                ),
                                const SizedBox(height: AppSpacing.md),
                                _PerfilCard(
                                  icon: PhosphorIcons.houseFill,
                                  titulo: 'Morador',
                                  descricao: 'Visitas, encomendas e reservas',
                                  onTap: () => _abrirLogin('morador'),
                                ),
                                const SizedBox(height: AppSpacing.md),
                                _PerfilCard(
                                  icon: PhosphorIcons.identificationCard,
                                  titulo: 'Funcionário',
                                  descricao: 'Portaria, ocorrências e rotinas',
                                  onTap: () => _abrirLogin('funcionario'),
                                ),

                                const Spacer(flex: 3),

                                const SizedBox(height: AppSpacing.lg),
                                _buildFooter(context),
                                const SizedBox(height: AppSpacing.lg),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Marca: a logo em um cartão branco arredondado, o nome novo logo abaixo
  /// e a linha do que o app entrega.
  Widget _buildBrandBlock(BuildContext context) {
    return Column(
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(30),
              border: Border.all(
                color: AppColors.primary.withValues(alpha: 0.08),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.18),
                  blurRadius: 28,
                  spreadRadius: -4,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.xl),
              child: Image.asset(
                'assets/images/logo_prestare_gestao.png',
                width: 92,
                height: 92,
                fit: BoxFit.cover,
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: 'PRESTARE ',
                style: GoogleFonts.poppins(
                  fontWeight: FontWeight.w800,
                  fontSize: 26,
                  color: AppColors.textPrimary(context),
                  letterSpacing: 1.0,
                ),
              ),
              TextSpan(
                text: 'GESTÃO',
                style: GoogleFonts.poppins(
                  fontWeight: FontWeight.w800,
                  fontSize: 26,
                  color: AppColors.primary,
                  letterSpacing: 1.0,
                ),
              ),
            ],
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Todo o condomínio na palma da mão',
          style: AppTypography.caption(context),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.lg),
        _buildTrustRow(context),
      ],
    );
  }

  /// Linha fina de capacidades — substitui os quatro cartões de feature que
  /// competiam com os botões de perfil.
  Widget _buildTrustRow(BuildContext context) {
    Widget item(IconData icon, String label) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.primary),
          const SizedBox(width: 5),
          Text(
            label,
            style: AppTypography.tiny(context).copyWith(
              color: AppColors.textSecondary(context),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    Widget dot() => Container(
          width: 3,
          height: 3,
          margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.textTertiary(context),
            shape: BoxShape.circle,
          ),
        );

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        item(PhosphorIcons.lockKeyOpen, 'Acesso'),
        dot(),
        item(PhosphorIcons.package, 'Encomendas'),
        dot(),
        item(PhosphorIcons.chartPieSlice, 'Relatórios'),
      ],
    );
  }

  Widget _buildSectionLabel(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Divider(color: AppColors.border(context), thickness: 1),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: Text(
            'ENTRAR COMO',
            style: AppTypography.tiny(context).copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: AppColors.textTertiary(context),
            ),
          ),
        ),
        Expanded(
          child: Divider(color: AppColors.border(context), thickness: 1),
        ),
      ],
    );
  }

  Widget _buildFooter(BuildContext context) {
    return Column(
      children: [
        Text(
          '${getText("vesaoApp")} $_appVersion',
          style: AppTypography.tiny(context).copyWith(
            color: AppColors.textTertiary(context),
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          '© 2026 Prestare Gestão e Tecnologia.\nTodos os direitos reservados.',
          style: AppTypography.tiny(context).copyWith(
            color: AppColors.textTertiary(context),
            height: 1.4,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildThemeToggle(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.full),
      child: Material(
        color: AppColors.surfaceElevated(context),
        child: InkWell(
          onTap: () {
            final isDark = Theme.of(context).brightness == Brightness.dark;
            ThemeController.instance.setMode(
              isDark ? ThemeMode.light : ThemeMode.dark,
            );
          },
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              border: Border.all(
                color: AppColors.border(context),
                width: 1.2,
              ),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Theme.of(context).brightness == Brightness.dark
                  ? PhosphorIcons.sun
                  : PhosphorIcons.moon,
              color: AppColors.textPrimary(context),
              size: 20,
            ),
          ),
        ),
      ),
    );
  }
}

/// Cartão de escolha de perfil. O `destaque` pinta o cartão com o gradiente
/// primário — é o caminho principal (síndico), os outros ficam em superfície.
class _PerfilCard extends StatelessWidget {
  const _PerfilCard({
    required this.icon,
    required this.titulo,
    required this.descricao,
    required this.onTap,
    this.destaque = false,
  });

  final IconData icon;
  final String titulo;
  final String descricao;
  final VoidCallback onTap;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final corTitulo =
        destaque ? Colors.white : AppColors.textPrimary(context);
    final corDescricao = destaque
        ? Colors.white.withValues(alpha: 0.82)
        : AppColors.textSecondary(context);

    final raio = BorderRadius.circular(AppRadius.xl);

    // A decoração fica no Container, não num `Ink`: dentro de um Material
    // transparente o `Ink` pinta na camada de tinta do Material e vaza um
    // retângulo claro para fora dos cantos arredondados.
    return Container(
      decoration: BoxDecoration(
        color: destaque ? null : AppColors.surfaceElevated(context),
        gradient: destaque
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primaryGradientStart,
                  AppColors.primaryGradientEnd,
                ],
              )
            : null,
        borderRadius: raio,
        border: destaque
            ? null
            : Border.all(color: AppColors.border(context), width: 1.2),
        boxShadow: destaque
            ? [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.22),
                  blurRadius: 18,
                  spreadRadius: -2,
                  offset: const Offset(0, 6),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: raio,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: raio,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.lg,
            ),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: destaque
                        ? Colors.white.withValues(alpha: 0.18)
                        : AppColors.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Icon(
                    icon,
                    size: 22,
                    color: destaque ? Colors.white : AppColors.primary,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        titulo,
                        style: GoogleFonts.poppins(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          color: corTitulo,
                          height: 1.2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        descricao,
                        style: GoogleFonts.poppins(
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                          color: corDescricao,
                          height: 1.35,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Icon(
                  PhosphorIcons.caretRightBold,
                  size: 16,
                  color: destaque
                      ? Colors.white
                      : AppColors.textTertiary(context),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

