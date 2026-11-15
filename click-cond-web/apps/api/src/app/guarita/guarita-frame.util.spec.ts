import {
  blocoParaByte,
  byteParaBloco,
  bytesParaUnidade,
  chaveDedupEvento,
  checksum,
  codificarApagar,
  codificarDispositivo,
  corParaByte,
  decodificarDispositivo,
  decodificarEvento,
  marcaParaByte,
  sanearRotulo,
  unidadeParaBytes,
  wiegandParaSerial,
} from './guarita-frame.util';

/**
 * Decodificador/codificador do lado da API, escrito a partir da referência do
 * protocolo (independente do codec do agente), com os exemplos do documento
 * como vetores. NÃO validado em aparelho.
 */

const hex = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const bytes = (h: string) => Array.from(Buffer.from(hex(h), 'hex'));

describe('checksum (soma dos bytes anteriores, só o byte baixo)', () => {
  it('estouro: soma 0x0145 → 0x45', () => {
    // 0x00 + 0xFF + 0x46 = 0x145
    expect(checksum([0x00, 0xff, 0x46])).toBe(0x45);
  });
  it.each([
    ['00 0C', 0x0c], // comando 12 → 00 0C 0C
    ['00 32 00 1F FF', 0x50], // comando 50, ponteiro 8191 → 00 32 00 1F FF 50
    ['00 0D 03 00 02 01', 0x13], // comando 13, CT, CAN 1, saída 2, gera evento
    ['00 1D 00', 0x1d], // resposta OK do 29
  ])('%s → %s', (frame, cs) => {
    expect(checksum(bytes(frame))).toBe(cs);
  });
});

describe('unidade e bloco', () => {
  it.each([
    [1, [0x00, 0x01]],
    [10, [0x00, 0x0a]],
    [308, [0x03, 0x08]],
    [923, [0x09, 0x17]],
    [1285, [0x0c, 0x55]],
    [9999, [0x63, 0x63]],
  ])('unidade %i → %j (÷100 e resto, binário) e volta', (n, par) => {
    expect(unidadeParaBytes(n)).toEqual(par);
    expect(bytesParaUnidade(par[0], par[1])).toBe(n);
  });

  it.each([[-1], [10000], [1.5], [NaN]])('unidade %p fora de 0..9999 lança', (n) => {
    expect(() => unidadeParaBytes(n)).toThrow();
  });

  it.each([
    ['A', 0x00],
    ['Z', 0x19],
    ['1', 0x1a],
    ['230', 0xff],
    ['b', 0x01],
    ['Bloco C', 0x02],
    [' 12 ', 0x25],
  ])('bloco %p → 0x%s', (b, n) => {
    expect(blocoParaByte(b)).toBe(n);
  });

  it.each([[0x00, 'A'], [0x19, 'Z'], [0x1a, '1'], [0xff, '230']])('byte 0x%s → bloco %p', (n, b) => {
    expect(byteParaBloco(n)).toBe(b);
  });

  it.each([['AA'], ['0'], ['231'], ['Torre Norte'], ['']])('bloco %p inválido lança', (b) => {
    expect(() => blocoParaByte(b)).toThrow();
  });
});

describe('código Wiegand impresso → serial', () => {
  it.each([['W: 015 02158'], ['015 02158'], ['015,02158'], ['015-02158'], ['015.02158'], ['  015  02158 ']])('%p → 0F086E', (s) => {
    expect(wiegandParaSerial(s)).toBe('0F086E');
  });
  it.each([['15 2158'], ['256 00001'], ['015 65536'], ['abc'], [''], ['01502158']])('%p inválido → null', (s) => {
    expect(wiegandParaSerial(s)).toBeNull();
  });
});

