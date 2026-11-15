'use strict';

/**
 * agent/src/drivers/linear/operacoes.js — operações de alto nível sobre uma
 * SessaoGuarita já conectada: identificar, importar dispositivos, recuperar
 * eventos, gravar (cadastrar/editar/apagar), atualizar receptores e acionar
 * relé.
 *
 * Regras (plano da integração, Global Constraints):
 *   - Leitura que não completa a contagem é FALHA: nunca devolve lista
 *     parcial como se fosse o cadastro inteiro.
 *   - `ok` na gravação só com a resposta 0x00 do Guarita. Silêncio, queda ou
 *     qualquer outro código = `ok: false` com mensagem clara.
 *   - O relógio do Guarita não é acertado: só lido, e a diferença vai junto.
 *   - Relé: um clique = um frame do comando 13 (nunca o 92), com gera_evt.
 *
 * Construído pela documentação do protocolo, NÃO validado em aparelho.
 */

const { TIPOS_DISPOSITIVO } = require('./tabelas');

const MENSAGENS_67 = Object.freeze({
  0x00: 'ok',
  0x01: 'Memória do Guarita cheia.',
  0x02: 'Este dispositivo já está cadastrado no Guarita.',
  0x03: 'Dispositivo não encontrado no Guarita.',
  0xfe: 'O Guarita recusou os dados do dispositivo.',
});
const MSG_SEM_RESPOSTA = 'O Guarita não respondeu.';
const MSG_QUEDA_NA_GRAVACAO = 'A conexão com o Guarita caiu antes da confirmação.';
const OPCAO_POR_TIPO = Object.freeze({ cadastrar: 0x00, editar: 0x01, apagar: 0x04 });
const TIMEOUT_29_MS = 180000;
const TIMEOUT_67_MS = 5000;

const textoDe = (buf) => buf.toString('latin1').replace(/[\x00 ]+$/, '');
const paraHex = (buf) => Buffer.from(buf).toString('hex').toUpperCase();

function bcd(byte) {
  const a = byte >> 4;
  const b = byte & 0x0f;
  return a > 9 || b > 9 ? null : a * 10 + b;
}

/**
 * Diferença (s) entre o relógio do Guarita e a hora do agente, a partir da
 * resposta do comando 12 (dia mês ano hora min seg, BCD, horário de
 * Brasília — UTC-3 fixo desde 2019). Positivo = Guarita adiantado. Data
 * ilegível → null.
 */
function deltaDoRelogio(dados12, agoraMs) {
  if (!dados12 || dados12.length !== 6) return null;
  const [dia, mes, ano, hora, min, seg] = [...dados12].map(bcd);
  if ([dia, mes, ano, hora, min, seg].some((v) => v === null)) return null;
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || hora > 23 || min > 59 || seg > 59) return null;
  const guaritaMs = Date.UTC(2000 + ano, mes - 1, dia, hora + 3, min, seg);
  return Math.round((guaritaMs - agoraMs) / 1000);
}

async function identificar(sessao, { agora = () => Date.now() } = {}) {
  const versao = await sessao.comando(38);
  const rotulos = await sessao.comando(3);
  const quantDisp = await sessao.comando(7);
  const quantEvt = await sessao.comando(6, [0x02]);
  const relogio = await sessao.comando(12);
  return {
    firmware: textoDe(versao),
    rotulos: [textoDe(rotulos.subarray(0, 20)), textoDe(rotulos.subarray(20, 40))],
    totalDispositivos: (quantDisp[0] << 8) | quantDisp[1],
    totalEventos: (quantEvt[1] << 8) | quantEvt[2],
    relogioDeltaS: deltaDoRelogio(relogio, agora()),
  };
}

async function contarDispositivos(sessao) {
  const r = await sessao.comando(7);
  return (r[0] << 8) | r[1];
}

/**
 * Todo o cadastro do Guarita (hex de 39 bytes cada): 7 (quantidade) → 70
 * progressivo → 43. Lança se não vierem todos, ou se a quantidade mudar
 * durante a leitura (alguém cadastrou no teclado no meio): nunca parcial.
 */
async function lerTodosDispositivos(sessao) {
  const quantidade = await contarDispositivos(sessao);
  if (quantidade === 0) return [];
  const lista = [];
  for await (const dados of sessao.lerProgressivo(70, [], quantidade)) {
    if (dados.length !== 39) throw new Error('Guarita mandou frame de dispositivo com tamanho errado.');
    // Marcador de fim todo 0xFF: tolerado, mas antes da contagem é falha.
    if (dados.every((b) => b === 0xff)) break;
    lista.push(paraHex(dados));
  }
  if (lista.length !== quantidade) {
    throw new Error(`Leitura incompleta do Guarita: ${lista.length} de ${quantidade} dispositivos.`);
  }
  const depois = await contarDispositivos(sessao);
  if (depois !== quantidade) {
    throw new Error(`O cadastro do Guarita mudou durante a leitura (${quantidade} → ${depois}); leia de novo.`);
  }
  return lista;
}

