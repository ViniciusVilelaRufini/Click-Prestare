import { BadRequestException } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Segregação soft: marcar como PAGO um lançamento que você mesmo criou exige
 * motivo + forma de pagamento. A tela abre um modal pedindo isso ANTES de
 * enviar, decidindo pelo `nome_operador` do lançamento.
 *
 * O buraco: a aba Inadimplência só tem o id da fatura em mãos e busca o
 * lançamento pelo `GET /financeiro/get` — cujo DTO não devolvia
 * `nome_operador`. A tela concluía "não é auto-aprovação", mandava sem motivo,
 * e o servidor recusava com um texto pedindo o motivo que ela nunca chegou a
 * perguntar. Contradição pura: a mensagem exige justificativa e não há onde
 * digitá-la.
 *
 * Corrigido dos dois lados: o `get` devolve o campo, e a recusa carrega um
 * `code` para o cliente abrir o modal em vez de só pintar a mensagem.
 */
describe('FinanceiroService — baixa com justificativa (auto-aprovação)', () => {
  const SINDICO: JwtPayload = { sub: 42, nome: 'Sindico Railway', id_condominio: 1, typeAccess: 'Sindico' };

  const lancamento = {
    id: 500,
    id_condominio: 1,
    nome: 'Apto 101 Bloco A - Taxa Condominial Ref. 08/2026',
    tipo: 'C',
    valor: 732.6,
    pago: 0,
    status: '0',
    id_usuario: null,
    data: new Date(2026, 7, 1),
    data_vencimento: new Date(2026, 7, 10),
    categoria: 'Taxa Condominial',
    // Criado pelo próprio síndico que agora tenta dar baixa.
    nome_operador: 'Sindico Railway',
    conta: null,
    descricao: null,
    cliente: null,
    forma_pagamento: null,
    parcelas: null,
    photo: null,
    url_comprovante: null,
    linha_digitavel: null,
    pix_copia_cola: null,
  };

  function buildService() {
    const prisma: any = {
      isConnected: true,
      financeiro: {
        findUnique: jest.fn(async () => ({ ...lancamento })),
        findFirst: jest.fn(async ({ where }: any) =>
          Object.entries(where).every(([k, v]) => (lancamento as any)[k] === v)
            ? { ...lancamento }
            : null,
        ),
        update: jest.fn(async () => ({ ...lancamento, pago: 1 })),
      },
    };
    const noop: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const fechamento: any = { assertPodeAlterar: jest.fn(async () => undefined) };
    const openPix: any = { generateCharge: jest.fn() };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
    };
    const svc = new FinanceiroService(prisma, storage, noop, noop, noop, fechamento, openPix, tenant);
    return { svc, prisma };
  }

  describe('get — o DTO alimenta a decisão da tela', () => {
    it('devolve nome_operador e valorString', async () => {
      const { svc } = buildService();
      const dto: any = await svc.get(1, 500, SINDICO);

      // Sem este campo a tela nunca detecta auto-aprovação e cai no beco sem saída.
      expect(dto.nome_operador).toBe('Sindico Railway');
      expect(dto.valorString).toContain('732,60');
    });
  });

  describe('updateStatus', () => {
    it('recusa sem motivo COM code — o cliente usa isso pra abrir o modal', async () => {
      const { svc, prisma } = buildService();

      await expect(svc.updateStatus(500, 1, SINDICO)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.financeiro.update).not.toHaveBeenCalled();

      const erro = await svc.updateStatus(500, 1, SINDICO).catch((e) => e);
      expect(erro.getResponse()).toMatchObject({ code: 'AUTO_APROVACAO_EXIGE_JUSTIFICATIVA' });
      // A mensagem em português continua chegando junto.
      expect(erro.getResponse().message).toContain('você mesmo criou');
    });

    it('recusa com o mesmo code quando falta a forma de pagamento', async () => {
      const { svc } = buildService();
      const erro = await svc
        .updateStatus(500, 1, SINDICO, { motivo: 'Pago em dinheiro pelo morador' })
        .catch((e) => e);

      expect(erro.getResponse()).toMatchObject({ code: 'AUTO_APROVACAO_EXIGE_JUSTIFICATIVA' });
    });

    it('aceita quando motivo e forma de pagamento vêm juntos', async () => {
      const { svc, prisma } = buildService();
      await expect(
        svc.updateStatus(500, 1, SINDICO, {
          motivo: 'Pago em dinheiro pelo morador',
          formaPagamento: 'Dinheiro',
        }),
      ).resolves.toEqual({ success: true });

      expect(prisma.financeiro.update).toHaveBeenCalled();
      const dados = prisma.financeiro.update.mock.calls[0][0].data;
      expect(dados.pago).toBe(1);
      expect(dados.forma_pagamento).toBe('Dinheiro');
    });

    it('operador diferente do autor não precisa justificar', async () => {
      const { svc, prisma } = buildService();
      const outro: JwtPayload = { ...SINDICO, nome: 'Porteiro Noturno' };

      await expect(svc.updateStatus(500, 1, outro)).resolves.toEqual({ success: true });
      expect(prisma.financeiro.update).toHaveBeenCalled();
    });

    it('desmarcar pagamento nunca exige justificativa', async () => {
      const { svc } = buildService();
      await expect(svc.updateStatus(500, 0, SINDICO)).resolves.toEqual({ success: true });
    });
  });
});
