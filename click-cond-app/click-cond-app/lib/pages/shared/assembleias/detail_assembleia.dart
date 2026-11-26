import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
import 'package:click/pages/shared/assembleias/new_assembleia.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_finalizar_assembleia.dart';
import 'package:click/widgets/app/app_button.dart';
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

  /// Botão "Abrir ATA" da assembleia finalizada.
  static const chaveAbrirAta = Key('assembleia-abrir-ata');

  /// Texto quando a ATA não abre nem depois de recarregar o link.
  static const erroAbrirAta = 'Não foi possível abrir a ATA agora. Ela também fica em Documentos.';

  /// Confere se o link assinado ainda abre (GET de 1 byte, sem o token da
  /// sessão). Nulo = não deu para saber. Campo para o teste trocar.
  static Future<bool?> Function(String url) conferirLink = _conferirLinkPadrao;

  /// Abre o link no navegador. Campo para o teste trocar.
  static Future<void> Function(String url, BuildContext context) abrirLink = launchInBrowser;

  /// Devolve [conferirLink] e [abrirLink] ao padrão (tearDown dos testes).
  static void restaurarPadroes() {
    conferirLink = _conferirLinkPadrao;
    abrirLink = launchInBrowser;
  }

  static Future<bool?> _conferirLinkPadrao(String url) async {
    try {
      // Cliente cru: o S3 recusa o Authorization que o ApiClient põe.
      final r = await ApiClient.client
          .get(Uri.parse(url), headers: {'Range': 'bytes=0-0'})
          .timeout(const Duration(seconds: 10));
      return linkAtaValido(r.statusCode);
    } catch (_) {
      return null;
    }
  }

  @override
  _DetailAssembleiaPageState createState() => _DetailAssembleiaPageState();
}

class _DetailAssembleiaPageState extends State<DetailAssembleia> {
  var _isLoading = false;

  /// Conferindo/recarregando o link da ATA.
  var _abrindoAta = false;
  dynamic obj;
  List<dynamic> votacoes = [];
  List<dynamic> meus_votos = [];

