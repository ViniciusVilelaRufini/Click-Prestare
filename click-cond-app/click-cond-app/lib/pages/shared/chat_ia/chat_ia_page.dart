import 'dart:ui' show ImageFilter;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'resposta_formatada.dart';
import 'telas_app.dart';

/// Click IA — assistente do condomínio.
///
/// Consulta em linguagem natural (atas, funcionários, visitantes, cobranças) e
/// executa ações com confirmação. O escopo dos dados é aplicado no backend pelo
/// papel do usuário; aqui só se renderiza a conversa e os cards.
///
/// É uma página EMPURRADA, não aba: antes vivia dentro da ilha de navegação da
/// home, que ficava sobre o campo de digitar e não deixava caminho de volta.
class ChatIaPage extends StatefulWidget {
  const ChatIaPage({Key? key}) : super(key: key);

  @override
  State<ChatIaPage> createState() => _ChatIaPageState();
}

class _ChatMessage {
  final String texto;
  final bool isUser;

  /// Quando presente, a bolha vem acompanhada do card de confirmação.
  /// Nada foi gravado ainda: só o toque em Confirmar executa.
  final AcaoPendenteIa? acao;

  /// Estado do card: null = aguardando, texto = resultado já resolvido.
  String? resultado;
  bool resolvidaComSucesso = false;
  bool confirmando = false;

  _ChatMessage(this.texto, this.isUser, {this.acao});
}

class _ChatIaPageState extends State<ChatIaPage> {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  final List<_ChatMessage> _mensagens = [];
  bool _isSending = false;

  // Sugestões iniciais adaptadas ao papel do usuário.
  List<String> get _sugestoes {
    final tipo = getUserType();
    if (tipo == 'sindico') {
      return [
        'Quantos visitantes entraram hoje?',
        'O que foi decidido na última ata?',
        'Quem são os funcionários do condomínio?',
      ];
    }
    return [
      'Quais visitas estão agendadas para o meu apartamento?',
      'O que foi decidido na última assembleia?',
      'Quem trabalha na portaria?',
    ];
  }

