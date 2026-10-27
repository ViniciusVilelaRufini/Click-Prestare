'use strict';

/**
 * agent/src/core/liveview-acesso.js — quem pode usar o preview ao vivo local
 * (127.0.0.1:8788/liveview e /snapshot). Antes: ACAO "*" e nenhum Host
 * checado — qualquer site lia o quadro da câmera da portaria.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { avaliarAcessoLiveView, origensLiveView } = require('../src/core/liveview-acesso');

const ORIGENS = origensLiveView({});
const PORTA = 8788;

test('Host diferente de 127.0.0.1/localhost:porta é recusado (DNS rebinding)', () => {
  for (const host of ['evil.example:8788', '127.0.0.1:9999', 'localhost', '', undefined]) {
    assert.deepEqual(avaliarAcessoLiveView({ host }, PORTA, ORIGENS), { permitido: false, origem: null }, String(host));
  }
});

test('origem fora da lista é recusada e não recebe ACAO', () => {
  for (const origin of ['https://evil.example', 'null', 'http://localhost:8788']) {
    assert.deepEqual(
      avaliarAcessoLiveView({ host: '127.0.0.1:8788', origin }, PORTA, ORIGENS),
      { permitido: false, origem: null },
      origin,
    );
  }
});

test('portaria-web recebe ACAO com a própria origem (nunca "*")', () => {
  assert.deepEqual(
    avaliarAcessoLiveView({ host: 'localhost:8788', origin: 'https://www.prestarecondominios.com.br' }, PORTA, ORIGENS),
    { permitido: true, origem: 'https://www.prestarecondominios.com.br' },
  );
});

test('<img> (sem Origin) no Host certo passa, sem ACAO', () => {
  assert.deepEqual(avaliarAcessoLiveView({ host: 'localhost:8788' }, PORTA, ORIGENS), { permitido: true, origem: null });
});

test('LIVEVIEW_ORIGINS acrescenta origens à lista', () => {
  const origens = origensLiveView({ LIVEVIEW_ORIGINS: 'https://portaria.exemplo.com, http://localhost:4300' });
  assert.ok(origens.includes('https://portaria.exemplo.com'));
  assert.ok(origens.includes('http://localhost:4300'));
  assert.ok(origens.includes('https://www.prestarecondominios.com.br'));
});

test('index.js não manda mais Access-Control-Allow-Origin "*" e usa avaliarAcessoLiveView', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.doesNotMatch(fonte, /Access-Control-Allow-Origin',\s*'\*'/);
  assert.match(fonte, /avaliarAcessoLiveView\(req\.headers, LIVEVIEW_PORT, origensPreview\)/);
});
