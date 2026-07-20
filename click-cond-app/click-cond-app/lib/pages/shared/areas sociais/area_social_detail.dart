import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/areas%20sociais/new_reserva.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/widgets/cells/cell_morador_agendamento.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_area_social.dart';

class AreaSocialDetail extends StatefulWidget {
  const AreaSocialDetail({Key? key, this.myId}) : super(key: key);
  final int? myId;

  @override
  _AreaSocialDetailPageState createState() => _AreaSocialDetailPageState();
}

class _AreaSocialDetailPageState extends State<AreaSocialDetail> {
  var _isLoading = false;
  dynamic obj;

  double? _temp;
  String? _weatherDesc;
  IconData? _weatherIcon;
  bool _weatherLoading = false;
  String? _cityName;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      obj = await apiGetDetails('areas-sociais', widget.myId!);
      if (obj == null && mounted) {
        displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
      if (mounted) setState(() {});
      
      // Load weather info after social area is fetched
      _fetchWeatherForCondominium();
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchWeatherForCondominium() async {
    try {
      setState(() => _weatherLoading = true);
      final condInfo = await getCondominio(Singleton.instance.id_condominio);
      if (condInfo != null && condInfo is Map<String, dynamic>) {
        final String city = condInfo['cidade'] ?? '';
        final String stateCode = condInfo['uf'] ?? '';
        _cityName = city;
        if (city.isNotEmpty) {
          final geoUrl = Uri.parse("https://nominatim.openstreetmap.org/search?city=${Uri.encodeComponent(city)}&state=${Uri.encodeComponent(stateCode)}&country=Brazil&format=json&limit=1");
          final geoResponse = await http.get(geoUrl, headers: {'User-Agent': 'ClickCondominioWeatherApp/1.0'});
          if (geoResponse.statusCode == 200) {
            final geoData = jsonDecode(geoResponse.body) as List<dynamic>;
            if (geoData.isNotEmpty) {
              final lat = geoData[0]['lat'];
              final lon = geoData[0]['lon'];

              final weatherUrl = Uri.parse("https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,weather_code&timezone=auto");
              final weatherResponse = await http.get(weatherUrl);
              if (weatherResponse.statusCode == 200) {
                final weatherData = jsonDecode(weatherResponse.body) as Map<String, dynamic>;
                final current = weatherData['current'] as Map<String, dynamic>?;
                if (current != null) {
                  final double temp = (current['temperature_2m'] ?? 0.0).toDouble();
                  final int code = current['weather_code'] ?? 0;
                  
                  String desc = "Limpo";
                  IconData icon = PhosphorIcons.sun;

                  if (code == 0) {
                    desc = "Céu Limpo";
                    icon = PhosphorIcons.sun;
                  } else if (code >= 1 && code <= 3) {
                    desc = "Parcialmente Nublado";
                    icon = PhosphorIcons.cloudSun;
                  } else if (code == 45 || code == 48) {
                    desc = "Névoa";
                    icon = PhosphorIcons.cloudFog;
                  } else if ((code >= 51 && code <= 55) || (code >= 61 && code <= 65) || (code >= 80 && code <= 82)) {
                    desc = "Chuva";
                    icon = PhosphorIcons.cloudRain;
                  } else if (code >= 71 && code <= 75) {
                    desc = "Neve";
                    icon = PhosphorIcons.snowflake;
                  } else if (code >= 95) {
                    desc = "Tempestade";
                    icon = PhosphorIcons.cloudLightning;
                  }

                  if (mounted) {
                    setState(() {
                      _temp = temp;
                      _weatherDesc = desc;
                      _weatherIcon = icon;
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      print("[Weather Detail] Error: $e");
    } finally {
      if (mounted) {
        setState(() => _weatherLoading = false);
      }
    }
  }

  bool _canEditAgendamento(dynamic item) {
    return getUserType() == 'sindico' ||
        getUserPermission('areas_sociais') == 1 ||
        (getUserType() == 'morador' &&
            Singleton.instance.bloco.toString() == item['bloco'] &&
            Singleton.instance.apartamento.toString() == item['apto']);
  }

  Widget _buildHeroHeader() {
    final hasImg = (obj['imagem'] ?? '').toString().isNotEmpty;
    
    return Container(
      width: double.infinity,
      height: 220,
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (hasImg)
            Image.network(
              obj['imagem'],
              fit: BoxFit.cover,
            )
          else
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppColors.primaryGradientStart,
                    AppColors.primaryGradientEnd,
                  ],
                ),
              ),
              child: Center(
                child: Opacity(
                  opacity: 0.15,
                  child: Icon(
                    PhosphorIcons.buildings,
                    size: 100,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          // Gradient Overlay
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withOpacity(0.15),
                  Colors.black.withOpacity(0.65),
                ],
              ),
            ),
          ),
          Positioned(
            bottom: AppSpacing.lg,
            left: AppSpacing.lg,
            right: AppSpacing.lg,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  obj['nome'],
                  style: AppTypography.headline(context).copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 24,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(
                      PhosphorIcons.usersThreeFill,
                      size: 16,
                      color: Colors.white70,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      obj['capacidade'].toString() != '-1'
                          ? '${obj['capacidade']} ${getText('pessoas')}'
                          : getText('capacidade_indeterminada'),
                      style: AppTypography.body(context).copyWith(
                        color: Colors.white70,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (obj['tem_monitoramento'] == true) ...[
                      const SizedBox(width: 10),
                      _buildOcupacaoChip(int.tryParse('${obj['ocupacao'] ?? 0}') ?? 0),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Selo de ocupação ao vivo ("quantas pessoas estão dentro agora"), exibido no
  // cabeçalho quando a área tem terminal(is) faciais/catraca vinculados.
  Widget _buildOcupacaoChip(int ocupacao) {
    final vazia = ocupacao <= 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.35),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white24),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(PhosphorIcons.usersThreeFill, size: 14, color: Colors.white),
          const SizedBox(width: 5),
          Text(
            vazia ? 'Vazio agora' : '$ocupacao dentro',
            style: AppTypography.body(context).copyWith(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeatherWidget() {
    if (_weatherLoading) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: AppSkeleton(width: double.infinity, height: 65, borderRadius: AppRadius.lg),
      );
    }

    if (_temp == null) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.06),
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                _weatherIcon ?? PhosphorIcons.sun,
                color: AppColors.primary,
                size: 26,
              ),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _weatherDesc ?? 'Tempo Limpo',
                    style: AppTypography.bodySecondary(context).copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary(context),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Previsão para ${_cityName ?? 'o condomínio'}',
                    style: AppTypography.tiny(context).copyWith(
                      color: AppColors.textSecondary(context),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '${_temp!.toStringAsFixed(1)}°C',
              style: AppTypography.title(context).copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.textPrimary(context),
                fontSize: 18,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return AppScaffold(
      title: getText('lb_area_social'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : obj == null
              ? const SizedBox()
              : CustomScrollView(
                  slivers: [
                    SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildHeroHeader(),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Wrap(
                                  spacing: AppSpacing.sm,
                                  runSpacing: AppSpacing.sm,
                                  children: [
                                    if (obj['precisa_agendar'] == 1)
                                      _Tag(
                                        label: getText('area_social_precisa_agendamento'),
                                        icon: PhosphorIcons.calendarCheck,
                                        color: AppColors.primary,
                                      ),
                                    if (obj['precisa_autorizacao'] == 1)
                                      _Tag(
                                        label: getText('area_social_precisa_autorizacao'),
                                        icon: PhosphorIcons.shieldCheck,
                                        color: Colors.teal,
                                      ),
                                    if (obj['precisa_pagamento'] == 1)
                                      _Tag(
                                        label: getText('area_social_precisa_pagamento'),
                                        icon: PhosphorIcons.creditCard,
                                        color: Colors.orange,
                                      ),
                                  ],
                                ),
                                _buildWeatherWidget(),
                                if (obj['precisa_agendar'] == 1) ...[
                                  const SizedBox(height: AppSpacing.lg),
                                  if (obj['tem_monitoramento'] == true)
                                    Container(
                                      width: double.infinity,
                                      margin: const EdgeInsets.only(bottom: AppSpacing.md),
                                      padding: const EdgeInsets.all(AppSpacing.md),
                                      decoration: BoxDecoration(
                                        color: AppColors.primary.withOpacity(0.08),
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                            color: AppColors.primary.withOpacity(0.25)),
                                      ),
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Icon(PhosphorIcons.userCircle,
                                              size: 18, color: AppColors.primary),
                                          const SizedBox(width: AppSpacing.sm),
                                          Expanded(
                                            child: Text(
                                              'Acesso por reconhecimento facial: liberado automaticamente durante o horário da sua reserva aprovada.',
                                              style: AppTypography.caption(context),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        getText('area_social_agendamentos').toUpperCase(),
                                        style: AppTypography.captionMedium(context).copyWith(
                                          color: AppColors.primary,
                                          letterSpacing: 1.0,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      if (getUserType() != 'funcionario')
                                        ElevatedButton.icon(
                                          onPressed: () => Navigator.push(
                                            context,
                                            MaterialPageRoute(builder: (_) => NewReserva(obj: obj)),
                                          ).then((_) => load()),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: AppColors.primary.withOpacity(0.12),
                                            foregroundColor: AppColors.primary,
                                            elevation: 0,
                                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                            shape: RoundedRectangleBorder(
                                              borderRadius: BorderRadius.circular(12),
                                            ),
                                          ),
                                          icon: const Icon(PhosphorIcons.plus, size: 14),
                                          label: Text(
                                            getText('nova_reserva'),
                                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: AppSpacing.md),
                                  if (obj['agendamentos'].isEmpty)
                                    Container(
                                      padding: const EdgeInsets.symmetric(vertical: 40),
                                      width: double.infinity,
                                      decoration: BoxDecoration(
                                        color: isDark ? Colors.white.withOpacity(0.02) : Colors.black.withOpacity(0.01),
                                        borderRadius: BorderRadius.circular(16),
                                        border: Border.all(
                                          color: isDark ? Colors.white.withOpacity(0.04) : Colors.black.withOpacity(0.03),
                                        ),
                                      ),
                                      child: Center(
                                        child: Column(
                                          children: [
                                            Icon(
                                              PhosphorIcons.calendarBlank,
                                              size: 32,
                                              color: AppColors.textSecondary(context).withOpacity(0.5),
                                            ),
                                            const SizedBox(height: 10),
                                            Text(
                                              getText('alert_list_empty_generic'),
                                              style: AppTypography.bodySecondary(context).copyWith(
                                                color: AppColors.textSecondary(context),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  for (var item in obj['agendamentos'])
                                    GestureDetector(
                                      onTap: () {
                                        if (_canEditAgendamento(item)) {
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute(builder: (_) => NewReserva(obj: obj, objEditReserva: item)),
                                          ).then((_) => load());
                                        }
                                      },
                                      child: CellMoradorAgendamento(item: item, canEdit: _canEditAgendamento(item)),
                                    ),
                                ],
                                const SizedBox(height: AppSpacing.xxxl),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
      floatingActionButton: (getUserType() == 'sindico' || getUserPermission('areas_sociais') == 1)
          ? FloatingActionButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NewAreaSocial(isEdit: true, obj: obj, myId: obj['id'])),
              ).then((_) => load()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.pencil, color: Colors.white),
            )
          : null,
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;

  const _Tag({
    required this.label,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: color.withOpacity(0.2),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: color,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: AppTypography.caption(context).copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
