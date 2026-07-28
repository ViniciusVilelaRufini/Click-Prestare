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

  function build(lancamentos: any[]) {
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn(async () => ({ chave_pix: '', categoria_padrao: 'Taxa Condominial' })),
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

  // Cobrança 'C' com id_usuario (ex.: taxa condominial por apto) não é o alvo
  // deste filtro — ela já é excluída pela categoria — mas confirma que a regra
  // olha o tipo, não só a presença de id_usuario.
  it('não exclui por engano uma cobrança tipo C com id_usuario', async () => {
    const cobrancaComUsuario = {
      ...despesaDoCondominio,
      id: 900,
      tipo: 'C',
      categoria: 'Arrecadação',
      id_usuario: 47,
    };
    const svc = build([cobrancaComUsuario]);
    const r = await svc.getAll(1, '7', '2026', true, sindico);
    const itens = Object.values(r.lancamentos).flat() as any[];
    expect(itens).toHaveLength(1);
  });
});
