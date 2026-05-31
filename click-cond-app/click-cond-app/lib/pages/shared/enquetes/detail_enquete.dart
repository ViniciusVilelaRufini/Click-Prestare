import 'package:click/controllers/controller_enquetes.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DetailEnquete extends StatefulWidget {
  const DetailEnquete({Key? key, required this.id}) : super(key: key);
  final int id;

  @override
  _DetailEnquetePageState createState() => _DetailEnquetePageState();
}

class _DetailEnquetePageState extends State<DetailEnquete> {
  var _isLoading = false;
  dynamic obj;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      obj = await apiGetDetails('assembleias/votacoes/enquetes', widget.id);
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> finish() async {
    try {
      var choice = await showConfirmDialog(context, text: getText('votacao_confirm_delete'));
      if (choice != null && choice) {
        setState(() => _isLoading = true);
        await apiFinishEnquete(widget.id.toString());
        load();
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> insertVoto(int opcao_id, int votacao_id) async {
    try {
      setState(() => _isLoading = true);
      var voto = VotoModel(opcao_id: opcao_id, votacao_id: votacao_id);
      var res = await apiSaveObject("assembleias/votacoes/voto", "voto", voto, false);
      if (res.toString().isEmpty) {
        load();
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Color _statusColor(int status) {
    if (status == 1) return Colors.green;
    if (status == 2) return Colors.red;
    return Colors.orange;
  }

  String _statusLabel(int status) {
    if (status == 0) return getText('votacao_agendado');
    if (status == 1) return getText('votacao_andamento');
    if (status == 2) return getText('votacao_finalizado');
    return '';
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('votacao_enquete'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : obj == null
              ? const SizedBox()
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _section(getText('votacao_infos')),
                      const SizedBox(height: AppSpacing.sm),
                      _buildPollCard(context),
                      const SizedBox(height: AppSpacing.xxxl),
                    ],
                  ),
                ),
    );
  }

  Widget _buildPollCard(BuildContext context) {
    final votacao = obj['votacao'];
    final status = votacao['status'] as int;
    final title = votacao['titulo'] ?? '';
    final description = votacao['descricao'] ?? '';
    final options = votacao['opcoes'] ?? [];
    final myVotes = obj['meuVoto'] ?? [];

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border(context)),
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _StatusChip(
                label: _statusLabel(status),
                color: _statusColor(status),
              ),
              Row(
                children: [
                  Icon(
                    PhosphorIcons.calendarBlank,
                    size: 14,
                    color: AppColors.textSecondary(context),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Até ${votacao['data_termino']}',
                    style: AppTypography.caption(context).copyWith(
                      color: AppColors.textSecondary(context),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            title,
            style: AppTypography.title(context).copyWith(
              fontWeight: FontWeight.bold,
              color: AppColors.textPrimary(context),
            ),
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              description,
              style: AppTypography.bodySecondary(context).copyWith(
                color: AppColors.textSecondary(context),
              ),
            ),
          ],
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Divider(height: 1),
          ),
          Text(
            getText('escolha_opcao_desejada'),
            style: AppTypography.bodySecondary(context).copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          for (var opcao in options)
            _buildOptionRow(
              context,
              votacao,
              opcao.split(';')[0],
              opcao.split(';')[1],
              int.tryParse(opcao.split(';')[2]) ?? 0,
              myVotes,
            ),
          if (getUserType() == 'sindico' && status == 1) ...[
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Divider(height: 1),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: finish,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.orange,
                ),
                icon: const Icon(PhosphorIcons.flagCheckered, size: 16),
                label: Text(
                  getText('votacao_finalizar'),
                  style: AppTypography.bodySecondary(context).copyWith(
                    color: Colors.orange,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildOptionRow(
    BuildContext context,
    dynamic votacao,
    String id,
    String text,
    int votesCount,
    List<dynamic> myVotes,
  ) {
    final isSelected = myVotes.contains(id);
    final isClosed = votacao['status'] != 1;
    
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        onTap: () {
          if (isClosed) {
            displayMessage(context, getText('alert_ops'), getText('votacao_fora_periodo'));
          } else {
            insertVoto(int.parse(id), votacao['id']);
          }
        },
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
          decoration: BoxDecoration(
            color: isSelected 
                ? AppColors.primary.withOpacity(0.08) 
                : AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.border(context),
              width: isSelected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                isSelected ? PhosphorIcons.checkCircleFill : PhosphorIcons.circle,
                color: isSelected ? AppColors.primary : AppColors.textTertiary(context),
                size: 20,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  text,
                  style: AppTypography.bodyMedium(context).copyWith(
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                    color: AppColors.textPrimary(context),
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isSelected 
                      ? AppColors.primary.withOpacity(0.12) 
                      : AppColors.bg(context),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  votesCount == 1 ? '1 voto' : '$votesCount votos',
                  style: AppTypography.caption(context).copyWith(
                    color: isSelected ? AppColors.primary : AppColors.textSecondary(context),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _section(String title) => Text(
        title.toUpperCase(),
        style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8),
      );
}

class _StatusChip extends StatelessWidget {
  final String label;
  final Color color;
  const _StatusChip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: AppTypography.caption(context).copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class VotoModel {
  int? votacao_id;
  int? opcao_id;

  VotoModel({this.votacao_id, this.opcao_id});

  Map toJson() => {'votacao_id': votacao_id, 'opcao_id': opcao_id};
}
