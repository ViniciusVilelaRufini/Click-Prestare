'use strict';

/**
 * agent/src/drivers/linear/sessao.js — UMA conexão TCP com um Módulo
 * Guarita (modo servidor do Guarita, porta principal 9000).
 *
 *   - Autorização: se houver palavra, envia os bytes dela (sem terminador)
 *     logo após conectar e espera `Autorizado\0` em até 5 s. `Negado\0` vira
 *     erro claro e uma espera mínima de 60 s antes de tentar de novo.
 *   - Comandos serializados: um por vez, na ordem pedida. Leitura
 *     progressiva (17, 70) segura a vez até terminar: o Guarita espera um
 *     único byte 0x00 entre frames, e qualquer outro frame no meio seria
 *     lido por ele como esse byte.
 *   - Frame que chega sem ter sido pedido (evento automático, dispositivo
 *     não cadastrado...) sai no evento 'espontaneo' e não atrapalha a
 *     resposta que estava sendo esperada.
 *   - UM ponto só escreve no socket (`_enviarAoSocket`), e ele só deixa
 *     passar: frame da lista branca (`ehFramePermitido`, a segunda trava
 *     além de `montar`), o byte 0x00 de continuação dentro de leitura
 *     progressiva, ou a palavra de autorização VALIDADA (1 a 15 caracteres
 *     0x20..0x7E, uma vez, na fase de autorização). Palavra fora disso não
 *     conecta: com bytes de controle ela poderia formar um frame (ex.:
 *     "\x00MU\xAAL" (bytes 00 4D 55 AA 4C) = comando 77, formatar) num Guarita sem autorização.
 *   - O protocolo não tem identificador de transação: uma resposta só é
 *     aceita se chegou DEPOIS da escrita da pergunta dela (um "crédito" por
 *     pergunta / byte de continuação escrito). Qualquer anomalia — pergunta
 *     sem resposta no prazo, resposta que ninguém pediu, frame a mais numa
 *     leitura progressiva, leitura progressiva que termina antes da hora —
 *     DERRUBA a sessão ('queda'): só uma conexão nova garante que nenhuma
 *     resposta velha vai confirmar a pergunta seguinte.
 *
 * Eventos: 'conectado', 'queda' (Error), 'espontaneo' ({comando, dados,
 * bruto}), 'lixo' (Buffer), 'descartado' (frame que ninguém esperava).
 *
 * Construído pela documentação do protocolo, NÃO validado em aparelho.
 */

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { montar, ehFramePermitido } = require('./codec');
const { ESPONTANEOS } = require('./tabelas');
const { LeitorDeFluxo } = require('./fluxo');

const PORTA_PADRAO = 9000;
const TIMEOUT_CONEXAO_MS = 5000;
const TIMEOUT_AUTORIZACAO_MS = 5000;
const TIMEOUT_COMANDO_MS = 5000;
const ESPERA_APOS_NEGADO_MS = 60000;
const CONTINUAR = Buffer.from([0x00]);
const PROGRESSIVOS = new Set([17, 70]);

const MSG_NEGADO = 'Palavra de autorização recusada pelo Guarita';
const MSG_PALAVRA_INVALIDA = 'Palavra de autorização inválida no cadastro';

/** 1 a 15 caracteres, todos ASCII imprimível 0x20..0x7E. */
function palavraValida(p) {
  if (typeof p !== 'string' || p.length < 1 || p.length > 15) return false;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** Mesma regra sobre os bytes que vão ao socket. */
function bytesDePalavraValidos(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1 || buf.length > 15) return false;
  for (const b of buf) if (b < 0x20 || b > 0x7e) return false;
  return true;
}
const MSG_SEM_RESPOSTA = 'O Guarita não respondeu.';
const MSG_QUEDA = 'A conexão com o Guarita caiu.';

function erro(mensagem, codigo, extra = {}) {
  const e = new Error(mensagem);
  e.codigo = codigo;
  Object.assign(e, extra);
  return e;
}

