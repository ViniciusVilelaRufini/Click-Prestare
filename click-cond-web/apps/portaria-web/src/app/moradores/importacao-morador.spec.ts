import { dataNascimentoDaPlanilha, temDataNascimento } from './importacao-morador';

describe('dataNascimentoDaPlanilha', () => {
  it('DD/MM/AAAA e D/M/AAAA viram AAAA-MM-DD', () => {
    expect(dataNascimentoDaPlanilha('15/05/1985')).toBe('1985-05-15');
    expect(dataNascimentoDaPlanilha('3/2/1990')).toBe('1990-02-03');
  });

  it('AAAA-MM-DD (com ou sem hora) fica como está', () => {
    expect(dataNascimentoDaPlanilha('1990-02-03')).toBe('1990-02-03');
    expect(dataNascimentoDaPlanilha('1990-02-03T00:00:00Z')).toBe('1990-02-03');
  });

  it('célula de data do Excel (número de série) vira a data certa', () => {
    // 15/05/1985 no Excel = 31182
    expect(dataNascimentoDaPlanilha(31182)).toBe('1985-05-15');
  });

  it('número fora do intervalo plausível (ano solto, série pequena ou futura) não vira data', () => {
    expect(dataNascimentoDaPlanilha(1985)).toBe('1985');
    expect(dataNascimentoDaPlanilha(9999)).toBe('9999');
    expect(dataNascimentoDaPlanilha(80000)).toBe('80000'); // ~2119
    expect(dataNascimentoDaPlanilha(10000)).toBe('1927-05-18');
  });

  it('vazio fica vazio; outro formato volta como veio (a API explica a recusa)', () => {
    expect(dataNascimentoDaPlanilha('')).toBe('');
    expect(dataNascimentoDaPlanilha(undefined)).toBe('');
    expect(dataNascimentoDaPlanilha('maio de 85')).toBe('maio de 85');
  });

  it('temDataNascimento só aceita AAAA-MM-DD', () => {
    expect(temDataNascimento('1985-05-15')).toBe(true);
    expect(temDataNascimento('')).toBe(false);
    expect(temDataNascimento('maio de 85')).toBe(false);
  });
});
