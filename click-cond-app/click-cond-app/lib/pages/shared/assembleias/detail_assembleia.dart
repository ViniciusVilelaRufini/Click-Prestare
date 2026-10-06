import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
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
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'new_votacao.dart';

class DetailAssembleia extends StatefulWidget {
  const DetailAssembleia({super.key, required this.id});
  final int id;

  /// Botão "Nova votação" (síndico).
  static const chaveNovaVotacao = Key('assembleia-nova-votacao');

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
        await load();
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
        await load();
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
    final isSindico = getUserType() == 'sindico';

    // Spinner de tela cheia só no primeiro carregamento; depois (votar,
    // excluir, recarregar) o conteúdo fica e os botões mostram o estado.
    final Widget body;
    if (obj == null) {
      body = _isLoading ? const Center(child: CircularProgressIndicator()) : const SizedBox();
    } else {
      body = RefreshIndicator(
        onRefresh: load,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _cabecalho(isSindico),
              const SizedBox(height: AppSpacing.xl),
              _tituloVotacoes(isSindico),
              const SizedBox(height: AppSpacing.md),
              if (votacoes.isEmpty)
                _semVotacoes()
              else
                for (var item in votacoes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: CellVotacao(
                      key: ValueKey('votacao-${item['id']}'),
                      item: item,
                      isRegister: false,
                      meusVotos: meus_votos,
                      carregando: _isLoading,
                      onPressedDelete: () => delete(item['id']),
                      onPressedChoice: (id) => insertVoto(id, item['id']),
                    ),
                  ),
            ],
          ),
        ),
      );
    }

    return AppScaffold(
      title: getText('lb_assembleia'),
      actions: isSindico
          ? [
              IconButton(
                onPressed: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => ModalFinalizarAssembleia(assembleia: obj))),
                icon: const Icon(PhosphorIcons.flagCheckered, size: 22),
                tooltip: 'Finalizar assembleia',
              ),
            ]
          : null,
      body: body,
    );
  }

  Widget _cabecalho(bool isSindico) {
    final titulo = textoLimpo(obj['titulo']);
    final quando = dataHoraExtensoAssembleia(obj['data'], obj['hora']);
    final local = textoLimpo(obj['local']);
    final descricao = textoLimpo(obj['descricao']);
    final anexos = textoLimpo(obj['anexos']).split(';').where((s) => s.trim().isNotEmpty).toList();
    final proximidade = quandoAssembleia(obj['data']);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    titulo,
                    style: AppTypography.title(context).copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary(context),
                      height: 1.3,
                    ),
                  ),
                ),
              ),
              if (isSindico)
                IconButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => NewAssembleia(isEdit: true, myId: obj['id'])),
                  ).then((_) => load()),
                  tooltip: 'Editar assembleia',
                  icon: Icon(PhosphorIcons.pencilSimple, size: 20, color: corDestaqueVotacao(context)),
                ),
            ],
          ),
          if (proximidade.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              proximidade,
              style: AppTypography.caption(context).copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: assembleiaEhHoje(obj['data'])
                    ? statusVotacaoInfo(1).corTexto(context)
                    : statusVotacaoInfo(0).corTexto(context),
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          if (quando.isNotEmpty) _linhaInfo(PhosphorIcons.calendarBlank, quando),
          if (local.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            _linhaInfo(PhosphorIcons.mapPin, local, rotulo: getText('assembleia_local')),
          ],
          if (descricao.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Divider(height: 1, color: AppColors.border(context)),
            const SizedBox(height: AppSpacing.md),
            Text(
              getText('lb_descricao'),
              style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context)),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              descricao,
              style: AppTypography.body(context).copyWith(
                color: AppColors.textPrimary(context),
                height: 1.45,
              ),
            ),
          ],
          if (anexos.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Divider(height: 1, color: AppColors.border(context)),
            const SizedBox(height: AppSpacing.md),
            Text(
              getText('lb_anexos'),
              style: AppTypography.captionMedium(context).copyWith(color: AppColors.textSecondary(context)),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (var i = 0; i < anexos.length; i++)
                  _ChipAnexo(
                    rotulo: 'Anexo ${i + 1}',
                    onTap: () => launchInBrowser(anexos[i], context),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _linhaInfo(IconData icone, String texto, {String? rotulo}) {
    return Semantics(
      label: rotulo == null ? texto : '$rotulo: $texto',
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: corDestaqueVotacao(context)),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              texto,
              style: AppTypography.body(context).copyWith(
                fontWeight: FontWeight.w500,
                color: AppColors.textPrimary(context),
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tituloVotacoes(bool isSindico) {
    return Row(
      children: [
        Expanded(
          child: Wrap(
            spacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                getText('lb_votacoes'),
                style: AppTypography.title(context).copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary(context),
                ),
              ),
              if (votacoes.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    border: Border.all(color: AppColors.border(context)),
                  ),
                  child: Text(
                    '${votacoes.length}',
                    style: AppTypography.caption(context).copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary(context),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (isSindico)
          TextButton.icon(
            key: DetailAssembleia.chaveNovaVotacao,
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => NewVotacao(idAssembleia: widget.id, isEnquete: false)),
            ).then((_) => load()),
            style: TextButton.styleFrom(
              foregroundColor: corDestaqueVotacao(context),
              minimumSize: const Size(48, 48),
            ),
            icon: const Icon(PhosphorIcons.plus, size: 16),
            label: const Text('Nova votação'),
          ),
      ],
    );
  }

  Widget _semVotacoes() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        children: [
          Icon(PhosphorIcons.chartBar, size: 26, color: AppColors.textTertiary(context)),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Nenhuma votação nesta assembleia.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context).copyWith(
              fontSize: 13,
              color: AppColors.textSecondary(context),
            ),
          ),
        ],
      ),
    );
  }
}

/// Anexo da assembleia: abre o arquivo no navegador.
class _ChipAnexo extends StatelessWidget {
  final String rotulo;
  final VoidCallback onTap;
  const _ChipAnexo({required this.rotulo, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final destaque = corDestaqueVotacao(context);
    return Semantics(
      button: true,
      label: 'Baixar $rotulo',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surface(context),
        shape: StadiumBorder(side: BorderSide(color: AppColors.border(context))),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(PhosphorIcons.downloadSimple, size: 18, color: destaque),
                  const SizedBox(width: AppSpacing.xs),
                  Text(
                    rotulo,
                    style: AppTypography.caption(context).copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: destaque,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
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
