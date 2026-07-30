import { BadRequestException } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Rateio extraordinário e acordo de inadimplência: os dois criam cobrança em
 * lote, e os dois tinham o mesmo tipo de defeito — dinheiro que não fecha.
 */
describe('FinanceiroService — rateio e acordo', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  function build(opts: { aptos?: any[]; debitos?: any[] } = {}) {
    let seq = 1000;
    const criados: any[] = [];
    const atualizados: any[] = [];
    const prisma: any = {
      isConnected: true,
      apartamentos: { findMany: jest.fn(async () => opts.aptos ?? []) },
      financeiro: {
        findMany: jest.fn(async () => opts.debitos ?? []),
        create: jest.fn((args: any) => {
          const row = { id: seq++, ...args.data };
          criados.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn((args: any) => {
          atualizados.push(args);
          return Promise.resolve({ id: args.where.id, ...args.data });
        }),
      },
      // $transaction recebe promises já iniciadas pelos mocks acima.
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const auditoria: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const openPix: any = { generateCharge: jest.fn(async () => null) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, auditoria, auditoria, auditoria, fechamento, openPix, tenant,
    );
    return { svc, prisma, criados, atualizados, fechamento, openPix };
  }

  describe('createRateio', () => {
    const tresAptos = [
      { id: 1, apto: '101', bloco: 'A' },
      { id: 2, apto: '102', bloco: 'A' },
      { id: 3, apto: '103', bloco: 'A' },
    ];

    it('a soma das cobranças fecha com o valor total, mesmo sem divisão exata', async () => {
      const { svc, criados } = build({ aptos: tresAptos });
      await svc.createRateio(1, { nome: 'Pintura', valorTotal: 1000, data_vencimento: '10/08/2026', categoria: 'Obras' }, 'Síndico', sindico);

      const valores = criados.map((c) => Number(c.valor));
      expect(valores).toEqual([333.34, 333.33, 333.33]);
      const somaCentavos = valores.reduce((a, v) => a + Math.round(v * 100), 0);
      expect(somaCentavos).toBe(100000);
    });

    /**
     * A unidade fantasma não só recebia uma dívida que ninguém pagaria — ela
     * entrava no divisor e diluía o valor de todas as outras, então a soma
     * das cobranças ficava abaixo do total do rateio.
     */
    it('ignora unidade fantasma e não a usa no divisor', async () => {
      const { svc, criados } = build({
        aptos: [...tresAptos, { id: 4, apto: '000', bloco: 'Condominio' }],
      });
      await svc.createRateio(1, { nome: 'Pintura', valorTotal: 900, data_vencimento: '10/08/2026', categoria: 'Obras' }, 'Síndico', sindico);

      expect(criados).toHaveLength(3);
      expect(criados.every((c) => Number(c.valor) === 300)).toBe(true);
      expect(criados.some((c) => c.nome.includes('Apto 000'))).toBe(false);
    });

    it('recusa valor total zerado', async () => {
      const { svc } = build({ aptos: tresAptos });
      await expect(
        svc.createRateio(1, { nome: 'X', valorTotal: 0, data_vencimento: '10/08/2026', categoria: 'Obras' }, 'Síndico', sindico),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('respeita competência fechada', async () => {
      const { svc, fechamento } = build({ aptos: tresAptos });
      await svc.createRateio(1, { nome: 'X', valorTotal: 300, data_vencimento: '10/08/2026', categoria: 'Obras' }, 'Síndico', sindico);
      expect(fechamento.assertPodeAlterar).toHaveBeenCalled();
    });
  });

  describe('createAcordoInadimplente', () => {
    const debitos = [
      { id: 50, nome: 'Apto 101 Bloco A - Ref. 05/2026', valor: 650, pago: 0, status: '0' },
      { id: 51, nome: 'Apto 101 Bloco A - Ref. 06/2026', valor: 650, pago: 0, status: '0' },
    ];
    const base = { apto: '101', bloco: 'A' };

    it('as parcelas somam o valor total do acordo', async () => {
      const { svc, criados } = build({ debitos });
      await svc.createAcordoInadimplente(1, { ...base, parcelas: 3, valorTotal: 1000 }, 'Síndico', sindico);

      const valores = criados.map((c) => Number(c.valor));
      expect(valores).toEqual([333.34, 333.33, 333.33]);
      expect(valores.reduce((a, v) => a + Math.round(v * 100), 0)).toBe(100000);
    });

    /**
     * Antes: parcelas=0 gerava valorParcela = Infinity e o loop nem criava
     * parcela — mas as dívidas originais já iam ser marcadas como
     * renegociadas na mesma transação, sumindo sem substituto.
     */
    it.each([[0], [-3], [NaN as any], [61]])('recusa parcelas inválidas (%s)', async (parcelas) => {
      const { svc, prisma } = build({ debitos });
      await expect(
        svc.createAcordoInadimplente(1, { ...base, parcelas, valorTotal: 1000 }, 'Síndico', sindico),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa valor total inválido antes de renegociar qualquer dívida', async () => {
      const { svc, prisma } = build({ debitos });
      await expect(
        svc.createAcordoInadimplente(1, { ...base, parcelas: 3, valorTotal: 0 }, 'Síndico', sindico),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('não pega dívida já renegociada como base de um novo acordo', async () => {
      const { svc, prisma } = build({ debitos });
      await svc.createAcordoInadimplente(1, { ...base, parcelas: 2, valorTotal: 600 }, 'Síndico', sindico);
      const where = prisma.financeiro.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: '3' });
    });

    it('gera Pix para cada parcela criada', async () => {
      const { svc, openPix } = build({ debitos });
      await svc.createAcordoInadimplente(1, { ...base, parcelas: 3, valorTotal: 900 }, 'Síndico', sindico);
      expect(openPix.generateCharge).toHaveBeenCalledTimes(3);
      // Só as parcelas — nunca as dívidas renegociadas.
      for (const [correlation, valor] of openPix.generateCharge.mock.calls) {
        expect(correlation).toMatch(/^financeiro_\d+$/);
        expect(valor).toBe(300);
      }
    });
  });
});
