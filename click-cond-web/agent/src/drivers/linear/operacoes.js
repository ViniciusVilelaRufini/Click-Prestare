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
 * Chave do dispositivo (identidade): byte 1 INTEIRO + bytes 2-4, como veio no
 * frame — no CT o nibble baixo é o <disp_dest> e faz parte dela. TA/TP: o
 * nibble baixo é sempre 0 (zerado aqui, como no demo da Nice).
 */
function chaveDoFrame(frame) {
  const chave = Buffer.alloc(39, 0x00);
  frame.copy(chave, 0, 0, 4);
  const tipo = chave[0] >> 4;
  if (tipo === 2 || tipo === 6) chave[0] &= 0xf0;
  return chave;
}

/**
 * 67 opção 3 (Ler) pela chave, usando `exec(numero, params, opts)` (o
 * comando da sessão ou de uma sequência). → { existe, frame? }. Erro (sem
 * resposta derruba a sessão) propaga.
 */
async function lerPelaChave(exec, frame) {
  const chave = chaveDoFrame(frame);
  const dados = await exec(67, Buffer.concat([Buffer.from([0x03]), chave]), { timeoutMs: TIMEOUT_67_MS });
  if (dados.length === 41 && dados[1] === 0x00 && dados.subarray(2, 6).equals(chave.subarray(0, 4))) {
    return { existe: true, frame: Buffer.from(dados.subarray(2, 41)) };
  }
  if (dados[1] === 0x03) return { existe: false };
  throw new Error(mensagemDoCodigo(dados[1]));
}

/** Frame de 39 bytes lido, ou null (não existe / sem resposta). */
async function lerDispositivo(sessao, frame) {
  try {
    const r = await lerPelaChave((n, p, o) => sessao.comando(n, p, o), frame);
    return r.existe ? r.frame : null;
  } catch {
    return null;
  }
}

const unidadeDe = (f) => f[6] * 100 + f[7];
/** O que foi lido do Guarita, como vai no resultado: unidade, bloco e os 39 bytes. */
const lidoDe = (f) => ({ unidade: unidadeDe(f), bloco: f[8], frame_hex: paraHex(f) });

function esperadoValido(e) {
  return (
    !!e &&
    typeof e === 'object' &&
    Number.isInteger(e.unidade) && e.unidade >= 0 && e.unidade <= 9999 &&
    Number.isInteger(e.bloco) && e.bloco >= 0 && e.bloco <= 255
  );
}

function falhaDeComando(e, { escreveu = false } = {}) {
  const falha = { ok: false, codigo: null, mensagem: mensagemDeErro(e) };
  // Recusado antes de escrever (sessão já fechada): o Guarita nem viu.
  if (e && e.codigo === 'desconectado') falha.naoEnviado = true;
  // A escrita saiu e a resposta não veio: pode ter gravado. Quem chama
  // confere depois de reconectar (conferirGravacao).
  else if (escreveu && e && (e.codigo === 'sem_resposta' || e.codigo === 'queda')) falha.escritoSemResposta = true;
  return falha;
}

const MSG_NAO_GRAVADO = 'O Guarita não respondeu e o dispositivo não foi gravado.';
const MSG_NAO_APAGADO = 'O Guarita não respondeu e o dispositivo não foi apagado.';
const MSG_INCERTO = 'Não foi possível confirmar no Guarita.';
const MSG_CONFIRMADO = 'Confirmado no Guarita depois da reconexão.';

/** Iguais, ignorando o que é só leitura no byte 30 (último acionamento e bateria). */
function mesmoFrameGravavel(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  x[29] &= 0x80;
  y[29] &= 0x80;
  return x.equals(y);
}

/**
 * Desfecho de uma gravação que SAIU e ficou sem resposta (a sessão caiu):
 * numa sessão nova, lê o dispositivo (67/3) e decide pelo que está no
 * Guarita. Leitura impossível → incerto.
 */
async function conferirGravacao(sessao, { tipo, frameHex } = {}) {
  const frame = Buffer.from(String(frameHex || ''), 'hex');
  if (frame.length !== 39) return { ok: false, codigo: null, incerto: true, mensagem: MSG_INCERTO };
  let r;
  try {
    r = await lerPelaChave((n, p, o) => sessao.comando(n, p, o), frame);
  } catch {
    return { ok: false, codigo: null, incerto: true, mensagem: MSG_INCERTO };
  }
  if (tipo === 'apagar') {
    if (!r.existe) return { ok: true, codigo: null, ja_estava: true, mensagem: MSG_CONFIRMADO };
    return { ok: false, codigo: null, lido: lidoDe(r.frame), mensagem: MSG_NAO_APAGADO };
  }
  if (!r.existe) return { ok: false, codigo: null, mensagem: MSG_NAO_GRAVADO };
  const lido = lidoDe(r.frame);
  if (tipo === 'editar') {
    return mesmoFrameGravavel(r.frame, frame)
      ? { ok: true, codigo: null, lido, mensagem: MSG_CONFIRMADO }
      : { ok: false, codigo: null, lido, mensagem: MSG_NAO_GRAVADO };
  }
  // cadastrar: mesma unidade, mesmo bloco e, no RF, o mesmo contador.
  const eRf = frame[0] >> 4 === 1;
  const mesmoContador = !eRf || (r.frame[4] === frame[4] && r.frame[5] === frame[5]);
  if (lido.unidade === unidadeDe(frame) && lido.bloco === frame[8] && mesmoContador) {
    return { ok: true, codigo: null, ja_estava: true, lido, mensagem: MSG_CONFIRMADO };
  }
  return {
    ok: false,
    codigo: null,
    conflito: true,
    lido,
    mensagem: 'Este dispositivo já está cadastrado no Guarita em outra unidade.',
  };
}

