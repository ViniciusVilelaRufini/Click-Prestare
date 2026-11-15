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
// Leitura progressiva interrompida para o relé passar recomeça do zero, no
// máximo este tanto de vezes; depois falha e fica para a próxima tentativa.
const MAX_RECOMECOS = 5;

async function comRecomeco(ler, oQue) {
  for (let recomecos = 0; ; recomecos++) {
    try {
      return await ler();
    } catch (e) {
      if (!e || e.codigo !== 'interrompida') throw e;
      if (recomecos >= MAX_RECOMECOS) {
        const falha = new Error(
          `Leitura de ${oQue} do Guarita interrompida ${MAX_RECOMECOS + 1} vezes para abrir o portão; fica para a próxima tentativa.`,
        );
        falha.codigo = 'interrompida_demais';
        throw falha;
      }
    }
  }
}

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
  return comRecomeco(() => lerDispositivosUmaVez(sessao), 'dispositivos');
}

async function lerDispositivosUmaVez(sessao) {
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
  return comRecomeco(() => lerEventosUmaVez(sessao), 'eventos');
}

async function lerEventosUmaVez(sessao) {
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
    const falha = { ok: false, codigo: null, mensagem: mensagemDeErro(e) };
    // Recusado antes de escrever (sessão já fechada): o Guarita nem viu.
    if (e && e.codigo === 'desconectado') falha.naoEnviado = true;
    return falha;
  }
  const codigo = dados[1];
  const base = { ok: codigo === 0x00, codigo, mensagem: mensagemDoCodigo(codigo) };
  // Operação repetida (agente reiniciou, resposta perdida, nuvem reentregou):
  // o objetivo pode já estar atendido.
  if (tipo === 'apagar' && codigo === 0x03) {
    return { ok: true, codigo, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' };
  }
  if (tipo === 'cadastrar' && codigo === 0x02) {
    const lido = await lerDispositivo(sessao, frame);
    if (!lido) return base;
    // Mesmo tipo + serial (a chave) e mesma unidade/bloco (bytes 7, 8 e 9).
    if (lido[6] === frame[6] && lido[7] === frame[7] && lido[8] === frame[8]) {
      return { ok: true, codigo, ja_estava: true, mensagem: 'Este dispositivo já estava cadastrado no Guarita.' };
    }
    return { ok: false, codigo, mensagem: 'Este dispositivo já está cadastrado no Guarita em outra unidade.' };
  }
  return base;
}

/**
 * Comando 67 opção 3 (Ler) pela chave (tipo + serial, bytes 1-4; resto
 * 0x00). Devolve o frame de 39 bytes lido, ou null (não existe / sem
 * resposta — sem resposta derruba a sessão, ver SessaoGuarita).
 */
async function lerDispositivo(sessao, frame) {
  const chave = Buffer.alloc(39, 0x00);
  frame.copy(chave, 0, 0, 4);
  let dados;
  try {
    dados = await sessao.comando(67, Buffer.concat([Buffer.from([0x03]), chave]), { timeoutMs: TIMEOUT_67_MS });
  } catch {
    return null;
  }
  if (dados.length !== 41 || dados[1] !== 0x00) return null;
  const lido = dados.subarray(2, 41);
  return lido.subarray(0, 4).equals(chave.subarray(0, 4)) ? Buffer.from(lido) : null;
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
  // Prioritário: passa na frente da fila e interrompe leitura progressiva.
  await sessao.comando(13, [tipoReceptor, numReceptor - 1, rele, 0x01], { semResposta: true, prazoNaFilaMs, prioritario: true });
}

module.exports = {
  identificar,
  lerTodosDispositivos,
  lerTodosEventos,
  gravar,
  lerDispositivo,
  atualizarReceptores,
  acionarRele,
  deltaDoRelogio,
  MENSAGENS_67,
  MSG_SEM_RESPOSTA,
  MSG_QUEDA_NA_GRAVACAO,
  MAX_RECOMECOS,
};
