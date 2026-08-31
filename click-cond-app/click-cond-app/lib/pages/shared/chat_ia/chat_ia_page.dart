import 'dart:convert';
import 'dart:io' as io;
import 'dart:ui' show ImageFilter;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
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

  /// Dados do anexo (foto ou PDF) caso o usuário tenha enviado.
  final Map<String, dynamic>? anexo;

  /// Estado do card: null = aguardando, texto = resultado já resolvido.
  String? resultado;
  bool resolvidaComSucesso = false;
  bool confirmando = false;

  _ChatMessage(this.texto, this.isUser, {this.acao, this.anexo});
}

class _ChatIaPageState extends State<ChatIaPage> {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final FocusNode _campoFoco = FocusNode();

  final List<_ChatMessage> _mensagens = [];
  bool _isSending = false;

  /// Anexo selecionado aguardando envio ({nome, mime_type, base64, path, is_image, tamanho_kb})
  Map<String, dynamic>? _anexoPendente;

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
  void initState() {
    super.initState();
    _campoFoco.addListener(() {
      if (mounted) setState(() {});
    });
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

  // ==========================================================================
  // Anexos (Câmera / Galeria / Arquivo)
  // ==========================================================================

  Future<void> _processarArquivo(String caminho, String nome, String mimeType) async {
    try {
      final file = io.File(caminho);
      if (!await file.exists()) return;
      final bytes = await file.readAsBytes();
      if (bytes.lengthInBytes > 10 * 1024 * 1024) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('O arquivo é muito grande (máximo 10MB).'),
            backgroundColor: AppColors.error,
          ),
        );
        return;
      }
      final base64String = base64Encode(bytes);
      final isImage = mimeType.startsWith('image/');
      final tamanhoKb = (bytes.lengthInBytes / 1024).round();

