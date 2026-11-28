// Adaptador fino sobre o ari-client: o serviço só conhece ids de canal (string)
// e estas operações, o que deixa os testes com um ARI falso trivial.
import ariClient from 'ari-client';

export const APP_STASIS = 'prestare';

export async function conectarAri({ url, usuario, senha, log = console, esperaMs = 5000 }) {
  for (;;) {
    try {
      return await ariClient.connect(url, usuario, senha);
    } catch (e) {
      log.warn(`[ari] sem conexão (${e.message}); nova tentativa em ${esperaMs / 1000} s`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}

export function adaptarAri(client, { timeoutTocarMs = 20_000 } = {}) {
  const finais = new Map(); // playbackId -> resolve

  client.on('PlaybackFinished', (_ev, playback) => {
    const fim = finais.get(playback?.id);
    if (fim) fim();
  });

  return {
    aoIniciar(fn) {
      client.on('StasisStart', (ev, canal) => fn({ canal: canal.id, args: ev.args ?? [] }));
    },
    aoFim(fn) {
      client.on('StasisEnd', (_ev, canal) => fn({ canal: canal.id }));
      client.on('ChannelDestroyed', (_ev, canal) => fn({ canal: canal.id }));
    },
    ring: (canal) => client.channels.ring({ channelId: canal }),
    answer: (canal) => client.channels.answer({ channelId: canal }),
    hangup: (canal, motivo = 'normal') => client.channels.hangup({ channelId: canal, reason: motivo }),

    /** Toca no canal e resolve quando termina (ou no prazo). */
    tocar(canal, media) {
      const playback = client.Playback();
      return new Promise((resolve, reject) => {
        const acabar = () => { clearTimeout(t); finais.delete(playback.id); resolve(); };
        const t = setTimeout(acabar, timeoutTocarMs);
        finais.set(playback.id, acabar);
        client.channels.play({ channelId: canal, media, playbackId: playback.id }).catch((e) => {
          clearTimeout(t);
          finais.delete(playback.id);
          reject(e);
        });
      });
    },

    async criarPonte() {
      // proxy_media: sem ponte nativa entre o WebRTC (DTLS-SRTP/ICE) e o RTP puro do facial.
      const ponte = await client.bridges.create({ type: 'mixing,proxy_media' });
      return ponte.id;
    },
    adicionarNaPonte: (ponte, canais) => client.bridges.addChannel({ bridgeId: ponte, channel: canais.join(',') }),
    definirVideo: (ponte, canal) => client.bridges.setVideoSource({ bridgeId: ponte, channelId: canal }),
    tocarNaPonte: (ponte, media) => client.bridges.play({ bridgeId: ponte, media }),
    destruirPonte: (ponte) => client.bridges.destroy({ bridgeId: ponte }),

    originar: ({ endpoint, appArgs, timeoutS, canal, callerId = 'Interfone' }) =>
      client.channels.originate({
        endpoint, app: APP_STASIS, appArgs, timeout: timeoutS, channelId: canal, callerId,
      }),

    enviarDtmf: (canal, digitos) =>
      client.channels.sendDTMF({ channelId: canal, dtmf: digitos, duration: 160, between: 120 }),

    async endpointsPjsip() {
      const lista = await client.endpoints.listByTech({ tech: 'PJSIP' });
      return lista.map((e) => ({ conta: e.resource, estado: e.state }));
    },

    recarregarPjsip: () => client.asterisk.reloadModule({ moduleName: 'res_pjsip.so' }),

    /** Ids de todos os canais que existem agora no Asterisk. */
    async canaisExistentes() {
      const lista = await client.channels.list();
      return new Set(lista.map((c) => c.id));
    },

    /** Canais parados no nosso Stasis (sobras de um reinício do serviço). */
    async canaisNoStasis() {
      const lista = await client.channels.list();
      return lista
        .filter((c) => c.dialplan?.app_name === 'Stasis' && String(c.dialplan?.app_data ?? '').startsWith(APP_STASIS))
        .map((c) => c.id);
    },
  };
}
