import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_notificacoes.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/pages/settings/notification_settings.dart';
import 'package:click/pages/shared/configuracoes/modal_new_password.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/localstorage_config.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/pages/settings/qr_web_access_page.dart';

class ConfiguracoesView extends StatefulWidget {
  final dynamic condominio;
  const ConfiguracoesView({Key? key, required this.condominio}) : super(key: key);

  @override
  _ConfiguracoesViewState createState() => _ConfiguracoesViewState();
}

class _ConfiguracoesViewState extends State<ConfiguracoesView> {
  String _appVersion = '';

  @override
  void initState() {
    super.initState();
    _load();
    ThemeController.instance.addListener(_onTheme);
  }

  @override
  void dispose() {
    ThemeController.instance.removeListener(_onTheme);
    super.dispose();
  }

  void _onTheme() => mounted ? setState(() {}) : null;

  Future<void> _load() async {
    final v = await getAppVersion();
    if (!mounted) return;
    setState(() => _appVersion = v);
  }

  Future<void> _deleteCondominio() async {
    final liberado = widget.condominio?['liberado_exclusao'] == 1;
    if (!liberado) {
      await showAppDialog(
        context,
        title: 'Ação não permitida',
        message: 'A exclusão do condomínio não está liberada. Entre em contato com a Prestare para solicitar a liberação.',
        icon: PhosphorIcons.lock,
        iconColor: AppColors.error,
      );
      return;
    }

    final ok = await showAppConfirmDialog(
      context,
      title: 'Remover condomínio',
      message: getText('cond_confirm_delete'),
      confirmLabel: 'Remover',
      isDanger: true,
    );
    if (!ok) return;
    final res = await apiDeleteObject('condominio', Singleton.instance.id_condominio);
    if (!mounted) return;
    if (res) {
      await showAppDialog(
        context,
        title: getText('alert_success'),
        message: 'Condomínio removido!',
        icon: PhosphorIcons.checkCircle,
        iconColor: AppColors.success,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
      Navigator.of(context).pop(true);
      Navigator.of(context).pop(true);
    } else {
      await showAppDialog(context,
          title: getText('alert_error'),
          message: getText('alert_generic_error'),
          icon: PhosphorIcons.warning,
          iconColor: AppColors.error);
    }
  }

  Future<void> _deleteAccount() async {
    final ok = await showAppConfirmDialog(
      context,
      title: 'Excluir minha conta',
      message: getText('signup_confirm_delete'),
      confirmLabel: 'Excluir',
      isDanger: true,
    );
    if (!ok) return;

    final success = await apiDeleteAccount();
    if (!mounted) return;

    if (success) {
      await showAppDialog(context,
          title: getText('label_exclusao'),
          message: getText('config_delete_account_sucesso'),
          icon: PhosphorIcons.info);
      // Conta apagada: encerra a sessão e volta para a tela de login.
      storageLogout();
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
    } else {
      showAppDialog(context,
          title: getText('alert_error'),
          message: 'Não foi possível excluir a conta agora. Tente novamente mais tarde.',
          icon: PhosphorIcons.warningCircle);
    }
  }

  Future<void> _changeTheme() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (c) => _OptionSheet(
        title: 'Aparência',
        items: [
          _OptionItem(
            icon: PhosphorIcons.deviceMobile,
            label: 'Sistema',
            description: 'Seguir tema do dispositivo',
            selected: ThemeController.instance.mode == ThemeMode.system,
            onTap: () { ThemeController.instance.setMode(ThemeMode.system); Navigator.pop(c); },
          ),
          _OptionItem(
            icon: PhosphorIcons.sun,
            label: 'Claro',
            description: 'Sempre tema claro',
            selected: ThemeController.instance.mode == ThemeMode.light,
            onTap: () { ThemeController.instance.setMode(ThemeMode.light); Navigator.pop(c); },
          ),
          _OptionItem(
            icon: PhosphorIcons.moon,
            label: 'Escuro',
            description: 'Sempre tema escuro',
            selected: ThemeController.instance.mode == ThemeMode.dark,
            onTap: () { ThemeController.instance.setMode(ThemeMode.dark); Navigator.pop(c); },
          ),
        ],
      ),
    );
  }

  Future<void> _changeLanguage() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (c) {
        final cur = LocalStorageConfig.instance.getPreferenceLanguage();
        final opt = (String code, String label) => _OptionItem(
              icon: PhosphorIcons.translate,
              label: label,
              selected: cur == code,
              onTap: () {
                LocalStorageConfig.instance.savePreferenceLanguage(code);
                Navigator.pop(c);
                if (mounted) setState(() {});
              },
            );
        return _OptionSheet(
          title: getText('language_idioma'),
          items: [
            opt('pt_BR', getText('language_pt_br')),
            opt('en', getText('language_en')),
            opt('es', getText('language_es')),
            opt('pt_PT', getText('language_pt_pt')),
            opt('de', getText('language_al')),
          ],
        );
      },
    );
  }

  Future<void> _changeMoeda() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bg(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (c) {
        final opt = (String symbol, String label) => _OptionItem(
              icon: PhosphorIcons.currencyCircleDollar,
              label: '$label ($symbol)',
              selected: Singleton.instance.checkCurrentMoeda(symbol),
              onTap: () async {
                Navigator.pop(c);
                try {
                  await updateMoedaCondominioApi(
                      widget.condominio["id"].toString(), symbol);
                   Singleton.instance.moeda = symbol;
                  if (!mounted) return;
                  showAppDialog(context,
                      title: getText('alert_success'),
                      message: getText('alert_dados_alterados'),
                      icon: PhosphorIcons.checkCircle,
                      iconColor: AppColors.success);
                  setState(() {});
                } catch (_) {}
              },
            );
        return _OptionSheet(
          title: getText('moeda'),
          items: [
            opt("R\$", getText('moeda_real')),
            opt("US\$", getText('moeda_dolar_americano')),
            opt("€", getText('moeda_euro')),
            opt("£", getText('moeda_libra')),
            opt("Mex\$", getText('moeda_peso_mexicano')),
            opt("\$", getText('moeda_generico')),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final type = getUserType();
    return AppScaffold(
      title: getText('config_nav'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppSpacing.lg),
            _buildCondominioCard(),
            AppSpacing.gapXxl,
            _SectionTitle('Aparência'),
            _SettingsTile(
              icon: ThemeController.instance.mode == ThemeMode.dark
                  ? PhosphorIcons.moon
                  : ThemeController.instance.mode == ThemeMode.light
                      ? PhosphorIcons.sun
                      : PhosphorIcons.deviceMobile,
              label: 'Tema',
              trailingText: ThemeController.instance.label,
              onTap: _changeTheme,
            ),
            _SettingsTile(
              icon: PhosphorIcons.translate,
              label: getText('language_idioma'),
              onTap: _changeLanguage,
            ),
            if (type == 'sindico')
              _SettingsTile(
                icon: PhosphorIcons.currencyCircleDollar,
                label: getText('moeda'),
                trailingText: Singleton.instance.getCurrentMoeda(),
                onTap: _changeMoeda,
              ),
            AppSpacing.gapXl,
            _SectionTitle('Notificações'),
            _SettingsTile(
              icon: PhosphorIcons.bell,
              label: 'Avisos que quero receber',
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => const NotificationSettingsPage()),
                );
              },
            ),
            AppSpacing.gapXl,
            _SectionTitle('Conta'),
            _SettingsTile(
              icon: PhosphorIcons.lock,
              label: getText('config_alt_senha'),
              onTap: () {
                showDialog(context: context, builder: (_) => const ModalNewPassword());
              },
            ),
            if (type == 'sindico' || type == 'funcionario')
              _SettingsTile(
                icon: PhosphorIcons.qrCode,
                label: 'Acesso Web por QR Code',
                onTap: () {
                  final int condId = widget.condominio?['id'] ?? Singleton.instance.id_condominio ?? 1;
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => QrWebAccessPage(idCondominio: condId),
                    ),
                  );
                },
              ),

            // Diagnóstico de push na mão de quem tem o aparelho.
            //
            // Quando alguém diz "não chega notificação", as causas possíveis
            // (aparelho sem token registrado, permissão negada no sistema,
            // token expirado, chave APNs ausente) são todas silenciosas. Este
            // botão pede ao servidor um envio de teste e mostra o que o FCM
            // respondeu, em vez de deixar todo mundo no escuro.
            _SettingsTile(
              icon: PhosphorIcons.bellRinging,
              label: 'Testar notificação',
              onTap: () => _testarNotificacao(context),
            ),

            AppSpacing.gapXl,
            _SectionTitle('Sobre'),
            _SettingsTile(
              icon: PhosphorIcons.fileText,
              label: getText('config_termos_uso'),
              // click-app.co não existe mais (o domínio nem resolve DNS) e
              // estes dois links abriam erro dentro do app. As páginas são
              // servidas pelo portaria-web, em public/.
              onTap: () => launchInBrowser('https://click-prestare.vercel.app/termos-de-uso.html', context),
            ),
            _SettingsTile(
              icon: PhosphorIcons.shieldCheck,
              label: getText('config_politica_privacidade'),
              onTap: () => launchInBrowser('https://click-prestare.vercel.app/politica-de-privacidade.html', context),
            ),
            _SettingsTile(
              icon: PhosphorIcons.chatCircle,
              label: getText('config_fale_conosco'),
              onTap: () => showAppDialog(context,
                  title: getText('config_fale_conosco'),
                  message: getText('config_fale_conosco_descricao'),
                  icon: PhosphorIcons.chatCircle),
            ),
            AppSpacing.gapXl,
            _SectionTitle('Zona de perigo', danger: true),
            if (type == 'sindico')
              _SettingsTile(
                icon: PhosphorIcons.trash,
                label: getText('config_delete_cond'),
                danger: true,
                onTap: _deleteCondominio,
              ),
            if (type != 'funcionario')
              _SettingsTile(
                icon: PhosphorIcons.userMinus,
                label: getText('config_delete_account'),
                danger: true,
                onTap: _deleteAccount,
              ),
            _SettingsTile(
              icon: PhosphorIcons.signOut,
              label: getText('lb_logout'),
              onTap: () async {
                await storageLogout();
                if (context.mounted) {
                  Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
                }
              },
            ),
            AppSpacing.gapXl,
            Center(
              child: Text('${getText('vesaoApp')} $_appVersion',
                  style: AppTypography.tiny(context)),
            ),
            AppSpacing.gapXl,
          ],
        ),
      ),
    );
  }

  Widget _buildCondominioCard() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.xl),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: SizedBox(
              width: 56, height: 56,
              child: widget.condominio?["photo"] != null &&
                      widget.condominio["photo"].toString().isNotEmpty
                  ? Image.network(
                      widget.condominio["photo"],
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _photoFallback(),
                    )
                  : _photoFallback(),
            ),
          ),
          AppSpacing.gapMd,
          Expanded(
            child: Text(
              widget.condominio?["nome"] ?? '',
              style: AppTypography.headline(context),
              maxLines: 2, overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _photoFallback() => Container(
        color: AppColors.primaryLight,
        child: Icon(PhosphorIcons.buildingsFill,
            color: AppColors.primary, size: 28),
      );

  /// Pede ao servidor um push de teste para este usuário e mostra o resultado.
  ///
  /// Antes de pedir o envio, registra o token de novo: se o aparelho nunca se
  /// registrou (permissão negada na primeira vez, por exemplo), o teste diria
  /// apenas "nenhum aparelho" sem chance de se corrigir sozinho.
  Future<void> _testarNotificacao(BuildContext context) async {
    await FirebaseService.instance.registrarNoServidor();

    final resultado = await apiTestarPush();
    if (!context.mounted) return;

    final aparelhos = (resultado['aparelhos'] ?? 0) as int;
    final erroGeral = resultado['erro'] ?? resultado['aviso'];

    String mensagem;
    if (erroGeral != null) {
      mensagem = erroGeral.toString();
    } else if (aparelhos == 0) {
      mensagem = 'Nenhum aparelho registrado para receber notificações.\n\n'
          'Verifique se as notificações estão permitidas nos ajustes do celular.';
    } else {
      final linhas = <String>['Aparelhos registrados: $aparelhos', ''];
      for (final r in (resultado['resultados'] as List? ?? [])) {
        final plataforma = r['plataforma'] ?? 'desconhecida';
        linhas.add(r['ok'] == true
            ? '✓ $plataforma — enviado'
            : '✗ $plataforma — ${r['codigo'] ?? ''} ${r['erro'] ?? ''}');
      }
      mensagem = linhas.join('\n');
    }

    if (!context.mounted) return;
    showAppDialog(
      context,
      title: 'Teste de notificação',
      message: mensagem,
      icon: PhosphorIcons.bellRinging,
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  final bool danger;
  const _SectionTitle(this.text, {this.danger = false});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.md),
      child: Text(
        text.toUpperCase(),
        style: AppTypography.tiny(context).copyWith(
          color: danger ? AppColors.error : AppColors.textTertiary(context),
          letterSpacing: 1.2, fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? trailingText;
  final VoidCallback onTap;
  final bool danger;
  const _SettingsTile({
    required this.icon,
    required this.label,
    this.trailingText,
    required this.onTap,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = danger ? AppColors.error : AppColors.textPrimary(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
            child: Row(
              children: [
                Icon(icon, color: color, size: 22),
                AppSpacing.gapMd,
                Expanded(
                  child: Text(label, style: AppTypography.body(context).copyWith(color: color)),
                ),
                if (trailingText != null) ...[
                  Text(trailingText!,
                      style: AppTypography.bodySecondary(context)),
                  AppSpacing.gapSm,
                ],
                if (!danger)
                  Icon(PhosphorIcons.caretRight,
                      color: AppColors.textTertiary(context), size: 18),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OptionItem {
  final IconData icon;
  final String label;
  final String? description;
  final bool selected;
  final VoidCallback onTap;
  _OptionItem({
    required this.icon,
    required this.label,
    this.description,
    this.selected = false,
    required this.onTap,
  });
}

class _OptionSheet extends StatelessWidget {
  final String title;
  final List<_OptionItem> items;
  const _OptionSheet({required this.title, required this.items});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl, AppSpacing.md, AppSpacing.xl, AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border(context),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            AppSpacing.gapLg,
            Text(title, style: AppTypography.title(context)),
            AppSpacing.gapLg,
            ...items.map((it) => Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: Material(
                    color: it.selected
                        ? AppColors.primaryLight
                        : AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    child: InkWell(
                      onTap: it.onTap,
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.lg),
                        child: Row(
                          children: [
                            Icon(it.icon,
                                color: it.selected
                                    ? AppColors.primary
                                    : AppColors.textSecondary(context),
                                size: 22),
                            AppSpacing.gapMd,
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(it.label,
                                      style: AppTypography.bodyMedium(context).copyWith(
                                        color: it.selected
                                            ? AppColors.primary
                                            : AppColors.textPrimary(context),
                                      )),
                                  if (it.description != null)
                                    Text(it.description!,
                                        style: AppTypography.caption(context)),
                                ],
                              ),
                            ),
                            if (it.selected)
                              Icon(PhosphorIcons.checkCircleFill,
                                  color: AppColors.primary, size: 22),
                          ],
                        ),
                      ),
                    ),
                  ),
                )),
          ],
        ),
      ),
    );
  }
}
