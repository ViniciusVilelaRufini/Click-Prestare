'use strict';

/**
 * agent/src/drivers/linear/codec.js — codificador/decodificador dos frames do
 * Módulo Guarita (Nice / Linear-HCS, MG3000), protocolo TCP binário.
 *
 * Frame: 0x00 + comando + parâmetros + cs, onde cs = soma dos bytes
 * anteriores mod 256. Multi-byte é big-endian. Construído a partir da
 * documentação do protocolo, NÃO validado em aparelho.
 *
 * LISTA BRANCA: `montar` só produz os comandos de COMANDOS_PERMITIDOS (e o
 * 67 só nas opções 0 cadastrar, 1 editar, 3 ler e 4 apagar). Qualquer outro
 * — formatar, apagar eventos, reiniciar, escrever programação, restaurar em
 * massa, relé avançado (92) — lança antes de existir um byte para escrever.
 * A sessão confere de novo cada frame na hora de escrever (`ehFramePermitido`).
 */

const {
  TIPOS_DISPOSITIVO,
  PARAMETROS_DO_ENVIO,
  TAMANHO_RECEBIDO,
  MAX_EVENTOS_PACOTE,
} = require('./tabelas');

const LISTA_BRANCA = [3, 6, 7, 12, 13, 17, 29, 38, 43, 61, 67, 70];
const OPCOES_67 = new Set([0, 1, 3, 4]);

// Conjunto interno (o que `montar` consulta). O exportado é uma cópia que
// não aceita mudança: um `add(77)` em algum lugar não abre a porta.
const PERMITIDOS_INTERNO = new Set(LISTA_BRANCA);

class ConjuntoSomenteLeitura extends Set {
  constructor(itens) {
    super();
    for (const i of itens) super.add(i);
    Object.freeze(this);
  }
  add() {
    throw new Error('COMANDOS_PERMITIDOS é somente leitura');
  }
  delete() {
    throw new Error('COMANDOS_PERMITIDOS é somente leitura');
  }
  clear() {
    throw new Error('COMANDOS_PERMITIDOS é somente leitura');
  }
}
const COMANDOS_PERMITIDOS = new ConjuntoSomenteLeitura(LISTA_BRANCA);

/** Soma simples dos bytes, mod 256. */
function checksum(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

function paraBuffer(params) {
  if (params == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(params)) return params;
  if (Array.isArray(params)) {
    for (const b of params) {
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error('parâmetro do frame fora de 0..255');
    }
    return Buffer.from(params);
  }
  throw new Error('parâmetro do frame deve ser Buffer ou lista de bytes');
}

function erroValor(msg) {
  return new Error(`Guarita: ${msg}`);
}

/** Confere os valores dos parâmetros de cada comando (além do tamanho). */
function validarParametros(comando, p) {
  switch (comando) {
    case 6:
    case 17:
      if (p[0] > 2) throw erroValor('marca de evento inválida (0 não lidos, 1 lidos, 2 todos)');
      break;
    case 13:
      if (!TIPOS_DISPOSITIVO.includes(p[0])) throw erroValor('tipo de receptor inválido (1 RF, 2 TA, 3 CT, 6 TP)');
      if (p[1] > 7) throw erroValor('receptor inválido (CAN 1 a 8)');
      if (p[2] < 1 || p[2] > 4) throw erroValor('saída inválida (1 a 4)');
      if (p[3] !== 1) throw erroValor('gera_evt tem de ser 1 (a abertura sempre gera evento)');
      break;
    case 61:
      if (!TIPOS_DISPOSITIVO.includes(p[0])) throw erroValor('tipo de receptor inválido (1 RF, 2 TA, 3 CT, 6 TP)');
      if (p[1] > 7) throw erroValor('receptor inválido (CAN 1 a 8)');
      break;
    case 67:
      if (!OPCOES_67.has(p[0])) throw erroValor(`opção ${p[0]} do comando 67 não permitida (só 0, 1, 3 e 4)`);
      break;
    default:
      break;
  }
}

/** Monta o frame de um comando da lista branca. Lança para qualquer outro. */
function montar(comando, params) {
  if (!Number.isInteger(comando) || !PERMITIDOS_INTERNO.has(comando)) {
    throw new Error(`Guarita: comando ${String(comando)} não permitido pelo driver`);
  }
  const p = paraBuffer(params);
  if (p.length !== PARAMETROS_DO_ENVIO[comando]) {
    throw erroValor(
      `comando ${comando} leva ${PARAMETROS_DO_ENVIO[comando]} byte(s) de parâmetro, recebeu ${p.length}`,
    );
  }
  validarParametros(comando, p);
  const corpo = Buffer.concat([Buffer.from([0x00, comando]), p]);
  return Buffer.concat([corpo, Buffer.from([checksum(corpo)])]);
}

/** O buffer é exatamente um frame que `montar` produziria? (segunda trava na escrita) */
function ehFramePermitido(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 3 || buf[0] !== 0x00) return false;
  const comando = buf[1];
  if (!PERMITIDOS_INTERNO.has(comando)) return false;
  if (buf.length !== PARAMETROS_DO_ENVIO[comando] + 3) return false;
  if (checksum(buf.subarray(0, buf.length - 1)) !== buf[buf.length - 1]) return false;
  try {
    validarParametros(comando, buf.subarray(2, buf.length - 1));
  } catch {
    return false;
  }
  return true;
}

