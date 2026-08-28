import 'dart:ui' show ImageFilter;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:speech_to_text/speech_to_text.dart';

import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'resposta_formatada.dart';
import 'telas_app.dart';

/// PRESTARE IA — assistente do condomínio.
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
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final FocusNode _campoFoco = FocusNode();

  final List<_ChatMessage> _mensagens = [];
  bool _isSending = false;

  /// Conversa aberta. `null` = conversa nova, ainda sem nada gravado: o id
  /// chega na primeira resposta do backend.
  String? _conversaId;

  List<ConversaIa> _conversas = [];
  bool _carregandoConversas = false;
  String? _erroConversas;

  final SpeechToText _speech = SpeechToText();
  bool _speechPronto = false;
  bool _ouvindo = false;

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
    _campoFoco.dispose();
    _speech.stop();
    super.dispose();
  }

  // ==========================================================================
  // Conversas
  // ==========================================================================

  Future<void> _carregarConversas() async {
    setState(() {
      _carregandoConversas = true;
      _erroConversas = null;
    });
    try {
      final lista = await apiListarConversasIa();
      if (!mounted) return;
      setState(() {
        _conversas = lista;
        _carregandoConversas = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _erroConversas = e.toString();
        _carregandoConversas = false;
      });
    }
  }

  void _novaConversa() {
    setState(() {
      _mensagens.clear();
      _conversaId = null;
      _isSending = false;
    });
  }

  Future<void> _abrirConversa(ConversaIa conversa) async {
    setState(() {
      _mensagens.clear();
      _conversaId = conversa.id;
      _isSending = true;
    });
    try {
      final msgs = await apiAbrirConversaIa(conversa.id);
      if (!mounted) return;
      setState(() {
        _mensagens.addAll(msgs.map((m) => _ChatMessage(m.texto, m.isUser)));
        _isSending = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSending = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _apagarConversa(ConversaIa conversa) async {
    final confirmou = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Apagar conversa'),
        content: Text('"${conversa.titulo}" será apagada. Não dá para desfazer.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Apagar', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (confirmou != true) return;

    // Otimista na lista; se o servidor recusar, a conversa volta.
    final antes = List<ConversaIa>.from(_conversas);
    setState(() => _conversas.removeWhere((c) => c.id == conversa.id));
    try {
      await apiApagarConversaIa(conversa.id);
      if (_conversaId == conversa.id && mounted) _novaConversa();
    } catch (e) {
      if (!mounted) return;
      setState(() => _conversas = antes);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: AppColors.error),
      );
    }
  }

  // ==========================================================================
  // Voz
  // ==========================================================================

  /// Liga/desliga o ditado. O texto reconhecido cai no campo e o envio segue
  /// manual: numa IA que executa ações, transcrição errada não pode virar
  /// pedido enviado sozinho.
  Future<void> _alternarVoz() async {
    if (_ouvindo) {
      await _speech.stop();
      if (mounted) setState(() => _ouvindo = false);
      return;
    }

    if (!_speechPronto) {
      _speechPronto = await _speech.initialize(
        onStatus: (s) {
          // 'done'/'notListening' chegam também por silêncio ou timeout.
          if (!mounted) return;
          if (s == 'done' || s == 'notListening') setState(() => _ouvindo = false);
        },
        onError: (_) {
          if (mounted) setState(() => _ouvindo = false);
        },
      );
    }
    if (!_speechPronto) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'Não consegui usar o microfone. Verifique a permissão nas configurações.'),
        ),
      );
      return;
    }

    setState(() => _ouvindo = true);
    await _speech.listen(
      localeId: 'pt_BR',
      listenOptions: SpeechListenOptions(partialResults: true),
      onResult: (r) {
        _msgController.text = r.recognizedWords;
        _msgController.selection = TextSelection.fromPosition(
          TextPosition(offset: _msgController.text.length),
        );
      },
    );
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

    // Fecha o teclado ao enviar. No iOS não há botão de voltar do sistema:
    // sem isto ele fica aberto sobre a resposta, sem gesto para dispensar.
    _campoFoco.unfocus();
    if (_ouvindo) {
      _speech.stop();
      _ouvindo = false;
    }

    setState(() {
      _mensagens.add(_ChatMessage(texto, true));
      _isSending = true;
      _msgController.clear();
    });
    _scrollToBottom();

    final resposta = await apiPerguntarChatIa(texto, conversaId: _conversaId);

    if (!mounted) return;
    setState(() {
      _mensagens.add(_ChatMessage(resposta.texto, false, acao: resposta.acao));
      _isSending = false;
      // Conversa nova: o backend gerou o id e as próximas perguntas seguem nela.
      _conversaId ??= resposta.conversaId;
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
      key: _scaffoldKey,
      backgroundColor: AppColors.bg(context),
      // A lista só é buscada ao abrir a gaveta: não faz sentido pagar uma
      // requisição por mensagem enviada.
      onDrawerChanged: (aberta) {
        if (aberta) _carregarConversas();
      },
      drawer: _buildDrawerConversas(context),
      // Sem AppBar: o topo é uma caixa de vidro dentro do Stack, igual ao
      // campo de digitar e à ilha de navegação da home. Uma AppBar comum é
      // opaca e a conversa pararia numa borda dura em vez de sumir atrás dela.
      // Stack (e não Column): as duas caixas precisam FLUTUAR sobre a conversa
      // para o desfoque ter o que desfocar. Empilhadas fora dela, o vidro
      // ficaria sobre o fundo chapado do Scaffold e não apareceria.
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: _mensagens.isEmpty
                  ? _buildEmptyState(context)
                  : ListView.builder(
                      controller: _scrollController,
                      // Arrastar a conversa fecha o teclado — no iPhone era o
                      // único gesto que faltava para dispensá-lo.
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      // Folga em cima e embaixo. A de baixo é MENOR que a
                      // altura do campo (~80): no fim da conversa a última
                      // bolha encosta por baixo do vidro, que assim sempre tem
                      // o que desfocar. Com folga maior, o campo ficava sobre
                      // espaço vazio e virava uma faixa branca chapada.
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        84,
                        AppSpacing.lg,
                        72,
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
              top: 0,
              child: _buildTopBar(context),
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

  /// Caixa azul do topo — mesmo gradiente e sombra do card da home, com os
  /// controles em branco por cima. Flutua sobre a conversa (a lista tem folga
  /// no topo), então o conteúdo desliza por baixo em vez de parar numa borda.
  Widget _buildTopBar(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.sm,
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.primaryGradientStart,
              AppColors.primaryGradientEnd
            ],
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withOpacity(0.35),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          children: [
            if (Navigator.canPop(context))
              _acaoTopo(
                icon: PhosphorIcons.caretLeft,
                tooltip: 'Voltar',
                onTap: () => Navigator.pop(context),
              ),
            const SizedBox(width: AppSpacing.xs),
            _acaoTopo(
              icon: PhosphorIcons.chatCircleDots,
              tooltip: 'Conversas',
              onTap: () => _scaffoldKey.currentState?.openDrawer(),
            ),
            Expanded(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  'PRESTARE IA',
                  style: AppTypography.bodyMedium(context).copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
            _acaoTopo(
              icon: PhosphorIcons.notePencil,
              tooltip: 'Nova conversa',
              onTap: _novaConversa,
            ),
          ],
        ),
      ),
    );
  }

  /// Botão redondo translúcido — o mesmo tratamento das ações do card azul da
  /// home (`_buildHeaderActions` em list_condominiums.dart).
  Widget _acaoTopo({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.full),
        onTap: onTap,
        child: Tooltip(
          message: tooltip,
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: Colors.white, size: 18),
          ),
        ),
      ),
    );
  }

  /// Lateral de conversas passadas.
  Widget _buildDrawerConversas(BuildContext context) {
    return Drawer(
      backgroundColor: AppColors.bg(context),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
              child: Row(
                children: [
                  Icon(PhosphorIcons.chatCircleDots,
                      color: AppColors.primary, size: 20),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text('Conversas',
                        style: AppTypography.headline(context)),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  _novaConversa();
                },
                icon: const Icon(PhosphorIcons.notePencil, size: 18),
                label: const Text('Nova conversa'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  minimumSize: const Size.fromHeight(44),
                  side: BorderSide(color: AppColors.primary.withOpacity(0.4)),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(child: _buildListaConversas(context)),
          ],
        ),
      ),
    );
  }

  Widget _buildListaConversas(BuildContext context) {
    if (_carregandoConversas) {
      return Center(
        child: SizedBox(
          height: 22,
          width: 22,
          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
        ),
      );
    }
    if (_erroConversas != null) {
      return Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(PhosphorIcons.cloudSlash,
                color: AppColors.textTertiary(context), size: 36),
            const SizedBox(height: AppSpacing.sm),
            Text(_erroConversas!,
                textAlign: TextAlign.center,
                style: AppTypography.caption(context)),
            const SizedBox(height: AppSpacing.md),
            TextButton(
              onPressed: _carregarConversas,
              child: const Text('Tentar de novo'),
            ),
          ],
        ),
      );
    }
    if (_conversas.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Center(
          child: Text(
            'Nenhuma conversa ainda. O que você perguntar fica salvo aqui.',
            textAlign: TextAlign.center,
            style: AppTypography.caption(context),
          ),
        ),
      );
    }
    // Mesma linguagem dos cards do app (_MenuRow da home): superfície
    // arredondada, ícone em quadrado com fundo da cor primária, título e
    // apoio embaixo.
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
      itemCount: _conversas.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (_, i) {
        final c = _conversas[i];
        final aberta = c.id == _conversaId;
        return Material(
          color: aberta
              ? AppColors.primary.withOpacity(0.10)
              : AppColors.surface(context),
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            onTap: () {
              Navigator.pop(context);
              if (!aberta) _abrirConversa(c);
            },
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md, vertical: AppSpacing.md),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: aberta
                      ? AppColors.primary.withOpacity(0.35)
                      : Colors.transparent,
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(PhosphorIcons.chatCircleText,
                        color: AppColors.primary, size: 20),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          c.titulo,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.bodyMedium(context),
                        ),
                        const SizedBox(height: 2),
                        // Texto único: em Row, data + contagem estouravam a
                        // largura da gaveta em títulos de duas linhas.
                        Text(
                          [
                            _dataRelativa(c.ultimaEm),
                            if (c.total > 0) '${c.total} mensagens',
                          ].where((s) => s.isNotEmpty).join(' • '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.tiny(context)
                              .copyWith(color: AppColors.textTertiary(context)),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Apagar',
                    icon: Icon(PhosphorIcons.trash,
                        size: 18, color: AppColors.textTertiary(context)),
                    onPressed: () => _apagarConversa(c),
                    splashRadius: 20,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  String _dataRelativa(DateTime? d) {
    if (d == null) return '';
    final local = d.toLocal();
    final agora = DateTime.now();
    final dias = DateTime(agora.year, agora.month, agora.day)
        .difference(DateTime(local.year, local.month, local.day))
        .inDays;
    final pad = (int n) => n.toString().padLeft(2, '0');
    if (dias == 0) return 'Hoje às ${pad(local.hour)}:${pad(local.minute)}';
    if (dias == 1) return 'Ontem às ${pad(local.hour)}:${pad(local.minute)}';
    if (dias < 7) return 'Há $dias dias';
    return '${pad(local.day)}/${pad(local.month)}/${local.year}';
  }

  Widget _buildEmptyState(BuildContext context) {
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl, 84, AppSpacing.xl, AppSpacing.xl),
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
          'Olá! Sou o PRESTARE IA.',
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
                    icon: Icon(_iconeBotao(b.efeito), size: 16, color: Colors.white),
                    label: Text(b.rotulo,
                        style: AppTypography.caption(context)
                            .copyWith(color: Colors.white)),
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
            // Desfoque menor e véu mais fino: com 20/0.35 sobre o fundo claro
            // o vidro virava branco chapado e a mensagem que passa por baixo
            // desaparecia em vez de aparecer borrada.
            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
            child: Container(
              decoration: BoxDecoration(
                color: isDark
                    ? Colors.black.withOpacity(0.25)
                    : Colors.white.withOpacity(0.22),
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
                      focusNode: _campoFoco,
                      textCapitalization: TextCapitalization.sentences,
                      textInputAction: TextInputAction.send,
                      minLines: 1,
                      maxLines: 4,
                      style: AppTypography.body(context),
                      onSubmitted: (_) => _enviar(),
                      decoration: InputDecoration(
                        hintText: 'Pergunte algo',
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
                  const SizedBox(width: 4),
                  // Ditado: enche o campo, não envia. Quem revisa é o usuário.
                  GestureDetector(
                    onTap: _isSending ? null : _alternarVoz,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: _ouvindo
                            ? AppColors.error.withOpacity(0.15)
                            : Colors.transparent,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        _ouvindo ? PhosphorIcons.microphoneFill : PhosphorIcons.microphone,
                        // Mesma cor do botão de enviar; só o estado de escuta
                        // foge dela, para ficar claro que o microfone está ligado.
                        color: _ouvindo ? AppColors.error : AppColors.primary,
                        size: 22,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
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
