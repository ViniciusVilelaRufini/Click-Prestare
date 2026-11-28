/**
 * Enxuga a oferta SDP local antes de ela ir para a central.
 *
 * O Asterisk 20.6 do Ubuntu (pjproject) responde "400 Bad Request" à oferta cheia do Chrome: estoura o limite
 * de atributos por mídia (PJ_ETOOMANY) e, com a lista cortada, acusa "Missing SDP rtpmap for dynamic payload
 * type". A central só usa PCMU/PCMA/telephone-event no áudio e H264 no vídeo, então a oferta sai só com eles
 * (mais os rtx cujo apt é um H264 mantido). Confirmado de ponta a ponta em produção.
 *
 * Limites extras (o Chrome chega a oferecer 4-6 perfis H264, e cada um traz fmtp/rtcp-fb/rtx): no vídeo ficam no
 * máximo 2 payloads H264 (packetization-mode=1 com profile-level-id 42e01f, depois 42001f, depois qualquer
 * packetization-mode=1, depois o primeiro H264) e só os rtx deles; a=rtcp-fb só nack, nack pli e ccm fir; no áudio
 * só o telephone-event de clock 8000. Sem rtx mantido, somem também a=ssrc-group:FID e a=ssrc do SSRC rtx. Mídia
 * recusada (porta 0) sai do a=group:BUNDLE.
 *
 * Regras: linhas de sessão e mídias que não são áudio/vídeo (m=application) ficam iguais; nas mídias filtradas
 * somem os payloads removidos do m= e as linhas a=rtpmap/a=fmtp/a=rtcp-fb deles; o resto fica. Se nenhum
 * codec aceito sobrar, a mídia vai para a porta 0 (recusada) com um payload só e o rtpmap dele.
 * O separador de linha (CRLF) é preservado.
 */
const ACEITOS: Record<string, string[]> = {
  audio: ['PCMU', 'PCMA', 'TELEPHONE-EVENT'],
  video: ['H264'],
};
/** Payloads estáticos que podem vir sem a=rtpmap (RFC 3551). */
const ESTATICOS: Record<string, string> = { '0': 'PCMU', '8': 'PCMA' };
const MAX_H264 = 2;
const RTCP_FB_VIDEO = new Set(['nack', 'nack pli', 'ccm fir']);

export function filtrarSdpParaCentral(sdp: string): string {
  const quebra = sdp.includes('\r\n') ? '\r\n' : '\n';
  const linhas = sdp.split(quebra);
  const secoes: string[][] = [[]];
  for (const l of linhas) {
    if (l.startsWith('m=')) secoes.push([l]);
    else secoes[secoes.length - 1].push(l);
  }
  let sessao = secoes[0];
  const saida: string[] = [];
  const recusados: string[] = [];
  for (const s of secoes.slice(1)) {
    const r = filtrarMidia(s);
    saida.push(...r.linhas);
    if (r.midRecusado) recusados.push(r.midRecusado);
  }
  if (recusados.length) {
    sessao = sessao.map((l) => {
      if (!l.startsWith('a=group:BUNDLE')) return l;
      const [grupo, ...mids] = l.split(' ');
      return [grupo, ...mids.filter((m) => !recusados.includes(m))].join(' ');
    });
  }
  return [...sessao, ...saida].join(quebra);
}

/** Posição do H264 na preferência (menor = melhor). */
function rankH264(fmtp: string | undefined): number {
  const f = (fmtp ?? '').toLowerCase();
  const pm1 = /(^|[;\s])packetization-mode=1(;|$)/.test(f);
  if (!pm1) return 3;
  if (/profile-level-id=42e01f/.test(f)) return 0;
  if (/profile-level-id=42001f/.test(f)) return 1;
  return 2;
}

function filtrarMidia(s: string[]): { linhas: string[]; midRecusado?: string } {
  const m = s[0].split(' ');
  const tipo = m[0].slice(2);
  const aceitos = ACEITOS[tipo];
  if (!aceitos || m.length < 4) return { linhas: s };
  const formatos = m.slice(3);

  const nome: Record<string, string> = {};
  const clock: Record<string, string> = {};
  const apt: Record<string, string> = {};
  const fmtp: Record<string, string> = {};
  for (const l of s) {
    let x = /^a=rtpmap:(\d+) ([^/\s]+)(?:\/(\d+))?/.exec(l);
    if (x) {
      nome[x[1]] = x[2].toUpperCase();
      if (x[3]) clock[x[1]] = x[3];
    }
    x = /^a=fmtp:(\d+) (.*)$/.exec(l);
    if (x) {
      fmtp[x[1]] = x[2];
      const a = /\bapt=(\d+)/.exec(x[2]);
      if (a) apt[x[1]] = a[1];
    }
  }
  const nomeDe = (pt: string) => nome[pt] ?? ESTATICOS[pt];

  let candidatos = formatos.filter((pt) => aceitos.includes(nomeDe(pt)));
  if (tipo === 'audio') {
    candidatos = candidatos.filter((pt) => nomeDe(pt) !== 'TELEPHONE-EVENT' || clock[pt] === '8000');
  } else if (tipo === 'video') {
    candidatos = candidatos
      .map((pt, i) => ({ pt, i, r: rankH264(fmtp[pt]) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, MAX_H264)
      .map((c) => c.pt);
  }
  const manter = new Set(candidatos);
  const rtxTodos = formatos.filter((pt) => nomeDe(pt) === 'RTX');
  const rtxMantidos = rtxTodos.filter((pt) => manter.has(apt[pt]));
  for (const pt of rtxMantidos) manter.add(pt);

  let cabecalho: string[];
  let soRtpmap = false;
  if (manter.size > 0) {
    cabecalho = [...m.slice(0, 3), ...formatos.filter((pt) => manter.has(pt))];
  } else {
    // Nada aceito: recusa a mídia (porta 0). O m= precisa de ao menos um formato, e o pjmedia exige o rtpmap dele.
    manter.add(formatos[0]);
    soRtpmap = true;
    cabecalho = [m[0], '0', m[2], formatos[0]];
  }

  // SSRCs de rtx que ficaram órfãos (sem payload rtx mantido): somem o ssrc-group FID e as linhas a=ssrc deles.
  const ssrcRtxOrfaos = new Set<string>();
  if (rtxTodos.length > 0 && rtxMantidos.length === 0) {
    for (const l of s) {
      const g = /^a=ssrc-group:FID (\d+) (\d+)/.exec(l);
      if (g) ssrcRtxOrfaos.add(g[2]);
    }
  }

  const out = [cabecalho.join(' ')];
  for (const l of s.slice(1)) {
    const x = /^a=(rtpmap|fmtp|rtcp-fb):(\d+)/.exec(l);
    if (x && (!manter.has(x[2]) || (soRtpmap && x[1] !== 'rtpmap'))) continue;
    if (x && x[1] === 'rtcp-fb' && tipo === 'video' && !RTCP_FB_VIDEO.has(l.slice(l.indexOf(' ') + 1))) continue;
    if (ssrcRtxOrfaos.size > 0) {
      if (/^a=ssrc-group:FID /.test(l)) continue;
      const a = /^a=ssrc:(\d+) /.exec(l);
      if (a && ssrcRtxOrfaos.has(a[1])) continue;
    }
    out.push(l);
  }
  if (soRtpmap) {
    const mid = s.map((l) => /^a=mid:(\S+)/.exec(l)?.[1]).find(Boolean);
    return { linhas: out, midRecusado: mid };
  }
  return { linhas: out };
}
