import { createHash } from 'crypto';

/**
 * Frames do Módulo Guarita no lado da API — escrito a partir da referência do
 * protocolo (frame de dispositivo de 39 bytes e de evento de 16 bytes),
 * independente do codec do agente. NÃO validado em aparelho.
 *
 * A API não fala com o Guarita: monta os 39 bytes que o agente põe no comando
 * 67, lê os frames que o agente devolve da importação e decodifica os eventos.
 *
 * Bytes numerados como no documento (1 = primeiro); nos arrays, índice = byte − 1.
 */

/** Soma simples dos bytes anteriores do frame; só o byte baixo vale. */
export function checksum(bytes: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s += bytes[i] & 0xff;
  return s & 0xff;
}

const TIPOS_ACEITOS = [1, 2, 3, 6];

function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

function paraBytes(h: string, tamanho: number, nome: string): number[] {
  if (typeof h !== 'string') throw new Error(`${nome}: esperado hex`);
  const limpo = h.trim();
  if (limpo.length !== tamanho * 2 || !/^[0-9a-fA-F]+$/.test(limpo)) {
    throw new Error(`${nome}: esperado ${tamanho} bytes em hex`);
  }
  return Array.from(Buffer.from(limpo, 'hex'));
}

function paraHex(b: number[]): string {
  return b.map(hex2).join('');
}

// --------------------------------------------------------- unidade e bloco

/** Unidade 0..9999 → [unidade ÷ 100, unidade mod 100], binário (308 → 03 08; 1285 → 0C 55). */
export function unidadeParaBytes(n: number): [number, number] {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error('Unidade fora de 0 a 9999');
  return [Math.floor(n / 100), n % 100];
}

export function bytesParaUnidade(h: number, l: number): number {
  return (h & 0xff) * 100 + (l & 0xff);
}

/**
 * Bloco do Prestare → byte do Guarita: letra A..Z = 0x00..0x19; número
 * 1..230 = 0x1A..0xFF. Aceita "Bloco A", caixa baixa e espaços nas pontas.
 */
export function blocoParaByte(bloco: string): number {
  const s = String(bloco ?? '')
    .trim()
    .toUpperCase()
    .replace(/^BLOCO\s*/, '')
    .replace(/\s+/g, '');
  if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 0x41;
  if (/^\d{1,3}$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 230) return 0x19 + n;
  }
  throw new Error('Bloco não cabe no Guarita (A a Z ou 1 a 230)');
}

export function byteParaBloco(n: number): string {
  const b = n & 0xff;
  return b <= 0x19 ? String.fromCharCode(0x41 + b) : String(b - 0x19);
}

// ---------------------------------------------------- código impresso

/**
 * Código Wiegand impresso nos cartões/chaveiros ("W: 015 02158", com espaço,
 * vírgula ou traço) → serial: 3 dígitos → 1 byte; 5 dígitos → 2 bytes.
 * 015 02158 → 0F 086E → "0F086E". Inválido → null.
 */
export function wiegandParaSerial(impresso: string): string | null {
  if (typeof impresso !== 'string') return null;
  const m = /^\s*(?:W\s*:?\s*)?(\d{1,3})\s*[\s,.-]\s*(\d{1,5})\s*$/i.exec(impresso);
  if (!m) return null;
  const alto = Number(m[1]);
  const baixo = Number(m[2]);
  if (alto > 0xff || baixo > 0xffff) return null;
  return hex2(alto) + baixo.toString(16).toUpperCase().padStart(4, '0');
}

// ------------------------------------------------------ texto do frame

/**
 * Rótulo (18) e placa (7) só aceitam espaço, 0-9 e A-Z: maiúsculas, sem
 * acento, o resto vira espaço (espaços seguidos viram um), cortado e
 * completado com espaço.
 */
export function sanearRotulo(texto: string | null | undefined, tamanho: number): string {
  const s = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^ 0-9A-Z]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
  return s.slice(0, tamanho).padEnd(tamanho, ' ');
}

/** Tabela de marcas do frame de dispositivo (byte 31). */
export const MARCAS_GUARITA: Record<string, number> = {
  AUDI: 0x00, BMW: 0x01, CHEVROLET: 0x02, CHRYSLER: 0x03, CITROEN: 0x04, FERRARI: 0x05, FIAT: 0x06,
  FORD: 0x07, GM: 0x08, HONDA: 0x09, HYUNDAI: 0x0a, IMPORTADO: 0x0b, JAGUAR: 0x0c, JEEP: 0x0d, KIA: 0x0e,
  LAMBORGHINI: 0x0f, 'LAND ROVER': 0x10, MAZDA: 0x11, MERCEDES: 0x12, MITSUBISHI: 0x13, MOTO: 0x14,
  NISSAN: 0x15, VEICULO: 0x16, PEUGEOT: 0x17, PORSCHE: 0x18, RENAULT: 0x19, SUBARU: 0x1a, SUZUKI: 0x1b,
  TOYOTA: 0x1c, VOLKSWAGEN: 0x1d, VOLVO: 0x1e, 'SEM VEICULO': 0x1f,
};
/** "Veículo" genérico: marca sem correspondência na tabela. */
export const MARCA_VEICULO = 0x16;

