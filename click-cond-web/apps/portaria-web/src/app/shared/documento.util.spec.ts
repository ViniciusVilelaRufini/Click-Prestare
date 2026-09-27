import { cnpjValido, cpfValido, erroDocumento } from './documento.util';

describe('documento.util', () => {
  it('valida CPF pelos dígitos verificadores', () => {
    expect(cpfValido('123.456.789-09')).toBe(true);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('123.456.789-00')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('valida CNPJ pelos dígitos verificadores', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('00.000.000/0000-00')).toBe(false);
  });

  it('erroDocumento só barra CPF/CNPJ inválidos; outros formatos passam', () => {
    expect(erroDocumento('11111111111')).toMatch(/CPF inválido/);
    expect(erroDocumento('11222333000180')).toMatch(/CNPJ inválido/);
    expect(erroDocumento('12345678909')).toBeNull();
    expect(erroDocumento('62.345.678-26')).toBeNull(); // RG (9 dígitos)
    expect(erroDocumento('')).toBeNull();
    expect(erroDocumento(null)).toBeNull();
  });
});
