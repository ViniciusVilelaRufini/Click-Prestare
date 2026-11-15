'use strict';

/**
 * agent/src/drivers/linear-guarita.js — driver do Módulo Guarita (Nice /
 * Linear-HCS, MG3000) por TCP, família `linear`. Usado SÓ por device com
 * `tipo === 'guarita'` (ver registro.js).
 *
 * Construído pela documentação do protocolo e testado contra o simulador
 * (harness/guarita-simulado.js). NÃO validado em aparelho.
 *
 * O Guarita continua decidindo a abertura do portão: este driver cadastra,
 * lê e aciona relé, nunca está no caminho de uma passagem.
 *
 * Contrato de driver (ver dahua-facial.js):
 *   - `escutar(device, aoEvento, { aoConectar })` mantém UMA conexão TCP por
 *     Guarita (o aparelho não aceita várias), reconecta com espera crescente
 *     (1 → 60 s; 60 s fixos depois de "Negado") e devolve `parar()`. Ao
 *     conectar: identifica (firmware, totais, relógio) e recupera os eventos
 *     da memória. Enquanto conectado: repassa os envios automáticos, busca
 *     as operações da nuvem a cada 5 s e as executa em ordem, dispara o 29
 *     (atualizar receptores) 30 s depois da última gravação e manda o estado
 *     a cada mudança e a cada 60 s. `aoEvento` NÃO é usado: evento do
 *     Guarita vai pela rota própria (só registra; nunca aciona abertura).
 *   - `testar(device)` responde pelo estado da sessão, sem abrir conexão
 *     (o heartbeat roda a cada 5 s; uma conexão por ping derrubaria a
 *     sessão única).
 *   - `executar(device, cmd)` só trata `guarita_rele` (e `ping`).
 *
 * Nuvem (rotas sob /api/facial/agent/condo/:token/guarita/:deviceId/):
 *   GET operacoes, POST operacoes/:id/resultado, POST eventos,
 *   POST nao-cadastrado, POST estado. Rota ausente (API antiga, 404): o
 *   driver registra, guarda o que tiver de mandar e tenta de novo depois.
 *
 * A palavra de autorização (`device.api_password`) nunca vai para log.
 */

const fs = require('node:fs');
const path = require('node:path');
const { SessaoGuarita } = require('./linear/sessao');
const operacoes = require('./linear/operacoes');

// Operações de gravação já concluídas, em disco ao lado do estado do agente:
// sem isso, reiniciar o agente (ou recriar o ouvinte) reexecutava uma
// operação que a nuvem devolve de novo.
const ARQUIVO_OPERACOES = 'guarita-operacoes.json';
const MAX_PERSISTIDAS_POR_DEVICE = 500;

/** Armazém em memória (padrão dos testes e do criarDriverGuarita sem opção). */
function criarArmazemEmMemoria() {
  let dados = {};
  return {
    ler: () => JSON.parse(JSON.stringify(dados)),
    gravar: (o) => {
      dados = JSON.parse(JSON.stringify(o));
    },
  };
}

