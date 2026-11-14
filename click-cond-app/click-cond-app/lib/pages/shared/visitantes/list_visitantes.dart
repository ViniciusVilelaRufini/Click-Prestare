import 'dart:ui';
import 'dart:async';
import 'dart:convert';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/visitantes/acessos_facial_list.dart';
import 'package:click/pages/shared/visitantes/new_visitante.dart';
import 'package:click/pages/shared/visitantes/pendentes_visitante.dart';
import 'package:click/pages/shared/visitantes/convites_visita.dart';
import 'package:click/pages/shared/visitantes/compartilhar_passe.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/visitantes_presenca.dart';
import 'package:click/utils/visitantes_pessoas.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_segmented_control.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/utils/datas.dart';
import 'package:click/widgets/app/cabecalho_pessoa.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

class ListVisitantes extends StatefulWidget {
  final bool allCondos;
  final bool hideAppBar;
  final bool showFab;
  const ListVisitantes({
    super.key,
    this.allCondos = false,
    this.hideAppBar = false,
    this.showFab = true,
  });
  @override
  ListVisitantesPageState createState() => ListVisitantesPageState();
}

class ListVisitantesPageState extends State<ListVisitantes> {
  final txtSearch = TextEditingController();
  Timer? _timerSearch;
  List<dynamic> list = [];
  bool _isLoading = false;
  bool _isFabExpanded = true;
  int _pendentesCount = 0;
  // Esta tela mostra visitantes e prestadores no mesmo lugar; o chip escolhe o recorte.
  String _tipoFiltro = 'todos'; // todos | visitantes | prestadores

  @override
  void initState() {
    super.initState();
    loadList();
    _loadPendentes();
  }

  Future<void> _loadPendentes() async {
    final data = await apiGetPendentes();
    if (!mounted) return;
    setState(() => _pendentesCount = data is List ? data.length : 0);
  }