const ALIASES_MARCA: Record<string, string> = {
  VW: 'VOLKSWAGEN',
  'MERCEDES BENZ': 'MERCEDES',
  BENZ: 'MERCEDES',
  CHEVY: 'CHEVROLET',
  LANDROVER: 'LAND ROVER',
  CITROËN: 'CITROEN',
};

/** Tabela de cores (byte 32). */
export const CORES_GUARITA: Record<string, number> = {
  AMARELO: 0x00, AZUL: 0x01, BEGE: 0x02, BRANCO: 0x03, CINZA: 0x04, DOURADO: 0x05, FANTASIA: 0x06,
  GRENA: 0x07, LARANJA: 0x08, MARROM: 0x09, PRATA: 0x0a, PRETO: 0x0b, ROSA: 0x0c, ROXO: 0x0d,
  VERDE: 0x0e, VERMELHO: 0x0f,
};

function palavras(texto: string | null | undefined): string {
  return ` ${sanearRotulo(texto, 120).trim()} `;
}

/** Marca/modelo livre do Prestare ("Fiat Uno", "VW Gol") → byte da tabela; sem correspondência → VEICULO. */
export function marcaParaByte(marcaModelo: string | null | undefined): number {
  const p = palavras(marcaModelo);
  for (const [alias, marca] of Object.entries(ALIASES_MARCA)) {
    if (p.includes(` ${sanearRotulo(alias, 40).trim()} `)) return MARCAS_GUARITA[marca];
  }
  const nomes = Object.keys(MARCAS_GUARITA).sort((a, b) => b.length - a.length);
  for (const nome of nomes) {
    if (nome === 'VEICULO' || nome === 'SEM VEICULO') continue;
    if (p.includes(` ${nome} `)) return MARCAS_GUARITA[nome];
  }
  return MARCA_VEICULO;
}

/** Cor livre do Prestare ("Prata", "branca") → byte da tabela; sem correspondência → 0x00. */
export function corParaByte(cor: string | null | undefined): number {
  const p = palavras(cor);
  for (const [nome, n] of Object.entries(CORES_GUARITA)) {
    // Masculino e feminino: BRANCO/BRANCA, PRETO/PRETA, VERMELHO/VERMELHA...
    const raiz = /O$/.test(nome) ? nome.slice(0, -1) : nome;
    const re = new RegExp(` ${raiz}${raiz === nome ? '' : '[OA]'}S? `);
    if (re.test(p)) return n;
  }
  return 0x00;
}

// ------------------------------------------------ frame de dispositivo

/** Frame de dispositivo (39 bytes) decodificado. */
export interface DispositivoGuarita {
  tipo: number;
  /** RF: 7 dígitos hex (nibble baixo do byte 1 + bytes 2–4); demais: 6. */
  serialHex: string;
  contador: number;
  unidade: number;
  bloco: string;
  grupo: number;
  receptores: number;
  rotulo: string;
  portaria: boolean;
  marca: number;
  cor: number;
  placa: string;
  /** Os 39 bytes em hex maiúsculo (78 caracteres). */
  bruto: string;
}

function serialDoFrame(tipoOuReceptor: number, b0: number, b1: number, b2: number, b3: number): string {
  const seis = hex2(b1) + hex2(b2) + hex2(b3);
  return tipoOuReceptor === 1 ? (b0 & 0x0f).toString(16).toUpperCase() + seis : seis;
}

export function decodificarDispositivo(frame: string): DispositivoGuarita {
  const b = paraBytes(frame, 39, 'frame de dispositivo');
  const tipo = b[0] >> 4;
  return {
    tipo,
    serialHex: serialDoFrame(tipo, b[0], b[1], b[2], b[3]),
    contador: (b[4] << 8) | b[5],
    unidade: bytesParaUnidade(b[6], b[7]),
    bloco: byteParaBloco(b[8]),
    grupo: b[9],
    receptores: b[10],
    rotulo: Buffer.from(b.slice(11, 29)).toString('latin1').trimEnd(),
    portaria: (b[29] & 0x80) !== 0,
    marca: b[30],
    cor: b[31],
    placa: Buffer.from(b.slice(32, 39)).toString('latin1').trimEnd(),
    bruto: paraHex(b),
  };
}

