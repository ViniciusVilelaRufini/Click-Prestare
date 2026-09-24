'use strict';

/**
 * agent/src/core/supervisor.js — um SupervisorDispositivo por device: decide
 * se há driver para (tipo, fabricante), inicia o ouvinte de eventos
 * (`escutar`) e reconecta com espera crescente quando ele falha, aciona a
 * recuperação de acessos offline e o acerto de relógio no reconectar/a cada
 * 1h, e expõe `saude()` para telemetria (tarefa 7).
 *
 * NÃO reimplementa o protocolo de cada marca (mora nos drivers, ver
 * src/drivers/*) nem o heartbeat de status reportado à nuvem (ping via
 * `driver.testar`, POST /device-status) — isso continua em index.js, que
 * já detecta online/offline por ping e chama a recuperação offline nessa
 * transição (mecanismo existente, preservado). O Supervisor só ORQUESTRA o
 * ciclo de vida do ouvinte por device (genérico, por contrato) e acrescenta
 * uma segunda camada de recuperação: se a PRÓPRIA chamada a `escutar` falhar
 * (ex.: erro síncrono ao abrir o ouvinte), reconecta sozinho com espera
 * crescente, em vez de desistir OU martelar sem parar.
 *
 * `aoConectar`/`aoEvento` (injetados no construtor) são os callbacks que
 * index.js já usa hoje (o fast-path "stream reconectou → recupera na hora" e
 * o encaminhamento de evento para a nuvem) — o Supervisor só os invoca no
 * lugar certo do ciclo de vida; não decide sozinho quando agir sobre eles
 * (mesma filosofia do contrato de driver, ver dahua-facial.js).
 */

const BACKOFF_INICIAL_MS = 1000;
const BACKOFF_MAX_MS = 60000;
const CLOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1h

/** Supervisiona UM device: resolve o driver, mantém o ouvinte vivo. */
class SupervisorDispositivo {
  constructor(device, { resolverDriver, aoRecuperarOffline, aoEvento, log }) {
    this.device = device;
    this._resolverDriver = resolverDriver;
    this._aoRecuperarOffline = aoRecuperarOffline || (() => {});
    this._aoEvento = aoEvento || (() => {});
    this._log = log || console;
    this.driver = null;
    this._pararEscuta = null;
    this._parado = false;
    this._semDriverLogado = false;
    this._backoffMs = BACKOFF_INICIAL_MS;
    this._reconnectTimer = null;
    this._clockSyncTimer = null;
    this._online = false;
    this._ultimoEventoEm = null;
    this._ultimoErro = null;
  }

  /** Resolve o driver e, se houver, inicia o ouvinte (uma vez). Sem driver
   *  conhecido para (tipo, fabricante): loga uma vez e não faz mais nada —
   *  em especial, NUNCA assina eventos de outro tipo de aparelho (ex.: uma
   *  câmera LPR não pode herdar o ouvinte de reconhecimento facial). */
  iniciar() {
    this.driver = this._resolverDriver(this.device);
    if (!this.driver) {
      if (!this._semDriverLogado) {
        this._semDriverLogado = true;
        this._log.log(
          `[agente] ${this.device.nome}: sem driver para ${this.device.tipo}/${this.device.fabricante}`,
        );
      }
      return;
    }
    if (typeof this.driver.escutar === 'function') {
      this._conectar(true);
    }
  }

  /** Chama `driver.escutar` uma vez. `primeiraVez` só muda o texto do log
   *  (a assinatura inicial soa diferente de uma reconexão após queda). */
  _conectar(primeiraVez) {
    if (this._parado) return;
    this._log.log(
      primeiraVez
        ? `[agente] ${this.device.nome}: assinando eventos de acesso (${this.driver.id})`
        : `[agente] ${this.device.nome}: reabrindo assinatura de eventos (${this.driver.id})`,
    );
    try {
      this._pararEscuta = this.driver.escutar(this.device, (dado) => this._receberEvento(dado), {
        aoConectar: () => this._aoConectar(),
      });
    } catch (err) {
      this._log.error(
        `[agente] ${this.device.nome}: falha ao assinar eventos (${err.message || err}); nova tentativa em ${this._backoffMs}ms`,
      );
      this._registrarErro(err);
      this._agendarReconexao();
    }
  }

  _receberEvento(dado) {
    this._ultimoEventoEm = new Date();
    this._aoEvento(this.device, dado);
  }

