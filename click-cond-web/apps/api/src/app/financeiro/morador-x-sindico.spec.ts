import { FinanceiroService } from './financeiro.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * O morador e o síndico olham a mesma dívida por telas diferentes:
 * `getByUser` (app do morador) x `getAllInadimplentes`/`getInadimplenteDetail`
 * (aba Inadimplência). Quando os filtros divergem, um vê cobrança que o outro
 * não vê — e ninguém consegue explicar o número do outro.
 *
 * Divergência encontrada: "cobrança de R$ 0,00 não é dívida" era aplicado nas
 * TRÊS consultas do síndico e em nenhuma do morador. O job de recorrência
 * gerou cobranças zeradas antes da validação de valor existir, e elas ficavam
 * visíveis só no app: o morador via uma pendência de R$ 0,00 que o síndico não
 * enxergava, então não tinha como explicar nem dar baixa.
 */
describe('FinanceiroService.getByUser — mesmo recorte que a inadimplência', () => {
  const MORADOR = 77;
  const morador: JwtPayload = { sub: MORADOR, nome: 'Morador', typeAccess: 'Morador' };

  const cobranca = (id: number, valor: number, extra: any = {}) => ({
    id, id_condominio: 1, nome: 'Apto 101 Bloco A - Taxa Condominial Ref. 08/2026',
    tipo: 'C', valor, pago: 0, status: '0', id_usuario: null,
    data: new Date(2026, 7, 1), data_vencimento: new Date(2026, 7, 10),
    categoria: 'Taxa Condominial', url_boleto: null, url_comprovante: null,
    photo: null, linha_digitavel: null, pix_copia_cola: null, ...extra,
  });

  function build(registros: any[]) {
    const prisma: any = {
      isConnected: true,
      financeiro: { findMany: jest.fn(async () => registros) },
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: 'pix@demo' })) },
      moradores: { findMany: jest.fn(async () => [{ apartamento: '101', bloco: 'A' }]) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
    };
    const noop: any = { registrar: jest.fn() };
    const svc = new FinanceiroService(
      prisma, { isDataUrl: () => false } as any, noop, noop, noop,
      { assertPodeAlterar: jest.fn() } as any, { generateCharge: jest.fn() } as any,
      { assertCondominio: jest.fn(async () => undefined) } as any,
    );
    return { svc };
  }

  it('esconde a cobrança de R$ 0,00 — o síndico também não a vê', async () => {
    const { svc } = build([cobranca(1, 650), cobranca(2, 0)]);
    const res: any[] = await svc.getByUser(MORADOR, 1, morador);

    expect(res.map((r) => r.id)).toEqual([1]);
  });

  it('mantém a conta pessoal do morador mesmo zerada — é dele, pode corrigir', async () => {
    const contaPessoal = cobranca(3, 0, {
      nome: 'Luz', tipo: 'D', id_usuario: MORADOR,
    });
    const { svc } = build([cobranca(1, 650), contaPessoal]);
    const res: any[] = await svc.getByUser(MORADOR, 1, morador);

    expect(res.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it('cobrança de outra unidade continua fora', async () => {
    const doVizinho = cobranca(4, 650, {
      nome: 'Apto 202 Bloco B - Taxa Condominial Ref. 08/2026',
    });
    const { svc } = build([cobranca(1, 650), doVizinho]);
    const res: any[] = await svc.getByUser(MORADOR, 1, morador);

    expect(res.map((r) => r.id)).toEqual([1]);
  });
});
