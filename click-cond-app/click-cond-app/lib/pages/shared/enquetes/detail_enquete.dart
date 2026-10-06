import 'package:click/controllers/controller_enquetes.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:click/widgets/votacao/votacao_status_badge.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DetailEnquete extends StatefulWidget {
  const DetailEnquete({super.key, required this.id});
  final int id;

  /// Botão fixo do rodapé (votar / confirmar novo voto / alterar voto).
  static const chaveBotaoVotar = Key('enquete-botao-votar');

  /// Botão do síndico para encerrar a enquete antes do prazo.
  static const chaveBotaoFinalizar = Key('enquete-botao-finalizar');

  @override
  _DetailEnquetePageState createState() => _DetailEnquetePageState();
}

class _DetailEnquetePageState extends State<DetailEnquete> {
  var _isLoading = false;
  dynamic obj;

  /// Opção marcada antes de enviar o voto (id em texto, como em `meuVoto`).
  String? _escolhida;

  /// Quem já votou numa enquete em andamento pode trocar o voto (a API
  /// substitui o voto anterior); este modo volta a mostrar as opções.
  bool _alterando = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      obj = await apiGetDetails('assembleias/votacoes/enquetes', widget.id);
      // Dado novo (ex.: depois de votar): volta ao estado de leitura.
      _escolhida = null;
      _alterando = false;
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
        await load();
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

  // ── Estado derivado ───────────────────────────────────────────────────────

  dynamic get _votacao => obj == null ? null : obj['votacao'];

  int? get _status {
    final s = _votacao?['status'];
    if (s is int) return s;
    return int.tryParse('${s ?? ''}');
  }

  List<dynamic> get _meuVoto {
    final m = obj?['meuVoto'];
    return m is List ? m : const [];
  }

  bool get _jaVotou => _meuVoto.isNotEmpty;

  /// Mostra as opções para escolher: enquete em andamento e ainda sem voto
  /// (ou trocando o voto).
  bool get _escolhendo => _status == 1 && (!_jaVotou || _alterando);

  /// Mesma regra de antes: síndico, com a enquete em andamento.
  bool get _podeFinalizar => getUserType() == 'sindico' && _status == 1;

  void _votar() {
    final id = _escolhida;
    final votacaoId = _votacao?['id'];
    if (id == null || votacaoId == null) return;
    final opcao = int.tryParse(id);
    if (opcao == null) return;
    insertVoto(opcao, votacaoId is int ? votacaoId : int.parse('$votacaoId'));
  }

  void _comecarAlteracao() {
    setState(() {
      _alterando = true;
      _escolhida = _meuVoto.isEmpty ? null : _meuVoto.first.toString();
    });
  }