  /** Chamado pelo driver no primeiro byte de CADA conexão bem-sucedida do
   *  stream (ver contrato `escutar` em dahua-facial.js) — dispara a cada
   *  reabertura periódica normal do stream, não só depois de uma queda; por
   *  isso `aoRecuperarOffline` (o fast-path) é responsabilidade de quem
   *  injeta o callback decidir se estava mesmo offline antes (index.js já
   *  faz essa checagem via heartbeat — preservado, não repetido aqui). */
  _aoConectar() {
    this._online = true;
    this._backoffMs = BACKOFF_INICIAL_MS; // conexão do ouvinte OK: reseta a espera
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.driver.acertarRelogio) {
      Promise.resolve(this.driver.acertarRelogio(this.device, true)).catch((err) =>
        this._registrarErroAcertoDeRelogio(err),
      );
    }
    this._agendarAcertoDeRelogioPeriodico();
    Promise.resolve(this._aoRecuperarOffline(this.device)).catch((err) =>
      this._registrarErro(err),
    );
  }

  /** Acerta o relógio a cada 1h enquanto o ouvinte estiver de pé — além do
   *  acerto imediato em `_aoConectar`. Marcas sem `acertarRelogio` (ex.:
   *  Hikvision) simplesmente não ganham este agendamento. */
  _agendarAcertoDeRelogioPeriodico() {
    if (this._clockSyncTimer) clearInterval(this._clockSyncTimer);
    if (!this.driver.acertarRelogio) return;
    this._clockSyncTimer = setInterval(() => {
      if (this._parado) return;
      Promise.resolve(this.driver.acertarRelogio(this.device)).catch((err) =>
        this._registrarErroAcertoDeRelogio(err),
      );
    }, CLOCK_SYNC_INTERVAL_MS);
    this._clockSyncTimer.unref?.();
  }

  /** O ouvinte caiu (não conseguiu nem abrir): reconecta com espera
   *  crescente (1s, 2s, 4s ... teto 60s) em vez de martelar sem parar ou
   *  desistir de vez. */
  _agendarReconexao() {
    if (this._parado) return;
    this._online = false;
    const espera = this._backoffMs;
    this._backoffMs = Math.min(this._backoffMs * 2, BACKOFF_MAX_MS);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._conectar(false);
    }, espera);
    this._reconnectTimer.unref?.();
  }

  _registrarErro(err) {
    this._ultimoErro = (err && err.message) || String(err);
  }

  /** `acertarRelogio` falhando não pode sumir calado — igual a
   *  `_aoRecuperarOffline`, alimenta `saude().ultimo_erro` (telemetria da
   *  tarefa 7) e loga, em vez do `.catch(() => {})` mudo de antes. */
  _registrarErroAcertoDeRelogio(err) {
    this._registrarErro(err);
    this._log.error(
      `[agente] ${this.device.nome}: falha ao acertar relógio: ${(err && err.message) || err}`,
    );
  }

  /** Para o ouvinte e cancela timers pendentes — chamado quando o device
   *  sai da lista da nuvem (removido/desativado no portal). */
  parar() {
    this._parado = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._clockSyncTimer) clearInterval(this._clockSyncTimer);
    try {
      this._pararEscuta?.();
    } catch {
      /* ouvinte já tinha parado sozinho */
    }
  }

  saude() {
    return {
      id: this.device.id,
      driver: this.driver ? this.driver.id : null,
      online: this._online,
      ultimo_evento_em: this._ultimoEventoEm,
      ultimo_erro: this._ultimoErro,
    };
  }
}

/** Um SupervisorDispositivo por device ativo. `atualizar(devices)` é
 *  chamado a cada ciclo de poll com a lista atual — cria o que é novo, para
 *  (`parar()`) o que saiu da lista. */
const OPCOES_CONHECIDAS = new Set(['resolverDriver', 'aoRecuperarOffline', 'aoEvento', 'log']);

class Supervisor {
  constructor(opcoes = {}) {
    // Rede de segurança contra erro de digitação na chave (ex.: `aoConectar`
    // em vez de `aoRecuperarOffline`): sem isso, a opção some em silêncio —
    // o construtor aceita, mas o callback nunca é chamado — e o fast-path de
    // recuperação fica morto sem nenhum aviso (foi exatamente o que
    // aconteceu aqui: index.js passava `aoConectar`, este construtor
    // ignorava, `aoRecuperarOffline` ficava no default no-op).
    for (const chave of Object.keys(opcoes)) {
      if (!OPCOES_CONHECIDAS.has(chave)) {
        throw new Error(
          `Supervisor: opção desconhecida "${chave}" (esperado: ${[...OPCOES_CONHECIDAS].join(', ')})`,
        );
      }
    }
    const { resolverDriver, aoRecuperarOffline, aoEvento, log } = opcoes;
    if (typeof resolverDriver !== 'function') {
      throw new Error('Supervisor requer resolverDriver(device)');
    }
    this._resolverDriver = resolverDriver;
    this._aoRecuperarOffline = aoRecuperarOffline;
    this._aoEvento = aoEvento;
    this._log = log || console;
    this._porId = new Map();
  }

  atualizar(devices) {
    const vistos = new Set();
    for (const device of devices || []) {
      vistos.add(device.id);
      const existente = this._porId.get(device.id);
      if (existente) {
        // Atualiza a referência (ip/credencial podem ter mudado no portal) —
        // não reinicia o ouvinte: trocar host/senha em cima de uma conexão
        // viva é bem mais raro que perder/reganhar rede, e o próprio
        // reconectar (ao cair) já pega a versão nova do device.
        existente.device = device;
        continue;
      }
      const sup = new SupervisorDispositivo(device, {
        resolverDriver: this._resolverDriver,
        aoRecuperarOffline: this._aoRecuperarOffline,
        aoEvento: this._aoEvento,
        log: this._log,
      });
      this._porId.set(device.id, sup);
      sup.iniciar();
    }
    for (const [id, sup] of this._porId) {
      if (!vistos.has(id)) {
        sup.parar();
        this._porId.delete(id);
      }
    }
  }

  saude(deviceId) {
    const sup = this._porId.get(deviceId);
    return sup ? sup.saude() : null;
  }

  saudeTodos() {
    return [...this._porId.values()].map((s) => s.saude());
  }
}

module.exports = {
  Supervisor,
  SupervisorDispositivo,
  BACKOFF_INICIAL_MS,
  BACKOFF_MAX_MS,
  CLOCK_SYNC_INTERVAL_MS,
};
