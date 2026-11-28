import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/services/interfone/sip_voz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:sip_ua/sip_ua.dart';
// ignore: implementation_imports
import 'package:sip_ua/src/rtc_session.dart';

class _Faixa extends Fake implements MediaStreamTrack {
  _Faixa(this.kind);

  @override
  final String kind;

  @override
  bool enabled = true;

  bool parada = false;

  @override
  Future<void> stop() async => parada = true;
}

class _Stream extends Fake implements MediaStream {
  final _Faixa audio = _Faixa('audio');
  bool descartado = false;

  @override
  List<MediaStreamTrack> getTracks() => [audio];
  @override
  List<MediaStreamTrack> getAudioTracks() => [audio];
  @override
  List<MediaStreamTrack> getVideoTracks() => [];
  @override
  Future<void> dispose() async => descartado = true;
}

class _SessaoRtc extends Fake implements RTCSession {}

class _Ligacao {
  final String alvo;
  final bool voiceOnly;
  final MediaStream? stream;
  final List<String> headers;
  final Map<String, dynamic>? opcoes;
  _Ligacao(this.alvo, this.voiceOnly, this.stream, this.headers, this.opcoes);
}

class _HelperFalso extends SIPUAHelper {
  UaSettings? settings;
  final List<SipUaHelperListener> ouvintes = [];
  final List<_Ligacao> ligacoes = [];
  bool parou = false;

  @override
  Future<void> start(UaSettings uaSettings) async => settings = uaSettings;

  @override
  void addSipUaHelperListener(SipUaHelperListener listener) => ouvintes.add(listener);

  @override
  void removeSipUaHelperListener(SipUaHelperListener listener) => ouvintes.remove(listener);

  @override
  Future<bool> call(String target,
      {bool voiceOnly = false,
      MediaStream? mediaStream,
      List<String>? headers,
      Map<String, dynamic>? customOptions}) async {
    ligacoes.add(_Ligacao(target, voiceOnly, mediaStream, headers ?? const [], customOptions));
    return true;
  }

  @override
  void stop() => parou = true;

  void transporte(TransportStateEnum e) {
    for (final o in List.of(ouvintes)) {
      o.transportStateChanged(TransportState(e));
    }
  }

  void estadoDaChamada(CallStateEnum e) {
    final call = Call('c1', _SessaoRtc(), e, false);
    for (final o in List.of(ouvintes)) {
      o.callStateChanged(call, CallState(e));
    }
  }
}

final _dados = DadosEntrada.fromJson({
  'id': 41,
  'token': 'tok.curto',
  'wss': 'wss://voz.prestarecondominios.com.br:8089/ws',
  'sip_uri': 'sip:entrar@voz.prestarecondominios.com.br',
  'ice': [
    {
      'urls': ['turn:voz.prestarecondominios.com.br:3478?transport=udp'],
      'username': 'u',
      'credential': 'c',
    },
  ],
});

void main() {
  late _HelperFalso helper;
  late _Stream microfone;
  late List<Map<String, dynamic>> restricoes;

  setUp(() {
    helper = _HelperFalso();
    microfone = _Stream();
    restricoes = [];
  });

  Future<SessaoVoz> entrar() => SipVoz.entrar(_dados, video: null, helper: helper, obterMicrofone: (r) async {
        restricoes.add(r);
        return microfone;
      });

  test('sobe sem registro e liga para sip:entrar com o token, sem câmera', () async {
    final s = await entrar();
    final estados = <String>[];
    s.estado.listen(estados.add);

    // Microfone sim, câmera não.
    expect(restricoes.single['audio'], isTrue);
    expect(restricoes.single['video'], isFalse);

    final cfg = helper.settings!;
    expect(cfg.register, isFalse);
    expect(cfg.webSocketUrl, _dados.wss);
    expect(cfg.transportType, TransportType.WS);
    expect(cfg.uri, SipVoz.uriDoApp);
    expect(cfg.iceServers.single['urls'], 'turn:voz.prestarecondominios.com.br:3478?transport=udp');
    expect(cfg.iceServers.single['username'], 'u');

    // Só liga quando o socket conecta.
    expect(helper.ligacoes, isEmpty);
    helper.transporte(TransportStateEnum.CONNECTED);
    await Future<void>.delayed(Duration.zero);
    final l = helper.ligacoes.single;
    expect(l.alvo, 'sip:entrar@voz.prestarecondominios.com.br');
    expect(l.headers, contains('X-Prestare-Token: tok.curto'));
    expect(l.stream, same(microfone));
    // Recebe vídeo (não é só voz), mas a mídia local não leva câmera.
    expect(l.voiceOnly, isFalse);
    expect((l.opcoes!['mediaConstraints'] as Map)['video'], isFalse);
    final oferta = (l.opcoes!['rtcOfferConstraints'] as Map)['mandatory'] as Map;
    expect(oferta['OfferToReceiveVideo'], isTrue);
    expect(oferta['OfferToReceiveAudio'], isTrue);

    helper.estadoDaChamada(CallStateEnum.CONFIRMED);
    await Future<void>.delayed(Duration.zero);
    expect(s.estadoAtual, 'em_chamada');

    s.mudo(true);
    expect(microfone.audio.enabled, isFalse);
    s.mudo(false);
    expect(microfone.audio.enabled, isTrue);

    helper.estadoDaChamada(CallStateEnum.ENDED);
    await Future<void>.delayed(Duration.zero);
    expect(s.estadoAtual, 'encerrada');
    expect(helper.parou, isTrue);
    expect(microfone.audio.parada, isTrue);
    expect(microfone.descartado, isTrue);
    expect(estados, ['em_chamada', 'encerrada']);
  });

  test('socket cai antes de ligar: encerra', () async {
    final s = await entrar();
    helper.transporte(TransportStateEnum.DISCONNECTED);
    await Future<void>.delayed(Duration.zero);
    expect(s.estadoAtual, 'encerrada');
    expect(helper.ligacoes, isEmpty);
    expect(helper.parou, isTrue);
  });

  test('encerrar pelo app solta o microfone e para o cliente SIP', () async {
    final s = await entrar();
    helper.transporte(TransportStateEnum.CONNECTED);
    await Future<void>.delayed(Duration.zero);
    s.encerrar();
    expect(s.estadoAtual, 'encerrada');
    expect(helper.parou, isTrue);
    expect(microfone.audio.parada, isTrue);
  });

  test('sem microfone não sobe o cliente SIP', () async {
    final s = await SipVoz.entrar(_dados, video: null, helper: helper, obterMicrofone: (_) async => throw Exception('negado'));
    expect(s.estadoAtual, 'encerrada');
    expect(helper.settings, isNull);
  });
}
