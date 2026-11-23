import { simularVenda } from './simulador';

describe('simulador', () => {
  const base = { condominios: 1, unidades: 80, rbt12Atual: 0, modoAnexo: 'III' as const, folhaMensal: 0 };

  it('um condomínio de 80 unidades sem receita atual fica na faixa 1 do Anexo III', () => {
    const r = simularVenda(base);
    expect(r.mensalidade).toBe(773);
    expect(r.rbt12).toBe(9276);
    expect(r.simples.anexo).toBe('III');
    expect(r.simples.aliquotaEfetiva).toBeCloseTo(0.06, 6);
    expect(r.impostoPorCondominio).toBe(46.38);
    expect(r.liquidoPorCondominio).toBe(726.62);
    expect(r.impostoImplantacao).toBe(29.4);
    expect(r.liquidoImplantacao).toBe(460.6);
  });

  it('15 condomínios pelo Fator R sem folha caem no Anexo V', () => {
    const r = simularVenda({ ...base, condominios: 15, modoAnexo: 'fator_r' });
    expect(r.receitaMensal).toBe(11595);
    expect(r.simples.anexo).toBe('V');
    expect(r.dasMensal).toBe(1797.23);
    expect(r.fatorR).toBe(0);
  });

  it('15 condomínios com folha de R$ 4.000 voltam ao Anexo III', () => {
    const r = simularVenda({ ...base, condominios: 15, modoAnexo: 'fator_r', folhaMensal: 4000 });
    expect(r.rbt12).toBe(139140);
    expect(r.simples.anexo).toBe('III');
    expect(r.dasMensal).toBe(695.7);
    expect(r.fatorR).toBeCloseTo(48000 / 139140, 6);
  });

  it('25 condomínios passam para a faixa 2', () => {
    const r = simularVenda({ ...base, condominios: 25 });
    expect(r.rbt12).toBe(231900);
    expect(r.simples.faixa).toBe(2);
    expect(r.simples.aliquotaEfetiva).toBeCloseTo((231900 * 0.112 - 9360) / 231900, 6);
    expect(r.impostoPorCondominio).toBe(55.38);
  });

  it('soma a receita atual de 12 meses antes de achar a faixa', () => {
    expect(simularVenda({ ...base, rbt12Atual: 100000 }).rbt12).toBe(109276);
  });

  it('quantidades vazias ou negativas zeram a simulação', () => {
    const r = simularVenda({ ...base, condominios: -2, unidades: Number.NaN });
    expect(r.receitaMensal).toBe(0);
    expect(r.dasMensal).toBe(0);
    expect(r.impostoPorCondominio).toBe(0);
  });
});
