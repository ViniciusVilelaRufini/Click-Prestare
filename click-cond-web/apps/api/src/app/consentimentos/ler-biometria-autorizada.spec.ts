import { lerBiometriaAutorizada } from './consentimentos.service';

describe('lerBiometriaAutorizada', () => {
  const prismaCom = (rows: any[]) =>
    ({ consentimentos: { findMany: jest.fn().mockResolvedValue(rows) } }) as any;

  it('vale o registro mais recente de cada titular; quem não tem registro fica fora', async () => {
    // Já vem ordenado do mais novo para o mais antigo.
    const prisma = prismaCom([
      { id_user: 1, aceito: 0 },
      { id_user: 1, aceito: 1 },
      { id_user: 2, aceito: 1 },
    ]);
    const mapa = await lerBiometriaAutorizada(prisma, [1, 2, 3]);
    expect(mapa.get(1)).toBe(false);
    expect(mapa.get(2)).toBe(true);
    expect(mapa.has(3)).toBe(false);
    expect(prisma.consentimentos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: { in: [1, 2, 3] }, tipo: 'biometria' } }),
    );
  });

  it('ignora ids nulos, repetidos e não consulta quando não sobra nenhum', async () => {
    const prisma = prismaCom([]);
    expect((await lerBiometriaAutorizada(prisma, [null, undefined])).size).toBe(0);
    expect(prisma.consentimentos.findMany).not.toHaveBeenCalled();
    await lerBiometriaAutorizada(prisma, [5, 5, null]);
    expect(prisma.consentimentos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_user: { in: [5] }, tipo: 'biometria' } }),
    );
  });

  it('propaga a falha da leitura', async () => {
    const prisma = { consentimentos: { findMany: jest.fn().mockRejectedValue(new Error('boom')) } } as any;
    await expect(lerBiometriaAutorizada(prisma, [1])).rejects.toThrow('boom');
  });
});
