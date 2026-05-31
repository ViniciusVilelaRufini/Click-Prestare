import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class NotificationSettingsPage extends StatefulWidget {
  const NotificationSettingsPage({Key? key}) : super(key: key);

  @override
  _NotificationSettingsPageState createState() => _NotificationSettingsPageState();
}

class _NotificationSettingsPageState extends State<NotificationSettingsPage> {
  bool _encomendas = true;
  bool _comunicados = true;
  bool _ocorrencias = true;
  bool _visitantes = true;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      final response = await ApiClient.get(
        ApiConfig.buildUri('/users/settings'),
        headers: {
          'Authorization': getToken(),
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _encomendas = data['notif_encomendas'] == 1;
          _comunicados = data['notif_comunicados'] == 1;
          _ocorrencias = data['notif_ocorrencias'] == 1;
          _visitantes = data['notif_visitantes'] == 1;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Error loading settings: $e');
    }
  }

  Future<void> _saveSettings() async {
    try {
      await ApiClient.post(
        ApiConfig.buildUri('/users/settings'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getToken(),
        },
        body: jsonEncode({
          'notif_encomendas': _encomendas,
          'notif_comunicados': _comunicados,
          'notif_ocorrencias': _ocorrencias,
          'notif_visitantes': _visitantes,
        }),
      );
    } catch (e) {
      debugPrint('Error saving settings: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'NotificaÃ§Ãµes',
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Escolha quais avisos vocÃª deseja receber no seu celular.',
                    style: AppTypography.bodySecondary(context),
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Encomendas',
                    subtitle: 'Receba avisos quando chegar um pacote para vocÃª.',
                    value: _encomendas,
                    icon: PhosphorIcons.package,
                    onChanged: (val) {
                      setState(() => _encomendas = val);
                      _saveSettings();
                    },
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Comunicados',
                    subtitle: 'Avisos importantes do sÃ­ndico e condomÃ­nio.',
                    value: _comunicados,
                    icon: PhosphorIcons.megaphone,
                    onChanged: (val) {
                      setState(() => _comunicados = val);
                      _saveSettings();
                    },
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'OcorrÃªncias',
                    subtitle: 'Saiba quando sua ocorrÃªncia for respondida.',
                    value: _ocorrencias,
                    icon: PhosphorIcons.warningCircle,
                    onChanged: (val) {
                      setState(() => _ocorrencias = val);
                      _saveSettings();
                    },
                  ),
                  const Divider(height: AppSpacing.xxl),
                  _buildSwitch(
                    title: 'Visitantes',
                    subtitle: 'Receba avisos quando alguÃ©m chegar para vocÃª.',
                    value: _visitantes,
                    icon: PhosphorIcons.userList,
                    onChanged: (val) {
                      setState(() => _visitantes = val);
                      _saveSettings();
                    },
                  ),
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
            color: AppColors.primaryLight.withOpacity(0.5),
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
          onChanged: onChanged,
          activeColor: AppColors.primary,
        ),
      ],
    );
  }
}
