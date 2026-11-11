'use strict';

/**
 * agent/src/core/despacho.js — como os comandos da nuvem e os pings do
 * heartbeat são distribuídos entre os aparelhos. Módulo puro: tudo que fala
 * com rede (executar no aparelho, postar o resultado, pingar) é injetado.
 *
 * Antes, o laço do poll fazia tudo em série: um aparelho offline (8 s de
 * timeout por chamada) segurava o comando dos OUTROS aparelhos e o próximo
 * poll, enquanto a nuvem espera só 15 s por comando — abrir o portão B
 * falhava porque o facial A estava desligado.
 *
 *   - `criarDespachante`: uma FILA POR APARELHO. Aparelhos diferentes rodam
 *     em paralelo; dentro do mesmo aparelho a ordem é estrita (um comando por
 *     vez, na ordem em que a nuvem entregou — inclusive entre polls). Falha
 *     em um comando (ao executar OU ao devolver o resultado) nunca descarta
 *     os demais.
 *   - `criarCicloDePing`: pings do heartbeat em paralelo, com timeout próprio
 *     curto, sem empilhar dois pings no mesmo aparelho.
 *
 * PRAZO NA FILA. O poll continua a cada 2 s mesmo com um aparelho mudo: a
 * nuvem marca os comandos como entregues e eles ficam esperando AQUI, na
 * memória. A nuvem desiste em 15 s (ping/open_door/remove/snapshot) ou 25 s
 * (enroll/update/list_users/remove_users) — sem prazo do lado de cá, vários
 * "abrir porta" clicados em sequência executavam quando o aparelho voltava,
 * com a porta abrindo sem ninguém esperando. Por isso cada comando guarda o
 * instante em que chegou (relógio MONOTÔNICO) e é descartado, sem tocar o
 * aparelho, se esperou mais que o prazo (`prazoDoComando`).
 */

const { performance } = require('node:perf_hooks');
const { classificarFalha } = require('../lib/http');

// 5 s: o ping Dahua/Hikvision com Digest são DUAS idas e vindas (401 + nova
// tentativa autenticada); com 3 s um aparelho lento virava OFFLINE sem estar.
const PING_TIMEOUT_MS = 5000;

// Quanto um comando pode esperar na fila do agente antes de ser descartado.
// Sempre ABAIXO do que a nuvem espera (15 s / 25 s — FATOR_TIMEOUT_POR_TIPO em
// agent-bridge.service.ts): a folga cobre o trajeto do poll e do resultado.
const PRAZO_CURTO_MS = 10000;
const PRAZO_LONGO_MS = 20000;
const PRAZO_POR_TIPO = {
  open_door: PRAZO_CURTO_MS,
  ping: PRAZO_CURTO_MS,
  snapshot: PRAZO_CURTO_MS,
  remove: PRAZO_CURTO_MS,
  enroll: PRAZO_LONGO_MS,
  update: PRAZO_LONGO_MS,
  list_users: PRAZO_LONGO_MS,
  remove_users: PRAZO_LONGO_MS,
};
// Abrir porta fora de hora é o pior caso: nem a nuvem consegue esticar isto.
const TETO_OPEN_DOOR_MS = PRAZO_CURTO_MS;
const ERRO_EXPIRADO = 'expirado na fila do agente';
const ERRO_FORA_DA_LISTA = 'aparelho não está mais na lista da nuvem';

/**
 * Prazo (ms) que o comando pode esperar na fila do agente. `cmd.ttl_ms`
 * (quanto falta para a nuvem desistir, já com folga de trajeto) manda quando
 * vem como número válido; senão vale o padrão do tipo (10 s para tipo
 * desconhecido). `open_door` nunca passa de 10 s, venha o que vier.
 */
