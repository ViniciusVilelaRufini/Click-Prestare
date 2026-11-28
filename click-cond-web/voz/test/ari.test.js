import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptarAri } from '../src/ari.js';

function clienteFalso() {
  const chamadas = [];
  const registrar = (nome, ret) => async (arg) => { chamadas.push([nome, arg]); return ret; };
  return {
    chamadas,
    on() {},
    Playback: () => ({ id: 'pb1' }),
    bridges: {
      create: registrar('bridges.create', { id: 'b1' }),
      addChannel: registrar('bridges.addChannel'),
      setVideoSource: registrar('bridges.setVideoSource'),
      play: registrar('bridges.play'),
      destroy: registrar('bridges.destroy'),
    },
    channels: {
      list: registrar('channels.list', [{ id: 'a', dialplan: { app_name: 'Stasis', app_data: 'prestare,facial' } }, { id: 'b', dialplan: { app_name: 'Wait' } }]),
    },
  };
}

test('ponte é mixing,proxy_media e o vídeo vem do canal pedido', async () => {
  const c = clienteFalso();
  const ari = adaptarAri(c);
  assert.equal(await ari.criarPonte(), 'b1');
  await ari.adicionarNaPonte('b1', ['x', 'y']);
  await ari.definirVideo('b1', 'x');
  assert.deepEqual(c.chamadas, [
    ['bridges.create', { type: 'mixing,proxy_media' }],
    ['bridges.addChannel', { bridgeId: 'b1', channel: 'x,y' }],
    ['bridges.setVideoSource', { bridgeId: 'b1', channelId: 'x' }],
  ]);
});

test('canaisExistentes e canaisNoStasis', async () => {
  const ari = adaptarAri(clienteFalso());
  assert.deepEqual([...await ari.canaisExistentes()], ['a', 'b']);
  assert.deepEqual(await ari.canaisNoStasis(), ['a']);
});