/** Dados para gravar um dispositivo (comando 67, cadastrar ou editar). */
export interface DadosDispositivo {
  tipo: number;
  serialHex: string;
  /** Obrigatório no RF (vem da captura); ignorado nos demais (0x0000). */
  contador: number | null;
  unidade: number;
  /** Texto ("A", "12") ou o byte do bloco já convertido (unidadeGuaritaDoTexto). */
  bloco: string | number;
  rotulo: string;
  marca: number;
  cor: number;
  placa: string;
  /** Byte 10. Na edição vale o do frame lido (`base`). */
  grupo: number;
  /** Byte 11. Na edição vale o do frame lido (`base`). */
  receptores: number;
}

/** Valida tipo + serial e devolve os bytes 1–4. */
function bytesDoSerial(tipo: number, serialHex: string): number[] {
  if (!TIPOS_ACEITOS.includes(tipo)) throw new Error('Tipo de dispositivo não suportado (RF, TA, CT ou TP)');
  const s = String(serialHex ?? '').trim().toUpperCase();
  const tamanho = tipo === 1 ? 7 : 6;
  if (s.length !== tamanho || !/^[0-9A-F]+$/.test(s)) throw new Error('Serial inválido');
  const seis = tipo === 1 ? s.slice(1) : s;
  const nibble = tipo === 1 ? parseInt(s[0], 16) : 0;
  const [b1, b2, b3] = Array.from(Buffer.from(seis, 'hex'));
  if (tipo !== 1 && b1 === 0 && b2 === 0 && b3 === 0) throw new Error('Serial inválido');
  return [(tipo << 4) | nibble, b1, b2, b3];
}

/**
 * Monta os 39 bytes (hex maiúsculo). Com `base` (o frame lido do Guarita, na
 * edição), os bytes 10 (grupo), 11 (receptores) e 30 (flags, só leitura)
 * ficam como estavam no Guarita; o resto vem de `d`. Sem `base` (cadastro),
 * byte 30 = 0x00.
 */
export function codificarDispositivo(d: DadosDispositivo, base?: string | null): string {
  const b = new Array<number>(39).fill(0);
  const [b0, b1, b2, b3] = bytesDoSerial(d.tipo, d.serialHex);
  b[0] = b0;
  b[1] = b1;
  b[2] = b2;
  b[3] = b3;
  if (d.tipo === 1) {
    if (!Number.isInteger(d.contador) || (d.contador as number) < 0 || (d.contador as number) > 0xffff) {
      throw new Error('Controle remoto sem contador');
    }
    b[4] = ((d.contador as number) >> 8) & 0xff;
    b[5] = (d.contador as number) & 0xff;
  }
  const [uh, ul] = unidadeParaBytes(d.unidade);
  b[6] = uh;
  b[7] = ul;
  if (typeof d.bloco === 'number') {
    if (!Number.isInteger(d.bloco) || d.bloco < 0 || d.bloco > 0xff) throw new Error('Bloco não cabe no Guarita');
    b[8] = d.bloco;
  } else {
    b[8] = blocoParaByte(d.bloco);
  }
  b[9] = d.grupo & 0xff;
  b[10] = d.receptores & 0xff;
  const rotulo = sanearRotulo(d.rotulo, 18);
  for (let i = 0; i < 18; i++) b[11 + i] = rotulo.charCodeAt(i);
  b[29] = 0x00;
  b[30] = d.marca & 0xff;
  b[31] = d.cor & 0xff;
  const placa = sanearRotulo(d.placa, 7);
  for (let i = 0; i < 7; i++) b[32 + i] = placa.charCodeAt(i);
  if (base) {
    const lido = paraBytes(base, 39, 'frame base');
    b[9] = lido[9];
    b[10] = lido[10];
    b[29] = lido[29];
    // Fora do RF, a identidade é o byte 1 INTEIRO (o nibble baixo do CT é o
    // disp_dest) e os bytes 5–6 guardam o "VI" do CT Visitante: ficam como lidos.
    if (d.tipo !== 1 && lido[0] >> 4 === d.tipo && lido[1] === b[1] && lido[2] === b[2] && lido[3] === b[3]) {
      b[0] = lido[0];
      b[4] = lido[4];
      b[5] = lido[5];
    }
  }
  return paraHex(b);
}

/**
 * Apagar a partir do frame conhecido (lido/confirmado): bytes 1–4 como estão
 * no Guarita (inclusive o nibble baixo do byte 1 do CT), o resto 0x00.
 */
export function codificarApagarDoFrame(frame: string): string {
  const lido = paraBytes(frame, 39, 'frame conhecido');
  const tipo = lido[0] >> 4;
  if (!TIPOS_ACEITOS.includes(tipo)) throw new Error('Tipo de dispositivo não suportado (RF, TA, CT ou TP)');
  const b = new Array<number>(39).fill(0);
  for (let i = 0; i < 4; i++) b[i] = lido[i];
  return paraHex(b);
}

