import { Injectable } from '@angular/core';
import type { DadosEntrada } from './interfone.api';
import { filtrarSdpParaCentral } from './sdp-central';

export type EstadoSessao = 'conectando' | 'em_chamada' | 'encerrada';

export interface FimSessao {
  /** A outra ponta chegou a atender (a sessão ficou `em_chamada`). */
  atendida: boolean;
  /** Causa do JsSIP quando a sessão falhou (ex.: 'User Denied Media Access', 'Canceled'). */
  causa?: string;
}

/** Uma chamada em andamento. Os callbacks chegam fora de evento do Angular: quem ouve grava em signal. */
export interface SessaoVoz {
  readonly estado: EstadoSessao;
  encerrar(): void;
  mudo(ligado: boolean): void;
  aoEstado(cb: (e: EstadoSessao) => void): void;
  aoEncerrar(cb: (fim: FimSessao) => void): void;
}

/** Causa do JsSIP quando o navegador nega o microfone (a sessão termina com ela). */
export const CAUSA_MICROFONE = 'User Denied Media Access';
const ESPERA_SOCKET_MS = 10_000;

/**
 * Cliente SIP do console (JsSIP sobre WSS). O console nunca fica registrado na central: ao atender ou ligar, a API
 * devolve `DadosEntrada` e o console disca `d.sip_uri` com o token curto no cabeçalho `X-Prestare-Token`.
 * Áudio nos dois sentidos; vídeo só de recebimento (o facial não mostra o porteiro).
 *
 * O JsSIP é carregado sob demanda (chunk próprio): só quem atende uma chamada baixa a biblioteca.
 * Classe injetável para os testes trocarem por um falso (`SipVozFalso` em interfone.testing.ts).
 */
@Injectable({ providedIn: 'root' })
export class SipVoz {
  async entrar(d: DadosEntrada, video: HTMLVideoElement | null, audio: HTMLAudioElement | null): Promise<SessaoVoz> {
    const JsSIP = await import('jssip');
    const host = hostDaUri(d.sip_uri);
    const ua = new JsSIP.UA({
      sockets: [new JsSIP.WebSocketInterface(d.wss)],
      uri: `sip:portaria@${host}`,
      register: false,
      session_timers: false,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sem_conexao_central')), ESPERA_SOCKET_MS);
      ua.on('connected', () => { clearTimeout(t); resolve(); }); // reconexão chama de novo: resolve é idempotente
      ua.start();
    }).catch((e) => {
      ua.stop();
      throw e;
    });

    const ouvintesEstado: ((e: EstadoSessao) => void)[] = [];
    const ouvintesFim: ((f: FimSessao) => void)[] = [];
    let estado: EstadoSessao = 'conectando';
    let atendida = false;
    let fim: FimSessao | null = null;

    const mudar = (e: EstadoSessao) => {
      if (estado === 'encerrada') return;
      estado = e;
      ouvintesEstado.forEach((cb) => cb(e));
    };
    const terminar = (causa?: string) => {
      if (fim) return;
      fim = { atendida, causa };
      mudar('encerrada');
      if (video) video.srcObject = null;
      if (audio) audio.srcObject = null;
      try { ua.stop(); } catch { /* já parado */ }
      ouvintesFim.forEach((cb) => cb(fim!));
    };

    // O JsSIP 3.13.9 emite 'peerconnection' de forma síncrona dentro do call(); a conexão também fica em
    // sessao.connection. Um só ouvinte de 'track' por conexão (dois reatribuiriam o srcObject e abortariam o play).
    const tratadas = new WeakSet<object>();
    const anexarMidia = (pc: RTCPeerConnection | null | undefined) => {
      if (!pc || tratadas.has(pc)) return;
      tratadas.add(pc);
      pc.addEventListener('track', (ev: RTCTrackEvent) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        if (ev.track.kind === 'video' && video) {
          video.muted = true; // o som sai pelo <audio>
          video.srcObject = stream;
          void video.play?.()?.catch(() => undefined);
        }
        if (ev.track.kind === 'audio' && audio) {
          audio.srcObject = stream;
          void audio.play?.()?.catch(() => undefined);
        }
      });
    };

    const sessao = ua.call(d.sip_uri, {
      extraHeaders: ['X-Prestare-Token: ' + d.token],
      pcConfig: { iceServers: d.ice },
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: true },
      eventHandlers: {
        peerconnection: (e: { peerconnection: RTCPeerConnection }) => anexarMidia(e.peerconnection),
        // O JsSIP emite 'sdp' antes de enviar e usa o e.sdp que sobrar: a central recusa a oferta cheia do Chrome.
        sdp: (e: { originator: string; sdp: string }) => {
          if (e.originator === 'local') e.sdp = filtrarSdpParaCentral(e.sdp);
        },
        confirmed: () => { atendida = true; mudar('em_chamada'); },
        ended: (e: { cause?: string }) => terminar(e?.cause),
        failed: (e: { cause?: string }) => terminar(e?.cause),
      },
    } as any);
    // Se o 'peerconnection' já tiver passado sem chegar aqui, a conexão está em sessao.connection (o WeakSet evita dobrar).
    anexarMidia(sessao.connection as unknown as RTCPeerConnection | null);


    return {
      get estado() { return estado; },
      encerrar: () => {
        try { if (!sessao.isEnded()) sessao.terminate(); } catch { /* já encerrada */ }
        terminar('Terminated');
      },
      mudo: (ligado: boolean) => {
        try { if (ligado) sessao.mute({ audio: true }); else sessao.unmute({ audio: true }); } catch { /* sem sessão */ }
      },
      aoEstado: (cb) => { ouvintesEstado.push(cb); },
      aoEncerrar: (cb) => {
        if (fim) cb(fim);
        else ouvintesFim.push(cb);
      },
    };
  }
}

/** 'sip:entrar@voz.prestarecondominios.com.br' → 'voz.prestarecondominios.com.br'. */
export function hostDaUri(uri: string): string {
  const semEsquema = uri.replace(/^sips?:/i, '');
  const host = semEsquema.includes('@') ? semEsquema.split('@')[1] : semEsquema;
  return host.split(/[;:>]/)[0] || 'voz.prestarecondominios.com.br';
}
