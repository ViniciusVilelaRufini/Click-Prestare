import { MobileAuthService } from './mobile-auth.service';

/**
 * Contrato do cruzamento Vagas × Facial.
 *
 * Ao reservar/liberar uma vaga para um VISITANTE, o backend deve disparar a
 * liberação automática do facial/portão via FacialService.syncVisitante (o
 * visitante já enrola nos terminais com a janela ValidFrom/ValidTo da reserva).
 * Ao revogar, deve reconciliar o estado no device (re-sync). Para inquilino,
 * NÃO deve tocar no facial (inquilino é morador, não passa por syncVisitante).
 *
 * Testa o wiring novo com mocks — sem banco, sem device real.
 */
describe('MobileAuthService — vagas dispara facial', () => {
  const APTO = { id: 10, qtd_vagas: 2 };
  const CTX = { moradorId: 5, idCondominio: 1, apto: APTO };

  function build() {
    const facial = { syncVisitante: jest.fn(async () => ({ ok: true })) };
    const prisma: any = {
      isConnected: true,
      vagas: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      veiculos: { count: jest.fn(async () => 0) },
      visitantes: {
        findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, id_apartamento: APTO.id })),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => []),
      },
      moradores: { findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })) },
    };
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, facial as any);
    // Curto-circuita a resolução do morador/apto (coberta por outros testes).
    jest.spyOn(svc as any, 'resolveMoradorApto').mockResolvedValue(CTX);
    return { svc, prisma, facial };
  }

  it('liberar vaga p/ visitante → enrola no facial com o id do visitante', async () => {
    const { svc, facial, prisma } = build();
    const inicio = new Date('2026-07-20T14:00:00').toISOString();
    const fim = new Date('2026-07-20T18:00:00').toISOString();

    await svc.liberarVaga(1, 1, { tipo: 'visitante', id_visitante: 42, inicio, fim });

    // Gravou a janela no visitante (liberado=1 + data_hora_inicio/termino)…
    expect(prisma.visitantes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({ liberado: 1 }),
      }),
    );
    // …e disparou a liberação automática do facial p/ o mesmo visitante.
    expect(facial.syncVisitante).toHaveBeenCalledTimes(1);
    expect(facial.syncVisitante).toHaveBeenCalledWith(42);
  });

  it('liberar vaga p/ inquilino → NÃO toca no facial', async () => {
    const { svc, facial } = build();
    await svc.liberarVaga(1, 1, { tipo: 'inquilino', id_morador_beneficiario: 7 });
    expect(facial.syncVisitante).not.toHaveBeenCalled();
  });

  it('revogar vaga de visitante → reconcilia o facial (re-sync)', async () => {
    const { svc, prisma, facial } = build();
    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 99,
      tipo_ocupacao: 'visitante',
      id_visitante: 42,
    });

    const res = await svc.revogarVaga(1, 1, 99);

    expect(res).toEqual({ ok: true });
    expect(prisma.vagas.update).toHaveBeenCalledWith({ where: { id: 99 }, data: { ativo: 0 } });
    expect(facial.syncVisitante).toHaveBeenCalledWith(42);
  });

  it('revogar vaga de inquilino → NÃO toca no facial', async () => {
    const { svc, prisma, facial } = build();
    prisma.vagas.findFirst.mockResolvedValueOnce({
      id: 99,
      tipo_ocupacao: 'inquilino',
      id_visitante: null,
    });

    await svc.revogarVaga(1, 1, 99);

    expect(facial.syncVisitante).not.toHaveBeenCalled();
  });

  it('beneficiários: marca tem_foto conforme foto_pessoa do visitante', async () => {
    const { svc, prisma } = build();
    prisma.visitantes.findMany.mockResolvedValueOnce([
      { id: 1, nome: 'Com Foto', doc_identificacao: '111', foto_pessoa: 'https://s3/foto.jpg' },
      { id: 2, nome: 'Sem Foto', doc_identificacao: '222', foto_pessoa: null },
      { id: 3, nome: 'Foto Vazia', doc_identificacao: '333', foto_pessoa: '   ' },
    ]);
    jest.spyOn(svc as any, 'getMoradoresApto').mockResolvedValue([]);

    const res = await svc.listBeneficiariosVaga(1, 1);

    // A lista sai ordenada por nome (pt-BR), não na ordem que veio do banco:
    // "Com Foto" < "Foto Vazia" < "Sem Foto".
    expect(res.visitantes).toEqual([
      { id: 1, nome: 'Com Foto', doc_identificacao: '111', tem_foto: true },
      { id: 3, nome: 'Foto Vazia', doc_identificacao: '333', tem_foto: false },
      { id: 2, nome: 'Sem Foto', doc_identificacao: '222', tem_foto: false },
    ]);
  });

  // Um mesmo visitante costuma ter vários cadastros (uma visita por entrada).
  // A lista mostra um por documento, preferindo o cadastro QUE TEM FOTO —
  // sem isso, o morador via o nome repetido e podia escolher justamente a
  // cópia sem foto, que não libera o facial.
  it('visitante repetido aparece uma vez, com a versão que tem foto', async () => {
    const { svc, prisma } = build();
    prisma.visitantes.findMany.mockResolvedValueOnce([
      { id: 10, nome: 'Maria', doc_identificacao: '999', foto_pessoa: null },
      { id: 11, nome: 'Maria', doc_identificacao: '999', foto_pessoa: 'https://s3/maria.jpg' },
    ]);
    jest.spyOn(svc as any, 'getMoradoresApto').mockResolvedValue([]);

    const res = await svc.listBeneficiariosVaga(1, 1);

    expect(res.visitantes).toEqual([
      { id: 11, nome: 'Maria', doc_identificacao: '999', tem_foto: true },
    ]);
  });

  it('falha no facial NÃO derruba a reserva (fire-and-forget com catch)', async () => {
    const { svc, facial } = build();
    facial.syncVisitante.mockRejectedValueOnce(new Error('device offline'));
    const inicio = new Date('2026-07-20T14:00:00').toISOString();
    const fim = new Date('2026-07-20T18:00:00').toISOString();

    // A reserva resolve normalmente mesmo com o device inacessível.
    await expect(
      svc.liberarVaga(1, 1, { tipo: 'visitante', id_visitante: 42, inicio, fim }),
    ).resolves.toEqual(expect.objectContaining({ id: 99, tipo_ocupacao: 'visitante' }));
  });
});
