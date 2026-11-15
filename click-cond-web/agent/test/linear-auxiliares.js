'use strict';

/**
 * Auxiliares dos testes do Módulo Guarita (não é arquivo de teste: o
 * `npm test` só roda `test/*.test.js`). Relógio falso para timers longos
 * (5 s, 30 s, 60 s, 180 s) sem dormir de verdade, e socket falso para a
 * sessão.
 */
const { EventEmitter } = require('node:events');

/** Deixa rodar microtarefas e I/O pendente (sem avançar o relógio falso). */
async function girar(vezes = 5) {
  for (let i = 0; i < vezes; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Relógio falso: `agora()`, `setTimeout`, `clearTimeout`, `setInterval`,
 * `clearInterval`. `avancar(ms)` dispara, em ordem, todo timer que vencer
 * no intervalo, deixando o resto do processo (promises, sockets reais)
 * rodar entre um disparo e outro.
 */
function criarRelogioFalso(inicioMs = Date.UTC(2026, 10, 15, 15, 0, 0)) {
  let agora = inicioMs;
  let seq = 0;
  const timers = new Map();
  const relogio = {
    agora: () => agora,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { quando: agora + Math.max(0, Number(ms) || 0), fn, id, intervalo: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = ++seq;
      const passo = Math.max(1, Number(ms) || 1);
      timers.set(id, { quando: agora + passo, fn, id, intervalo: passo });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    pendentes: () => timers.size,
    async avancar(ms) {
      const alvo = agora + ms;
      await girar();
      for (;;) {
        let proximo = null;
        for (const t of timers.values()) {
          if (t.quando <= alvo && (!proximo || t.quando < proximo.quando || (t.quando === proximo.quando && t.id < proximo.id))) {
            proximo = t;
          }
        }
        if (!proximo) break;
        agora = proximo.quando;
        if (proximo.intervalo) proximo.quando += proximo.intervalo;
        else timers.delete(proximo.id);
        proximo.fn();
        await girar();
      }
      agora = alvo;
      await girar();
    },
  };
  return relogio;
}

/** Socket falso: guarda o que foi escrito; o teste emite 'connect'/'data'/'close'. */
class SocketFalso extends EventEmitter {
  constructor() {
    super();
    this.escritos = [];
    this.destroyed = false;
  }
  write(buf, cb) {
    this.escritos.push(Buffer.from(buf));
    if (cb) setImmediate(() => cb());
    return true;
  }
  setNoDelay() {}
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    setImmediate(() => this.emit('close'));
  }
  /** O "Guarita" manda bytes (hex com espaços aceito). */
  receber(hexOuBuf) {
    const b = Buffer.isBuffer(hexOuBuf) ? hexOuBuf : Buffer.from(String(hexOuBuf).replace(/\s+/g, ''), 'hex');
    this.emit('data', b);
  }
  escritosHex() {
    return this.escritos.map((b) => b.toString('hex').toUpperCase());
  }
}

/** Espera (com tempo REAL curto) até a condição valer. Para sockets reais. */
async function esperarAte(cond, { limiteMs = 3000, rotulo = 'condição' } = {}) {
  const inicio = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - inicio > limiteMs) throw new Error(`tempo esgotado esperando ${rotulo}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const logMudo = { log: () => {}, error: () => {}, warn: () => {} };

module.exports = { criarRelogioFalso, SocketFalso, esperarAte, girar, logMudo };
