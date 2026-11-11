import {
  corrigirPlacaOcr,
  normalizarPlaca,
  placaValida,
  variantesPlaca,
} from './placa.util';

describe('placa.util', () => {
  describe('normalizarPlaca', () => {
    it('remove separadores e sobe para maiúsculas', () => {
      expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
      expect(normalizarPlaca('ABC 1234')).toBe('ABC1234');
      expect(normalizarPlaca(' abc1234 ')).toBe('ABC1234');
    });

    it('trata vazio/nulo sem estourar', () => {
      expect(normalizarPlaca(undefined)).toBe('');
      expect(normalizarPlaca(null)).toBe('');
      expect(normalizarPlaca('')).toBe('');
    });
  });

  describe('placaValida', () => {
    it('aceita Mercosul e formato antigo', () => {
      expect(placaValida('ABC1D23')).toBe(true);
      expect(placaValida('ABC1234')).toBe(true);
    });

    // Leitura parcial ou suja do OCR não pode virar consulta nem evento.
    it('recusa lixo de OCR', () => {
      expect(placaValida('AB1')).toBe(false);
      expect(placaValida('ABC12345')).toBe(false);
      expect(placaValida('1234ABC')).toBe(false);
      expect(placaValida('')).toBe(false);
      expect(placaValida('ABCD123')).toBe(false);
    });
  });

  describe('variantesPlaca', () => {
    it('gera as formas equivalentes usadas no cadastro manual', () => {
      const v = variantesPlaca('ABC1D23');
      expect(v).toContain('ABC1D23');
      expect(v).toContain('ABC-1D23');
      expect(v).toContain('ABC 1D23');
    });

    it('não inventa variante para entrada fora do tamanho', () => {
      expect(variantesPlaca('ABC12')).toEqual(['ABC12']);
      expect(variantesPlaca('')).toEqual([]);
    });
  });

  /**
   * A câmera LPR troca caracteres parecidos (0/O, 1/I, 8/B, 5/S, 2/Z, 6/G). A
   * placa brasileira tem posição tipada — 1ª a 3ª só letra; 4ª, 6ª e 7ª só
   * dígito — então nessas posições a troca é reversível sem adivinhar. A 5ª
   * (dígito na antiga, letra na Mercosul) aceita os dois e não é tocada.
   */
  describe('corrigirPlacaOcr', () => {
    const PARES: Array<[digito: string, letra: string]> = [
      ['0', 'O'],
      ['1', 'I'],
      ['8', 'B'],
      ['5', 'S'],
      ['2', 'Z'],
      ['6', 'G'],
    ];
    const troca = (placa: string, i: number, c: string) =>
      placa.slice(0, i) + c + placa.slice(i + 1);

    const casos: Array<[lida: string, esperada: string]> = [];
    for (const base of ['XYZ4E79', 'XYZ4379']) {
      for (const [digito, letra] of PARES) {
        // Posições só de letra: o dígito parecido vira a letra.
        for (const i of [0, 1, 2]) {
          casos.push([troca(base, i, digito), troca(base, i, letra)]);
        }
        // Posições só de dígito: a letra parecida vira o dígito.
        for (const i of [3, 5, 6]) {
          casos.push([troca(base, i, letra), troca(base, i, digito)]);
        }
      }
    }

    it.each(casos)('leitura %s vira %s', (lida, esperada) => {
      expect(placaValida(lida)).toBe(false);
      expect(corrigirPlacaOcr(lida)).toBe(esperada);
      expect(placaValida(esperada)).toBe(true);
    });

    it('corrige o exemplo de campo: letra O na 6ª posição', () => {
      expect(corrigirPlacaOcr('ABC10O3')).toBe('ABC1003');
      expect(corrigirPlacaOcr('ABC1D2O')).toBe('ABC1D20');
      expect(corrigirPlacaOcr('A8C1234')).toBe('ABC1234');
    });

    it('corrige duas trocas na mesma leitura', () => {
      expect(corrigirPlacaOcr('0BC1D2S')).toBe('OBC1D25');
    });

    // Leitura que já é placa válida nunca vira outra placa: seria abrir a
    // cancela para o carro errado.
    it.each(['ABC1023', 'ABC1D23', 'ABC1O23', 'OIB0S12', 'SBZ5G86', 'XYZ4379'])(
      'leitura já válida %s fica inalterada',
      (placa) => {
        expect(placaValida(placa)).toBe(true);
        expect(corrigirPlacaOcr(placa)).toBe(placa);
      },
    );

    // 5ª posição: "ABC1O23" (Mercosul) e "ABC1023" (antiga) são duas placas
    // válidas e diferentes — não há como saber qual a câmera quis ler.
    it('não mexe na 5ª posição, mesmo corrigindo as outras', () => {
      expect(corrigirPlacaOcr('ABC1O23')).toBe('ABC1O23');
      expect(corrigirPlacaOcr('ABC1023')).toBe('ABC1023');
      expect(corrigirPlacaOcr('0BC1O23')).toBe('OBC1O23');
      expect(corrigirPlacaOcr('0BC1023')).toBe('OBC1023');
      expect(corrigirPlacaOcr('ABC1B2O')).toBe('ABC1B20');
      expect(corrigirPlacaOcr('ABC182O')).toBe('ABC1820');
    });

    it.each([
      'ABCX123', // letra sem dígito parecido em posição de dígito
      '7BC1234', // dígito sem letra parecida em posição de letra
      '0BCX123', // uma troca reversível não salva a outra, irrecuperável
      'ABC1-23', // caractere fora do alfabeto
      'AB1',
      'ABC12345',
      'ABCD123',
      '',
    ])('leitura irrecuperável "%s" fica como veio e segue inválida', (lixo) => {
      expect(corrigirPlacaOcr(lixo)).toBe(lixo);
      expect(placaValida(corrigirPlacaOcr(lixo))).toBe(false);
    });

    // OCR erra um caractere, às vezes dois. Acima disso a leitura é ruído
    // (número de telefone num caminhão, por exemplo) e não deve virar placa.
    it('não reconstrói placa a partir de leitura com trocas demais', () => {
      expect(corrigirPlacaOcr('1001001')).toBe('1001001');
      expect(corrigirPlacaOcr('08C1D2S')).toBe('08C1D2S');
    });
  });

  describe('variantesPlaca — leitura com caractere trocado', () => {
    it('inclui a placa corrigida e as formas dela usadas no cadastro', () => {
      const v = variantesPlaca('ABC10O3');
      expect(v).toEqual(
        expect.arrayContaining(['ABC1003', 'ABC-1003', 'ABC 1003']),
      );
    });

    it('placa já válida continua gerando só as formas dela mesma', () => {
      expect(variantesPlaca('ABC1023').sort()).toEqual(
        ['ABC 1023', 'ABC-1023', 'ABC1023'].sort(),
      );
      expect(variantesPlaca('ABC1O23').sort()).toEqual(
        ['ABC 1O23', 'ABC-1O23', 'ABC1O23'].sort(),
      );
    });

    it('toda variante sem separador de uma leitura corrigível é placa válida ou a própria leitura', () => {
      for (const v of variantesPlaca('A8C1234')) {
        const semSeparador = normalizarPlaca(v);
        expect(
          semSeparador === 'A8C1234' || semSeparador === 'ABC1234',
        ).toBe(true);
      }
    });

    it('leitura irrecuperável não ganha variante corrigida', () => {
      expect(variantesPlaca('ABCX123').sort()).toEqual(
        ['ABC X123', 'ABC-X123', 'ABCX123'].sort(),
      );
    });
  });
});
