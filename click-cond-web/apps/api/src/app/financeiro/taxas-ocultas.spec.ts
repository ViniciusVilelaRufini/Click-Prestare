import { FinanceiroService } from './financeiro.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O livro caixa esconde as taxas condominiais por padrão — elas vivem na aba
 * Inadimplência. O efeito na tela é "Total de Receitas R$ 0,00" num prédio com
 * dezenas de faturas em aberto: número correto que parece defeito, e a única
 * explicação era um `title` no checkbox, invisível sem passar o mouse.
 *
 * `taxasCondominiaisOcultas` diz quantas ficaram de fora, para a tela poder
 * declarar o que está escondendo.
 */
describe('FinanceiroService.getAll — contagem de taxas ocultas', () => {
  const sindico: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico', id_condominio: 1 };

  const taxa = (id: number, apto: string) => ({
    id, id_condominio: 1, nome: `Apto ${apto} Bloco A - Taxa Condominial Ref. 08/2026`,
    tipo: 'C', valor: 650, pago: 0, status: '0', id_usuario: null,
    data: new Date(2026, 7, 1), data_vencimento: new Date(2026, 7, 10),
    categoria: 'Taxa Condominial', nome_operador: 'Sistema', created_at: new Date(2026, 7, 1),
  });
  const despesa = {
    ...taxa(99, 'x'), nome: 'Conta de luz da portaria', tipo: 'D', valor: 220, pago: 1,
  };

  function build(registros: any[]) {
    const prisma: any = {
      isConnected: true,
      financeiro: { findMany: jest.fn(async () => registros) },
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: 'Taxa Condominial' })) },
      apartamentos: { findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }, { apto: '102', bloco: 'A' }]) },
      $queryRaw: jest.fn(async () => []),
    };
    const noop: any = { registrar: jest.fn() };
    const svc = new FinanceiroService(
      prisma, { isDataUrl: () => false } as any, noop, noop, noop,
      { assertPodeAlterar: jest.fn() } as any, { generateCharge: jest.fn() } as any,
      { assertCondominio: jest.fn(async () => undefined) } as any,
    );
    return { svc };
  }

  it('conta as taxas que ficaram fora dos totais', async () => {
    const { svc } = build([taxa(1, '101'), taxa(2, '102'), despesa]);
    const res: any = await svc.getAll(1, '8', '2026', true, sindico, false);

    expect(res.taxasCondominiaisOcultas).toBe(2);
    expect(res.totalReceita).toContain('0,00');
  });

  it('zera a contagem quando o síndico pede o livro caixa completo', async () => {
    const { svc } = build([taxa(1, '101'), taxa(2, '102'), despesa]);
    const res: any = await svc.getAll(1, '8', '2026', true, sindico, true);

    expect(res.taxasCondominiaisOcultas).toBe(0);
  });

  it('zero quando não há taxa nenhuma no período', async () => {
    const { svc } = build([despesa]);
    const res: any = await svc.getAll(1, '8', '2026', true, sindico, false);

    expect(res.taxasCondominiaisOcultas).toBe(0);
  });
});
