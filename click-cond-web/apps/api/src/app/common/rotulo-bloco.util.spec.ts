import { chaveUnidade, normalizarApto, normalizarBloco } from './rotulo-bloco.util';

describe('normalizarBloco / normalizarApto / chaveUnidade', () => {
  it('tira bloco, quadra e torre do bloco', () => {
    expect(normalizarBloco('Bloco A')).toBe('a');
    expect(normalizarBloco('Quadra A')).toBe('a');
    expect(normalizarBloco('Torre 2')).toBe('2');
    expect(normalizarBloco('Bloco 10')).not.toBe(normalizarBloco('Bloco 1'));
  });

  it('tira lote, casa, apto, apartamento e unidade do apto', () => {
    expect(normalizarApto('Lote 12')).toBe('12');
    expect(normalizarApto('Apto 101')).toBe('101');
    expect(normalizarApto('apto. 101')).toBe('101');
    expect(normalizarApto('Apartamento 5')).toBe('5');
    expect(normalizarApto('Casa 7')).toBe('7');
    expect(normalizarApto('Unidade 9')).toBe('9');
  });

  it('tira espaços e zeros à esquerda só de número', () => {
    expect(normalizarApto('0101')).toBe('101');
    expect(normalizarApto('0')).toBe('0');
    expect(normalizarApto('101A')).toBe('101a');
    expect(normalizarApto(' 1 0 1 ')).toBe('101');
    expect(normalizarApto(null)).toBe('');
  });

  it('chaveUnidade iguala as grafias', () => {
    expect(chaveUnidade('Bloco 1', 'Apto 101')).toBe(chaveUnidade('1', '101'));
    expect(chaveUnidade('Quadra A', 'Lote 12')).toBe(chaveUnidade('A', '12'));
    expect(chaveUnidade(null, '12')).not.toBe(chaveUnidade('A', '12'));
  });

  it('prefixo só vale como palavra: "Casarão" e "Loteamento" ficam', () => {
    expect(normalizarApto('Casarão')).toBe('casarão');
    expect(normalizarApto('Loteamento 5')).toBe('loteamento5');
    expect(normalizarBloco('Torreão')).toBe('torreão');
    expect(normalizarBloco('Blocos')).toBe('blocos');
  });

  it('prefixo sem nada depois não vira vazio', () => {
    expect(normalizarApto('Casa')).toBe('casa');
    expect(normalizarApto('Lote')).toBe('lote');
    expect(normalizarBloco('Quadra')).toBe('quadra');
    expect(normalizarApto('Apto.')).toBe('apto.');
  });
});
