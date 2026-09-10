import { FinanceiroService } from './financeiro.service';

/**
 * Dashboard de inadimplência: o `apto`/`bloco` que ele devolve em cada item não
 * é decoração. É o par que o app manda de volta ao abrir o detalhe da unidade
 * (`/financeiro/inadimplente/get`) e ao acionar "Notificar Morador".
 *
 * Ele era extraído com um regex próprio — `/\bApto\s+(\S+)/` — e `\S+` para no
 * primeiro espaço. Unidade "10 A" virava "10", e com o valor truncado o
 * drill-down não achava fatura nenhuma e a cobrança não chegava a ninguém.
 */
describe('FinanceiroService — identificação da unidade no dashboard', () => {
  function montar(apartamentos: any[], cobrancas: any[]) {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findMany: jest.fn(async () => apartamentos),
        count: jest.fn(async () => apartamentos.length),
      },
      financeiro: { findMany: jest.fn(async () => cobrancas) },
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: '' })) },
    };

    const tenant = { assertCondominio: jest.fn(async () => undefined) };

    const svc: any = new FinanceiroService(
      prisma, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, tenant as any,
    );

    return { svc };
  }

  const cobranca = (id: number, nome: string) => ({
    id,
    nome,
    valor: 100,
    pago: 0,
    status: '0',
    data_vencimento: new Date(2026, 7, 10),
    data: null,
    origem: null,
  });

  it('devolve a identificação COMPLETA de unidade com espaço no nome', async () => {
    const { svc } = montar(
      [{ apto: '10 A', bloco: 'A' }],
      [cobranca(1, 'Apto 10 A Bloco A - Ref. 08/2026')],
    );

    const r = await svc.getInadimplenciaDashboard(7, '8', '2026');

    // O regex antigo devolvia '10' aqui, e o app perdia a unidade.
    expect(r.pendentes[0].apto).toBe('10 A');
    expect(r.pendentes[0].bloco).toBe('A');
  });

  it('devolve o bloco completo quando ele tem espaço', async () => {
    const { svc } = montar(
      [{ apto: '10', bloco: 'A B' }],
      [cobranca(1, 'Apto 10 Bloco A B - Ref. 08/2026')],
    );

    const r = await svc.getInadimplenciaDashboard(7, '8', '2026');

    expect(r.pendentes[0].bloco).toBe('A B');
  });

  it('condomínio sem bloco continua funcionando', async () => {
    const { svc } = montar(
      [{ apto: '5', bloco: null }],
      [cobranca(1, 'Apto 5 - Ref. 08/2026')],
    );

    const r = await svc.getInadimplenciaDashboard(7, '8', '2026');

    expect(r.pendentes[0].apto).toBe('5');
    expect(r.pendentes[0].bloco).toBe('');
  });

  it('formato do condomínio de teste da Superlógica (bloco minúsculo)', async () => {
    const { svc } = montar(
      [{ apto: '1', bloco: 'a' }],
      [cobranca(1, 'Apto 1 Bloco a - Ref. 08/2026')],
    );

    const r = await svc.getInadimplenciaDashboard(7, '8', '2026');

    expect(r.pendentes[0].apto).toBe('1');
    expect(r.pendentes[0].bloco).toBe('a');
  });
});
