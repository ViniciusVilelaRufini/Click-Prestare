// Mesmas ofertas do console (sdp-central-h264.fixture.ts): Chrome com 6 perfis H264 (cada um com rtx e
// muitos rtcp-fb) e ssrc-group FID, e um vídeo sem codec aceito dentro de um a=group:BUNDLE.

List<String> _perfil(int pt, int rtx, int packetization, String profile) => <String>[
      'a=rtpmap:$pt H264/90000',
      'a=rtcp-fb:$pt goog-remb',
      'a=rtcp-fb:$pt transport-cc',
      'a=rtcp-fb:$pt ccm fir',
      'a=rtcp-fb:$pt nack',
      'a=rtcp-fb:$pt nack pli',
      'a=fmtp:$pt level-asymmetry-allowed=1;packetization-mode=$packetization;profile-level-id=$profile',
      'a=rtpmap:$rtx rtx/90000',
      'a=fmtp:$rtx apt=$pt',
    ];

final String ofertaSeisH264 = <String>[
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0 8 110 126',
  'a=mid:0',
  'a=rtpmap:111 opus/48000/2',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:110 telephone-event/48000',
  'a=rtpmap:126 telephone-event/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 100 101 102 103 104 105 106 107 108 109 112 113',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=recvonly',
  'a=rtcp-mux',
  'a=ssrc-group:FID 3333 4444',
  'a=ssrc:3333 cname:v',
  'a=ssrc:4444 cname:v',
  ..._perfil(100, 101, 1, '64001f'),
  ..._perfil(102, 103, 1, '4d001f'),
  ..._perfil(104, 105, 0, '42e01f'),
  ..._perfil(106, 107, 1, '42001f'),
  ..._perfil(108, 109, 1, '42e01f'),
  ..._perfil(112, 113, 1, '640c1f'),
  '',
].join('\r\n');

final String ofertaBundleSemH264 = <String>[
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 0',
  'a=mid:0',
  'a=rtpmap:0 PCMU/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=rtpmap:96 VP8/90000',
  '',
].join('\r\n');