describe('rótulo e placa', () => {
  it('maiúsculas, sem acento, só espaço/0-9/A-Z, completa com espaço', () => {
    expect(sanearRotulo("João d'Ávila", 18)).toBe('JOAO D AVILA      ');
    expect(sanearRotulo('abc-1234', 7)).toBe('ABC 123');
    expect(sanearRotulo(null, 7)).toBe('       ');
    expect(sanearRotulo('Maria Conceição dos Santos Pereira', 18)).toBe('MARIA CONCEICAO DO');
  });

  it('marca e cor do Prestare → tabela do Guarita (sem correspondência: VEICULO / 0x00)', () => {
    expect(marcaParaByte('Fiat Uno')).toBe(0x06);
    expect(marcaParaByte('VW Gol')).toBe(0x1d);
    expect(marcaParaByte('Volkswagen T-Cross')).toBe(0x1d);
    expect(marcaParaByte('Chevrolet Onix')).toBe(0x02);
    expect(marcaParaByte('Land Rover Evoque')).toBe(0x10);
    expect(marcaParaByte('Mercedes-Benz C180')).toBe(0x12);
    expect(marcaParaByte('Citroën C3')).toBe(0x04);
    expect(marcaParaByte('Carro do vizinho')).toBe(0x16);
    expect(marcaParaByte(null)).toBe(0x16);
    expect(corParaByte('Prata')).toBe(0x0a);
    expect(corParaByte('branca')).toBe(0x03);
    expect(corParaByte('Vermelha')).toBe(0x0f);
    expect(corParaByte('Grená')).toBe(0x07);
    expect(corParaByte('azul marinho')).toBe(0x01);
    expect(corParaByte('furta-cor')).toBe(0x00);
    expect(corParaByte(undefined)).toBe(0x00);
  });
});

describe('frame de dispositivo (39 bytes)', () => {
  const base = {
    unidade: 308,
    bloco: 'B',
    rotulo: 'ANA SOUZA',
    marca: 0x06,
    cor: 0x0a,
    placa: 'ABC1D23',
    grupo: 0x00,
    receptores: 0xff,
  };

  it('RF: serial de 7 dígitos hex divide o nibble baixo do byte 1 e os bytes 2–4; contador nos bytes 5–6', () => {
    const h = codificarDispositivo({ ...base, tipo: 1, serialHex: '1A2B3C4', contador: 0x0201 });
    const b = bytes(h);
    expect(b).toHaveLength(39);
    expect(b.slice(0, 8)).toEqual([0x11, 0xa2, 0xb3, 0xc4, 0x02, 0x01, 0x03, 0x08]);
    expect(b[8]).toBe(0x01); // bloco B
    expect(b[9]).toBe(0x00); // grupo
    expect(b[10]).toBe(0xff); // receptores
    expect(Buffer.from(b.slice(11, 29)).toString('ascii')).toBe('ANA SOUZA         ');
    expect(b[29]).toBe(0x00);
    expect(b[30]).toBe(0x06);
    expect(b[31]).toBe(0x0a);
    expect(Buffer.from(b.slice(32, 39)).toString('ascii')).toBe('ABC1D23');
  });

  it.each([
    [1, '1A2B3C4', 0x1234],
    [2, '0F086E', 0],
    [3, 'ABCDEF', 0],
    [6, '000001', 0],
  ])('ida e volta tipo %i', (tipo, serialHex, contador) => {
    const h = codificarDispositivo({ ...base, tipo, serialHex, contador });
    expect(h).toMatch(/^[0-9A-F]{78}$/);
    expect(decodificarDispositivo(h)).toEqual({
      tipo,
      serialHex,
      contador,
      unidade: 308,
      bloco: 'B',
      grupo: 0,
      receptores: 0xff,
      rotulo: 'ANA SOUZA',
      portaria: false,
      marca: 0x06,
      cor: 0x0a,
      placa: 'ABC1D23',
      bruto: h,
    });
  });

  it('TA/CT/TP: nibble baixo do byte 1 = 0 e contador zerado mesmo se vier', () => {
    const b = bytes(codificarDispositivo({ ...base, tipo: 2, serialHex: '0F086E', contador: 99 }));
    expect(b.slice(0, 6)).toEqual([0x20, 0x0f, 0x08, 0x6e, 0x00, 0x00]);
  });

  it('edição com o frame lido como base preserva os bytes 10, 11 e 30', () => {
    const lido = bytes(codificarDispositivo({ ...base, tipo: 2, serialHex: '0F086E', contador: 0 }));
    lido[9] = 0x05; // grupo 5
    lido[10] = 0x0b; // receptores 1, 2 e 4
    lido[29] = 0x83; // portaria + bateria (só leitura)
    const baseHex = Buffer.from(lido).toString('hex');
    const editado = bytes(
      codificarDispositivo({ ...base, tipo: 2, serialHex: '0F086E', contador: 0, rotulo: 'NOVO NOME', grupo: 0, receptores: 0xff }, baseHex),
    );
    expect(editado[9]).toBe(0x05);
    expect(editado[10]).toBe(0x0b);
    expect(editado[29]).toBe(0x83);
    expect(Buffer.from(editado.slice(11, 29)).toString('ascii').trim()).toBe('NOVO NOME');
  });

  it('recusa RF sem contador, serial inválido, tipo fora da lista e unidade fora do intervalo', () => {
    expect(() => codificarDispositivo({ ...base, tipo: 1, serialHex: '1A2B3C4', contador: null })).toThrow();
    expect(() => codificarDispositivo({ ...base, tipo: 2, serialHex: 'XYZ', contador: 0 })).toThrow();
    expect(() => codificarDispositivo({ ...base, tipo: 2, serialHex: '1A2B3C4', contador: 0 })).toThrow();
    expect(() => codificarDispositivo({ ...base, tipo: 5, serialHex: '000001', contador: 0 })).toThrow();
    expect(() => codificarDispositivo({ ...base, unidade: 10000, tipo: 2, serialHex: '000001', contador: 0 })).toThrow();
  });

  it('apagar: só tipo + serial (bytes 1–4), resto 0x00', () => {
    expect(codificarApagar(1, '1A2B3C4')).toBe(hex('11 A2 B3 C4') + '00'.repeat(35));
    expect(codificarApagar(3, '0F086E')).toBe(hex('30 0F 08 6E') + '00'.repeat(35));
    expect(() => codificarApagar(7, '000001')).toThrow();
  });
});