/**
 * Tamanho total fixo da resposta/envio automático de um comando. 0 = o
 * comando não tem resposta (13, 43). null = variável (33, 58; 67 sem a opção)
 * ou comando desconhecido.
 */
function tamanhoResposta(comando, ctx = {}) {
  if (comando === 13 || comando === 43) return 0;
  if (comando === 67) {
    if (ctx && Number.isInteger(ctx.opcao67)) return ctx.opcao67 === 3 ? 44 : 5;
    return null;
  }
  const t = TAMANHO_RECEBIDO[comando];
  return typeof t === 'number' ? t : null;
}

/**
 * Para o leitor de fluxo: dado um buffer que começa em 0x00, quanto mede o
 * frame que começa ali?
 *   { estado: 'completo', tamanho } — os `tamanho` primeiros bytes são o
 *       candidato (o checksum ainda é conferido por quem chama);
 *   { estado: 'incompleto' } — faltam bytes para decidir;
 *   { estado: 'desconhecido' } — byte de comando que o driver não sabe receber.
 */
function delimitarFrame(buf, dica) {
  if (buf.length < 2) return { estado: 'incompleto' };
  const comando = buf[1];
  if (dica && dica.comando === comando && Number.isInteger(dica.tamanho) && dica.tamanho >= 3) {
    return buf.length >= dica.tamanho ? { estado: 'completo', tamanho: dica.tamanho } : { estado: 'incompleto' };
  }
  if (!Object.prototype.hasOwnProperty.call(TAMANHO_RECEBIDO, comando)) return { estado: 'desconhecido' };
  const fixo = TAMANHO_RECEBIDO[comando];
  if (typeof fixo === 'number') {
    return buf.length >= fixo ? { estado: 'completo', tamanho: fixo } : { estado: 'incompleto' };
  }
  if (comando === 67) {
    // 00 43 <opcao> <resposta> cs; na leitura (opção 3) com sucesso vem o
    // frame de 39 bytes antes do cs. Ler com erro: a referência não diz —
    // tratamos como 5 bytes (o driver não usa a opção 3).
    if (buf.length < 4) return { estado: 'incompleto' };
    const t = buf[2] === 3 && buf[3] === 0x00 ? 44 : 5;
    return buf.length >= t ? { estado: 'completo', tamanho: t } : { estado: 'incompleto' };
  }
  if (comando === 58) {
    // 00 3A <num> <tipo> <leitora> <tam_h> <tam_l> <template> cs
    if (buf.length < 7) return { estado: 'incompleto' };
    const t = 8 + ((buf[5] << 8) | buf[6]);
    return buf.length >= t ? { estado: 'completo', tamanho: t } : { estado: 'incompleto' };
  }
  if (comando === 33) {
    // Pacote 00 21 [Y × 16] cs SEM contador Y: só dá para delimitar pelo
    // checksum. Aceita o menor Y cujo cs confere e que termina no fim do
    // buffer ou antes de outro 0x00 (início de frame). Ambíguo por natureza:
    // a orientação é manter o envio em pacote desligado no Guarita.
    for (let y = 1; y <= MAX_EVENTOS_PACOTE; y++) {
      const t = 3 + 16 * y;
      if (buf.length < t) return { estado: 'incompleto' };
      if (checksum(buf.subarray(0, t - 1)) === buf[t - 1] && (buf.length === t || buf[t] === 0x00)) {
        return { estado: 'completo', tamanho: t };
      }
    }
    return { estado: 'desconhecido' };
  }
  return { estado: 'desconhecido' };
}

