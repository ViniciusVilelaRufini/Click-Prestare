import 'package:click/utils/log.dart';
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
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_area_social.dart';
import 'widgets/minha_reserva_card.dart';
import 'widgets/reserva_helpers.dart';

class AreaSocialDetail extends StatefulWidget {
  const AreaSocialDetail({super.key, this.myId});
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

  /// Sem prazo, uma chamada travada deixava o skeleton do clima para sempre.
  /// O TimeoutException cai no catch e o finally encerra o carregamento.
  static const Duration _weatherTimeout = Duration(seconds: 8);

  Future<void> _fetchWeatherForCondominium() async {
    try {
      // Sem previsão confirmada o widget não aparece: limpa o dado antigo.
      setState(() {
        _weatherLoading = true;
        _temp = null;
      });
      final condInfo = await getCondominio(Singleton.instance.id_condominio);
      if (condInfo != null && condInfo is Map<String, dynamic>) {
        final String city = condInfo['cidade'] ?? '';
        final String stateCode = condInfo['uf'] ?? '';
        _cityName = city;
        if (city.isNotEmpty) {
          final geoUrl = Uri.parse("https://nominatim.openstreetmap.org/search?city=${Uri.encodeComponent(city)}&state=${Uri.encodeComponent(stateCode)}&country=Brazil&format=json&limit=1");
          final geoResponse = await http
              .get(geoUrl, headers: {'User-Agent': 'ClickCondominioWeatherApp/1.0'})
              .timeout(_weatherTimeout);
          if (geoResponse.statusCode == 200) {
            final geoData = jsonDecode(geoResponse.body) as List<dynamic>;
            if (geoData.isNotEmpty) {
              final lat = geoData[0]['lat'];
              final lon = geoData[0]['lon'];

              final weatherUrl = Uri.parse("https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,weather_code&timezone=auto");
              final weatherResponse = await http.get(weatherUrl).timeout(_weatherTimeout);
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
      logDebug("[Weather Detail] Error: $e");
    } finally {
      if (mounted) {
        setState(() => _weatherLoading = false);
      }
    }
  }

  /// Síndico e funcionário (com ou sem a permissão `areas_sociais`, como
  /// hoje) veem a agenda de todos (pendente/aprovada); o morador só as do
  /// próprio apto. Ver não é editar: a edição segue `_canEditAgendamento`.
  bool get _podeVerTodas =>
      getUserType() == 'sindico' ||
      getUserType() == 'funcionario' ||
      getUserPermission('areas_sociais') == 1;

  /// Mesma condição do antigo botão "Nova reserva": a área exige agendamento
  /// e o usuário não é funcionário.
  bool get _podeReservar =>
      obj != null && obj['precisa_agendar'] == 1 && getUserType() != 'funcionario';

  /// Reservas exibidas. Pendente/aprovada de todos para quem pode ver todas;
  /// para o morador, as do próprio bloco/apto (pendente, aprovada e recusada).
  /// Quem não é morador nem privilegiado não tem apto: lista vazia.
  List<dynamic> _reservasExibidas() {
    final lista = obj['agendamentos'];
    final morador = getUserType() == 'morador';
    return reservasVisiveis(
      lista is List ? lista : null,
      podeVerTodas: _podeVerTodas,
      bloco: morador ? Singleton.instance.bloco.toString() : null,
      apto: morador ? Singleton.instance.apartamento.toString() : null,
    );
  }

  void _abrirNovaReserva() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NewReserva(obj: obj)),
    ).then((_) => load());
  }

  void _abrirEdicaoReserva(dynamic item) {
    if (!_canEditAgendamento(item)) return;
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => NewReserva(obj: obj, objEditReserva: item)),
    ).then((_) => load());
  }

  bool _canEditAgendamento(dynamic item) {
    return getUserType() == 'sindico' ||
        getUserPermission('areas_sociais') == 1 ||
        (getUserType() == 'morador' &&
            Singleton.instance.bloco.toString() == item['bloco'] &&
            Singleton.instance.apartamento.toString() == item['apto']);
  }

  Widget _buildHeroHeader() {
    return Container(
      width: double.infinity,
      height: 220,
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          _buildAreaHeaderImage(obj['imagem']?.toString() ?? ''),
          // Gradient Overlay
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.15),
                  Colors.black.withValues(alpha: 0.65),
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
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
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
                    // Flexible: em 320dp "Capacidade indeterminada" + selo de
                    // ocupação estourava a linha.
                    Flexible(
                      child: Text(
                        obj['capacidade'].toString() != '-1'
                            ? '${obj['capacidade']} ${getText('pessoas')}'
                            : getText('capacidade_indeterminada'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.body(context).copyWith(
                          color: Colors.white70,
                          fontWeight: FontWeight.w500,
                        ),
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

  Widget _buildAreaHeaderImage(String imagemUrl) {
    final clean = imagemUrl.trim();
    if (clean.isEmpty) return _buildPlaceholderHeader();

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return Image.network(
        clean,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _buildPlaceholderHeader(),
      );
    }

    try {
      final base64Part = clean.contains('base64,') ? clean.split('base64,')[1] : clean;
      final bytes = base64Decode(base64Part.trim());
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => _buildPlaceholderHeader(),
      );
    } catch (_) {
      return _buildPlaceholderHeader();
    }
  }

  Widget _buildPlaceholderHeader() {
    return Container(
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
    );
  }

  // Selo de ocupação ao vivo ("quantas pessoas estão dentro agora"), exibido no
  // cabeçalho quando a área tem terminal(is) faciais/catraca vinculados.
  Widget _buildOcupacaoChip(int ocupacao) {
    final vazia = ocupacao <= 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.35),
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

  /// Clima em chip discreto na linha das tags. O resultado vem de
  /// `_fetchWeatherForCondominium` (timeout de 8 s); sem previsão confirmada
  /// (falha, timeout, cidade vazia) o chip some.
  Widget? _buildWeatherWidget() {
    if (_weatherLoading) {
      return AppSkeleton(width: 108, height: 30, borderRadius: AppRadius.full);
    }

    if (_temp == null) return null;

    final desc = _weatherDesc ?? 'Tempo limpo';
    final temp = '${_temp!.round()}°C';
    final cidade = (_cityName ?? '').trim();
    final local = cidade.isEmpty ? 'o condomínio' : cidade;

    return Tooltip(
      message: 'Previsão para $local',
      child: Semantics(
        label: 'Previsão para $local: $desc, $temp',
        excludeSemantics: true,
        child: _ChipInfo(
          icon: _weatherIcon ?? PhosphorIcons.sun,
          label: '$temp · $desc',
        ),
      ),
    );
  }

  Widget _linhaChips() {
    final clima = _buildWeatherWidget();
    final chips = <Widget>[
      if (obj['precisa_agendar'] == 1)
        _ChipInfo(
          label: 'Agendamento',
          descricao: getText('area_social_precisa_agendamento'),
          icon: PhosphorIcons.calendarCheck,
          color: AppColors.primary,
        ),
      if (obj['precisa_autorizacao'] == 1)
        _ChipInfo(
          label: 'Autorização',
          descricao: getText('area_social_precisa_autorizacao'),
          icon: PhosphorIcons.shieldCheck,
          color: Colors.teal,
        ),
      if (obj['precisa_pagamento'] == 1)
        _ChipInfo(
          label: 'Pagamento',
          descricao: getText('area_social_precisa_pagamento'),
          icon: PhosphorIcons.creditCard,
          color: Colors.orange,
        ),
      if (clima != null) clima,
    ];
    if (chips.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: chips,
    );
  }

  /// Destaque (texto/ícone) sobre fundo tingido de primária: o primário puro
  /// tem pouco contraste sobre a superfície escura.
  Color _destaque() =>
      Theme.of(context).brightness == Brightness.dark ? const Color(0xFF93B4F8) : AppColors.primaryDark;

  Widget _cardRegras() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Material(
      color: AppColors.surfaceElevated(context),
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.rlg,
        side: BorderSide(color: AppColors.border(context)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        // Sem as linhas divisórias que o ExpansionTile desenha ao abrir.
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          shape: const Border(),
          collapsedShape: const Border(),
          tilePadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xs),
          childrenPadding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          expandedAlignment: Alignment.centerLeft,
          iconColor: AppColors.textSecondary(context),
          collapsedIconColor: AppColors.textSecondary(context),
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
              borderRadius: AppRadius.rmd,
            ),
            child: Icon(PhosphorIcons.scroll, size: 20, color: _destaque()),
          ),
          title: Text(
            'Regras de uso',
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(context),
            ),
          ),
          subtitle: Text(
            'Leia antes de reservar',
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
          children: [
            Divider(height: 1, color: AppColors.border(context)),
            const SizedBox(height: AppSpacing.md),
            Text(
              obj['regras'].toString().trim(),
              style: AppTypography.body(context).copyWith(height: 1.45),
            ),
          ],
        ),
      ),
    );
  }

  Widget _avisoFacial() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: isDark ? 0.14 : 0.06),
        borderRadius: AppRadius.rmd,
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(PhosphorIcons.userCircle, size: 18, color: _destaque()),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Acesso por reconhecimento facial: liberado automaticamente durante o horário da sua reserva aprovada.',
              style: AppTypography.caption(context).copyWith(color: AppColors.textPrimary(context)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _secaoReservas() {
    final todas = _podeVerTodas;
    final reservas = _reservasExibidas();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                todas ? 'Reservas' : 'Minhas reservas',
                style: AppTypography.title(context).copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(context),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (reservas.isNotEmpty) ...[
              const SizedBox(width: AppSpacing.sm),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.surface(context),
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  border: Border.all(color: AppColors.border(context)),
                ),
                child: Text(
                  '${reservas.length}',
                  style: AppTypography.captionMedium(context).copyWith(
                    color: AppColors.textSecondary(context),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
        if (todas) ...[
          const SizedBox(height: 2),
          Text(
            'Pendentes e aprovadas de todos os apartamentos',
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        if (obj['tem_monitoramento'] == true) _avisoFacial(),
        if (reservas.isEmpty)
          _estadoVazioReservas(todas)
        else
          for (final item in reservas)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: MinhaReservaCard(
                reserva: item,
                mostrarApto: todas,
                // Regra estrita de edição: síndico, permissão ou o próprio apto.
                onEditar: _canEditAgendamento(item) ? () => _abrirEdicaoReserva(item) : null,
              ),
            ),
      ],
    );
  }

  Widget _estadoVazioReservas(bool todas) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xxl),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.calendarBlank, size: 26, color: _destaque()),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Nenhuma reserva ainda',
            textAlign: TextAlign.center,
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            todas
                ? 'Não há reservas pendentes ou aprovadas para este espaço.'
                : _podeReservar
                    ? 'Quando você reservar este espaço, a reserva aparece aqui.'
                    : 'Suas reservas deste espaço aparecem aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
        ],
      ),
    );
  }

  Widget _rodape() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
          child: AppButton(
            label: 'Reservar este espaço',
            icon: PhosphorIcons.calendarPlus,
            onPressed: _abrirNovaReserva,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final podeEditarArea = getUserType() == 'sindico' || getUserPermission('areas_sociais') == 1;
    final carregado = !_isLoading && obj != null;
    final temRegras = carregado && (obj['regras'] ?? '').toString().trim().isNotEmpty;

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
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _buildHeroHeader(),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _linhaChips(),
                                if (temRegras) ...[
                                  const SizedBox(height: AppSpacing.lg),
                                  _cardRegras(),
                                ],
                                if (obj['precisa_agendar'] == 1) ...[
                                  const SizedBox(height: AppSpacing.xl),
                                  _secaoReservas(),
                                ],
                                // Folga para o FAB de editar a área não cobrir o
                                // último card.
                                SizedBox(height: podeEditarArea ? 88 : AppSpacing.xl),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
      floatingActionButton: podeEditarArea
          ? FloatingActionButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NewAreaSocial(isEdit: true, obj: obj, myId: obj['id'])),
              ).then((_) => load()),
              backgroundColor: AppColors.primary,
              child: const Icon(PhosphorIcons.pencil, color: Colors.white),
            )
          : null,
      // No bottomNavigationBar o Scaffold posiciona o FAB acima do rodapé.
      bottomNavigationBar: carregado && _podeReservar ? _rodape() : null,
    );
  }
}

