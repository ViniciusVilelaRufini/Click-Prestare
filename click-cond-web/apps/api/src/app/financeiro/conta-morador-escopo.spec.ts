import { NotFoundException } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { TenantAccessService } from '../auth/tenant-access.service';

/**
 * As rotas /financeiro/morador/{update,remove,anexar-codigo} existem para o
 * morador administrar as CONTAS PESSOAIS dele (água, luz, internet), que ele
 * mesmo lança no app — sempre tipo 'D'.
 *
 * A armadilha: a cobrança do condomínio também recebe `id_usuario`. O
 * `insert` do síndico lê o "Apto X Bloco Y" do nome da fatura, acha o morador
 * e amarra o lançamento a ele. Com o escopo antigo (só `id_usuario`), essas
 * três rotas aceitavam o id de uma taxa condominial: o morador lia o id em
 * /financeiro/get-by-user e então zerava o valor, marcava como paga ou
 * apagava a própria dívida. A UI não oferece os botões, mas a API aceitava.
 */
describe('FinanceiroService — rotas do morador só alcançam conta pessoal', () => {
  const MORADOR = 77;

  // Taxa condominial: tipo 'C', amarrada ao morador pelo insert do síndico.
  const taxaCondominial = {
    id: 900,
    id_condominio: 1,
    nome: 'Apto 101 Bloco A - Ref. 07/2026',
    tipo: 'C',
    valor: 650,
    pago: 0,
    status: '0',
    id_usuario: MORADOR,
  };

  // Conta pessoal legítima do mesmo morador.
  const contaPessoal = {
    id: 901,
    id_condominio: 1,
    nome: 'Luz',
    tipo: 'D',
    valor: 180,
    pago: 0,
    status: '0',
    id_usuario: MORADOR,
  };

  function buildService() {
    const registros = [taxaCondominial, contaPessoal];
    const prisma: any = {
      isConnected: true,
      financeiro: {
        // findFirst honesto: aplica todos os campos escalares do where.
        findFirst: jest.fn(async ({ where }: any) => {
          const match = registros.find((r: any) =>
            Object.entries(where).every(([k, v]) => r[k] === v),
          );
          return match ? { ...match } : null;
        }),
        update: jest.fn(async () => ({ ...contaPessoal })),
        delete: jest.fn(async () => ({ ...contaPessoal })),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const openPix: any = { generateCharge: jest.fn() };
    const tenant = new TenantAccessService(prisma);
    const svc = new FinanceiroService(prisma, storage, noop, noop, noop, fechamento, openPix, tenant);
    return { svc, prisma };
  }

  describe('updateMoradorConta', () => {
    it('NEGA o morador editar a própria taxa condominial (valor/pago)', async () => {
      const { svc, prisma } = buildService();
      await expect(
        svc.updateMoradorConta(MORADOR, 1, { id: 900, valor: '1', pago: 1, nome: 'x', categoria: 'Outros' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();
    });

    it('PERMITE editar a conta pessoal dele', async () => {
      const { svc, prisma } = buildService();
      const res = await svc.updateMoradorConta(MORADOR, 1, {
        id: 901,
        valor: '200,00',
        pago: 0,
        nome: 'Luz',
        categoria: 'Luz',
      });
      expect(res).toEqual({ success: true });
      expect(prisma.financeiro.update).toHaveBeenCalled();
    });

    it('NEGA conta pessoal de OUTRO condomínio (id_condominio confere)', async () => {
      const { svc } = buildService();
      await expect(
        svc.updateMoradorConta(MORADOR, 2, { id: 901, valor: '200', categoria: 'Luz' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeMoradorConta', () => {
    it('NEGA o morador apagar a própria dívida com o condomínio', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.removeMoradorConta(MORADOR, 900)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.financeiro.delete).not.toHaveBeenCalled();
    });

    it('PERMITE apagar a conta pessoal dele', async () => {
      const { svc, prisma } = buildService();
      await expect(svc.removeMoradorConta(MORADOR, 901)).resolves.toEqual({ success: true });
      expect(prisma.financeiro.delete).toHaveBeenCalledWith({ where: { id: 901 } });
    });
  });

});
