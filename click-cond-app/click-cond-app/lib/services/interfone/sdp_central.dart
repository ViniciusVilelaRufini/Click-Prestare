/// Enxuga a oferta SDP local antes de ela ir para a central.
///
/// O Asterisk 20.6 do Ubuntu (pjproject) responde "400 Bad Request" à oferta
/// cheia do libwebrtc: estoura o limite de atributos por mídia (PJ_ETOOMANY)
/// e, com a lista cortada, acusa "Missing SDP rtpmap for dynamic payload
/// type". A central só usa PCMU/PCMA/telephone-event no áudio e H264 no vídeo,
/// então a oferta sai só com eles (mais os rtx cujo apt é um H264 mantido).
/// Mesma regra do console (portaria-web, `sdp-central.ts`).
///
/// Limites extras (o Chrome chega a oferecer 4-6 perfis H264, e cada um traz
/// fmtp/rtcp-fb/rtx): no vídeo ficam no máximo 2 payloads H264
/// (packetization-mode=1 com profile-level-id 42e01f, depois 42001f, depois
/// qualquer packetization-mode=1, depois o primeiro H264) e só os rtx deles;
/// a=rtcp-fb só nack, nack pli e ccm fir; no áudio só o telephone-event de
/// clock 8000. Sem rtx mantido, somem também a=ssrc-group:FID e a=ssrc do SSRC
/// rtx. Mídia recusada (porta 0) sai do a=group:BUNDLE.
///
/// Linhas de sessão e mídias que não são áudio/vídeo (m=application) ficam
/// iguais; nas mídias filtradas somem os payloads removidos do m= e as linhas
/// a=rtpmap/a=fmtp/a=rtcp-fb deles; o resto fica. Se nenhum codec aceito
/// sobrar, a mídia vai para a porta 0 (recusada) com um payload só e o rtpmap
/// dele. O separador de linha (CRLF) é preservado.
String filtrarSdpParaCentral(String sdp) {
  final quebra = sdp.contains('\r\n') ? '\r\n' : '\n';
  final secoes = <List<String>>[<String>[]];
  for (final l in sdp.split(quebra)) {
    if (l.startsWith('m=')) {
      secoes.add(<String>[l]);
    } else {
      secoes.last.add(l);
    }
  }
  var sessao = secoes.first;
  final saida = <String>[];
  final recusados = <String>[];
  for (final s in secoes.skip(1)) {
    final r = _filtrarMidia(s);
    saida.addAll(r.linhas);
    if (r.midRecusado != null) recusados.add(r.midRecusado!);
  }
  if (recusados.isNotEmpty) {
    sessao = <String>[
      for (final l in sessao)
        if (!l.startsWith('a=group:BUNDLE')) l else (l.split(' ')..removeWhere(recusados.contains)).join(' '),
    ];
  }
  return <String>[...sessao, ...saida].join(quebra);
}

const Map<String, List<String>> _aceitos = <String, List<String>>{
  'audio': <String>['PCMU', 'PCMA', 'TELEPHONE-EVENT'],
  'video': <String>['H264'],
};

/// Payloads estáticos que podem vir sem a=rtpmap (RFC 3551).
const Map<String, String> _estaticos = <String, String>{'0': 'PCMU', '8': 'PCMA'};

const int _maxH264 = 2;
const Set<String> _rtcpFbVideo = <String>{'nack', 'nack pli', 'ccm fir'};

final RegExp _reRtpmap = RegExp(r'^a=rtpmap:(\d+) ([^/\s]+)(?:/(\d+))?');
final RegExp _reFmtp = RegExp(r'^a=fmtp:(\d+) (.*)$');
final RegExp _reApt = RegExp(r'\bapt=(\d+)');
final RegExp _rePayload = RegExp(r'^a=(rtpmap|fmtp|rtcp-fb):(\d+)');
final RegExp _reFid = RegExp(r'^a=ssrc-group:FID (\d+) (\d+)');
final RegExp _reSsrc = RegExp(r'^a=ssrc:(\d+) ');
final RegExp _reMid = RegExp(r'^a=mid:(\S+)');
final RegExp _rePm1 = RegExp(r'(^|[;\s])packetization-mode=1(;|$)');

