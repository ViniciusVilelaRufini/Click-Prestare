'use strict';

/**
 * agent/src/core/log-rotativo.js — ao iniciar, se agent-service.log passou de
 * 5 MB, renomeia para agent-service.1.log (sobrescrevendo o anterior).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { rotacionarLogSeGrande, LIMITE_BYTES } = require('../src/core/log-rotativo');

function comDirTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-agent-log-rotativo-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('log ainda não existe: não faz nada (nem lança)', () => {
  comDirTemp((dir) => {
    assert.doesNotThrow(() => rotacionarLogSeGrande({ diretorio: () => dir }));
    assert.equal(fs.existsSync(path.join(dir, 'agent-service.log')), false);
    assert.equal(fs.existsSync(path.join(dir, 'agent-service.1.log')), false);
  });
});

test('log menor que o limite: não rotaciona', () => {
  comDirTemp((dir) => {
    const caminho = path.join(dir, 'agent-service.log');
    fs.writeFileSync(caminho, 'linha pequena\n');
    rotacionarLogSeGrande({ diretorio: () => dir });
    assert.equal(fs.existsSync(caminho), true);
    assert.equal(fs.existsSync(path.join(dir, 'agent-service.1.log')), false);
  });
});

test('log maior que o limite: renomeia para agent-service.1.log', () => {
  comDirTemp((dir) => {
    const caminho = path.join(dir, 'agent-service.log');
    fs.writeFileSync(caminho, Buffer.alloc(LIMITE_BYTES + 1, 'x'));
    rotacionarLogSeGrande({ diretorio: () => dir });
    assert.equal(fs.existsSync(caminho), false);
    const rotacionado = path.join(dir, 'agent-service.1.log');
    assert.equal(fs.existsSync(rotacionado), true);
    assert.equal(fs.statSync(rotacionado).size, LIMITE_BYTES + 1);
  });
});

test('log maior que o limite E agent-service.1.log já existe: sobrescreve o anterior', () => {
  comDirTemp((dir) => {
    const caminho = path.join(dir, 'agent-service.log');
    const rotacionado = path.join(dir, 'agent-service.1.log');
    fs.writeFileSync(rotacionado, 'conteúdo antigo da geração anterior');
    fs.writeFileSync(caminho, Buffer.alloc(LIMITE_BYTES + 1, 'y'));

    rotacionarLogSeGrande({ diretorio: () => dir });

    assert.equal(fs.existsSync(caminho), false);
    const conteudo = fs.readFileSync(rotacionado);
    assert.equal(conteudo.length, LIMITE_BYTES + 1);
    assert.equal(conteudo[0], 'y'.charCodeAt(0)); // é o log novo, não o "conteúdo antigo"
  });
});

test('limiteBytes injetável (não precisa de 5 MB de verdade pra testar o limite)', () => {
  comDirTemp((dir) => {
    const caminho = path.join(dir, 'agent-service.log');
    fs.writeFileSync(caminho, Buffer.alloc(101, 'z'));
    rotacionarLogSeGrande({ diretorio: () => dir, limiteBytes: 100 });
    assert.equal(fs.existsSync(caminho), false);
    assert.equal(fs.existsSync(path.join(dir, 'agent-service.1.log')), true);
  });
});

test('falha ao renomear: loga o erro em vez de lançar', () => {
  comDirTemp((dir) => {
    const caminho = path.join(dir, 'agent-service.log');
    fs.writeFileSync(caminho, Buffer.alloc(LIMITE_BYTES + 1, 'x'));
    const erros = [];
    const logFalso = { error: (msg) => erros.push(msg) };
    // Diretório inexistente como destino do rename força a falha sem
    // precisar mockar `fs` — `renomear` não é injetável neste módulo (só a
    // pasta), então simulamos via um nomeRotacionado com subpasta ausente.
    assert.doesNotThrow(() =>
      rotacionarLogSeGrande({
        diretorio: () => dir,
        nomeRotacionado: path.join('subpasta-inexistente', 'agent-service.1.log'),
        log: logFalso,
      }),
    );
    assert.equal(erros.length, 1);
    assert.match(erros[0], /falha ao rotacionar/);
  });
});
