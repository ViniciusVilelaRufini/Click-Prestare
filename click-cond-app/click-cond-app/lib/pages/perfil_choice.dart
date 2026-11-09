import 'package:click/widgets/app/prestare_logo.dart';
import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/pages/sindico/login.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/powered_by_aws.dart';
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
    // Notificação em sequência, depois da câmera. O Firebase pede a mesma
    // permissão no init, em paralelo com este pedido; o Android só atende um
    // diálogo por vez e o outro some — instalação nova ficava sem push
    // (POST_NOTIFICATIONS negado) sem o morador nunca ter visto a pergunta.
    try {
      if (!await Permission.notification.isGranted) {
        await Permission.notification.request();
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
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.bg(context),
        body: Stack(
          children: [
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 420,
              child: _GradeDeFundo(),
            ),
            SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                physics: const ClampingScrollPhysics(),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: IntrinsicHeight(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // Topo: só o controle de tema (`.head` + `.iconbtn`).
                          SizedBox(
                            height: 56,
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: _buildThemeToggle(context),
                            ),
                          ),
                          Expanded(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _buildBrandBlock(context),
                                const SizedBox(height: 48),
                                Text(
                                  'ENTRAR COMO',
                                  style: _rotulo(context),
                                ),
                                const SizedBox(height: 12),
                                _buildPerfis(context),
                              ],
                            ),
                          ),
                          const SizedBox(height: 24),
                          _buildFooter(context),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
          ],
        ),
      ),
    );
  }

  /// `.label`: Barlow Condensed 11/14, +0.2em, maiúsculas, ink-subtle.
  TextStyle _rotulo(BuildContext context, {Color? color}) {
    return GoogleFonts.barlowCondensed(
      fontSize: 11,
      height: 14 / 11,
      fontWeight: FontWeight.w600,
      letterSpacing: 11 * 0.2,
      color: color ?? AppColors.textTertiary(context),
    );
  }

  /// Marca: logo monocromática, nome em Barlow Condensed (`.hero`), a linha do
  /// que o app entrega e as capacidades separadas por barra.
  Widget _buildBrandBlock(BuildContext context) {
    final tinta = AppColors.textPrimary(context);
    final hero = GoogleFonts.barlowCondensed(
      fontSize: 52,
      height: 50 / 52,
      fontWeight: FontWeight.w600,
      letterSpacing: 52 * 0.04,
      color: tinta,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // O PNG é branco sobre transparente; `srcIn` pinta com a cor do texto,
        // então no tema claro vira preto.
        Row(
          children: [
            PrestareLogo(height: 84, color: tinta),
            const SizedBox(width: 18),
            const Flexible(child: PoweredByAws(height: 26)),
          ],
        ),
        const SizedBox(height: 24),
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'PRESTARE\n'),
              TextSpan(
                text: 'GESTÃO',
                style: hero.copyWith(fontWeight: FontWeight.w300),
              ),
            ],
          ),
          style: hero,
        ),
        const SizedBox(height: 14),
        Text(
          'Todo o condomínio na palma da mão',
          style: GoogleFonts.barlow(
            fontSize: 14,
            height: 20 / 14,
            color: AppColors.textSecondary(context),
          ),
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _recurso(context, PhosphorIcons.shieldCheck, 'ACESSO'),
            _recurso(context, PhosphorIcons.package, 'ENCOMENDAS'),
            _recurso(context, PhosphorIcons.wallet, 'FINANCEIRO'),
          ],
        ),
      ],
    );
  }

  /// `.login-feats span`: selo com ícone de marca.
  Widget _recurso(BuildContext context, IconData icone, String rotulo) {
    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.borderStrong(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icone, size: 13, color: AppColors.brandInk),
          const SizedBox(width: 6),
          Text(
            rotulo,
            style: GoogleFonts.barlowCondensed(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 10 * 0.16,
              color: AppColors.textSecondary(context),
            ),
          ),
        ],
      ),
    );
  }

  /// `.list`: três `.item` colados, separados por 1px de line-100.
  Widget _buildPerfis(BuildContext context) {
    final linha = AppColors.border(context);
    final perfis = <Widget>[
      _PerfilCard(
        icon: PhosphorIcons.shieldCheck,
        titulo: 'Síndico',
        descricao: 'Gestão completa do condomínio',
        onTap: () => _abrirLogin('sindico'),
      ),
      _PerfilCard(
        icon: PhosphorIcons.house,
        titulo: 'Morador',
        descricao: 'Visitas, encomendas e reservas',
        onTap: () => _abrirLogin('morador'),
      ),
      _PerfilCard(
        icon: PhosphorIcons.identificationCard,
        titulo: 'Funcionário',
        descricao: 'Portaria, ocorrências e rotinas',
        onTap: () => _abrirLogin('funcionario'),
      ),
    ];
    return Container(
      decoration: BoxDecoration(color: linha, border: Border.all(color: linha)),
      child: Column(
        children: [
          for (var i = 0; i < perfis.length; i++) ...[
            if (i > 0)
              SizedBox(height: 1, child: ColoredBox(color: linha)),
            perfis[i],
          ],
        ],
      ),
    );
  }

  Widget _buildFooter(BuildContext context) {
    return Text(
      '${getText("vesaoApp")} $_appVersion · © 2026 Prestare Gestão e Tecnologia. Todos os direitos reservados.',
      style: GoogleFonts.barlow(
        fontSize: 12,
        height: 16 / 12,
        color: AppColors.textTertiary(context),
      ),
    );
  }

  /// `.iconbtn`: quadrado de 40px com contorno line-100 e ícone fino.
  Widget _buildThemeToggle(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return InkWell(
      onTap: () {
        ThemeController.instance.setMode(
          isDark ? ThemeMode.light : ThemeMode.dark,
        );
      },
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Icon(
          isDark ? PhosphorIcons.sun : PhosphorIcons.moon,
          color: AppColors.textPrimary(context),
          size: 18,
        ),
      ),
    );
  }
}

