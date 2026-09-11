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
    return PopScope(
      // Sem saída pelo botão voltar: consentimento que dá para pular não é
      // consentimento.
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.bg(context),
        body: SafeArea(
          child: Column(children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: [
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.10),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(PhosphorIcons.shieldCheck, color: AppColors.primary, size: 28),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text('Sua privacidade',
                      style: AppTypography.title(context).copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Para usar o Prestare Portaria, precisamos do seu consentimento para '
                    'tratar alguns dados pessoais.',
                    style: AppTypography.body(context)
                        .copyWith(color: AppColors.textSecondary(context)),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  _bloco(
                    icone: PhosphorIcons.identificationCard,
                    titulo: 'O que tratamos e para quê',
                    texto: 'Nome, e-mail, telefone, CPF e sua unidade — para identificar '
                        'você, controlar o acesso ao condomínio e enviar comunicados oficiais.',
                  ),
                  _bloco(
                    icone: PhosphorIcons.usersThree,
                    titulo: 'Com quem compartilhamos',
                    texto: 'Com a administração do seu condomínio. Não vendemos seus dados '
                        'nem os usamos para publicidade.',
                  ),
                  _bloco(
                    icone: PhosphorIcons.clock,
                    titulo: 'Por quanto tempo',
                    texto: 'Enquanto você for morador, e pelo prazo legal aplicável depois disso.',
                  ),
                  _bloco(
                    icone: PhosphorIcons.scales,
                    titulo: 'Seus direitos',
                    texto: 'Você pode pedir acesso, correção ou exclusão dos seus dados a '
                        'qualquer momento, e revogar este consentimento.',
                  ),

                  const SizedBox(height: AppSpacing.sm),
                  GestureDetector(
                    onTap: () => launchUrl(Uri.parse(_urlPolitica),
                        mode: LaunchMode.externalApplication),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(PhosphorIcons.arrowSquareOut, size: 15, color: AppColors.primary),
                      const SizedBox(width: 6),
                      Text('Ler a Política de Privacidade completa',
                          style: AppTypography.caption(context).copyWith(
                              color: AppColors.primary, fontWeight: FontWeight.bold)),
                    ]),
                  ),

                  const SizedBox(height: AppSpacing.md),
                ],
              ),
            ),
            // As caixas ficam FIXAS, junto da ação — não dentro da lista que
            // rola. Numa tela de celular elas caíam abaixo da dobra, e a da
            // biometria sequer aparecia: dava para aceitar sem nunca ter visto
            // a opção. O Art. 11 exige consentimento DESTACADO, e caixa que
            // se precisa procurar rolando não é destaque.
            Container(
              decoration: BoxDecoration(
                color: AppColors.bg(context),
                border: Border(top: BorderSide(color: AppColors.border(context))),
              ),
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
              child: Column(children: [
                _caixa(
                  valor: _privacidade,
                  onChanged: (v) => setState(() => _privacidade = v),
                  obrigatorio: true,
                  texto: 'Li e concordo com a Política de Privacidade e com o '
                      'tratamento dos meus dados pessoais.',
                ),
                const SizedBox(height: AppSpacing.sm),
                _caixa(
                  valor: _biometria,
                  onChanged: (v) => setState(() => _biometria = v),
                  obrigatorio: false,
                  texto: 'Autorizo o uso da minha biometria facial para abrir a '
                      'portaria pelo rosto. Recusar não tira seu acesso ao app.',
                ),
                const SizedBox(height: AppSpacing.md),
                ElevatedButton(
                  onPressed: (!_privacidade || _enviando) ? null : _aceitar,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _enviando
                      ? const SizedBox(
                          width: 20, height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Aceitar e continuar'),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextButton(
                  onPressed: _enviando ? null : _recusar,
                  child: Text('Recusar e sair',
                      style: AppTypography.body(context)
                          .copyWith(color: AppColors.textSecondary(context))),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _bloco({required IconData icone, required String titulo, required String texto}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icone, size: 18, color: AppColors.primary),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(titulo,
                style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(texto,
                style: AppTypography.caption(context)
                    .copyWith(color: AppColors.textSecondary(context))),
          ]),
        ),
      ]),
    );
  }

  Widget _caixa({
    required bool valor,
    required ValueChanged<bool> onChanged,
    required bool obrigatorio,
    required String texto,
  }) {
    return GestureDetector(
      onTap: () => onChanged(!valor),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: valor ? AppColors.primary : AppColors.border(context),
            width: valor ? 1.6 : 1,
          ),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(
            valor ? PhosphorIcons.checkSquare : PhosphorIcons.square,
            color: valor ? AppColors.primary : AppColors.textTertiary(context),
            size: 22,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                obrigatorio ? 'Obrigatório' : 'Opcional',
                style: AppTypography.tiny(context).copyWith(
                  color: obrigatorio ? AppColors.error : AppColors.textTertiary(context),
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 2),
              Text(texto, style: AppTypography.caption(context)),
            ]),
          ),
        ]),
      ),
    );
  }
}
