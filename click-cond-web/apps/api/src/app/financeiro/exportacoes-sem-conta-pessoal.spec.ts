import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * A tela Financeiro → Condomínio já escondia a conta pessoal do morador
 * (água, luz, internet que ele lança para si), mas as SAÍDAS do módulo não:
 * o CSV do livro caixa e a lista de pendências da conciliação bancária
 * consultavam o Financeiro sem o filtro. Na prática, o síndico exportava o
 * livro caixa e lia as contas de casa de cada morador — e podia dar baixa
 * nelas pela conciliação.
 */
describe('FinanceiroService — exportações não vazam conta pessoal do morador', () => {
  const contaPessoal = {
    id: 802,
    id_condominio: 1,
    nome: 'Conta de Luz do 101',
    tipo: 'D',
    categoria: 'Luz',
    id_usuario: 47,
    valor: 140,
    pago: 0,
    status: '0',
    data: null,
    data_vencimento: new Date('2026-07-27'),
    created_at: new Date('2026-07-01'),
    nome_operador: null,
    conta: null,
    cliente: null,
    forma_pagamento: null,
    descricao: null,
  };

  const despesaDoCondominio = {
    ...contaPessoal,
    id: 1,
    nome: 'Manutenção de Elevadores',
    categoria: 'Manutenção',
    id_usuario: null,
    pago: 1,
    data: new Date('2026-07-05'),
  };

  // Aplica o NOT/AND do where — sem isso o teste provaria só que o service
  // não quebra, não que a query exclui de fato.
  function aplicarWhereNot(item: any, whereClause: any): boolean {
    const not = whereClause?.NOT;
    if (!not?.AND) return true;
    const bate = not.AND.every((cond: any) =>
      Object.entries(cond).every(([campo, valor]: [string, any]) => {
        if (valor && typeof valor === 'object' && 'not' in valor) {
          return item[campo] !== valor.not;
        }
        return item[campo] === valor;
      }),
    );
    return !bate;
  }

  function build(lancamentos: any[]) {
    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: 'Taxa Condominial' })) },
      apartamentos: { findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }]) },
      financeiro: {
        findMany: jest.fn(async ({ where }: any) => lancamentos.filter((l) => aplicarWhereNot(l, where))),
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

  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  describe('exportLivroCaixaCsv', () => {
    it('NÃO escreve a conta pessoal do morador no CSV', async () => {
      const svc = build([contaPessoal, despesaDoCondominio]);
      const { buffer } = await svc.exportLivroCaixaCsv(1, '07', '2026', sindico);
      const csv = buffer.toString('utf8');
      expect(csv).not.toContain('Conta de Luz do 101');
      expect(csv).toContain('Manutenção de Elevadores');
    });
  });

  describe('getGrafico', () => {
    it('NÃO cria categoria de despesa a partir da conta pessoal do morador', async () => {
      const svc = build([
        { ...contaPessoal, pago: 1, data: new Date('2026-07-27') },
        despesaDoCondominio,
      ]);
      const r = await svc.getGrafico(1, '07', '2026', sindico);
      expect(r.categorias.map((c: any) => c.categoria)).toEqual(['Manutenção']);
    });
  });

  describe('parseOfxContent', () => {
    const ofx = `
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260727<TRNAMT>-140.00<FITID>1<MEMO>PAGTO</STMTTRN>
    `;

    it('NÃO sugere nem lista a conta pessoal do morador', async () => {
      const svc = build([contaPessoal, despesaDoCondominio]);
      const r = await svc.parseOfxContent(1, ofx, sindico);
      expect(r.unpaid.map((u: any) => u.id)).not.toContain(802);
      expect(r.results[0].suggestion?.id).not.toBe(802);
    });
  });
});
