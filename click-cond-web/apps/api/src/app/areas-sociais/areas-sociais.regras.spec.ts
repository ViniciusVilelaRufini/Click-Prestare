import { AreasSociaisService } from './areas-sociais.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Cobre a Task 3: o texto de regras da área precisa ser gravado por
 * insert/update e devolvido por get/get-all — sem isso o app não tem o que
 * mostrar antes do checkbox de aceite.
 */
describe('AreasSociaisService — regras da área', () => {
  const sindico: JwtPayload = { sub: 1, nome: 'Síndico', id_condominio: 2, typeAccess: 'Sindico' };

  function build(opts: { area?: any } = {}) {
    const area = opts.area ?? {
      id: 30,
      id_condominio: 2,
      precisa_autorizacao: 0,
      imagem: '',
      capacidade: 10,
      precisa_agendar: 1,
      precisa_pagamento: 0,
      horarios: JSON.stringify([]),
      regras: null,
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        create: jest.fn(async () => ({ ...area, id: 30 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async ({ where }: any) => (where.id === area.id ? { ...area } : null)),
        findMany: jest.fn(async () => [area]),
      },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
      areas_Sociais_Manutencoes: { findMany: jest.fn(async () => []) },
      facial_Devices: { count: jest.fn(async () => 0) },
      $queryRaw: jest.fn(async () => []),
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = { syncReservaArea: jest.fn().mockResolvedValue({}) };
    const tenant = new TenantAccessService(prisma);
    const svc = new AreasSociaisService(prisma, notifications, storage, facial, tenant);
    return { svc, prisma };
  }

  it('insert grava regras quando o síndico informa o texto', async () => {
    const { svc, prisma } = build();
    await svc.insert(2, { nome: 'Salão', regras: 'Proibido som após 22h.' }, sindico);
    const dataArg = prisma.areas_Sociais.create.mock.calls[0][0].data;
    expect(dataArg.regras).toBe('Proibido som após 22h.');
  });

  it('insert grava regras NULL quando o campo vem vazio ou ausente', async () => {
    const { svc, prisma } = build();
    await svc.insert(2, { nome: 'Salão' }, sindico);
    const dataArg = prisma.areas_Sociais.create.mock.calls[0][0].data;
    expect(dataArg.regras).toBeNull();
  });

  it('update grava o novo texto de regras', async () => {
    const { svc, prisma } = build();
    await svc.update(2, { id: 30, nome: 'Salão', regras: 'Nova regra.' }, sindico);
    const dataArg = prisma.areas_Sociais.updateMany.mock.calls[0][0].data;
    expect(dataArg.regras).toBe('Nova regra.');
  });

  it('update limpa as regras quando o texto é apagado (string vazia)', async () => {
    const { svc, prisma } = build();
    await svc.update(2, { id: 30, nome: 'Salão', regras: '' }, sindico);
    const dataArg = prisma.areas_Sociais.updateMany.mock.calls[0][0].data;
    expect(dataArg.regras).toBeNull();
  });

  it('get devolve as regras cadastradas na área', async () => {
    const { svc } = build({
      area: {
        id: 30, id_condominio: 2, precisa_autorizacao: 0, imagem: '', capacidade: 10,
        precisa_agendar: 1, precisa_pagamento: 0, horarios: JSON.stringify([]),
        regras: 'Não jogar lixo no chão.',
      },
    });
    const resultado = await svc.get(2, 30, sindico);
    expect(resultado.regras).toBe('Não jogar lixo no chão.');
  });

  it('get devolve null quando a área não tem regras (comportamento pré-existente)', async () => {
    const { svc } = build();
    const resultado = await svc.get(2, 30, sindico);
    expect(resultado.regras).toBeNull();
  });

  it('get-all devolve as regras de cada área da lista', async () => {
    const { svc } = build({
      area: {
        id: 30, id_condominio: 2, precisa_autorizacao: 0, imagem: '', capacidade: 10,
        precisa_agendar: 1, precisa_pagamento: 0, horarios: JSON.stringify([]),
        regras: 'Silêncio após 22h.',
        _count: { devices: 0 },
      },
    });
    const [resultado] = await svc.getAll(2, sindico);
    expect(resultado.regras).toBe('Silêncio após 22h.');
  });
});
