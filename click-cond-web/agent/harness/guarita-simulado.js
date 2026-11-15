'use strict';

/**
 * agent/harness/guarita-simulado.js — Módulo Guarita (Nice / Linear-HCS,
 * MG3000) SIMULADO: servidor TCP real em 127.0.0.1 que segue a referência
 * escrita do protocolo, byte a byte. É o ÚNICO oráculo dos testes do driver
 * `linear-guarita` — não existe aparelho real por trás. Nada aqui foi
 * validado em aparelho.
 *
 * Implementação própria e independente do codec do agente (não importa nada
 * de src/drivers/linear): um erro do codec não pode se repetir aqui.
 *
 * Implementa: autorização TCP (palavra / Autorizado / Negado / Timeout);
 * comandos 3, 6, 7, 12, 13 (gera evento tipo 6 com gera_evt), 17 e 70
 * (progressivos com 0x00 / 0xFF, abandono por timeout, fim no 43), 29
 * (responde 0x00 após atraso), 38, 43, 61, 67 (0 cadastra, 1 edita, 3 lê,
 * 4 apaga; 0x01 cheio, 0x02 já existe, 0x03 não existe, 0xFE frame
 * inválido); envio automático de evento (4 ou 40) e de dispositivo não
 * cadastrado (42, 46, 90).
 *
 * Todo frame recebido vai para `recebidos`. Qualquer comando fora da lista
 * branca do driver (ou 67 em opção que não 0/1/3/4, ou bytes que não formam
 * frame) aparece em `comandosProibidosRecebidos()` — os testes exigem que
 * isso fique vazio.
 */

const net = require('node:net');

const LISTA_BRANCA = new Set([3, 6, 7, 12, 13, 17, 29, 38, 43, 61, 67, 70]);
const OPCOES_67_PERMITIDAS = new Set([0, 1, 3, 4]);

// Tamanho TOTAL da pergunta do PC para cada comando documentado (para
// reconhecer — e registrar — inclusive os proibidos).
const TAMANHO_PERGUNTA = {
  1: 23, 2: 23, 3: 3, 5: 3, 6: 4, 7: 3, 8: 3, 9: 35, 10: 3, 11: 9, 12: 3, 13: 7, 14: 4, 15: 17, 16: 5, 17: 4,
  18: 3, 19: 7, 21: 13, 22: 5, 23: 3, 24: 3, 26: 3, 27: 419, 28: 4, 29: 3, 31: 3, 34: 3, 35: 5, 36: 387, 37: 3,
  38: 3, 39: 6, 43: 3, 45: 10, 50: 6, 51: 4, 52: 5, 53: 387, 54: 3, 55: 43, 57: 3, 59: 5, 60: 5, 61: 5, 66: 5,
  67: 43, 69: 3, 70: 3, 75: 6, 77: 5, 79: 3, 80: 6, 81: 4, 82: 6, 83: 941, 84: 18, 85: 24, 86: 4, 87: 4,
  88: 681, 92: 8, 93: 5, 97: 5, 98: 53, 99: 262, 106: 4, 107: 18, 108: 4, 109: 772,
};

const CAPACIDADE_PADRAO = 12000;

function soma(buf) {
  let s = 0;
  for (const b of buf) s = (s + b) % 256;
  return s;
}

function paraBcd(n) {
  return ((Math.floor(n / 10) % 10) << 4) | (n % 10);
}

/** Hora "do Guarita" (horário de Brasília, UTC-3 fixo) a partir de um Date. */
function partesBrasilia(data) {
  const d = new Date(data.getTime() - 3 * 3600 * 1000);
  return {
    dia: d.getUTCDate(),
    mes: d.getUTCMonth() + 1,
    ano: d.getUTCFullYear() % 100,
    hora: d.getUTCHours(),
    min: d.getUTCMinutes(),
    seg: d.getUTCSeconds(),
  };
}

function paraBuf(x) {
  if (Buffer.isBuffer(x)) return Buffer.from(x);
  return Buffer.from(String(x).replace(/\s+/g, ''), 'hex');
}