function prazoDoComando(cmd) {
  const tipo = cmd && cmd.type;
  const padrao = Object.prototype.hasOwnProperty.call(PRAZO_POR_TIPO, tipo)
    ? PRAZO_POR_TIPO[tipo]
    : PRAZO_CURTO_MS;
  const ttl = cmd && cmd.ttl_ms;
  const prazo = typeof ttl === 'number' && Number.isFinite(ttl) && ttl >= 0 ? ttl : padrao;
  return tipo === 'open_door' ? Math.min(prazo, TETO_OPEN_DOOR_MS) : prazo;
}

function criarDespachante({ executar, postarResultado, log = console, agora = () => performance.now() }) {
  if (typeof executar !== 'function' || typeof postarResultado !== 'function') {
    throw new Error('criarDespachante requer executar(device, cmd) e postarResultado(device, cmd, result)');
  }
  // deviceId → { itens: [{ cmd, device, chegouEm, concluir }], rodando }.
  const filas = new Map();
  // Devices do ÚLTIMO poll (cada `despachar` é um poll): é com o objeto daqui
  // (IP/credenciais atuais) que o comando executa, não com o de quando chegou.
  let devicesAtuais = new Map();
  let emCurso = 0;

  /** Devolve o resultado à nuvem e loga. Nunca rejeita. */
  async function responder(device, cmd, result) {
    try {
      await postarResultado(device, cmd, result);
    } catch (err) {
      // A nuvem não recebeu ESTE resultado (ela mesma expira o comando); os
      // próximos da fila seguem normalmente.
      log.error(
        `[agente] ${device.nome} ◂ ${cmd.type}: falha ao devolver o resultado à nuvem (${(err && err.message) || err})`,
      );
      return;
    }
    log.log(
      `[agente] ${device.nome} ◂ ${cmd.type} → ${result.ok ? 'OK' : 'FALHA'}${
        result.error ? ' (' + result.error + ')' : ''
      }`,
    );
  }

  /** Nunca rejeita: qualquer erro vira resultado/log deste comando só. */
  async function processar(deviceId, item, fila) {
    const { cmd } = item;
    // Decidido AGORA, na hora de executar: idade pelo relógio monotônico.
    const prazo = prazoDoComando(cmd);
    if (prazo <= 0 || agora() - item.chegouEm > prazo) {
      // Velho demais: a nuvem já desistiu (ou está desistindo). NÃO toca o aparelho.
      await responder(item.device, cmd, { ok: false, error: ERRO_EXPIRADO });
      return;
    }
    const device = devicesAtuais.get(deviceId);
    if (!device) {
      // Removido/desativado no portal enquanto o comando esperava.
      await responder(item.device, cmd, { ok: false, error: ERRO_FORA_DA_LISTA });
      return;
    }
    // Colapso: vários "abrir porta" seguidos na fila (cliques acumulados
    // enquanto o aparelho não respondia) viram UMA abertura física; os que
    // vinham logo atrás recebem o mesmo resultado.
    const colapsados = [];
    if (cmd.type === 'open_door') {
      while (fila.itens.length > 0 && fila.itens[0].cmd.type === 'open_door') {
        colapsados.push(fila.itens.shift());
      }
    }
    let result;
    try {
      result = await executar(device, cmd);
    } catch (err) {
      result = {
        ok: false,
        statusCode: err && err.statusCode,
        error: (err && err.message) || String(err),
      };
    }
    if (!result || typeof result !== 'object') {
      result = { ok: false, error: 'driver não devolveu resultado' };
    }
    await responder(device, cmd, result);
    for (const outro of colapsados) {
      await responder(device, outro.cmd, result);
      outro.concluir();
    }
  }

  async function drenar(deviceId, fila) {
    while (fila.itens.length > 0) {
      const item = fila.itens.shift();
      try {
        await processar(deviceId, item, fila);
      } catch {
        // `processar` não rejeita; o catch é só cinto e suspensório para a
        // fila do aparelho nunca travar numa rejeição.
      }
      item.concluir();
    }
    fila.rodando = false;
    if (filas.get(deviceId) === fila) filas.delete(deviceId);
  }

  /**
   * Enfileira os comandos de um poll (`[{ device, commands }]`). Não bloqueia:
   * devolve uma Promise que resolve quando ESTE lote terminou — quem chama
   * pode esperar (modo legado, um device) ou seguir para o próximo poll.
   *
   * Cada chamada É um poll: a lista de devices recebida passa a ser a atual
   * (inclusive entradas sem comando). Um comando ainda na fila de um aparelho
   * que não veio nesta lista é descartado quando chegar a vez dele.
   */
  function despachar(entradas) {
    const doLote = [];
    const daLista = new Map();
    const aIniciar = [];
    const chegouEm = agora();
    for (const entrada of Array.isArray(entradas) ? entradas : []) {
      const device = entrada && entrada.device;
      if (!device || device.id == null) continue;
      daLista.set(device.id, device);
      const comandos = Array.isArray(entrada.commands) ? entrada.commands : [];
      for (const cmd of comandos) {
        if (!cmd || typeof cmd !== 'object') continue;
        emCurso++;
        let fila = filas.get(device.id);
        if (!fila) {
          fila = { itens: [], rodando: false };
          filas.set(device.id, fila);
        }
        doLote.push(
          new Promise((resolve) => {
            fila.itens.push({
              cmd,
              device,
              chegouEm,
              concluir: () => {
                emCurso--;
                resolve();
              },
            });
          }),
        );
        if (!fila.rodando && !aIniciar.includes(device.id)) aIniciar.push(device.id);
      }
    }
    devicesAtuais = daLista;
    // Só começa a drenar depois de o lote inteiro estar na fila: assim os
    // "abrir porta" que chegaram juntos colapsam em um.
    for (const deviceId of aIniciar) {
      const fila = filas.get(deviceId);
      fila.rodando = true;
      void drenar(deviceId, fila);
    }
    return Promise.all(doLote).then(() => undefined);
  }

  return {
    despachar,
    /** true quando não há comando em execução nem na fila de nenhum aparelho. */
    ocioso: () => emCurso === 0,
  };
}

