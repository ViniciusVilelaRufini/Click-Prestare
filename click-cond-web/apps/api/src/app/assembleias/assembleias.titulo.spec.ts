import { BadRequestException } from '@nestjs/common';
import { AssembleiasService } from './assembleias.service';

/** A assembleia podia ser salva sem título (o app não validava e a API também não). */
describe('AssembleiasService — título obrigatório', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build() {
    const prisma: any = {
      isConnected: true,
      assembleias: {
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => ({ anexos: '' })),
      },
      users: { findUnique: jest.fn(async () => ({ id: 1 })) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const storage: any = { chaveDoArquivo: jest.fn(() => null) };
    const service = new (AssembleiasService as any)(prisma, storage, tenant) as AssembleiasService;
    return { service, prisma };
  }

  it.each(['', '   ', undefined, null])('insert com título %j → 400 e não grava', async (titulo) => {
    const { service, prisma } = build();
    await expect(service.insert(1, { titulo, descricao: 'x' }, 1, sindico)).rejects.toThrow(
      new BadRequestException('Título é obrigatório.'),
    );
    expect(prisma.assembleias.create).not.toHaveBeenCalled();
  });

  it('update com título vazio → 400 e não grava', async () => {
    const { service, prisma } = build();
    await expect(service.update(1, { id: 5, titulo: '  ' }, 1, sindico)).rejects.toThrow('Título é obrigatório.');
    expect(prisma.assembleias.updateMany).not.toHaveBeenCalled();
  });

  it('grava o título sem espaços nas pontas', async () => {
    const { service, prisma } = build();
    await service.insert(1, { titulo: '  AGO 2026 ', descricao: 'x' }, 1, sindico);
    expect(prisma.assembleias.create.mock.calls[0][0].data.titulo).toBe('AGO 2026');
    await service.update(1, { id: 5, titulo: ' AGE ' }, 1, sindico);
    expect(prisma.assembleias.updateMany.mock.calls[0][0].data.titulo).toBe('AGE');
  });
});