/// Posição do H264 na preferência (menor = melhor).
int _rankH264(String? fmtp) {
  final f = (fmtp ?? '').toLowerCase();
  if (!_rePm1.hasMatch(f)) return 3;
  if (f.contains('profile-level-id=42e01f')) return 0;
  if (f.contains('profile-level-id=42001f')) return 1;
  return 2;
}

({List<String> linhas, String? midRecusado}) _filtrarMidia(List<String> s) {
  final m = s.first.split(' ');
  final tipo = m.first.substring(2);
  final aceitos = _aceitos[tipo];
  if (aceitos == null || m.length < 4) return (linhas: s, midRecusado: null);
  final formatos = m.sublist(3);

  final nome = <String, String>{};
  final clock = <String, String>{};
  final apt = <String, String>{};
  final fmtp = <String, String>{};
  for (final l in s) {
    final r = _reRtpmap.firstMatch(l);
    if (r != null) {
      nome[r.group(1)!] = r.group(2)!.toUpperCase();
      if (r.group(3) != null) clock[r.group(1)!] = r.group(3)!;
    }
    final f = _reFmtp.firstMatch(l);
    if (f != null) {
      fmtp[f.group(1)!] = f.group(2)!;
      final a = _reApt.firstMatch(f.group(2)!);
      if (a != null) apt[f.group(1)!] = a.group(1)!;
    }
  }
  String? nomeDe(String pt) => nome[pt] ?? _estaticos[pt];

  var candidatos = formatos.where((pt) => aceitos.contains(nomeDe(pt))).toList();
  if (tipo == 'audio') {
    candidatos = candidatos.where((pt) => nomeDe(pt) != 'TELEPHONE-EVENT' || clock[pt] == '8000').toList();
  } else if (tipo == 'video') {
    final ordem = List<int>.generate(candidatos.length, (i) => i)
      ..sort((a, b) {
        final c = _rankH264(fmtp[candidatos[a]]).compareTo(_rankH264(fmtp[candidatos[b]]));
        return c != 0 ? c : a.compareTo(b);
      });
    candidatos = <String>[for (final i in ordem.take(_maxH264)) candidatos[i]];
  }
  final manter = candidatos.toSet();
  final rtxTodos = formatos.where((pt) => nomeDe(pt) == 'RTX').toList();
  final rtxMantidos = rtxTodos.where((pt) => manter.contains(apt[pt])).toList();
  manter.addAll(rtxMantidos);

  final List<String> cabecalho;
  var soRtpmap = false;
  if (manter.isNotEmpty) {
    cabecalho = <String>[...m.sublist(0, 3), ...formatos.where(manter.contains)];
  } else {
    // Nada aceito: recusa a mídia (porta 0). O m= precisa de ao menos um
    // formato, e o pjmedia exige o rtpmap dele.
    manter.add(formatos.first);
    soRtpmap = true;
    cabecalho = <String>[m[0], '0', m[2], formatos.first];
  }

  // SSRCs de rtx que ficaram órfãos (sem payload rtx mantido): somem o
  // ssrc-group FID e as linhas a=ssrc deles.
  final ssrcRtxOrfaos = <String>{};
  if (rtxTodos.isNotEmpty && rtxMantidos.isEmpty) {
    for (final l in s) {
      final g = _reFid.firstMatch(l);
      if (g != null) ssrcRtxOrfaos.add(g.group(2)!);
    }
  }

  final out = <String>[cabecalho.join(' ')];
  for (final l in s.skip(1)) {
    final x = _rePayload.firstMatch(l);
    if (x != null && (!manter.contains(x.group(2)) || (soRtpmap && x.group(1) != 'rtpmap'))) continue;
    if (x != null &&
        x.group(1) == 'rtcp-fb' &&
        tipo == 'video' &&
        !_rtcpFbVideo.contains(l.substring(l.indexOf(' ') + 1))) {
      continue;
    }
    if (ssrcRtxOrfaos.isNotEmpty) {
      if (l.startsWith('a=ssrc-group:FID ')) continue;
      final a = _reSsrc.firstMatch(l);
      if (a != null && ssrcRtxOrfaos.contains(a.group(1))) continue;
    }
    out.add(l);
  }
  String? mid;
  if (soRtpmap) {
    for (final l in s) {
      final r = _reMid.firstMatch(l);
      if (r != null) {
        mid = r.group(1);
        break;
      }
    }
  }
  return (linhas: out, midRecusado: mid);
}
