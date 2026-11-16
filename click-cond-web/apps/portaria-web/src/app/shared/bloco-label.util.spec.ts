import { rotuloBloco } from './bloco-label.util';

/**
 * O cadastro guarda o nome do bloco das duas formas ("A" ou "Bloco A") e
 * vários templates do console prefixavam "Bloco " de novo, mostrando
 * "Bloco Bloco A - Apto 106". O rótulo sai sempre com um único "Bloco".
 */
describe('rotuloBloco', () => {
  it('vazio ou nulo não gera rótulo', () => {
    expect(rotuloBloco(null)).toBe('');
    expect(rotuloBloco(undefined)).toBe('');
    expect(rotuloBloco('')).toBe('');
    expect(rotuloBloco('   ')).toBe('');
  });

  it('nome sem prefixo ganha "Bloco "', () => {
    expect(rotuloBloco('A')).toBe('Bloco A');
  });

  it('nome que já vem como "Bloco A" não duplica o prefixo', () => {
    expect(rotuloBloco('Bloco A')).toBe('Bloco A');
  });

  it('o prefixo é reconhecido em qualquer caixa', () => {
    expect(rotuloBloco('bloco a')).toBe('Bloco a');
  });

  it('espaços sobrando são normalizados', () => {
    expect(rotuloBloco('  Bloco  B ')).toBe('Bloco B');
  });

  it('só remove a palavra inteira "bloco"', () => {
    expect(rotuloBloco('Blocos')).toBe('Bloco Blocos');
  });
});