/**
 * Comando 67. Cadastro e edição mandam o frame de 39 bytes inteiro; apagar
 * manda só a chave (byte 1 + bytes 2-4), o resto zerado aqui mesmo.
 * `ok` só com a resposta 0x00 (ou objetivo comprovadamente já atendido).
 *
 * Editar e apagar exigem `esperado: { unidade, bloco }` e LEEM antes de
 * escrever, na mesma vez da sessão (nenhum comando no meio): dispositivo em
 * outra unidade nunca é tocado (`conflito`), e sem `esperado` nada é
 * escrito.
 */
async function gravar(sessao, { tipo, frameHex, esperado } = {}) {
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
  if (tipo === 'cadastrar') return cadastrar(sessao, frame);
  if (!esperadoValido(esperado)) {
    return { ok: false, codigo: null, mensagem: 'Operação sem unidade esperada.' };
  }
  if (tipo === 'apagar') {
    // Só a chave: byte 1 inteiro (CT mantém o disp_dest; TA/TP zera o nibble) + bytes 2-4.
    chaveDoFrame(frame).copy(frame);
  }
  let escreveu = false;
  try {
    return await sessao.sequencia(async (seq) => {
      const exec = (n, p, o) => seq.comando(n, p, o);
      const lido = await lerPelaChave(exec, frame);
      if (!lido.existe) {
        if (tipo === 'apagar') {
          return { ok: true, codigo: null, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' };
        }
        return { ok: false, codigo: 0x03, mensagem: mensagemDoCodigo(0x03) };
      }
      const atual = lidoDe(lido.frame);
      if (atual.unidade !== esperado.unidade || atual.bloco !== esperado.bloco) {
        return {
          ok: false,
          codigo: null,
          conflito: true,
          lido: atual,
          mensagem: 'Este dispositivo está cadastrado no Guarita em outra unidade.',
        };
      }
      escreveu = true;
      const dados = await exec(67, Buffer.concat([Buffer.from([OPCAO_POR_TIPO[tipo]]), frame]), { timeoutMs: TIMEOUT_67_MS });
      const codigo = dados[1];
      if (tipo === 'apagar' && codigo === 0x03) {
        return { ok: true, codigo, ja_estava: true, mensagem: 'O dispositivo já não estava no Guarita.' };
      }
      return { ok: codigo === 0x00, codigo, mensagem: mensagemDoCodigo(codigo) };
    });
  } catch (e) {
    // Sem resposta no Ler: a sessão caiu e NADA foi escrito. Na escrita: pode ter gravado.
    return falhaDeComando(e, { escreveu });
  }
}

async function cadastrar(sessao, frame) {
  let dados;
  try {
    dados = await sessao.comando(67, Buffer.concat([Buffer.from([OPCAO_POR_TIPO.cadastrar]), frame]), {
      timeoutMs: TIMEOUT_67_MS,
    });
  } catch (e) {
    return falhaDeComando(e, { escreveu: true });
  }
  const codigo = dados[1];
  const base = { ok: codigo === 0x00, codigo, mensagem: mensagemDoCodigo(codigo) };
  if (codigo !== 0x02) return base;
  // Já aprendido (agente reiniciou, resposta perdida, nuvem reentregou):
  // confere pelo Ler se o objetivo já está atendido.
  const lido = await lerDispositivo(sessao, frame);
  if (!lido) return base;
  const atual = lidoDe(lido);
  // ja_estava só com a mesma unidade, o mesmo bloco e, no RF, o mesmo contador.
  const eRf = frame[0] >> 4 === 1;
  const mesmoContador = !eRf || (lido[4] === frame[4] && lido[5] === frame[5]);
  if (atual.unidade === unidadeDe(frame) && atual.bloco === frame[8] && mesmoContador) {
    return { ok: true, codigo, ja_estava: true, lido: atual, mensagem: 'Este dispositivo já estava cadastrado no Guarita.' };
  }
  return {
    ok: false,
    codigo,
    conflito: true,
    lido: atual,
    mensagem: 'Este dispositivo já está cadastrado no Guarita em outra unidade.',
  };
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
  chaveDoFrame,
  conferirGravacao,
  MSG_INCERTO,
  atualizarReceptores,
  acionarRele,
  deltaDoRelogio,
  MENSAGENS_67,
  MSG_SEM_RESPOSTA,
  MSG_QUEDA_NA_GRAVACAO,
  MAX_RECOMECOS,
};
