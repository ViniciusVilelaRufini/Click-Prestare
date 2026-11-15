'use strict';

/**
 * agent/src/drivers/linear/codec.js — frames do Módulo Guarita (Nice/Linear).
 *
 * Os vetores vêm da referência do protocolo (checksum, unidade, bloco,
 * código impresso) e foram calculados à mão: nenhum deles sai do próprio
 * codec. NÃO validado em aparelho.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../src/drivers/linear/codec');

const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();
const h = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

test('checksum: soma simples mod 256, com estouro (0x0145 → 0x45)', () => {
  assert.equal(codec.checksum(h('FF 46')), 0x45);
  assert.equal(codec.checksum(h('00 32 00 1F FF')), 0x50);
  assert.equal(codec.checksum(h('00 0C')), 0x0c);
  assert.equal(codec.checksum(Buffer.alloc(0)), 0);
});

test('montar: frames da referência escritos à mão', () => {
  assert.equal(hex(codec.montar(12)), '000C0C');
  assert.equal(hex(codec.montar(13, [0x03, 0x00, 0x02, 0x01])), '000D0300020113');
  assert.equal(hex(codec.montar(43)), '002B2B');
  assert.equal(hex(codec.montar(70)), '004646');
  assert.equal(hex(codec.montar(7)), '000707');
  assert.equal(hex(codec.montar(29)), '001D1D');
  assert.equal(hex(codec.montar(6, [0x02])), '00060208');
  assert.equal(hex(codec.montar(17, [0x02])), '00110213');
  assert.equal(hex(codec.montar(3)), '000303');
  assert.equal(hex(codec.montar(38)), '002626');
  assert.equal(hex(codec.montar(61, [0x01, 0x00])), '003D01003E');
});

test('montar: comandos proibidos lançam (77 formatar, 8 apagar eventos, 92, e todos os da lista negra)', () => {
  const proibidos = [0, 1, 2, 4, 5, 8, 9, 10, 11, 14, 15, 16, 18, 19, 20, 21, 23, 24, 35, 36, 39, 45, 50, 51, 53, 54,
    55, 57, 59, 60, 69, 74, 77, 80, 82, 83, 84, 85, 88, 92, 98, 99, 106, 107, 109, 255, 256, -1, 1.5, '13', null, undefined];
  for (const c of proibidos) {
    assert.throws(() => codec.montar(c), /não permitido/, `comando ${c}`);
  }
});

test('COMANDOS_PERMITIDOS: é exatamente a lista branca do plano e não aceita inclusão nem remoção', () => {
  assert.deepEqual([...codec.COMANDOS_PERMITIDOS].sort((a, b) => a - b), [3, 6, 7, 12, 13, 17, 29, 38, 43, 61, 67, 70]);
  assert.throws(() => codec.COMANDOS_PERMITIDOS.add(77));
  assert.throws(() => codec.COMANDOS_PERMITIDOS.delete(13));
  assert.throws(() => codec.COMANDOS_PERMITIDOS.clear());
  assert.equal(codec.COMANDOS_PERMITIDOS.has(77), false);
  assert.throws(() => codec.montar(77), /não permitido/);
  assert.equal(codec.COMANDOS_PERMITIDOS.size, 12);
});

test('montar 67: só opções 0, 1, 3 e 4 (2 = restauração em massa, proibida) e frame de 39 bytes', () => {
  const disp = Buffer.alloc(39);
  for (const op of [0, 1, 3, 4]) {
    const f = codec.montar(67, Buffer.concat([Buffer.from([op]), disp]));
    assert.equal(f.length, 43);
    assert.equal(f[2], op);
  }
  assert.throws(() => codec.montar(67, Buffer.concat([Buffer.from([2]), disp])), /opção/);
  assert.throws(() => codec.montar(67, Buffer.concat([Buffer.from([5]), disp])), /opção/);
  assert.throws(() => codec.montar(67, Buffer.from([0])), /parâmetro/);
});

test('montar: parâmetros com tamanho ou valor errado lançam antes de virar frame', () => {
  assert.throws(() => codec.montar(13, [0x03, 0x00, 0x02]), /parâmetro/);
  assert.throws(() => codec.montar(13, [0x03, 0x00, 0x05, 0x01]), /saída/); // só 1..4
  assert.throws(() => codec.montar(13, [0x03, 0x08, 0x01, 0x01]), /receptor/); // CAN 0..7
  assert.throws(() => codec.montar(13, [0x04, 0x00, 0x01, 0x01]), /tipo/);
  assert.throws(() => codec.montar(13, [0x03, 0x00, 0x01, 0x00]), /gera_evt/);
  assert.throws(() => codec.montar(6, [0x03]), /marca/);
  assert.throws(() => codec.montar(17, [0x05]), /marca/);
  assert.throws(() => codec.montar(7, [0x00]), /parâmetro/);
});

test('ehFramePermitido: confere comando, tamanho, opção do 67 e checksum', () => {
  assert.equal(codec.ehFramePermitido(h('000C0C')), true);
  assert.equal(codec.ehFramePermitido(h('000C0D')), false); // cs errado
  assert.equal(codec.ehFramePermitido(h('004D55AA4C')), false); // 77
  assert.equal(codec.ehFramePermitido(h('00')), false);
  const restaurar = Buffer.concat([h('0043 02'), Buffer.alloc(39)]);
  assert.equal(codec.ehFramePermitido(Buffer.concat([restaurar, Buffer.from([codec.checksum(restaurar)])])), false);
});

test('tamanhoResposta: tamanhos totais da tabela de comandos', () => {
  assert.equal(codec.tamanhoResposta(3), 43);
  assert.equal(codec.tamanhoResposta(6), 6);
  assert.equal(codec.tamanhoResposta(7), 5);
  assert.equal(codec.tamanhoResposta(12), 9);
  assert.equal(codec.tamanhoResposta(17), 20);
  assert.equal(codec.tamanhoResposta(29), 4);
  assert.equal(codec.tamanhoResposta(38), 8);
  assert.equal(codec.tamanhoResposta(61), 10);
  assert.equal(codec.tamanhoResposta(70), 42);
  assert.equal(codec.tamanhoResposta(4), 20);
  assert.equal(codec.tamanhoResposta(40), 22);
  assert.equal(codec.tamanhoResposta(42), 11);
  assert.equal(codec.tamanhoResposta(46), 10);
  assert.equal(codec.tamanhoResposta(90), 13);
  assert.equal(codec.tamanhoResposta(13), 0); // sem resposta
  assert.equal(codec.tamanhoResposta(43), 0);
  assert.equal(codec.tamanhoResposta(67, { opcao67: 0 }), 5);
  assert.equal(codec.tamanhoResposta(67, { opcao67: 3 }), 44);
  assert.equal(codec.tamanhoResposta(67), null);
  assert.equal(codec.tamanhoResposta(33), null);
});

test('unidade: unid_h = unidade ÷ 100 e unid_l = resto, binário (exemplos da referência)', () => {
  assert.deepEqual(codec.unidadeParaBytes(1), [0x00, 0x01]);
  assert.deepEqual(codec.unidadeParaBytes(10), [0x00, 0x0a]);
  assert.deepEqual(codec.unidadeParaBytes(308), [0x03, 0x08]);
  assert.deepEqual(codec.unidadeParaBytes(923), [0x09, 0x17]);
  assert.deepEqual(codec.unidadeParaBytes(1285), [0x0c, 0x55]);
  assert.deepEqual(codec.unidadeParaBytes(9999), [0x63, 0x63]);
  assert.equal(codec.bytesParaUnidade(0x0c, 0x55), 1285);
  assert.equal(codec.bytesParaUnidade(0x63, 0x63), 9999);
  assert.throws(() => codec.unidadeParaBytes(10000));
  assert.throws(() => codec.unidadeParaBytes(-1));
  assert.throws(() => codec.unidadeParaBytes(1.5));
});

test('bloco: A..Z = 0x00..0x19; 1..230 = 0x1A..0xFF', () => {
  assert.equal(codec.blocoParaByte('A'), 0x00);
  assert.equal(codec.blocoParaByte('z'), 0x19);
  assert.equal(codec.blocoParaByte(' B '), 0x01);
  assert.equal(codec.blocoParaByte('1'), 0x1a);
  assert.equal(codec.blocoParaByte('230'), 0xff);
  assert.equal(codec.byteParaBloco(0x00), 'A');
  assert.equal(codec.byteParaBloco(0x19), 'Z');
  assert.equal(codec.byteParaBloco(0x1a), '1');
  assert.equal(codec.byteParaBloco(0xff), '230');
  for (const ruim of ['', '0', '231', 'AA', 'Ç', '1A', null]) {
    assert.throws(() => codec.blocoParaByte(ruim), undefined, String(ruim));
  }
});

test('wiegandParaSerial: "W: 015 02158" → 0F086E, com espaço, vírgula ou traço', () => {
  assert.equal(codec.wiegandParaSerial('W: 015 02158'), '0F086E');
  assert.equal(codec.wiegandParaSerial('015 02158'), '0F086E');
  assert.equal(codec.wiegandParaSerial('015,02158'), '0F086E');
  assert.equal(codec.wiegandParaSerial('015-02158'), '0F086E');
  assert.equal(codec.wiegandParaSerial('w:015 02158'), '0F086E');
  assert.equal(codec.wiegandParaSerial('255 65535'), 'FFFFFF');
  for (const ruim of ['256 00001', '015 65536', '15 02158', '015 2158', '01502158', 'abc defgh', '', '000 00000']) {
    assert.throws(() => codec.wiegandParaSerial(ruim), /Código inválido/, ruim);
  }
});

test('sanearRotulo: maiúsculas, sem acento, só espaço/0-9/A-Z, completa com espaço', () => {
  assert.equal(codec.sanearRotulo("João d'Ávila", 18), 'JOAO D AVILA      ');
  assert.equal(codec.sanearRotulo('abc-1234', 7), 'ABC 123');
  assert.equal(codec.sanearRotulo('', 7), '       ');
  assert.equal(codec.sanearRotulo(null, 3), '   ');
  assert.equal(codec.sanearRotulo('Çãé', 5), 'CAE  ');
  assert.match(codec.sanearRotulo('a{}~ç#@!', 18), /^[ 0-9A-Z]{18}$/);
});

// Frame de dispositivo montado à mão a partir da tabela de bytes (seção 4.2).
// RF, serial 1A2B3C4 (7 dígitos: nibble baixo do byte 1 + bytes 2-4),
// contador 0x1234, unidade 308, bloco B, grupo 0, receptores 0xFF,
// rótulo "MARIA", byte 30 = 0x00, marca FIAT (0x06), cor PRATA (0x0A), placa ABC1D23.
function frameRfManual() {
  const b = Buffer.alloc(39, 0x20);
  b[0] = 0x11; b[1] = 0xa2; b[2] = 0xb3; b[3] = 0xc4;
  b[4] = 0x12; b[5] = 0x34;
  b[6] = 0x03; b[7] = 0x08;
  b[8] = 0x01; b[9] = 0x00; b[10] = 0xff;
  Buffer.from('MARIA').copy(b, 11);
  b[29] = 0x00; b[30] = 0x06; b[31] = 0x0a;
  Buffer.from('ABC1D23').copy(b, 32);
  return b;
}

test('decodificarDispositivo: RF com 7 dígitos de serial e contador', () => {
  const d = codec.decodificarDispositivo(frameRfManual());
  assert.equal(d.tipo, 1);
  assert.equal(d.serialHex, '1A2B3C4');
  assert.equal(d.contador, 0x1234);
  assert.equal(d.unidade, 308);
  assert.equal(d.bloco, 'B');
  assert.equal(d.grupo, 0);
  assert.equal(d.receptores, 0xff);
  assert.equal(d.rotulo, 'MARIA');
  assert.equal(d.portaria, false);
  assert.equal(d.marca, 0x06);
  assert.equal(d.cor, 0x0a);
  assert.equal(d.placa, 'ABC1D23');
  assert.equal(d.bruto, hex(frameRfManual()));
});

test('codificarDispositivo: RF divide o 1º dígito do serial no nibble baixo do byte 1 e confere com o frame manual', () => {
  const f = codec.codificarDispositivo({
    tipo: 1, serialHex: '1a2b3c4', contador: 0x1234, unidade: 308, bloco: 'B',
    rotulo: 'Maria', marca: 0x06, cor: 0x0a, placa: 'abc-1d23', grupo: 0, receptores: 0xff,
  });
  // placa saneada: "abc-1d23" → "ABC 1D2" (7 caracteres); o resto confere byte a byte.
  const esperado = frameRfManual();
  Buffer.from('ABC 1D2').copy(esperado, 32);
  assert.equal(hex(f), hex(esperado));
  assert.equal(f[0], 0x11);
  assert.deepEqual([...f.subarray(1, 4)], [0xa2, 0xb3, 0xc4]);
});

test('ida e volta codificar/decodificar para RF, TA, CT e TP', () => {
  const casos = [
    { tipo: 1, serialHex: 'ABCDEF1', contador: 65535, unidade: 9999, bloco: '230', rotulo: 'RF TESTE', marca: 0x1d, cor: 0x0b, placa: 'XYZ9A88' },
    { tipo: 2, serialHex: '0F086E', unidade: 1, bloco: 'A', rotulo: 'TAG ATIVO', marca: 0x16, cor: 0x00, placa: '' },
    { tipo: 3, serialHex: '0F086E', unidade: 1285, bloco: 'Z', rotulo: 'CARTAO', marca: 0x09, cor: 0x03, placa: 'ABC1234' },
    { tipo: 6, serialHex: '123456', unidade: 0, bloco: '1', rotulo: '', marca: 0x1f, cor: 0x0f, placa: 'AAA0000' },
  ];
  for (const c of casos) {
    const f = codec.codificarDispositivo(c);
    assert.equal(f.length, 39);
    const d = codec.decodificarDispositivo(f);
    assert.equal(d.tipo, c.tipo);
    assert.equal(d.serialHex, c.serialHex.toUpperCase());
    assert.equal(d.contador, c.tipo === 1 ? c.contador : 0);
    assert.equal(d.unidade, c.unidade);
    assert.equal(d.bloco, c.bloco);
    assert.equal(d.rotulo, c.rotulo);
    assert.equal(d.marca, c.marca);
    assert.equal(d.cor, c.cor);
    assert.equal(d.placa, c.placa);
    // cadastro novo sem valores: grupo livre (0x00) e todos os receptores (0xFF).
    assert.equal(d.grupo, 0x00);
    assert.equal(d.receptores, 0xff);
    if (c.tipo !== 1) assert.equal(f[0] & 0x0f, 0, 'nibble baixo do byte 1 = 0 fora do RF');
  }
});

test('codificarDispositivo: edição com base39 preserva bytes 10, 11 e 30 lidos do Guarita', () => {
  const base = frameRfManual();
  base[9] = 0x05; base[10] = 0x0c; base[29] = 0xa3;
  const f = codec.codificarDispositivo(
    { tipo: 1, serialHex: '1A2B3C4', contador: 0x1234, unidade: 101, bloco: 'C', rotulo: 'NOVO', marca: 0x02, cor: 0x01, placa: 'QWE1234', grupo: 0, receptores: 0xff },
    base,
  );
  assert.equal(f[9], 0x05);
  assert.equal(f[10], 0x0c);
  assert.equal(f[29], 0xa3);
  assert.equal(codec.decodificarDispositivo(f).unidade, 101);
  assert.equal(codec.decodificarDispositivo(f).rotulo, 'NOVO');
});

test('codificarDispositivo: valida tipo, serial, contador do RF e marca/cor', () => {
  const ok = { tipo: 2, serialHex: '0F086E', unidade: 1, bloco: 'A', rotulo: '', marca: 0, cor: 0, placa: '' };
  assert.throws(() => codec.codificarDispositivo({ ...ok, tipo: 5 }), /tipo/);
  assert.throws(() => codec.codificarDispositivo({ ...ok, serialHex: '000000' }), /serial/);
  assert.throws(() => codec.codificarDispositivo({ ...ok, serialHex: '1234567' }), /serial/); // 7 dígitos só no RF
  assert.throws(() => codec.codificarDispositivo({ ...ok, serialHex: 'GG0000' }), /serial/);
  assert.throws(() => codec.codificarDispositivo({ ...ok, tipo: 1, serialHex: '1234567' }), /contador/);
  assert.throws(() => codec.codificarDispositivo({ ...ok, marca: 0x40 }), /marca/);
  assert.throws(() => codec.codificarDispositivo({ ...ok, cor: 0x10 }), /cor/);
  assert.throws(() => codec.codificarDispositivo(ok, Buffer.alloc(10)), /base/);
});

test('codificarApagar: 39 bytes, só tipo + serial (bytes 1-4), resto 0x00', () => {
  assert.equal(hex(codec.codificarApagar(1, '1A2B3C4')), '11A2B3C4' + '00'.repeat(35));
  assert.equal(hex(codec.codificarApagar(3, '0F086E')), '300F086E' + '00'.repeat(35));
  assert.throws(() => codec.codificarApagar(7, '123456'), /tipo/);
  assert.throws(() => codec.codificarApagar(2, ''), /serial/);
});

// Evento montado à mão (seção 4.1): acionado (tipo 0), RF serial 1A2B3C4,
// 14:30:05 de 15/11/26, RF CAN 1, unidade 308, bloco B, botão 2, não lido.
function eventoManual() {
  return h('01 A2 B3 C4 14 30 05 15 11 26 10 03 08 01 10 00');
}

test('decodificarEvento: campos do evento de acionamento', () => {
  const e = codec.decodificarEvento(eventoManual());
  assert.equal(e.tipo, 0);
  assert.equal(e.serialHex, '1A2B3C4');
  assert.equal(e.tipoDispositivo, 1);
  assert.deepEqual(e.dataHora, { ano: 2026, mes: 11, dia: 15, hora: 14, min: 30, seg: 5 });
  assert.equal(e.receptorTipo, 1);
  assert.equal(e.receptorNum, 0);
  assert.equal(e.unidade, 308);
  assert.equal(e.bloco, 'B');
  assert.equal(e.bateriaFraca, false);
  assert.equal(e.lido, false);
  assert.equal(e.botao, 2);
  assert.equal(e.flags0, 0x10);
  assert.equal(e.flags1, 0x00);
});

test('decodificarEvento: TAG ativo (serial de 6 dígitos) com bateria fraca', () => {
  const e = codec.decodificarEvento(h('00 0F 08 6E 08 00 00 01 01 25 21 00 05 00 80 00'));
  assert.equal(e.serialHex, '0F086E');
  assert.equal(e.receptorTipo, 2);
  assert.equal(e.receptorNum, 1);
  assert.equal(e.bateriaFraca, true);
  assert.equal(e.botao, 1);
});

test('chaveDedup: ignora só o bit 6 ("lido") do byte 15; muda quando muda o segundo', () => {
  const naoLido = eventoManual();
  const lido = Buffer.from(naoLido);
  lido[14] |= 0x40;
  const outroSegundo = Buffer.from(naoLido);
  outroSegundo[6] = 0x06;
  const outraBateria = Buffer.from(naoLido);
  outraBateria[14] |= 0x80;
  const outroFlag1 = Buffer.from(naoLido);
  outroFlag1[15] = 0xaa;
  const k = codec.decodificarEvento(naoLido).chaveDedup;
  assert.equal(codec.decodificarEvento(lido).lido, true);
  assert.equal(codec.decodificarEvento(lido).chaveDedup, k);
  assert.notEqual(codec.decodificarEvento(outroSegundo).chaveDedup, k);
  assert.notEqual(codec.decodificarEvento(outraBateria).chaveDedup, k);
  assert.notEqual(codec.decodificarEvento(outroFlag1).chaveDedup, k);
  assert.equal(k, '01A2B3C4143005151126100308011000');
});

test('decodificarEvento: data BCD inválida não lança (dataHora nula, chave mantida)', () => {
  const ruim = eventoManual();
  ruim[4] = 0x2a; // hora com nibble > 9
  const e = codec.decodificarEvento(ruim);
  assert.equal(e.dataHora, null);
  assert.equal(e.chaveDedup.length, 32);
  const foraDaFaixa = eventoManual();
  foraDaFaixa[8] = 0x13; // mês 13
  assert.equal(codec.decodificarEvento(foraDaFaixa).dataHora, null);
  assert.throws(() => codec.decodificarEvento(Buffer.alloc(15)), /16 bytes/);
});

test('Menor 7: edição de CT Visitante (bytes 5-6 = "VI") com base39 preserva o contador; sem base, fora do RF vai 0', () => {
  const base = codec.codificarDispositivo({ tipo: 3, serialHex: '0F086E', unidade: 1, bloco: 'A', rotulo: 'VISITANTE', marca: 0x16, cor: 0, placa: '' });
  base[4] = 0x56;
  base[5] = 0x49;
  const editado = codec.codificarDispositivo({ tipo: 3, serialHex: '0F086E', unidade: 2, bloco: 'A', rotulo: 'VISITANTE 2', marca: 0x16, cor: 0, placa: '' }, base);
  assert.equal(editado[4], 0x56);
  assert.equal(editado[5], 0x49);
  const novo = codec.codificarDispositivo({ tipo: 3, serialHex: '0F086E', contador: 0x5649, unidade: 2, bloco: 'A', rotulo: '', marca: 0x16, cor: 0, placa: '' });
  assert.equal(novo[4], 0);
  assert.equal(novo[5], 0);
});

test('item 2: CT com destino (nibble baixo do byte 1) faz parte da identidade: decodifica dispDest, codifica e apaga com ele', () => {
  const ct = codec.codificarDispositivo({ tipo: 3, dispDest: 4, serialHex: '0F086E', unidade: 1, bloco: 'A', rotulo: 'CATRACA', marca: 0x16, cor: 0, placa: '' });
  assert.equal(ct[0], 0x34);
  const d = codec.decodificarDispositivo(ct);
  assert.equal(d.tipo, 3);
  assert.equal(d.dispDest, 4);
  assert.equal(d.serialHex, '0F086E');
  assert.equal(codec.decodificarDispositivo(codec.codificarDispositivo({ tipo: 3, serialHex: '0F086E', unidade: 1, bloco: 'A' })).dispDest, 0);
  assert.equal(hex(codec.codificarApagar(3, '0F086E', 4)), '340F086E' + '00'.repeat(35));
  assert.equal(hex(codec.codificarApagar(3, '0F086E')), '300F086E' + '00'.repeat(35));
  // edição com base: o destino lido é preservado
  const editado = codec.codificarDispositivo({ tipo: 3, serialHex: '0F086E', unidade: 2, bloco: 'A', rotulo: 'X' }, ct);
  assert.equal(editado[0], 0x34);
  // só 0 (Guarita) ou 4 (Catraca 2010), e só no CT
  assert.throws(() => codec.codificarDispositivo({ tipo: 3, dispDest: 5, serialHex: '0F086E', unidade: 1, bloco: 'A' }), /destino/);
  assert.throws(() => codec.codificarDispositivo({ tipo: 2, dispDest: 4, serialHex: '0F086E', unidade: 1, bloco: 'A' }), /destino/);
  assert.throws(() => codec.codificarApagar(6, '0F086E', 4), /destino/);
  assert.equal(codec.decodificarDispositivo(codec.codificarDispositivo({ tipo: 2, serialHex: '0F086E', unidade: 1, bloco: 'A' })).dispDest, 0);
});