describe('frame de evento (16 bytes)', () => {
  // tipo 0 (acionado), RF serial 1A2B3C4, 14:35:07 de 15/11/26, receptor RF CAN 2,
  // unidade 308, bloco B, flags0 = bit7 bateria fraca + botão 2 (01 nos bits 5..4), flags1 = 0.
  const EVT = '01 A2 B3 C4 14 35 07 15 11 26 11 03 08 01 90 00';

  it('decodifica o evento', () => {
    expect(decodificarEvento(hex(EVT))).toEqual({
      tipo: 0,
      serialHex: '1A2B3C4',
      dataHora: { ano: 2026, mes: 11, dia: 15, hora: 14, min: 35, seg: 7 },
      receptorTipo: 1,
      receptorNum: 1,
      unidade: 308,
      bloco: 'B',
      bateriaFraca: true,
      lido: false,
      botao: 2,
      flags0: 0x90,
      flags1: 0x00,
    });
  });

  it('TA: serial de 6 dígitos (o nibble baixo do byte 1 não entra)', () => {
    const e = decodificarEvento(hex('10 0F 08 6E 08 00 00 01 01 26 23 00 01 00 00 AA'));
    expect(e.tipo).toBe(1);
    expect(e.serialHex).toBe('0F086E');
    expect(e.receptorTipo).toBe(2);
    expect(e.receptorNum).toBe(3);
    expect(e.flags1).toBe(0xaa);
  });

  it('chave de deduplicação: igual com o bit "lido" diferente, diferente quando muda o segundo ou o aparelho', () => {
    const lido = hex(EVT.replace(/ 90 00$/, ' D0 00')); // bit 6 ligado
    const outroSegundo = hex(EVT.replace(' 07 15', ' 08 15'));
    const k = chaveDedupEvento(10, hex(EVT));
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveDedupEvento(10, lido)).toBe(k);
    expect(chaveDedupEvento(10, outroSegundo)).not.toBe(k);
    expect(chaveDedupEvento(11, hex(EVT))).not.toBe(k);
    expect(chaveDedupEvento(10, hex(EVT).toLowerCase())).toBe(k);
  });

  it('data BCD inválida não lança: dataHora nula e a chave continua', () => {
    const ruim = hex('01 A2 B3 C4 25 61 07 32 13 26 11 03 08 01 90 00');
    const e = decodificarEvento(ruim);
    expect(e.dataHora).toBeNull();
    expect(e.serialHex).toBe('1A2B3C4');
    expect(chaveDedupEvento(10, ruim)).toMatch(/^[0-9a-f]{64}$/);
    // nibble acima de 9 (0x1A não é BCD)
    expect(decodificarEvento(hex('01 A2 B3 C4 1A 00 00 01 01 26 11 03 08 01 90 00')).dataHora).toBeNull();
  });

  it('frame que não tem 16 bytes lança', () => {
    expect(() => decodificarEvento('00')).toThrow();
    expect(() => chaveDedupEvento(1, 'ZZ'.repeat(16))).toThrow();
  });
});
