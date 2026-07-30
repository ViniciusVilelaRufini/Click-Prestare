import { MobileAuthService } from './mobile-auth.service';

/**
 * Card "Inadimplência" na home do síndico (GET /dashboard/summary).
 *
 * Ele abre a lista de inadimplentes, então tem que contar a mesma coisa que
 * ela. Contava TODO lançamento não pago do condomínio, e o número não queria
 * dizer nada:
 *
 *  - despesa do prédio a pagar entra NEGATIVA no banco e subtraía do total;
 *  - conta pessoal do morador (água, luz) entra positiva e inflava — além de
 *    ser dado privado dele agregado na tela do síndico;
 *  - dívida renegociada contava junto com as parcelas que a substituíram.
 */
describe('MobileAuthService.getSummary — card de inadimplência do síndico', () => {
  function build() {
    let whereUsado: any = null;
    const registros = [
      { id: 1, nome: 'Apto 101 Bloco A - Ref. 07/2026', tipo: 'C', valor: 650, pago: 0, status: '0' },
      { id: 2, nome: 'Apto 102 Bloco A - Ref. 07/2026', tipo: 'C', valor: 650, pago: 0, status: '0' },
      // Despesa do condomínio: negativa, não é inadimplência.
      { id: 3, nome: 'Conta de luz da portaria', tipo: 'D', valor: -900, pago: 0, status: '0' },
      // Conta pessoal do morador: privada, não é dívida com o condomínio.
      { id: 4, nome: 'Internet', tipo: 'D', valor: 120, pago: 0, status: '0' },
      // Já renegociada: substituída pelas parcelas do acordo.
      { id: 5, nome: 'Apto 103 Bloco A - Ref. 05/2026', tipo: 'C', valor: 650, pago: 0, status: '3' },
    ];

    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: { findMany: jest.fn(async () => [{ id_condominio: 1 }]) },
      financeiro: {
        findMany: jest.fn(async ({ where }: any) => {
          whereUsado = where;
          return registros.filter((r) => {
            if (where.tipo && r.tipo !== where.tipo) return false;
            if (where.valor?.gt !== undefined && !(r.valor > where.valor.gt)) return false;
            if (where.status?.not && r.status === where.status.not) return false;
            if (where.pago !== undefined && r.pago !== where.pago) return false;
            return true;
          });
        }),
      },
      ocorrencias: { count: jest.fn(async () => 0) },
    };

    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, whereUsado: () => whereUsado };
  }

  it('soma só as cobranças de apartamento em aberto', async () => {
    const { svc } = build();
    const r: any = await svc.getSummary(1, 'Sindico');
    expect(r.debts.total).toBe(1300);
    expect(r.debts.count).toBe(2);
  });

  it('a query pede tipo C, valor positivo e não renegociado', async () => {
    const { svc, whereUsado } = build();
    await svc.getSummary(1, 'Sindico');
    expect(whereUsado()).toMatchObject({
      pago: 0,
      tipo: 'C',
      valor: { gt: 0 },
      status: { not: '3' },
    });
  });
});
