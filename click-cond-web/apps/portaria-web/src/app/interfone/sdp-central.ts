/**
 * Enxuga a oferta SDP local antes de ela ir para a central.
 *
 * O Asterisk 20.6 do Ubuntu (pjproject) responde "400 Bad Request" à oferta cheia do Chrome: estoura o limite
 * de atributos por mídia (PJ_ETOOMANY) e, com a lista cortada, acusa "Missing SDP rtpmap for dynamic payload
 * type". A central só usa PCMU/PCMA/telephone-event no áudio e H264 no vídeo, então a oferta sai só com eles
 * (mais os rtx cujo apt é um H264 mantido). Confirmado de ponta a ponta em produção.
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

export function filtrarSdpParaCentral(sdp: string): string {
  const quebra = sdp.includes('\r\n') ? '\r\n' : '\n';
  const linhas = sdp.split(quebra);
  const secoes: string[][] = [[]];
  for (const l of linhas) {
    if (l.startsWith('m=')) secoes.push([l]);
    else secoes[secoes.length - 1].push(l);
  }
  const saida: string[] = [...secoes[0]];
  for (const s of secoes.slice(1)) saida.push(...filtrarMidia(s));
  return saida.join(quebra);
}

function filtrarMidia(s: string[]): string[] {
  const m = s[0].split(' ');
  const aceitos = ACEITOS[m[0].slice(2)];
  if (!aceitos || m.length < 4) return s;
  const formatos = m.slice(3);

  const nome: Record<string, string> = {};
  const apt: Record<string, string> = {};
  for (const l of s) {
    let x = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(l);
    if (x) nome[x[1]] = x[2].toUpperCase();
    x = /^a=fmtp:(\d+) .*\bapt=(\d+)/.exec(l);
    if (x) apt[x[1]] = x[2];
  }
  const nomeDe = (pt: string) => nome[pt] ?? ESTATICOS[pt];

  const manter = new Set(formatos.filter((pt) => aceitos.includes(nomeDe(pt))));
  for (const pt of formatos) if (nomeDe(pt) === 'RTX' && manter.has(apt[pt])) manter.add(pt);

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

  const out = [cabecalho.join(' ')];
  for (const l of s.slice(1)) {
    const x = /^a=(rtpmap|fmtp|rtcp-fb):(\d+)/.exec(l);
    if (x && (!manter.has(x[2]) || (soRtpmap && x[1] !== 'rtpmap'))) continue;
    out.push(l);
  }
  return out;
}
