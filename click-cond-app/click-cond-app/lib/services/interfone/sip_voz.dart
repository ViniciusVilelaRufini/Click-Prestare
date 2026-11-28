import 'dart:async';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/utils/log.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:sip_ua/sip_ua.dart';

/// Estados de uma [SessaoVoz]: `conectando`, `em_chamada`, `encerrada`.
abstract class SessaoVoz {
  /// Estado atual e as mudanças (o último valor também fica em [estadoAtual]).
  Stream<String> get estado;
  String get estadoAtual;

  /// True quando o vídeo do facial chegou ao renderizador.
  ValueListenable<bool> get temVideo;

  void encerrar();
  void mudo(bool ligado);
  Future<void> altoFalante(bool ligado);
}

/// Entra na chamada da central. Trocado no teste da tela.
typedef ConectorVoz = Future<SessaoVoz> Function(DadosEntrada d, RTCVideoRenderer? video);

/// Cliente SIP sobre WSS sem registro: o app só faz uma chamada de saída para
/// `sip:entrar@...` com o token curto no cabeçalho `X-Prestare-Token`. Áudio
/// nos dois sentidos; vídeo só de recebimento (a câmera nunca é ligada).
class SipVoz {
  SipVoz._();

  /// URI do próprio app (fictícia: a central não registra o app; quem
  /// identifica a pessoa é o token).
  static const String uriDoApp = 'sip:app@voz.prestarecondominios.com.br';

  /// Teto para a central atender o INVITE (ICE + socket + 200 OK).
  static const Duration limiteConexao = Duration(seconds: 25);

  static Future<SessaoVoz> entrar(
    DadosEntrada d, {
    required RTCVideoRenderer? video,
    @visibleForTesting SIPUAHelper? helper,
    @visibleForTesting Future<MediaStream> Function(Map<String, dynamic> restricoes)? obterMicrofone,
  }) async {
    final s = _SessaoSip(d, video, helper ?? SIPUAHelper(), obterMicrofone ?? navigator.mediaDevices.getUserMedia);
    await s.iniciar();
    return s;
  }

  /// `ice` do contrato no formato do sip_ua: um mapa por URL (ele só aceita
  /// `urls` em texto).
  @visibleForTesting
  static List<Map<String, String>> iceDoSipUa(List<ServidorIce> ice) => [
        for (final s in ice)
          for (final url in s.urls)
            {
              'urls': url,
              if (s.username != null) 'username': s.username!,
              if (s.credential != null) 'credential': s.credential!,
            },
      ];

  /// Opções da chamada: microfone sim, câmera não, e oferta pedindo para
  /// receber o vídeo do facial.
  @visibleForTesting
  static Map<String, dynamic> opcoesDaChamada() => <String, dynamic>{
        'mediaConstraints': <String, dynamic>{'audio': true, 'video': false},
        'rtcOfferConstraints': <String, dynamic>{
          'mandatory': <String, dynamic>{
            'OfferToReceiveAudio': true,
            'OfferToReceiveVideo': true,
          },
          'optional': <dynamic>[],
        },
      };
}

class _SessaoSip implements SipUaHelperListener, SessaoVoz {
  _SessaoSip(this._dados, this._video, this._helper, this._obterMicrofone);

  final DadosEntrada _dados;
  final RTCVideoRenderer? _video;
  final SIPUAHelper _helper;
  final Future<MediaStream> Function(Map<String, dynamic> restricoes) _obterMicrofone;
  final StreamController<String> _estados = StreamController<String>.broadcast();
  final ValueNotifier<bool> _temVideo = ValueNotifier<bool>(false);
  String _estado = 'conectando';
  MediaStream? _local;
  Call? _call;
  bool _ligou = false;
  Timer? _limite;

  @override
  Stream<String> get estado => _estados.stream;

  @override
  String get estadoAtual => _estado;

  @override
  ValueListenable<bool> get temVideo => _temVideo;

