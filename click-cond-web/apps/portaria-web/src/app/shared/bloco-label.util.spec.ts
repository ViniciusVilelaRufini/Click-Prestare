import { chaveBloco, rotuloBloco } from './bloco-label.util';

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

describe('chaveBloco e rótulo de quadra/torre', () => {
  it('"A", "Bloco A" e "Quadra A" têm a mesma chave; "Bloco 10" difere de "Bloco 1"', () => {
    expect(chaveBloco('Bloco A')).toBe(chaveBloco('A'));
    expect(chaveBloco('Quadra A')).toBe(chaveBloco('A'));
    expect(chaveBloco('Bloco 10')).not.toBe(chaveBloco('Bloco 1'));
    expect(chaveBloco(null)).toBe('');
  });

  it('quadra e torre não ganham "Bloco" na frente', () => {
    expect(rotuloBloco('Quadra A')).toBe('Quadra A');
    expect(rotuloBloco('Torre 2')).toBe('Torre 2');
  });
});

describe('chaveBloco espelha normalizarBloco da API', () => {
  it('"Torre" e "Quadra" sozinhos mantêm a palavra (não caem em "Sem bloco")', () => {
    expect(chaveBloco('Torre')).toBe('torre');
    expect(chaveBloco('Quadra')).toBe('quadra');
    expect(chaveBloco('Bloco')).toBe('');
  });

  it('o prefixo é palavra inteira: "Torreão" e "Blocos" ficam como estão', () => {
    expect(chaveBloco('Torreão')).toBe('torreão');
    expect(chaveBloco('Blocos')).toBe('blocos');
  });

  it('"Bloco A", "Quadra A", "Torre 2", "Bloco.A" e "A"', () => {
    expect(chaveBloco('Bloco A')).toBe('a');
    expect(chaveBloco('A')).toBe('a');
    expect(chaveBloco('Torre 2')).toBe('2');
    expect(chaveBloco('Bloco 10')).toBe('10');
    expect(chaveBloco('Bloco. A')).toBe('a');
  });
});
