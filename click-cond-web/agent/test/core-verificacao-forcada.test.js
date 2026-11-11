'use strict';

/**
 * agent/src/core/verificacao-forcada.js — "Atualizar agora": a flag
 * `verificar_atualizacao` do poll vira UMA verificação de atualização, sem
 * bloquear o laço, sem empilhar por cima de uma verificação em curso e com
 * intervalo mínimo entre verificações forçadas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  criarVerificacaoForcada,
  INTERVALO_MINIMO_FORCADA_MS,
} = require('../src/core/verificacao-forcada');
const { criarAtualizador } = require('../src/core/atualizador');

function montar({ emAndamento = () => false, verificar } = {}) {
  let relogio = 1_000_000;
  const chamadas = [];
  const erros = [];
  const forcada = criarVerificacaoForcada({
    verificar:
      verificar ||
      (async (token) => {
        chamadas.push(token);
      }),
    emAndamento,
    agora: () => relogio,
    log: { log: () => {}, error: (m) => erros.push(m) },
  });
  return { forcada, chamadas, erros, avancar: (ms) => (relogio += ms) };
}

test('intervalo mínimo padrão entre verificações forçadas é 60 s', () => {
  assert.equal(INTERVALO_MINIMO_FORCADA_MS, 60000);
});

test('pedir(): dispara a verificação na hora, com o token, e diz que disparou', () => {
  const { forcada, chamadas } = montar();
  assert.equal(forcada.pedir('token-x'), true);
  assert.deepEqual(chamadas, ['token-x'], 'chamou verificar de forma síncrona (imediata)');
});

test('pedir(): flag repetida dentro de 60 s não vira martelada — uma verificação só; depois do intervalo, outra', () => {
  const { forcada, chamadas, avancar } = montar();
  assert.equal(forcada.pedir('t'), true);
  avancar(2000);
  assert.equal(forcada.pedir('t'), false);
  avancar(57999); // 59,999 s desde a primeira
  assert.equal(forcada.pedir('t'), false);
  assert.equal(chamadas.length, 1);
  avancar(1); // 60 s
  assert.equal(forcada.pedir('t'), true);
  assert.equal(chamadas.length, 2);
});

test('pedir(): com verificação em curso não dispara outra — e não gasta o intervalo mínimo', () => {
  let ocupado = true;
  const { forcada, chamadas } = montar({ emAndamento: () => ocupado });
  assert.equal(forcada.pedir('t'), false);
  assert.equal(forcada.pedir('t'), false);
  assert.equal(chamadas.length, 0);
  ocupado = false;
  assert.equal(forcada.pedir('t'), true, 'liberou: o próximo pedido dispara sem esperar 60 s');
  assert.equal(chamadas.length, 1);
});

test('pedir(): não bloqueia o laço — volta na hora mesmo com a verificação pendurada', () => {
  const { forcada } = montar({ verificar: () => new Promise(() => {}) });
  const r = forcada.pedir('t');
  assert.equal(r, true); // valor síncrono, não uma Promise a aguardar
});

test('pedir(): verificação que rejeita ou lança não vira rejeição solta nem exceção no laço', async () => {
  const a = montar({ verificar: async () => Promise.reject(new Error('rede caiu')) });
  assert.doesNotThrow(() => a.forcada.pedir('t'));
  await new Promise((r) => setImmediate(r));
  assert.ok(a.erros.some((m) => m.includes('rede caiu')), JSON.stringify(a.erros));

  const b = montar({
    verificar: () => {
      throw new Error('quebrou síncrono');
    },
  });
  assert.doesNotThrow(() => b.forcada.pedir('t'));
  await new Promise((r) => setImmediate(r));
  assert.ok(b.erros.some((m) => m.includes('quebrou síncrono')), JSON.stringify(b.erros));
});

test('com o atualizador de verdade: flag do poll durante a verificação periódica não gera uma segunda consulta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-agente-forcada-'));
  let consultas = 0;
  let liberar;
  const espera = new Promise((r) => {
    liberar = r;
  });
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => dir,
    caminhoExe: () => path.join(dir, 'click-agent.exe'),
    sair: () => {},
    log: { log: () => {}, error: () => {} },
    buscarVersao: async () => {
      consultas += 1;
      await espera;
      return null;
    },
  });
  const forcada = criarVerificacaoForcada({
    verificar: (t) => at.verificar(t),
    emAndamento: () => at.verificacaoEmAndamento(),
  });
  const periodica = at.verificar('token-x'); // a de 6 h, em curso
  assert.equal(forcada.pedir('token-x'), false);
  liberar();
  await periodica;
  assert.equal(consultas, 1);
  // Terminou: agora o pedido dispara (o intervalo não foi gasto) e roda uma vez.
  assert.equal(forcada.pedir('token-x'), true);
  assert.equal(forcada.pedir('token-x'), false, 'em curso / dentro do intervalo');
  await new Promise((r) => setImmediate(r));
  assert.equal(consultas, 2);
});

test('fora do modo que se atualiza sozinho (não-SEA), o pedido deixa o estado "indisponivel" em vez de sumir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-agente-forcada-'));
  const at = criarAtualizador({
    isSea: () => false,
    diretorio: () => dir,
    caminhoExe: () => path.join(dir, 'click-agent.exe'),
    sair: () => {},
    log: { log: () => {}, error: () => {} },
  });
  const forcada = criarVerificacaoForcada({
    verificar: (t) => at.verificar(t),
    emAndamento: () => at.verificacaoEmAndamento(),
  });
  assert.equal(forcada.pedir('token-x'), true);
  await new Promise((r) => setImmediate(r));
  assert.equal(at.estadoDaAtualizacao().estado, 'indisponivel');
});

test('C1 — com o atualizador de verdade: com a troca feita e o reinício pendente, a flag do poll NÃO dispara outra verificação', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-agente-forcada-'));
  const exe = path.join(dir, 'click-agent.exe');
  fs.writeFileSync(exe, 'binario-atual');
  fs.writeFileSync(path.join(dir, 'run-agent-service.cmd'), '@echo off\n:loop\nclick-agent.exe\ngoto loop\n');
  const conteudo = Buffer.from('binario-novo');
  const sha256 = require('node:crypto').createHash('sha256').update(conteudo).digest('hex');
  let consultas = 0;
  let downloads = 0;
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => dir,
    caminhoExe: () => exe,
    sair: () => {},
    log: { log: () => {}, error: () => {} },
    buscarVersao: async () => {
      consultas += 1;
      return { versao: '9999.01.01', url: 'https://exemplo.invalid/click-agent.exe', sha256 };
    },
    baixar: async (urlStr, destino) => {
      downloads += 1;
      fs.writeFileSync(destino, conteudo);
    },
  });
  const forcada = criarVerificacaoForcada({
    verificar: (t) => at.verificar(t),
    emAndamento: () => at.verificacaoEmAndamento(),
  });
  await at.verificar('token-x'); // a periódica: baixa, troca e fica esperando o laço sair
  assert.equal(at.temReinicioPendente(), true);
  const jsonAntes = fs.readFileSync(path.join(dir, 'atualizacao.json'), 'utf8');

  assert.equal(forcada.pedir('token-x'), false, 'não dispara com reinício pendente');
  await new Promise((r) => setImmediate(r));
  assert.equal(consultas, 1);
  assert.equal(downloads, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'atualizacao.json'), 'utf8'), jsonAntes);
  assert.equal(fs.readFileSync(path.join(dir, 'click-agent.old.exe'), 'utf8'), 'binario-atual');
  assert.equal(at.estadoDaAtualizacao().estado, 'instalando');
});
