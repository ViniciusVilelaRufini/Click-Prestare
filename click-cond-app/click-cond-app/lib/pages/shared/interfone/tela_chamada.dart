import 'dart:async';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/interfone_chamadas.dart';
import 'package:click/services/interfone/sip_voz.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:click/utils/navigation_service.dart';
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

  /// Cache da sessão pronto (o app pode ter aberto agora, pela chamada).
  final Future<void> Function() prepararSessao;

  /// Quanto a tela espera com a mensagem final antes de fechar.
  final Duration esperaAoFechar;

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
    this.prepararSessao = ensureStorageReady,
    this.esperaAoFechar = const Duration(seconds: 2),
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

  String get _uuid => uuidDaChamada(widget.id);
  String get _tipo => _estado?.tipo ?? widget.tipoInicial ?? '';
  bool get _ehDoFacial => _tipo == 'facial_unidade';
  bool get _ligandoParaPortaria => _tipo == 'unidade_portaria';

  @override
  void initState() {
    super.initState();
    InterfoneChamadas.registrarTela(widget.id, () {
      if (!_saindo) _encerrarAgora();
    });
    unawaited(_iniciar());
  }

  Future<void> _iniciar() async {
    try {
      await widget.prepararSessao().timeout(const Duration(seconds: 5));
    } catch (_) {}
    unawaited(_carregarEstado());

    if (!await widget.pedirMicrofone()) {
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
    }
    if (_desmontada) return;

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
    } else if (fase == 'encerrada') {
      final semConversa = _conectadaEm == null;
      _terminar(semConversa && _ligandoParaPortaria
          ? 'A portaria não atendeu'
          : (semConversa ? 'Não foi possível conectar a chamada' : 'Chamada encerrada'));
    } else {
      setState(() => _fase = fase);
    }
  }

  /// Mostra a mensagem final e fecha a tela.
  void _terminar(String mensagem) {
    if (_saindo) return;
    _saindo = true;
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
    Navigator.of(context).maybePop();
  }

  void _encerrarAgora() {
    _saindo = true;
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

  void _alternarMudo() {
    setState(() => _mudo = !_mudo);
    _sessao?.mudo(_mudo);
  }

  void _alternarAltoFalante() {
    setState(() => _altoFalante = !_altoFalante);
    unawaited(_sessao?.altoFalante(_altoFalante));
  }

  @override
  void dispose() {
    _desmontada = true;
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

/// Abre a tela da chamada (Atender na tela de ligação). O navegador pode ainda
/// não existir quando o app abre pela chamada: tenta por até 5 s.
Future<void> abrirTelaDaChamada(int id, {int tentativa = 0}) async {
  final nav = NavigationService.navigatorKey.currentState;
  if (nav == null) {
    if (tentativa >= 25) return;
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return abrirTelaDaChamada(id, tentativa: tentativa + 1);
  }
  unawaited(nav.push(MaterialPageRoute<void>(
    settings: const RouteSettings(name: '/interfone/chamada'),
    builder: (_) => TelaChamada(id: id),
  )));
}

/// "Ligar para a portaria": pede o microfone, pede a ligação à API e abre a
/// tela já conectando. Sem porteiro com o console aberto, avisa sem ligar.
Future<void> ligarParaPortaria(BuildContext context, int idApartamento, {String? unidade}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final nav = Navigator.of(context);
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
  unawaited(nav.push(MaterialPageRoute<void>(
    settings: const RouteSettings(name: '/interfone/chamada'),
    builder: (_) => TelaChamada(
      id: dados.id,
      jaConectado: dados,
      tipoInicial: 'unidade_portaria',
      tituloInicial: 'Portaria',
      unidadeInicial: unidade,
    ),
  )));
}
