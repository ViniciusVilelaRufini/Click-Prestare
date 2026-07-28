import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Conta pessoal do morador (água, luz, internet — criada por ele mesmo via
 * insertMoradorConta, sempre tipo 'D' + id_usuario preenchido) não é dinheiro
 * do condomínio e não pode aparecer no livro-caixa geral que o síndico vê em
 * Financeiro → Condomínio.
 *
 * Bug real reportado: uma "Conta de Água" pessoal (id 802, tipo D,
 * id_usuario 47, condomínio 1) aparecia inteira na aba Condomínio do
 * síndico. O filtro de categoria existente só excluía a taxa condominial —
 * nunca olhava para id_usuario.
 */
describe('FinanceiroService — getAll não mostra conta pessoal do morador', () => {
  const contaAguaPessoal = {
    id: 802,
    id_condominio: 1,
    nome: 'Conta de Água',
    tipo: 'D',
    categoria: 'Água',
    id_usuario: 47,
    valor: 140,
    pago: 0,
    status: '0',
    data: null,
    data_vencimento: new Date('2026-07-27'),
    created_at: new Date('2026-07-27'),
  };

  const despesaDoCondominio = {
    ...contaAguaPessoal,
    id: 1,
    nome: 'Manutenção de Elevadores',
    categoria: 'Manutenção',
    id_usuario: null,
  };

  // findMany real filtra pelo `where`; o service só monta a query e formata o
  // que volta, então o mock precisa aplicar a exclusão para o teste provar
  // que o `where` construído está correto — não só que o service não quebra.
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

  function build(lancamentos: any[], categoriaPadrao = 'Taxa Condominial') {
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: categoriaPadrao })),
      },
      apartamentos: {
        findMany: jest.fn(async () => [{ apto: '101', bloco: 'A' }]),
      },
      financeiro: {
        findMany: jest.fn(async ({ where }: any) =>
          lancamentos.filter((l) => aplicarWhereNot(l, where)),
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

  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 1 };

  it('NÃO inclui a conta pessoal do morador no financeiro do condomínio', async () => {
    const svc = build([contaAguaPessoal]);
    const r = await svc.getAll(1, '7', '2026', true, sindico);
    expect(Object.values(r.lancamentos).flat()).toHaveLength(0);
  });

  it('mantém despesa própria do condomínio (sem id_usuario) visível', async () => {
    const svc = build([despesaDoCondominio]);
    const r = await svc.getAll(1, '7', '2026', true, sindico);
    const itens = Object.values(r.lancamentos).flat() as any[];
    expect(itens).toHaveLength(1);
    expect(itens[0].nome).toBe('Manutenção de Elevadores');
  });

  it('filtra a pessoal e mantém a do condomínio quando os dois vêm juntos', async () => {
    const svc = build([contaAguaPessoal, despesaDoCondominio]);
    const r = await svc.getAll(1, '7', '2026', true, sindico);
    const itens = Object.values(r.lancamentos).flat() as any[];
    expect(itens.map((i) => i.nome)).toEqual(['Manutenção de Elevadores']);
  });

  // Receita própria do condomínio que não é de apartamento (aluguel de salão,
  // por exemplo) continua no livro-caixa, mesmo sendo tipo 'C'.
  it('mantém receita tipo C que não aponta para apartamento', async () => {
    const receitaDoCondominio = {
      ...despesaDoCondominio,
      id: 900,
      nome: 'Aluguel do salão de festas',
      tipo: 'C',
      categoria: 'Arrecadação',
    };
    const svc = build([receitaDoCondominio]);
    const r = await svc.getAll(1, '7', '2026', true, sindico);
    const itens = Object.values(r.lancamentos).flat() as any[];
    expect(itens).toHaveLength(1);
  });

  /**
   * Financeiro do Condomínio e Inadimplência são telas distintas: a taxa que o
   * morador deve pertence à segunda e não pode aparecer na primeira.
   */
  describe('taxa de morador fica só na Inadimplência', () => {
    const taxaDoApto = {
      ...despesaDoCondominio,
      id: 950,
      nome: 'Apto 101 Bloco A - Taxa Condominial Ref. 07/2026',
      tipo: 'C',
      categoria: 'Taxa Condominial',
      valor: 550,
    };

    it('não mostra a taxa do apartamento no livro-caixa do condomínio', async () => {
      const svc = build([taxaDoApto]);
      const r = await svc.getAll(1, '7', '2026', true, sindico);
      expect(Object.values(r.lancamentos).flat()).toHaveLength(0);
    });

    // O caso que quebrou em produção: categoria_padrao valia "Elite" e as
    // cobranças eram "Taxa Condominial", então a exclusão por categoria não
    // pegava nada e as 61 taxas vazavam para o livro-caixa.
    it('exclui a taxa mesmo com categoria_padrao divergente', async () => {
      const svc = build([taxaDoApto, despesaDoCondominio], 'Elite');
      const r = await svc.getAll(1, '7', '2026', true, sindico);
      const itens = Object.values(r.lancamentos).flat() as any[];
      expect(itens.map((i) => i.nome)).toEqual(['Manutenção de Elevadores']);
    });

    it('não exclui taxa de apartamento de outro condomínio (bloco diferente)', async () => {
      const outroBloco = {
        ...taxaDoApto,
        id: 951,
        nome: 'Apto 101 Bloco B - Taxa Condominial Ref. 07/2026',
      };
      const svc = build([outroBloco]);
      const r = await svc.getAll(1, '7', '2026', true, sindico);
      // Bloco B não existe na lista de apartamentos deste condomínio, então o
      // lançamento não é reconhecido como taxa daqui e permanece visível.
      expect(Object.values(r.lancamentos).flat()).toHaveLength(1);
    });
  });
});
