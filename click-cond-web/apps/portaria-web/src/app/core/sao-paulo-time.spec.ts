import { formatarSaoPauloLocal, instanteSaoPaulo } from './sao-paulo-time';

describe('sao-paulo-time', () => {
  it('formata em Brasilia independente do fuso do navegador', () => {
    // 2026-11-26T02:30Z = 25/11 23:30 em Brasilia
    expect(formatarSaoPauloLocal(Date.parse('2026-11-26T02:30:00Z'))).toBe('2026-11-25T23:30');
  });
  it('le o texto local como Brasilia e faz ida e volta', () => {
    const ms = instanteSaoPaulo('2026-11-25T23:30');
    expect(new Date(ms).toISOString()).toBe('2026-11-26T02:30:00.000Z');
    expect(formatarSaoPauloLocal(ms)).toBe('2026-11-25T23:30');
    expect(instanteSaoPaulo('')).toBeNaN();
  });
});