/// Chip compacto da linha de informações (tags da área e clima). Com [color]
/// fica tingido; sem, neutro e discreto. [descricao] é o texto completo para
/// o leitor de tela e o tooltip.
class _ChipInfo extends StatelessWidget {
  final String label;
  final String? descricao;
  final IconData icon;
  final Color? color;

  const _ChipInfo({
    required this.label,
    required this.icon,
    this.descricao,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final base = color;
    // Texto/ícone com contraste sobre o fundo tingido nos dois temas.
    final Color fg;
    final Color bg;
    final Color borda;
    if (base == null) {
      fg = AppColors.textSecondary(context);
      bg = AppColors.surface(context);
      borda = AppColors.border(context);
    } else {
      fg = isDark ? Color.lerp(base, Colors.white, 0.45)! : Color.lerp(base, Colors.black, 0.35)!;
      bg = base.withValues(alpha: isDark ? 0.18 : 0.08);
      borda = base.withValues(alpha: isDark ? 0.35 : 0.22);
    }

    Widget chip = Container(
      constraints: const BoxConstraints(minHeight: 30),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: borda),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.caption(context).copyWith(
                color: fg,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );

    final texto = descricao;
    if (texto != null) {
      chip = Tooltip(
        message: texto,
        child: Semantics(label: texto, excludeSemantics: true, child: chip),
      );
    }
    return chip;
  }
}
