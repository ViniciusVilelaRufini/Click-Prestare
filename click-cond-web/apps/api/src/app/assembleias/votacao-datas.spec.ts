import { BadRequestException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/** Enquete com término antes do início era criada e já nascia "encerrada". */
describe('AssembleiasService.insertVotacao — datas', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      isConnected: true,
      votacoes: { create: jest.fn(async () => ({ id: 9 })) },
      votacoes_Opcoes: { createMany: jest.fn(async () => ({ count: 2 })) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new AssembleiasService(prisma, {} as any, tenant);
    return { svc, prisma };
  }

  it('recusa término anterior ao início', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.insertVotacao({ titulo: 'x', data_inicio: '28/09/2026', data_termino: '20/09/2026', opcoes: ['a', 'b'] }, 1, sindico),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.votacoes.create).not.toHaveBeenCalled();
  });

  it('aceita início e término no mesmo dia', async () => {
    const { svc, prisma } = build();
    await svc.insertVotacao({ titulo: 'x', data_inicio: '28/09/2026', data_termino: '28/09/2026', opcoes: ['a', 'b'] }, 1, sindico);
    expect(prisma.votacoes.create).toHaveBeenCalled();
  });
});