/** Apagar (67, opção 4): só tipo + serial (bytes 1–4); o resto 0x00. */
export function codificarApagar(tipo: number, serialHex: string): string {
  const b = new Array<number>(39).fill(0);
  const s = bytesDoSerial(tipo, serialHex);
  for (let i = 0; i < 4; i++) b[i] = s[i];
  return paraHex(b);
}

// ---------------------------------------------------- frame de evento

export interface DataHoraGuarita {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  min: number;
  seg: number;
}

/** Frame de evento (16 bytes) decodificado. */
export interface EventoGuarita {
  /** Nibble alto do byte 1: 0 acionado, 1 passagem, ... F porteiro eletrônico. */
  tipo: number;
  /** Receptor RF: 7 dígitos; demais: 6. */
  serialHex: string;
  /** null quando o BCD do relógio veio inválido (o evento bruto continua valendo). */
  dataHora: DataHoraGuarita | null;
  /** Nibble alto do byte 11: 1 RF, 2 TA, 3 CT, 6 TP. */
  receptorTipo: number;
  /** Nibble baixo do byte 11: 0..7 = CAN 1..8. */
  receptorNum: number;
  unidade: number;
  bloco: string;
  /** flags0 bit 7 (bateria, só faz sentido com RF/TA nos tipos 0 e 9). */
  bateriaFraca: boolean;
  /** flags0 bit 6 (marcação de lido; NÃO entra na deduplicação). */
  lido: boolean;
  /** flags0 bits 5..4 + 1 (botão/leitora 1..4). */
  botao: number;
  flags0: number;
  flags1: number;
}

function bcd(n: number, min: number, max: number): number | null {
  const alto = n >> 4;
  const baixo = n & 0x0f;
  if (alto > 9 || baixo > 9) return null;
  const v = alto * 10 + baixo;
  return v < min || v > max ? null : v;
}

export function decodificarEvento(frame: string): EventoGuarita {
  const b = paraBytes(frame, 16, 'frame de evento');
  const receptorTipo = b[10] >> 4;
  const hora = bcd(b[4], 0, 23);
  const min = bcd(b[5], 0, 59);
  const seg = bcd(b[6], 0, 59);
  const dia = bcd(b[7], 1, 31);
  const mes = bcd(b[8], 1, 12);
  const ano = bcd(b[9], 0, 99);
  let dataHora: DataHoraGuarita | null = null;
  if (hora !== null && min !== null && seg !== null && dia !== null && mes !== null && ano !== null) {
    const d = new Date(Date.UTC(2000 + ano, mes - 1, dia));
    // 31/02 não existe: confere que o dia "não rolou" para o mês seguinte.
    if (d.getUTCMonth() === mes - 1) dataHora = { ano: 2000 + ano, mes, dia, hora, min, seg };
  }
  return {
    tipo: b[0] >> 4,
    serialHex: serialDoFrame(receptorTipo, b[0], b[1], b[2], b[3]),
    dataHora,
    receptorTipo,
    receptorNum: b[10] & 0x0f,
    unidade: bytesParaUnidade(b[11], b[12]),
    bloco: byteParaBloco(b[13]),
    bateriaFraca: (b[14] & 0x80) !== 0,
    lido: (b[14] & 0x40) !== 0,
    botao: ((b[14] >> 4) & 0x03) + 1,
    flags0: b[14],
    flags1: b[15],
  };
}

/**
 * Chave de deduplicação do evento: sha256 de (aparelho + bytes 1–14 + byte 15
 * sem o bit 6 "lido" + byte 16). O mesmo evento visto ao vivo e relido na
 * recuperação (já marcado como lido) dá a mesma chave.
 */
export function chaveDedupEvento(idDevice: number, frame: string): string {
  const b = paraBytes(frame, 16, 'frame de evento');
  const semLido = [...b.slice(0, 14), b[14] & 0xbf, b[15]];
  return createHash('sha256').update(`${idDevice}:${paraHex(semLido)}`).digest('hex');
}

/**
 * Data/hora do evento (relógio do Guarita, horário de Brasília, UTC−3 fixo)
 * corrigida pela diferença do relógio: `deltaS` = hora do Guarita − hora do
 * agente, em segundos. Sem data válida → null.
 */
export function dataDoEvento(dataHora: DataHoraGuarita | null, deltaS: number | null | undefined): Date | null {
  if (!dataHora) return null;
  const utc = Date.UTC(dataHora.ano, dataHora.mes - 1, dataHora.dia, dataHora.hora + 3, dataHora.min, dataHora.seg);
  const delta = Number.isFinite(deltaS as number) ? (deltaS as number) : 0;
  return new Date(utc - delta * 1000);
}
