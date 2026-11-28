import 'dart:async';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/interfone_chamadas.dart';
import 'package:click/services/interfone/sip_voz.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Texto da recusa do "atender"/"ligar" (409) para a tela.
String mensagemDaRecusa(String? motivo) {
  switch (motivo) {
    case 'ja_atendida':
      return 'Já atendida em outro aparelho';
    case 'encerrada':
      return 'A chamada já terminou';
    case 'portaria_indisponivel':
      return 'Portaria indisponível agora';
    default:
      return 'Não foi possível entrar na chamada';
  }
}

Future<bool> _pedirMicrofonePadrao() async {
  try {
    return (await Permission.microphone.request()).isGranted;
  } catch (e) {
    logDebug('[Interfone] permissão do microfone: ${e.runtimeType}');
    return false;
  }
}

Future<void> _sincronizarMudoPadrao(String uuid, bool mudo) =>
    FlutterCallkitIncoming.muteCall(uuid, isMuted: mudo);

Future<RTCVideoRenderer?> _criarVideoPadrao() async {
  final r = RTCVideoRenderer();
  await r.initialize();
  return r;
}

Future<SessaoVoz> _conectarPadrao(DadosEntrada d, RTCVideoRenderer? video) => SipVoz.entrar(d, video: video);

/// Tela da chamada do interfone (Prestare Dark): vídeo do facial em cima,
/// unidade e portão, tempo de chamada e os botões MUDO, ALTO-FALANTE,
/// ABRIR PORTÃO (só chamada do facial) e ENCERRAR.
///
/// Sem [jaConectado] (chamada que tocou no aparelho), pede para atender; com
/// ele (morador ligando para a portaria), entra direto.
class TelaChamada extends StatefulWidget {
  final int id;
  final DadosEntrada? jaConectado;

  /// Enquanto o estado não chega da API.
  final String? tipoInicial;
  final String? tituloInicial;
  final String? unidadeInicial;

  // Dependências trocadas no teste.
  final ConectorVoz conectar;
  final Future<bool> Function() pedirMicrofone;
  final Future<RTCVideoRenderer?> Function() criarVideo;
  final Future<void> Function(String uuid) encerrarTelaNativa;
  final Future<void> Function(String uuid) marcarConectada;

  /// Avisa a tela nativa (CallKit) do Mudo tocado no app.
  final Future<void> Function(String uuid, bool mudo) sincronizarMudo;

  /// Cache da sessão pronto (o app pode ter aberto agora, pela chamada).
  final Future<void> Function() prepararSessao;

  /// Quanto a tela espera com a mensagem final antes de fechar.
  final Duration esperaAoFechar;

  /// Fecha a tela. Desenhada acima do Navigator ([PainelChamada]), é quem a
  /// tirou de lá; sem ele, a tela é uma rota e sai com `maybePop`.
  final VoidCallback? aoFechar;

  const TelaChamada({
    super.key,
    required this.id,
    this.jaConectado,
    this.tipoInicial,
    this.tituloInicial,
    this.unidadeInicial,
    this.conectar = _conectarPadrao,
    this.pedirMicrofone = _pedirMicrofonePadrao,
    this.criarVideo = _criarVideoPadrao,
    this.encerrarTelaNativa = FlutterCallkitIncoming.endCall,
    this.marcarConectada = FlutterCallkitIncoming.setCallConnected,
    this.sincronizarMudo = _sincronizarMudoPadrao,
    this.prepararSessao = ensureStorageReady,
    this.esperaAoFechar = const Duration(seconds: 2),
    this.aoFechar,
  });

  @override
  State<TelaChamada> createState() => TelaChamadaState();
}

@visibleForTesting
class TelaChamadaState extends State<TelaChamada> {
  EstadoChamada? _estado;
  SessaoVoz? _sessao;
  RTCVideoRenderer? _video;
  StreamSubscription<String>? _escuta;
  Timer? _relogio;
  DateTime? _conectadaEm;
  Duration _duracao = Duration.zero;

  /// `conectando`, `em_chamada` ou `encerrada`.
  String _fase = 'conectando';
  String? _mensagem;
  bool _mudo = false;
  bool _altoFalante = false;
  bool _abrindo = false;
  bool _saindo = false;
  bool _desmontada = false;