// ---------- unidade, bloco, texto ----------

function unidadeParaBytes(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw erroValor('unidade fora de 0..9999');
  return [Math.floor(n / 100), n % 100];
}

function bytesParaUnidade(hByte, lByte) {
  return hByte * 100 + lByte;
}

function blocoParaByte(b) {
  if (typeof b !== 'string' && typeof b !== 'number') throw erroValor('bloco inválido');
  const s = String(b).trim().toUpperCase();
  if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 0x41;
  if (/^[0-9]{1,3}$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 230) return 0x19 + n;
  }
  throw erroValor(`bloco "${s}" inválido (A a Z ou 1 a 230)`);
}

function byteParaBloco(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw erroValor('byte de bloco inválido');
  return n <= 0x19 ? String.fromCharCode(0x41 + n) : String(n - 0x19);
}

/** Maiúsculas, sem acento, só espaço/0-9/A-Z; corta e completa com espaço. */
function sanearRotulo(s, tamanho) {
  const limpo = String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^ 0-9A-Z]/g, ' ');
  return limpo.slice(0, tamanho).padEnd(tamanho, ' ');
}

function textoAscii(buf) {
  return buf.toString('latin1').replace(/[\x00 ]+$/, '');
}

// ---------- serial ----------

function serialParaBytes(tipo, serialHex) {
  const s = String(serialHex == null ? '' : serialHex).trim().toUpperCase();
  const max = tipo === 1 ? 7 : 6;
  if (!/^[0-9A-F]+$/.test(s) || s.length > max) {
    throw erroValor(`serial "${s}" inválido (${max} dígitos hexadecimais no máximo)`);
  }
  const n = parseInt(s, 16);
  if (n === 0) throw erroValor('serial zerado não é aceito');
  return {
    nibble: tipo === 1 ? (n >>> 24) & 0x0f : 0,
    bytes: [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff],
  };
}

/**
 * Nibble baixo do byte 1 fora do RF: no CT é o <disp_dest> (0 = Guarita, 4 =
 * Catraca 2010, p20) e faz parte da identidade do dispositivo; em TA/TP é
 * sempre 0. `base` (edição) preserva o destino lido quando não vem outro.
 */
function nibbleDoDestino(tipo, dispDest, base) {
  if (tipo === 1) return null; // no RF o nibble é o 1º dígito do serial
  const valor = dispDest === undefined || dispDest === null ? (tipo === 3 && base ? base[0] & 0x0f : 0) : dispDest;
  if (tipo === 3 && (valor === 0 || valor === 4)) return valor;
  if (tipo !== 3 && valor === 0) return 0;
  throw erroValor('destino do cartão inválido (só no CT: 0 Guarita ou 4 Catraca 2010)');
}

function serialDosBytes(eRf, nibble, b2, b1, b0) {
  const n = ((eRf ? nibble & 0x0f : 0) * 0x1000000) + (b2 << 16) + (b1 << 8) + b0;
  return n.toString(16).toUpperCase().padStart(eRf ? 7 : 6, '0');
}

/** "W: 015 02158" / "015,02158" / "015-02158" → "0F086E". */
function wiegandParaSerial(impresso) {
  const m = String(impresso == null ? '' : impresso)
    .trim()
    .match(/^(?:W\s*:\s*)?(\d{3})[ ,-](\d{5})$/i);
  const invalido = () => new Error('Código inválido. Use o formato impresso no cartão: 015 02158.');
  if (!m) throw invalido();
  const alto = Number(m[1]);
  const baixo = Number(m[2]);
  if (alto > 255 || baixo > 65535 || (alto === 0 && baixo === 0)) throw invalido();
  return alto.toString(16).toUpperCase().padStart(2, '0') + baixo.toString(16).toUpperCase().padStart(4, '0');
}

