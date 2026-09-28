import { rotuloBloco } from './rotulo-bloco.util';

/** Blocos cadastrados como "Bloco A" viravam "Bloco Bloco A" nos textos. */
describe('rotuloBloco', () => {
  it('não duplica o prefixo', () => {
    expect(rotuloBloco('Bloco A')).toBe('Bloco A');
    expect(rotuloBloco('bloco b')).toBe('bloco b');
    expect(rotuloBloco('A')).toBe('Bloco A');
    expect(rotuloBloco(' C ')).toBe('Bloco C');
  });

  it('vazio fica vazio', () => {
    expect(rotuloBloco('')).toBe('');
    expect(rotuloBloco(null)).toBe('');
    expect(rotuloBloco(undefined)).toBe('');
  });
});