  /// O "atender" deu certo: a API guardou a chamada para este aparelho por
  /// 15 s. Saindo antes de a conversa começar, a tela devolve (recusar).
  bool _reservada = false;
  bool _devolvida = false;

  String get _uuid => uuidDaChamada(widget.id);
  String get _tipo => _estado?.tipo ?? widget.tipoInicial ?? '';
  bool get _ehDoFacial => _tipo == 'facial_unidade';
  bool get _ligandoParaPortaria => _tipo == 'unidade_portaria';

  @override
  void initState() {
    super.initState();
    InterfoneChamadas.registrarTela(
      widget.id,
      () {
        if (!_saindo) _encerrarAgora();
      },
      aoMudo: (m) => _aplicarMudo(m, avisarSistema: false),
    );
    unawaited(_iniciar());
  }

  Future<void> _iniciar() async {
    try {
      await widget.prepararSessao().timeout(const Duration(seconds: 5));
    } catch (_) {}
    unawaited(_carregarEstado());

    if (!await widget.pedirMicrofone()) {
      // Sem microfone não há conversa: recusa, e a chamada segue para os
      // outros moradores ou para a portaria.
      if (widget.jaConectado == null) unawaited(InterfoneApi.recusar(widget.id));
      _terminar('Sem acesso ao microfone. Libere o microfone do Prestare nas configurações do celular.');
      return;
    }
    if (_desmontada) return;

    var dados = widget.jaConectado;
    if (dados == null) {
      final r = await InterfoneApi.atenderComMotivo(widget.id);
      dados = r.dados;
      if (dados == null) {
        _terminar(mensagemDaRecusa(r.motivo));
        return;
      }
      _reservada = true;
    }
    if (_desmontada) {
      _devolverReserva();
      return;
    }

    try {
      _video = await widget.criarVideo();
    } catch (e) {
      logDebug('[Interfone] vídeo: ${e.runtimeType}');
    }
    if (_desmontada) {
      unawaited(_video?.dispose());
      return;
    }

    final SessaoVoz sessao;
    try {
      sessao = await widget.conectar(dados, _video);
    } catch (e) {
      logDebug('[Interfone] conectar: ${e.runtimeType}');
      _terminar('Não foi possível conectar a chamada');
      return;
    }
    if (_desmontada) {
      sessao.encerrar();
      return;
    }
    _sessao = sessao;
    sessao.temVideo.addListener(_aoMudarVideo);
    _escuta = sessao.estado.listen(_aoMudarFase);
    _aoMudarFase(sessao.estadoAtual);
  }

  Future<void> _carregarEstado() async {
    final e = await InterfoneApi.estado(widget.id);
    if (!mounted || e == null) return;
    setState(() => _estado = e);
  }

  void _aoMudarVideo() {
    if (mounted) setState(() {});
  }

  void _aoMudarFase(String fase) {
    if (!mounted || fase == _fase) return;
    if (fase == 'em_chamada') {
      _conectadaEm = DateTime.now();
      _relogio?.cancel();
      _relogio = Timer.periodic(const Duration(seconds: 1), (_) {
        final inicio = _conectadaEm;
        if (!mounted || inicio == null) return;
        setState(() => _duracao = DateTime.now().difference(inicio));
      });
      unawaited(widget.marcarConectada(_uuid).catchError((Object _) {}));
      setState(() => _fase = fase);
      // Chamada com vídeo: o morador olha a tela, então o som sai no
      // alto-falante (ele pode desligar).
      if (_ehDoFacial && !_altoFalante) _alternarAltoFalante();
    } else if (fase == 'encerrada') {
      final semConversa = _conectadaEm == null;
      _terminar(semConversa && _ligandoParaPortaria
          ? 'A portaria não atendeu'
          : (semConversa ? 'Não foi possível conectar a chamada' : 'Chamada encerrada'));
    } else {
      setState(() => _fase = fase);
    }
  }

