import { rotuloAptoBloco } from './rotulo-apto-bloco.util';

/**
 * Varredura do console 25/11: o detalhe do visitante mostrava "Apto 106Bloco A" — a API colava
 * apto e bloco sem separador (`${apto}${bloco}`) e o cadastro guarda o bloco como "Bloco A".
 * O front prefixa "Apto ", então o rótulo é "106 · Bloco A".
 */
describe('rotuloAptoBloco', () => {
  it('apto e bloco com prefixo', () => expect(rotuloAptoBloco('106', 'Bloco A')).toBe('106 · Bloco A'));
  it('bloco só com a letra ganha o prefixo', () => expect(rotuloAptoBloco('106', 'A')).toBe('106 · Bloco A'));
  it('sem bloco fica só o apto', () => expect(rotuloAptoBloco('106', null)).toBe('106'));
  it('espaços nas pontas', () => expect(rotuloAptoBloco(' 106 ', ' B ')).toBe('106 · Bloco B'));
  it('sem apto: só o bloco', () => expect(rotuloAptoBloco(null, 'Bloco C')).toBe('Bloco C'));
  it('nada: vazio', () => expect(rotuloAptoBloco(null, undefined)).toBe(''));
});