// ---------- frame de dispositivo (39 bytes) ----------

function decodificarDispositivo(frame39) {
  if (!Buffer.isBuffer(frame39) || frame39.length !== 39) throw erroValor('frame de dispositivo tem de ter 39 bytes');
  const b = frame39;
  const tipo = b[0] >> 4;
  const eRf = tipo === 1;
  return {
    tipo,
    serialHex: serialDosBytes(eRf, b[0], b[1], b[2], b[3]),
    contador: (b[4] << 8) | b[5],
    dispDest: tipo === 3 ? b[0] & 0x0f : 0,
    unidade: bytesParaUnidade(b[6], b[7]),
    bloco: byteParaBloco(b[8]),
    grupo: b[9],
    receptores: b[10],
    rotulo: textoAscii(b.subarray(11, 29)),
    portaria: (b[29] & 0x80) !== 0,
    marca: b[30],
    cor: b[31],
    placa: textoAscii(b.subarray(32, 39)),
    bruto: b.toString('hex').toUpperCase(),
  };
}

/**
 * Frame de 39 bytes para cadastrar/editar. `base39` (o frame lido do Guarita,
 * na edição) preserva os bytes 10 (grupo), 11 (receptores) e 30 (flags).
 * Sem base: grupo `d.grupo` (padrão 0x00 livre) e receptores `d.receptores`
 * (padrão 0xFF todos); byte 30 = 0x00.
 */
function codificarDispositivo(d, base39) {
  if (!d || typeof d !== 'object') throw erroValor('dados do dispositivo ausentes');
  if (base39 !== undefined && base39 !== null && (!Buffer.isBuffer(base39) || base39.length !== 39)) {
    throw erroValor('base de edição tem de ser o frame de 39 bytes lido do Guarita');
  }
  const tipo = d.tipo;
  if (!TIPOS_DISPOSITIVO.includes(tipo)) throw erroValor('tipo de dispositivo inválido (1 RF, 2 TA, 3 CT, 6 TP)');
  const serial = serialParaBytes(tipo, d.serialHex);
  // Fora do RF o contador é 0, exceto na edição: o CT Visitante leva "VI"
  // (0x56 0x49) nos bytes 5-6 e isso é preservado do frame lido.
  let contador = base39 ? (base39[4] << 8) | base39[5] : 0;
  if (tipo === 1) {
    if (!Number.isInteger(d.contador) || d.contador < 0 || d.contador > 0xffff) {
      throw erroValor('controle remoto (RF) exige o contador capturado (0..65535)');
    }
    contador = d.contador;
  }
  const marca = d.marca == null ? 0x16 : d.marca;
  const cor = d.cor == null ? 0x00 : d.cor;
  if (!Number.isInteger(marca) || marca < 0 || marca > 0x3f) throw erroValor('marca inválida (0x00..0x3F)');
  if (!Number.isInteger(cor) || cor < 0 || cor > 0x0f) throw erroValor('cor inválida (0x00..0x0F)');
  const grupo = base39 ? base39[9] : d.grupo == null ? 0x00 : d.grupo;
  const receptores = base39 ? base39[10] : d.receptores == null ? 0xff : d.receptores;
  if (!Number.isInteger(grupo) || grupo < 0 || grupo > 0x0f) throw erroValor('grupo inválido (0..15)');
  if (!Number.isInteger(receptores) || receptores < 0 || receptores > 0xff) throw erroValor('receptores inválidos');
  const [uh, ul] = unidadeParaBytes(d.unidade);

  const b = Buffer.alloc(39, 0x00);
  const destino = nibbleDoDestino(tipo, d.dispDest, base39);
  b[0] = (tipo << 4) | (destino === null ? serial.nibble : destino);
  b[1] = serial.bytes[0];
  b[2] = serial.bytes[1];
  b[3] = serial.bytes[2];
  b[4] = contador >> 8;
  b[5] = contador & 0xff;
  b[6] = uh;
  b[7] = ul;
  b[8] = blocoParaByte(d.bloco);
  b[9] = grupo;
  b[10] = receptores;
  Buffer.from(sanearRotulo(d.rotulo, 18), 'latin1').copy(b, 11);
  b[29] = base39 ? base39[29] : 0x00;
  b[30] = marca;
  b[31] = cor;
  Buffer.from(sanearRotulo(d.placa, 7), 'latin1').copy(b, 32);
  return b;
}