  /// Saiu sem conversar depois de atender (Encerrar em "Conectando…", a
  /// central não respondeu): avisa a API para liberar a reserva de 15 s.
  void _devolverReserva() {
    if (!_reservada || _devolvida || _conectadaEm != null) return;
    _devolvida = true;
    unawaited(InterfoneApi.recusar(widget.id));
  }

  /// Mostra a mensagem final e fecha a tela.
  void _terminar(String mensagem) {
    if (_saindo) return;
    _saindo = true;
    _devolverReserva();
    _relogio?.cancel();
    _sessao?.encerrar();
    if (!mounted) return;
    setState(() {
      _fase = 'encerrada';
      _mensagem = mensagem;
    });
    Future<void>.delayed(widget.esperaAoFechar, _fechar);
  }

  void _fechar() {
    if (!mounted) return;
    final aoFechar = widget.aoFechar;
    if (aoFechar != null) {
      aoFechar();
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _encerrarAgora() {
    _saindo = true;
    _devolverReserva();
    _sessao?.encerrar();
    _fechar();
  }

  Future<void> _abrirPortao() async {
    if (_abrindo) return;
    setState(() {
      _abrindo = true;
      _mensagem = null;
    });
    final r = await InterfoneApi.abrir(widget.id);
    if (!mounted) return;
    setState(() {
      _abrindo = false;
      _mensagem = r.ok ? 'Portão aberto' : 'Não foi possível abrir: ${r.motivo ?? 'tente de novo'}';
    });
  }

  void _alternarMudo() => _aplicarMudo(!_mudo, avisarSistema: true);

  void _aplicarMudo(bool mudo, {required bool avisarSistema}) {
    if (mounted) setState(() => _mudo = mudo);
    _sessao?.mudo(mudo);
    if (avisarSistema) unawaited(widget.sincronizarMudo(_uuid, mudo).catchError((Object _) {}));
  }

  void _alternarAltoFalante() {
    setState(() => _altoFalante = !_altoFalante);
    unawaited(_sessao?.altoFalante(_altoFalante));
  }

  @override
  void dispose() {
    _desmontada = true;
    _devolverReserva();
    _relogio?.cancel();
    unawaited(_escuta?.cancel());
    _sessao?.temVideo.removeListener(_aoMudarVideo);
    _sessao?.encerrar();
    final v = _video;
    if (v != null) {
      v.srcObject = null;
      unawaited(v.dispose().catchError((Object _) {}));
    }
    // Antes do endCall: o ENDED que ele gera não volta para esta tela.
    InterfoneChamadas.telaFechada(widget.id);
    unawaited(widget.encerrarTelaNativa(_uuid).catchError((Object _) {}));
    super.dispose();
  }

  String get _titulo {
    final portao = _estado?.portao ?? widget.tituloInicial ?? '';
    if (_ligandoParaPortaria) return 'Portaria';
    if (_tipo == 'portaria_unidade') return 'Portaria';
    return portao.isEmpty ? 'Interfone' : portao;
  }

  String get _rotuloFase {
    switch (_fase) {
      case 'em_chamada':
        final m = _duracao.inMinutes.toString().padLeft(2, '0');
        final s = (_duracao.inSeconds % 60).toString().padLeft(2, '0');
        return '$m:$s';
      case 'encerrada':
        return 'Encerrada';
      default:
        return _ligandoParaPortaria ? 'Chamando a portaria…' : 'Conectando…';
    }
  }

  AppSignal get _sinalDaFase {
    switch (_fase) {
      case 'em_chamada':
        return AppSignal.ok;
      case 'encerrada':
        return AppSignal.danger;
      default:
        return AppSignal.warn;
    }
  }

  @override
  Widget build(BuildContext context) {
    final unidade = _estado?.unidade ?? widget.unidadeInicial ?? '';
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _sessao?.encerrar();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg(context),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _areaDoVideo(context)),
                AppSpacing.gapXl,
                Text(
                  (_ligandoParaPortaria ? 'Ligação' : 'Interfone').toUpperCase(),
                  style: AppTypography.label(context),
                ),
                AppSpacing.gapXs,
                Text(_titulo.toUpperCase(), style: AppTypography.title(context)),
                if (unidade.isNotEmpty) ...[
                  AppSpacing.gapXs,
                  Text(unidade, style: AppTypography.bodySecondary(context)),
                ],
                AppSpacing.gapMd,
                Row(
                  children: [
                    AppDot(signal: _sinalDaFase),
                    AppSpacing.gapSm,
                    Text(_rotuloFase.toUpperCase(), style: AppTypography.label(context)),
                  ],
                ),
                if (_mensagem != null) ...[
                  AppSpacing.gapMd,
                  Text(_mensagem!, key: const Key('interfone-mensagem'), style: AppTypography.strong(context)),
                ],
                AppSpacing.gapXl,
                Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        label: _mudo ? 'Mudo ligado' : 'Mudo',
                        icon: _mudo ? PhosphorIcons.microphoneSlash : PhosphorIcons.microphone,
                        variant: AppButtonVariant.secondary,
                        onPressed: _fase == 'encerrada' ? null : _alternarMudo,
                      ),
                    ),
                    AppSpacing.gapMd,
                    Expanded(
                      child: AppButton(
                        label: 'Alto-falante',
                        icon: PhosphorIcons.speakerHigh,
                        variant: _altoFalante ? AppButtonVariant.primary : AppButtonVariant.secondary,
                        onPressed: _fase == 'encerrada' ? null : _alternarAltoFalante,
                      ),
                    ),
                  ],
                ),
                if (_ehDoFacial) ...[
                  AppSpacing.gapMd,
                  AppButton(
                    label: 'Abrir portão',
                    icon: PhosphorIcons.lockOpen,
                    fullWidth: true,
                    size: AppButtonSize.lg,
                    loading: _abrindo,
                    onPressed: _fase == 'em_chamada' ? _abrirPortao : null,
                  ),
                ],
                AppSpacing.gapMd,
                AppButton(
                  label: 'Encerrar',
                  icon: PhosphorIcons.phoneDisconnect,
                  fullWidth: true,
                  size: AppButtonSize.lg,
                  variant: AppButtonVariant.danger,
                  onPressed: _encerrarAgora,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _areaDoVideo(BuildContext context) {
    final v = _video;
    final comVideo = v != null && (_sessao?.temVideo.value ?? false);
    final foto = _estado?.fotoUrl;
    Widget conteudo;
    if (comVideo) {
      conteudo = RTCVideoView(v, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain);
    } else if (foto != null) {
      conteudo = Image.network(foto, fit: BoxFit.contain, errorBuilder: (_, __, ___) => _semImagem(context));
    } else {
      conteudo = _semImagem(context);
    }
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        border: Border.all(color: AppColors.border(context)),
      ),
      child: ClipRect(child: conteudo),
    );
  }

  Widget _semImagem(BuildContext context) => Center(
        child: Icon(
          _ligandoParaPortaria ? PhosphorIcons.phoneOutgoing : PhosphorIcons.videoCamera,
          size: 40,
          color: AppColors.textTertiary(context),
        ),
      );
}

