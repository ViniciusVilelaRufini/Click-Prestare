import { SipVoz, hostDaUri } from './sip-voz';
import { DADOS_ENTRADA } from './interfone.testing';
import { OFERTA_CHROME } from './sdp-central.fixture';
import { filtrarSdpParaCentral } from './sdp-central';

const uaConfig: any[] = [];
const chamadas: { uri: string; opcoes: any }[] = [];
let sessaoFalsa: any;
let conectarSocket = true;

jest.mock('jssip', () => {
  class WebSocketInterface {
    constructor(public url: string) {}
  }
  class UA {
    private handlers: Record<string, (() => void)[]> = {};
    constructor(cfg: any) {
      uaConfig.push(cfg);
    }
    on(ev: string, cb: () => void) {
      (this.handlers[ev] ??= []).push(cb);
    }
    start() {
      if (conectarSocket) this.handlers['connected']?.forEach((cb) => cb());
    }
    stop = jest.fn();
    call(uri: string, opcoes: any) {
      chamadas.push({ uri, opcoes });
      return sessaoFalsa;
    }
  }
  return { UA, WebSocketInterface };
});

describe('SipVoz (JsSIP)', () => {
  beforeEach(() => {
    uaConfig.length = 0;
    chamadas.length = 0;
    conectarSocket = true;
    sessaoFalsa = {
      connection: null,
      isEnded: jest.fn(() => false),
      terminate: jest.fn(),
      mute: jest.fn(),
      unmute: jest.fn(),
    };
  });

  it('entra sem registro, com o token no cabeçalho, ICE da API, áudio local e vídeo só de recebimento', async () => {
    await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    expect(uaConfig[0]).toMatchObject({ register: false, uri: 'sip:portaria@voz.prestarecondominios.com.br' });
    expect(uaConfig[0].sockets[0].url).toBe(DADOS_ENTRADA.wss);
    expect(chamadas[0].uri).toBe('sip:entrar@voz.prestarecondominios.com.br');
    expect(chamadas[0].opcoes).toMatchObject({
      extraHeaders: ['X-Prestare-Token: tok-voz'],
      pcConfig: { iceServers: DADOS_ENTRADA.ice },
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: true },
    });
  });

  it('estados: confirmed → em_chamada; ended → encerrada com o fim avisado', async () => {
    const s = await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    const estados: string[] = [];
    const fim = jest.fn();
    s.aoEstado((e) => estados.push(e));
    s.aoEncerrar(fim);
    const h = chamadas[0].opcoes.eventHandlers;
    h.confirmed();
    expect(s.estado).toBe('em_chamada');
    h.ended({ cause: 'BYE' });
    expect(estados).toEqual(['em_chamada', 'encerrada']);
    expect(fim).toHaveBeenCalledWith({ atendida: true, causa: 'BYE' });
  });

  it('falha antes de atender (microfone negado) chega no aoEncerrar mesmo registrado depois', async () => {
    const s = await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    chamadas[0].opcoes.eventHandlers.failed({ cause: 'User Denied Media Access' });
    const fim = jest.fn();
    s.aoEncerrar(fim);
    expect(fim).toHaveBeenCalledWith({ atendida: false, causa: 'User Denied Media Access' });
  });

  it('mudo e encerrar vão para a sessão', async () => {
    const s = await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    s.mudo(true);
    expect(sessaoFalsa.mute).toHaveBeenCalledWith({ audio: true });
    s.mudo(false);
    expect(sessaoFalsa.unmute).toHaveBeenCalledWith({ audio: true });
    s.encerrar();
    expect(sessaoFalsa.terminate).toHaveBeenCalled();
    expect(s.estado).toBe('encerrada');
  });

  it('central não conecta: rejeita', async () => {
    jest.useFakeTimers();
    try {
      conectarSocket = false;
      const p = new SipVoz().entrar(DADOS_ENTRADA, null, null);
      const verificacao = expect(p).rejects.toThrow('sem_conexao_central');
      await jest.advanceTimersByTimeAsync(10_000);
      await verificacao;
      expect(chamadas).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('um só ouvinte de track por conexão (o JsSIP 3.13.9 emite peerconnection dentro do call)', async () => {
    const pc = { addEventListener: jest.fn() };
    sessaoFalsa.connection = pc;
    await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    chamadas[0].opcoes.eventHandlers.peerconnection({ peerconnection: pc });
    expect(pc.addEventListener).toHaveBeenCalledTimes(1);
    expect(pc.addEventListener).toHaveBeenCalledWith('track', expect.any(Function));
  });

  it('a oferta local sai filtrada para a central; o SDP remoto não é mexido', async () => {
    await new SipVoz().entrar(DADOS_ENTRADA, null, null);
    const h = chamadas[0].opcoes.eventHandlers;
    const local = { originator: 'local', type: 'offer', sdp: OFERTA_CHROME };
    h.sdp(local);
    expect(local.sdp).toBe(filtrarSdpParaCentral(OFERTA_CHROME));
    expect(local.sdp).not.toContain('VP8');
    const remoto = { originator: 'remote', type: 'answer', sdp: OFERTA_CHROME };
    h.sdp(remoto);
    expect(remoto.sdp).toBe(OFERTA_CHROME);
  });

  it('hostDaUri', () => {
    expect(hostDaUri('sip:entrar@voz.prestarecondominios.com.br')).toBe('voz.prestarecondominios.com.br');
    expect(hostDaUri('sip:entrar@voz.exemplo.com:5060;transport=ws')).toBe('voz.exemplo.com');
  });
});
