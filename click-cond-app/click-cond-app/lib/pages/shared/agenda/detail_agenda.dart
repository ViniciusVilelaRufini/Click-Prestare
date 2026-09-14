import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/agenda/new_agenda.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DetailAgenda extends StatefulWidget {
  const DetailAgenda({super.key, required this.id});
  final int id;

  @override
  _DetailAgendaPageState createState() => _DetailAgendaPageState();
}

class _DetailAgendaPageState extends State<DetailAgenda> {
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
      obj = await apiGetDetails('agenda', widget.id);
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('lb_manut_programada'),
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
                          Text(getText('lb_titulo').toUpperCase(),
                              style: AppTypography.captionMedium(context)
                                  .copyWith(color: AppColors.primary, letterSpacing: 0.8)),
                          const SizedBox(height: AppSpacing.sm),
                          Text(obj['titulo'] ?? '',
                              style: AppTypography.headline(context)),
                        ]),
                        const SizedBox(height: AppSpacing.md),
                        _InfoCard(children: [
                          Text(getText('data_e_hora').toUpperCase(),
                              style: AppTypography.captionMedium(context)
                                  .copyWith(color: AppColors.primary, letterSpacing: 0.8)),
                          const SizedBox(height: AppSpacing.md),
                          _DateRow(
                            icon: PhosphorIcons.calendarBlank,
                            label: getText('lb_inicio'),
                            date: obj['data_inicio'] ?? '',
                            time: obj['hora_inicio'] ?? '',
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          _DateRow(
                            icon: PhosphorIcons.calendarCheck,
                            label: getText('lb_termino'),
                            date: obj['data_termino'] ?? '',
                            time: obj['hora_termino'] ?? '',
                          ),
                        ]),
                        if ((obj['descricao']?.toString() ?? '').isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.md),
                          _InfoCard(children: [
                            Text(getText('lb_descricao').toUpperCase(),
                                style: AppTypography.captionMedium(context)
                                    .copyWith(color: AppColors.primary, letterSpacing: 0.8)),
                            const SizedBox(height: AppSpacing.sm),
                            Text(obj['descricao'] ?? '', style: AppTypography.body(context)),
                          ]),
                        ],
                        const SizedBox(height: AppSpacing.xxxl),
                      ],
                    ),
                  ),
                ),
      floatingActionButton: getUserType() == 'sindico'
          ? FloatingActionButton(
              backgroundColor: AppColors.primary,
              onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => NewAgenda(isEdit: true, myId: widget.id)))
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

class _DateRow extends StatelessWidget {
  final IconData icon;
  final String label, date, time;
  const _DateRow({required this.icon, required this.label, required this.date, required this.time});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppColors.textSecondary(context)),
        const SizedBox(width: 8),
        Text('$label: ', style: AppTypography.captionMedium(context)),
        Text('$date às $time', style: AppTypography.body(context)),
      ],
    );
  }
}
