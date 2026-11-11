import {
  gruposCodigoTag,
  normalizarCodigoTag,
  variantesCodigoTag,
} from './tag-codigo.util';

/**
 * O mesmo cartão aparece com "caras" diferentes: o número impresso (decimal,
 * com zeros à esquerda), o que o leitor manda (hex, decimal ou Wiegand 26
 * "facility,número") e o que a portaria digitou. Comparar por texto exato
 * fazia a tag cadastrada nunca abrir.
 */
describe('normalizarCodigoTag', () => {
  it.each([
    ['0012345678', '12345678'],
    [' bc:61:4e ', 'BC614E'],
    ['BC-61-4E', 'BC614E'],
    ['e280 1170 0000 020f 1a2b 3c4d', 'E28011700000020F1A2B3C4D'],
    ['0000', '0'],
    ['000A', 'A'],
    [12345678, '12345678'],
    // Wiegand 26 com separador: vira o decimal do valor de 24 bits.
    ['188,24910', '12345678'],
    ['188.24910', '12345678'],
  ])('%p → %p', (bruto, esperado) => {
    expect(normalizarCodigoTag(bruto)).toBe(esperado);
  });

  it.each([
    [''],
    ['   '],
    [':-: '],
    [null],
    [undefined],
    [{}],
    ['TAG_1'],
    ['12#45'],
    ['ção'],
    ['256,00001'], // facility não cabe em 8 bits
    ['1,70000'], // número não cabe em 16 bits
    ['A'.repeat(65)],
  ])('inválido %p → null', (bruto) => {
    expect(normalizarCodigoTag(bruto)).toBeNull();
  });
});

describe('variantesCodigoTag', () => {
  // 12345678 = 0xBC614E = facility 188 (0xBC) + número 24910 (0x614E).
  const MESMO_CARTAO = [
    '0012345678',
    '12345678',
    'BC614E',
    'bc:61:4e',
    '188,24910',
  ];

  it.each(MESMO_CARTAO)(
    'a leitura %p casa com o cadastro normalizado das outras formas',
    (lido) => {
      const variantes = variantesCodigoTag(lido);
      // Decimal, hex e Wiegand 26 COM separador do mesmo valor.
      expect(variantes).toEqual(
        expect.arrayContaining(['12345678', 'BC614E', '188,24910']),
      );
    },
  );

  // Revisão 11/11: decimal de 6-8 dígitos NÃO é mais lido como "facility +
  // número colados" — era um palpite que fazia "18824910" casar com o cartão
  // 12345678 de outra pessoa. Wiegand só com separador explícito.
  it('Wiegand SEM separador não é mais palpite: "18824910" e "12345678" não se cruzam', () => {
    expect(variantesCodigoTag('18824910')).not.toContain('12345678');
    expect(variantesCodigoTag('18824910')).not.toContain('BC614E');
    expect(variantesCodigoTag('12345678')).not.toContain('18824910');
    expect(variantesCodigoTag('BC614E')).not.toContain('18824910');
  });

  it('Wiegand COM separador continua casando com decimal e hex', () => {
    expect(variantesCodigoTag('188,24910')).toEqual(expect.arrayContaining(['12345678', 'BC614E']));
    expect(variantesCodigoTag('BC614E')).toContain('188,24910');
  });

  it('"0012345678" x "BC614E" x "12345678": todas se cruzam', () => {
    for (const lido of ['0012345678', 'BC614E', '12345678']) {
      for (const cadastro of ['0012345678', 'BC614E', '12345678']) {
        expect(variantesCodigoTag(lido)).toContain(cadastro);
      }
    }
  });

  it('o normalizado vem primeiro e o texto bruto (trim) é mantido para cadastro antigo', () => {
    const variantes = variantesCodigoTag('  bc-61-4e ');
    expect(variantes[0]).toBe('BC614E');
    expect(variantes).toContain('bc-61-4e');
  });

  it('EPC de 24 hex: mantém o hex e converte para decimal sem perder precisão', () => {
    const epc = 'E28011700000020F1A2B3C4D';
    const variantes = variantesCodigoTag(epc);
    expect(variantes[0]).toBe(epc);
    expect(variantes).toContain(BigInt('0x' + epc).toString(10));
    // Volta: o decimal do EPC casa com o hex.
    expect(variantesCodigoTag(BigInt('0x' + epc).toString(10))).toContain(epc);
    // Não cabe em 24 bits: sem forma Wiegand.
    expect(variantes.some((v) => v.includes(','))).toBe(false);
  });

  it('código com letras fora do hex só tem a si mesmo (e o bruto)', () => {
    expect(variantesCodigoTag('TAG-1')).toEqual(['TAG1', 'TAG-1']);
  });

  it('código antigo com caractere inválido ainda casa por igualdade do bruto', () => {
    expect(variantesCodigoTag(' TAG_1 ')).toEqual(['TAG_1']);
  });

  it.each([[''], ['   '], [null], [undefined], ['F'.repeat(65)]])(
    'entrada vazia/inválida %p → sem variantes',
    (bruto) => {
      expect(variantesCodigoTag(bruto)).toEqual([]);
    },
  );

  it('não repete variantes', () => {
    const variantes = variantesCodigoTag('12345678');
    expect(new Set(variantes).size).toBe(variantes.length);
  });
});

describe('gruposCodigoTag — exatas x convertidas', () => {
  // "123456" pode ser decimal (= hex 1E240) ou hex (= decimal 1193046). As
  // conversões ficam separadas para quem lê dar prioridade à igualdade exata.
  it('separa a igualdade exata das conversões de base', () => {
    const g = gruposCodigoTag('00123456');
    expect(g.normalizado).toBe('123456');
    expect(g.exatas).toEqual(['123456', '00123456']);
    expect(g.convertidas).toEqual(expect.arrayContaining(['1E240', '1193046']));
    expect(g.convertidas).not.toContain('123456');
  });
});

describe('validarCodigoTag — tipo da entrada', () => {
  const { validarCodigoTag } = require('./tag-codigo.util');

  // Um array ['12','34'] virava "12,34" no String() e era lido como Wiegand.
  it.each([[['12', '34']], [{ a: 1 }], [true], [BigInt(5)]])(
    'recusa %p (só string ou number)',
    (bruto) => {
      const r = validarCodigoTag(bruto);
      expect(r.codigo).toBeUndefined();
      expect(r.erro).toMatch(/inválido/i);
    },
  );

  it('continua aceitando string e number', () => {
    expect(validarCodigoTag(' bc614e ').codigo).toBe('BC614E');
    expect(validarCodigoTag(12345678).codigo).toBe('12345678');
  });

  it('vazio/null continua pedindo o código', () => {
    expect(validarCodigoTag(null).erro).toMatch(/informe/i);
    expect(validarCodigoTag('  ').erro).toMatch(/informe/i);
  });
});