  @override
  void dispose() {
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _enviar([String? textoSugerido]) async {
    final texto = (textoSugerido ?? _msgController.text).trim();
    if (texto.isEmpty || _isSending) return;

    setState(() {
      _mensagens.add(_ChatMessage(texto, true));
      _isSending = true;
      _msgController.clear();
    });
    _scrollToBottom();

    final resposta = await apiPerguntarChatIa(texto);

    if (!mounted) return;
    setState(() {
      _mensagens.add(_ChatMessage(resposta.texto, false, acao: resposta.acao));
      _isSending = false;
    });
    _scrollToBottom();
  }

  Future<void> _confirmarAcao(_ChatMessage msg) async {
    final acao = msg.acao;
    if (acao == null || acao.id == null || msg.confirmando || msg.resultado != null) return;

    setState(() => msg.confirmando = true);
    try {
      final mensagem = await apiConfirmarAcaoChatIa(acao.id!);
      if (!mounted) return;
      setState(() {
        msg.resultado = mensagem;
        msg.resolvidaComSucesso = true;
        msg.confirmando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        // Sem marcar como resolvida: o backend devolve a proposta ao estado
        // pendente quando a execução falha, então dá para tentar de novo.
        msg.confirmando = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppColors.error),
      );
    }
    _scrollToBottom();
  }

  void _cancelarAcao(_ChatMessage msg) {
    setState(() {
      msg.resultado = 'Cancelado.';
      msg.resolvidaComSucesso = false;
    });
  }

  /// Executa o efeito de um botão do card. Tudo aqui acontece só no app —
  /// nenhum destes efeitos escreve no servidor.
  Future<void> _acionarBotao(AcaoBotao botao) async {
    switch (botao.efeito) {
      case 'copiar':
        await Clipboard.setData(ClipboardData(text: botao.valor));
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${botao.rotulo.replaceFirst('Copiar ', '')} copiado!'),
            backgroundColor: AppColors.success,
            duration: const Duration(seconds: 2),
          ),
        );
        break;

      case 'abrir_url':
        final uri = Uri.tryParse(botao.valor);
        if (uri == null) return;
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        break;

      case 'abrir_tela':
        final tela = telaPorChave(botao.valor);
        if (tela == null) {
          // Chave que este build do app não conhece (backend mais novo).
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Abra essa tela pelo menu do aplicativo.'),
            ),
          );
          return;
        }
        if (!mounted) return;
        Navigator.push(context, MaterialPageRoute(builder: (_) => tela));
        break;
    }
  }

  IconData _iconeBotao(String efeito) {
    switch (efeito) {
      case 'copiar':
        return PhosphorIcons.copy;
      case 'abrir_url':
        return PhosphorIcons.arrowSquareOut;
      default:
        return PhosphorIcons.arrowRight;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      // Mesmo padrão do AppScaffold do app: caretLeft na cor de texto
      // primária, com o título ao lado.
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: Navigator.canPop(context)
            ? IconButton(
                icon: Icon(PhosphorIcons.caretLeft,
                    color: AppColors.textPrimary(context)),
                onPressed: () => Navigator.pop(context),
              )
            : null,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(PhosphorIcons.sparkle, color: AppColors.primary, size: 22),
            const SizedBox(width: AppSpacing.sm),
            Text('Click IA', style: AppTypography.headline(context)),
          ],
        ),
      ),
      // Stack (e não Column): o campo precisa FLUTUAR sobre a conversa para o
      // desfoque ter o que desfocar. Empilhado abaixo da lista, o vidro ficaria
      // por cima do fundo chapado do Scaffold e não apareceria.
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: _mensagens.isEmpty
                  ? _buildEmptyState(context)
                  : ListView.builder(
                      controller: _scrollController,
                      // Folga no rodapé: sem ela a última mensagem fica
                      // permanentemente escondida atrás do campo flutuante.
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        AppSpacing.lg,
                        AppSpacing.lg,
                        104,
                      ),
                      itemCount: _mensagens.length + (_isSending ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (_isSending && index == _mensagens.length) {
                          return _buildTypingBubble(context);
                        }
                        return _buildBubble(context, _mensagens[index]);
                      },
                    ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _buildInput(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      children: [
        const SizedBox(height: AppSpacing.xxxl),
        Center(
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(PhosphorIcons.sparkle,
                color: AppColors.primary, size: 40),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Olá! Sou o Click IA.',
          textAlign: TextAlign.center,
          style: AppTypography.headline(context),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Pergunte sobre o condomínio ou peça para eu resolver: reservar '
          'área, abrir ocorrência, pagar boleto.',
          textAlign: TextAlign.center,
          style: AppTypography.caption(context),
        ),
        const SizedBox(height: AppSpacing.xxl),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          alignment: WrapAlignment.center,
          children: _sugestoes
              .map((s) => ActionChip(
                    label: Text(s, style: AppTypography.caption(context)),
                    backgroundColor: AppColors.surface(context),
                    side: BorderSide(color: AppColors.border(context)),
                    onPressed: () => _enviar(s),
                  ))
              .toList(),
        ),
      ],
    );
  }

  Widget _buildBubble(BuildContext context, _ChatMessage msg) {
    final isMe = msg.isUser;
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        constraints: BoxConstraints(
          // Bolha com card de confirmação precisa de mais largura: são linhas
          // rótulo/valor mais dois botões lado a lado.
          maxWidth: MediaQuery.of(context).size.width * (msg.acao != null ? 0.92 : 0.78),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isMe) ...[
              Icon(PhosphorIcons.sparkle,
                  color: AppColors.primary, size: 18),
              const SizedBox(width: AppSpacing.sm),
            ],
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: isMe ? AppColors.primary : AppColors.surface(context),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(16),
                    topRight: const Radius.circular(16),
                    bottomLeft: Radius.circular(isMe ? 16 : 4),
                    bottomRight: Radius.circular(isMe ? 4 : 16),
                  ),
                  border: isMe
                      ? null
                      : Border.all(color: AppColors.border(context)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // A resposta vem em markdown; sem o renderizador os
                    // asteriscos de **negrito** apareciam crus na tela.
                    // A do usuário é texto puro e não precisa passar por isso.
                    isMe
                        ? Text(
                            msg.texto,
                            style: AppTypography.body(context)
                                .copyWith(color: Colors.white),
                          )
                        : RespostaFormatada(
                            texto: msg.texto,
                            estilo: AppTypography.body(context).copyWith(
                              color: AppColors.textPrimary(context),
                            ),
                          ),
                    if (msg.acao != null) ...[
                      const SizedBox(height: AppSpacing.md),
                      _buildCardAcao(context, msg),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Card de confirmação: mostra os dados que o assistente resolveu e só
  /// executa depois do toque. Enquanto ninguém confirma, nada foi gravado.
  Widget _buildCardAcao(BuildContext context, _ChatMessage msg) {
    final acao = msg.acao!;
    final resolvido = msg.resultado != null;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.bg(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: resolvido
              ? (msg.resolvidaComSucesso
                  ? AppColors.success
                  : AppColors.border(context))
              : AppColors.primary.withOpacity(acao.confirmavel ? 0.4 : 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                resolvido
                    ? (msg.resolvidaComSucesso
                        ? PhosphorIcons.checkCircle
                        : PhosphorIcons.xCircle)
                    // Confirmável pede decisão; informativo é só atalho.
                    : (acao.confirmavel
                        ? PhosphorIcons.warningCircle
                        : (acao.tipo == 'pagamento'
                            ? PhosphorIcons.creditCard
                            : PhosphorIcons.arrowRight)),
                size: 18,
                color: resolvido
                    ? (msg.resolvidaComSucesso
                        ? AppColors.success
                        : AppColors.textTertiary(context))
                    : AppColors.primary,
              ),
              const SizedBox(width: AppSpacing.sm),
              Flexible(
                child: Text(
                  acao.titulo,
                  style: AppTypography.captionMedium(context)
                      .copyWith(color: AppColors.textPrimary(context)),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          ...acao.itens.map(
            (i) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 92,
                    child: Text('${i.rotulo}:',
                        style: AppTypography.caption(context)),
                  ),
                  Expanded(
                    child: Text(
                      i.valor,
                      style: AppTypography.captionMedium(context)
                          .copyWith(color: AppColors.textPrimary(context)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (resolvido)
            Text(
              msg.resultado!,
              style: AppTypography.caption(context).copyWith(
                color: msg.resolvidaComSucesso
                    ? AppColors.success
                    : AppColors.textTertiary(context),
              ),
            )
          else if (acao.confirmavel)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed:
                        msg.confirmando ? null : () => _cancelarAcao(msg),
                    child: Text('Cancelar',
                        style: AppTypography.caption(context)),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton(
                    onPressed:
                        msg.confirmando ? null : () => _confirmarAcao(msg),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                    ),
                    child: msg.confirmando
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Confirmar'),
                  ),
                ),
              ],
            )
          else
            // Card informativo: atalhos que agem só no app (copiar, abrir
            // link, abrir tela). Empilhados porque os rótulos são longos.
            ...acao.botoes.map(
              (b) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _acionarBotao(b),
                    icon: Icon(_iconeBotao(b.efeito), size: 16),
                    label: Text(b.rotulo, style: AppTypography.caption(context)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      alignment: Alignment.centerLeft,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTypingBubble(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.md),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text('Pensando...', style: AppTypography.caption(context)),
          ],
        ),
      ),
    );
  }

  /// Campo flutuante em "liquid glass" — mesmo tratamento da ilha de navegação
  /// do app: sombra por fora, cor e borda DENTRO do recorte, para que o
  /// desfoque não vaze pelos cantos arredondados.
  Widget _buildInput(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    const raio = 30.0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(raio),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(isDark ? 0.30 : 0.06),
              blurRadius: 22,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(raio),
          clipBehavior: Clip.antiAlias,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
            child: Container(
              decoration: BoxDecoration(
                color: isDark
                    ? Colors.black.withOpacity(0.20)
                    : Colors.white.withOpacity(0.35),
                border: Border.all(
                  color: isDark
                      ? Colors.white.withOpacity(0.12)
                      : Colors.white.withOpacity(0.45),
                  width: 1,
                ),
              ),
              padding: const EdgeInsets.fromLTRB(AppSpacing.md, 6, 6, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _msgController,
                      textCapitalization: TextCapitalization.sentences,
                      minLines: 1,
                      maxLines: 4,
                      style: AppTypography.body(context),
                      onSubmitted: (_) => _enviar(),
                      decoration: InputDecoration(
                        hintText: 'Pergunte algo ao Click IA...',
                        hintStyle: AppTypography.body(context)
                            .copyWith(color: AppColors.textTertiary(context)),
                        // Sem preenchimento nem borda: o fundo é o próprio
                        // vidro; um fill aqui criaria uma caixa dentro da caixa.
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        isDense: true,
                        contentPadding:
                            const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  GestureDetector(
                    onTap: _isSending ? null : () => _enviar(),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _isSending
                            ? AppColors.primary.withOpacity(0.5)
                            : AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(PhosphorIcons.paperPlaneRight,
                          color: Colors.white, size: 20),
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