  void _cancelarAlteracao() {
    setState(() {
      _alterando = false;
      _escolhida = null;
    });
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final Widget body;
    if (obj == null) {
      body = _isLoading ? const Center(child: CircularProgressIndicator()) : const SizedBox();
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: RefreshIndicator(
              onRefresh: load,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _cabecalho(),
                    const SizedBox(height: AppSpacing.lg),
                    _avisoEstado(),
                    const SizedBox(height: AppSpacing.xl),
                    _secaoOpcoes(),
                    if (_podeFinalizar) ...[
                      const SizedBox(height: AppSpacing.xl),
                      _cardFinalizar(),
                    ],
                  ],
                ),
              ),
            ),
          ),
          if (_status == 1) _rodape(),
        ],
      );
    }

    return AppScaffold(
      title: getText('votacao_enquete'),
      body: body,
    );
  }

  Widget _cabecalho() {
    final votacao = _votacao;
    final titulo = textoLimpo(votacao['titulo']).isNotEmpty ? textoLimpo(votacao['titulo']) : textoLimpo(votacao['pergunta']);
    final pergunta = textoLimpo(votacao['pergunta']);
    final descricao = textoLimpo(votacao['descricao']);
    final prazo = prazoLabel(textoLimpo(votacao['data_termino']), votacao['status'],
        dataInicio: textoLimpo(votacao['data_inicio']));
    final inicio = textoLimpo(votacao['data_inicio']);
    final termino = textoLimpo(votacao['data_termino']);
    final periodo = inicio.isNotEmpty && termino.isNotEmpty
        ? '$inicio a $termino'
        : termino.isNotEmpty
            ? 'Até $termino'
            : inicio;
    final total = totalVotos(votacao['opcoes']);
    final urgente = prazoUrgente(termino, votacao['status']);

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
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              VotacaoStatusBadge(status: votacao['status']),
              if (prazo.isNotEmpty)
                _ChipMeta(
                  icone: PhosphorIcons.clock,
                  texto: prazo,
                  cor: urgente ? statusVotacaoInfo(0).corTexto(context) : null,
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            titulo,
            style: AppTypography.title(context).copyWith(
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(context),
              height: 1.3,
            ),
          ),
          if (pergunta.isNotEmpty && pergunta != titulo) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              pergunta,
              style: AppTypography.bodyMedium(context).copyWith(
                color: AppColors.textPrimary(context),
                height: 1.4,
              ),
            ),
          ],
          if (descricao.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              descricao,
              style: AppTypography.body(context).copyWith(
                color: AppColors.textSecondary(context),
                height: 1.45,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          Divider(height: 1, color: AppColors.border(context)),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.sm,
            children: [
              if (periodo.isNotEmpty) _meta(PhosphorIcons.calendarBlank, periodo),
              _meta(PhosphorIcons.users, votosLabel(total)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _meta(IconData icone, String texto) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icone, size: 16, color: AppColors.textTertiary(context)),
          const SizedBox(width: AppSpacing.xs),
          Flexible(
            child: Text(
              texto,
              style: AppTypography.caption(context).copyWith(
                fontSize: 13,
                color: AppColors.textSecondary(context),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      );

  /// Faixa que explica, em uma frase, o que dá para fazer agora.
  Widget _avisoEstado() {
    final status = _status;
    final inicio = textoLimpo(_votacao['data_inicio']);
    final IconData icone;
    final Color cor;
    final String titulo;
    final String texto;

    if (status == 1 && _alterando) {
      icone = PhosphorIcons.arrowsClockwise;
      cor = statusVotacaoInfo(1).cor;
      titulo = 'Alterando seu voto';
      texto = 'Escolha a nova opção e confirme. Seu voto anterior será substituído.';
    } else if (status == 1 && _jaVotou) {
      icone = PhosphorIcons.checkCircle;
      cor = statusVotacaoInfo(1).cor;
      titulo = 'Você já votou';
      texto = 'Seu voto está destacado abaixo. Você pode alterá-lo até o encerramento.';
    } else if (status == 1) {
      icone = PhosphorIcons.handPointing;
      cor = statusVotacaoInfo(1).cor;
      titulo = 'Votação aberta';
      texto = 'Escolha uma opção e toque em Votar.';
    } else if (status == 0) {
      icone = PhosphorIcons.hourglassMedium;
      cor = statusVotacaoInfo(0).cor;
      titulo = 'Enquete ainda não começou';
      texto = inicio.isEmpty
          ? 'A votação ainda não foi aberta.'
          : 'A votação abre em $inicio.';
    } else if (status == 2) {
      icone = PhosphorIcons.lockSimple;
      cor = statusVotacaoInfo(2).cor;
      titulo = 'Enquete encerrada';
      texto = _jaVotou ? 'Este é o resultado final. Seu voto está destacado.' : 'Este é o resultado final.';
    } else {
      icone = PhosphorIcons.info;
      cor = statusVotacaoInfo(null).cor;
      titulo = getText('votacao_fora_periodo');
      texto = '';
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fg = isDark ? Color.lerp(cor, Colors.white, 0.3)! : Color.lerp(cor, Colors.black, 0.4)!;

    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: cor.withValues(alpha: isDark ? 0.14 : 0.07),
          borderRadius: AppRadius.rmd,
          border: Border.all(color: cor.withValues(alpha: isDark ? 0.35 : 0.25)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icone, size: 20, color: fg),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    titulo,
                    style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w700, color: fg),
                  ),
                  if (texto.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      texto,
                      style: AppTypography.caption(context).copyWith(
                        fontSize: 13,
                        color: AppColors.textPrimary(context),
                        height: 1.4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _secaoOpcoes() {
    final opcoes = parseOpcoes(_votacao['opcoes']);
    final escolhendo = _escolhendo;
    final pcts = percentuais([for (final o in opcoes) o.votos]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          escolhendo ? getText('escolha_opcao_desejada') : 'Resultado',
          style: AppTypography.title(context).copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary(context),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        if (opcoes.isEmpty)
          Text(
            getText('alert_list_empty_generic'),
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          )
        else
          for (var i = 0; i < opcoes.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: escolhendo
                  ? OpcaoSelecionavel(
                      rotulo: opcoes[i].nome,
                      selecionado: _escolhida == opcoes[i].id,
                      habilitado: !_isLoading,
                      onTap: () => setState(() => _escolhida = opcoes[i].id),
                    )
                  : OpcaoResultadoBar(
                      rotulo: opcoes[i].nome,
                      votos: opcoes[i].votos,
                      percentual: pcts[i],
                      meuVoto: votouNaOpcao(opcoes[i].id, _meuVoto),
                    ),
            ),
      ],
    );
  }

  Widget _cardFinalizar() {
    final rotulo = getText('votacao_finalizar').replaceAll('?', '').trim();
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Área do síndico',
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Encerra a enquete agora, antes da data de término.',
            style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
          ),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            key: DetailEnquete.chaveBotaoFinalizar,
            label: rotulo,
            icon: PhosphorIcons.flagCheckered,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.md,
            onPressed: _isLoading ? null : finish,
          ),
        ],
      ),
    );
  }

  /// Rodapé fixo (enquete em andamento): "Votar" habilitado só com uma opção
  /// escolhida; quem já votou vê "Alterar voto".
  Widget _rodape() {
    final Widget conteudo;
    if (_escolhendo) {
      final mesmaOpcao = _alterando && _escolhida != null && votouNaOpcao(_escolhida, _meuVoto);
      final pode = _escolhida != null && !mesmaOpcao && !_isLoading;
      final dica = _escolhida == null
          ? 'Escolha uma opção para votar.'
          : mesmaOpcao
              ? 'Escolha uma opção diferente do seu voto atual.'
              : null;
      final votar = AppButton(
        key: DetailEnquete.chaveBotaoVotar,
        label: _alterando ? 'Confirmar voto' : 'Votar',
        icon: PhosphorIcons.checkCircle,
        loading: _isLoading,
        onPressed: pode ? _votar : null,
      );
      conteudo = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (dica != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                dica,
                textAlign: TextAlign.center,
                style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
              ),
            ),
          if (_alterando)
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: AppButton(
                    label: 'Cancelar',
                    variant: AppButtonVariant.secondary,
                    onPressed: _isLoading ? null : _cancelarAlteracao,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(flex: 3, child: votar),
              ],
            )
          else
            votar,
        ],
      );
    } else {
      conteudo = AppButton(
        key: DetailEnquete.chaveBotaoVotar,
        label: 'Alterar voto',
        icon: PhosphorIcons.arrowsClockwise,
        variant: AppButtonVariant.secondary,
        onPressed: _isLoading ? null : _comecarAlteracao,
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
      child: conteudo,
    );
  }
}

/// Chip de prazo do cabeçalho, ao lado do selo de status.
class _ChipMeta extends StatelessWidget {
  final IconData icone;
  final String texto;
  final Color? cor;
  const _ChipMeta({required this.icone, required this.texto, this.cor});

  @override
  Widget build(BuildContext context) {
    final fg = cor ?? AppColors.textSecondary(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icone, size: 14, color: fg),
          const SizedBox(width: AppSpacing.xs),
          Flexible(
            child: Text(
              texto,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.caption(context).copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: fg,
                height: 1.3,
              ),
            ),
          ),
        ],
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
