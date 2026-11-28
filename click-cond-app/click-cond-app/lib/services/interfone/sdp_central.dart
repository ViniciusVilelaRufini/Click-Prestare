/// Enxuga a oferta SDP local antes de ela ir para a central.
///
/// O Asterisk 20.6 do Ubuntu (pjproject) responde "400 Bad Request" à oferta
/// cheia do libwebrtc: estoura o limite de atributos por mídia (PJ_ETOOMANY)
/// e, com a lista cortada, acusa "Missing SDP rtpmap for dynamic payload
/// type". A central só usa PCMU/PCMA/telephone-event no áudio e H264 no vídeo,
/// então a oferta sai só com eles (mais os rtx cujo apt é um H264 mantido).
/// Mesma regra do console (portaria-web, `sdp-central.ts`).
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
  return <String>[
    ...secoes.first,
    for (final s in secoes.skip(1)) ..._filtrarMidia(s),
  ].join(quebra);
}

const Map<String, List<String>> _aceitos = <String, List<String>>{
  'audio': <String>['PCMU', 'PCMA', 'TELEPHONE-EVENT'],
  'video': <String>['H264'],
};

/// Payloads estáticos que podem vir sem a=rtpmap (RFC 3551).
const Map<String, String> _estaticos = <String, String>{'0': 'PCMU', '8': 'PCMA'};

final RegExp _reRtpmap = RegExp(r'^a=rtpmap:(\d+) ([^/\s]+)');
final RegExp _reApt = RegExp(r'^a=fmtp:(\d+) .*\bapt=(\d+)');
final RegExp _rePayload = RegExp(r'^a=(rtpmap|fmtp|rtcp-fb):(\d+)');

List<String> _filtrarMidia(List<String> s) {
  final m = s.first.split(' ');
  final aceitos = _aceitos[m.first.substring(2)];
  if (aceitos == null || m.length < 4) return s;
  final formatos = m.sublist(3);

  final nome = <String, String>{};
  final apt = <String, String>{};
  for (final l in s) {
    final r = _reRtpmap.firstMatch(l);
    if (r != null) nome[r.group(1)!] = r.group(2)!.toUpperCase();
    final a = _reApt.firstMatch(l);
    if (a != null) apt[a.group(1)!] = a.group(2)!;
  }
  String? nomeDe(String pt) => nome[pt] ?? _estaticos[pt];

  final manter = formatos.where((pt) => aceitos.contains(nomeDe(pt))).toSet();
  for (final pt in formatos) {
    if (nomeDe(pt) == 'RTX' && manter.contains(apt[pt])) manter.add(pt);
  }

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

  final out = <String>[cabecalho.join(' ')];
  for (final l in s.skip(1)) {
    final x = _rePayload.firstMatch(l);
    if (x != null && (!manter.contains(x.group(2)) || (soRtpmap && x.group(1) != 'rtpmap'))) continue;
    out.add(l);
  }
  return out;
}
