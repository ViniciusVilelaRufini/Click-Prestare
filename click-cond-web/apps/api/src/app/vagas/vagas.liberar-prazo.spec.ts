import { BadRequestException } from '@nestjs/common';
import { VagasService } from './vagas.service';

/**
 * "Liberar vaga" pelo console criava vaga de visitante com `fim = NULL`, que
 * `whereVagaVigente` trata como vigente para sempre: ocupava a cota do
 * apartamento até alguém revogar e dava usos ilimitados no terminal. Vaga de
 * visitante agora exige um prazo no futuro; a de inquilino segue sem prazo.
 */
const AGORA = new Date('2026-11-13T15:00:00.000Z');
const APTO = { id: 10, id_condominio: 1, qtd_vagas: 2 };
const MORADORES = [{ id: 5, nome: 'Titular', tipo: 'Inquilino' }];

function build() {
  const prisma: any = {
    isConnected: true,
    vagas: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
    },
    veiculos: { count: jest.fn(async () => 0) },
    visitas: {
      findFirst: jest.fn(async () => ({ id: 60, id_pessoa: 6, id_apartamento: 10, codigo_acesso: '123456' })),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    visitantes: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  };
  const facial = { syncVisitante: jest.fn(async () => ({})) };
  const svc = new VagasService(prisma, facial as any);
  jest.spyOn(svc as any, 'resolveApartamento').mockResolvedValue(APTO);
  jest.spyOn(svc as any, 'moradoresDoApto').mockResolvedValue(MORADORES);
  return { svc, prisma };
}

describe('VagasService.liberar — vaga de visitante exige prazo', () => {
  const flag = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeAll(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    jest.useFakeTimers({ advanceTimers: true }).setSystemTime(AGORA);
  });
  afterAll(() => {
    jest.useRealTimers();
    if (flag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
  });

  const base = { id_morador_titular: 5, tipo: 'visitante', id_visitante: 6 };

  it('sem fim: recusa e não grava nada', async () => {
    const { svc, prisma } = build();
    await expect(svc.liberar(1, 10, base)).rejects.toThrow(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
    expect(prisma.visitas.update).not.toHaveBeenCalled();
  });

  it('fim no passado: recusa e não grava nada', async () => {
    const { svc, prisma } = build();
    await expect(svc.liberar(1, 10, { ...base, fim: '2026-11-13T14:00:00.000Z' })).rejects.toThrow(
      /prazo/i,
    );
    expect(prisma.vagas.create).not.toHaveBeenCalled();
    expect(prisma.visitas.update).not.toHaveBeenCalled();
  });

  it('fim inválido: recusa', async () => {
    const { svc, prisma } = build();
    await expect(svc.liberar(1, 10, { ...base, fim: 'amanhã' })).rejects.toThrow(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('fim antes do início: recusa', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.liberar(1, 10, { ...base, inicio: '2026-11-14T18:00:00.000Z', fim: '2026-11-14T10:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.vagas.create).not.toHaveBeenCalled();
  });

  it('fim no futuro: grava a vaga com o prazo', async () => {
    const { svc, prisma } = build();
    await svc.liberar(1, 10, { ...base, fim: '2026-11-13T20:00:00.000Z' });
    expect(prisma.vagas.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fim: new Date('2026-11-13T20:00:00.000Z') }) }),
    );
  });

  it('inquilino continua sem prazo', async () => {
    const { svc, prisma } = build();
    await svc.liberar(1, 10, { id_morador_titular: 5, tipo: 'inquilino', id_morador_beneficiario: 5 });
    expect(prisma.vagas.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fim: null }) }),
    );
  });
});

describe('VagasService.beneficiarios — término da visita para sugerir o prazo', () => {
  const flag = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterAll(() => {
    if (flag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
  });

  it('Pessoas/Visitas: devolve o término da visita mais recente de cada pessoa', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const recente = new Date('2026-11-13T21:00:00.000Z');
    prisma.visitas.findMany.mockResolvedValueOnce([
      { data_hora_termino: recente, pessoa: { id: 6, nome: 'Ana', doc_identificacao: null, foto_pessoa: null } },
      { data_hora_termino: new Date('2026-10-01T21:00:00.000Z'), pessoa: { id: 6, nome: 'Ana', doc_identificacao: null, foto_pessoa: null } },
    ]);
    const r = await svc.beneficiarios(1, 10);
    expect(r.visitantes).toEqual([expect.objectContaining({ id: 6, termino: recente })]);
  });

  it('legado: devolve o término do registro de Visitantes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const fim = new Date('2026-11-13T22:00:00.000Z');
    prisma.visitantes.findMany.mockResolvedValueOnce([
      { id: 42, nome: 'Bia', doc_identificacao: null, foto_pessoa: null, created_at: AGORA, data_hora_termino: fim },
    ]);
    const r = await svc.beneficiarios(1, 10);
    expect(r.visitantes).toEqual([expect.objectContaining({ id: 42, termino: fim })]);
  });
});
