import 'package:click/controllers/controller_consentimento.dart';
import 'package:click/pages/sindico/list_condominiums.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/utils.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

/// Porta de entrada do app: decide entre a tela de aceite e o app em si.
///
/// Fica entre o login (e o auto-login) e `ListCondomiums`, que é o ponto por
/// onde os dois caminhos passam. Colocar a checagem só depois do login
/// deixaria de fora quem entra com token salvo — ou seja, quase todo mundo,
/// quase sempre.
///
/// Falha de rede NÃO bloqueia: sem resposta do servidor, o app abre normal e
/// pergunta na próxima vez. Prender o morador numa tela de aceite por causa
/// de sinal ruim seria pior que perguntar de novo.
class PortaDeEntrada extends StatefulWidget {
  const PortaDeEntrada({Key? key}) : super(key: key);

  @override
  State<PortaDeEntrada> createState() => _PortaDeEntradaState();
}

class _PortaDeEntradaState extends State<PortaDeEntrada> {
  bool _verificando = true;
  bool _precisaAceitar = false;

  @override
  void initState() {
    super.initState();
    _verificar();
  }

  Future<void> _verificar() async {
    final res = await apiConsentimentoPendente();
    if (!mounted) return;
    setState(() {
      _precisaAceitar = res is Map && res['precisaAceitar'] == true;
      _verificando = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_verificando) {
      return Scaffold(
        backgroundColor: AppColors.bg(context),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    return _precisaAceitar ? const AceitePrivacidadePage() : const ListCondomiums();
  }
}

/// Tela de consentimento, bloqueante.
///
/// O texto segue o que o Art. 9º da LGPD manda informar — finalidade, com
/// quem se compartilha, por quanto tempo e os direitos do titular — e remete
/// à política completa.
///
/// São DUAS caixas, e a separação é exigência legal, não estética:
///
///  - Privacidade é obrigatória para usar o app.
///  - Biometria facial é dado sensível (Art. 11) e exige consentimento
///    específico e destacado. É OPCIONAL porque o Art. 8º, §3º exige que o
///    consentimento seja livre: se recusá-la travasse o app, seria condição
///    de uso, não consentimento. Quem recusa continua entrando por PIN.
///
/// E a recusa é respeitada de verdade: o servidor consulta este registro
/// antes de enrolar qualquer rosto no terminal.
class AceitePrivacidadePage extends StatefulWidget {
  const AceitePrivacidadePage({Key? key}) : super(key: key);

  @override
  State<AceitePrivacidadePage> createState() => _AceitePrivacidadePageState();
}

class _AceitePrivacidadePageState extends State<AceitePrivacidadePage> {
  bool _privacidade = false;
  bool _biometria = false;
  bool _enviando = false;

  static const _urlPolitica = 'https://click-prestare.vercel.app/politica-de-privacidade.html';

  Future<void> _aceitar() async {
    if (!_privacidade || _enviando) return;
    setState(() => _enviando = true);

    final ok = await apiRegistrarConsentimento(
      privacidade: true,
      biometria: _biometria,
    );
    if (!mounted) return;

    if (ok) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const ListCondomiums()),
      );
    } else {
      setState(() => _enviando = false);
      displayMessage(context, 'Ops', 'Não consegui registrar sua resposta. Tente de novo.');
    }
  }

