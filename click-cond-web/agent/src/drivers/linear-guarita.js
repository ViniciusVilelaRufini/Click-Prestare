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

const { SessaoGuarita } = require('./linear/sessao');
const operacoes = require('./linear/operacoes');

const ID = 'linear-guarita';
const PADROES = Object.freeze({
  cicloMs: 5000, // busca de operações + envio de eventos
  estadoMs: 60000, // estado periódico
  atraso29Ms: 30000, // 29 depois da última gravação do lote
  backoffInicialMs: 1000,
  backoffMaxMs: 60000,
  esperaNegadoMs: 60000,
  esperaRotaAusenteMs: 60000, // API antiga: pergunta de novo em 1 min
  prazoReleMs: 5000, // relé que não consegue a vez em 5 s desiste (não abre atrasado)
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
    this.parado = true;
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
    try {
      this._aoConectar();
    } catch {
      /* callback do supervisor não pode derrubar a sessão */
    }
    await this._aoConectarSessao(sessao);
  }

  async _aoConectarSessao(sessao) {
    try {
      this.info = await operacoes.identificar(sessao, { agora: this.cfg.agora });
      if (this.info.relogioDeltaS === null) {
        this.log.error(`${this.rotulo}: relógio do Guarita ilegível`);
      }
    } catch (e) {
      if (this.sessao !== sessao) return;
      this.log.error(`${this.rotulo}: falha ao identificar o Guarita (${e.message})`);
    }
    if (this.sessao !== sessao) return;
    this._enviarEstado();
    await this._recuperarEventos(sessao);
    if (this.sessao !== sessao || this.parado) return;
    if (this.precisa29) this._armar29();
    this._agendar('ciclo', 0, () => void this._ciclo());
  }

  _aoQueda(sessao, e) {
    if (sessao !== this.sessao) return;
    this.sessao = null;
    this.conectado = false;
    this.erro = e.message;
    this.ultimoErroConexao = e;
    for (const k of ['ciclo', 't29']) {
      if (this.timers[k]) this.t.clearTimeout(this.timers[k]);
      this.timers[k] = null;
    }
    const espera = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.iv.backoffMaxMs);
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
    return c;
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
        `${this.rotulo}: fila de eventos do Guarita cheia (${this.iv.limiteFilaEventos}); ${excesso} evento(s) mais antigo(s) descartado(s) — continuam na memória do Guarita e voltam na próxima recuperação`,
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
          const delta = Number.isFinite(this.info.relogioDeltaS) ? this.info.relogioDeltaS : 0;
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
      return;
    }
    if (lista.length === 0) return;
    const recebidoEm = new Date(this.cfg.agora()).toISOString();
    const itens = lista.map((f) => ({ frame_hex: f, origem: 'recuperacao', recebido_em: recebidoEm }));
    // A recuperação lê a memória inteira (até 8.192): vai direto em lotes, sem
    // passar pelo teto da fila; só o que não sair fica guardado.
    const delta = Number.isFinite(this.info.relogioDeltaS) ? this.info.relogioDeltaS : 0;
    let i = 0;
    while (i < itens.length && !this.parado) {
      const lote = itens.slice(i, i + this.iv.lotePorEnvio);
      const r = await this._nuvem('POST', 'eventos', { eventos: lote, relogio_delta_s: delta });
      if (!r.ok && r.transitorio) break;
      i += lote.length;
    }
    if (i < itens.length) this._enfileirarEventos(itens.slice(i));
    this.log.log(`${this.rotulo}: ${lista.length} evento(s) da memória do Guarita recuperado(s)`);
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

  _lembrar(id, entrada) {
    this.executadas.set(id, entrada);
    if (this.executadas.size > 1000) {
      for (const [k, v] of this.executadas) {
        if (this.executadas.size <= 1000) break;
        if (v.estado === 'concluida' && v.enviadas >= v.partes.length) this.executadas.delete(k);
      }
    }
  }

  async _executarOperacao(op) {
    const sessao = this.sessao;
    switch (op.tipo) {
      case 'cadastrar':
      case 'editar':
      case 'apagar': {
        this._lembrar(op.id, { estado: 'executando' });
        const r = await operacoes.gravar(sessao, { tipo: op.tipo, frameHex: op.frame_hex });
        const corpo = r.ok ? { ok: true, codigo: r.codigo } : { ok: false, erro: r.mensagem };
        if (!r.ok && Number.isInteger(r.codigo)) corpo.codigo = r.codigo;
        if (r.ok) this._marcarGravacao();
        this.log.log(`${this.rotulo}: operação ${op.id} (${op.tipo}) → ${r.ok ? 'OK' : `FALHA (${r.mensagem})`}`);
        await this._concluir(op.id, [corpo]);
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
          const frames = await operacoes.lerTodosDispositivos(sessao);
          partes = partesDaImportacao(frames, this.iv.lotePorEnvio);
          this.info.totalDispositivos = frames.length;
          this.log.log(`${this.rotulo}: operação ${op.id} (${op.tipo}) → ${frames.length} dispositivo(s) lido(s)`);
        } catch (e) {
          partes = [{ ok: false, erro: e.message }];
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

  async _concluir(id, partes) {
    const entrada = { estado: 'concluida', partes, enviadas: 0 };
    this._lembrar(id, entrada);
    await this._enviarResultado(id, entrada);
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
    for (const id of ids) await this._concluir(id, [{ ...corpo }]);
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

  async acionarRele(payload) {
    const sessao = this.sessao;
    if (!this.conectado || !sessao) return { ok: false, error: 'O Guarita está desconectado do agente.' };
    const p = payload && typeof payload === 'object' ? payload : {};
    try {
      await operacoes.acionarRele(
        sessao,
        { tipoReceptor: p.tipo_receptor, numReceptor: p.num_receptor, rele: p.rele },
        { prazoNaFilaMs: this.iv.prazoReleMs },
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
    return s.acionarRele(cmd.payload);
  }

  return { id: ID, configurar, testar, executar, escutar, _servicos: servicos };
}

const padrao = criarDriverGuarita();

module.exports = {
  ...padrao,
  criarDriverGuarita,
  PADROES,
  naoCadastradoDe,
  eventosDoEspontaneo,
  partesDaImportacao,
};
