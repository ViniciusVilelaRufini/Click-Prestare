import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'dart:convert';

class NotificationSettingsPage extends StatefulWidget {
  const NotificationSettingsPage({super.key});

  @override
  _NotificationSettingsPageState createState() => _NotificationSettingsPageState();
}

class _NotificationSettingsPageState extends State<NotificationSettingsPage> {
  bool _encomendas = true;
  bool _comunicados = true;
  bool _ocorrencias = true;
  bool _visitantes = true;
  bool _isLoading = true;

  /// A carga falhou: mostra o erro com "tentar de novo" (antes o spinner
  /// girava para sempre).
  bool _falhouCarga = false;

  /// Um salvamento em curso: os switches ficam travados até a resposta, para
  /// uma reversão por falha não desfazer outro toque.
  bool _salvando = false;

  /// Interfone pelo app: o switch só aparece com o módulo ligado no
  /// condomínio e a preferência lida (GET /interfone/preferencia).
  bool? _receberPortao;

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _carregarInterfone();
  }

  Future<void> _carregarInterfone() async {
    if (!await InterfoneApi.disponivel()) return;
    final receber = await InterfoneApi.preferencia();
    if (!mounted || receber == null) return;
    setState(() => _receberPortao = receber);
  }

  Future<void> _alterarPortao(bool novo) async {
    if (_salvando) return;
    setState(() {
      _receberPortao = novo;
      _salvando = true;
    });
    final ok = await InterfoneApi.definirPreferencia(novo);
    if (!mounted) return;
    setState(() {
      if (!ok) _receberPortao = !novo;
      _salvando = false;
    });
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Não foi possível salvar a preferência. Tente novamente.'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _loadSettings() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _falhouCarga = false;
      });
    }
    var ok = false;
    try {
      final response = await ApiClient.get(ApiConfig.buildUri('/users/settings'));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is Map) {
          _encomendas = data['notif_encomendas'] == 1 || data['notif_encomendas'] == true;
          _comunicados = data['notif_comunicados'] == 1 || data['notif_comunicados'] == true;
          _ocorrencias = data['notif_ocorrencias'] == 1 || data['notif_ocorrencias'] == true;
          _visitantes = data['notif_visitantes'] == 1 || data['notif_visitantes'] == true;
          ok = true;
        }
      }
    } catch (e) {
      debugPrint('Error loading settings: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _falhouCarga = !ok;
        });
      }
    }
  }

  /// Liga/desliga um aviso e grava. Se o servidor não confirmar, o switch
  /// volta ao que era e a pessoa é avisada: antes a tela mostrava desligado,
  /// o servidor seguia ligado e o push continuava chegando.
  Future<void> _alterar(bool novo, void Function(bool) aplicar) async {
    if (_salvando) return;
    setState(() {
      aplicar(novo);
      _salvando = true;
    });
    var ok = false;
    try {
      final response = await ApiClient.post(
        ApiConfig.buildUri('/users/settings'),
        body: jsonEncode({
          'notif_encomendas': _encomendas,
          'notif_comunicados': _comunicados,
          'notif_ocorrencias': _ocorrencias,
          'notif_visitantes': _visitantes,
        }),
      );
      ok = response.statusCode >= 200 && response.statusCode < 300;
    } catch (e) {
      debugPrint('Error saving settings: $e');
    }
    if (!mounted) return;
    setState(() {
      if (!ok) aplicar(!novo);
      _salvando = false;
    });
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Não foi possível salvar a preferência. Tente novamente.'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Notificações',
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : _falhouCarga
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Não foi possível carregar suas preferências de notificação.',
                          style: AppTypography.bodySecondary(context),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        TextButton(
                          onPressed: _loadSettings,
                          child: Text('Tentar de novo'.toUpperCase()),
                        ),
                      ],
                    ),
                  ),
                )
              : Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Escolha quais avisos você deseja receber no seu celular.',
                    style: AppTypography.bodySecondary(context),
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Encomendas',
                    subtitle: 'Receba avisos quando chegar um pacote para você.',
                    value: _encomendas,
                    icon: PhosphorIcons.package,
                    onChanged: (val) => _alterar(val, (v) => _encomendas = v),
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Comunicados',
                    subtitle: 'Avisos importantes do síndico e condomínio.',
                    value: _comunicados,
                    icon: PhosphorIcons.megaphone,
                    onChanged: (val) => _alterar(val, (v) => _comunicados = v),
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Ocorrências',
                    subtitle: 'Saiba quando sua ocorrência for respondida.',
                    value: _ocorrencias,
                    icon: PhosphorIcons.warningCircle,
                    onChanged: (val) => _alterar(val, (v) => _ocorrencias = v),
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Visitantes',
                    subtitle: 'Receba avisos quando alguém chegar para você.',
                    value: _visitantes,
                    icon: PhosphorIcons.userList,
                    onChanged: (val) => _alterar(val, (v) => _visitantes = v),
                  ),
                  if (_receberPortao != null) ...[
                    const Divider(height: AppSpacing.xxl),
                    _buildSwitch(
                      title: 'Receber chamadas do portão',
                      subtitle: 'O interfone toca neste celular. Desligado, os outros moradores da unidade e a portaria continuam recebendo.',
                      value: _receberPortao!,
                      icon: PhosphorIcons.phoneCall,
                      onChanged: _alterarPortao,
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _buildSwitch({
    required String title,
    required String subtitle,
    required bool value,
    required IconData icon,
    required ValueChanged<bool> onChanged,
  }) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.primaryLight.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Icon(icon, color: AppColors.primary, size: 24),
        ),
        AppSpacing.gapLg,
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppTypography.bodyMedium(context)),
              Text(subtitle, style: AppTypography.caption(context)),
            ],
          ),
        ),
        Switch.adaptive(
          value: value,
          onChanged: _salvando ? null : onChanged,
        ),
      ],
    );
  }
}
