import 'package:click/services/interfone/sdp_central.dart';
import 'package:flutter_test/flutter_test.dart';

import 'sdp_central_fixture.dart';

List<String> _secao(String sdp, String tipo) {
  final linhas = sdp.split('\r\n');
  final ini = linhas.indexWhere((l) => l.startsWith('m=$tipo'));
  if (ini < 0) return const [];
  var fim = linhas.indexWhere((l) => l.startsWith('m=') || l.isEmpty, ini + 1);
  if (fim < 0) fim = linhas.length;
  return linhas.sublist(ini, fim);
}

List<String> _pts(String linhaM) => linhaM.split(' ').sublist(3);

List<String> _comPayload(List<String> linhas) {
  final r = RegExp(r'^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)');
  final pts = <String>{
    for (final l in linhas)
      if (r.firstMatch(l) case final m?) m.group(1)!,
  }.toList()
    ..sort();
  return pts;
}

void main() {
  group('filtrarSdpParaCentral (o Asterisk 20.6 recusa a oferta cheia do libwebrtc)', () {
    final saida = filtrarSdpParaCentral(ofertaChrome);

    test('áudio fica só com PCMU, PCMA e telephone-event, na ordem original', () {
      final a = _secao(saida, 'audio');
      expect(a.first, 'm=audio 9 UDP/TLS/RTP/SAVPF 0 8 110 126');
      expect(_comPayload(a), ['0', '110', '126', '8']);
      expect(a, isNot(contains('a=rtpmap:111 opus/48000/2')));
      expect(a, isNot(contains('a=fmtp:111 minptime=10;useinbandfec=1')));
      expect(a, isNot(contains('a=rtcp-fb:111 transport-cc')));
      expect(a, isNot(contains('a=fmtp:63 111/111')));
    });

    test('vídeo fica só com os H264 e os rtx que apontam para eles', () {
      final v = _secao(saida, 'video');
      expect(_pts(v.first), ['102', '103', '104', '105']);
      expect(_comPayload(v), ['102', '103', '104', '105']);
      expect(v, contains('a=fmtp:103 apt=102'));
      expect(v, contains('a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'));
      expect(v, contains('a=rtcp-fb:102 nack pli'));
      expect(v.any((l) => RegExp(r'VP8|VP9|AV1|H265|red/|ulpfec').hasMatch(l)), isFalse);
    });

    test('linhas que não são de payload ficam intactas nas mídias', () {
      expect(
        _secao(saida, 'audio'),
        containsAll(<String>[
          'a=mid:0',
          'a=sendrecv',
          'a=rtcp-mux',
          'a=ssrc:1111 cname:xyz',
          'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
          'c=IN IP4 0.0.0.0',
        ]),
      );
      expect(_secao(saida, 'video'), containsAll(<String>['a=mid:1', 'a=recvonly', 'a=rtcp-rsize']));
    });

    test('sessão e m=application ficam iguais', () {
      expect(saida.startsWith(ofertaChrome.substring(0, ofertaChrome.indexOf('m=audio'))), isTrue);
      expect(_secao(saida, 'application'), _secao(ofertaChrome, 'application'));
    });

    test('preserva CRLF (nenhum \\r ou \\n solto) e o CRLF final', () {
      expect(saida.replaceAll('\r\n', '').contains(RegExp(r'[\r\n]')), isFalse);
      expect(saida.endsWith('\r\n'), isTrue);
    });

    test('é idempotente', () {
      expect(filtrarSdpParaCentral(saida), saida);
    });

    test('vídeo sem nenhum codec aceito: m=video vai para a porta 0 (recusado) com um payload só', () {
      final s = filtrarSdpParaCentral(ofertaVideoSemH264);
      final v = _secao(s, 'video');
      expect(v.first, 'm=video 0 UDP/TLS/RTP/SAVPF 96');
      expect(v, contains('a=rtpmap:96 VP8/90000')); // o pjmedia exige rtpmap do payload dinâmico listado
      expect(v.any((l) => RegExp(r'^a=(rtcp-fb|fmtp):96|^a=[\w-]+:97').hasMatch(l)), isFalse);
      expect(_secao(s, 'audio').first, 'm=audio 9 UDP/TLS/RTP/SAVPF 0');
    });

    test('texto sem m= volta igual', () {
      expect(filtrarSdpParaCentral('v=0\r\ns=-\r\n'), 'v=0\r\ns=-\r\n');
    });
  });
}