/** Frame de 39 bytes para APAGAR: só tipo + serial (bytes 1-4), resto 0x00. */
function codificarApagar(tipo, serialHex, dispDest) {
  if (!TIPOS_DISPOSITIVO.includes(tipo)) throw erroValor('tipo de dispositivo inválido (1 RF, 2 TA, 3 CT, 6 TP)');
  const serial = serialParaBytes(tipo, serialHex);
  const destino = nibbleDoDestino(tipo, dispDest);
  const b = Buffer.alloc(39, 0x00);
  b[0] = (tipo << 4) | (destino === null ? serial.nibble : destino);
  b[1] = serial.bytes[0];
  b[2] = serial.bytes[1];
  b[3] = serial.bytes[2];
  return b;
}

// ---------- frame de evento (16 bytes) ----------

function bcd(byte, min, max) {
  const alto = byte >> 4;
  const baixo = byte & 0x0f;
  if (alto > 9 || baixo > 9) return null;
  const v = alto * 10 + baixo;
  return v < min || v > max ? null : v;
}

function dataDoEvento(b) {
  const hora = bcd(b[4], 0, 23);
  const min = bcd(b[5], 0, 59);
  const seg = bcd(b[6], 0, 59);
  const dia = bcd(b[7], 1, 31);
  const mes = bcd(b[8], 1, 12);
  const ano = bcd(b[9], 0, 99);
  if ([hora, min, seg, dia, mes, ano].some((v) => v === null)) return null;
  return { ano: 2000 + ano, mes, dia, hora, min, seg };
}

/**
 * Chave de deduplicação: bytes 1-14 + byte 15 SEM o bit 6 ("lido") + byte
 * 16, em hex. O mesmo evento lido ao vivo (não lido) e depois na recuperação
 * (já lido) dá a mesma chave. Quem acrescenta o aparelho é a API.
 */
function chaveDoEvento(b) {
  const c = Buffer.from(b);
  c[14] &= 0xbf;
  return c.toString('hex').toUpperCase();
}

function decodificarEvento(frame16) {
  if (!Buffer.isBuffer(frame16) || frame16.length !== 16) throw erroValor('frame de evento tem de ter 16 bytes');
  const b = frame16;
  const tipo = b[0] >> 4;
  const receptorTipo = b[10] >> 4;
  const receptorNum = b[10] & 0x0f;
  const eRf = receptorTipo === 1;
  const baixo = b[0] & 0x0f;
  const tipoDispositivo = !eRf && (baixo === 5 || baixo === 7) ? baixo : receptorTipo;
  const flags0 = b[14];
  return {
    tipo,
    serialHex: serialDosBytes(eRf, b[0], b[1], b[2], b[3]),
    tipoDispositivo,
    dataHora: dataDoEvento(b),
    receptorTipo,
    receptorNum,
    unidade: bytesParaUnidade(b[11], b[12]),
    bloco: byteParaBloco(b[13]),
    // Bit 7 = bateria (RF/TA); no tipo 1 (passagem) o mesmo bit quer dizer
    // "passagem sem sentido" e não é bateria.
    bateriaFraca: tipo !== 1 && (receptorTipo === 1 || receptorTipo === 2) && (flags0 & 0x80) !== 0,
    lido: (flags0 & 0x40) !== 0,
    botao: ((flags0 >> 4) & 0x03) + 1,
    flags0,
    flags1: b[15],
    chaveDedup: chaveDoEvento(b),
  };
}

module.exports = {
  COMANDOS_PERMITIDOS,
  checksum,
  montar,
  ehFramePermitido,
  tamanhoResposta,
  delimitarFrame,
  decodificarEvento,
  decodificarDispositivo,
  codificarDispositivo,
  codificarApagar,
  wiegandParaSerial,
  unidadeParaBytes,
  bytesParaUnidade,
  blocoParaByte,
  byteParaBloco,
  sanearRotulo,
};
