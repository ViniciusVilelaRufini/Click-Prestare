import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Tela de Arrecadações (taxas por apartamento): uma linha por unidade.
 *
 * O mês pode ter mais de uma cobrança para a mesma unidade — taxa + rateio,
 * taxa + parcela de acordo. Qual delas aparecia dependia da ordem em que o
 * MySQL devolvia as linhas: a mesma tela, recarregada, trocava de cobrança.
 */
describe('FinanceiroService — arrecadações por apartamento', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  const APTO = { id: 1, apto: '101', bloco: 'A' };

  function cobranca(over: Partial<any>) {
    return {
      id: 1,
      id_condominio: 1,
      nome: 'Apto 101 Bloco A - Ref. 07/2026',
      tipo: 'C',
      valor: 650,
      pago: 0,
      status: '0',
      data: null,
      data_vencimento: new Date(Date.UTC(2026, 6, 10)),
      conta: null,
      descricao: null,
      categoria: 'Condomínio',
      linha_digitavel: null,
      pix_copia_cola: null,
      url_boleto: null,
      url_comprovante: null,
      photo: null,
      ...over,
    };
  }

  /** Mock que honra `tipo` e o `status: { not: '3' }` do where. */
  function build(registros: any[]) {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findMany: jest.fn(async () => [APTO]) },
      financeiro: {
        findMany: jest.fn(async ({ where }: any) =>
          registros.filter((r) => {
            if (where?.tipo && r.tipo !== where.tipo) return false;
            if (where?.status?.not && r.status === where.status.not) return false;
            return true;
          }),
        ),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, { generateCharge: jest.fn() } as any, tenant,
    );
    jest.spyOn(svc as any, 'getAllMeses').mockResolvedValue([{ mes: '07', ano: '2026' }]);
    return svc;
  }

  const primeiroApto = (r: any) => r.blocos[0].aptos[0];

  it('prioriza a cobrança em aberto sobre a já paga', async () => {
    const svc = build([
      cobranca({ id: 10, pago: 1, status: '1' }),
      cobranca({ id: 11, nome: 'Apto 101 Bloco A - Rateio: Pintura', pago: 0 }),
    ]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).financeiro_id).toBe(11);
  });

  it('entre duas em aberto, mostra a de vencimento mais antigo', async () => {
    const svc = build([
      cobranca({ id: 20, data_vencimento: new Date(Date.UTC(2026, 6, 25)) }),
      cobranca({ id: 21, data_vencimento: new Date(Date.UTC(2026, 6, 5)) }),
    ]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).financeiro_id).toBe(21);
  });

  it('sinaliza quantas cobranças a unidade tem no mês', async () => {
    const svc = build([
      cobranca({ id: 30 }),
      cobranca({ id: 31, nome: 'Apto 101 Bloco A - Rateio: Pintura' }),
    ]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).qtd_cobrancas).toBe(2);
  });

  it('unidade com uma cobrança só reporta qtd 1', async () => {
    const svc = build([cobranca({ id: 40 })]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).qtd_cobrancas).toBe(1);
  });

  it('não mostra a dívida renegociada em acordo', async () => {
    const svc = build([
      cobranca({ id: 50, status: '3' }), // substituída pelas parcelas
      cobranca({ id: 51, nome: 'Apto 101 Bloco A - Acordo Parc. 1/3', valor: 220 }),
    ]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).financeiro_id).toBe(51);
    expect(primeiroApto(r).qtd_cobrancas).toBe(1);
  });

  it('unidade sem cobrança no mês aparece zerada, sem quebrar', async () => {
    const svc = build([]);
    const r = await svc.getAllMoradores(1, '07', '2026', sindico);
    expect(primeiroApto(r).financeiro_id).toBeNull();
    expect(primeiroApto(r).valor).toBe(0);
    expect(primeiroApto(r).qtd_cobrancas).toBe(0);
  });
});
