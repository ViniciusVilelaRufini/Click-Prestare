import 'package:click/utils/log.dart';
import 'dart:async';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:intl/intl.dart';

class OcorrenciaChatPage extends StatefulWidget {
  final int idOcorrencia;
  final String titulo;

  const OcorrenciaChatPage({
    super.key,
    required this.idOcorrencia,
    required this.titulo,
  });

  @override
  State<OcorrenciaChatPage> createState() => _OcorrenciaChatPageState();
}

class _OcorrenciaChatPageState extends State<OcorrenciaChatPage>
    with WidgetsBindingObserver {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  
  List<dynamic> _mensagens = [];
  bool _isLoading = true;
  bool _isSending = false;
  Timer? _timer;
  late final String _myId;

  /// 1,5s dava ~2.400 requisicoes por hora com o chat aberto — e o timer nao
  /// parava com o app em segundo plano. 5s e imperceptivel num chat de
  /// ocorrencia e corta o volume em 70%.
  static const _intervaloBase = Duration(seconds: 5);

  /// Backoff em falha de rede: sem ele, uma queda de conexao vira uma rajada
  /// de requisicoes falhando a cada 5s ate o usuario sair da tela.
  Duration _intervaloAtual = _intervaloBase;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _myId = getUserId();
    _loadMessages();
    _iniciarPoll();
  }

  /// Número da última busca de mensagens. Resposta de uma busca mais antiga
  /// (o poll que saiu antes do envio e chegou depois) é descartada: ela
  /// trazia a lista sem a mensagem recém-enviada e a apagava da tela.
  int _buscaAtual = 0;

  /// Buscas ainda sem resposta. O tique do poll não sai com outra em voo:
  /// numa rede lenta cada resposta seria descartada pela busca seguinte.
  int _emVoo = 0;

  /// A primeira carga falhou e não há nada na tela: mostra o erro em vez de
  /// "Nenhuma mensagem ainda".
  bool _falhouCarga = false;

  void _iniciarPoll() {
    _timer?.cancel();
    _timer = null;
    // Uma resposta que chega depois do dispose (ou com o app em segundo
    // plano) não pode religar o timer: ele ficava chamando /messages sem
    // ninguém para cancelar. A volta ao app religa pelo lifecycle.
    if (!mounted) return;
    final estado = WidgetsBinding.instance.lifecycleState;
    if (estado != null && estado != AppLifecycleState.resumed) return;
    _timer = Timer.periodic(_intervaloAtual, (_) {
      if (_emVoo == 0) _loadMessages(showLoading: false);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _intervaloAtual = _intervaloBase;
      _loadMessages(showLoading: false);
      _iniciarPoll();
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages({bool showLoading = true}) async {
    final minha = ++_buscaAtual;
    if (showLoading && mounted) {
      setState(() => _isLoading = true);
    }
    final List<dynamic>? list;
    _emVoo++;
    try {
      list = await apiGetOcorrenciaMessagesOuNull(widget.idOcorrencia);
    } finally {
      _emVoo--;
    }
    if (!mounted || minha != _buscaAtual) return;
    if (list == null) {
      logDebug('[OcorrenciaChat] Falha ao carregar mensagens');
      // Dobra o intervalo até 1 min enquanto a rede não volta; as mensagens
      // que já estão na tela ficam.
      final proximo = _intervaloAtual * 2;
      _intervaloAtual = proximo > const Duration(minutes: 1) ? const Duration(minutes: 1) : proximo;
      _iniciarPoll();
      setState(() {
        _isLoading = false;
        _falhouCarga = _mensagens.isEmpty;
      });
      return;
    }
    if (_intervaloAtual != _intervaloBase) {
      _intervaloAtual = _intervaloBase;
      _iniciarPoll();
    }
    final List<dynamic> novas = list;
    final hasNewMessage = novas.length != _mensagens.length;
    setState(() {
      _mensagens = novas;
      _isLoading = false;
      _falhouCarga = false;
    });
    if (hasNewMessage) {
      _scrollToBottom();
    }
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

  Future<void> _sendMessage() async {
    final text = _msgController.text.trim();
    if (text.isEmpty || _isSending) return;

    setState(() {
      _isSending = true;
    });

    try {
      final res = await apiSendOcorrenciaMessage(widget.idOcorrencia, text);
      if (!mounted) return;
      if (res.ok) {
        _msgController.clear();
        await _loadMessages(showLoading: false);
      } else {
        // O texto fica no campo para tentar de novo; a recusa da API (sem
        // permissão, sessão revogada) ou a falta de rede aparece aqui.
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res.mensagemOu('Não foi possível enviar a mensagem. Tente novamente.')),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  String _formatTime(String? createdAtStr) {
    if (createdAtStr == null || createdAtStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(createdAtStr).toLocal();
      return DateFormat('dd/MM HH:mm').format(dt);
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {

    return AppScaffold(
      title: 'Chat: ${widget.titulo}',
      body: Column(
        children: [
          // Mensagem Header descritiva
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
            color: AppColors.surface(context),
            child: Row(
              children: [
                Icon(PhosphorIcons.info, size: 18, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Canal de comunicação direta com a administração.',
                    style: AppTypography.captionMedium(context).copyWith(
                      color: AppColors.textSecondary(context),
                    ),
                  ),
                ),
              ],
            ),
          ),
          
          // Lista de mensagens
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _mensagens.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(PhosphorIcons.chatCircle, size: 48, color: AppColors.textTertiary(context)),
                            const SizedBox(height: 8),
                            Text(
                              _falhouCarga
                                  ? 'Não foi possível carregar as mensagens.'
                                  : 'Nenhuma mensagem ainda',
                              style: AppTypography.bodyMedium(context).copyWith(
                                color: AppColors.textSecondary(context),
                              ),
                            ),
                            if (_falhouCarga)
                              TextButton(
                                onPressed: () => _loadMessages(),
                                child: Text('Tentar de novo'.toUpperCase()),
                              ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => _loadMessages(showLoading: false),
                        child: ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          itemCount: _mensagens.length,
                          itemBuilder: (context, index) {
                            final msg = _mensagens[index];
                            final isMe = msg['id_usuario'].toString() == _myId;
                            final senderName = msg['usuario'] != null ? msg['usuario']['name'] ?? '' : '';
                            
                            return Align(
                              alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 12),
                                constraints: BoxConstraints(
                                  maxWidth: MediaQuery.of(context).size.width * 0.75,
                                ),
                                child: Column(
                                  crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                                  children: [
                                    if (!isMe)
                                      Padding(
                                        padding: const EdgeInsets.only(left: 4, bottom: 2),
                                        child: Text(
                                          senderName,
                                          style: AppTypography.captionMedium(context).copyWith(
                                            color: AppColors.textSecondary(context),
                                            fontSize: 10,
                                          ),
                                        ),
                                      ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                      decoration: BoxDecoration(
                                        color: isMe
                                            ? AppColors.primary
                                            : AppColors.surface(context),
                                        borderRadius: BorderRadius.zero,
                                      ),
                                      child: Text(
                                        msg['mensagem'] ?? '',
                                        style: AppTypography.body(context).copyWith(
                                          color: isMe
                                              ? AppColors.onPrimary
                                              : (AppColors.textPrimary(context)),
                                        ),
                                      ),
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
                                      child: Text(
                                        _formatTime(msg['created_at']),
                                        style: AppTypography.captionMedium(context).copyWith(
                                          color: AppColors.textTertiary(context),
                                          fontSize: 9,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
          
          // Campo de input
          Container(
            padding: EdgeInsets.only(
              left: AppSpacing.md,
              right: AppSpacing.md,
              top: AppSpacing.sm,
              bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.surface(context),
              border: Border(
                top: BorderSide(
                  color: AppColors.border(context),
                  width: 0.5,
                ),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _msgController,
                    textCapitalization: TextCapitalization.sentences,
                    style: AppTypography.body(context),
                    decoration: InputDecoration(
                      hintText: 'Digite uma mensagem...',
                      hintStyle: AppTypography.body(context).copyWith(
                        color: AppColors.textTertiary(context),
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.zero,
                        borderSide: BorderSide.none,
                      ),
                      fillColor: AppColors.surface(context),
                      filled: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: _isSending ? null : _sendMessage,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                    child: _isSending
                        ? SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.onPrimary,
                            ),
                          )
                        : Icon(
                            PhosphorIcons.paperPlaneRight,
                            color: AppColors.onPrimary,
                            size: 20,
                          ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
