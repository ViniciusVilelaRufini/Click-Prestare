import { anexoPorFatorR, calcularSimples, precoMensalPorUnidades } from './simples-nacional';

describe('simples-nacional', () => {
  it('faixa 1 do Anexo III dá 6%', () => {
    const r = calcularSimples(146490, 'III');
    expect(r.faixa).toBe(1); expect(r.aliquotaEfetiva).toBeCloseTo(0.06, 6); expect(r.limiteFaixa).toBe(180000);
  });
  it('faixa 2 do Anexo III usa a parcela a deduzir', () => {
    expect(calcularSimples(300000, 'III').aliquotaEfetiva).toBeCloseTo(0.0808, 6);
  });
  it('Anexo V faixa 1 dá 15,5%', () => {
    expect(calcularSimples(146490, 'V').aliquotaEfetiva).toBeCloseTo(0.155, 6);
  });
  it('180.000 ainda é faixa 1; 180.000,01 é faixa 2', () => {
    expect(calcularSimples(180000, 'III').faixa).toBe(1);
    expect(calcularSimples(180000.01, 'III').faixa).toBe(2);
  });
  it('receita zero usa a alíquota nominal da faixa 1', () => {
    expect(calcularSimples(0, 'III').aliquotaEfetiva).toBe(0.06);
  });
  it('marca aviso acima de 1,8 mi', () => {
    expect(calcularSimples(1800000, 'III').acimaDeUmPontoOitoMi).toBe(false);
    expect(calcularSimples(2000000, 'III').acimaDeUmPontoOitoMi).toBe(true);
  });
  it('partilha de todas as faixas soma 100%', () => {
    for (const anexo of ['III', 'V'] as const)
      for (const rbt of [100000, 200000, 500000, 1000000, 2000000, 4000000]) {
        const p = calcularSimples(rbt, anexo).partilha;
        expect(p.irpj + p.csll + p.cofins + p.pis + p.cpp + p.iss).toBeCloseTo(1, 6);
      }
  });
  it('Fator R: 28% exatos vai para o III; abaixo vai para o V', () => {
    expect(anexoPorFatorR(28000, 100000)).toBe('III');
    expect(anexoPorFatorR(27999, 100000)).toBe('V');
    expect(anexoPorFatorR(0, 0)).toBe('III'); // sem receita: sem imposto, escolha neutra
  });
  it('preço por unidades segue os exemplos do site', () => {
    expect([20, 30, 60, 80, 120, 150, 0].map(precoMensalPorUnidades))
      .toEqual([298, 298, 595, 773, 1129, 1486, 0]);
  });
});
