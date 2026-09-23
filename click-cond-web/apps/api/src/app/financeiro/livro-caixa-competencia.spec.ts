import { FinanceiroService } from './financeiro.service';

/**
 * Livro caixa: cada lançamento pertence a UM mês — o do pagamento (`data`)
 * ou, sem pagamento, o do vencimento. É a regra da lista de meses
 * (getAllMeses). A consulta do mês usava `data OU vencimento` no período:
 * conta paga em 28/05 com vencimento 05/06 entrava em maio E em junho e era
 * somada no saldo dos dois meses.
 */
const pagaEmMaioVenceJunho = {
  id: 1, id_condominio: 1, nome: 'QA_SECURITY_20260923 Manutenção', tipo: 'D', categoria: 'Manutenção',
  id_usuario: null, valor: 100, pago: 1, status: '1',
  data: new Date(2026, 4, 28), data_vencimento: new Date(2026, 5, 5), created_at: new Date(2026, 4, 20),
};
const abertaVenceJunho = {
  ...pagaEmMaioVenceJunho, id: 2, pago: 0, status: '0', data: null, data_vencimento: new Date(2026, 5, 10),
};

function dentro(valor: Date | null, filtro: any): boolean {
  if (filtro === null) return valor === null;
  if (!valor) return false;
  return (!filtro.gte || valor >= filtro.gte) && (!filtro.lte || valor <= filtro.lte);
}
function casa(item: any, cond: any): boolean {
  return Object.entries(cond).every(([campo, f]) => {
    if (campo === 'OR') return (f as any[]).some((c) => casa(item, c));
    if (campo === 'AND') return (f as any[]).every((c) => casa(item, c));
    if (campo === 'NOT') return true; // conta pessoal: fora do escopo deste teste
    if (campo === 'data' || campo === 'data_vencimento') return dentro(item[campo], f);
    if (f && typeof f === 'object') return true;
    return item[campo] === f;
  });
}

function servico() {
  const itens = [pagaEmMaioVenceJunho, abertaVenceJunho];
  const prisma: any = {
    isConnected: true,
    financeiro: { findMany: jest.fn(async ({ where }: any) => (where ? itens.filter((i) => casa(i, where)) : itens)) },
    condominios: { findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: 'Taxa' })) },
    apartamentos: { findMany: jest.fn(async () => []) },
  };
  const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
  const svc = Object.create(FinanceiroService.prototype);
  Object.assign(svc, { prisma, tenant });
  return svc as FinanceiroService;
}

const ids = (r: any) => Object.values(r.lancamentos).flat().map((l: any) => l.id).sort();
const sindico: any = { sub: 1, nome: 'QA', typeAccess: 'Sindico' };

describe('livro caixa — um lançamento, um mês', () => {
  it('conta paga em maio aparece só em maio', async () => {
    const svc = servico();
    expect(ids(await svc.getAll(1, '5', '2026', true, sindico))).toEqual([1]);
    expect(ids(await svc.getAll(1, '6', '2026', true, sindico))).toEqual([2]);
  });

  it('o saldo de junho não soma a conta já paga em maio', async () => {
    const svc = servico();
    const junho: any = await svc.getAll(1, '6', '2026', true, sindico);
    expect(junho.totalDespesa).not.toContain('100')
    expect(ids(junho)).not.toContain(1);
  });
});
