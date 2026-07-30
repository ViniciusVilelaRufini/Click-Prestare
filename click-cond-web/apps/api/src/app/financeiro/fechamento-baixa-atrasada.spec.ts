import { ForbiddenException } from '@nestjs/common';
import { FechamentoService } from './fechamento.service';

/**
 * Depois que o síndico fecha a competência, dar baixa em cobrança de morador
 * continua liberado — morador paga atrasado o tempo todo e travar isso pararia
 * a operação.
 *
 * A regra antiga só reconhecia o nome no formato do app ("- Ref. MM/AAAA").
 * Ficavam de fora as duas origens mais usadas: a recorrência automática, que
 * grava "- <categoria_padrao> Ref. MM/AAAA", e o modal "Cobrar morador" da
 * portaria-web, que grava "- <categoria> Ref. MM/AAAA" — além de rateio e
 * acordo. Na prática, fechar o mês travava a baixa da maioria das faturas.
 */
describe('FechamentoService — baixa de cobrança de morador em mês fechado', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      fechamentoMensal: {
        // Julho/2026 fechado.
        findFirst: jest.fn(async ({ where }: any) =>
          where.mes === 7 && where.ano === 2026 ? { id: 1 } : null,
        ),
      },
    };
    const auditoria: any = { registrar: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    return new FechamentoService(prisma, auditoria, tenant);
  }

  const emJulho = new Date(2026, 6, 10);

  const cobrancasDeMorador = [
    ['app do síndico', 'Apto 101 Bloco A - Ref. 07/2026'],
    ['recorrência automática', 'Apto 101 Bloco A - Condomínio Ref. 07/2026'],
    ['modal da portaria-web', 'Apto 101 Bloco A - Taxa Condominial Ref. 07/2026'],
    ['rateio extraordinário', 'Apto 101 Bloco A - Rateio: Pintura da fachada'],
    ['acordo parcelado', 'Apto 101 Bloco A - Acordo Parc. 2/6'],
  ];

  it.each(cobrancasDeMorador)('PERMITE dar baixa — %s', async (_origem, nome) => {
    const svc = build();
    await expect(
      svc.assertPodeAlterar(1, emJulho, 'updateStatus', nome),
    ).resolves.toBeUndefined();
  });

  it('continua BLOQUEANDO despesa do condomínio no mês fechado', async () => {
    const svc = build();
    await expect(
      svc.assertPodeAlterar(1, emJulho, 'updateStatus', 'Conta de luz da portaria'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('continua BLOQUEANDO edição de cobrança de morador (só a baixa é exceção)', async () => {
    const svc = build();
    await expect(
      svc.assertPodeAlterar(1, emJulho, 'update', 'Apto 101 Bloco A - Condomínio Ref. 07/2026'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não interfere em mês aberto', async () => {
    const svc = build();
    await expect(
      svc.assertPodeAlterar(1, new Date(2026, 7, 10), 'update', 'Conta de luz'),
    ).resolves.toBeUndefined();
  });
});
