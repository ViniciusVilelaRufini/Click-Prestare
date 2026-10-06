import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:click/widgets/votacao/votacao_status_badge.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Uma votação dentro do detalhe da assembleia, no mesmo visual das Enquetes:
/// selo de status, prazo, opções como cards selecionáveis (em andamento e sem
/// voto) ou barras de resultado (já votou, agendada ou encerrada).
///
/// O voto não é mais enviado no toque da opção: escolhe-se a opção e confirma
/// em "Votar", que chama [onPressedChoice] com o id da opção (mesmo contrato
/// de antes). Quem já votou numa votação em andamento pode "Alterar voto" (a
/// API substitui o voto anterior, como acontecia ao tocar em outra opção).
///
/// Formato de [item] (assembleias.service.ts → getVotacoesFormatadas):
/// `{ id, titulo, descricao, data_inicio, data_termino, status: 0|1|2,
/// opcoes: ['id;nome;votos'] }`. [meusVotos] são os ids (texto) das opções
/// em que o usuário votou na assembleia inteira.
class CellVotacao extends StatefulWidget {
  /// Mantido por compatibilidade (não é usado no visual atual).
  final bool? hasArrow;
  final dynamic item;
  final List<dynamic> meusVotos;

  /// Pré-visualização (sem contagem de votos, sem votar nem excluir).
  final bool isRegister;
  final VoidCallback onPressedDelete;
  final Function(int) onPressedChoice;

  /// Substitui o título do item.
  final String? title;

  /// A tela está enviando/recarregando: desabilita opções e botões.
  final bool carregando;

  const CellVotacao({
    super.key,
    required this.item,
    required this.meusVotos,
    this.hasArrow,
    this.title,
    required this.isRegister,
    required this.onPressedDelete,
    required this.onPressedChoice,
    this.carregando = false,
  });

  /// Botão do rodapé da votação (votar / confirmar / alterar voto).
  static Key chaveVotar(dynamic idVotacao) => ValueKey('votacao-$idVotacao-votar');

  /// Botão de excluir a votação (síndico).
  static Key chaveExcluir(dynamic idVotacao) => ValueKey('votacao-$idVotacao-excluir');

  @override
  State<CellVotacao> createState() => _CellVotacaoState();
}

class _CellVotacaoState extends State<CellVotacao> {
  /// Opção marcada antes de enviar o voto (id em texto).
  String? _escolhida;

  /// Trocando um voto já dado.
  bool _alterando = false;

  @override
  void didUpdateWidget(covariant CellVotacao oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Dado novo da API (ex.: depois de votar): volta ao estado de leitura.
    // Em erro a tela não recarrega e a escolha continua marcada.
    if (!identical(oldWidget.item, widget.item)) {
      _escolhida = null;
      _alterando = false;
    }
  }

  dynamic get _item => widget.item;

  int? get _status {
    final s = _item['status'];
    if (s is int) return s;
    return int.tryParse('${s ?? ''}');
  }

  List<OpcaoVotacao> get _opcoes => parseOpcoes(_item['opcoes']);

  bool get _jaVotou => _opcoes.any((o) => votouNaOpcao(o.id, widget.meusVotos));

  bool get _escolhendo => !widget.isRegister && _status == 1 && (!_jaVotou || _alterando);

  static String _txt(dynamic v) {
    final s = (v ?? '').toString().trim();
    return s == 'null' ? '' : s;
  }

  void _votar() {
    final id = int.tryParse(_escolhida ?? '');
    if (id == null) return;
    widget.onPressedChoice(id);
  }

  @override
  Widget build(BuildContext context) {
    final isSindico = getUserType() == 'sindico';
    final status = _status;
    final titulo = widget.title ?? (_txt(_item['titulo']).isNotEmpty ? _txt(_item['titulo']) : _txt(_item['pergunta']));
    final descricao = _txt(_item['descricao']);
    final inicio = _txt(_item['data_inicio']);
    final termino = _txt(_item['data_termino']);
    final periodo = inicio.isNotEmpty && termino.isNotEmpty
        ? '$inicio a $termino'
        : termino.isNotEmpty
            ? 'Até $termino'
            : inicio;
    final prazo = prazoLabel(termino, status, dataInicio: inicio);
    final urgente = prazo == 'Encerra hoje' || prazo == 'Encerra amanhã';
    final opcoes = _opcoes;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Cabeçalho ──
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              VotacaoStatusBadge(status: _item['status']),
              if (prazo.isNotEmpty)
                _ChipPrazo(texto: prazo, cor: urgente ? statusVotacaoInfo(0).corTexto(context) : null),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            titulo,
            style: AppTypography.bodyMedium(context).copyWith(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary(context),
              height: 1.35,
            ),
          ),
          if (descricao.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              descricao,
              style: AppTypography.caption(context).copyWith(
                fontSize: 13,
                color: AppColors.textSecondary(context),
                height: 1.4,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.xs,
            children: [
              if (periodo.isNotEmpty) _meta(PhosphorIcons.calendarBlank, periodo),
              if (!widget.isRegister) _meta(PhosphorIcons.users, votosLabel(totalVotos(opcoes))),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Divider(height: 1, color: AppColors.border(context)),
          const SizedBox(height: AppSpacing.md),

          // ── Estado + opções ──
          if (!widget.isRegister) ...[
            _aviso(status, inicio),
            const SizedBox(height: AppSpacing.md),
          ],
          if (opcoes.isEmpty)
            Text(
              getText('alert_list_empty_generic'),
              style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context)),
            )
          else
            ..._listaOpcoes(opcoes),

          // ── Ações ──
          if (!widget.isRegister && status == 1) ...[
            const SizedBox(height: AppSpacing.xs),
            _acoes(),
          ],
          if (isSindico && !widget.isRegister) ...[
            const SizedBox(height: AppSpacing.sm),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                key: CellVotacao.chaveExcluir(_item['id']),
                onPressed: widget.carregando ? null : widget.onPressedDelete,
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFFDC2626),
                  minimumSize: const Size(48, 48),
                ),
                icon: const Icon(PhosphorIcons.trash, size: 18),
                label: Text(
                  getText('btn_delete'),
                  style: AppTypography.body(context).copyWith(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? const Color(0xFFF87171)
                        : const Color(0xFFDC2626),
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

  List<Widget> _listaOpcoes(List<OpcaoVotacao> opcoes) {
    if (widget.isRegister) {
      // Pré-visualização: só os textos das opções, sem votos.
      return [
        for (final o in opcoes)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: OpcaoSelecionavel(rotulo: o.nome, selecionado: false, habilitado: false),
          ),
      ];
    }
    if (_escolhendo) {
      return [
        for (final o in opcoes)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: OpcaoSelecionavel(
              rotulo: o.nome,
              selecionado: _escolhida == o.id,
              habilitado: !widget.carregando,
              onTap: () => setState(() => _escolhida = o.id),
            ),
          ),
      ];
    }
    final pcts = percentuais([for (final o in opcoes) o.votos]);
    return [
      for (var i = 0; i < opcoes.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: OpcaoResultadoBar(
            rotulo: opcoes[i].nome,
            votos: opcoes[i].votos,
            percentual: pcts[i],
            meuVoto: votouNaOpcao(opcoes[i].id, widget.meusVotos),
          ),
        ),
    ];
  }