const temporizadorReal = {
  agora: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

class SessaoGuarita extends EventEmitter {
  constructor({ ip, porta, palavra, abrirSocket, agora, temporizador, logger } = {}) {
    super();
    if (!ip) throw new Error('SessaoGuarita requer ip');
    this.ip = ip;
    this.porta = Number(porta) > 0 ? Number(porta) : PORTA_PADRAO;
    // Sem palavra (null/undefined/''): autorização desligada. Qualquer outra
    // coisa tem de passar em palavraValida, senão conectar() recusa.
    this._semPalavra = palavra === null || palavra === undefined || palavra === '';
    this._palavra = this._semPalavra ? null : palavra;
    this._palavraEnviada = false;
    this._abrirSocket = abrirSocket || ((o) => net.connect({ host: o.host, port: o.port }));
    this._t = temporizador || temporizadorReal;
    this._agora = agora || this._t.agora || (() => Date.now());
    this._log = logger || console;
    this._socket = null;
    this._fase = 'fechada'; // fechada | conectando | autorizacao | frames
    this.conectado = false;
    this.esperaMinimaAte = 0;
    this._fechadoPorNos = false;
    this._espera = null;
    this._emProgressivo = false;
    this._ocupadaPor = 0;
    this._cauda = Promise.resolve();
    this._bufAuth = Buffer.alloc(0);
    this._aoAutorizar = null;
    this._aoConectarSocket = null;
    this._ultimoErroSocket = null;
    this._indicioAutorizacao = null;
    this._descartada = false;
    this._leitor = new LeitorDeFluxo({
      aoFrame: (f) => this._aoFrame(f),
      aoLixo: (l) => this._aoLixo(l),
    });
  }

  // ---------- conexão e autorização ----------

  conectar() {
    if (this._socket) return Promise.reject(new Error('sessão já aberta'));
    if (!this._semPalavra && !palavraValida(this._palavra)) {
      // Nunca repete a palavra na mensagem.
      return Promise.reject(erro(MSG_PALAVRA_INVALIDA, 'palavra_invalida', { statusCode: 401 }));
    }
    this._fechadoPorNos = false;
    this._fase = 'conectando';
    return new Promise((resolve, reject) => {
      let sock;
      try {
        sock = this._abrirSocket({ host: this.ip, port: this.porta });
      } catch (e) {
        this._fase = 'fechada';
        reject(e);
        return;
      }
      this._socket = sock;
      sock.on('data', (d) => this._aoDados(d));
      sock.on('error', (e) => this._aoErroSocket(e));
      sock.on('close', () => this._aoFecharSocket());
      if (typeof sock.setNoDelay === 'function') sock.setNoDelay(true);

      const timer = this._t.setTimeout(() => {
        falhar(erro(`Sem resposta do Guarita em ${this.ip}:${this.porta} (timeout ao conectar)`, 'ETIMEDOUT', { code: 'ETIMEDOUT' }));
      }, TIMEOUT_CONEXAO_MS);
      const falhar = (e) => {
        this._t.clearTimeout(timer);
        this._aoConectarSocket = null;
        this._aoAutorizar = null;
        this._destruir();
        this._socket = null;
        this._fase = 'fechada';
        this.conectado = false;
        reject(e);
      };
      this._aoConectarSocket = { falhar };
      sock.once('connect', () => {
        this._t.clearTimeout(timer);
        this._aoConectarSocket = null;
        this._autorizar().then(
          () => {
            this._fase = 'frames';
            this.conectado = true;
            // O que veio colado no fim da autorização já é fluxo de frames.
            const sobra = this._bufAuth;
            this._bufAuth = Buffer.alloc(0);
            if (sobra.length) this._leitor.alimentar(sobra);
            resolve();
            this.emit('conectado');
          },
          (e) => falhar(e),
        );
      });
    });
  }

  _autorizar() {
    if (!this._palavra) return Promise.resolve();
    this._fase = 'autorizacao';
    return new Promise((resolve, reject) => {
      const timer = this._t.setTimeout(() => {
        this._aoAutorizar = null;
        reject(erro('O Guarita não respondeu à palavra de autorização em 5 s.', 'ETIMEDOUT', { code: 'ETIMEDOUT' }));
      }, TIMEOUT_AUTORIZACAO_MS);
      this._aoAutorizar = (texto, e) => {
        this._t.clearTimeout(timer);
        this._aoAutorizar = null;
        if (e) return reject(e);
        if (texto === 'Autorizado') return resolve();
        if (texto === 'Negado') {
          this.esperaMinimaAte = this._agora() + ESPERA_APOS_NEGADO_MS;
          return reject(erro(MSG_NEGADO, 'negado', { esperaMinimaMs: ESPERA_APOS_NEGADO_MS, statusCode: 401 }));
        }
        if (texto === 'Timeout') {
          return reject(erro('O Guarita encerrou a conexão esperando a palavra de autorização.', 'timeout_autorizacao'));
        }
        return reject(erro('Resposta inesperada do Guarita na autorização.', 'protocolo_inesperado'));
      };
      this._enviarAoSocket(Buffer.from(this._palavra, 'latin1'), 'palavra').catch((e) => {
        if (this._aoAutorizar) this._aoAutorizar(null, e);
      });
    });
  }

  _aoDados(chunk) {
    if (this._fase === 'autorizacao') {
      this._bufAuth = Buffer.concat([this._bufAuth, chunk]);
      const fim = this._bufAuth.indexOf(0x00);
      if (fim === -1) {
        if (this._bufAuth.length > 32 && this._aoAutorizar) {
          this._aoAutorizar(null, erro('Resposta inesperada do Guarita na autorização.', 'protocolo_inesperado'));
        }
        return;
      }
      const texto = this._bufAuth.subarray(0, fim).toString('latin1');
      this._bufAuth = this._bufAuth.subarray(fim + 1);
      if (this._aoAutorizar) this._aoAutorizar(texto);
      return;
    }
    if (this._fase === 'frames') this._leitor.alimentar(chunk);
  }

  _aoErroSocket(e) {
    this._ultimoErroSocket = e;
    if (this._aoConectarSocket) this._aoConectarSocket.falhar(e);
  }

  _aoFecharSocket() {
    const eraFase = this._fase;
    this._socket = null;
    this._fase = 'fechada';
    this.conectado = false;
    if (this._aoConectarSocket) {
      this._aoConectarSocket.falhar(this._ultimoErroSocket || erro(MSG_QUEDA, 'queda'));
      return;
    }
    if (this._aoAutorizar) {
      this._aoAutorizar(null, erro('O Guarita fechou a conexão durante a autorização.', 'queda'));
      return;
    }
    if (this._fechadoPorNos) return;
    const motivo = this._indicioAutorizacao
      ? `${MSG_QUEDA} ${this._indicioAutorizacao}`
      : this._ultimoErroSocket
        ? `${MSG_QUEDA} (${this._ultimoErroSocket.message})`
        : MSG_QUEDA;
    const e = erro(motivo, 'queda', { code: this._ultimoErroSocket && this._ultimoErroSocket.code });
    this._falharEspera(e);
    if (eraFase === 'frames') this.emit('queda', e);
  }

  _destruir() {
    const s = this._socket;
    if (s) {
      try {
        s.destroy();
      } catch {
        /* já fechado */
      }
    }
  }

  /**
   * Anomalia: derruba a sessão e emite 'queda' na hora (antes de qualquer
   * outro comando sair), para quem usa reconectar numa sessão limpa.
   */
  _derrubar(motivo) {
    if (this._descartada || this._fechadoPorNos) return;
    this._descartada = true;
    const estavaAberta = this._fase === 'frames';
    this.conectado = false;
    this._fechadoPorNos = true; // o 'close' do socket não emite outra queda
    const e = erro(`Sessão com o Guarita descartada (${motivo}); reconectando.`, 'queda', { descartada: true });
    this._falharEspera(e);
    this._destruir();
    this._socket = null;
    this._fase = 'fechada';
    if (estavaAberta) this._emitirSeguro('queda', e);
  }

  /** Fecha a conexão de propósito (não emite 'queda'). */
  fechar() {
    this._fechadoPorNos = true;
    this.conectado = false;
    this._falharEspera(erro('Sessão com o Guarita encerrada.', 'fechada'));
    this._destruir();
    this._socket = null;
    this._fase = 'fechada';
  }

  // ---------- frames recebidos ----------

  _aoFrame(frame) {
    const espera = this._espera;
    if (espera && !espera.fechada && espera.aceita(frame)) {
      if (espera.creditos <= 0) {
        // Chegou antes de a pergunta (ou o 0x00) correspondente ter sido escrita.
        this._emitirSeguro('descartado', frame);
        this._derrubar(`frame do comando ${frame.comando} chegou sem pergunta`);
        return;
      }
      espera.creditos--;
      espera.fila.push(frame);
      espera.acordar();
      return;
    }
    if (ESPONTANEOS.includes(frame.comando)) {
      this._emitirSeguro('espontaneo', { comando: frame.comando, dados: frame.dados, bruto: frame.bruto });
      return;
    }
    // Resposta que ninguém está esperando (atrasada, duplicada, de diálogo que
    // já fechou): não dá para saber a que pergunta pertence.
    this._emitirSeguro('descartado', frame);
    this._derrubar(`resposta inesperada do comando ${frame.comando}`);
  }

  _aoLixo(lixo) {
    const texto = lixo.toString('latin1');
    // Sem palavra configurada e o Guarita pedindo uma: ele manda "Timeout\0"
    // e fecha. Guarda a pista para a mensagem da queda.
    if (/Timeout|Negado/.test(texto)) {
      this._indicioAutorizacao = 'O Guarita pede palavra de autorização (confira a palavra no cadastro).';
    }
    this._emitirSeguro('lixo', lixo);
  }

  _emitirSeguro(evento, dado) {
    try {
      this.emit(evento, dado);
    } catch (e) {
      this._log.error(`[guarita] erro ao tratar '${evento}': ${(e && e.message) || e}`);
    }
  }

  _abrirEspera(aceita, comando) {
    const espera = {
      aceita,
      comando,
      creditos: 0,
      fila: [],
      fechada: false,
      erro: null,
      acordar: () => {},
    };
    this._espera = espera;
    return espera;
  }

  _fecharEspera(espera) {
    espera.fechada = true;
    if (this._espera === espera) this._espera = null;
  }

  _falharEspera(e) {
    const espera = this._espera;
    if (!espera) return;
    espera.erro = e;
    espera.acordar();
  }

  /** Próximo frame aceito pela espera, ou erro (timeout / queda). */
  _proximoFrame(espera, timeoutMs) {
    if (espera.fila.length > 0) return Promise.resolve(espera.fila.shift());
    if (espera.erro) return Promise.reject(espera.erro);
    return new Promise((resolve, reject) => {
      const timer = this._t.setTimeout(() => {
        // Antes de desistir: sobra presa no leitor pode estar escondendo a
        // resposta (início de frame falso dentro de lixo).
        if (this._leitor.pendentes > 0) this._leitor.destravar();
        if (espera.fila.length > 0) {
          espera.acordar = () => {};
          resolve(espera.fila.shift());
          return;
        }
        espera.acordar = () => {};
        // Pode haver resposta órfã a caminho: esta sessão não serve mais.
        this._derrubar(`sem resposta do comando ${espera.comando} em ${timeoutMs} ms`);
        reject(erro(MSG_SEM_RESPOSTA, 'sem_resposta', { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      espera.acordar = () => {
        if (espera.fila.length > 0) {
          this._t.clearTimeout(timer);
          espera.acordar = () => {};
          resolve(espera.fila.shift());
        } else if (espera.erro) {
          this._t.clearTimeout(timer);
          espera.acordar = () => {};
          reject(espera.erro);
        }
      };
    });
  }

  // ---------- escrita ----------

  /**
   * ÚNICO ponto que escreve no socket. `natureza`:
   *   'frame'        — só frame da lista branca (ehFramePermitido);
   *   'continuacao'  — só o byte 0x00, dentro de leitura progressiva;
   *   'palavra'      — só na fase de autorização, uma vez, 1..15 bytes 0x20..0x7E.
   * Qualquer outra coisa é recusada sem escrever.
   */
  _enviarAoSocket(buf, natureza) {
    let permitido = false;
    if (natureza === 'frame') {
      permitido = ehFramePermitido(buf) && this.conectado;
    } else if (natureza === 'continuacao') {
      permitido = Buffer.isBuffer(buf) && buf.length === 1 && buf[0] === 0x00 && this._emProgressivo && this.conectado;
    } else if (natureza === 'palavra') {
      permitido =
        this._fase === 'autorizacao' && !this._palavraEnviada && palavraValida(this._palavra) && bytesDePalavraValidos(buf);
    }
    if (!permitido) {
      return Promise.reject(new Error('Guarita: escrita bloqueada (fora da lista branca do driver)'));
    }
    const s = this._socket;
    if (!s || s.destroyed) return Promise.reject(erro(MSG_QUEDA, 'queda'));
    if (natureza === 'palavra') this._palavraEnviada = true;
    return new Promise((resolve, reject) => {
      s.write(buf, (e) => (e ? reject(e) : resolve()));
    });
  }

  /** Frame da lista branca ou o 0x00 de continuação (depois da autorização). */
  _escrever(buf) {
    if (!this.conectado) return Promise.reject(erro('Guarita não conectado.', 'desconectado'));
    const continuacao = Buffer.isBuffer(buf) && buf.length === 1 && buf[0] === 0x00;
    return this._enviarAoSocket(buf, continuacao ? 'continuacao' : 'frame');
  }

  /** Escreve e, logo depois da chamada ao socket, libera UMA resposta para a espera. */
  _escreverComCredito(buf, espera) {
    const escrita = this._escrever(buf);
    espera.creditos++;
    return escrita;
  }

  // ---------- fila serial ----------

  /** Espera a vez. `prazoNaFilaMs`: desiste (sem escrever nada) se a vez não chegar a tempo. */
  _adquirir(prazoNaFilaMs) {
    const anterior = this._cauda;
    let liberar;
    const fim = new Promise((r) => {
      liberar = r;
    });
    this._cauda = fim;
    return new Promise((resolve, reject) => {
      let cancelado = false;
      let timer = null;
      if (Number.isFinite(prazoNaFilaMs)) {
        timer = this._t.setTimeout(() => {
          cancelado = true;
          reject(erro('O Guarita está ocupado com outra operação; tente de novo em instantes.', 'ocupado'));
        }, prazoNaFilaMs);
      }
      anterior.then(() => {
        if (timer) this._t.clearTimeout(timer);
        if (cancelado) {
          liberar();
          return;
        }
        resolve(liberar);
      });
    });
  }

  /** Livre agora (nada em execução nem na fila)? */
  get ocupada() {
    return this._ocupadaPor > 0;
  }

  /**
   * Envia um comando da lista branca e devolve os DADOS da resposta (bytes
   * entre o comando e o cs). `semResposta` (13, 43): resolve depois da
   * escrita. `prazoNaFilaMs`: desiste sem escrever se outra operação
   * segurar a vez por mais que isso.
   */
  async comando(numero, params, { timeoutMs = TIMEOUT_COMANDO_MS, semResposta = false, prazoNaFilaMs } = {}) {
    if (PROGRESSIVOS.has(numero)) throw new Error('use lerProgressivo para os comandos 17 e 70');
    const frame = montar(numero, params); // lança para comando proibido, antes de qualquer espera
    const liberar = await this._adquirir(prazoNaFilaMs);
    this._ocupadaPor++;
    let espera = null;
    try {
      if (!this.conectado || this._descartada) throw erro('Guarita não conectado.', 'desconectado');
      if (semResposta) {
        await this._escrever(frame);
        return Buffer.alloc(0);
      }
      const opcao = numero === 67 ? frame[2] : undefined;
      espera = this._abrirEspera((f) => f.comando === numero && (opcao === undefined || f.dados[0] === opcao), numero);
      await this._escreverComCredito(frame, espera);
      const resposta = await this._proximoFrame(espera, timeoutMs);
      return resposta.dados;
    } finally {
      if (espera) this._fecharEspera(espera);
      this._ocupadaPor--;
      liberar();
    }
  }

  /**
   * Leitura progressiva (17 eventos, 70 dispositivos): manda a pergunta,
   * entrega cada frame (dados), pede o próximo com um único byte 0x00 até
   * completar `quantidade` e fecha com o 43 — também em erro, timeout ou
   * quando quem consome para antes. Frame que não chega no prazo lança.
   */
  async *lerProgressivo(numero, params, quantidade, { timeoutPorFrameMs = TIMEOUT_COMANDO_MS } = {}) {
    if (!PROGRESSIVOS.has(numero)) throw new Error('lerProgressivo só para os comandos 17 e 70');
    if (!Number.isInteger(quantidade) || quantidade < 0) throw new Error('quantidade inválida');
    const frame = montar(numero, params);
    if (quantidade === 0) return;
    const liberar = await this._adquirir();
    this._ocupadaPor++;
    let espera = null;
    let perguntou = false;
    let completo = false;
    try {
      if (!this.conectado || this._descartada) throw erro('Guarita não conectado.', 'desconectado');
      espera = this._abrirEspera((f) => f.comando === numero, numero);
      this._emProgressivo = true;
      await this._escreverComCredito(frame, espera);
      perguntou = true;
      for (let i = 0; i < quantidade; i++) {
        const f = await this._proximoFrame(espera, timeoutPorFrameMs);
        if (i < quantidade - 1) await this._escreverComCredito(CONTINUAR, espera);
        else completo = true;
        yield f.dados;
      }
    } finally {
      this._emProgressivo = false;
      if (espera) this._fecharEspera(espera);
      if (perguntou && this.conectado) {
        if (completo) {
          // Fim normal (como o demo do fabricante): 43 depois do ÚLTIMO frame.
          try {
            await this._escrever(montar(43));
          } catch {
            /* conexão caiu: o Guarita abandona o diálogo sozinho */
          }
        } else {
          // Terminou antes da hora (erro, marcador FF, quem consome parou):
          // não manda 43 no meio do diálogo — o 0x00 dele seria lido como
          // continuação. Derruba a sessão.
          this._derrubar('leitura progressiva terminou antes do fim');
        }
      }
      this._ocupadaPor--;
      liberar();
    }
  }
}

module.exports = {
  SessaoGuarita,
  PORTA_PADRAO,
  TIMEOUT_COMANDO_MS,
  TIMEOUT_AUTORIZACAO_MS,
  ESPERA_APOS_NEGADO_MS,
  MSG_NEGADO,
  MSG_PALAVRA_INVALIDA,
  palavraValida,
  MSG_SEM_RESPOSTA,
  MSG_QUEDA,
};
