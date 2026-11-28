import { facialAtendeBloco, ramalValido, sugerirRamais } from './regras';

describe('sugerirRamais', () => {
  it('dois aptos com o mesmo número ficam em conflito e sem sugestão; o único recebe a sugestão', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: null },
      { id: 2, apto: '106', bloco: 'B', ramal: null },
      { id: 3, apto: '201', bloco: 'A', ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(2)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(3)).toEqual({ sugestao: '201', conflito: false });
  });

  it('a sugestão é só os dígitos do apto', () => {
    const r = sugerirRamais([{ id: 9, apto: 'Apto 12-B', bloco: null, ramal: null }]);
    expect(r.get(9)).toEqual({ sugestao: '12', conflito: false });
  });

  it('ramal gravado que colide com outro gravado deixa os dois em conflito', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: '1106' },
      { id: 2, apto: '106', bloco: 'B', ramal: '1106' },
    ]);
    expect(r.get(1)?.conflito).toBe(true);
    expect(r.get(2)?.conflito).toBe(true);
  });

  it('apto sem número não tem sugestão nem conflito', () => {
    const r = sugerirRamais([
      { id: 1, apto: 'Cobertura', bloco: null, ramal: null },
      { id: 2, apto: null, bloco: null, ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: false });
    expect(r.get(2)).toEqual({ sugestao: null, conflito: false });
  });

  it('sugestão que bate no ramal gravado de outra unidade vira conflito (nunca sugere número em uso)', () => {
    const r = sugerirRamais([
      { id: 1, apto: '1106', bloco: 'B', ramal: null },
      { id: 2, apto: '106', bloco: 'A', ramal: '1106' },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
    // O ramal gravado do 2 continua válido: o 1 não tem ramal gravado.
    expect(r.get(2)?.conflito).toBe(false);
  });

  it('unidade que já tem ramal libera o próprio número de apto para a outra', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: '1106' },
      { id: 2, apto: '106', bloco: 'B', ramal: null },
    ]);
    expect(r.get(2)).toEqual({ sugestao: '106', conflito: false });
    expect(r.get(1)?.conflito).toBe(false);
  });
});

describe('ramalValido', () => {
  it('só dígitos, 1 a 10', () => {
    expect(ramalValido('1')).toBe(true);
    expect(ramalValido('1234567890')).toBe(true);
    expect(ramalValido('12345678901')).toBe(false);
    expect(ramalValido('')).toBe(false);
    expect(ramalValido('12a')).toBe(false);
    expect(ramalValido(' 12')).toBe(false);
  });
});

describe('facialAtendeBloco', () => {
  it('compara pelo bloco normalizado', () => {
    expect(facialAtendeBloco('["A"]', 'Bloco A')).toBe(true);
    expect(facialAtendeBloco('["A"]', 'B')).toBe(false);
  });

  it('null ou vazio atende todos os blocos', () => {
    expect(facialAtendeBloco(null, 'B')).toBe(true);
    expect(facialAtendeBloco('', 'B')).toBe(true);
    expect(facialAtendeBloco(null, null)).toBe(true);
  });

  it('lista restrita não atende unidade sem bloco', () => {
    expect(facialAtendeBloco('["A"]', null)).toBe(false);
  });

  it('JSON inválido falha fechado', () => {
    expect(facialAtendeBloco('{ruim', 'A')).toBe(false);
    expect(facialAtendeBloco('{"a":1}', 'A')).toBe(false);
  });
});
