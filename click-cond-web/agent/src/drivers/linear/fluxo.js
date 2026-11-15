'use strict';

/**
 * agent/src/drivers/linear/fluxo.js — separa o fluxo TCP do Módulo Guarita
 * em frames.
 *
 * O TCP não respeita fronteira de frame: meio frame pode chegar num pacote,
 * dois frames colados noutro, e o Guarita pode mandar um evento automático
 * (comando 4, 40, 33...) entre dois frames de uma leitura progressiva. Não
 * há campo de tamanho no protocolo: o tamanho decorre do byte de comando
 * (ver `delimitarFrame` no codec) e o checksum confirma o frame. O que não
 * fecha (checksum errado, byte de comando desconhecido, lixo antes do 0x00
 * inicial) é descartado byte a byte em `aoLixo` até o fluxo voltar a
 * alinhar — inclusive o 0x00 solto que a autorização pode deixar para trás.
 */

const { checksum, delimitarFrame } = require('./codec');

// Teto do que fica acumulado esperando completar um frame (o maior frame
// que o driver aceita é o pacote 33, 1075 bytes; o 58 com template grande
// também cabe). Passou disso sem fechar frame: o começo é lixo.
const MAX_BUFFER = 4096;

class LeitorDeFluxo {
  constructor({ aoFrame, aoLixo } = {}) {
    if (typeof aoFrame !== 'function') throw new Error('LeitorDeFluxo requer aoFrame(frame)');
    this._aoFrame = aoFrame;
    this._aoLixo = typeof aoLixo === 'function' ? aoLixo : () => {};
    this._buf = Buffer.alloc(0);
    this._dica = null;
    this._lixoPendente = [];
  }

  /**
   * Informa o tamanho total da próxima resposta de um comando cujo tamanho
   * é variável (`{ comando, tamanho }`); `null` limpa. Os tamanhos fixos já
   * são conhecidos pela tabela e não precisam disto.
   */
  esperar(ctx) {
    this._dica = ctx && Number.isInteger(ctx.comando) && Number.isInteger(ctx.tamanho) ? ctx : null;
  }

  alimentar(chunk) {
    if (!chunk || chunk.length === 0) return;
    this._buf = this._buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this._buf, chunk]);
    this._processar();
  }

  _descartar(n) {
    const lixo = this._buf.subarray(0, n);
    this._buf = this._buf.subarray(n);
    this._lixoPendente.push(lixo);
  }

  /**
   * O fluxo parou com sobra que não fecha frame (ex.: um 0x00 + byte de
   * comando falsos dentro de lixo, esperando bytes que nunca vêm): descarta
   * a sobra byte a byte, entregando qualquer frame completo que estiver
   * atrás dela. Quem chama decide quando (a sessão chama no timeout de uma
   * resposta, antes de desistir).
   */
  destravar() {
    while (this._buf.length > 0) {
      this._descartar(1);
      this._processar();
    }
  }

  /** Bytes guardados esperando completar um frame. */
  get pendentes() {
    return this._buf.length;
  }

  _processar() {
    try {
      while (this._buf.length > 0) {
        if (this._buf[0] !== 0x00) {
          // Lixo antes do início de frame: descarta até o próximo 0x00.
          const i = this._buf.indexOf(0x00);
          this._descartar(i === -1 ? this._buf.length : i);
          continue;
        }
        const r = delimitarFrame(this._buf, this._dica);
        if (r.estado === 'incompleto') {
          if (this._buf.length > MAX_BUFFER) {
            this._descartar(1);
            continue;
          }
          break;
        }
        if (r.estado === 'desconhecido') {
          this._descartar(1);
          continue;
        }
        const candidato = this._buf.subarray(0, r.tamanho);
        if (checksum(candidato.subarray(0, r.tamanho - 1)) !== candidato[r.tamanho - 1]) {
          // Checksum não fecha: não é frame. Anda um byte e tenta realinhar.
          this._descartar(1);
          continue;
        }
        const bruto = Buffer.from(candidato);
        this._buf = this._buf.subarray(r.tamanho);
        if (this._dica && this._dica.comando === bruto[1]) this._dica = null;
        this._emitirLixo();
        this._aoFrame({ comando: bruto[1], dados: bruto.subarray(2, bruto.length - 1), bruto });
      }
    } finally {
      this._emitirLixo();
      // Guarda só o que sobrou (sem reter o buffer grande de onde saiu).
      this._buf = Buffer.from(this._buf);
    }
  }

  _emitirLixo() {
    if (this._lixoPendente && this._lixoPendente.length > 0) {
      const lixo = Buffer.concat(this._lixoPendente);
      this._lixoPendente = [];
      this._aoLixo(lixo);
    }
  }
}

module.exports = { LeitorDeFluxo, MAX_BUFFER };
