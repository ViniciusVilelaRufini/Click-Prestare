import { BadRequestException } from '@nestjs/common';
import { VagasService } from './vagas.service';

describe('VagasService.liberar e revogar — migração Pessoas + Visitas', () => {
  const APTO = { id: 10, id_condominio: 1, qtd_vagas: 2 };
  const MORADORES = [{ id: 5, nome: 'Titular Morador', tipo: 'Morador' }];

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
          visita: data.id_visita ? { id: data.id_visita, pessoa: { nome: 'Visitante Nova Pessoa' } } : null,
          beneficiario: null,
          titular: { nome: 'Titular Morador' },
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
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => MORADORES) },
      apartamentos: { findFirst: jest.fn(async () => APTO) },
    };

    const svc = new VagasService(prisma, facial as any);
    jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue(APTO);
    jest.spyOn(svc as any, 'moradoresDoApto').mockResolvedValue(MORADORES);

    return { svc, prisma, facial };
  }

  it('com PESSOAS_MIGRATION_ENABLED=true, libera vaga buscando por Pessoa.id e preenche id_visita', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma, facial } = build();

    const visitaMock = {
      id: 1000050,
      id_pessoa: 2000010,
      id_apartamento: APTO.id,
      codigo_acesso: '123456',
    };
    prisma.visitas.findFirst.mockResolvedValueOnce(visitaMock);

    const res = await svc.liberar(1, APTO.id, {
      id_morador_titular: 5,
      tipo: 'visitante',
      id_visitante: 2000010, // Passado como id da Pessoa vindo de beneficiarios
      inicio: '2026-09-22T10:00:00.000Z',
      fim: '2026-09-22T18:00:00.000Z',
    });

    expect(prisma.visitas.findFirst).toHaveBeenCalledWith({
      where: {
        id_apartamento: APTO.id,
        OR: [{ id: 2000010 }, { id_pessoa: 2000010 }],
      },
      orderBy: { created_at: 'desc' },
    });

    expect(prisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 1000050 },
      data: expect.objectContaining({
        liberado: 1,
        bloqueado: 0,
        codigo_acesso: '123456',
      }),
    });

    expect(prisma.vagas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_condominio: APTO.id_condominio,
        id_apartamento: APTO.id,
        id_morador_titular: 5,
        tipo_ocupacao: 'visitante',
        id_visita: 1000050,
        id_visitante: null,
      }),
      include: expect.any(Object),
    });

    expect(facial.syncVisitante).toHaveBeenCalledWith(1000050);
    expect(res.ocupante_nome).toBe('Visitante Nova Pessoa');
    expect(res.id_visita).toBe(1000050);
  });

  it('com PESSOAS_MIGRATION_ENABLED=true, aceita id_visita explícito e gera PIN se ausente', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma, facial } = build();

    const visitaSemPin = {
      id: 1000077,
      id_pessoa: 2000022,
      id_apartamento: APTO.id,
      codigo_acesso: null,
    };
    prisma.visitas.findFirst.mockResolvedValueOnce(visitaSemPin);

    await svc.liberar(1, APTO.id, {
      id_morador_titular: 5,
      tipo: 'visitante',
      id_visita: 1000077,
    });

    expect(prisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 1000077 },
      data: expect.objectContaining({
        liberado: 1,
        codigo_acesso: expect.stringMatching(/^\d{6}$/),
      }),
    });

    expect(facial.syncVisitante).toHaveBeenCalledWith(1000077);
  });

  it('com PESSOAS_MIGRATION_ENABLED=false, mantém fallback para tabela legada Visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma, facial } = build();

    prisma.visitantes.findFirst.mockResolvedValueOnce({
      id: 42,
      id_apartamento: APTO.id,
      codigo_acesso: '654321',
    });

    await svc.liberar(1, APTO.id, {
      id_morador_titular: 5,
      tipo: 'visitante',
      id_visitante: 42,
    });

    expect(prisma.visitantes.findFirst).toHaveBeenCalledWith({
      where: { id: 42, id_apartamento: APTO.id },
    });

    expect(prisma.visitantes.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ liberado: 1, codigo_acesso: '654321' }),
    });

    expect(prisma.vagas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_visitante: 42,
        id_visita: null,
      }),
      include: expect.any(Object),
    });

    expect(facial.syncVisitante).toHaveBeenCalledWith(42);
  });

  it('lança BadRequestException se visitante não for encontrado nem em visitas nem em visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc } = build();

    await expect(
      svc.liberar(1, APTO.id, {
        id_morador_titular: 5,
        tipo: 'visitante',
        id_visitante: 999999,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('revogar vaga de visitante reconcilia facial usando id_visita', async () => {
    const { svc, prisma, facial } = build();

    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 99,
      id_apartamento: APTO.id,
      tipo_ocupacao: 'visitante',
      id_visita: 1000088,
      id_visitante: null,
    });

    const res = await svc.revogar(1, APTO.id, 99);

    expect(res).toEqual({ ok: true });
    expect(prisma.vagas.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { ativo: 0 },
    });
    expect(facial.syncVisitante).toHaveBeenCalledWith(1000088);
  });
});
