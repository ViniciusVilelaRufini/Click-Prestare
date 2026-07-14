import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Assistente IA do condomínio (RAG). Faz perguntas em linguagem natural sobre
/// atas, informações gerais, funcionários, visitantes e moradores. A resposta é
/// gerada no backend (Gemini) já com o escopo de dados do papel do usuário.
class ChatIaPage extends StatefulWidget {
  /// [hideAppBar] = true quando a página é usada como ABA (dentro da ilha de
  /// navegação da home) — remove a AppBar/botão de voltar e usa um cabeçalho
  /// enxuto no topo do corpo.
  const ChatIaPage({Key? key, this.hideAppBar = false}) : super(key: key);

  final bool hideAppBar;

  @override
  State<ChatIaPage> createState() => _ChatIaPageState();
}

class _ChatMessage {
  final String texto;
  final bool isUser;
  _ChatMessage(this.texto, this.isUser);
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
      _mensagens.add(_ChatMessage(resposta, false));
      _isSending = false;
    });
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      appBar: widget.hideAppBar
          ? null
          : AppBar(
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
                  Text('Assistente IA', style: AppTypography.headline(context)),
                ],
              ),
            ),
      body: SafeArea(
        child: Column(
          children: [
            if (widget.hideAppBar) _buildEmbeddedHeader(context),
            Expanded(
              child: _mensagens.isEmpty
                  ? _buildEmptyState(context)
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      itemCount: _mensagens.length + (_isSending ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (_isSending && index == _mensagens.length) {
                          return _buildTypingBubble(context);
                        }
                        return _buildBubble(context, _mensagens[index]);
                      },
                    ),
            ),
            _buildInput(context),
          ],
        ),
      ),
    );
  }

  /// Cabeçalho compacto exibido quando a página é uma aba (sem AppBar).
  Widget _buildEmbeddedHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
      child: Row(
        children: [
          Icon(PhosphorIcons.sparkle, color: AppColors.primary, size: 22),
          const SizedBox(width: AppSpacing.sm),
          Text('Assistente IA', style: AppTypography.headline(context)),
        ],
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
          'Olá! Sou o assistente do seu condomínio.',
          textAlign: TextAlign.center,
          style: AppTypography.headline(context),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'Pergunte sobre atas, visitantes, funcionários e mais.',
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
          maxWidth: MediaQuery.of(context).size.width * 0.78,
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
                child: Text(
                  msg.texto,
                  style: AppTypography.body(context).copyWith(
                    color: isMe ? Colors.white : AppColors.textPrimary(context),
                  ),
                ),
              ),
            ),
          ],
        ),
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

  Widget _buildInput(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.sm,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border(top: BorderSide(color: AppColors.border(context), width: 0.5)),
      ),
      child: Row(
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
                hintText: 'Pergunte algo ao assistente...',
                hintStyle: AppTypography.body(context)
                    .copyWith(color: AppColors.textTertiary(context)),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
                fillColor: isDark ? AppColors.bg(context) : Colors.grey.shade100,
                filled: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
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
    );
  }
}