      setState(() {
        _anexoPendente = {
          'nome': nome,
          'mime_type': mimeType,
          'base64': base64String,
          'path': caminho,
          'is_image': isImage,
          'tamanho_kb': tamanhoKb,
        };
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao carregar anexo: $e'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _capturarFotoCamera() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 85,
      );
      if (picked != null) {
        await _processarArquivo(picked.path, picked.name, 'image/jpeg');
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro na câmera: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _selecionarFotoGaleria() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 85,
      );
      if (picked != null) {
        final ext = picked.name.split('.').last.toLowerCase();
        final mime = ext == 'png' ? 'image/png' : (ext == 'webp' ? 'image/webp' : 'image/jpeg');
        await _processarArquivo(picked.path, picked.name, mime);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro na galeria: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _selecionarDocumento() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg'],
      );
      if (result != null && result.files.isNotEmpty && result.files.single.path != null) {
        final f = result.files.single;
        final ext = (f.extension ?? '').toLowerCase();
        final mime = ext == 'pdf' ? 'application/pdf' : (ext == 'png' ? 'image/png' : 'image/jpeg');
        await _processarArquivo(f.path!, f.name, mime);
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao selecionar arquivo: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _abrirMenuAnexo() async {
    _campoFoco.unfocus();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: AppColors.border(context),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Text(
                  'Anexar Conta / Fatura',
                  style: AppTypography.headline(context).copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    'Tire uma foto ou selecione o PDF da sua conta de luz, água, internet ou boleto para a IA identificar.',
                    textAlign: TextAlign.center,
                    style: AppTypography.caption(context),
                  ),
                ),
                const SizedBox(height: 16),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(PhosphorIcons.camera, color: AppColors.primary),
                  ),
                  title: Text('Tirar foto com a câmera', style: AppTypography.body(context)),
                  subtitle: Text('Capture a conta de luz, água ou boleto', style: AppTypography.tiny(context)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _capturarFotoCamera();
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.teal.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(PhosphorIcons.image, color: Colors.teal),
                  ),
                  title: Text('Escolher da galeria', style: AppTypography.body(context)),
                  subtitle: Text('Selecione uma foto da sua galeria', style: AppTypography.tiny(context)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _selecionarFotoGaleria();
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.deepOrange.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(PhosphorIcons.filePdf, color: Colors.deepOrange),
                  ),
                  title: Text('Selecionar documento / PDF', style: AppTypography.body(context)),
                  subtitle: Text('Arquivo PDF ou imagem da fatura', style: AppTypography.tiny(context)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _selecionarDocumento();
                  },
                ),
              ],
            ),
          ),
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
    final anexo = _anexoPendente;
    if ((texto.isEmpty && anexo == null) || _isSending) return;

    // Fecha o teclado ao enviar.
    _campoFoco.unfocus();
    if (_ouvindo) {
      _speech.stop();
      _ouvindo = false;
    }

    final textoEnvio = texto.isNotEmpty
        ? texto
        : (anexo != null ? 'Identifique e processe este documento/fatura.' : '');

    setState(() {
      _mensagens.add(_ChatMessage(textoEnvio, true, anexo: anexo));
      _isSending = true;
      _msgController.clear();
      _anexoPendente = null;
    });
    _scrollToBottom();

    final resposta = await apiPerguntarChatIa(
      textoEnvio,
      conversaId: _conversaId,
      arquivo: anexo != null
          ? {
              'nome': anexo['nome'],
              'mime_type': anexo['mime_type'],
              'base64': anexo['base64'],
            }
          : null,
    );

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
        // Stack, não Row: são dois botões à esquerda e um à direita, então o
        // vão entre eles não tem o mesmo meio que a barra. Num Expanded o
        // título centraliza no vão e sai visivelmente deslocado.
        child: Stack(
          alignment: Alignment.center,
          children: [
            Row(
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
                const Spacer(),
                _acaoTopo(
                  icon: PhosphorIcons.notePencil,
                  tooltip: 'Nova conversa',
                  onTap: _novaConversa,
                ),
              ],
            ),
            // Folga lateral para o título nunca encostar nos botões; o
            // IgnorePointer deixa o toque passar para o que estiver embaixo.
            IgnorePointer(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 96),
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
                    if (isMe && msg.anexo != null) ...[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: msg.anexo!['is_image'] == true && msg.anexo!['path'] != null
                            ? Image.file(
                                io.File(msg.anexo!['path']),
                                height: 140,
                                width: double.infinity,
                                fit: BoxFit.cover,
                              )
                            : Container(
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: Colors.white.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(PhosphorIcons.filePdf, color: Colors.white, size: 24),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        msg.anexo!['nome'] ?? 'Fatura Anexada',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                      ),
                      const SizedBox(height: 8),
                    ],
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

  Widget _buildAnexoPreview(BuildContext context) {
    if (_anexoPendente == null) return const SizedBox.shrink();
    final isImage = _anexoPendente!['is_image'] == true;
    final path = _anexoPendente!['path'] as String?;
    final nome = _anexoPendente!['nome'] ?? 'Arquivo';
    final kb = _anexoPendente!['tamanho_kb'] ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withOpacity(0.35), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.08),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: isImage && path != null
                ? Image.file(
                    io.File(path),
                    width: 38,
                    height: 38,
                    fit: BoxFit.cover,
                  )
                : Container(
                    width: 38,
                    height: 38,
                    color: Colors.deepOrange.withOpacity(0.15),
                    child: const Icon(PhosphorIcons.filePdf, color: Colors.deepOrange, size: 22),
                  ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  nome,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.caption(context).copyWith(fontWeight: FontWeight.bold),
                ),
                Text(
                  '$kb KB • Fatura pronta para envio',
                  style: AppTypography.tiny(context).copyWith(color: AppColors.primary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () => setState(() => _anexoPendente = null),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.border(context).withOpacity(0.5),
                shape: BoxShape.circle,
              ),
              child: Icon(PhosphorIcons.x, size: 14, color: AppColors.textPrimary(context)),
            ),
          ),
        ],
      ),
    );
  }

  /// Campo flutuante moderno — borda nítida de alto contraste no light mode
  /// e visual elegante com destaque suave de foco.
  Widget _buildInput(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isFocused = _campoFoco.hasFocus;
    const raio = 30.0;

    final Color bgColor = isDark
        ? const Color(0xFF131D2E).withOpacity(0.92)
        : Colors.white;

    final Color borderColor = isFocused
        ? AppColors.primary
        : (isDark
            ? const Color(0xFF2E3D52)
            : const Color(0xFFD0D5DD)); // Borda perfeitamente visível e nítida no light mode

    final double borderWidth = isFocused ? 1.5 : 1.2;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildAnexoPreview(context),
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(raio),
              boxShadow: [
                if (!isDark) ...[
                  BoxShadow(
                    color: const Color(0xFF101828).withOpacity(0.08),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                  BoxShadow(
                    color: const Color(0xFF101828).withOpacity(0.04),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ] else ...[
                  BoxShadow(
                    color: Colors.black.withOpacity(0.35),
                    blurRadius: 20,
                    offset: const Offset(0, 6),
                  ),
                ],
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(raio),
              clipBehavior: Clip.antiAlias,
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                child: Container(
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(raio),
                    border: Border.all(
                      color: borderColor,
                      width: borderWidth,
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(AppSpacing.sm, 6, 6, 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Botão de Anexo (Foto / Arquivo / PDF)
                      GestureDetector(
                        onTap: _isSending ? null : _abrirMenuAnexo,
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: const BoxDecoration(
                            color: Colors.transparent,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            PhosphorIcons.paperclip,
                            color: _anexoPendente != null
                                ? AppColors.primary
                                : AppColors.textTertiary(context),
                            size: 22,
                          ),
                        ),
                      ),
                      const SizedBox(width: 2),
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
                            hintText: _anexoPendente != null
                                ? 'Descreva a fatura (ou envie)'
                                : 'Pergunte algo',
                            hintStyle: AppTypography.body(context)
                                .copyWith(color: AppColors.textTertiary(context)),
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
        ],
      ),
    );
  }
}
