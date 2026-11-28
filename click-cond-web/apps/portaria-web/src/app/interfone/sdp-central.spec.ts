import { filtrarSdpParaCentral } from './sdp-central';
import { OFERTA_CHROME, OFERTA_VIDEO_SEM_H264 } from './sdp-central.fixture';

const secao = (sdp: string, tipo: string): string[] => {
  const linhas = sdp.split('\r\n');
  const ini = linhas.findIndex((l) => l.startsWith('m=' + tipo));
  if (ini < 0) return [];
  const fim = linhas.findIndex((l, i) => i > ini && (l.startsWith('m=') || l === ''));
  return linhas.slice(ini, fim < 0 ? undefined : fim);
};
const pts = (linhaM: string) => linhaM.split(' ').slice(3);
const comPayload = (linhas: string[]) =>
  [...new Set(linhas.map((l) => /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/.exec(l)?.[1]).filter(Boolean))];

describe('filtrarSdpParaCentral (o Asterisk 20.6 recusa a oferta cheia do Chrome)', () => {
  const saida = filtrarSdpParaCentral(OFERTA_CHROME);

  it('áudio fica só com PCMU, PCMA e telephone-event, na ordem original', () => {
    const a = secao(saida, 'audio');
    expect(a[0]).toBe('m=audio 9 UDP/TLS/RTP/SAVPF 0 8 110 126');
    expect(comPayload(a).sort()).toEqual(['0', '110', '126', '8']);
    expect(a).not.toContain('a=rtpmap:111 opus/48000/2');
    expect(a).not.toContain('a=fmtp:111 minptime=10;useinbandfec=1');
    expect(a).not.toContain('a=rtcp-fb:111 transport-cc');
    expect(a).not.toContain('a=fmtp:63 111/111');
  });

  it('vídeo fica só com os H264 e os rtx que apontam para eles', () => {
    const v = secao(saida, 'video');
    expect(pts(v[0])).toEqual(['102', '103', '104', '105']);
    expect(comPayload(v).sort()).toEqual(['102', '103', '104', '105']);
    expect(v).toContain('a=fmtp:103 apt=102');
    expect(v).toContain('a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f');
    expect(v).toContain('a=rtcp-fb:102 nack pli');
    expect(v.some((l) => /VP8|VP9|AV1|H265|red\/|ulpfec/.test(l))).toBe(false);
  });

  it('linhas que não são de payload ficam intactas nas mídias', () => {
    expect(secao(saida, 'audio')).toEqual(
      expect.arrayContaining([
        'a=mid:0',
        'a=sendrecv',
        'a=rtcp-mux',
        'a=ssrc:1111 cname:xyz',
        'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
        'c=IN IP4 0.0.0.0',
      ]),
    );
    expect(secao(saida, 'video')).toEqual(expect.arrayContaining(['a=mid:1', 'a=recvonly', 'a=rtcp-rsize']));
  });

  it('sessão e m=application ficam iguais', () => {
    expect(saida.startsWith(OFERTA_CHROME.slice(0, OFERTA_CHROME.indexOf('m=audio')))).toBe(true);
    expect(secao(saida, 'application')).toEqual(secao(OFERTA_CHROME, 'application'));
  });

  it('preserva CRLF (nenhum \\r ou \\n solto) e o CRLF final', () => {
    expect(saida.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(saida.endsWith('\r\n')).toBe(true);
  });

  it('é idempotente', () => {
    expect(filtrarSdpParaCentral(saida)).toBe(saida);
  });

  it('vídeo sem nenhum codec aceito: m=video vai para a porta 0 (recusado) com um payload só', () => {
    const s = filtrarSdpParaCentral(OFERTA_VIDEO_SEM_H264);
    const v = secao(s, 'video');
    expect(v[0]).toBe('m=video 0 UDP/TLS/RTP/SAVPF 96');
    expect(v).toContain('a=rtpmap:96 VP8/90000'); // o pjmedia exige rtpmap do payload dinâmico listado
    expect(v.some((l) => /^a=(rtcp-fb|fmtp):96/.test(l) || /^a=\w+(-\w+)?:97/.test(l))).toBe(false);
    expect(secao(s, 'audio')[0]).toBe('m=audio 9 UDP/TLS/RTP/SAVPF 0');
  });

  it('texto sem m= volta igual', () => {
    expect(filtrarSdpParaCentral('v=0\r\ns=-\r\n')).toBe('v=0\r\ns=-\r\n');
  });
});
