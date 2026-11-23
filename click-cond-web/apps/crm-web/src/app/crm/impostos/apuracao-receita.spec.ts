import { apurarReceita, mesAtualBrasilia } from './apuracao-receita';

const f = (referencia: string, valor: number) => ({ referencia, valor });

describe('apurarReceita', () => {
  it('12 meses cheios somam direto, sem o mês corrente', () => {
    const meses = ['11/2025','12/2025','01/2026','02/2026','03/2026','04/2026','05/2026','06/2026','07/2026','08/2026','09/2026','10/2026'];
    const r = apurarReceita([...meses.map((m) => f(m, 12000)), f('11/2026', 5000), f('10/2025', 99999)], '11/2026', '01/2024');
    expect(r.rbt12).toBe(144000);
    expect(r.receitaMes).toBe(5000);
    expect(r.mesesConsiderados).toBe(12);
    expect(r.proporcionalizada).toBe(false);
    expect(r.semDados).toBe(false);
  });
  it('menos de 12 meses: média × 12', () => {
    const r = apurarReceita([f('08/2026', 10000), f('09/2026', 10000), f('10/2026', 10000)], '11/2026', '08/2026');
    expect(r.rbt12).toBe(120000);
    expect(r.mesesConsiderados).toBe(3);
    expect(r.proporcionalizada).toBe(true);
  });
  it('primeiro mês: receita do mês × 12', () => {
    const r = apurarReceita([f('11/2026', 773)], '11/2026', '11/2026');
    expect(r.rbt12).toBe(9276);
    expect(r.mesesConsiderados).toBe(0);
    expect(r.proporcionalizada).toBe(true);
  });
  it('sem início informado usa a fatura mais antiga', () => {
    expect(apurarReceita([f('09/2026', 6000), f('10/2026', 6000)], '11/2026', null).rbt12).toBe(72000);
  });
  it('sem faturas marca semDados', () => {
    const r = apurarReceita([], '11/2026', null);
    expect(r.semDados).toBe(true);
    expect(r.rbt12).toBe(0);
  });
  it('ignora referência malformada', () => {
    expect(apurarReceita([f('2026-10', 500), f('10/2026', 1000)], '11/2026', '10/2026').rbt12).toBe(12000);
  });
  it('malformada não vira início nem tira semDados', () => {
    const r = apurarReceita([f('13/2026', 500), f('2026-10', 500)], '11/2026', null);
    expect(r.semDados).toBe(true);
    expect(r.rbt12).toBe(0);
  });
  it('início malformado vale como nulo', () => {
    expect(apurarReceita([f('10/2026', 1000)], '11/2026', 'abc').rbt12).toBe(12000);
  });
  it('faturas antes do início de atividade não contam', () => {
    const r = apurarReceita([f('08/2026', 5000), f('09/2026', 1000), f('10/2026', 1000)], '11/2026', '09/2026');
    expect(r.rbt12).toBe(12000);
    expect(r.mesesConsiderados).toBe(2);
  });
  it('arredonda a 2 casas', () => {
    expect(apurarReceita([f('08/2026', 100), f('09/2026', 100), f('10/2026', 100.01)], '11/2026', '08/2026').rbt12).toBe(1200.04);
  });
});

describe('mesAtualBrasilia', () => {
  it('usa o fuso de São Paulo', () => {
    expect(mesAtualBrasilia(new Date('2026-12-01T02:00:00Z'))).toBe('11/2026');
  });
});