  void _abrirPendentes() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const PendentesVisitantePage()),
    ).then((_) => _loadPendentes());
  }

  @override
  void dispose() {
    txtSearch.dispose();
    _timerSearch?.cancel();
    super.dispose();
  }

  Future<void> _registrarEntrada(dynamic item) async {
    final id = item['id'];
    if (id == null) return;
    final result = await apiCheckInVisitante(id as int);
    if (!mounted) return;
    if (result is Map) {
      // Sucesso
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Entrada de ${item['nome'] ?? 'visitante'} registrada com sucesso!'),
          backgroundColor: AppColors.success,
          duration: const Duration(seconds: 3),
        ),
      );
      loadList();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Erro: ${result ?? 'Não foi possível registrar a entrada.'}'),
          backgroundColor: AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  Future<void> _registrarSaida(dynamic item) async {
    final id = item['id'];
    if (id == null) return;
    final result = await apiCheckOutVisitante(id as int);
    if (!mounted) return;
    if (result is Map) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Baixa na visita de ${item['nome'] ?? 'visitante'} realizada com sucesso!'),
          backgroundColor: AppColors.brand,
          duration: const Duration(seconds: 3),
        ),
      );
      loadList();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'Erro: ${result ?? 'Não foi possível dar baixa na visita.'}'),
          backgroundColor: AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  void _confirmarSaida(dynamic item) {
    final nome = item['nome'] ?? 'visitante';
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        title: const Text('Encerrar Visita'),
        content: Text('Deseja registrar a saída de $nome?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancelar',
                style: TextStyle(color: AppColors.textSecondary(context))),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _registrarSaida(item);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: AppColors.onPrimary,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.zero),
              elevation: 0,
            ),
            child: Text('Encerrar',
                style: TextStyle(
                    color: AppColors.onPrimary, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> loadList() async {
    try {
      // Stale-while-revalidate: skeleton só sem cache; ao voltar, mantém a lista.
      if (list.isEmpty) setState(() => _isLoading = true);
      list = await apiGetAllVisitantes(txtSearch.text,
          allCondos: widget.allCondos);
    } catch (e) {
      if (mounted)
        displayMessage(
            context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Permissão de agir sobre o registro: prestador exige a permissão de
  /// prestadores, visitante a de visitantes. Como a lista virou conjunta,
  /// não dá para checar só 'cadastrar_visitante'.
  bool _canManage(dynamic item) {
    if (getUserType() != 'funcionario') return true;
    final isPrestador = item['is_prestador'] == 1;
    return getUserPermission(
            isPrestador ? 'prestadores_servico' : 'cadastrar_visitante') ==
        1;
  }

  void _showVisitanteDetails(BuildContext context, dynamic item) {
    final isInside = item['data_entrada'] != null && item['data_saida'] == null;
    final canAdd = _canManage(item);

    bool isExpired = false;
    final endStr = item['data_hora_termino'];
    if (endStr != null) {
      final end = DateTime.tryParse(endStr.toString());
      if (end != null && DateTime.now().isAfter(end)) {
        isExpired = true;
      }
    }

    bool isAuthorized = false;
    if (!isInside && item['data_saida'] == null && !isExpired) {
      final startStr = item['data_hora_inicio'];
      if (startStr != null && endStr != null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          isAuthorized =
              DateTime.now().isAfter(start) && DateTime.now().isBefore(end);
        }
      }
    }

    final _sw = MediaQuery.of(context).size.width;
    final _sh = MediaQuery.of(context).size.height;
    final _hPad = _sw < 360 ? 14.0 : 20.0;
    final _pinSize = _sw < 360 ? 26.0 : 32.0;
    final _initSize = _sh < 700 ? 0.95 : 0.88;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: _initSize,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, scrollCtrl) {
            return Container(
              decoration: BoxDecoration(
                color: AppColors.bg(context),
                borderRadius:
                    BorderRadius.zero,
              ),
              child: Column(
                children: [
                  // Handle bar fixo
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Center(
                        child: Container(
                      width: 40,
                      height: 3,
                      decoration: BoxDecoration(
                        color: AppColors.borderStrong(context),
                      ),
                    )),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      controller: scrollCtrl,
                      padding: EdgeInsets.fromLTRB(_hPad, 4, _hPad, _hPad),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: AppSpacing.md),
                          Row(
                            children: [
                              _buildVisitanteAvatar(context, item, radius: 28),
                              const SizedBox(width: AppSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            item['nome'] ?? '',
                                            style:
                                                AppTypography.headline(context),
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        _buildFaceBadge(
                                            context,
                                            item['face_sync_status']
                                                ?.toString()),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        if (isInside)
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: AppColors.success
                                                  .withValues(alpha: 0.1),
                                              borderRadius:
                                                  BorderRadius.zero,
                                            ),
                                            child: Text(
                                              'NO LOCAL',
                                              style: AppTypography.tiny(context)
                                                  .copyWith(
                                                color: AppColors.success,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          )
                                        else if (isAuthorized)
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: AppColors.primary
                                                  .withValues(alpha: 0.1),
                                              borderRadius:
                                                  BorderRadius.zero,
                                            ),
                                            child: Text(
                                              'AUTORIZADO',
                                              style: AppTypography.tiny(context)
                                                  .copyWith(
                                                color: AppColors.primary,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          )
                                        else
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: AppColors.textSecondary(
                                                      context)
                                                  .withValues(alpha: 0.1),
                                              borderRadius:
                                                  BorderRadius.zero,
                                            ),
                                            child: Text(
                                              'AGENDADO',
                                              style: AppTypography.tiny(context)
                                                  .copyWith(
                                                color: AppColors.textSecondary(
                                                    context),
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                        const SizedBox(width: 8),
                                        Text(
                                          item['is_prestador'] == 1
                                              ? 'Prestador'
                                              : 'Visitante',
                                          style: AppTypography.caption(context),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xl),

                          if (item['condominio_nome'] != null &&
                              item['condominio_nome']
                                  .toString()
                                  .trim()
                                  .isNotEmpty)
                            _buildDetailRow(
                              context,
                              icon: PhosphorIcons.buildings,
                              label: 'Condomínio',
                              value: item['condominio_nome'].toString(),
                            ),
                          _buildDetailRow(
                            context,
                            icon: PhosphorIcons.houseLine,
                            label: 'Unidade',
                            value:
                                '${(item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim().isNotEmpty && (item['apto_bloco'] ?? item['bloco'] ?? '').toString() != 'null' ? '${(item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim()} - ' : ''}${item['apto'] ?? ''}',
                          ),
                          if (item['doc_identificacao'] != null &&
                              item['doc_identificacao']
                                  .toString()
                                  .trim()
                                  .isNotEmpty)
                            _buildDetailRow(
                              context,
                              icon: PhosphorIcons.identificationCard,
                              label: 'Documento',
                              value: item['doc_identificacao'].toString(),
                            ),

                          _buildDetailRow(
                            context,
                            icon: PhosphorIcons.calendarBlank,
                            label: 'Período Autorizado',
                            value: _formatPeriod(item['data_hora_inicio'],
                                item['data_hora_termino']),
                          ),

                          if (item['data_entrada'] != null)
                            _buildDetailRow(
                              context,
                              icon: PhosphorIcons.signIn,
                              label: 'Entrada Registrada',
                              value:
                                  _formatDateTimeString(item['data_entrada']),
                            ),

                          if (item['data_saida'] != null)
                            _buildDetailRow(
                              context,
                              icon: PhosphorIcons.signOut,
                              label: 'Saída Registrada',
                              value: _formatDateTimeString(item['data_saida']),
                            ),

                          // Últimos acessos do visitante (entrada/saída + método + horário).
                          // Sempre exibido: o widget trata loading e empty state internamente,
                          // então cobre tag/QR/PIN/botoeira, não só visitantes com face cadastrada.
                          const SizedBox(height: AppSpacing.md),
                          AcessosFacialList(idVisitante: item['id']),

                          // Google Maps / Block route sharing section
                          const SizedBox(height: AppSpacing.lg),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: AppColors.surface(context),
                              borderRadius: BorderRadius.zero,
                              border: Border.all(
                                color: AppColors.border(context),
                                width: 1.1,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(PhosphorIcons.mapPin,
                                        color: AppColors.primary, size: 18),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Mapeamento do Bloco',
                                      style: AppTypography.caption(context)
                                          .copyWith(
                                        color: AppColors.textPrimary(context),
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                Text(
                                  'Compartilhe a localização exata do seu bloco com o entregador ou visitante para facilitar a chegada.',
                                  style: AppTypography.tiny(context).copyWith(
                                      color: AppColors.textSecondary(context)),
                                ),
                                const SizedBox(height: AppSpacing.md),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        icon: const Icon(
                                            PhosphorIcons.navigationArrow,
                                            size: 16),
                                        label: const Text('Abrir Rota'),
                                        onPressed: () async {
                                          final cond =
                                              item['condominio_nome'] ??
                                                  'Condomínio';
                                          final bloco = item['apto_bloco'] ??
                                              item['bloco'] ??
                                              '';
                                          final query = Uri.encodeComponent(
                                              '$cond $bloco');
                                          final url = Uri.parse(
                                              'https://www.google.com/maps/search/?api=1&query=$query');
                                          if (await canLaunchUrl(url)) {
                                            await launchUrl(url,
                                                mode: LaunchMode
                                                    .externalApplication);
                                          }
                                        },
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: AppColors.primary,
                                          side: BorderSide(
                                              color: AppColors.primary
                                                  .withValues(alpha: 0.4)),
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.zero),
                                          padding: const EdgeInsets.symmetric(
                                              vertical: 10),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: ElevatedButton.icon(
                                        icon: const Icon(
                                            PhosphorIcons.shareNetwork,
                                            size: 16),
                                        label: const Text('Compartilhar'),
                                        onPressed: () async {
                                          final cond =
                                              item['condominio_nome'] ??
                                                  'Condomínio';
                                          final bloco = item['apto_bloco'] ??
                                              item['bloco'] ??
                                              '';
                                          final query = Uri.encodeComponent(
                                              '$cond $bloco');
                                          final mapsUrl =
                                              'https://www.google.com/maps/search/?api=1&query=$query';
                                          final shareText =
                                              'Olá! Aqui está a rota do Google Maps para o meu bloco ($bloco) no $cond: $mapsUrl';
                                          final whatsappUrl = Uri.parse(
                                              'https://api.whatsapp.com/send?text=${Uri.encodeComponent(shareText)}');
                                          if (await canLaunchUrl(whatsappUrl)) {
                                            await launchUrl(whatsappUrl,
                                                mode: LaunchMode
                                                    .externalApplication);
                                          } else {
                                            await Clipboard.setData(
                                                ClipboardData(text: shareText));
                                            if (context.mounted) {
                                              ScaffoldMessenger.of(context)
                                                  .showSnackBar(
                                                SnackBar(
                                                  content: const Text(
                                                      'Texto de compartilhamento copiado!'),
                                                  duration: const Duration(
                                                      seconds: 2),
                                                ),
                                              );
                                            }
                                          }
                                        },
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppColors.brand,
                                          foregroundColor: AppColors.onBrand,
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.zero),
                                          padding: const EdgeInsets.symmetric(
                                              vertical: 10),
                                          elevation: 0,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),

                          if (item['data_saida'] == null && !isExpired) ...[
                            const SizedBox(height: AppSpacing.lg),
                            Container(
                              width: double.infinity,
                              decoration: BoxDecoration(
                                color: AppColors.surface(context),
                                border: Border.all(
                                    color: AppColors.border(context)),
                              ),
                              child: Column(
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                        AppSpacing.md,
                                        AppSpacing.md,
                                        AppSpacing.md,
                                        AppSpacing.sm),
                                    child: Row(
                                      children: [
                                        Icon(PhosphorIcons.shieldCheck,
                                            color: AppColors.textSecondary(context),
                                            size: 18),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: FittedBox(
                                            fit: BoxFit.scaleDown,
                                            alignment: Alignment.centerLeft,
                                            child: Text(
                                              'Código de Acesso para Portaria'
                                                  .toUpperCase(),
                                              style: AppTypography.label(context),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (temPinParaExibir(item)) ...[
                                    const SizedBox(height: 10),
                                    // PIN numérico
                                    Text(
                                      'PIN',
                                      style: AppTypography.label(context),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      item['codigo_acesso'].toString().length ==
                                              6
                                          ? "${item['codigo_acesso'].toString().substring(0, 3)}-${item['codigo_acesso'].toString().substring(3, 6)}"
                                          : item['codigo_acesso'].toString(),
                                      style:
                                          AppTypography.display(context).copyWith(
                                        color: AppColors.brandInk,
                                        letterSpacing: _pinSize * 0.14,
                                        fontWeight: FontWeight.w500,
                                        fontSize: _pinSize,
                                        fontFeatures: const [
                                          FontFeature.tabularFigures()
                                        ],
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    // Passe (link com QR que muda a cada 30 s) e o PIN para copiar.
                                    Padding(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: AppSpacing.md),
                                      child: Column(
                                        children: [
                                          BotoesPasse(item: item),
                                          const SizedBox(height: 8),
                                          SizedBox(
                                            width: double.infinity,
                                            child: OutlinedButton.icon(
                                              icon: const Icon(PhosphorIcons.copy, size: 16),
                                              label: Text('Copiar código'.toUpperCase()),
                                              onPressed: () {
                                                Clipboard.setData(ClipboardData(
                                                        text: item['codigo_acesso']
                                                            .toString()))
                                                    .then((_) {
                                                  if (context.mounted) {
                                                    ScaffoldMessenger.of(context)
                                                        .showSnackBar(
                                                      SnackBar(
                                                        content: const Text(
                                                            'Código PIN copiado!'),
                                                        duration: const Duration(
                                                            seconds: 2),
                                                      ),
                                                    );
                                                  }
                                                });
                                              },
                                              style: OutlinedButton.styleFrom(
                                                foregroundColor: AppColors.textPrimary(context),
                                                minimumSize: const Size(0, 48),
                                                side: BorderSide(
                                                    color: AppColors.borderStrong(context)),
                                                shape: const RoundedRectangleBorder(),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(height: AppSpacing.md),
                                    Text(
                                      'O visitante abre o passe e mostra o QR no leitor, ou informa o PIN na portaria.',
                                      textAlign: TextAlign.center,
                                      style:
                                          AppTypography.tiny(context).copyWith(
                                        color: AppColors.textTertiary(context),
                                      ),
                                    ),
                                    const SizedBox(height: AppSpacing.md),
                                  ] else ...[
                                    Padding(
                                      padding:
                                          const EdgeInsets.all(AppSpacing.lg),
                                      child: Column(
                                        children: [
                                          Icon(PhosphorIcons.spinnerGap,
                                              color: AppColors.primary,
                                              size: 32),
                                          const SizedBox(height: AppSpacing.sm),
                                          Text(
                                            'Gerando código de acesso...',
                                            style: AppTypography.caption(
                                                    context)
                                                .copyWith(
                                                    color:
                                                        AppColors.textSecondary(
                                                            context)),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            'Reabra este visitante em alguns instantes.',
                                            style: AppTypography.tiny(context)
                                                .copyWith(
                                                    color:
                                                        AppColors.textTertiary(
                                                            context)),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ] else ...[
                            const SizedBox(height: AppSpacing.lg),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(AppSpacing.md),
                              decoration: BoxDecoration(
                                color: AppColors.textSecondary(context)
                                    .withValues(alpha: 0.05),
                                borderRadius: BorderRadius.zero,
                                border: Border.all(
                                    color: AppColors.textSecondary(context)
                                        .withValues(alpha: 0.2)),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(PhosphorIcons.lock,
                                      color: AppColors.textSecondary(context),
                                      size: 18),
                                  const SizedBox(width: 8),
                                  Text(
                                    item['data_saida'] != null
                                        ? 'Visita Encerrada (Código Expirado)'
                                        : 'Período Expirado (Código Inativo)',
                                    style: AppTypography.captionMedium(context)
                                        .copyWith(
                                      color: AppColors.textSecondary(context),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],

                          const SizedBox(height: 20),
                          // Botões de ação
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Botão REGISTRAR ENTRADA: quando ainda não entrou e não expirou
                              if (canAdd &&
                                  item['data_entrada'] == null &&
                                  item['data_saida'] == null &&
                                  !isExpired) ...[
                                SizedBox(
                                  width: double.infinity,
                                  height: 48,
                                  child: ElevatedButton.icon(
                                    onPressed: () async {
                                      Navigator.pop(ctx);
                                      await _registrarEntrada(item);
                                    },
                                    icon: Icon(PhosphorIcons.signIn,
                                        size: 20, color: AppColors.onPrimary),
                                    label: Text(
                                      'Registrar Entrada',
                                      style: TextStyle(
                                        color: AppColors.onPrimary,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                      ),
                                    ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.success,
                                      shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.zero),
                                      elevation: 0,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 12),
                              ] else if (canAdd &&
                                  item['data_saida'] == null) ...[
                                // Botão DAR BAIXA NA VISITA (REGISTRAR SAÍDA): quando o visitante já entrou ou a visita está em andamento
                                SizedBox(
                                  width: double.infinity,
                                  height: 48,
                                  child: ElevatedButton.icon(
                                    onPressed: () async {
                                      Navigator.pop(ctx);
                                      await _registrarSaida(item);
                                    },
                                    icon: Icon(PhosphorIcons.signOut,
                                        size: 20, color: AppColors.onPrimary),
                                    label: Text(
                                      'Dar Baixa na Visita',
                                      style: TextStyle(
                                        color: AppColors.onPrimary,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                      ),
                                    ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.error,
                                      shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.zero),
                                      elevation: 0,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 12),
                              ],
                              // Botões secundários: Fechar + Editar
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: () => Navigator.pop(ctx),
                                      style: OutlinedButton.styleFrom(
                                        minimumSize: const Size.fromHeight(48),
                                        side: BorderSide(
                                            color:
                                                AppColors.textTertiary(context)
                                                    .withValues(alpha: 0.3)),
                                        shape: RoundedRectangleBorder(
                                            borderRadius:
                                                BorderRadius.zero),
                                      ),
                                      child: Text('Fechar'.toUpperCase(),
                                          style: AppTypography.body(context)),
                                    ),
                                  ),
                                  if (podeEditarVisitante(
                                      userType: getUserType(),
                                      canManage: canAdd)) ...[
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: ElevatedButton.icon(
                                        onPressed: () {
                                          Navigator.pop(ctx);
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => NewVisitante(
                                                isEdit: true,
                                                myId: item['id'],
                                              ),
                                            ),
                                          ).then((_) => loadList());
                                        },
                                        icon: Icon(
                                            PhosphorIcons.pencilSimple,
                                            color: AppColors.onBrand,
                                            size: 18),
                                        label: Text(
                                          'Editar',
                                          style: TextStyle(
                                            color: AppColors.onBrand,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppColors.brand,
                                          minimumSize:
                                              const Size.fromHeight(48),
                                          shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.zero),
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 16),
                                          elevation: 0,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildDetailRow(BuildContext context,
      {required IconData icon, required String label, required String value}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.textSecondary(context)),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTypography.caption(context).copyWith(
                    color: AppColors.textTertiary(context),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: AppTypography.bodyMedium(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatPeriod(dynamic start, dynamic end) => periodoDoConvite(start, end);

  String _formatDateTimeString(dynamic val) {
    if (val == null) return '';
    final d = parseDataApi(val);
    if (d == null) return val.toString();
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  /// Mesma checagem de `_temApto` em my_condominium.dart.
  bool get _temUnidadeVinculada {
    final id = Singleton.instance.id_apartamento;
    return id != null && id is int && id > 0;
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = (getUserType() != 'funcionario') ||
        getUserPermission('cadastrar_visitante') == 1;

    // Lista conjunta: visitantes + prestadores. O chip escolhe o recorte e é
    // aplicado antes das abas, para os contadores refletirem o filtro.
    // Os chips contam PESSOAS, não visitas: quem entrou 20 vezes conta 1,
    // igual à aba "Cadastrados".
    final prestadoresCount = deduplicarPessoas(
        list.where((e) => e['is_prestador'] == 1)).length;
    final visitantesCount = deduplicarPessoas(
        list.where((e) => e['is_prestador'] != 1)).length;
    final todosCount = deduplicarPessoas(list).length;
    final visitorsOnlyList = _tipoFiltro == 'todos'
        ? list.toList()
        : list
            .where((e) => _tipoFiltro == 'prestadores'
                ? e['is_prestador'] == 1
                : e['is_prestador'] != 1)
            .toList();

    // A regra mora em utils/visitantes_presenca.dart, em funções puras, para
    // ser testável e para as duas superfícies contarem igual.
    // "No local" conta só quem REGISTROU ENTRADA e não saiu. Antes somava
    // também quem tinha liberação ativa — e como todo visitante nasce com
    // `liberado = 1` (default da tabela, por causa do PIN), o contador nunca
    // chegava a zero e a aba dizia que havia gente no prédio com ele vazio.
    //
    // Quem está autorizado e ainda não chegou aparece em "Cadastrados".
    final listInside =
        visitorsOnlyList.where((e) => estaNoLocal(e as Map)).toList();

    // Filtrar visitantes cadastrados únicos para histórico e liberação rápida.
    // Mesma regra de pessoa dos chips (utils/visitantes_pessoas.dart).
    final List<Map<String, dynamic>> listCadastrados =
        deduplicarPessoas(visitorsOnlyList);

    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: 'Visitantes e Prestadores',
        showBackButton: !widget.hideAppBar,
        safeAreaBottom: !widget.hideAppBar,
        actions: [
          // Convidar por link: manda o link no WhatsApp e a pessoa preenche
          // os próprios dados.
          //
          // O critério é TER UNIDADE VINCULADA, não o papel. O servidor já
          // exige exatamente isso (`gerar()` recusa quem não tem vínculo), e
          // uma tela com regra própria mais apertada só cria divergência: o
          // síndico quase sempre mora no prédio e não conseguiria convidar
          // ninguém para o próprio apartamento. O repositório já tem o
          // conceito — `_sindicoEhMorador` em my_condominium.dart.
          if (_temUnidadeVinculada)
            IconButton(
              tooltip: 'Convidar por link',
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const ConvitesVisitaPage()),
              ).then((_) => loadList()),
              icon: Icon(PhosphorIcons.link,
                  color: AppColors.textPrimary(context)),
            ),
          IconButton(
            tooltip: 'Solicitações pendentes',
            onPressed: _abrirPendentes,
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                Icon(PhosphorIcons.bell, color: AppColors.textPrimary(context)),
                if (_pendentesCount > 0)
                  Positioned(
                    right: -4,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      constraints:
                          const BoxConstraints(minWidth: 18, minHeight: 18),
                      decoration: BoxDecoration(
                        color: AppColors.error,
                        borderRadius: BorderRadius.zero,
                      ),
                      child: Text(
                        '$_pendentesCount',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            color: AppColors.onPrimary,
                            fontSize: 10,
                            fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
        floatingActionButton: canAdd && widget.showFab
            ? Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.zero,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.zero,
                  clipBehavior: Clip.antiAlias,
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeInOutCubic,
                      height: 56,
                      decoration: BoxDecoration(
                        color: AppColors.brand,
                        borderRadius: BorderRadius.zero,
                        border: Border.all(
                          color: AppColors.onBrand.withValues(alpha: 0.20),
                          width: 1.0,
                        ),
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => NewVisitante(isEdit: false),
                            ),
                          ).then((_) => loadList()),
                          borderRadius: BorderRadius.zero,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(PhosphorIcons.userPlus,
                                    color: AppColors.onBrand, size: 20),
                                Flexible(
                                  child: AnimatedSize(
                                    duration: const Duration(milliseconds: 300),
                                    curve: Curves.easeInOutCubic,
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        if (_isFabExpanded) ...[
                                          const SizedBox(width: 8),
                                          Flexible(
                                            child: Text(
                                              'Cadastrar visitante ou prestador'
                                                  .toUpperCase(),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style:
                                                  AppTypography.button(context).copyWith(color: AppColors.onBrand),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        body: NotificationListener<ScrollNotification>(
          onNotification: (ScrollNotification notification) {
            if (notification.metrics.axis != Axis.vertical) return false;
            if (notification is! ScrollUpdateNotification) return false;

            final m = notification.metrics;
            // Mesmo motivo da ilha da home: no iOS o repique do bounce gera
            // delta positivo ao voltar ao topo e encolhia o botão sozinho.
            if (m.outOfRange) return false;
            if (m.pixels <= m.minScrollExtent + 4) {
              if (!_isFabExpanded) setState(() => _isFabExpanded = true);
              return false;
            }

            final double delta = notification.scrollDelta ?? 0;
            if (delta > 3.0 && _isFabExpanded) {
              setState(() {
                _isFabExpanded = false;
              });
            } else if (delta < -3.0 && !_isFabExpanded) {
              setState(() {
                _isFabExpanded = true;
              });
            }
            return false;
          },
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
                child: SizedBox(
                  height: 44,
                  child: TextField(
                  controller: txtSearch,
                  onChanged: (v) {
                    _timerSearch?.cancel();
                    _timerSearch =
                        Timer(const Duration(milliseconds: 600), loadList);
                  },
                  style: AppTypography.body(context),
                  cursorColor: AppColors.primary,
                  decoration: InputDecoration(
                    hintText: getText('lb_buscar'),
                    hintStyle: AppTypography.body(context)
                        .copyWith(color: AppColors.textTertiary(context)),
                    prefixIcon: Icon(PhosphorIcons.magnifyingGlass,
                        size: 20, color: AppColors.textSecondary(context)),
                    filled: true,
                    fillColor: AppColors.surface(context),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.zero,
                        borderSide:
                            BorderSide(color: AppColors.border(context))),
                    enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.zero,
                        borderSide:
                            BorderSide(color: AppColors.border(context))),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md, vertical: 12),
                  ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: AppSegmentedControl(
                  selectedIndex: _tipoFiltro == 'todos'
                      ? 0
                      : (_tipoFiltro == 'visitantes' ? 1 : 2),
                  onChanged: (i) => setState(() => _tipoFiltro =
                      const ['todos', 'visitantes', 'prestadores'][i]),
                  segments: [
                    AppSegment(label: 'Todos', count: todosCount),
                    AppSegment(label: 'Visitantes', count: visitantesCount),
                    AppSegment(label: 'Prestadores', count: prestadoresCount),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                child: Builder(builder: (ctx) {
                  final tc = DefaultTabController.of(ctx);
                  return AnimatedBuilder(
                    animation: tc.animation!,
                    builder: (_, __) => Row(
                      children: [
                        Expanded(child: _TipoChip(
                          icon: PhosphorIcons.houseLine,
                          label: 'No local (${listInside.length})',
                          selected: tc.index == 0,
                          onTap: () => tc.animateTo(0),
                        )),
                        const SizedBox(width: 8),
                        Expanded(child: _TipoChip(
                          icon: PhosphorIcons.identificationCard,
                          label: 'Cadastrados (${listCadastrados.length})',
                          selected: tc.index == 1,
                          onTap: () => tc.animateTo(1),
                        )),
                      ],
                    ),
                  );
                }),
              ),
              Expanded(
                child: _isLoading
                    ? ListView.separated(
                        padding: EdgeInsets.only(
                          left: AppSpacing.lg,
                          right: AppSpacing.lg,
                          top: AppSpacing.lg,
                          bottom: fabClearance(context),
                        ),
                        itemCount: 8,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: AppSpacing.sm),
                        itemBuilder: (_, __) => AppSkeleton.listTile(context),
                      )
                    : TabBarView(
                        children: [
                          // ABA 1: No Condomínio
                          RefreshIndicator(
                            onRefresh: loadList,
                            child: listInside.isEmpty
                                ? _EmptyState(
                                    _tipoFiltro == 'prestadores'
                                        ? 'Nenhum prestador no local no momento.'
                                        : _tipoFiltro == 'visitantes'
                                            ? 'Nenhum visitante no local no momento.'
                                            : 'Ninguém no local no momento.',
                                    PhosphorIcons.houseLine)
                                : ListView.separated(
                                    padding: EdgeInsets.only(
                                      left: AppSpacing.lg,
                                      right: AppSpacing.lg,
                                      top: AppSpacing.lg,
                                      bottom: fabClearance(context),
                                    ),
                                    itemCount: listInside.length,
                                    separatorBuilder: (_, __) =>
                                        const SizedBox(height: 12),
                                    itemBuilder: (_, i) => _VisitanteCard(
                                      item: listInside[i],
                                      onTap: () => _showVisitanteDetails(
                                          context, listInside[i]),
                                      onEncerrar: () =>
                                          _confirmarSaida(listInside[i]),
                                    ),
                                  ),
                          ),
                          // ABA 2: Cadastrados (Histórico / Liberar Novamente)
                          RefreshIndicator(
                            onRefresh: loadList,
                            child: listCadastrados.isEmpty
                                ? _EmptyState(
                                    _tipoFiltro == 'prestadores'
                                        ? 'Nenhum prestador cadastrado.'
                                        : _tipoFiltro == 'visitantes'
                                            ? 'Nenhum visitante cadastrado.'
                                            : 'Nenhum visitante ou prestador cadastrado.',
                                    PhosphorIcons.identificationCard)
                                : ListView.separated(
                                    padding: EdgeInsets.only(
                                      left: AppSpacing.lg,
                                      right: AppSpacing.lg,
                                      top: AppSpacing.lg,
                                      bottom: fabClearance(context),
                                    ),
                                    itemCount: listCadastrados.length,
                                    separatorBuilder: (_, __) =>
                                        const SizedBox(height: 12),
                                    itemBuilder: (_, i) => _VisitanteCard(
                                      item: listCadastrados[i],
                                      onTap: () => _showVisitanteDetails(
                                          context, listCadastrados[i]),
                                      onEncerrar:
                                          estaNoLocal(listCadastrados[i])
                                              ? () => _confirmarSaida(
                                                  listCadastrados[i])
                                              : null,
                                      onQuickRelease: _canManage(
                                              listCadastrados[i])
                                          ? () => Navigator.push(
                                                context,
                                                MaterialPageRoute(
                                                  builder: (_) => NewVisitante(
                                                    isEdit: false,
                                                    reUseData:
                                                        listCadastrados[i],
                                                    defaultType: 'visitante',
                                                  ),
                                                ),
                                              ).then((_) => loadList())
                                          : null,
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
}

class _VisitanteCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  final VoidCallback? onEncerrar;
  final VoidCallback? onQuickRelease;
  const _VisitanteCard({
    required this.item,
    this.onTap,
    this.onEncerrar,
    this.onQuickRelease,
  });

  @override
  Widget build(BuildContext context) {
    final isInside = item['data_entrada'] != null && item['data_saida'] == null;

    bool isExpired = false;
    final endStr = item['data_hora_termino'];
    if (endStr != null) {
      final end = DateTime.tryParse(endStr.toString());
      if (end != null && DateTime.now().isAfter(end)) {
        isExpired = true;
      }
    }

    bool isAuthorized = false;
    if (!isInside && item['data_saida'] == null && !isExpired) {
      final startStr = item['data_hora_inicio'];
      if (startStr != null && endStr != null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          isAuthorized =
              DateTime.now().isAfter(start) && DateTime.now().isBefore(end);
        }
      }
    }

    // Subtítulo no formato "Visitante · A · 101"
    final tipo = (item['is_prestador'] == 1) ? 'Prestador' : 'Visitante';
    final bloco = (item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim();
    final apto = (item['apto'] ?? '').toString().trim();
    final List<String> subtitleParts = [tipo];
    if (bloco.isNotEmpty && bloco != 'null') {
      subtitleParts.add(bloco);
    }
    if (apto.isNotEmpty && apto != 'null') {
      subtitleParts.add(apto);
    }
    final subtitle = subtitleParts.join(' · ');

    // Tempo decorrido desde a entrada
    final tempoDecorrido = _formatTempoDecorrido(
      item['data_entrada'] ?? item['created_at'],
      item['hora_entrada'],
    );

    // Código PIN
    final hasPin =
        temPinParaExibir(item) && item['data_saida'] == null && !isExpired;
    final pinStr = item['codigo_acesso']?.toString().trim() ?? '';
    final formattedPin = pinStr.length == 6
        ? '${pinStr.substring(0, 3)}-${pinStr.substring(3, 6)}'
        : pinStr;

    final status = isInside
        ? StatusPessoa.noLocal
        : isAuthorized
            ? StatusPessoa.autorizado
            : isExpired
                ? StatusPessoa.finalizado
                : StatusPessoa.agendado;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          border: Border.all(color: AppColors.border(context)),
        ),
        clipBehavior: Clip.hardEdge,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Topo no desenho dos eventos: foto em degradê, selo, nome.
            CabecalhoPessoa(
              nome: (item['nome'] ?? '').toString(),
              subtitulo: subtitle,
              status: status,
              foto: _fotoProviderVisitante(item),
            ),
            Divider(height: 1, thickness: 1, color: AppColors.border(context)),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
            // Linha Inferior: Horário + PIN + Ação
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 8,
              children: [
                // Esquerda: Horário de entrada
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      PhosphorIcons.clock,
                      size: 16,
                      color: AppColors.textTertiary(context),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        '${isInside ? 'Entrou ' : (item['data_saida'] != null ? 'Saiu ' : '')}$tempoDecorrido',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.tiny(context),
                      ),
                    ),
                  ],
                ),
                // Centro: PIN ou Sem PIN
                if (hasPin)
                  GestureDetector(
                    onTap: () {
                      Clipboard.setData(ClipboardData(
                          text: item['codigo_acesso'].toString()));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('PIN copiado!'),
                          duration: Duration(seconds: 2),
                        ),
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        border:
                            Border.all(color: AppColors.borderStrong(context)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(PhosphorIcons.key,
                              size: 14, color: AppColors.textSecondary(context)),
                          const SizedBox(width: 5),
                          Text(
                            formattedPin,
                            style: AppTypography.label(context).copyWith(
                                color: AppColors.brandInk),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  Text(
                    'Sem PIN',
                    style: AppTypography.tiny(context),
                  ),
                // Direita: Botão Encerrar ou Liberar
                if (isInside && onEncerrar != null)
                  InkWell(
                    onTap: onEncerrar,
                    borderRadius: BorderRadius.zero,
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 36),
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        border:
                            Border.all(color: AppColors.borderStrong(context)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            PhosphorIcons.x,
                            size: 13,
                            color:
                                AppColors.textPrimary(context),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Encerrar'.toUpperCase(),
                            style: AppTypography.label(context).copyWith(
                                color: AppColors.textPrimary(context)),
                          ),
                        ],
                      ),
                    ),
                  )
                else if (!isInside && onQuickRelease != null)
                  InkWell(
                    onTap: onQuickRelease,
                    borderRadius: BorderRadius.zero,
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 36),
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        border:
                            Border.all(color: AppColors.borderStrong(context)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            PhosphorIcons.paperPlaneTilt,
                            size: 13,
                            color: AppColors.textPrimary(context),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Liberar'.toUpperCase(),
                            style: AppTypography.label(context).copyWith(
                                color: AppColors.textPrimary(context)),
                          ),
                        ],
                      ),
                    ),
                  )
              ],
            ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTempoDecorrido(dynamic dataEntradaRaw, dynamic horaEntradaRaw) {
    DateTime? entrada = parseDataApi(dataEntradaRaw);
    if (entrada == null && horaEntradaRaw != null) {
      final str = horaEntradaRaw.toString().trim();
      final parts = str.split(':');
      if (parts.length >= 2) {
        final now = DateTime.now();
        final h = int.tryParse(parts[0]);
        final m = int.tryParse(parts[1]);
        if (h != null && m != null) {
          entrada = DateTime(now.year, now.month, now.day, h, m);
        }
      }
    }

    if (entrada == null) {
      if (horaEntradaRaw != null && horaEntradaRaw.toString().isNotEmpty) {
        return horaEntradaRaw.toString();
      }
      return '';
    }

    final diff = DateTime.now().difference(entrada);
    if (diff.isNegative || diff.inMinutes < 1) {
      return 'agora';
    }
    if (diff.inMinutes < 60) {
      return 'há ${diff.inMinutes}min';
    }
    final h = diff.inHours;
    final m = diff.inMinutes % 60;
    if (h < 24) {
      return m > 0 ? 'há ${h}h${m.toString().padLeft(2, '0')}' : 'há ${h}h';
    }
    return 'há ${diff.inDays}d';
  }
}

class _TipoChip extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool selected;
  final VoidCallback onTap;
  const _TipoChip(
      {required this.label,
      required this.selected,
      required this.onTap,
      this.icon});

  @override
  Widget build(BuildContext context) {
    final cor =
        selected ? AppColors.onBrand : AppColors.textSecondary(context);
    return Material(
      color: selected ? AppColors.brand : Colors.transparent,
      shape: RoundedRectangleBorder(
        side: BorderSide(
          color: selected ? AppColors.brand : AppColors.borderStrong(context),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 34,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 14, color: cor),
                  const SizedBox(width: 6),
                ],
                Text(
                  label.toUpperCase(),
                  style: AppTypography.label(context).copyWith(color: cor),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String message;
  final IconData icon;
  const _EmptyState(this.message, this.icon);
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AppIconBox(icon: icon, size: 56, iconSize: 24),
          const SizedBox(height: AppSpacing.md),
          Text(message,
              style: AppTypography.bodySecondary(context),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

/// Extrai a string da foto do visitante a partir do payload da API.
/// Aceita base64 puro, data URL ou URL HTTP (R2/Cloudflare).
String? _getFotoVisitante(dynamic item) {
  final raw = item['foto_pessoa'] ?? item['photo'];
  if (raw == null) return null;
  final s = raw.toString().trim();
  if (s.isEmpty || s == 'null') return null;
  return s;
}

/// Um PIN só é mostrado, copiado ou compartilhado quando a API autorizada
/// devolveu uma credencial não vazia. Perfis sem autorização recebem `null`.
bool temPinParaExibir(dynamic item) {
  final codigo = item['codigo_acesso'];
  return codigo != null && codigo.toString().trim().isNotEmpty;
}

/// Decide entre exibir a foto (NetworkImage ou MemoryImage de base64)
/// ou um fallback com a inicial do nome.
/// Foto do visitante como imagem: link, data URL ou base64 puro. Null quando
/// não há foto ou ela não decodifica.
ImageProvider? _fotoProviderVisitante(dynamic item) {
  final foto = _getFotoVisitante(item);
  if (foto == null) return null;
  if (foto.startsWith('http://') || foto.startsWith('https://')) {
    return NetworkImage(foto);
  }
  final base64 = foto.startsWith('data:')
      ? (foto.contains(',') ? foto.substring(foto.indexOf(',') + 1) : '')
      : foto;
  try {
    return MemoryImage(base64Decode(base64));
  } catch (_) {
    return null;
  }
}

Widget _buildVisitanteAvatar(BuildContext context, dynamic item,
    {double radius = 24}) {
  final nome = (item['nome'] ?? 'V').toString().trim();

  {
    final provider = _fotoProviderVisitante(item);
    if (provider != null) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: AppColors.surface(context),
        backgroundImage: provider,
      );
    }
  }

  // Fallback com as iniciais (ex: Rodrigo Rufini -> RR)
  final words = nome.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  String initials = 'V';
  if (words.length >= 2) {
    initials = '${words[0][0]}${words[1][0]}'.toUpperCase();
  } else if (words.isNotEmpty && words[0].isNotEmpty) {
    initials = words[0][0].toUpperCase();
  }

  return CircleAvatar(
    radius: radius,
    backgroundColor: AppColors.surface(context),
    child: Text(
      initials,
      style: TextStyle(
        color: AppColors.primary,
        fontWeight: FontWeight.bold,
        fontSize: radius * 0.72,
      ),
    ),
  );
}

Widget _buildFaceBadge(BuildContext context, String? status) {
  if (status == null || status.isEmpty) return const SizedBox.shrink();

  Color bg;
  Color fg;
  String label;
  switch (status) {
    case 'synced':
      bg = AppColors.success.withValues(alpha: 0.15);
      fg = AppColors.success;
      label = 'FACIAL';
      break;
    case 'pending':
      bg = AppColors.warning.withValues(alpha: 0.15);
      fg = AppColors.border(context);
      label = 'SINC.';
      break;
    case 'error':
      bg = AppColors.error.withValues(alpha: 0.15);
      fg = AppColors.border(context);
      label = 'ERRO';
      break;
    default:
      return const SizedBox.shrink();
  }

  return Padding(
    padding: const EdgeInsets.only(left: 6),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.tag),
      ),
      child: Text(
        label,
        style: AppTypography.tiny(context).copyWith(
          color: fg,
          fontWeight: FontWeight.bold,
          fontSize: 9,
          letterSpacing: 0.3,
        ),
      ),
    ),
  );
}