  Future<void> _recusar() async {
    final ok = await showConfirmDialog(
      context,
      text: 'Sem o aceite não podemos tratar seus dados, e o aplicativo não pode ser usado. '
          'Deseja sair?',
    );
    if (ok != true) return;

    // Registra a recusa antes de sair: é um fato com consequência e precisa
    // constar no histórico.
    await apiRegistrarConsentimento(privacidade: false, biometria: false);
    await storageLogout();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.bg(context),
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                    vertical: AppSpacing.md,
                  ),
                  children: [
                    // Cabeçalho azul moderno
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: 18,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [
                            AppColors.primaryGradientStart,
                            AppColors.primaryGradientEnd,
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(18),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primary.withValues(alpha: 0.28),
                            blurRadius: 14,
                            offset: const Offset(0, 5),
                          ),
                        ],
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.20),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.25),
                              ),
                            ),
                            child: const Icon(
                              PhosphorIcons.shieldCheck,
                              color: Colors.white,
                              size: 24,
                            ),
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sua privacidade',
                                  style: AppTypography.headline(context).copyWith(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 19,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  'Precisamos do seu consentimento para tratar alguns dados.',
                                  style: AppTypography.caption(context).copyWith(
                                    color: Colors.white.withValues(alpha: 0.90),
                                    fontSize: 12.5,
                                    height: 1.3,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Card 1: O que tratamos e para quê
                    _cardInformativo(
                      context,
                      icone: PhosphorIcons.identificationCard,
                      titulo: 'O que tratamos e para quê',
                      descricao:
                          'Nome, e-mail, telefone, CPF e sua unidade — para identificar você, controlar o acesso ao condomínio e enviar comunicados oficiais.',
                    ),
                    const SizedBox(height: 10),

                    // Card 2: Com quem compartilhamos
                    _cardInformativo(
                      context,
                      icone: PhosphorIcons.usersThree,
                      titulo: 'Com quem compartilhamos',
                      descricao:
                          'Com a administração do seu condomínio. Não vendemos seus dados nem os usamos para publicidade.',
                    ),
                    const SizedBox(height: 10),

                    // Card 3: Por quanto tempo
                    _cardInformativo(
                      context,
                      icone: PhosphorIcons.clock,
                      titulo: 'Por quanto tempo',
                      descricao:
                          'Enquanto você for morador, e pelo prazo legal aplicável depois disso.',
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Link sutil para ler a política completa
                    Center(
                      child: GestureDetector(
                        onTap: () => launchUrl(
                          Uri.parse(_urlPolitica),
                          mode: LaunchMode.externalApplication,
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                PhosphorIcons.arrowSquareOut,
                                size: 14,
                                color: AppColors.primary,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'Ler a Política de Privacidade completa',
                                style: AppTypography.caption(context).copyWith(
                                  color: AppColors.primary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                  ],
                ),
              ),

              // Área de Aceite e Ações fixa no rodapé
              Container(
                decoration: BoxDecoration(
                  color: AppColors.bg(context),
                  border: Border(
                    top: BorderSide(
                      color: isDark
                          ? Colors.white10
                          : const Color(0xFFE2E8F0).withValues(alpha: 0.6),
                    ),
                  ),
                ),
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.md,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Column(
                  children: [
                    // Checkbox Obrigatório
                    _caixaConsentimento(
                      context,
                      valor: _privacidade,
                      onChanged: (v) => setState(() => _privacidade = v),
                      obrigatorio: true,
                      texto:
                          'Li e concordo com a Política de Privacidade e com o tratamento dos meus dados pessoais.',
                    ),
                    const SizedBox(height: 10),

                    // Checkbox Opcional
                    _caixaConsentimento(
                      context,
                      valor: _biometria,
                      onChanged: (v) => setState(() => _biometria = v),
                      obrigatorio: false,
                      texto:
                          'Autorizo o uso da minha biometria facial para abrir a portaria pelo rosto. Recusar não tira seu acesso ao app.',
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Botão Aceitar e continuar
                    ElevatedButton(
                      onPressed: (!_privacidade || _enviando) ? null : _aceitar,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        disabledBackgroundColor:
                            AppColors.primary.withValues(alpha: 0.45),
                        foregroundColor: Colors.white,
                        disabledForegroundColor: Colors.white70,
                        elevation: 0,
                        minimumSize: const Size(double.infinity, 50),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: _enviando
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text(
                              'Aceitar e continuar',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                    const SizedBox(height: 6),

                    // Botão Recusar e sair
                    TextButton(
                      onPressed: _enviando ? null : _recusar,
                      child: Text(
                        'Recusar e sair',
                        style: AppTypography.body(context).copyWith(
                          color: AppColors.textSecondary(context),
                          fontSize: 13.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Card informativo individual com ícone em container suave, título e descrição
  Widget _cardInformativo(
    BuildContext context, {
    required IconData icone,
    required String titulo,
    required String descricao,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF131D2E) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? Colors.white10 : const Color(0xFFEDF2F7),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              color: isDark
                  ? const Color(0xFF1E3A8A).withValues(alpha: 0.4)
                  : const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              icone,
              size: 20,
              color: const Color(0xFF2563EB),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  titulo,
                  style: AppTypography.caption(context).copyWith(
                    fontWeight: FontWeight.bold,
                    fontSize: 13.5,
                    color: AppColors.textPrimary(context),
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  descricao,
                  style: AppTypography.caption(context).copyWith(
                    color: AppColors.textSecondary(context),
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Caixa de consentimento estilizada com destaque no estado marcado/desmarcado
  Widget _caixaConsentimento(
    BuildContext context, {
    required bool valor,
    required ValueChanged<bool> onChanged,
    required bool obrigatorio,
    required String texto,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GestureDetector(
      onTap: () => onChanged(!valor),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF131D2E) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: valor
                ? AppColors.primary
                : (isDark ? Colors.white24 : const Color(0xFFCBD5E1)),
            width: valor ? 1.5 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                valor ? PhosphorIcons.checkSquare : PhosphorIcons.square,
                color: valor
                    ? AppColors.primary
                    : AppColors.textTertiary(context),
                size: 20,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    obrigatorio ? 'Obrigatório' : 'Opcional',
                    style: TextStyle(
                      color: obrigatorio
                          ? const Color(0xFFEF4444)
                          : const Color(0xFF64748B),
                      fontWeight: FontWeight.bold,
                      fontSize: 11.5,
                      letterSpacing: 0.4,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    texto,
                    style: AppTypography.caption(context).copyWith(
                      color: AppColors.textSecondary(context),
                      fontSize: 12,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