/** Todos os eventos da memória (hex de 16 bytes): 6 (0x02) → 17 (0x02) progressivo → 43. */
async function lerTodosEventos(sessao) {
  const r = await sessao.comando(6, [0x02]);
  const quantidade = (r[1] << 8) | r[2];
  if (quantidade === 0) return [];
  const lista = [];
  for await (const dados of sessao.lerProgressivo(17, [0x02], quantidade)) {
    if (dados.length !== 17) throw new Error('Guarita mandou frame de evento com tamanho errado.');
    lista.push(paraHex(dados.subarray(1)));
  }
  if (lista.length !== quantidade) {
    throw new Error(`Leitura incompleta do Guarita: ${lista.length} de ${quantidade} eventos.`);
  }
  return lista;
}

function mensagemDoCodigo(codigo) {
  return Object.prototype.hasOwnProperty.call(MENSAGENS_67, codigo)
    ? MENSAGENS_67[codigo]
    : `O Guarita respondeu um código desconhecido (0x${codigo.toString(16).toUpperCase().padStart(2, '0')}).`;
}

function mensagemDeErro(e) {
  if (e && e.codigo === 'sem_resposta') return MSG_SEM_RESPOSTA;
  if (e && (e.codigo === 'queda' || e.codigo === 'desconectado' || e.codigo === 'fechada')) return MSG_QUEDA_NA_GRAVACAO;
  return (e && e.message) || String(e);
}

/**
 * Comando 67. Cadastro e edição mandam o frame de 39 bytes inteiro; apagar
 * manda só tipo + serial (bytes 1-4), o resto zerado aqui mesmo.
 * `ok` só com a resposta 0x00.
 */
async function gravar(sessao, { tipo, frameHex } = {}) {
  if (!Object.prototype.hasOwnProperty.call(OPCAO_POR_TIPO, tipo)) {
    return { ok: false, codigo: null, mensagem: `Operação de gravação desconhecida: ${tipo}.` };
  }
  if (typeof frameHex !== 'string' || !/^[0-9a-fA-F]{78}$/.test(frameHex)) {
    return { ok: false, codigo: null, mensagem: 'Frame do dispositivo inválido (esperado: 39 bytes em hex).' };
  }
  const frame = Buffer.from(frameHex, 'hex');
  if (!TIPOS_DISPOSITIVO.includes(frame[0] >> 4)) {
    return { ok: false, codigo: null, mensagem: 'Tipo de dispositivo não suportado (só RF, TA, CT e TP).' };
  }
  if (tipo === 'apagar') frame.fill(0x00, 4);
  let dados;
  try {
    dados = await sessao.comando(67, Buffer.concat([Buffer.from([OPCAO_POR_TIPO[tipo]]), frame]), {
      timeoutMs: TIMEOUT_67_MS,
    });
  } catch (e) {
    return { ok: false, codigo: null, mensagem: mensagemDeErro(e) };
  }
  const codigo = dados[1];
  return { ok: codigo === 0x00, codigo, mensagem: mensagemDoCodigo(codigo) };
}

/** Comando 29 (atualizar receptores): a resposta só chega no fim, até 180 s. */
async function atualizarReceptores(sessao) {
  let dados;
  try {
    dados = await sessao.comando(29, [], { timeoutMs: TIMEOUT_29_MS });
  } catch (e) {
    return { ok: false, codigo: null, mensagem: mensagemDeErro(e) };
  }
  const codigo = dados[0];
  return {
    ok: codigo === 0x00,
    codigo,
    mensagem: codigo === 0x00 ? 'ok' : 'O Guarita informou erro ao atualizar os receptores.',
  };
}

/**
 * Comando 13 com gera_evt = 1. `numReceptor` é o endereço CAN 1..8 (o byte
 * do protocolo é 0..7); `rele` é a saída 1..4. Valores fora da faixa lançam
 * antes de escrever qualquer byte.
 */
async function acionarRele(sessao, { tipoReceptor, numReceptor, rele } = {}, { prazoNaFilaMs } = {}) {
  if (!TIPOS_DISPOSITIVO.includes(tipoReceptor)) {
    throw new Error('Tipo de receptor inválido (1 RF, 2 TA, 3 CT, 6 TP).');
  }
  if (!Number.isInteger(numReceptor) || numReceptor < 1 || numReceptor > 8) {
    throw new Error('Receptor inválido (endereço CAN 1 a 8).');
  }
  if (!Number.isInteger(rele) || rele < 1 || rele > 4) {
    throw new Error('Relé inválido (saída 1 a 4).');
  }
  await sessao.comando(13, [tipoReceptor, numReceptor - 1, rele, 0x01], { semResposta: true, prazoNaFilaMs });
}

module.exports = {
  identificar,
  lerTodosDispositivos,
  lerTodosEventos,
  gravar,
  atualizarReceptores,
  acionarRele,
  deltaDoRelogio,
  MENSAGENS_67,
  MSG_SEM_RESPOSTA,
  MSG_QUEDA_NA_GRAVACAO,
};
