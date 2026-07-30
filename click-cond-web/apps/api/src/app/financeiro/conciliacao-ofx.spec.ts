import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Conciliação bancária: casa as linhas do extrato OFX com as cobranças em
 * aberto para o síndico dar baixa em lote.
 *
 * O caso normal de um condomínio é justamente o que quebrava: dezenas de
 * moradores pagam a MESMA taxa, então o OFX tem N linhas de valor idêntico.
 * Como nada marcava uma cobrança como já sugerida, todas as N linhas casavam
 * com a MESMA primeira cobrança em aberto — a tela mostrava N sugestões
 * apontando para o mesmo apartamento e a confirmação baixava uma cobrança só,
 * deixando N-1 pagamentos reais em aberto.
 */
describe('FinanceiroService — conciliação OFX', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  function transacao(valor: number, data: string, fitid: string) {
    return `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${data}<TRNAMT>${valor}<FITID>${fitid}<MEMO>PIX RECEBIDO</STMTTRN>`;
  }

  function build(unpaid: any[]) {
    const prisma: any = {
      isConnected: true,
      financeiro: {
        findMany: jest.fn(async () => unpaid),
        findUnique: jest.fn(async ({ where }: any) => unpaid.find((u) => u.id === where.id) ?? null),
        update: jest.fn(async ({ where }: any) => ({ id: where.id })),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, { generateCharge: jest.fn() } as any, tenant,
    );
    return { svc, prisma };
  }

  const taxa = (id: number, apto: string) => ({
    id,
    id_condominio: 1,
    nome: `Apto ${apto} Bloco A - Ref. 07/2026`,
    tipo: 'C',
    valor: 650,
    pago: 0,
    status: '0',
    data: null,
    data_vencimento: new Date('2026-07-10'),
  });

  it('cada transação do extrato consome uma cobrança diferente', async () => {
    const { svc } = build([taxa(1, '101'), taxa(2, '102'), taxa(3, '103')]);
    const ofx =
      transacao(650, '20260710', 'A') +
      transacao(650, '20260710', 'B') +
      transacao(650, '20260710', 'C');

    const r = await svc.parseOfxContent(1, ofx, sindico);
    const ids = r.results.map((x: any) => x.suggestion?.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(3);
  });

  it('sobra sem sugestão quando o extrato tem mais pagamentos que cobranças', async () => {
    const { svc } = build([taxa(1, '101')]);
    const ofx = transacao(650, '20260710', 'A') + transacao(650, '20260710', 'B');

    const r = await svc.parseOfxContent(1, ofx, sindico);
    expect(r.results[0].suggestion?.id).toBe(1);
    expect(r.results[1].suggestion).toBeNull();
    expect(r.results[1].matchType).toBe('none');
  });

  it('entre cobranças de mesmo valor, escolhe a de vencimento mais próximo', async () => {
    const longe = { ...taxa(1, '101'), data_vencimento: new Date('2026-07-30') };
    const perto = { ...taxa(2, '102'), data_vencimento: new Date('2026-07-11') };
    const { svc } = build([longe, perto]);

    const r = await svc.parseOfxContent(1, transacao(650, '20260710', 'A'), sindico);
    expect(r.results[0].suggestion?.id).toBe(2);
    expect(r.results[0].matchType).toBe('exact');
  });

  it('valor sem cobrança correspondente não recebe sugestão', async () => {
    const { svc } = build([taxa(1, '101')]);
    const r = await svc.parseOfxContent(1, transacao(1234.56, '20260710', 'A'), sindico);
    expect(r.results[0].suggestion).toBeNull();
  });

  describe('confirmarConciliacao', () => {
    it('deduplica o mesmo lançamento enviado duas vezes', async () => {
      const { svc, prisma } = build([taxa(1, '101')]);
      const r = await svc.confirmarConciliacao(
        1,
        [
          { databaseId: 1, dataPagamento: '2026-07-10' },
          { databaseId: 1, dataPagamento: '2026-07-10' },
        ],
        sindico,
      );
      expect(r.confirmados).toBe(1);
      expect(prisma.financeiro.update).toHaveBeenCalledTimes(1);
    });
  });
});