  Future<void> iniciar() async {
    _limite = Timer(SipVoz.limiteConexao, () {
      if (_estado == 'conectando') {
        logDebug('[Interfone] central não atendeu a tempo');
        encerrar();
      }
    });
    try {
      // Microfone antes do socket: a permissão já foi pedida pela tela.
      _local = await _obterMicrofone(<String, dynamic>{'audio': true, 'video': false});
    } catch (e) {
      logDebug('[Interfone] microfone: ${e.runtimeType}');
      encerrar();
      return;
    }
    final settings = UaSettings()
      ..webSocketUrl = _dados.wss
      ..transportType = TransportType.WS
      ..uri = SipVoz.uriDoApp
      ..authorizationUser = ''
      ..password = ''
      ..displayName = 'Prestare'
      ..userAgent = 'Prestare App'
      ..register = false
      ..sessionTimers = false
      // Espera os candidatos do TURN antes do INVITE (o padrão de 500 ms
      // perde o relay em rede móvel).
      ..iceGatheringTimeout = 2000
      ..iceServers = SipVoz.iceDoSipUa(_dados.ice);
    _helper.addSipUaHelperListener(this);
    try {
      await _helper.start(settings);
    } catch (e) {
      logDebug('[Interfone] sip start: ${e.runtimeType}');
      encerrar();
    }
  }

  Future<void> _ligar() async {
    if (_ligou || _estado == 'encerrada') return;
    _ligou = true;
    final ok = await _helper.call(
      _dados.sipUri,
      voiceOnly: false,
      mediaStream: _local,
      headers: ['X-Prestare-Token: ${_dados.token}'],
      customOptions: SipVoz.opcoesDaChamada(),
    );
    if (!ok) encerrar();
  }

  void _mudar(String novo) {
    if (_estado == novo || _estado == 'encerrada') return;
    _estado = novo;
    if (!_estados.isClosed) _estados.add(novo);
    if (novo != 'conectando') _limite?.cancel();
  }

  @override
  void transportStateChanged(TransportState state) {
    switch (state.state) {
      case TransportStateEnum.CONNECTED:
        unawaited(_ligar());
      case TransportStateEnum.DISCONNECTED:
        // Sem socket não há chamada (nem antes de ligar, nem durante).
        if (_ligou || _estado == 'conectando') encerrar();
      default:
        break;
    }
  }

  @override
  void callStateChanged(Call call, CallState state) {
    _call = call;
    switch (state.state) {
      case CallStateEnum.STREAM:
        final stream = state.stream;
        if (state.originator == Originator.remote && stream != null) {
          final v = _video;
          if (v != null && stream.getVideoTracks().isNotEmpty) {
            v.srcObject = stream;
            _temVideo.value = true;
          }
        }
      case CallStateEnum.ACCEPTED:
      case CallStateEnum.CONFIRMED:
        _mudar('em_chamada');
      case CallStateEnum.FAILED:
      case CallStateEnum.ENDED:
        encerrar();
      default:
        break;
    }
  }

  @override
  void encerrar() {
    if (_estado == 'encerrada' && _call == null && _local == null) return;
    _limite?.cancel();
    final call = _call;
    _call = null;
    try {
      if (call != null && call.state != CallStateEnum.ENDED && call.state != CallStateEnum.FAILED) {
        call.hangup(<String, dynamic>{'status_code': 603});
      }
    } catch (_) {}
    try {
      _helper.removeSipUaHelperListener(this);
      _helper.stop();
    } catch (_) {}
    final local = _local;
    _local = null;
    if (local != null) {
      for (final t in local.getTracks()) {
        try {
          t.stop();
        } catch (_) {}
      }
      unawaited(local.dispose().catchError((Object _) {}));
    }
    _mudar('encerrada');
    _temVideo.value = false;
    unawaited(_estados.close());
  }

  @override
  void mudo(bool ligado) {
    final local = _local;
    if (local == null) return;
    for (final t in local.getAudioTracks()) {
      t.enabled = !ligado;
    }
  }

  @override
  Future<void> altoFalante(bool ligado) async {
    try {
      await Helper.setSpeakerphoneOn(ligado);
    } catch (e) {
      logDebug('[Interfone] alto-falante: ${e.runtimeType}');
    }
  }

  @override
  void registrationStateChanged(RegistrationState state) {}

  @override
  void onNewMessage(SIPMessageRequest msg) {}

  @override
  void onNewNotify(Notify ntf) {}

  @override
  void onNewReinvite(ReInvite event) {}
}
