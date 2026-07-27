import { normalizarPlaca, placaValida, variantesPlaca } from './placa.util';

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
});