/// Chamada que a tela mostra: o id e o que já se sabe dela (do push ou da
/// ligação para a portaria) enquanto o estado não chega da API.
class PedidoChamada {
  final int id;
  final DadosEntrada? jaConectado;
  final String? tipo;
  final String? portao;
  final String? unidade;

  const PedidoChamada({required this.id, this.jaConectado, this.tipo, this.portao, this.unidade});
}

/// A chamada em curso, desenhada ACIMA do Navigator ([PainelChamada] no
/// `MaterialApp.builder`). Assim a navegação de entrada do app aberto pelo
/// Atender (HomePage com `pushReplacement`, lista de condomínios com `push`)
/// não troca nem esconde a tela da chamada.
class ChamadaNaTela {
  ChamadaNaTela._();

  static final ValueNotifier<PedidoChamada?> atual = ValueNotifier<PedidoChamada?>(null);

  static bool get ativa => atual.value != null;

  /// Mostra a chamada. A mesma chamada de novo não abre outra tela.
  static void mostrar(PedidoChamada p) {
    if (atual.value?.id == p.id) return;
    atual.value = p;
  }

  /// Tira a chamada [id] da tela (se ainda for ela).
  static void fechar(int id) {
    if (atual.value?.id == id) atual.value = null;
  }

  /// Voltar do Android com a chamada na tela: não mexe na navegação de baixo.
  static bool consumirVoltar() => ativa;

