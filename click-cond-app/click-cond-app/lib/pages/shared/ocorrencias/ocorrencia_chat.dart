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
    Key? key,
    required this.idOcorrencia,
    required this.titulo,
  }) : super(key: key);

  @override
  State<OcorrenciaChatPage> createState() => _OcorrenciaChatPageState();
}

class _OcorrenciaChatPageState extends State<OcorrenciaChatPage> {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  
  List<dynamic> _mensagens = [];
  bool _isLoading = true;
  bool _isSending = false;
  Timer? _timer;
  late final String _myId;

  @override
  void initState() {
    super.initState();
    _myId = getUserId();
    _loadMessages();
    
    // Auto-refresh chat every 1.5 seconds
    _timer = Timer.periodic(const Duration(milliseconds: 1500), (_) => _loadMessages(showLoading: false));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages({bool showLoading = true}) async {
    try {
      if (showLoading && mounted) {
        setState(() => _isLoading = true);
      }
      final list = await apiGetOcorrenciaMessages(widget.idOcorrencia);
      if (mounted) {
        final hasNewMessage = list.length != _mensagens.length;
        setState(() {
          _mensagens = list;
          _isLoading = false;
        });
        if (hasNewMessage) {
          _scrollToBottom();
        }
      }
    } catch (e) {
      print('[OcorrenciaChat] Erro ao carregar mensagens: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
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
    if (text.isEmpty) return;

    setState(() {
      _isSending = true;
    });

    try {
      final res = await apiSendOcorrenciaMessage(widget.idOcorrencia, text);
      if (res != null) {
        _msgController.clear();
        await _loadMessages(showLoading: false);
      }
    } catch (e) {
      print('[OcorrenciaChat] Erro ao enviar mensagem: $e');
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
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return AppScaffold(
      title: 'Chat: ${widget.titulo}',
      body: Column(
        children: [
          // Mensagem Header descritiva
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
            color: isDark ? AppColors.darkSurface.withOpacity(0.5) : Colors.grey.shade100,
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
                              'Nenhuma mensagem ainda',
                              style: AppTypography.bodyMedium(context).copyWith(
                                color: AppColors.textSecondary(context),
                              ),
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
                                            : (isDark ? AppColors.surface(context) : Colors.grey.shade200),
                                        borderRadius: BorderRadius.only(
                                          topLeft: const Radius.circular(16),
                                          topRight: const Radius.circular(16),
                                          bottomLeft: Radius.circular(isMe ? 16 : 0),
                                          bottomRight: Radius.circular(isMe ? 0 : 16),
                                        ),
                                      ),
                                      child: Text(
                                        msg['mensagem'] ?? '',
                                        style: AppTypography.body(context).copyWith(
                                          color: isMe
                                              ? Colors.white
                                              : (isDark ? Colors.white : Colors.black87),
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
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                      fillColor: isDark ? AppColors.darkSurface : Colors.grey.shade100,
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
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                    child: _isSending
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(
                            PhosphorIcons.paperPlaneRight,
                            color: Colors.white,
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