/// `.item` de escolha de perfil: ícone em `.ico`, título em Barlow Condensed,
/// descrição em `.cap` e seta à direita. Nenhum perfil é destacado: a cor não
/// distingue a escolha, todos têm o mesmo peso.
class _PerfilCard extends StatelessWidget {
  const _PerfilCard({
    required this.icon,
    required this.titulo,
    required this.descricao,
    required this.onTap,
  });

  final IconData icon;
  final String titulo;
  final String descricao;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface(context),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                color: AppColors.brandSoftOf(context),
                child: Icon(
                  icon,
                  size: 20,
                  color: AppColors.brandInkOf(context),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      titulo.toUpperCase(),
                      style: GoogleFonts.barlowCondensed(
                        fontSize: 16,
                        height: 20 / 16,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 16 * 0.16,
                        color: AppColors.textPrimary(context),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      descricao,
                      style: GoogleFonts.barlow(
                        fontSize: 12,
                        height: 16 / 12,
                        color: AppColors.textTertiary(context),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                PhosphorIcons.arrowRight,
                size: 18,
                color: AppColors.textTertiary(context),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Malha quadriculada que some para baixo (`.scroll.boot::before`).
class _GradeDeFundo extends StatelessWidget {
  const _GradeDeFundo();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: ShaderMask(
        shaderCallback: (r) => const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.black, Colors.transparent],
        ).createShader(r),
        blendMode: BlendMode.dstIn,
        child: CustomPaint(
          painter: _GradePainter(AppColors.border(context).withValues(alpha: 0.6)),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _GradePainter extends CustomPainter {
  final Color cor;

  _GradePainter(this.cor);

  @override
  void paint(Canvas canvas, Size size) {
    final linha = Paint()
      ..color = cor
      ..strokeWidth = 1;
    const passo = 39.0;
    for (double x = 0; x <= size.width; x += passo) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), linha);
    }
    for (double y = 0; y <= size.height; y += passo) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), linha);
    }
  }

  @override
  bool shouldRepaint(_GradePainter old) => old.cor != cor;
}
