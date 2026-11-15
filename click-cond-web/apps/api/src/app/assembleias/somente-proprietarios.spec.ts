import { AssembleiasService } from './assembleias.service';

/**
 * Rodada 5 (2.7): a pauta pode ser "somente proprietários" (Lei 4.591 art. 24
 * §4º: o inquilino não vota em despesa extraordinária). A criação aceita
 * `votacao.somente_proprietarios` (bool/0/1); o app 1.2.48 não manda — 0.
 */
describe('insertVotacao — somente_proprietarios', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      isConnected: true,
      assembleias: { findFirst: jest.fn(async () => ({ id: 5, finalizada_em: null })) },
      votacoes: { create: jest.fn(async () => ({ id: 9 })) },
      votacoes_Opcoes: { createMany: jest.fn(async () => ({ count: 2 })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    return { svc: new AssembleiasService(prisma, {} as any, tenant), prisma };
  }

  // Payload exato do app 1.2.48 (new_votacao.dart → VotacaoModel.toJson).
  const doApp = {
    titulo: 'Pintura', descricao: '', data_inicio: '2026-11-14 00:00:00.000', hora_inicio: null,
    data_termino: '2026-11-30 00:00:00.000', hora_termino: null, is_enquete: null, id_assembleia: 5,
    opcoes: ['Sim', 'Não'],
  };

  it('app 1.2.48 (sem o campo): grava 0 e responde sucesso', async () => {
    const { svc, prisma } = build();
    await expect(svc.insertVotacao({ ...doApp }, 1, sindico)).resolves.toEqual({ success: true });
    expect(prisma.votacoes.create.mock.calls[0][0].data.somente_proprietarios).toBe(0);
  });

  it.each([true, 1, '1', 'true'])('somente_proprietarios = %j grava 1', async (v) => {
    const { svc, prisma } = build();
    await svc.insertVotacao({ ...doApp, somente_proprietarios: v }, 1, sindico);
    expect(prisma.votacoes.create.mock.calls[0][0].data.somente_proprietarios).toBe(1);
  });

  it.each([false, 0, '0', null, 'false'])('somente_proprietarios = %j grava 0', async (v) => {
    const { svc, prisma } = build();
    await svc.insertVotacao({ ...doApp, somente_proprietarios: v }, 1, sindico);
    expect(prisma.votacoes.create.mock.calls[0][0].data.somente_proprietarios).toBe(0);
  });

  it('enquete avulsa também aceita (o app manda id_assembleia 0)', async () => {
    const { svc, prisma } = build();
    await svc.insertVotacao({ ...doApp, is_enquete: true, id_assembleia: 0, somente_proprietarios: true }, 1, sindico);
    expect(prisma.votacoes.create.mock.calls[0][0].data).toMatchObject({ id_assembleia: null, somente_proprietarios: 1 });
  });
});