  @visibleForTesting
  static void redefinirParaTeste() => atual.value = null;
}

/// Hospeda a [TelaChamada] por cima do app inteiro.
class PainelChamada extends StatelessWidget {
  final Widget? child;

  /// Monta a tela da chamada (trocado no teste).
  final Widget Function(PedidoChamada p, VoidCallback fechar) construir;

  const PainelChamada({super.key, required this.child, this.construir = _construirPadrao});

  static Widget _construirPadrao(PedidoChamada p, VoidCallback fechar) => TelaChamada(
        id: p.id,
        jaConectado: p.jaConectado,
        tipoInicial: p.tipo,
        tituloInicial: p.portao,
        unidadeInicial: p.unidade,
        aoFechar: fechar,
      );

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<PedidoChamada?>(
      valueListenable: ChamadaNaTela.atual,
      builder: (context, p, _) => Stack(
        fit: StackFit.expand,
        children: [
          if (child != null) child!,
          if (p != null)
            Positioned.fill(
              // Overlay próprio: fora do Navigator não há um para os widgets
              // que dependem dele.
              child: Overlay(
                key: ValueKey<int>(p.id),
                initialEntries: [
                  OverlayEntry(builder: (_) => construir(p, () => ChamadaNaTela.fechar(p.id))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

String? _textoDoExtra(Map<String, dynamic> extra, String chave) {
  final v = '${extra[chave] ?? ''}'.trim();
  return v.isEmpty ? null : v;
}

/// Abre a tela da chamada (Atender na tela de ligação) com o que veio no push
/// (tipo, portão, unidade). Não depende do Navigator: ver [ChamadaNaTela].
Future<void> abrirTelaDaChamada(int id, Map<String, dynamic> extra) async {
  ChamadaNaTela.mostrar(PedidoChamada(
    id: id,
    tipo: _textoDoExtra(extra, 'tipo'),
    portao: _textoDoExtra(extra, 'portao'),
    unidade: _textoDoExtra(extra, 'unidade'),
  ));
}

/// "Ligar para a portaria": pede o microfone, pede a ligação à API e abre a
/// tela já conectando. Sem porteiro com o console aberto, avisa sem ligar.
Future<void> ligarParaPortaria(BuildContext context, int idApartamento, {String? unidade}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  void avisar(String texto) => messenger?.showSnackBar(SnackBar(content: Text(texto)));

  if (!await _pedirMicrofonePadrao()) {
    avisar('Sem acesso ao microfone. Libere o microfone do Prestare nas configurações do celular.');
    return;
  }
  final r = await InterfoneApi.ligarPortariaComMotivo(idApartamento);
  final dados = r.dados;
  if (dados == null) {
    avisar(r.motivo == null ? 'Não foi possível ligar para a portaria' : mensagemDaRecusa(r.motivo));
    return;
  }
  // Ligação de saída no CallKit (iPhone): é ele que liga o áudio da conversa
  // (o WebRTC usa áudio manual, ver AppDelegate). No Android segura o serviço
  // de chamada em primeiro plano.
  try {
    await FlutterCallkitIncoming.startCall(CallKitParams(
      id: uuidDaChamada(dados.id),
      nameCaller: 'Portaria',
      appName: 'Prestare',
      handle: unidade ?? '',
      type: 0,
      extra: {'id': '${dados.id}', 'tipo': 'unidade_portaria'},
      ios: const IOSParams(handleType: 'generic', supportsVideo: false),
      callingNotification: const NotificationParams(
        showNotification: true,
        isShowCallback: true,
        subtitle: 'Ligando para a portaria',
        callbackText: 'Encerrar',
      ),
      android: const AndroidParams(isCustomNotification: true, isShowCallID: true),
    ));
  } catch (e) {
    logDebug('[Interfone] startCall: ${e.runtimeType}');
  }
  ChamadaNaTela.mostrar(PedidoChamada(
    id: dados.id,
    jaConectado: dados,
    tipo: 'unidade_portaria',
    portao: 'Portaria',
    unidade: unidade,
  ));
}