/** Armazém num arquivo JSON (gravação atômica: .tmp + rename). Nunca lança na leitura. */
function criarArmazemEmArquivo(arquivo) {
  return {
    ler() {
      try {
        const o = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
        return o && typeof o === 'object' ? o : {};
      } catch {
        return {};
      }
    },
    gravar(o) {
      const tmp = `${arquivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(o), 'utf8');
      fs.renameSync(tmp, arquivo);
    },
  };
}

const ID = 'linear-guarita';
const PADROES = Object.freeze({
  cicloMs: 5000, // busca de operações + envio de eventos
  estadoMs: 60000, // estado periódico
  atraso29Ms: 30000, // 29 depois da última gravação do lote
  backoffInicialMs: 1000,
  backoffMaxMs: 60000,
  esperaNegadoMs: 60000,
  esperaRotaAusenteMs: 60000, // API antiga: pergunta de novo em 1 min
  prazoReleMs: 10000, // validade do relé: sem a vez em 10 s (ex.: durante o 29), desiste — não abre atrasado
  quedaLongaMs: 60000, // reconexão depois de queda maior que isto relê a memória de eventos
  esperaConferenciaMs: 30000, // gravação sem resposta: espera reconectar até isto para conferir
  timeoutsParaCalar: 2, // timeouts SEGUIDOS do mesmo comando (em conexões consecutivas) para marcá-lo "sem resposta"
  validadeMudoMs: 600000, // a marca "sem resposta" expira sozinha em 10 min
  esperaPingConectandoMs: 4000, // ping durante a conexão espera o desfecho (prazo do ciclo é 5 s)
  limiteFilaEventos: 5000,
  lotePorEnvio: 500, // eventos por POST e frames por parte da importação
  maxOperacoesPorBusca: 50,
});

const temporizadorReal = {
  agora: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h),
};

const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();

function serialDe(eRf, nibble, b2, b1, b0) {
  const n = (eRf ? (nibble & 0x0f) * 0x1000000 : 0) + (b2 << 16) + (b1 << 8) + b0;
  return n.toString(16).toUpperCase().padStart(eRf ? 7 : 6, '0');
}

/** Corpo do POST nao-cadastrado a partir dos comandos 42, 46 e 90. */
function naoCadastradoDe(comando, d, recebidoEm) {
  if (comando === 42 && d.length === 8) {
    const tipo = d[0];
    const eRf = tipo === 1;
    return {
      comando: 42,
      tipo,
      serial_hex: serialDe(eRf, d[1], d[2], d[3], d[4]),
      contador: eRf ? (d[5] << 8) | d[6] : null,
      receptor: null,
      bateria_fraca: (d[7] & 0x08) !== 0,
      recebido_em: recebidoEm,
    };
  }
  if (comando === 46 && d.length === 7) {
    const tipo = d[0];
    return {
      comando: 46,
      tipo,
      serial_hex: serialDe(tipo === 1, d[2], d[3], d[4], d[5]),
      contador: null, // o 46 só traz o byte baixo do contador: não serve para cadastrar RF
      receptor: d[1] + 1,
      bateria_fraca: false,
      recebido_em: recebidoEm,
    };
  }
  if (comando === 90 && d.length === 10) {
    return {
      comando: 90,
      tipo: 1,
      serial_hex: serialDe(true, d[2], d[3], d[4], d[5]),
      contador: (d[6] << 8) | d[7],
      receptor: d[1] + 1,
      bateria_fraca: d[9] === 0x01,
      recebido_em: recebidoEm,
    };
  }
  return null;
}

/** Frames de evento (16 bytes) dentro de um envio automático 4, 40 ou 33. */
function eventosDoEspontaneo(comando, dados) {
  if (comando === 4 && dados.length === 17) return [dados.subarray(1, 17)];
  if (comando === 40 && dados.length === 19) return [dados.subarray(3, 19)];
  if (comando === 33 && dados.length > 0 && dados.length % 16 === 0) {
    const lista = [];
    for (let i = 0; i < dados.length; i += 16) lista.push(dados.subarray(i, i + 16));
    return lista;
  }
  return [];
}

function partesDaImportacao(frames, tamanho) {
  if (frames.length === 0) return [{ ok: true, frames_hex: [], parte: 1, fim: true }];
  const partes = [];
  for (let i = 0; i < frames.length; i += tamanho) {
    partes.push({ ok: true, frames_hex: frames.slice(i, i + tamanho), parte: partes.length + 1, fim: false });
  }
  partes[partes.length - 1].fim = true;
  return partes;
}

class ServicoGuarita {
  constructor(device, cfg, aoConectar) {
    this.device = device;
    this.cfg = cfg;
    this.t = cfg.temporizador;
    this.iv = cfg.intervalos;
    this.log = cfg.log;
    this._aoConectar = typeof aoConectar === 'function' ? aoConectar : () => {};
    this.rotulo = `[agente] ${device.nome || `Guarita ${device.id}`}`;
    this.parado = false;
    this.sessao = null;
    this.conectado = false;
    this.autorizado = null;
    this.erro = null;
    this.ultimoErroConexao = null;
    this.info = {};
    this.backoffMs = this.iv.backoffInicialMs;
    this.filaEventos = [];
    this.filaNaoCadastrados = [];
    this.executadas = new Map();
    this._carregarConcluidas();
    this.ops29 = [];
    this.precisa29 = false;
    this.ultimaGravacaoEm = null;
    this.timers = { reconexao: null, ciclo: null, estado: null, t29: null };
    this._emCiclo = false;
    this._descarregando = false;
    this._descarregarDeNovo = false;
    this._ultimoEstado = null;
    this._operacoesSoDepoisDe = 0;
    this._conectando = null;
    this._esperandoConexao = [];
    this._rotaAusenteLogada = false;
    this._nuvemForaLogada = false;
    this._descartesLogados = 0;
  }

  // ---------- ciclo de vida ----------

  iniciar() {
    this._agendarEstadoPeriodico();
    void this._conectar();
  }

  parar() {
    if (this.conectado) this._marcarForaDoAr();
    this.parado = true;
    this._avisarConectado();
    for (const k of Object.keys(this.timers)) {
      if (this.timers[k]) this.t.clearTimeout(this.timers[k]);
      this.timers[k] = null;
    }
    const s = this.sessao;
    this.sessao = null;
    this.conectado = false;
    if (s) s.fechar();
  }

  _agendar(nome, ms, fn) {
    if (this.timers[nome]) this.t.clearTimeout(this.timers[nome]);
    this.timers[nome] = this.t.setTimeout(() => {
      this.timers[nome] = null;
      if (!this.parado) fn();
    }, Math.max(0, ms));
  }

  _agendarReconexao(ms) {
    if (this.parado) return;
    this._agendar('reconexao', ms, () => void this._conectar());
  }

  async _conectar() {
    if (this.parado) return;
    const d = this.device;
    const sessao = new SessaoGuarita({
      ip: d.ip,
      porta: d.porta,
      palavra: d.api_password || undefined,
      abrirSocket: this.cfg.abrirSocket,
      temporizador: this.t,
      logger: this.log,
    });
    this.sessao = sessao;
    sessao.on('espontaneo', (f) => this._aoEspontaneo(f));
    sessao.on('queda', (e) => this._aoQueda(sessao, e));
    this._conectando = sessao.conectar();
    try {
      await this._conectando;
    } catch (e) {
      this._conectando = null;
      if (this.sessao !== sessao) return;
      this.sessao = null;
      this.conectado = false;
      this.ultimoErroConexao = e;
      this.erro = e.message;
      let espera;
      if (e.codigo === 'negado' || e.codigo === 'palavra_invalida') {
        // Palavra recusada pelo Guarita, ou inválida no cadastro (nem conecta):
        // tentar de novo rápido não adianta.
        this.autorizado = false;
        espera = Math.max(this.iv.esperaNegadoMs, Number(e.esperaMinimaMs) || 0);
      } else {
        espera = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, this.iv.backoffMaxMs);
      }
      this.log.error(`${this.rotulo}: sem conexão com o Guarita (${e.message}); nova tentativa em ${Math.round(espera / 1000)} s`);
      this._enviarEstado();
      this._agendarReconexao(espera);
      return;
    }
    this._conectando = null;
    if (this.parado || this.sessao !== sessao) {
      sessao.fechar();
      return;
    }
    this.conectado = true;
    this.autorizado = true;
    this.erro = null;
    this.ultimoErroConexao = null;
    this.backoffMs = this.iv.backoffInicialMs;
    this.log.log(`${this.rotulo}: conectado ao Módulo Guarita em ${d.ip}:${sessao.porta}`);
    this._avisarConectado();
    try {
      this._aoConectar();
    } catch {
      /* callback do supervisor não pode derrubar a sessão */
    }
    await this._aoConectarSessao(sessao);
  }

  async _aoConectarSessao(sessao) {
    const m = this._memoriaDoProcesso();
    const pular = this._mudosAtivos();
    try {
      this.info = await operacoes.identificar(sessao, { agora: this.cfg.agora, pular });
      for (const { comando } of operacoes.IDENTIFICACAO) if (!pular.has(comando)) this._registrarResposta(comando);
      if (this.info.relogioDeltaS === null && !pular.has(12)) {
        this.log.error(`${this.rotulo}: relógio do Guarita ilegível`);
      }
    } catch (e) {
      // Um comando da identificação sem resposta: a sessão caiu (C1) e a
      // próxima conexão tenta de novo. Só depois de 2 timeouts SEGUIDOS ele
      // fica marcado "sem resposta" (e expira em 10 min) — senão um 5 s
      // perdido calaria o comando para sempre.
      if (e && e.codigo === 'sem_resposta' && Number.isInteger(e.comando)) {
        for (const { comando } of operacoes.IDENTIFICACAO) {
          if (comando === e.comando) break;
          if (!pular.has(comando)) this._registrarResposta(comando);
        }
        this._registrarTimeout(e.comando);
      } else {
        this.log.error(`${this.rotulo}: falha ao identificar o Guarita (${(e && e.message) || e})`);
      }
      if (this.sessao !== sessao) return;
    }
    if (this.sessao !== sessao) return;
    this._enviarEstado();
    // Reler a memória inteira (até 8.192 eventos) só na 1ª conexão do
    // processo e depois de queda longa. A leitura é interrompível: um relé
    // pedido no meio passa na frente e ela recomeça.
    const foraMs = m.foraDesde === null ? null : this.t.agora() - m.foraDesde;
    m.foraDesde = null;
    const mudos = this._mudosAtivos();
    if (mudos.has(6) || mudos.has('recuperacao')) {
      // Sem o 6 (ou o 17) não há como reler a memória agora: segue sem
      // recuperação; quando a marca expirar, ela volta a ser tentada.
    } else if (!m.recuperou || foraMs === null || foraMs > this.iv.quedaLongaMs) {
      if (await this._recuperarEventos(sessao)) m.recuperou = true;
    } else {
      this.log.log(
        `${this.rotulo}: ficou ${Math.round(foraMs / 1000)} s sem conexão com o Guarita; a memória de eventos não é relida (queda curta) — os eventos desse intervalo podem faltar no histórico`,
      );
    }
    if (this.sessao !== sessao || this.parado) return;
    if (this.precisa29) this._armar29();
    this._agendar('ciclo', 0, () => void this._ciclo());
  }

  /** Espera uma sessão conectada (até `ms`); null se não vier ou o serviço parar. */
  _esperarConexao(ms) {
    if (this.conectado && this.sessao) return Promise.resolve(this.sessao);
    if (this.parado) return Promise.resolve(null);
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = this.t.setTimeout(() => {
        const i = this._esperandoConexao.indexOf(w);
        if (i !== -1) this._esperandoConexao.splice(i, 1);
        resolve(null);
      }, ms);
      this._esperandoConexao.push(w);
    });
  }

  _avisarConectado() {
    for (const w of this._esperandoConexao.splice(0)) {
      this.t.clearTimeout(w.timer);
      w.resolve(this.parado ? null : this.sessao);
    }
  }

  async _conferirDepoisDaQueda(op) {
    const sessao = await this._esperarConexao(this.iv.esperaConferenciaMs);
    if (!sessao) return { ok: false, codigo: null, incerto: true, mensagem: operacoes.MSG_INCERTO };
    return operacoes.conferirGravacao(sessao, { tipo: op.tipo, frameHex: op.frame_hex, esperado: op.esperado });
  }

  /** Estado que sobrevive à recriação do serviço dentro do mesmo processo. */
  _memoriaDoProcesso() {
    let m = this.cfg.memoriaProcesso.get(this.device.id);
    if (!m) {
      m = { recuperou: false, foraDesde: null, mudos: new Map(), timeoutsSeguidos: new Map() };
      this.cfg.memoriaProcesso.set(this.device.id, m);
    }
    return m;
  }

  _marcarForaDoAr() {
    const m = this._memoriaDoProcesso();
    if (m.foraDesde === null) m.foraDesde = this.t.agora();
  }

  _aoQueda(sessao, e) {
    if (sessao !== this.sessao) return;
    this._marcarForaDoAr();
    this.sessao = null;
    this.conectado = false;
    this.erro = e.message;
    this.ultimoErroConexao = e;
    for (const k of ['ciclo', 't29']) {
      if (this.timers[k]) this.t.clearTimeout(this.timers[k]);
      this.timers[k] = null;
    }
    let espera = this.backoffMs;
    if (e.codigo === 'negado') {
      // O Guarita pede palavra (o cadastro não tem, ou ela foi recusada).
      this.autorizado = false;
      espera = Math.max(this.iv.esperaNegadoMs, espera);
    } else {
      this.backoffMs = Math.min(this.backoffMs * 2, this.iv.backoffMaxMs);
    }
    this.log.error(`${this.rotulo}: ${e.message} Nova tentativa em ${Math.round(espera / 1000)} s`);
    this._enviarEstado();
    this._agendarReconexao(espera);
  }

  // ---------- estado ----------

  corpoEstado() {
    const c = { conectado: this.conectado, autorizado: this.autorizado === true };
    if (this.info.firmware) c.firmware = this.info.firmware;
    if (Number.isInteger(this.info.totalDispositivos)) c.total_dispositivos = this.info.totalDispositivos;
    if (Number.isInteger(this.info.totalEventos)) c.total_eventos = this.info.totalEventos;
    if (Number.isFinite(this.info.relogioDeltaS)) c.relogio_delta_s = this.info.relogioDeltaS;
    if (this.erro) c.erro = this.erro;
    else {
      const faltam = this._leiturasSemResposta();
      if (faltam.length > 0) c.erro = `O Guarita não respondeu à leitura de: ${faltam.join(', ')}`;
    }
    return c;
  }

  /** Comandos marcados "sem resposta" ainda válidos (os vencidos saem aqui). */
  _mudosAtivos() {
    const m = this._memoriaDoProcesso();
    const agora = this.t.agora();
    for (const [chave, desde] of m.mudos) {
      if (agora - desde > this.iv.validadeMudoMs) {
        m.mudos.delete(chave);
        this.log.log(`${this.rotulo}: a marca "sem resposta" de ${chave} expirou; ele volta a ser tentado`);
      }
    }
    return new Set(m.mudos.keys());
  }

  _registrarTimeout(chave) {
    const m = this._memoriaDoProcesso();
    const n = (m.timeoutsSeguidos.get(chave) || 0) + 1;
    if (n >= this.iv.timeoutsParaCalar) {
      m.timeoutsSeguidos.delete(chave);
      this._marcarMudo(chave);
    } else {
      m.timeoutsSeguidos.set(chave, n);
      this.log.error(`${this.rotulo}: o Guarita não respondeu a ${chave}; reconectando para tentar de novo`);
    }
  }

  _marcarMudo(chave) {
    const m = this._memoriaDoProcesso();
    m.mudos.set(chave, this.t.agora());
    this.log.error(`${this.rotulo}: o Guarita não respondeu a ${chave} de novo; fica de fora por até ${Math.round(this.iv.validadeMudoMs / 60000)} min`);
  }

  _registrarResposta(chave) {
    const m = this._memoriaDoProcesso();
    m.timeoutsSeguidos.delete(chave);
    m.mudos.delete(chave);
  }

  /** Nomes do que este Guarita não respondeu (identificação e recuperação). */
  _leiturasSemResposta() {
    const mudos = this._mudosAtivos();
    const nomes = operacoes.IDENTIFICACAO.filter((x) => mudos.has(x.comando)).map((x) => x.nome);
    if (mudos.has('recuperacao')) nomes.push('eventos da memória');
    return nomes;
  }

  /** Manda o estado se mudou (ou sempre, com `forcar`). Nunca rejeita. */
  _enviarEstado(forcar = false) {
    const corpo = this.corpoEstado();
    const json = JSON.stringify(corpo);
    if (!forcar && json === this._ultimoEstado) return;
    this._ultimoEstado = json;
    void this._nuvem('POST', 'estado', corpo);
  }

  _agendarEstadoPeriodico() {
    this._agendar('estado', this.iv.estadoMs, () => {
      this._enviarEstado(true);
      this._agendarEstadoPeriodico();
    });
  }

  // ---------- nuvem ----------

  async _nuvem(metodo, sub, corpo) {
    const pedir = this.cfg.requisitarNuvem;
    if (typeof pedir !== 'function') return { ok: false, transitorio: true, status: 0 };
    let res;
    try {
      res = await pedir(metodo, `/guarita/${encodeURIComponent(this.device.id)}/${sub}`, corpo);
    } catch (e) {
      if (!this._nuvemForaLogada) {
        this._nuvemForaLogada = true;
        this.log.error(`${this.rotulo}: nuvem inacessível (${(e && e.message) || e}); dados do Guarita ficam guardados`);
      }
      return { ok: false, transitorio: true, status: 0 };
    }
    const status = res && res.status;
    if (status >= 200 && status < 300) {
      this._nuvemForaLogada = false;
      if (this._rotaAusenteLogada) {
        this._rotaAusenteLogada = false;
        this.log.log(`${this.rotulo}: rotas do Guarita disponíveis na nuvem`);
      }
      return { ok: true, status, data: res.data };
    }
    if (status === 404) {
      if (!this._rotaAusenteLogada) {
        this._rotaAusenteLogada = true;
        this.log.error(`${this.rotulo}: a nuvem não conhece as rotas do Guarita (API antiga?); tentando de novo depois`);
      }
      return { ok: false, transitorio: true, rotaAusente: true, status };
    }
    const transitorio = status >= 500 || status === 401 || status === 408 || status === 429 || !status;
    return { ok: false, transitorio, status, data: res && res.data };
  }

  // ---------- eventos ----------

  _enfileirarEventos(itens) {
    this.filaEventos.push(...itens);
    const excesso = this.filaEventos.length - this.iv.limiteFilaEventos;
    if (excesso > 0) {
      this.filaEventos.splice(0, excesso);
      this._descartesLogados += excesso;
      this.log.error(
        `${this.rotulo}: fila de eventos do Guarita cheia (${this.iv.limiteFilaEventos}); ${excesso} evento(s) mais antigo(s) descartado(s) — continuam na memória do Guarita e só voltam numa próxima recuperação (reinício do agente ou queda > 60 s)`,
      );
    }
  }

  _aoEspontaneo({ comando, dados }) {
    const recebidoEm = new Date(this.cfg.agora()).toISOString();
    const evts = eventosDoEspontaneo(comando, dados);
    if (evts.length > 0) {
      this._enfileirarEventos(evts.map((e) => ({ frame_hex: hex(e), origem: 'ao_vivo', recebido_em: recebidoEm })));
      void this._descarregarEventos();
      return;
    }
    const nc = naoCadastradoDe(comando, dados, recebidoEm);
    if (nc) {
      void this._enviarNaoCadastrado(nc);
    }
    // 25, 32, 58, 100, 102: fora do escopo da integração; descartados.
  }

  async _descarregarEventos() {
    if (this._descarregando) {
      this._descarregarDeNovo = true;
      return;
    }
    this._descarregando = true;
    try {
      do {
        this._descarregarDeNovo = false;
        while (this.filaEventos.length > 0 && !this.parado) {
          const lote = this.filaEventos.slice(0, this.iv.lotePorEnvio);
          // Relógio desconhecido: null (a API trata como "sem correção"), nunca 0.
          const delta = Number.isFinite(this.info.relogioDeltaS) ? this.info.relogioDeltaS : null;
          const r = await this._nuvem('POST', 'eventos', { eventos: lote, relogio_delta_s: delta });
          if (!r.ok && r.transitorio) return;
          if (!r.ok) {
            this.log.error(`${this.rotulo}: nuvem recusou ${lote.length} evento(s) do Guarita (HTTP ${r.status}); descartados`);
          }
          const enviados = new Set(lote);
          this.filaEventos = this.filaEventos.filter((e) => !enviados.has(e));
        }
      } while (this._descarregarDeNovo && !this.parado);
    } finally {
      this._descarregando = false;
    }
  }

  async _recuperarEventos(sessao) {
    let lista;
    try {
      lista = await operacoes.lerTodosEventos(sessao);
    } catch (e) {
      this.log.error(`${this.rotulo}: falha ao recuperar os eventos do Guarita (${e.message})`);
      // Sem resposta (6 ou 17): 2 seguidas marcam (por 10 min), senão não chega às operações.
      if (e && e.codigo === 'sem_resposta') this._registrarTimeout('recuperacao');
      return false;
    }
    this._registrarResposta('recuperacao');
    if (lista.length === 0) return true;
    const recebidoEm = new Date(this.cfg.agora()).toISOString();
    const itens = lista.map((f) => ({ frame_hex: f, origem: 'recuperacao', recebido_em: recebidoEm }));
    // A recuperação lê a memória inteira (até 8.192): vai direto em lotes, sem
    // passar pelo teto da fila; só o que não sair fica guardado.
    const delta = Number.isFinite(this.info.relogioDeltaS) ? this.info.relogioDeltaS : null;
    let i = 0;
    while (i < itens.length && !this.parado) {
      const lote = itens.slice(i, i + this.iv.lotePorEnvio);
      const r = await this._nuvem('POST', 'eventos', { eventos: lote, relogio_delta_s: delta });
      if (!r.ok && r.transitorio) break;
      i += lote.length;
    }
    if (i < itens.length) this._enfileirarEventos(itens.slice(i));
    this.log.log(`${this.rotulo}: ${lista.length} evento(s) da memória do Guarita recuperado(s)`);
    return true;
  }

  async _enviarNaoCadastrado(corpo) {
    const r = await this._nuvem('POST', 'nao-cadastrado', corpo);
    if (!r.ok && r.transitorio) {
      // Captura tem janela de 60 s: guarda poucos e por pouco tempo.
      this.filaNaoCadastrados.push(corpo);
      if (this.filaNaoCadastrados.length > 50) this.filaNaoCadastrados.shift();
    }
  }

  async _reenviarNaoCadastrados() {
    const limite = this.cfg.agora() - 60000;
    const pendentes = this.filaNaoCadastrados.splice(0).filter((c) => Date.parse(c.recebido_em) >= limite);
    for (let i = 0; i < pendentes.length; i++) {
      const r = await this._nuvem('POST', 'nao-cadastrado', pendentes[i]);
      if (!r.ok && r.transitorio) {
        this.filaNaoCadastrados.unshift(...pendentes.slice(i));
        return;
      }
    }
  }

  // ---------- operações ----------

  async _ciclo() {
    if (this._emCiclo || this.parado || !this.conectado) return;
    this._emCiclo = true;
    try {
      await this._descarregarEventos();
      await this._reenviarNaoCadastrados();
      await this._reenviarResultadosPendentes();
      if (this.cfg.agora() >= this._operacoesSoDepoisDe && this.conectado) {
        await this._buscarEExecutarOperacoes();
      }
    } catch (e) {
      this.log.error(`${this.rotulo}: erro no ciclo do Guarita (${(e && e.message) || e})`);
    } finally {
      this._emCiclo = false;
      if (!this.parado && this.conectado) this._agendar('ciclo', this.iv.cicloMs, () => void this._ciclo());
    }
  }

  async _buscarEExecutarOperacoes() {
    const r = await this._nuvem('GET', 'operacoes');
    if (!r.ok) {
      if (r.rotaAusente) this._operacoesSoDepoisDe = this.cfg.agora() + this.iv.esperaRotaAusenteMs;
      return;
    }
    const lista = r.data && Array.isArray(r.data.operacoes) ? r.data.operacoes : [];
    for (const op of lista.slice(0, this.iv.maxOperacoesPorBusca)) {
      if (this.parado || !this.conectado) return;
      if (!op || typeof op !== 'object' || !Number.isInteger(op.id)) continue;
      const ja = this.executadas.get(op.id);
      if (ja && ja.estado === 'a_conferir') {
        await this._conferirPendente(op, ja);
        continue;
      }
      if (ja) {
        // Mesma operação devolvida de novo: NUNCA executa duas vezes. Se o
        // resultado já saiu, manda de novo (a rota é idempotente).
        if (ja.estado === 'concluida' && ja.enviadas >= ja.partes.length) {
          ja.enviadas = 0;
          await this._enviarResultado(op.id, ja);
        }
        continue;
      }
      await this._executarOperacao(op);
    }
  }

  // ---------- operações concluídas em disco ----------

  _carregarConcluidas() {
    let lista = [];
    try {
      const tudo = this.cfg.armazem.ler() || {};
      lista = Array.isArray(tudo[String(this.device.id)]) ? tudo[String(this.device.id)] : [];
    } catch (e) {
      this.log.error(`${this.rotulo}: não consegui ler as operações concluídas (${(e && e.message) || e})`);
    }
    for (const item of lista) {
      if (!item || !Number.isInteger(item.id)) continue;
      if (item.em_andamento && item.op && typeof item.op === 'object') {
        // O agente parou entre escrever e registrar: confere antes de repetir.
        this.executadas.set(item.id, { estado: 'a_conferir', op: item.op, persistida: true });
        continue;
      }
      if (!item.corpo || typeof item.corpo !== 'object') continue;
      this.executadas.set(item.id, { estado: 'concluida', partes: [item.corpo], enviadas: item.enviado ? 1 : 0, persistida: true });
    }
  }

  _persistirConcluidas() {
    try {
      const tudo = this.cfg.armazem.ler() || {};
      tudo[String(this.device.id)] = [...this.executadas]
        .filter(([, e]) => e.persistida && (e.estado === 'concluida' || ((e.estado === 'executando' || e.estado === 'a_conferir') && e.op)))
        .map(([id, e]) =>
          e.estado === 'concluida'
            ? { id, corpo: e.partes[0], enviado: e.enviadas >= e.partes.length }
            : { id, em_andamento: true, op: e.op },
        )
        .slice(-MAX_PERSISTIDAS_POR_DEVICE);
      this.cfg.armazem.gravar(tudo);
    } catch (e) {
      this.log.error(`${this.rotulo}: não consegui gravar as operações concluídas (${(e && e.message) || e})`);
    }
  }

  _lembrar(id, entrada) {
    this.executadas.set(id, entrada);
    if (this.executadas.size > 1000) {
      for (const [k, v] of this.executadas) {
        if (this.executadas.size <= 1000) break;
        if (v.estado === 'concluida' && v.enviadas >= v.partes.length && !v.persistida) this.executadas.delete(k);
      }
    }
  }

  async _executarOperacao(op) {
    const sessao = this.sessao;
    switch (op.tipo) {
      case 'cadastrar':
      case 'editar':
      case 'apagar': {
        // Registrado em disco ANTES de escrever: se o agente parar no meio, a
        // reentrega confere no Guarita em vez de repetir às cegas.
        this._lembrar(op.id, {
          estado: 'executando',
          op: { id: op.id, tipo: op.tipo, frame_hex: op.frame_hex, esperado: op.esperado },
          persistida: true,
        });
        this._persistirConcluidas();
        let r = await operacoes.gravar(sessao, { tipo: op.tipo, frameHex: op.frame_hex, esperado: op.esperado });
        if (r.escritoSemResposta) {
          // Saiu e não respondeu (a sessão caiu): pode ter gravado. Confere
          // numa sessão nova antes de dizer qualquer coisa à nuvem.
          this.log.error(`${this.rotulo}: operação ${op.id} (${op.tipo}) sem resposta; conferindo no Guarita depois de reconectar`);
          r = await this._conferirDepoisDaQueda(op);
        }
        // Serviço parado no meio (ouvinte recriado, agente encerrando): não
        // conclui nada — o registro "em andamento" fica em disco e o próximo
        // serviço confere no Guarita.
        if (this.parado) return;
        if (r.naoEnviado) {
          // Nem chegou ao Guarita (sessão caiu antes): fica para a reentrega.
          this.executadas.delete(op.id);
          this._persistirConcluidas();
          return;
        }
        await this._concluirGravacao(op, r);
        return;
      }
      case 'atualizar_receptores': {
        // Junta com o 29 automático do lote: um 29 só, 30 s depois da última gravação.
        this._lembrar(op.id, { estado: 'aguardando_29' });
        this.ops29.push(op.id);
        this.precisa29 = true;
        this._armar29();
        return;
      }
      case 'importar':
      case 'conferir': {
        this._lembrar(op.id, { estado: 'executando' });
        let partes;
        try {
          // Pedido explícito: tenta o 7 de novo (uma vez por operação), mesmo marcado.
          const frames = await operacoes.lerTodosDispositivos(sessao);
          this._registrarResposta(7);
          partes = partesDaImportacao(frames, this.iv.lotePorEnvio);
          this.info.totalDispositivos = frames.length;
          this.log.log(`${this.rotulo}: operação ${op.id} (${op.tipo}) → ${frames.length} dispositivo(s) lido(s)`);
        } catch (e) {
          let erro = e.message;
          if (e && e.codigo === 'sem_resposta' && e.comando === 7) {
            this._marcarMudo(7); // a marca volta (a sessão caiu; a reconexão segue sem ele)
            erro = `O Guarita não respondeu à leitura da quantidade de dispositivos (comando 7); a ${op.tipo === 'conferir' ? 'conferência' : 'importação'} não foi possível.`;
          }
          partes = [{ ok: false, erro }];
          this.log.error(`${this.rotulo}: operação ${op.id} (${op.tipo}) → FALHA (${e.message})`);
        }
        await this._concluir(op.id, partes);
        this._enviarEstado();
        return;
      }
      default:
        this._lembrar(op.id, { estado: 'executando' });
        await this._concluir(op.id, [{ ok: false, erro: `Operação desconhecida pelo agente: ${String(op.tipo)}.` }]);
    }
  }

  /** Corpo do resultado de uma gravação (contrato) a partir do retorno das operações. */
  _corpoDaGravacao(r) {
    const corpo = r.ok ? { ok: true } : { ok: false, erro: r.mensagem };
    if (Number.isInteger(r.codigo)) corpo.codigo = r.codigo;
    if (r.ja_estava) corpo.ja_estava = true;
    if (r.conflito) corpo.conflito = true;
    if (r.incerto) corpo.incerto = true;
    if (r.lido) corpo.lido = r.lido;
    return corpo;
  }

  async _concluirGravacao(op, r) {
    // Qualquer ok (inclusive conferido depois da queda) pede o 29 do lote.
    if (r.ok) this._marcarGravacao();
    this.log.log(`${this.rotulo}: operação ${op.id} (${op.tipo}) → ${r.ok ? 'OK' : `FALHA (${r.mensagem})`}${r.ja_estava ? ' (já estava assim no Guarita)' : ''}`);
    await this._concluir(op.id, [this._corpoDaGravacao(r)], { persistir: true });
  }

  /**
   * Operação que estava "em andamento" quando o agente parou: confere no
   * Guarita. Se o resultado pedido está lá (ou houve conflito/incerteza),
   * informa; se claramente não foi feito, executa normalmente agora.
   */
  async _conferirPendente(op, ja) {
    const pedido = ja.op;
    const r = await operacoes.conferirGravacao(this.sessao, { tipo: pedido.tipo, frameHex: pedido.frame_hex, esperado: pedido.esperado });
    if (!r.ok && !r.conflito && !r.incerto) {
      this.executadas.delete(op.id);
      await this._executarOperacao({ ...pedido, ...op });
      return;
    }
    await this._concluirGravacao(pedido, r);
  }

  async _concluir(id, partes, { persistir = false } = {}) {
    const entrada = { estado: 'concluida', partes, enviadas: 0, persistida: persistir };
    this._lembrar(id, entrada);
    if (persistir) this._persistirConcluidas();
    const ok = await this._enviarResultado(id, entrada);
    if (persistir && ok) this._persistirConcluidas();
    // Importação/conferência entregue: não guarda os frames (até ~2 MB); se a
    // nuvem reentregar, relê (é só leitura).
    if (ok && !persistir && partes.length > 0 && Array.isArray(partes[0].frames_hex)) this.executadas.delete(id);
  }

  /** Manda as partes que faltam, em ordem. Para na primeira falha transitória. */
  async _enviarResultado(id, entrada) {
    while (entrada.enviadas < entrada.partes.length) {
      const r = await this._nuvem('POST', `operacoes/${id}/resultado`, entrada.partes[entrada.enviadas]);
      if (!r.ok && r.transitorio) return false;
      if (!r.ok) {
        this.log.error(`${this.rotulo}: nuvem recusou o resultado da operação ${id} (HTTP ${r.status})`);
        entrada.enviadas = entrada.partes.length;
        return false;
      }
      entrada.enviadas++;
    }
    return true;
  }

  async _reenviarResultadosPendentes() {
    for (const [id, e] of this.executadas) {
      if (e.estado === 'concluida' && e.enviadas < e.partes.length) {
        const ok = await this._enviarResultado(id, e);
        if (ok && e.persistida) this._persistirConcluidas();
        if (!ok) return;
      }
    }
  }

  // ---------- 29: atualizar receptores ----------

  _marcarGravacao() {
    this.precisa29 = true;
    this.ultimaGravacaoEm = this.t.agora();
    this._armar29();
  }

  _armar29() {
    if (!this.conectado || this.parado) return;
    const base = this.ultimaGravacaoEm === null ? -Infinity : this.ultimaGravacaoEm;
    const espera = Math.max(0, base + this.iv.atraso29Ms - this.t.agora());
    this._agendar('t29', espera, () => void this._rodar29());
  }

  async _rodar29() {
    const sessao = this.sessao;
    if (!this.precisa29 || !this.conectado || !sessao) return;
    const ids = this.ops29.splice(0);
    this.precisa29 = false;
    this.log.log(`${this.rotulo}: atualizando receptores (comando 29)`);
    const r = await operacoes.atualizarReceptores(sessao);
    if (!r.ok && this.sessao !== sessao) {
      // Caiu no meio: refaz depois de reconectar (as operações seguem esperando).
      this.precisa29 = true;
      this.ops29.unshift(...ids);
      return;
    }
    this.log.log(`${this.rotulo}: receptores ${r.ok ? 'atualizados' : `NÃO atualizados (${r.mensagem})`}`);
    const corpo = r.ok ? { ok: true, codigo: 0 } : { ok: false, erro: r.mensagem };
    if (!r.ok && Number.isInteger(r.codigo)) corpo.codigo = r.codigo;
    for (const id of ids) await this._concluir(id, [{ ...corpo }], { persistir: true });
  }

  // ---------- testar / relé ----------

  async testar() {
    // Conexão em andamento (ex.: o 1º ping logo depois de o agente subir):
    // espera um pouco pelo desfecho em vez de dar "offline" à toa.
    if (!this.conectado && this._conectando) {
      let timer;
      await Promise.race([
        this._conectando.catch(() => {}),
        new Promise((r) => {
          timer = this.t.setTimeout(r, this.iv.esperaPingConectandoMs);
        }),
      ]);
      this.t.clearTimeout(timer);
    }
    if (this.conectado) return { ok: true };
    if (this.autorizado === false) {
      return { ok: false, statusCode: 401, error: this.erro || 'Palavra de autorização recusada pelo Guarita' };
    }
    const e = this.ultimoErroConexao;
    const erro = new Error(this.erro || 'Guarita ainda não conectado.');
    erro.code = (e && e.code) || 'ETIMEDOUT';
    throw erro;
  }

  async acionarRele(payload, restanteMs) {
    // Só espera a vez pelo que sobra da validade do comando (despacho).
    const prazoRele = Number.isFinite(restanteMs)
      ? Math.max(0, Math.min(this.iv.prazoReleMs, restanteMs))
      : this.iv.prazoReleMs;
    const sessao = this.sessao;
    if (!this.conectado || !sessao) return { ok: false, error: 'O Guarita está desconectado do agente.' };
    const p = payload && typeof payload === 'object' ? payload : {};
    try {
      await operacoes.acionarRele(
        sessao,
        { tipoReceptor: p.tipo_receptor, numReceptor: p.num_receptor, rele: p.rele },
        { prazoNaFilaMs: prazoRele },
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

function criarDriverGuarita(opcoes = {}) {
  const cfg = {
    requisitarNuvem: opcoes.requisitarNuvem || null,
    agora: opcoes.agora || (() => Date.now()),
    temporizador: opcoes.temporizador || temporizadorReal,
    abrirSocket: opcoes.abrirSocket,
    log: opcoes.log || console,
    armazem: opcoes.armazem || criarArmazemEmMemoria(),
    memoriaProcesso: new Map(), // deviceId → { recuperou, foraDesde }
    intervalos: { ...PADROES, ...(opcoes.intervalos || {}) },
  };
  const servicos = new Map();

  /** `requisitarNuvem(metodo, caminhoSobOCondominio, corpo) → {status, data}`; `agora() → ms`. */
  function configurar(o = {}) {
    if (typeof o.requisitarNuvem === 'function') cfg.requisitarNuvem = o.requisitarNuvem;
    if (typeof o.agora === 'function') cfg.agora = o.agora;
    if (o.log) cfg.log = o.log;
  }

  function escutar(device, _aoEvento, { aoConectar } = {}) {
    const antigo = servicos.get(device.id);
    if (antigo) antigo.parar();
    const s = new ServicoGuarita(device, cfg, aoConectar);
    servicos.set(device.id, s);
    s.iniciar();
    return function parar() {
      s.parar();
      if (servicos.get(device.id) === s) servicos.delete(device.id);
    };
  }

  async function testar(device) {
    const s = device ? servicos.get(device.id) : null;
    if (!s) {
      const e = new Error('Guarita sem sessão no agente.');
      e.code = 'ETIMEDOUT';
      throw e;
    }
    return s.testar();
  }

  async function executar(device, cmd) {
    const tipo = cmd && cmd.type;
    if (tipo === 'ping') return testar(device);
    if (tipo !== 'guarita_rele') {
      return { ok: false, error: `comando ${String(tipo)} não suportado pelo Módulo Guarita` };
    }
    const s = device ? servicos.get(device.id) : null;
    if (!s) return { ok: false, error: 'O Guarita está desconectado do agente.' };
    return s.acionarRele(cmd.payload, cmd._restanteMs);
  }

  return { id: ID, configurar, testar, executar, escutar, _servicos: servicos };
}

// O driver do processo guarda as operações concluídas ao lado do estado do
// agente (mesma pasta do device-baselines.json).
const padrao = criarDriverGuarita({
  armazem: criarArmazemEmArquivo(path.join(require('../core/estado').configDir(), ARQUIVO_OPERACOES)),
});

module.exports = {
  ...padrao,
  criarDriverGuarita,
  criarArmazemEmMemoria,
  criarArmazemEmArquivo,
  ARQUIVO_OPERACOES,
  PADROES,
  naoCadastradoDe,
  eventosDoEspontaneo,
  partesDaImportacao,
};