function textoFixo(s, n) {
  return Buffer.from(String(s || '').padEnd(n, ' ').slice(0, n), 'latin1');
}

const CARACTERE_VALIDO = (b) => b === 0x20 || (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a);

function criarGuaritaSimulado(opcoes = {}) {
  const palavra = typeof opcoes.palavra === 'string' && opcoes.palavra.length > 0 ? opcoes.palavra : null;
  const capacidade = Number.isInteger(opcoes.capacidade) ? opcoes.capacidade : CAPACIDADE_PADRAO;
  const firmware = String(opcoes.firmware || 'G003s').padEnd(5, ' ').slice(0, 5);
  const versaoReceptor = String(opcoes.versaoReceptor || '3000q').padEnd(5, ' ').slice(0, 5);
  const rotulos = opcoes.rotulos || ['CONDOMINIO TESTE', 'GUARITA SIMULADA'];
  const tempos = { autorizacaoMs: 5000, progressivoMs: 5000, atraso29Ms: 0, ...(opcoes.tempos || {}) };
  const modoEvento = opcoes.modoEvento === 40 ? 40 : 4;
  const horaDoGuarita = typeof opcoes.horaDoGuarita === 'function' ? opcoes.horaDoGuarita : () => new Date();
  const gerarEventosDeGravacao = opcoes.gerarEventosDeGravacao === true;

  const memoria = {
    dispositivos: (opcoes.dispositivos || []).map(paraBuf),
    eventos: (opcoes.eventos || []).map(paraBuf),
  };
  const recebidos = [];
  const recebidosInvalidos = [];
  const lixoRecebido = [];
  const palavrasRecebidas = [];
  const continuacoes = [];
  const continuacoesForaDeDialogo = [];
  const falhasPendentes = { silencio: 0, checksumErrado: 0, cairNoMeio: null, respostaDo67: [], respostaDo29: [] };
  let contAt = 0x01;
  const clientes = new Set();
  let servidor = null;
  let conexoesAceitas = 0;

  // ---------- montagem de frames de saída ----------

  function enviar(cli, corpo) {
    if (cli.sock.destroyed) return;
    let cs = soma(corpo);
    if (falhasPendentes.checksumErrado > 0) {
      falhasPendentes.checksumErrado--;
      cs = (cs + 1) % 256;
    }
    cli.sock.write(Buffer.concat([corpo, Buffer.from([cs])]));
    if (falhasPendentes.cairNoMeio !== null) {
      falhasPendentes.cairNoMeio--;
      if (falhasPendentes.cairNoMeio <= 0) {
        falhasPendentes.cairNoMeio = null;
        cli.sock.destroy();
      }
    }
  }

  function chaveDoDispositivo(b) {
    return b.subarray(0, 4).toString('hex');
  }

  function acharDispositivo(chave) {
    return memoria.dispositivos.findIndex((d) => chaveDoDispositivo(d) === chave);
  }

  function eventoNaoLido(evt) {
    return (evt[14] & 0x40) === 0;
  }

  function filtrarEventos(marca) {
    if (marca === 0x00) return memoria.eventos.filter(eventoNaoLido);
    if (marca === 0x01) return memoria.eventos.filter((e) => !eventoNaoLido(e));
    return memoria.eventos.slice();
  }

  function montarEvento({ tipo, serial = [0, 0, 0, 0], receptor = 0, unid = [0, 0], bloco = 0, flags0 = 0, flags1 = 0 }) {
    const p = partesBrasilia(horaDoGuarita());
    const e = Buffer.alloc(16);
    e[0] = ((tipo & 0x0f) << 4) | (serial[0] & 0x0f);
    e[1] = serial[1];
    e[2] = serial[2];
    e[3] = serial[3];
    e[4] = paraBcd(p.hora);
    e[5] = paraBcd(p.min);
    e[6] = paraBcd(p.seg);
    e[7] = paraBcd(p.dia);
    e[8] = paraBcd(p.mes);
    e[9] = paraBcd(p.ano);
    e[10] = receptor;
    e[11] = unid[0];
    e[12] = unid[1];
    e[13] = bloco;
    e[14] = flags0;
    e[15] = flags1;
    return e;
  }

  /** Guarda o evento e manda pelo envio automático a quem estiver conectado. */
  function registrarEEnviarEvento(evt) {
    memoria.eventos.push(Buffer.from(evt));
    const ponteiro = memoria.eventos.length - 1;
    for (const cli of clientes) {
      if (!cli.autorizado) continue;
      if (modoEvento === 40) {
        enviar(cli, Buffer.concat([Buffer.from([0x00, 0x28, (ponteiro >> 8) & 0xff, ponteiro & 0xff, contAt]), evt]));
      } else {
        enviar(cli, Buffer.concat([Buffer.from([0x00, 0x04, contAt]), evt]));
      }
    }
  }

  // ---------- comandos ----------

  function iniciarDialogo(cli, tipo, itens) {
    encerrarDialogo(cli);
    if (itens.length === 0) return;
    cli.dialogo = { tipo, itens, indice: 0, timer: null };
    enviarItemDoDialogo(cli);
  }

  function enviarItemDoDialogo(cli) {
    const d = cli.dialogo;
    if (!d) return;
    enviar(cli, d.itens[d.indice]);
    if (d.timer) clearTimeout(d.timer);
    // Sem pergunta em `progressivoMs`: o Guarita abandona o diálogo.
    d.timer = setTimeout(() => {
      if (cli.dialogo === d) cli.dialogo = null;
    }, tempos.progressivoMs);
  }

  function encerrarDialogo(cli) {
    if (cli.dialogo && cli.dialogo.timer) clearTimeout(cli.dialogo.timer);
    cli.dialogo = null;
  }

  function validarFrameDispositivo(disp, opcao) {
    const tipo = disp[0] >> 4;
    if (![1, 2, 3, 6].includes(tipo)) return false;
    if (tipo !== 1 && (disp[0] & 0x0f) !== 0) return false;
    // Ler (3) e apagar (4) só usam a chave (tipo + serial, bytes 1-4).
    if (opcao === 3 || opcao === 4) return true;
    if (disp[1] === 0 && disp[2] === 0 && disp[3] === 0 && (disp[0] & 0x0f) === 0) return false;
    if (disp[6] > 99 || disp[7] > 99) return false;
    for (let i = 11; i <= 28; i++) if (!CARACTERE_VALIDO(disp[i])) return false;
    for (let i = 32; i <= 38; i++) if (!CARACTERE_VALIDO(disp[i])) return false;
    return true;
  }

  function evento67(disp, flags1) {
    if (!gerarEventosDeGravacao) return;
    registrarEEnviarEvento(
      montarEvento({ tipo: 4, serial: [disp[0] & 0x0f, disp[1], disp[2], disp[3]], unid: [disp[6], disp[7]], bloco: disp[8], flags1 }),
    );
  }

  function tratar67(cli, frame) {
    const opcao = frame[2];
    const disp = Buffer.from(frame.subarray(3, 42));
    const responder = (resposta, extra) =>
      enviar(cli, Buffer.concat([Buffer.from([0x00, 0x43, opcao, resposta]), extra || Buffer.alloc(0)]));
    if (falhasPendentes.respostaDo67.length > 0) {
      responder(falhasPendentes.respostaDo67.shift());
      return;
    }
    if (!OPCOES_67_PERMITIDAS.has(opcao)) {
      // Opção 2 (restaurar) é proibida para o driver; registrada em recebidos.
      responder(0xfe);
      return;
    }
    if (!validarFrameDispositivo(disp, opcao)) {
      responder(0xfe);
      return;
    }
    const i = acharDispositivo(chaveDoDispositivo(disp));
    if (opcao === 0) {
      if (i !== -1) return responder(0x02);
      if (memoria.dispositivos.length >= capacidade) return responder(0x01);
      memoria.dispositivos.push(disp);
      evento67(disp, 0x60);
      return responder(0x00);
    }
    if (opcao === 1) {
      if (i === -1) return responder(0x03);
      memoria.dispositivos[i] = disp;
      evento67(disp, 0x61);
      return responder(0x00);
    }
    if (opcao === 3) {
      if (i === -1) return responder(0x03);
      return responder(0x00, memoria.dispositivos[i]);
    }
    // opcao 4: apagar
    if (i === -1) return responder(0x03);
    const [apagado] = memoria.dispositivos.splice(i, 1);
    evento67(apagado, 0x64);
    return responder(0x00);
  }

  function tratarFrame(cli, frame) {
    const cmd = frame[1];
    switch (cmd) {
      case 3:
        enviar(cli, Buffer.concat([Buffer.from([0x00, 0x03]), textoFixo(rotulos[0], 20), textoFixo(rotulos[1], 20)]));
        break;
      case 6: {
        const marca = frame[2];
        if (marca > 2) return;
        const q = filtrarEventos(marca).length;
        enviar(cli, Buffer.from([0x00, 0x06, marca, (q >> 8) & 0xff, q & 0xff]));
        break;
      }
      case 7: {
        const q = memoria.dispositivos.length;
        enviar(cli, Buffer.from([0x00, 0x07, (q >> 8) & 0xff, q & 0xff]));
        break;
      }
      case 12: {
        const p = partesBrasilia(horaDoGuarita());
        enviar(cli, Buffer.from([0x00, 0x0c, paraBcd(p.dia), paraBcd(p.mes), paraBcd(p.ano), paraBcd(p.hora), paraBcd(p.min), paraBcd(p.seg)]));
        break;
      }
      case 13: {
        // Sem resposta. Com gera_evt = 1: evento tipo 6 (acionamento pelo PC).
        const [tipo, num, saida, geraEvt] = [frame[2], frame[3], frame[4], frame[5]];
        acionamentos.push({ tipo, num, saida, geraEvt });
        if (geraEvt === 0x01 && saida >= 1 && saida <= 4) {
          registrarEEnviarEvento(montarEvento({ tipo: 6, receptor: ((tipo & 0x0f) << 4) | (num & 0x0f), flags0: ((saida - 1) & 0x03) << 4 }));
        }
        break;
      }
      case 17: {
        const marca = frame[2];
        if (marca > 2) return;
        const itens = filtrarEventos(marca).map((e) => Buffer.concat([Buffer.from([0x00, 0x11, marca]), e]));
        iniciarDialogo(cli, 17, itens);
        break;
      }
      case 29: {
        const resposta = falhasPendentes.respostaDo29.length > 0 ? falhasPendentes.respostaDo29.shift() : 0x00;
        const t = setTimeout(() => enviar(cli, Buffer.from([0x00, 0x1d, resposta])), tempos.atraso29Ms);
        cli.timers.add(t);
        break;
      }
      case 38:
        enviar(cli, Buffer.concat([Buffer.from([0x00, 0x26]), Buffer.from(firmware, 'latin1')]));
        break;
      case 43:
        encerrarDialogo(cli);
        break;
      case 61:
        enviar(cli, Buffer.concat([Buffer.from([0x00, 0x3d, frame[2], frame[3]]), Buffer.from(versaoReceptor, 'latin1')]));
        break;
      case 67:
        tratar67(cli, frame);
        break;
      case 70: {
        const itens = memoria.dispositivos.map((d) => Buffer.concat([Buffer.from([0x00, 0x46]), d]));
        iniciarDialogo(cli, 70, itens);
        break;
      }
      default:
        // Comando proibido/desconhecido para o driver: só fica registrado.
        break;
    }
  }

  const acionamentos = [];

  function processar(cli) {
    for (;;) {
      const buf = cli.buf;
      if (buf.length === 0) return;
      if (cli.dialogo) {
        const b0 = buf[0];
        const pareceFrame = b0 === 0x00 && buf.length >= 2 && buf[1] !== 0x00 && buf[1] !== 0xff;
        if (!pareceFrame && (b0 === 0x00 || b0 === 0xff)) {
          const d = cli.dialogo;
          const restam = d.itens.length - d.indice - 1;
          if (b0 === 0x00 && buf.length === 1 && restam === 0) return; // pode ser o começo do 43
          cli.buf = buf.subarray(1);
          continuacoes.push(b0);
          if (b0 === 0xff) {
            enviarItemDoDialogo(cli);
          } else if (restam > 0) {
            d.indice++;
            enviarItemDoDialogo(cli);
          } else {
            encerrarDialogo(cli);
          }
          continue;
        }
      }
      if (buf[0] !== 0x00) {
        lixoRecebido.push(Buffer.from([buf[0]]));
        cli.buf = buf.subarray(1);
        continue;
      }
      if (buf.length < 2) return;
      if (buf[1] === 0x00 || buf[1] === 0xff) {
        // 0x00 de continuação que chegou depois de o diálogo acabar (timeout):
        // o Guarita ignora. Não é comando proibido.
        continuacoesForaDeDialogo.push(buf[0]);
        cli.buf = buf.subarray(1);
        continue;
      }
      const tamanho = TAMANHO_PERGUNTA[buf[1]];
      if (!tamanho) {
        // Não é frame conhecido: registra o resto como lixo (conta como proibido).
        lixoRecebido.push(Buffer.from(buf));
        cli.buf = Buffer.alloc(0);
        return;
      }
      if (buf.length < tamanho) return;
      const frame = Buffer.from(buf.subarray(0, tamanho));
      cli.buf = buf.subarray(tamanho);
      recebidos.push(frame);
      if (soma(frame.subarray(0, tamanho - 1)) !== frame[tamanho - 1]) {
        // Frame incorreto: o Guarita não responde.
        recebidosInvalidos.push(frame);
        continue;
      }
      if (falhasPendentes.silencio > 0) {
        falhasPendentes.silencio--;
        continue;
      }
      // Um frame novo encerra qualquer diálogo que estivesse aberto.
      if (cli.dialogo && frame[1] !== 43) encerrarDialogo(cli);
      tratarFrame(cli, frame);
    }
  }

  function aoDados(cli, chunk) {
    if (!cli.autorizado) {
      cli.bufAuth = Buffer.concat([cli.bufAuth, chunk]);
      const esperado = Buffer.from(palavra, 'latin1');
      const n = Math.min(cli.bufAuth.length, esperado.length);
      if (!cli.bufAuth.subarray(0, n).equals(esperado.subarray(0, n))) {
        palavrasRecebidas.push(Buffer.from(cli.bufAuth));
        clearTimeout(cli.timerAuth);
        cli.sock.end(Buffer.from('Negado\0', 'latin1'));
        setTimeout(() => cli.sock.destroy(), 20);
        return;
      }
      if (cli.bufAuth.length < esperado.length) return;
      palavrasRecebidas.push(Buffer.from(cli.bufAuth.subarray(0, esperado.length)));
      clearTimeout(cli.timerAuth);
      cli.autorizado = true;
      cli.sock.write(Buffer.from('Autorizado\0', 'latin1'));
      chunk = cli.bufAuth.subarray(esperado.length);
      cli.bufAuth = Buffer.alloc(0);
      if (chunk.length === 0) return;
    }
    cli.buf = cli.buf.length ? Buffer.concat([cli.buf, chunk]) : Buffer.from(chunk);
    processar(cli);
  }

  function aoConectar(sock) {
    conexoesAceitas++;
    const cli = { sock, autorizado: !palavra, bufAuth: Buffer.alloc(0), buf: Buffer.alloc(0), dialogo: null, timers: new Set(), timerAuth: null };
    clientes.add(cli);
    sock.setNoDelay(true);
    if (palavra) {
      cli.timerAuth = setTimeout(() => {
        if (!cli.autorizado && !sock.destroyed) {
          sock.end(Buffer.from('Timeout\0', 'latin1'));
          setTimeout(() => sock.destroy(), 20);
        }
      }, tempos.autorizacaoMs);
    }
    sock.on('data', (d) => aoDados(cli, d));
    sock.on('error', () => {});
    sock.on('close', () => {
      clearTimeout(cli.timerAuth);
      encerrarDialogo(cli);
      for (const t of cli.timers) clearTimeout(t);
      clientes.delete(cli);
    });
  }

  // ---------- API do simulador ----------

  function serialEmBytes(tipo, serialHex) {
    const n = parseInt(String(serialHex), 16) || 0;
    return [tipo === 1 ? (n >>> 24) & 0x0f : 0, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  function injetarNaoCadastrado({ comando, tipo = 1, serialHex, contador = 0, num = 0, bateriaFraca = false, botao = 1, leitora = 0 }) {
    const s = serialEmBytes(tipo, serialHex);
    let corpo;
    if (comando === 42) {
      corpo = Buffer.from([0x00, 0x2a, tipo, s[0], s[1], s[2], s[3], (contador >> 8) & 0xff, contador & 0xff, (bateriaFraca ? 0x08 : 0x00) | 0x07]);
    } else if (comando === 46) {
      const flags = tipo === 1 ? contador & 0xff : leitora & 0x07;
      corpo = Buffer.from([0x00, 0x2e, tipo, num, s[0], s[1], s[2], s[3], flags]);
    } else if (comando === 90) {
      corpo = Buffer.from([0x00, 0x5a, 0x01, num, s[0], s[1], s[2], s[3], (contador >> 8) & 0xff, contador & 0xff, 1 << ((botao - 1) & 3), bateriaFraca ? 1 : 0]);
    } else {
      throw new Error('injetarNaoCadastrado: comando deve ser 42, 46 ou 90');
    }
    for (const cli of clientes) if (cli.autorizado) enviar(cli, corpo);
  }

  return {
    memoria,
    recebidos,
    recebidosInvalidos,
    lixoRecebido,
    palavrasRecebidas,
    continuacoes,
    continuacoesForaDeDialogo,
    acionamentos,
    falhas: {
      /** As próximas `n` perguntas não têm resposta nem efeito. */
      silencio: (n = 1) => {
        falhasPendentes.silencio += n;
      },
      /** Os próximos `n` frames enviados saem com checksum errado. */
      checksumErrado: (n = 1) => {
        falhasPendentes.checksumErrado += n;
      },
      /** Derruba a conexão depois de enviar mais `n` frames. */
      cairNoMeio: (n = 1) => {
        falhasPendentes.cairNoMeio = n;
      },
      /** A próxima gravação (67) responde este código, sem mexer na memória. */
      respostaDo67: (codigo) => {
        falhasPendentes.respostaDo67.push(codigo);
      },
      /** A próxima atualização de receptores (29) responde este código. */
      respostaDo29: (codigo) => {
        falhasPendentes.respostaDo29.push(codigo);
      },
    },
    injetarEvento(frame16) {
      const e = paraBuf(frame16);
      if (e.length !== 16) throw new Error('evento tem 16 bytes');
      registrarEEnviarEvento(e);
    },
    injetarNaoCadastrado,
    /** Frames recebidos que o driver NUNCA poderia ter mandado. */
    comandosProibidosRecebidos() {
      const proibidos = recebidos.filter((f) => !LISTA_BRANCA.has(f[1]) || (f[1] === 67 && !OPCOES_67_PERMITIDAS.has(f[2])));
      return [...proibidos, ...lixoRecebido];
    },
    comandosRecebidos: (cmd) => recebidos.filter((f) => f[1] === cmd),
    clientesConectados: () => [...clientes].filter((c) => !c.sock.destroyed).length,
    get conexoesAceitas() {
      return conexoesAceitas;
    },
    /** Derruba as conexões abertas (Guarita reiniciou / cabo). */
    derrubarConexoes() {
      for (const cli of clientes) cli.sock.destroy();
    },
    escutar(porta = 0) {
      return new Promise((resolve, reject) => {
        servidor = net.createServer(aoConectar);
        servidor.once('error', reject);
        servidor.listen(porta, '127.0.0.1', () => resolve({ porta: servidor.address().port }));
      });
    },
    fechar() {
      for (const cli of clientes) cli.sock.destroy();
      return new Promise((resolve) => (servidor ? servidor.close(() => resolve()) : resolve()));
    },
  };
}

module.exports = { criarGuaritaSimulado, CAPACIDADE_PADRAO };
