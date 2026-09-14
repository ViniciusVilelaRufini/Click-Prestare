import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/new_assembleia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_finalizar_assembleia.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_votacao.dart';

class DetailAssembleia extends StatefulWidget {
  const DetailAssembleia({super.key, required this.id});
  final int id;

  @override
  _DetailAssembleiaPageState createState() => _DetailAssembleiaPageState();
}

class _DetailAssembleiaPageState extends State<DetailAssembleia> {
  var _isLoading = false;
  dynamic obj;
  List<dynamic> votacoes = [];
  List<dynamic> meus_votos = [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var res = await apiGetDetails('assembleias', widget.id);
      votacoes = res['votacoes'];
      meus_votos = res['meusVotos'];
      obj = res['assembleia'];
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> delete(int idToRemove) async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isLoading = true);
      var res = await apiDeleteObject('assembleias/votacoes', idToRemove);
      if (mounted) setState(() => _isLoading = false);
      if (res) {
        load();
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('lb_assembleia'),
      actions: getUserType() == 'sindico'
          ? [
              IconButton(
                onPressed: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => ModalFinalizarAssembleia(assembleia: obj))),
                icon: const Icon(PhosphorIcons.flagCheckered, size: 22),
                tooltip: getText('finalizar'),
              ),
            ]
          : null,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : obj == null
              ? const SizedBox()
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _section(getText('assembleia_infos')),
                      _InfoCard(
                        title: obj['titulo'],
                        subtitle: '${obj['data']} ${getText('as_hora')} ${obj['hora']}',
                        subtitleIcon: PhosphorIcons.clock,
                        trailing: getUserType() == 'sindico'
                            ? IconButton(
                                onPressed: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(builder: (_) => NewAssembleia(isEdit: true, myId: obj['id'])),
                                ).then((_) => load()),
                                icon: Icon(PhosphorIcons.pencil, size: 20, color: AppColors.primary),
                              )
                            : null,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      _InfoCard(title: getText('lb_descricao'), body: obj['descricao']),
                      const SizedBox(height: AppSpacing.md),
                      _InfoCard(title: getText('assembleia_local'), body: obj['local']),
                      if ((obj['anexos'] as String).isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.md),
                        _AnexosRow(anexos: obj['anexos']),
                      ],
                      const SizedBox(height: AppSpacing.xl),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _section(getText('lb_votacoes'), inline: true),
                          if (getUserType() == 'sindico')
                            TextButton.icon(
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute(builder: (_) => NewVotacao(idAssembleia: widget.id, isEnquete: false)),
                              ).then((_) => load()),
                              icon: const Icon(PhosphorIcons.plus, size: 16),
                              label: Text(getText('nova_votacao')),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      for (var item in votacoes)
                        CellVotacao(
                          item: item,
                          hasArrow: true,
                          isRegister: false,
                          meusVotos: meus_votos,
                          onPressedDelete: () => delete(item['id']),
                          onPressedChoice: (id) => insertVoto(id, item['id']),
                        ),
                      const SizedBox(height: AppSpacing.xxxl),
                    ],
                  ),
                ),
    );
  }

  Widget _section(String title, {bool inline = false}) {
    final widget = Text(title.toUpperCase(),
        style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8));
    if (inline) return widget;
    return Padding(padding: const EdgeInsets.only(bottom: AppSpacing.sm), child: widget);
  }
}

class _InfoCard extends StatelessWidget {
  final String title;
  final String? subtitle;
  final IconData? subtitleIcon;
  final String? body;
  final Widget? trailing;
  const _InfoCard({required this.title, this.subtitle, this.subtitleIcon, this.body, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(title, style: AppTypography.bodyMedium(context))),
              if (trailing != null) trailing!,
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                if (subtitleIcon != null) ...[
                  Icon(subtitleIcon, size: 14, color: AppColors.textSecondary(context)),
                  const SizedBox(width: 4),
                ],
                Text(subtitle!, style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context))),
              ],
            ),
          ],
          if (body != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(body!, style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
          ],
        ],
      ),
    );
  }
}

class _AnexosRow extends StatelessWidget {
  final String anexos;
  const _AnexosRow({required this.anexos});

  @override
  Widget build(BuildContext context) {
    final links = anexos.split(';').where((s) => s.isNotEmpty).toList();
    return Row(
      children: [
        Text('${getText('lb_anexos')}: ', style: AppTypography.captionMedium(context)),
        for (var i = 0; i < links.length; i++)
          InkWell(
            onTap: () => launchInBrowser(links[i], context),
            child: Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: Icon(PhosphorIcons.download, size: 22, color: AppColors.primary),
            ),
          ),
      ],
    );
  }
}

class VotoModel {
  int? votacao_id;
  int? opcao_id;

  VotoModel({this.votacao_id, this.opcao_id});

  Map toJson() => {'votacao_id': votacao_id, 'opcao_id': opcao_id};
}
