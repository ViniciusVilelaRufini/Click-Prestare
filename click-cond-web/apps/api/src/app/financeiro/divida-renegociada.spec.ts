import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O acordo de inadimplência marca a dívida original com `status = '3'`
 * (renegociada) e cria as parcelas no lugar dela. Só que NENHUMA consulta lia
 * esse status: a dívida antiga continuava aparecendo em toda leitura de
 * inadimplência, agora acompanhada das parcelas do acordo.
 *
 * O apartamento passava a dever duas vezes o mesmo valor — nos cards do
 * dashboard, no percentual de inadimplência, na lista por bloco, na tela do
 * morador, nos lembretes de vencimento e na régua de cobrança por WhatsApp
 * (o morador recebia cobrança da dívida no mesmo dia em que a renegociou).
 */
describe('FinanceiroService — dívida renegociada sai da inadimplência', () => {
  const APTO = { id: 1, apto: '101', bloco: 'A' };

  const dividaRenegociada = {
    id: 50,
    id_condominio: 1,
    nome: 'Apto 101 Bloco A - Ref. 05/2026',
    tipo: 'C',
    valor: 650,
    pago: 0,
    status: '3', // substituída pelas parcelas do acordo
    id_usuario: null,
    data: null,
    data_vencimento: new Date('2026-05-10'),
    created_at: new Date('2026-05-01'),
    updated_at: new Date('2026-05-01'),
  };

  const parcelaDoAcordo = {
    ...dividaRenegociada,
    id: 60,
    nome: 'Apto 101 Bloco A - Acordo Parc. 1/2',
    valor: 325,
    status: '0',
    data_vencimento: new Date('2026-05-10'),
  };

  /** Mock que honra `status: { not: '3' }` — é o filtro sob teste. */
  function build(registros: any[]) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: 'Taxa Condominial' })) },
      apartamentos: {
        findMany: jest.fn(async () => [APTO]),
        count: jest.fn(async () => 1),
      },
      moradores: { findMany: jest.fn(async () => [{ apartamento: '101', bloco: 'A' }]) },
      apartamentos_Users: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => ({ id_apto: 1 })) },
      financeiro: {
        findMany: jest.fn(async ({ where }: any) => {
          const excluiRenegociado = where?.status?.not === '3';
          return registros.filter((r) => !(excluiRenegociado && r.status === '3'));
        }),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, { generateCharge: jest.fn() } as any, tenant,
    );
    jest.spyOn(svc as any, 'getAllMeses').mockResolvedValue([{ mes: '05', ano: '2026' }]);
    return svc;
  }

  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };
  const ambas = [dividaRenegociada, parcelaDoAcordo];

  it('getAllInadimplentes conta só a parcela do acordo, não a dívida original', async () => {
    const svc = build(ambas);
    const r = await svc.getAllInadimplentes(1, sindico);
    expect(r.blocos[0].aptos[0].qtd).toBe(1);
  });

  it('getInadimplenteDetail não lista a dívida renegociada', async () => {
    const svc = build(ambas);
    const faturas = await svc.getInadimplenteDetail(1, '101', 'A', sindico);
    expect(faturas.map((f: any) => f.id)).toEqual([60]);
  });

  it('o dashboard não soma o valor duas vezes', async () => {
    const svc = build(ambas);
    const r: any = await svc.getInadimplenciaDashboard(1, '05', '2026', sindico);
    expect(r.resumo.qtdPendentes).toBe(1);
    expect(r.resumo.totalPendente).toContain('325');
  });

  it('o morador vê apenas a parcela, não o débito que já renegociou', async () => {
    const svc = build(ambas);
    const lista = await svc.getByUser(47, 1, sindico);
    expect(lista.map((l: any) => l.id)).toEqual([60]);
  });
});
