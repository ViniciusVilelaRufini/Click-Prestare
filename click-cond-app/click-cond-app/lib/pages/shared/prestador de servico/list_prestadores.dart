import 'dart:async';
import 'dart:convert';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/shared/visitantes/new_visitante.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/app/app_skeleton.dart';
import 'package:click/utils/datas.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';

class ListPrestadores extends StatefulWidget {
  final bool allCondos;
  const ListPrestadores({Key? key, this.allCondos = false}) : super(key: key);
  @override
  _ListPrestadoresPageState createState() => _ListPrestadoresPageState();
}

class _ListPrestadoresPageState extends State<ListPrestadores> {
  final txtSearch = TextEditingController();
  Timer? _timerSearch;
  List<dynamic> list = [];
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    loadList();
  }

  @override
  void dispose() {
    txtSearch.dispose();
    _timerSearch?.cancel();
    super.dispose();
  }

  Future<void> loadList() async {
    try {
      setState(() => _isLoading = true);
      list = await apiGetAllVisitantes(txtSearch.text, allCondos: widget.allCondos);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
          content: Text('Baixa na visita de ${item['nome'] ?? 'prestador'} realizada com sucesso!'),
          backgroundColor: AppColors.primary,
          duration: const Duration(seconds: 3),
        ),
      );
      loadList();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro: ${result ?? 'Não foi possível dar baixa na visita.'}'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  void _showPrestadorDetails(BuildContext context, dynamic item) {
    final isInside = item['data_entrada'] != null && item['data_saida'] == null;
    final canAdd = (getUserType() != 'funcionario') || getUserPermission('prestadores_servico') == 1;
    
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
      final endStr = item['data_hora_termino'];
      if (startStr != null && endStr != null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          isAuthorized = DateTime.now().isAfter(start) && DateTime.now().isBefore(end);
        }
      }
    }

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return Container(
          decoration: BoxDecoration(
            color: AppColors.bg(context),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.textTertiary(context).withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: [
                  _buildVisitanteAvatar(context, item, radius: 28),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item['nome'] ?? '',
                          style: AppTypography.headline(context),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            if (isInside)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.success.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  'NO LOCAL',
                                  style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.success,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              )
                            else if (isAuthorized)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  'AUTORIZADO',
                                  style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.primary,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              )
                            else
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.textSecondary(context).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  'AGENDADO',
                                  style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.textSecondary(context),
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            const SizedBox(width: 8),
                            Text(
                              'Prestador de Serviço',
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
              
              _buildDetailRow(
                context,
                icon: PhosphorIcons.houseLine,
                label: 'Unidade',
                value: '${(item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim().isNotEmpty && (item['apto_bloco'] ?? item['bloco'] ?? '').toString() != 'null' ? (item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim() + ' - ' : ''}${item['apto'] ?? ''}',
              ),
              if (item['doc_identificacao'] != null && item['doc_identificacao'].toString().trim().isNotEmpty)
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
                value: _formatPeriod(item['data_hora_inicio'], item['data_hora_termino']),
              ),

              if (item['data_entrada'] != null)
                _buildDetailRow(
                  context,
                  icon: PhosphorIcons.signIn,
                  label: 'Entrada Registrada',
                  value: _formatDateTimeString(item['data_entrada']),
                ),

              if (item['data_saida'] != null)
                _buildDetailRow(
                  context,
                  icon: PhosphorIcons.signOut,
                  label: 'Saída Registrada',
                  value: _formatDateTimeString(item['data_saida']),
                ),

              if (item['data_saida'] == null && !isExpired) ...[
                const SizedBox(height: AppSpacing.lg),
                Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppColors.primary.withOpacity(0.15),
                        AppColors.primary.withOpacity(0.05),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.primary.withOpacity(0.3)),
                  ),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                        child: Row(
                          children: [
                            const Icon(PhosphorIcons.shieldCheck, color: AppColors.primary, size: 18),
                            const SizedBox(width: 8),
                            Text(
                              'Código de Acesso para Portaria',
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (item['codigo_acesso'] != null) ...[
                        // QR Code
                        Container(
                          margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: QrImageView(
                            data: item['codigo_acesso'].toString(),
                            version: QrVersions.auto,
                            size: 180,
                            backgroundColor: Colors.white,
                            eyeStyle: const QrEyeStyle(
                              eyeShape: QrEyeShape.square,
                              color: Color(0xFF0A1628),
                            ),
                            dataModuleStyle: const QrDataModuleStyle(
                              dataModuleShape: QrDataModuleShape.square,
                              color: Color(0xFF0A1628),
                            ),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        // PIN numérico
                        Text(
                          'PIN',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.textTertiary(context),
                            letterSpacing: 1,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item['codigo_acesso'].toString().length == 6
                              ? "${item['codigo_acesso'].toString().substring(0, 3)}-${item['codigo_acesso'].toString().substring(3, 6)}"
                              : item['codigo_acesso'].toString(),
                          style: AppTypography.title(context).copyWith(
                            color: AppColors.primary,
                            letterSpacing: 6,
                            fontWeight: FontWeight.w900,
                            fontSize: 32,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        // Botão copiar
                        SizedBox(
                          width: double.infinity,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                            child: OutlinedButton.icon(
                              icon: const Icon(PhosphorIcons.copy, size: 16),
                              label: const Text('Copiar código'),
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: item['codigo_acesso'].toString())).then((_) {
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: const Text('Código PIN copiado!'),
                                        backgroundColor: AppColors.primary.withOpacity(0.9),
                                        duration: const Duration(seconds: 2),
                                      ),
                                    );
                                  }
                                });
                              },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.primary,
                                side: BorderSide(color: AppColors.primary.withOpacity(0.4)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                padding: const EdgeInsets.symmetric(vertical: 10),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Text(
                          'Apresente o QR Code ou informe o PIN ao porteiro.',
                          textAlign: TextAlign.center,
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.textTertiary(context),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                      ] else ...[
                        Padding(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          child: Column(
                            children: [
                              const Icon(PhosphorIcons.spinnerGap, color: AppColors.primary, size: 32),
                              const SizedBox(height: AppSpacing.sm),
                              Text(
                                'Gerando código de acesso...',
                                style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Reabra este prestador em alguns instantes.',
                                style: AppTypography.tiny(context).copyWith(color: AppColors.textTertiary(context)),
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
                    color: AppColors.textSecondary(context).withOpacity(0.05),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.textSecondary(context).withOpacity(0.2)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(PhosphorIcons.lock, color: AppColors.textSecondary(context), size: 18),
                      const SizedBox(width: 8),
                      Text(
                        item['data_saida'] != null
                            ? 'Visita Encerrada (Código Expirado)'
                            : 'Período Expirado (Código Inativo)',
                        style: AppTypography.captionMedium(context).copyWith(
                          color: AppColors.textSecondary(context),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              
              const SizedBox(height: AppSpacing.xl),
              if (canAdd && item['data_saida'] == null) ...[
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton.icon(
                    onPressed: () async {
                      Navigator.pop(context);
                      await _registrarSaida(item);
                    },
                    icon: const Icon(PhosphorIcons.signOut, size: 20, color: Colors.white),
                    label: const Text(
                      'Dar Baixa na Visita',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFDC2626),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: BorderSide(color: AppColors.textTertiary(context).withOpacity(0.3)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Fechar', style: AppTypography.body(context)),
                    ),
                  ),
                  if (canAdd && item['data_saida'] == null && !isExpired) ...[
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.pop(context);
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => NewVisitante(
                                isEdit: true,
                                myId: item['id'],
                                defaultType: 'prestador',
                              ),
                            ),
                          ).then((_) => loadList());
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        child: Text(
                          'Editar',
                          style: AppTypography.body(context).copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        );
      },
    );
  }

  Widget _buildDetailRow(BuildContext context, {required IconData icon, required String label, required String value}) {
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

  String _formatPeriod(dynamic start, dynamic end) {
    if (start == null) return 'Qualquer data';
    final s = parseDataApi(start);
    final e = parseDataApi(end);
    
    if (s == null) return 'Qualquer data';
    
    final pad = (int n) => n.toString().padLeft(2, '0');
    final format = (DateTime d) => '${pad(d.day)}/${pad(d.month)}/${d.year} ${pad(d.hour)}:${pad(d.minute)}';
    
    if (e == null) {
      return 'A partir de ${format(s)}';
    }
    return '${format(s)} até ${format(e)}';
  }

  String _formatDateTimeString(dynamic val) {
    if (val == null) return '';
    final d = parseDataApi(val);
    if (d == null) return val.toString();
    final pad = (int n) => n.toString().padLeft(2, '0');
    return '${pad(d.day)}/${pad(d.month)}/${d.year} às ${pad(d.hour)}:${pad(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = (getUserType() != 'funcionario') || getUserPermission('prestadores_servico') == 1;

    // Filtrar apenas prestadores (onde is_prestador é 1)
    final prestadoresOnlyList = list.where((e) => e['is_prestador'] == 1).toList();

    // Filtrar quem está no condomínio atualmente OU possui liberação ativa para hoje
    final now = DateTime.now();
    final listInsideRaw = prestadoresOnlyList.where((e) {
      // 1. Está no local fisicamente
      final isInside = e['data_entrada'] != null && e['data_saida'] == null;
      if (isInside) return true;

      // 2. Liberação ativa agendada (período atual e sem registro de saída)
      final startStr = e['data_hora_inicio'];
      final endStr = e['data_hora_termino'];
      if (startStr != null && endStr != null && e['data_saida'] == null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          return now.isAfter(start) && now.isBefore(end);
        }
      }
      return false;
    }).toList();

    // A mesma pessoa pode ter mais de uma liberação sobreposta (ex: liberada de
    // novo antes de fechar a anterior) — cada uma é um registro separado no
    // banco, então sem isso o mesmo prestador aparece duplicado na lista. Mantém
    // só um card por pessoa, priorizando quem está fisicamente dentro sobre
    // quem só está autorizado/agendado.
    final Map<String, dynamic> listInsideByPerson = {};
    for (var item in listInsideRaw) {
      final String key = (item['doc_identificacao'] != null && item['doc_identificacao'].toString().trim().isNotEmpty)
          ? item['doc_identificacao'].toString().trim()
          : item['nome'].toString().trim();
      if (key.isEmpty) continue;
      final existing = listInsideByPerson[key];
      if (existing == null) {
        listInsideByPerson[key] = item;
        continue;
      }
      final isInsideNow = item['data_entrada'] != null && item['data_saida'] == null;
      final existingIsInside = existing['data_entrada'] != null && existing['data_saida'] == null;
      if (isInsideNow && !existingIsInside) {
        listInsideByPerson[key] = item;
      }
    }
    final listInside = listInsideByPerson.values.toList();

    // Filtrar prestadores cadastrados únicos para histórico e liberação rápida
    final Map<String, Map<String, dynamic>> uniquePrestadores = {};
    for (var item in prestadoresOnlyList) {
      final String key = (item['doc_identificacao'] != null && item['doc_identificacao'].toString().trim().isNotEmpty)
          ? item['doc_identificacao'].toString().trim()
          : item['nome'].toString().trim();
      
      if (key.isNotEmpty && !uniquePrestadores.containsKey(key)) {
        uniquePrestadores[key] = Map<String, dynamic>.from(item);
      }
    }
    final listCadastrados = uniquePrestadores.values.toList();

    return DefaultTabController(
      length: 2,
      child: AppScaffold(
        title: getText('lb_prestadores_servico'),
        floatingActionButton: canAdd
            ? FloatingActionButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => NewVisitante(
                      isEdit: false,
                      defaultType: 'prestador',
                    ),
                  ),
                ).then((_) => loadList()),
                backgroundColor: AppColors.primary,
                child: const Icon(PhosphorIcons.plus, color: Colors.white),
              )
            : null,
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
              child: TextField(
                controller: txtSearch,
                onChanged: (v) {
                  _timerSearch?.cancel();
                  _timerSearch = Timer(const Duration(milliseconds: 600), loadList);
                },
                style: AppTypography.body(context),
                cursorColor: AppColors.primary,
                decoration: InputDecoration(
                  hintText: getText('lb_buscar'),
                  hintStyle: AppTypography.body(context).copyWith(color: AppColors.textTertiary(context)),
                  prefixIcon: Icon(PhosphorIcons.magnifyingGlass, size: 20, color: AppColors.textSecondary(context)),
                  filled: true,
                  fillColor: AppColors.surface(context),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 14),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
              child: Container(
                height: 48,
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: AppColors.surface(context),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: TabBar(
                  dividerColor: Colors.transparent,
                  unselectedLabelColor: AppColors.textSecondary(context),
                  labelColor: Colors.white,
                  labelStyle: AppTypography.caption(context).copyWith(fontWeight: FontWeight.bold),
                  unselectedLabelStyle: AppTypography.caption(context),
                  indicatorSize: TabBarIndicatorSize.tab,
                  indicator: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                   tabs: [
                    Tab(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(PhosphorIcons.houseLine, size: 16),
                            const SizedBox(width: 6),
                            Builder(builder: (ctx) {
                              final w = MediaQuery.of(ctx).size.width;
                              return Text(w < 385 ? 'Ativos (${listInside.length})' : 'No Local / Ativos (${listInside.length})');
                            }),
                          ],
                        ),
                      ),
                    ),
                    Tab(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(PhosphorIcons.identificationCard, size: 16),
                            const SizedBox(width: 6),
                            Text('Cadastrados (${listCadastrados.length})'),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: _isLoading
                  ? ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: 8,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (_, __) => AppSkeleton.listTile(context),
                    )
                  : TabBarView(
                      children: [
                        // ABA 1: No Condomínio
                        RefreshIndicator(
                          onRefresh: loadList,
                          child: listInside.isEmpty
                              ? _EmptyState('Nenhum prestador no local no momento.', PhosphorIcons.houseLine)
                              : ListView.separated(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  itemCount: listInside.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                                  itemBuilder: (_, i) => _PrestadorCard(
                                    item: listInside[i],
                                    onTap: () => _showPrestadorDetails(context, listInside[i]),
                                  ),
                                ),
                        ),
                        // ABA 2: Cadastrados (Histórico / Liberar Novamente)
                        RefreshIndicator(
                          onRefresh: loadList,
                          child: listCadastrados.isEmpty
                              ? _EmptyState('Nenhum prestador cadastrado.', PhosphorIcons.identificationCard)
                              : ListView.separated(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  itemCount: listCadastrados.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                                  itemBuilder: (_, i) => _PrestadorCard(
                                    item: listCadastrados[i],
                                    onTap: () => _showPrestadorDetails(context, listCadastrados[i]),
                                    onQuickRelease: canAdd
                                        ? () => Navigator.push(
                                              context,
                                              MaterialPageRoute(
                                                builder: (_) => NewVisitante(
                                                  isEdit: false,
                                                  reUseData: listCadastrados[i],
                                                  defaultType: 'prestador',
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
    );
  }
}

class _PrestadorCard extends StatelessWidget {
  final dynamic item;
  final VoidCallback? onTap;
  final VoidCallback? onQuickRelease;
  const _PrestadorCard({required this.item, this.onTap, this.onQuickRelease});

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
    
    // Verificar se é agendado (está ativo no período, mas não entrou ainda)
    bool isAuthorized = false;
    if (!isInside && item['data_saida'] == null && !isExpired) {
      final startStr = item['data_hora_inicio'];
      final endStr = item['data_hora_termino'];
      if (startStr != null && endStr != null) {
        final start = DateTime.tryParse(startStr);
        final end = DateTime.tryParse(endStr);
        if (start != null && end != null) {
          isAuthorized = DateTime.now().isAfter(start) && DateTime.now().isBefore(end);
        }
      }
    }
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            Stack(
              children: [
                _buildVisitanteAvatar(context, item, radius: 22),
                if (isInside)
                  Positioned(
                    right: 0, bottom: 0,
                    child: Container(
                      width: 12, height: 12,
                      decoration: BoxDecoration(
                        color: AppColors.success,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.surface(context), width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (item['condominio_nome'] != null && item['condominio_nome'].toString().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2.0),
                      child: Text(
                        item['condominio_nome'].toString().toUpperCase(),
                        style: AppTypography.tiny(context).copyWith(
                          color: AppColors.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  Row(
                    children: [
                      Expanded(child: Text(item['nome'] ?? '', style: AppTypography.bodyMedium(context), maxLines: 1, overflow: TextOverflow.ellipsis)),
                      if (item['apto'] != null)
                        Text(
                          '${(item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim().isNotEmpty && (item['apto_bloco'] ?? item['bloco'] ?? '').toString() != 'null' ? (item['apto_bloco'] ?? item['bloco'] ?? '').toString().trim() + ' - ' : ''}${item['apto']}',
                          style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.bold),
                        ),
                      if (isInside) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.success.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                          child: Text('NO LOCAL', style: AppTypography.tiny(context).copyWith(color: AppColors.success, fontWeight: FontWeight.bold)),
                        ),
                      ] else if (isAuthorized) ...[
                        const SizedBox(width: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                          child: Text('AUTORIZADO', style: AppTypography.tiny(context).copyWith(color: AppColors.primary, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ],
                  ),
                  if (item['codigo_acesso'] != null && item['data_saida'] == null && !isExpired) ...[
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(PhosphorIcons.key, size: 12, color: AppColors.primary),
                        const SizedBox(width: 4),
                        Text(
                          'PIN: ${item['codigo_acesso'].toString().length == 6 ? "${item['codigo_acesso'].toString().substring(0, 3)}-${item['codigo_acesso'].toString().substring(3, 6)}" : item['codigo_acesso']}',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ],
                  Row(
                    children: [
                      if (item['data_hora'] != null)
                        Text(item['data_hora'], style: AppTypography.caption(context)),
                      if (item['hora_entrada'] != null) ...[
                        Text(' • ', style: AppTypography.caption(context)),
                        Icon(PhosphorIcons.signIn, size: 12, color: AppColors.textTertiary(context)),
                        const SizedBox(width: 2),
                        Text(item['hora_entrada'], style: AppTypography.caption(context)),
                      ],
                      if (item['hora_saida'] != null) ...[
                        Text(' • ', style: AppTypography.caption(context)),
                        Icon(PhosphorIcons.signOut, size: 12, color: AppColors.textTertiary(context)),
                        const SizedBox(width: 2),
                        Text(item['hora_saida'], style: AppTypography.caption(context)),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            if (onQuickRelease != null) ...[
              const SizedBox(width: AppSpacing.sm),
              Material(
                color: Colors.transparent,
                child: IconButton(
                  icon: const Icon(PhosphorIcons.paperPlaneTilt, size: 20),
                  color: AppColors.primary,
                  onPressed: onQuickRelease,
                  splashRadius: 20,
                  tooltip: 'Liberar Novamente',
                ),
              ),
            ],
            if (onTap != null) ...[
              const SizedBox(width: 4),
              Icon(PhosphorIcons.caretRight, size: 16, color: AppColors.textTertiary(context)),
            ],
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String text;
  final IconData icon;
  const _EmptyState(this.text, this.icon);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 48, color: AppColors.textTertiary(context).withOpacity(0.5)),
          const SizedBox(height: AppSpacing.md),
          Text(
            text,
            style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context)),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

String? _getFotoVisitante(dynamic item) {
  final raw = item['foto_pessoa'] ?? item['photo'];
  if (raw == null) return null;
  final s = raw.toString().trim();
  if (s.isEmpty || s == 'null') return null;
  return s;
}

Widget _buildVisitanteAvatar(BuildContext context, dynamic item, {double radius = 22}) {
  final foto = _getFotoVisitante(item);
  final nome = (item['nome'] ?? 'P').toString();

  if (foto != null) {
    ImageProvider? provider;
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      provider = NetworkImage(foto);
    } else if (foto.startsWith('data:')) {
      final commaIdx = foto.indexOf(',');
      if (commaIdx > 0) {
        try {
          provider = MemoryImage(base64Decode(foto.substring(commaIdx + 1)));
        } catch (_) {}
      }
    } else {
      try {
        provider = MemoryImage(base64Decode(foto));
      } catch (_) {}
    }
    if (provider != null) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: AppColors.primary.withOpacity(0.1),
        backgroundImage: provider,
      );
    }
  }

  return CircleAvatar(
    radius: radius,
    backgroundColor: AppColors.primary.withOpacity(0.1),
    child: Text(
      nome.substring(0, 1).toUpperCase(),
      style: AppTypography.bodyMedium(context).copyWith(color: AppColors.primary),
    ),
  );
}
