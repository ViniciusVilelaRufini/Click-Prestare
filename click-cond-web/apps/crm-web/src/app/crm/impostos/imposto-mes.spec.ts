import { calcularImpostoMes, lerConfigImposto } from './imposto-mes';

const base = { faturas: [], totalFaturasCarregadas: 0, clientes: [], mrrTotal: 0, mesApuracao: '11/2026',
  config: { modoAnexo: 'III' as const, folhaMensal: 0, inicioAtividade: null } };

describe('calcularImpostoMes', () => {
  it('DAS do mês = receita do mês × alíquota efetiva', () => {
    const r = calcularImpostoMes({ ...base, faturas: [{ referencia: '11/2026', valor: 11595 }] });
    expect(r.das).toBeCloseTo(695.7, 2);
  });
  it('sem faturas no mês usa o MRR e marca', () => {
    const r = calcularImpostoMes({ ...base, mrrTotal: 773 });
    expect(r.receitaMes).toBe(773); expect(r.receitaMesPeloMrr).toBe(true);
  });
  it('fator_r sem folha cai no Anexo V e avisa', () => {
    const r = calcularImpostoMes({ ...base, faturas: [{ referencia: '10/2026', valor: 10000 }],
      config: { modoAnexo: 'fator_r', folhaMensal: 0, inicioAtividade: null } });
    expect(r.simples.anexo).toBe('V'); expect(r.folhaNaoInformada).toBe(true);
  });
  it('imposto por cliente ignora inativos', () => {
    const r = calcularImpostoMes({ ...base, clientes: [
      { id: 1, nome: 'A', mrr: 773, ativo: true }, { id: 2, nome: 'B', mrr: 298, ativo: false }] });
    expect(r.porCliente).toEqual([{ clienteId: 1, nome: 'A', mensalidade: 773, imposto: 46.38, liquido: 726.62 }]);
  });
  it('500 faturas carregadas acende o aviso de corte', () => {
    expect(calcularImpostoMes({ ...base, totalFaturasCarregadas: 500 }).faturasPodemEstarCortadas).toBe(true);
  });
  it('porTributo na ordem fixa, com textos da Reforma', () => {
    const r = calcularImpostoMes({ ...base, faturas: [{ referencia: '11/2026', valor: 1000 }] });
    expect(r.porTributo.map((t) => t.tributo)).toEqual(['CPP (INSS patronal)', 'ISS', 'PIS', 'Cofins', 'IRPJ', 'CSLL']);
    expect(r.porTributo[1].reforma).toBe('vira IBS (2029–2033)');
  });
  it('sem faturas e MRR 0: semDados true e não usa MRR', () => {
    const r = calcularImpostoMes(base);
    expect(r.semDados).toBe(true); expect(r.receitaMesPeloMrr).toBe(false);
  });
  it('sem faturas e MRR 773: semDados false e usa MRR', () => {
    const r = calcularImpostoMes({ ...base, mrrTotal: 773 });
    expect(r.semDados).toBe(false); expect(r.receitaMesPeloMrr).toBe(true);
  });
  it('conta faturas estimadas na janela e no mês', () => {
    const r = calcularImpostoMes({ ...base, faturas: [
      { referencia: '11/2026', valor: 100, estimada: true },
      { referencia: '05/2026', valor: 100, estimada: true },
      { referencia: '05/2026', valor: 100 },
      { referencia: '09/2025', valor: 100, estimada: true },
    ] });
    expect(r.faturasEstimadas).toBe(2);
  });
  it('fatorR é null sem RBT12', () => {
    expect(calcularImpostoMes(base).fatorR).toBeNull();
  });
});

describe('lerConfigImposto', () => {
  it('tolera valores ruins', () => {
    expect(lerConfigImposto({ imposto_anexo: 'xyz', imposto_folha_mensal: '-5', imposto_inicio_atividade: '13/2026' }))
      .toEqual({ modoAnexo: 'fator_r', folhaMensal: 0, inicioAtividade: null });
    expect(lerConfigImposto({ imposto_anexo: 'V', imposto_folha_mensal: '4500.50', imposto_inicio_atividade: '03/2025' }))
      .toEqual({ modoAnexo: 'V', folhaMensal: 4500.5, inicioAtividade: '03/2025' });
  });
});