/**
 * Ciclo de ping do heartbeat. `rodar(devices)` pinga todos em paralelo e
 * resolve com `[{ device, online, motivo }]` (motivo: ver `classificarFalha`).
 *
 * `timeoutMs` é do CICLO, não da chamada ao aparelho: passado o prazo o
 * aparelho é dado como offline (`sem_resposta`) e o ciclo segue, mas o ping
 * real pode continuar em voo até o timeout da LAN. Enquanto isso o aparelho
 * fica FORA dos ciclos seguintes — nunca dois pings sobrepostos no mesmo.
 */
function criarCicloDePing({ pingar, timeoutMs = PING_TIMEOUT_MS, classificar = classificarFalha }) {
  if (typeof pingar !== 'function') throw new Error('criarCicloDePing requer pingar(device)');
  const emVoo = new Set();

  function pingarUm(device) {
    emVoo.add(device.id);
    let timer;
    const prazo = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ online: false, motivo: 'sem_resposta' }), timeoutMs);
      timer.unref?.();
    });
    const real = Promise.resolve()
      .then(() => pingar(device))
      .then(
        (r) => {
          const online = !!(r && r.ok);
          return { online, motivo: online ? null : classificar(r) };
        },
        (err) => ({ online: false, motivo: classificar(err) }),
      )
      .then((res) => {
        emVoo.delete(device.id);
        clearTimeout(timer);
        return res;
      });
    return Promise.race([real, prazo]);
  }

  async function rodar(devices) {
    const alvos = (Array.isArray(devices) ? devices : []).filter(
      (d) => d && d.id != null && !emVoo.has(d.id),
    );
    const resultados = await Promise.allSettled(alvos.map((d) => pingarUm(d)));
    return alvos.map((device, i) => {
      const r = resultados[i];
      return r.status === 'fulfilled'
        ? { device, ...r.value }
        : { device, online: false, motivo: classificar(r.reason) };
    });
  }

  return { rodar };
}

module.exports = {
  criarDespachante,
  criarCicloDePing,
  prazoDoComando,
  PING_TIMEOUT_MS,
  ERRO_EXPIRADO,
};
