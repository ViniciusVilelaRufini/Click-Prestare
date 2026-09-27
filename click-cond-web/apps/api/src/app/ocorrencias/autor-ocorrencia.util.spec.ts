import { autorOcorrencia } from './autor-ocorrencia.util';

describe('autorOcorrencia', () => {
  it('categoria "Dispositivos" sem autor vinculado retorna "Sistema"', () => {
    expect(autorOcorrencia(undefined, 'Dispositivos')).toBe('Sistema');
    expect(autorOcorrencia(null, 'Dispositivos')).toBe('Sistema');
  });

  it('outra categoria sem autor vinculado retorna "Morador" (fallback antigo)', () => {
    expect(autorOcorrencia(undefined, 'Geral')).toBe('Morador');
    expect(autorOcorrencia(null, null)).toBe('Morador');
    expect(autorOcorrencia(undefined, undefined)).toBe('Morador');
  });

  it('com nome de autor vinculado, retorna o nome — independente da categoria', () => {
    expect(autorOcorrencia('Maria Souza', 'Dispositivos')).toBe('Maria Souza');
    expect(autorOcorrencia('João Silva', 'Geral')).toBe('João Silva');
  });
});
