import { ForbiddenException } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Conta pessoal é o que o morador lança para se organizar — luz, água,
 * internet (tipo 'D' com `id_usuario`, criada por `insertMoradorConta`). Não
 * é dinheiro do condomínio, e o síndico a lia de duas formas:
 *  - `GET /financeiro/get?id=…` liberava conta pessoal a "dono OU síndico";
 *  - `GET /financeiro/get-by-user?id_user=<morador>` devolvia ao síndico as
 *    contas pessoais do morador junto das cobranças do condomínio.
 *
 * Regra: conta pessoal só para o dono. O síndico continua lendo as contas do
 * condomínio — cobrança 'C' (mesmo com `id_usuario`) e lançamento sem dono.
 */
describe('Financeiro — conta pessoal só para o dono', () => {
  const MORADOR = 47;
  const SINDICO = 5;
  const sindico: JwtPayload = { sub: SINDICO, nome: 'Síndico', typeAccess: 'Sindico' };
  const morador: JwtPayload = { sub: MORADOR, nome: 'Morador', typeAccess: 'Morador' };

  const base = {
    id_condominio: 1, valor: 120, pago: 0, status: '0',
    data: new Date(2026, 7, 1), data_vencimento: new Date(2026, 7, 10),
    categoria: null, url_boleto: null, url_comprovante: null, photo: null,
    linha_digitavel: null, pix_copia_cola: null, origem: null, nome_operador: null,
  };
  const contaPessoal = { ...base, id: 1, nome: 'Luz', tipo: 'D', id_usuario: MORADOR };
  const contaPessoalDoSindico = { ...base, id: 4, nome: 'Internet', tipo: 'D', id_usuario: SINDICO };
  const cobrancaComDono = { ...base, id: 2, nome: 'Apto 101 Bloco A - Taxa Condominial', tipo: 'C', id_usuario: MORADOR };
  const cobrancaDaUnidade = { ...base, id: 3, nome: 'Apto 101 Bloco A - Fundo de reserva', tipo: 'C', id_usuario: null };

  function build(registros: any[]) {
    const prisma: any = {
      isConnected: true,
      financeiro: {
        findMany: jest.fn(async () => registros),
        findFirst: jest.fn(async ({ where }: any) => registros.find((r) => r.id === where.id) ?? null),
      },
      condominios: { findUnique: jest.fn(async () => ({ chave_pix: 'pix@demo' })) },
      moradores: { findMany: jest.fn(async () => [{ apartamento: '101', bloco: 'A' }]) },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
    };
    const noop: any = { registrar: jest.fn() };
    const svc = new FinanceiroService(
      prisma, { isDataUrl: () => false } as any, noop, noop, noop,
      { assertPodeAlterar: jest.fn() } as any, { assertCondominio: jest.fn(async () => undefined) } as any,
    );
    return { svc };
  }

  describe('get', () => {
    it('NEGA ao síndico a conta pessoal do morador', async () => {
      const { svc } = build([contaPessoal]);
      await expect(svc.get(1, 1, sindico)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('o dono lê a própria conta pessoal', async () => {
      const { svc } = build([contaPessoal]);
      await expect(svc.get(1, 1, morador)).resolves.toMatchObject({ id: 1 });
    });

    it('síndico continua lendo cobrança do condomínio, mesmo com id_usuario', async () => {
      const { svc } = build([cobrancaComDono, cobrancaDaUnidade]);
      await expect(svc.get(1, 2, sindico)).resolves.toMatchObject({ id: 2 });
      await expect(svc.get(1, 3, sindico)).resolves.toMatchObject({ id: 3 });
    });

    it('NEGA ao porteiro do console a conta pessoal cujo id_usuario coincide com o sub dele', async () => {
      const porteiro: JwtPayload = {
        sub: MORADOR, nome: 'Portaria', id_condominio: 1, turno: 'Manha', tipo_sub: 'funcionario_portaria',
      } as any;
      const { svc } = build([contaPessoal]);
      await expect(svc.get(1, 1, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('token do CRM com sub coincidente também não é dono', async () => {
      const crm: JwtPayload = { sub: MORADOR, nome: 'CRM', role: 'crm_admin' } as any;
      const { svc } = build([contaPessoal]);
      await expect(svc.get(1, 1, crm)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * `update`, `remove` e `updateStatus` passam por `getLancamentoForTenant`,
   * que só conferia o condomínio: o síndico editava, apagava e dava baixa na
   * conta pessoal do morador.
   */
  describe('mutações (getLancamentoForTenant)', () => {
    function buildMut(registro: any) {
      const prisma: any = {
        isConnected: true,
        financeiro: {
          findUnique: jest.fn(async () => ({ ...registro })),
          update: jest.fn(async () => ({ ...registro })),
          delete: jest.fn(async () => ({ ...registro })),
        },
      };
      const noop: any = { registrar: jest.fn(async () => undefined) };
      const svc = new FinanceiroService(
        prisma, { isDataUrl: () => false } as any, noop, noop, noop,
        { assertPodeAlterar: jest.fn(async () => undefined) } as any,
        { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) } as any,
      );
      jest.spyOn(svc as any, 'carregarContextoLancamento').mockResolvedValue(null);
      return { svc, prisma };
    }

    it('NEGA ao síndico editar, apagar e dar baixa na conta pessoal do morador', async () => {
      const { svc, prisma } = buildMut(contaPessoal);
      await expect(svc.remove(1, sindico)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.updateStatus(1, '1', sindico)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.update(1, { id: 1, valor: '10', nome: 'Luz' }, 'Síndico', sindico)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();
      expect(prisma.financeiro.delete).not.toHaveBeenCalled();
    });

    it('o dono passa pela checagem; cobrança do condomínio segue com o síndico', async () => {
      const dono = buildMut(contaPessoal);
      await expect(dono.svc.remove(1, morador)).resolves.toEqual({ success: true });
      const cobranca = buildMut({ ...cobrancaComDono, origem: null });
      await expect(cobranca.svc.remove(2, sindico)).resolves.toEqual({ success: true });
    });
  });

  describe('getByUser', () => {
    it('síndico consultando o morador NÃO recebe as contas pessoais dele', async () => {
      const { svc } = build([contaPessoal, cobrancaComDono, cobrancaDaUnidade]);
      const res: any[] = await svc.getByUser(MORADOR, 1, sindico);
      expect(res.map((r) => r.id).sort()).toEqual([2, 3]);
    });

    it('o próprio morador recebe as contas pessoais', async () => {
      const { svc } = build([contaPessoal, cobrancaComDono, cobrancaDaUnidade]);
      const res: any[] = await svc.getByUser(MORADOR, 1, morador);
      expect(res.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    });

    it('síndico consultando a si mesmo recebe as contas pessoais dele', async () => {
      const { svc } = build([contaPessoalDoSindico]);
      const res: any[] = await svc.getByUser(SINDICO, 1, sindico);
      expect(res.map((r) => r.id)).toEqual([4]);
    });
  });
});
