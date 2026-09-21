import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

describe('MobileAuthService.liberarVaga e revogarVaga — migração Pessoas + Visitas', () => {
  const APTO = { id: 10, qtd_vagas: 2 };
  const CTX = { moradorId: 5, idCondominio: 1, apto: APTO };

  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const facial = { syncVisitante: jest.fn(async () => ({ ok: true })) };
    const prisma: any = {
      isConnected: true,
      vagas: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({
          id: 99,
          ...data,
          veiculo: null,
          visitante: null,
          visita: data.id_visita ? { id: data.id_visita, pessoa: { nome: 'Visitante App Pessoa' } } : null,
          beneficiario: null,
          titular: { nome: 'Morador Titular' },
        })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      veiculos: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      visitas: {
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      visitantes: {
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };

    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial as any);
    jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue(CTX);

    return { svc, prisma, facial };
  }

  it('libera vaga para visitante por Pessoa.id preenchendo id_visita e disparando sync', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma, facial } = build();

    const visitaMock = {
      id: 1000033,
      id_pessoa: 2000099,
      id_apartamento: APTO.id,
      codigo_acesso: '998877',
    };
    prisma.visitas.findFirst.mockResolvedValueOnce(visitaMock);

    const res = await svc.liberarVaga(1, 1, {
      tipo: 'visitante',
      id_visitante: 2000099,
      inicio: '2026-09-22T08:00:00.000Z',
      fim: '2026-09-22T20:00:00.000Z',
    });

    expect(prisma.visitas.findFirst).toHaveBeenCalledWith({
      where: {
        id_apartamento: APTO.id,
        OR: [{ id: 2000099 }, { id_pessoa: 2000099 }],
      },
      orderBy: { created_at: 'desc' },
    });

    expect(prisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 1000033 },
      data: expect.objectContaining({
        liberado: 1,
        bloqueado: 0,
        codigo_acesso: '998877',
      }),
    });

    expect(prisma.vagas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_condominio: 1,
        id_apartamento: APTO.id,
        id_morador_titular: CTX.moradorId,
        tipo_ocupacao: 'visitante',
        id_visita: 1000033,
        id_visitante: null,
      }),
      include: expect.any(Object),
    });

    expect(facial.syncVisitante).toHaveBeenCalledWith(1000033);
    expect(res.ocupante_nome).toBe('Visitante App Pessoa');
    expect(res.id_visita).toBe(1000033);
  });

  it('revogarVaga reconcilia facial com id_visita se presente', async () => {
    const { svc, prisma, facial } = build();

    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 77,
      id_apartamento: APTO.id,
      tipo_ocupacao: 'visitante',
      id_visita: 1000055,
      id_visitante: null,
    });

    const res = await svc.revogarVaga(1, 1, 77);

    expect(res).toEqual({ ok: true });
    expect(prisma.vagas.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { ativo: 0 },
    });
    expect(facial.syncVisitante).toHaveBeenCalledWith(1000055);
  });

  it('revogarVaga zera liberado e codigo_acesso da Visita — sem isto o rosto/PIN continuava valendo após "revogar"', async () => {
    const { svc, prisma } = build();

    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 78,
      id_apartamento: APTO.id,
      tipo_ocupacao: 'visitante',
      id_visita: 1000066,
      id_visitante: null,
    });

    await svc.revogarVaga(1, 1, 78);

    expect(prisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 1000066 },
      data: { liberado: 0, codigo_acesso: null },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('revogarVaga zera liberado e codigo_acesso do Visitante legado quando não há id_visita', async () => {
    const { svc, prisma } = build();

    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 79,
      id_apartamento: APTO.id,
      tipo_ocupacao: 'visitante',
      id_visita: null,
      id_visitante: 555,
    });

    await svc.revogarVaga(1, 1, 79);

    expect(prisma.visitantes.update).toHaveBeenCalledWith({
      where: { id: 555 },
      data: { liberado: 0, codigo_acesso: null },
    });
  });

  it('rejeita liberarVaga com BadRequestException quando a Visita encontrada está bloqueada pela portaria', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();

    prisma.visitas.findFirst.mockResolvedValueOnce({
      id: 1000044,
      id_pessoa: 2000099,
      id_apartamento: APTO.id,
      codigo_acesso: '112233',
      bloqueado: 1,
    });

    await expect(
      svc.liberarVaga(1, 1, { tipo: 'visitante', id_visitante: 2000099 }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.visitas.update).not.toHaveBeenCalled();
  });

  it('rejeita com BadRequestException quando visitante não é encontrado', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc } = build();

    await expect(
      svc.liberarVaga(1, 1, {
        tipo: 'visitante',
        id_visitante: 987654,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
