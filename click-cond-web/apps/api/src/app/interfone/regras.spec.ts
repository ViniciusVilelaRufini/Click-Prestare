import { facialAtendeBloco, ramalValido, sugerirRamais } from './regras';

describe('sugerirRamais', () => {
  it('mesmo número em blocos diferentes: prefixo = posição do bloco + dígitos; o único fica só com os dígitos', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: null },
      { id: 2, apto: '106', bloco: 'B', ramal: null },
      { id: 3, apto: '201', bloco: 'A', ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: '1106', conflito: false });
    expect(r.get(2)).toEqual({ sugestao: '2106', conflito: false });
    expect(r.get(3)).toEqual({ sugestao: '201', conflito: false });
  });

  it('4 blocos com 101–110: toda unidade recebe sugestão, sem conflito', () => {
    const aptos = ['Bloco A', 'Bloco B', 'Bloco C', 'Bloco D'].flatMap((bloco, b) =>
      Array.from({ length: 10 }, (_, i) => ({ id: b * 100 + i, apto: String(101 + i), bloco, ramal: null })),
    );
    const r = sugerirRamais(aptos);
    expect([...r.values()].every((v) => v.sugestao && !v.conflito)).toBe(true);
    expect(r.get(5)?.sugestao).toBe('1106');
    expect(r.get(105)?.sugestao).toBe('2106');
    expect(r.get(309)?.sugestao).toBe('4110');
    expect(new Set([...r.values()].map((v) => v.sugestao)).size).toBe(40);
  });

  it('ordem natural dos blocos: "Bloco 2" antes de "Bloco 10"; "Bloco A" e "A" são o mesmo bloco', () => {
    const r = sugerirRamais([
      { id: 1, apto: '101', bloco: 'Bloco 10', ramal: null },
      { id: 2, apto: '101', bloco: 'Bloco 2', ramal: null },
      { id: 3, apto: '101', bloco: 'Bloco 1', ramal: null },
    ]);
    expect(r.get(3)?.sugestao).toBe('1101');
    expect(r.get(2)?.sugestao).toBe('2101');
    expect(r.get(1)?.sugestao).toBe('3101');
    const r2 = sugerirRamais([
      { id: 1, apto: '101', bloco: 'Bloco B', ramal: null },
      { id: 2, apto: '102', bloco: 'A', ramal: null },
      { id: 3, apto: '101', bloco: 'Bloco A', ramal: null },
    ]);
    expect(r2.get(3)?.sugestao).toBe('1101');
    expect(r2.get(1)?.sugestao).toBe('2101');
    expect(r2.get(2)?.sugestao).toBe('102');
  });

  it('unidade sem bloco mantém só os dígitos', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: null, ramal: null },
      { id: 2, apto: '106', bloco: 'A', ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: '106', conflito: false });
    expect(r.get(2)).toEqual({ sugestao: '1106', conflito: false });
  });

  it('conflito real: mesmo número no mesmo bloco continua sem sugestão', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: null },
      { id: 2, apto: '106-B', bloco: 'A', ramal: null },
      { id: 3, apto: '106', bloco: 'B', ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(2)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(3)).toEqual({ sugestao: '2106', conflito: false });
  });

  it('com o prefixo ainda colide (outra unidade usa o número) → sem sugestão e conflito', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: null },
      { id: 2, apto: '106', bloco: 'B', ramal: null },
      { id: 3, apto: '1106', bloco: null, ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(3)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(2)).toEqual({ sugestao: '2106', conflito: false });
  });

  it('prefixo que passa de 10 dígitos → sem sugestão e conflito', () => {
    const r = sugerirRamais([
      { id: 1, apto: '1234567890', bloco: 'A', ramal: null },
      { id: 2, apto: '1234567890', bloco: 'B', ramal: null },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
    expect(r.get(2)).toEqual({ sugestao: null, conflito: true });
  });

  it('dígitos já usados como ramal gravado de outro bloco → sugestão com prefixo', () => {
    const r = sugerirRamais([
      { id: 1, apto: '106', bloco: 'A', ramal: '106' },
      { id: 2, apto: '106', bloco: 'B', ramal: null },
    ]);
    expect(r.get(2)).toEqual({ sugestao: '2106', conflito: false });
    expect(r.get(1)?.conflito).toBe(false);
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

  it('sugestão que bate no ramal gravado de outra unidade ganha o prefixo (nunca sugere número em uso)', () => {
    const r = sugerirRamais([
      { id: 1, apto: '1106', bloco: 'B', ramal: null },
      { id: 2, apto: '106', bloco: 'A', ramal: '1106' },
    ]);
    expect(r.get(1)).toEqual({ sugestao: '21106', conflito: false });
    // O ramal gravado do 2 continua válido: o 1 não tem ramal gravado.
    expect(r.get(2)?.conflito).toBe(false);
  });

  it('sugestão que bate no ramal gravado e não tem bloco para prefixar vira conflito', () => {
    const r = sugerirRamais([
      { id: 1, apto: '1106', bloco: null, ramal: null },
      { id: 2, apto: '106', bloco: 'A', ramal: '1106' },
    ]);
    expect(r.get(1)).toEqual({ sugestao: null, conflito: true });
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