  /// `votosPorUnidade` da API: `[{ id_votacao, id_apto, rotulo, opcao }]`
  /// (vazio na API antiga).
  dynamic votos_por_unidade;

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
      votos_por_unidade = res['votosPorUnidade'];
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
      final res = await apiDeleteObjectResultado('assembleias/votacoes', idToRemove);
      if (mounted) setState(() => _isLoading = false);
      if (res.ok) {
        await load();
      } else {
        // Ex.: "Esta pauta já tem votos e não pode ser excluída. Encerre a votação."
        if (mounted) displayMessage(context, getText('alert_error'), res.mensagemOu(getText('alert_generic_error')));
      }
    }
  }

  Future<void> insertVoto(int opcao_id, int votacao_id, {int? id_apto}) async {
    try {
      setState(() => _isLoading = true);
      var voto = VotoModel(opcao_id: opcao_id, votacao_id: votacao_id, id_apto: id_apto);
      final res = await apiSaveObjectResultado("assembleias/votacoes/voto", "voto", voto);
      if (res.ok) {
        await load();
      } else {
        // Recusa da API (ex.: 409 "O proprietário da unidade já votou…")
        // como veio; texto técnico vira o genérico.
        if (mounted) displayMessage(context, getText('alert_error'), res.mensagemOu(getText('alert_generic_error')));
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Finalizada com a ATA: somente leitura (sem editar, finalizar, nova
  /// votação, excluir nem votar).
  bool get _finalizada => assembleiaFinalizada(obj);

  @override
  Widget build(BuildContext context) {
    final finalizada = _finalizada;
    final isSindico = getUserType() == 'sindico';
    final gerencia = isSindico && !finalizada;

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
              if (finalizada) ...[
                _cardFinalizada(),
                const SizedBox(height: AppSpacing.lg),
              ],
              _cabecalho(gerencia),
              const SizedBox(height: AppSpacing.xl),
              _tituloVotacoes(gerencia),
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
                      unidades: unidadesDaVotacao(votos_por_unidade, item['id']),
                      carregando: _isLoading,
                      somenteLeitura: finalizada,
                      onPressedDelete: () => delete(item['id']),
                      onPressedChoice: (id, idApto) => insertVoto(id, item['id'], id_apto: idApto),
                    ),
                  ),
            ],
          ),
        ),
      );
    }

    return AppScaffold(
      title: getText('lb_assembleia'),
      actions: gerencia
          ? [
              Padding(
                padding: const EdgeInsets.only(right: AppSpacing.sm),
                child: IconButton(
                  onPressed: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => ModalFinalizarAssembleia(assembleia: obj))),
                  icon: const Icon(PhosphorIcons.flagCheckered, size: 22),
                  tooltip: 'Finalizar assembleia',
                ),
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
        color: AppColors.surface(context),
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

  /// Abre a ATA. O link é assinado no `get` e expira: se a conferência diz
  /// que não abre mais, recarrega o detalhe (link novo) uma vez e tenta de
  /// novo; só então mostra o erro.
  Future<void> _abrirAta() async {
    setState(() => _abrindoAta = true);
    try {
      var link = linkAta(obj);
      var valido = link == null ? false : await DetailAssembleia.conferirLink(link);
      if (valido == false) {
        await load();
        link = linkAta(obj);
        valido = link == null ? false : await DetailAssembleia.conferirLink(link);
      }
      if (!mounted) return;
      if (link == null || valido == false) {
        displayMessage(context, getText('alert_error'), DetailAssembleia.erroAbrirAta);
        return;
      }
      await DetailAssembleia.abrirLink(link, context);
    } finally {
      if (mounted) setState(() => _abrindoAta = false);
    }
  }

  /// Faixa da assembleia finalizada: quando, que nada foi apagado e a ATA.
  Widget _cardFinalizada() {
    final quando = dataFinalizacao(obj['finalizada_em']);
    final ata = linkAta(obj);
    final cor = statusVotacaoInfo(2).cor;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: cor.withValues(alpha: isDark ? 0.14 : 0.07),
          borderRadius: AppRadius.rmd,
          border: Border.all(color: cor.withValues(alpha: isDark ? 0.35 : 0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(PhosphorIcons.lockSimple, size: 20, color: AppColors.textSecondary(context)),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        quando.isEmpty ? 'Assembleia finalizada' : 'Assembleia finalizada em $quando',
                        style: AppTypography.bodyMedium(context).copyWith(
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary(context),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Guardada no histórico com as votações e o resultado final.',
                        style: AppTypography.caption(context).copyWith(
                          fontSize: 13,
                          color: AppColors.textSecondary(context),
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (ata != null) ...[
              const SizedBox(height: AppSpacing.md),
              AppButton(
                key: DetailAssembleia.chaveAbrirAta,
                label: 'Abrir ATA',
                icon: PhosphorIcons.filePdf,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.md,
                loading: _abrindoAta,
                onPressed: _abrindoAta ? null : _abrirAta,
              ),
            ],
          ],
        ),
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
                (getText('lb_votacoes')).toUpperCase(),
                style: AppTypography.section(context),
              ),
              if (votacoes.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.tag),
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
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              key: DetailAssembleia.chaveNovaVotacao,
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => NewVotacao(idAssembleia: widget.id, isEnquete: false)),
              ).then((_) => load()),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.textPrimary(context),
                side: BorderSide(color: AppColors.borderStrong(context)),
                shape: const RoundedRectangleBorder(),
                minimumSize: const Size(48, 40),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              ),
              icon: const Icon(PhosphorIcons.plus, size: 16),
              // `button` traz a cor de texto sobre fundo de destaque; aqui o
              // fundo é transparente, então a cor tem de ser a do texto comum
              // (sem isso o rótulo sumia no tema claro).
              label: Text('Nova votação'.toUpperCase(),
                  style: AppTypography.button(context).copyWith(color: AppColors.textPrimary(context))),
            ),
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
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.tag),
          side: BorderSide(color: AppColors.border(context)),
        ),
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

  /// Unidade pela qual o voto é dado; fora do corpo quando nula (API antiga).
  int? id_apto;

  VotoModel({this.votacao_id, this.opcao_id, this.id_apto});

  Map toJson() => {'votacao_id': votacao_id, 'opcao_id': opcao_id, if (id_apto != null) 'id_apto': id_apto};
}
