import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Dashboard de Inadimplência — os cards têm que refletir a mesma dívida que a
 * lista "por bloco" logo abaixo deles.
 *
 * Bug real: os cards mostravam BRL 0,00 e "0/62 aptos devendo" enquanto os
 * blocos exibiam 18/20/19 unidades em atraso. O dashboard filtrava as
 * cobranças por `categoria = Condominios.categoria_padrao`, e bastava esse
 * campo divergir da categoria gravada nas cobranças para nada ser encontrado.
 * A lista por bloco nunca usou categoria — casa pelo nome do apartamento.
 */
describe('FinanceiroService — dashboard de inadimplência', () => {
  const APTOS = [
    { apto: '101', bloco: 'A' },
    { apto: '102', bloco: 'A' },
  ];

  function cobranca(over: any = {}) {
    return {
      id: 1,
      id_condominio: 1,
      nome: 'Apto 101 Bloco A - Taxa Condominial Ref. 06/2026',
      tipo: 'C',
      categoria: 'Taxa Condominial',
      valor: 550,
      pago: 0,
      status: '0',
      data: null,
      data_vencimento: new Date('2026-06-10'),
      created_at: new Date('2026-06-01'),
      updated_at: new Date('2026-06-01'),
      ...over,
    };
  }

  function build(lancamentos: any[], categoriaPadrao: string) {
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn(async () => ({
          chave_pix: '',
          categoria_padrao: categoriaPadrao,
        })),
      },
      apartamentos: {
        findMany: jest.fn(async () => APTOS),
        count: jest.fn(async () => APTOS.length),
      },
      financeiro: { findMany: jest.fn(async () => lancamentos) },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(
      prisma, storage, noop, noop, noop, fechamento, { generateCharge: jest.fn() } as any, tenant,
    );
    jest.spyOn(svc as any, 'getAllMeses').mockResolvedValue([{ mes: '06', ano: '2026' }]);
    return svc;
  }

  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  // O caso que quebrou em produção: categoria_padrao valia "Elite" (nome de
  // plano) enquanto as cobranças eram "Taxa Condominial".
  it('mostra a dívida mesmo com categoria_padrao divergente das cobranças', async () => {
    const svc = build([cobranca()], 'Elite');
    const r: any = await svc.getInadimplenciaDashboard(1, '6', '2026', sindico);

    expect(r.resumo.qtdPendentes).toBe(1);
    expect(r.resumo.qtdAptosDevendo).toBe(1);
    expect(r.resumo.totalPendente).toContain('550');
  });

  it('separa arrecadado de pendente', async () => {
    const svc = build(
      [
        cobranca({ id: 1, pago: 1 }),
        cobranca({ id: 2, nome: 'Apto 102 Bloco A - Taxa Condominial Ref. 06/2026' }),
      ],
      'Taxa Condominial',
    );
    const r: any = await svc.getInadimplenciaDashboard(1, '6', '2026', sindico);

    expect(r.resumo.qtdPagas).toBe(1);
    expect(r.resumo.qtdPendentes).toBe(1);
    expect(r.resumo.qtdAptosDevendo).toBe(1);
    expect(r.resumo.totalAptos).toBe(2);
    expect(r.resumo.percInadimplencia).toBe(50);
  });

  // Receita do condomínio que não é de apartamento (aluguel de salão, por
  // exemplo) não é inadimplência de morador e não pode entrar nos cards.
  it('ignora cobrança tipo C que não aponta para um apartamento', async () => {
    const svc = build(
      [cobranca({ id: 9, nome: 'Aluguel do salão de festas' })],
      'Taxa Condominial',
    );
    const r: any = await svc.getInadimplenciaDashboard(1, '6', '2026', sindico);

    expect(r.resumo.qtdPendentes).toBe(0);
    expect(r.resumo.qtdAptosDevendo).toBe(0);
  });

  // Apartamento de outro bloco com o mesmo número não pode contar como dívida
  // deste — o casamento olha bloco além do número.
  it('não confunde apartamentos de blocos diferentes', async () => {
    const svc = build(
      [cobranca({ id: 5, nome: 'Apto 101 Bloco B - Taxa Condominial Ref. 06/2026' })],
      'Taxa Condominial',
    );
    const r: any = await svc.getInadimplenciaDashboard(1, '6', '2026', sindico);

    expect(r.resumo.qtdPendentes).toBe(0);
  });
});
