import { somenteDigitos } from './documento.util';

/**
 * A senha inicial de morador e funcionário é o CPF, e ela vai por e-mail para
 * a pessoa digitar no login. Com a máscara ("453.466.488-53") quem digita erra
 * o ponto ou o traço e não entra.
 */
describe('somenteDigitos', () => {
  it('tira máscara de CPF', () => {
    expect(somenteDigitos('453.466.488-53')).toBe('45346648853');
  });

  it('mantém documento que já veio sem máscara', () => {
    expect(somenteDigitos('45346648853')).toBe('45346648853');
  });

  it('tira espaços e outros separadores', () => {
    expect(somenteDigitos(' 453 466 488 53 ')).toBe('45346648853');
    expect(somenteDigitos('12.345.678/0001-90')).toBe('12345678000190');
  });

  // O chamador usa `somenteDigitos(x) || '123456'`, então precisa devolver
  // string vazia (falsy) e não null, para cair no padrão.
  it('devolve string vazia para nulo, indefinido ou sem dígito', () => {
    expect(somenteDigitos(null)).toBe('');
    expect(somenteDigitos(undefined)).toBe('');
    expect(somenteDigitos('')).toBe('');
    expect(somenteDigitos('---')).toBe('');
  });
});