  /// Linha curta que explica o que dá para fazer nesta votação agora.
  Widget _aviso(int? status, String inicio) {
    final IconData icone;
    final Color cor;
    final String texto;
    if (status == 1 && _alterando) {
      icone = PhosphorIcons.arrowsClockwise;
      cor = statusVotacaoInfo(1).corTexto(context);
      texto = 'Escolha a nova opção e confirme. Seu voto anterior será substituído.';
    } else if (status == 1 && _jaVotou) {
      icone = PhosphorIcons.checkCircle;
      cor = statusVotacaoInfo(1).corTexto(context);
      texto = 'Você já votou. Seu voto está destacado.';
    } else if (status == 1) {
      icone = PhosphorIcons.handPointing;
      cor = statusVotacaoInfo(1).corTexto(context);
      texto = 'Escolha uma opção e toque em Votar.';
    } else if (status == 0) {
      icone = PhosphorIcons.hourglassMedium;
      cor = statusVotacaoInfo(0).corTexto(context);
      texto = inicio.isEmpty ? 'A votação ainda não foi aberta.' : 'A votação abre em $inicio.';
    } else if (status == 2) {
      icone = PhosphorIcons.lockSimple;
      cor = AppColors.textSecondary(context);
      texto = _jaVotou ? 'Votação encerrada. Seu voto está destacado.' : 'Votação encerrada. Este é o resultado final.';
    } else {
      icone = PhosphorIcons.info;
      cor = AppColors.textSecondary(context);
      texto = getText('votacao_fora_periodo');
    }
    return Semantics(
      liveRegion: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: cor),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              texto,
              style: AppTypography.caption(context).copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: cor,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// "Votar" (só com opção escolhida), "Cancelar" + "Confirmar voto" ao
  /// trocar, ou "Alterar voto" para quem já votou.
  Widget _acoes() {
    final chave = CellVotacao.chaveVotar(_item['id']);
    if (!_escolhendo) {
      return AppButton(
        key: chave,
        label: 'Alterar voto',
        icon: PhosphorIcons.arrowsClockwise,
        variant: AppButtonVariant.secondary,
        size: AppButtonSize.md,
        onPressed: widget.carregando
            ? null
            : () => setState(() {
                  _alterando = true;
                  final meu = _opcoes.where((o) => votouNaOpcao(o.id, widget.meusVotos));
                  _escolhida = meu.isEmpty ? null : meu.first.id;
                }),
      );
    }
    final mesmaOpcao = _alterando && _escolhida != null && votouNaOpcao(_escolhida, widget.meusVotos);
    final pode = _escolhida != null && !mesmaOpcao && !widget.carregando;
    final votar = AppButton(
      key: chave,
      label: _alterando ? 'Confirmar voto' : 'Votar',
      icon: PhosphorIcons.checkCircle,
      size: AppButtonSize.md,
      loading: widget.carregando,
      onPressed: pode ? _votar : null,
    );
    if (!_alterando) return votar;
    return Row(
      children: [
        Expanded(
          flex: 2,
          child: AppButton(
            label: 'Cancelar',
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.md,
            onPressed: widget.carregando
                ? null
                : () => setState(() {
                      _alterando = false;
                      _escolhida = null;
                    }),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(flex: 3, child: votar),
      ],
    );
  }

  Widget _meta(IconData icone, String texto) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icone, size: 15, color: AppColors.textTertiary(context)),
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
}

/// Chip de prazo ao lado do selo de status (mesmo do detalhe da enquete).
class _ChipPrazo extends StatelessWidget {
  final String texto;
  final Color? cor;
  const _ChipPrazo({required this.texto, this.cor});

  @override
  Widget build(BuildContext context) {
    final fg = cor ?? AppColors.textSecondary(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(PhosphorIcons.clock, size: 14, color: fg),
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
