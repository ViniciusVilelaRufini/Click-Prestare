import 'package:click/pages/shared/ocorrencias/ocorrencia_chat.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/ocorrencias/new_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/ocorrencia_sla.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DetailOcorrencia extends StatefulWidget {
  const DetailOcorrencia({Key? key, required this.id}) : super(key: key);
  final int id;

  @override
  _DetailOcorrenciaPageState createState() => _DetailOcorrenciaPageState();
}

class _DetailOcorrenciaPageState extends State<DetailOcorrencia> {
  var _isLoading = false;
  var _isSaving = false;
  final txtResposta = TextEditingController();
  dynamic obj;
  List<dynamic> list = [];
  var currentStatus = '';

  @override
  void dispose() {
    txtResposta.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      obj = await apiGetDetails("ocorrencias", widget.id);
      currentStatus = obj['status'];
      list.clear();
      if (obj['anexos'] != null && obj['anexos'].toString().isNotEmpty) {
        for (var item in obj['anexos'].split(';')) {
          if (item.toString().isNotEmpty) {
            list.add(await fileFromImageUrl(item));
          }
        }
      }
      if (mounted) setState(() {});
    } catch (e) {
      print('[DetailOcorrencia] Erro no load: $e');
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> saveResposta() async {
    try {
      if (currentStatus != 'ciente' && currentStatus != 'solucionado') {
        displayMessage(context, getText('alert_ops'), 'Informe o status da ocorrência!');
        return;
      }
      var resposta = OcorrenciaRespostaModel(
        id: obj['id'],
        descricao: txtResposta.text,
        status: currentStatus,
        isResposta: true,
      );
      setState(() => _isSaving = true);
      var message = await apiSaveObject('ocorrencias', 'ocorrencia', resposta, true);
      if (message == "") {
        if (mounted) Navigator.pop(context);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), message);
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _abrirAtribuir() async {
    // Carrega funcionários do condomínio (id_user = Users.id p/ o responsável).
    List<dynamic> funcs = [];
    try {
      funcs = await apiGetAll("funcionarios");
    } catch (_) {}
    // Filtra os que possuem vínculo com Users (id_user em prod, id em dev).
    final elegiveis = funcs.where((f) => (f['id_user'] ?? f['id']) != null).toList();
    if (!mounted) return;
    if (elegiveis.isEmpty) {
      displayMessage(context, getText('alert_ops'), 'Nenhum funcionário disponível para atribuição.');
      return;
    }
    final selecionado = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      backgroundColor: AppColors.surface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppSpacing.md),
            Text('Atribuir responsável', style: AppTypography.bodyMedium(ctx).copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: AppSpacing.sm),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  if (obj?['id_responsavel'] != null)
                    ListTile(
                      leading: Icon(PhosphorIcons.userMinus, color: AppColors.error),
                      title: Text('Remover atribuição', style: AppTypography.body(ctx).copyWith(color: AppColors.error)),
                      onTap: () => Navigator.pop(ctx, {'id_user': null}),
                    ),
                  ...elegiveis.map((f) => ListTile(
                        leading: CircleAvatar(
                          radius: 18,
                          backgroundColor: AppColors.primary.withOpacity(0.1),
                          child: Text(
                            (f['nome'] ?? '?').toString().substring(0, 1).toUpperCase(),
                            style: AppTypography.captionMedium(ctx).copyWith(color: AppColors.primary),
                          ),
                        ),
                        title: Text(f['nome'] ?? '', style: AppTypography.body(ctx)),
                        subtitle: (f['funcao'] ?? '').toString().isNotEmpty
                            ? Text(f['funcao'], style: AppTypography.caption(ctx))
                            : null,
                        onTap: () => Navigator.pop(ctx, {'id_user': f['id_user'] ?? f['id']}),
                      )),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
    if (selecionado == null || !mounted) return;
    final idResp = selecionado['id_user'] == null ? null : (selecionado['id_user'] as num).toInt();
    setState(() => _isSaving = true);
    final res = await apiUpdateResponsavel(widget.id, idResp);
    if (!mounted) return;
    setState(() => _isSaving = false);
    if (res == "") {
      await load();
    } else {
      displayMessage(context, getText('alert_error'), res.toString());
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'solucionado': return const Color(0xFF22C55E);
      case 'ciente': return const Color(0xFFF59E0B);
      default: return AppColors.error;
    }
  }

  @override
  Widget build(BuildContext context) {
    final String myId = getUserId();
    final bool isOwner = obj != null && obj['user']?.toString() == myId;
    final bool isPrivileged = getUserType() == 'sindico' || getUserPermission("ocorrencias") == 1;
    final bool canChat = isOwner || isPrivileged;

    final canRespond = isPrivileged && obj != null && obj['status'] == 'Pendente';
    final isMorador = getUserType() == 'morador';

    return AppScaffold(
      title: getText('lb_ocorrencia'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : obj == null
              ? const SizedBox()
              : RefreshIndicator(
                  onRefresh: load,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _InfoCard(children: [
                          _Row(icon: PhosphorIcons.clock, label: getText('data_hora_criacao'), value: obj['created_at'] ?? ''),
                          const Divider(height: AppSpacing.xl),
                          _Row(icon: PhosphorIcons.warningCircle, label: getText('lb_tipo'), value: obj['tipo'] ?? '',
                              valueColor: (obj['tipo'] ?? '').toString().toLowerCase().contains('urgente') ? AppColors.error : null),
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              Icon(PhosphorIcons.circlesFour, size: 16, color: AppColors.textSecondary(context)),
                              const SizedBox(width: 8),
                              Text('Status: ', style: AppTypography.captionMedium(context)),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                                decoration: BoxDecoration(
                                  color: _statusColor(obj['status'] ?? '').withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(obj['status'] ?? '',
                                    style: AppTypography.captionMedium(context)
                                        .copyWith(color: _statusColor(obj['status'] ?? ''))),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              Icon(PhosphorIcons.eye, size: 16, color: AppColors.textSecondary(context)),
                              const SizedBox(width: 8),
                              Text('Visibilidade: ', style: AppTypography.captionMedium(context)),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                                decoration: BoxDecoration(
                                  color: (obj['publica'] == true) 
                                      ? const Color(0xFF22C55E).withOpacity(0.12) 
                                      : AppColors.textTertiary(context).withOpacity(0.08),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  (obj['publica'] == true) ? 'Pública' : 'Privada',
                                  style: AppTypography.captionMedium(context).copyWith(
                                    color: (obj['publica'] == true) 
                                        ? const Color(0xFF22C55E) 
                                        : AppColors.textSecondary(context),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (obj['criado_por'] != null && obj['criado_por'].toString().isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.sm),
                            Row(
                              children: [
                                Icon(PhosphorIcons.user, size: 16, color: AppColors.textSecondary(context)),
                                const SizedBox(width: 8),
                                Text('Autor: ', style: AppTypography.captionMedium(context)),
                                Expanded(
                                  child: Text(
                                    obj['criado_por'].toString(),
                                    style: AppTypography.captionMedium(context).copyWith(
                                      color: AppColors.textPrimary(context),
                                      fontWeight: FontWeight.w600,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ],
                          // Prazo (SLA)
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              Icon(PhosphorIcons.timer, size: 16, color: AppColors.textSecondary(context)),
                              const SizedBox(width: 8),
                              Text('Prazo: ', style: AppTypography.captionMedium(context)),
                              OcorrenciaSlaBadge(item: obj),
                            ],
                          ),
                          // Responsável
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              Icon(PhosphorIcons.userGear, size: 16, color: AppColors.textSecondary(context)),
                              const SizedBox(width: 8),
                              Text('Responsável: ', style: AppTypography.captionMedium(context)),
                              Expanded(
                                child: Text(
                                  (obj['responsavelNome']?.toString().isNotEmpty ?? false)
                                      ? obj['responsavelNome'].toString()
                                      : 'Não atribuído',
                                  style: AppTypography.captionMedium(context).copyWith(
                                    color: (obj['responsavelNome']?.toString().isNotEmpty ?? false)
                                        ? AppColors.textPrimary(context)
                                        : AppColors.textSecondary(context),
                                    fontWeight: FontWeight.w600,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (isPrivileged)
                                TextButton.icon(
                                  onPressed: _isSaving ? null : _abrirAtribuir,
                                  icon: Icon(PhosphorIcons.userPlus, size: 15, color: AppColors.primary),
                                  label: Text(
                                    (obj['id_responsavel'] != null) ? 'Trocar' : 'Atribuir',
                                    style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary),
                                  ),
                                  style: TextButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    minimumSize: const Size(0, 0),
                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                  ),
                                ),
                            ],
                          ),
                        ]),
                        const SizedBox(height: AppSpacing.md),
                        _InfoCard(children: [
                          Text(getText('lb_descricao').toUpperCase(),
                              style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
                          const SizedBox(height: AppSpacing.sm),
                          Text(obj['descricao'] ?? '', style: AppTypography.body(context)),
                          if (list.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.md),
                            Wrap(
                              spacing: AppSpacing.sm,
                              runSpacing: AppSpacing.sm,
                              children: [
                                for (var f in list)
                                  GestureDetector(
                                    onTap: () => openFile(f.path),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(8),
                                      child: f.path.contains('.pdf')
                                          ? Container(
                                              width: 72, height: 72,
                                              color: AppColors.error.withOpacity(0.08),
                                              child: Icon(PhosphorIcons.filePdf, color: AppColors.error, size: 32),
                                            )
                                          : Image.file(f, width: 72, height: 72, fit: BoxFit.cover),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ]),
                        if ((obj['resposta']?.toString() ?? '').isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.md),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                            decoration: BoxDecoration(
                              border: Border(
                                left: BorderSide(
                                  color: const Color(0xFF3B82F6),
                                  width: 3.0,
                                ),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'RESPOSTA DA ADMINISTRAÇÃO',
                                  style: AppTypography.captionMedium(context).copyWith(
                                    color: const Color(0xFF3B82F6),
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.8,
                                    fontSize: 10,
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.xs),
                                Text(
                                  obj['resposta'] ?? '',
                                  style: AppTypography.body(context).copyWith(
                                    color: AppColors.textPrimary(context).withOpacity(0.9),
                                    fontSize: 13,
                                  ),
                                ),
                                if (obj['resposta_at'] != null) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    obj['resposta_at'],
                                    style: AppTypography.caption(context).copyWith(
                                      fontSize: 10,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                        if (canRespond) ...[
                          const SizedBox(height: AppSpacing.xl),
                          Text(getText('lb_resposta').toUpperCase(),
                              style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
                          const SizedBox(height: AppSpacing.sm),
                          AppInput(
                            label: getText('ocorrencia_resposta'),
                            controller: txtResposta,
                            prefixIcon: PhosphorIcons.chatText,
                            maxLines: 4,
                            keyboard: TextInputType.multiline,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          Text(getText('ocorrencia_status'),
                              style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context))),
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              _StatusChip(
                                label: getText('ciente'),
                                selected: currentStatus == 'ciente',
                                color: const Color(0xFFF59E0B),
                                onTap: () => setState(() => currentStatus = 'ciente'),
                              ),
                              const SizedBox(width: AppSpacing.md),
                              _StatusChip(
                                label: getText('solucionado'),
                                selected: currentStatus == 'solucionado',
                                color: const Color(0xFF22C55E),
                                onTap: () => setState(() => currentStatus = 'solucionado'),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xl),
                          AppButton(
                            label: getText('btn_save'),
                            onPressed: _isSaving ? null : saveResposta,
                            loading: _isSaving,
                            icon: PhosphorIcons.floppyDisk,
                          ),
                        ],
                        const SizedBox(height: AppSpacing.lg),
                        if (canChat) ...[
                          AppButton(
                            label: 'Chat da Ocorrência',
                            onPressed: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => OcorrenciaChatPage(
                                    idOcorrencia: widget.id,
                                    titulo: obj['tipo'] ?? 'Ocorrência',
                                  ),
                                ),
                              );
                            },
                            icon: PhosphorIcons.chatText,
                            variant: AppButtonVariant.secondary,
                          ),
                        ] else ...[
                          Center(
                            child: Text(
                              'O chat é privado para o criador desta ocorrência.',
                              style: AppTypography.caption(context),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ],
                        const SizedBox(height: AppSpacing.xxxl),
                      ],
                    ),
                  ),
                ),
      floatingActionButton: isMorador && obj != null && obj['status'] == 'Pendente'
          ? FloatingActionButton(
              backgroundColor: AppColors.primary,
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewOcorrencia(isEdit: true, myId: widget.id)))
                  .then((_) => load()),
              child: const Icon(PhosphorIcons.pencil, color: Colors.white),
            )
          : null,
    );
  }
}

class _InfoCard extends StatelessWidget {
  final List<Widget> children;
  const _InfoCard({required this.children});

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}

class _Row extends StatelessWidget {
  final IconData icon;
  final String label, value;
  final Color? valueColor;
  const _Row({required this.icon, required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppColors.textSecondary(context)),
        const SizedBox(width: 8),
        Text('$label: ', style: AppTypography.captionMedium(context)),
        Expanded(
          child: Text(value,
              style: AppTypography.body(context).copyWith(color: valueColor),
              overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _StatusChip({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.12) : AppColors.surface(context),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? color : AppColors.border(context)),
        ),
        child: Text(label,
            style: AppTypography.captionMedium(context).copyWith(color: selected ? color : AppColors.textSecondary(context))),
      ),
    );
  }
}

class OcorrenciaRespostaModel {
  int? id;
  String? descricao, status;
  bool? isResposta;

  OcorrenciaRespostaModel({this.id, this.descricao, this.status, this.isResposta});

  Map toJson() => {'id': id, 'descricao': descricao, 'status': status, 'isResposta': isResposta};
}
