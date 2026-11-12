import { BadRequestException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/** Votação/enquete era criada sem título, com opção repetida/vazia, data em branco e assembleia de outro condomínio. */
describe('AssembleiasService.insertVotacao — validação', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };
  const base = { titulo: 'Pintura', data_inicio: '01/12/2026', data_termino: '10/12/2026', opcoes: ['Sim', 'Não'] };

  function build(assembleia: any = { id: 5 }) {
    const prisma: any = {
      isConnected: true,
      assembleias: { findFirst: jest.fn(async () => assembleia) },
      votacoes: { create: jest.fn(async () => ({ id: 9 })) },
      votacoes_Opcoes: { createMany: jest.fn(async () => ({ count: 2 })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    return { svc: new AssembleiasService(prisma, {} as any, tenant), prisma };
  }

  async function recusa(v: any, msg: string, b = build()) {
    await expect(b.svc.insertVotacao(v, 1, sindico)).rejects.toThrow(new BadRequestException(msg));
    expect(b.prisma.votacoes.create).not.toHaveBeenCalled();
  }

  it('recusa título vazio ou só espaços', async () => {
    await recusa({ ...base, titulo: '   ' }, 'Informe o título da votação.');
    await recusa({ ...base, titulo: undefined }, 'Informe o título da votação.');
    await recusa({ ...base, titulo: '  ', is_enquete: true }, 'Informe o título da enquete.');
  });

  it('recusa menos de duas opções diferentes (vazias e repetidas não contam)', async () => {
    const msg = 'Informe pelo menos duas opções diferentes.';
    await recusa({ ...base, opcoes: ['Sim', ' '] }, msg);
    await recusa({ ...base, opcoes: ['Sim', ' sim '] }, msg);
    await recusa({ ...base, opcoes: undefined }, msg);
  });

  it('recusa data de início ou término ausente', async () => {
    const msg = 'Informe as datas de início e término.';
    await recusa({ ...base, data_inicio: '' }, msg);
    await recusa({ ...base, data_termino: undefined }, msg);
  });

  it('recusa assembleia de outro condomínio', async () => {
    const b = build(null);
    await recusa({ ...base, id_assembleia: 5 }, 'Assembleia não encontrada neste condomínio.', b);
    expect(b.prisma.assembleias.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, id_condominio: 1 } }),
    );
  });

  it('grava votação e opções limpas numa única transação', async () => {
    const { svc, prisma } = build();
    await svc.insertVotacao({ ...base, titulo: ' Pintura ', opcoes: [' Sim ', 'sim', '', 'Não'], id_assembleia: 5 }, 1, sindico);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.votacoes.create.mock.calls[0][0].data).toMatchObject({ titulo: 'Pintura', id_assembleia: 5, id_condominio: 1 });
    expect(prisma.votacoes_Opcoes.createMany).toHaveBeenCalledWith({
      data: [{ id_votacao: 9, nome: 'Sim' }, { id_votacao: 9, nome: 'Não' }],
    });
  });
});
