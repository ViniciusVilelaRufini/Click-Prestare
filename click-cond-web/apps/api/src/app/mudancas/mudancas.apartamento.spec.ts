import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * Mudança libera elevador e portaria. O `id_apartamento` vinha do corpo e era
 * gravado como veio (apto do vizinho, ou de outro condomínio — a FK só aponta
 * para Apartamentos.id). E a listagem só recortava por unidade se o CLIENTE
 * mandasse `id_apto`: omitindo, o morador via as mudanças do prédio inteiro.
 */
describe('MudancasService — unidade da mudança e recorte do morador', () => {
  const morador: any = { sub: 5, nome: 'M', typeAccess: 'Morador', user: { id: 5 } };
  const sindico: any = { sub: 9, nome: 'S', typeAccess: 'Sindico', user: { id: 9 } };

  function build(mudanca: any = { id: 3, id_condominio: 1, id_apartamento: 1, user: 5 }) {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        // aptos 1 e 2 são do condomínio 1; o 50 é do condomínio 2.
        findUnique: jest.fn(async ({ where }: any) => (where.id === 50 ? { id_condominio: 2 } : { id_condominio: 1 })),
      },
      apartamentos_Users: {
        // o morador 5 mora só no apto 1.
        findFirst: jest.fn(async ({ where }: any) => (where.id_user === 5 && where.id_apto === 1 ? { id_apto: 1 } : null)),
        findMany: jest.fn(async ({ where }: any) => (where.id_user === 5 ? [{ id_apto: 1 }] : [])),
      },
      mudancas: {
        create: jest.fn(async ({ data }: any) => ({ id: 10, ...data })),
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => mudanca),
        update: jest.fn(async ({ data }: any) => ({ ...mudanca, ...data })),
      },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    return { service: new MudancasService(prisma, tenant), prisma };
  }

  const nova = (id_apartamento: number) => ({ data: '2026-11-01', hora_inicio: '08:00', id_apartamento, id_condominio: 1, user: 5 });

  it('create: NEGA morador agendar mudança no apto do vizinho', async () => {
    const { service, prisma } = build();
    await expect(service.create(nova(2), morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.create).not.toHaveBeenCalled();
  });

  it('create: NEGA apartamento de outro condomínio, mesmo para o síndico', async () => {
    const { service, prisma } = build();
    await expect(service.create(nova(50), sindico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.create).not.toHaveBeenCalled();
  });

  it('create: PERMITE morador no próprio apto e síndico em qualquer apto do condomínio', async () => {
    const { service, prisma } = build();
    await service.create(nova(1), morador);
    await service.create(nova(2), sindico);
    expect(prisma.mudancas.create).toHaveBeenCalledTimes(2);
  });

  it('update: NEGA o dono mover a própria mudança para o apto do vizinho', async () => {
    const { service, prisma } = build();
    await expect(service.update(3, { id_apartamento: 2 }, morador)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
  });

  it('findAll: morador sem id_apto vê só as do(s) próprio(s) apto(s) e as que criou', async () => {
    const { service, prisma } = build();
    await service.findAll(1, undefined, morador);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({
      id_condominio: 1,
      OR: [{ user: 5 }, { id_apartamento: { in: [1] } }],
    });
  });

  it('findAll: id_apto de outra unidade é ignorado para o morador', async () => {
    const { service, prisma } = build();
    await service.findAll(1, 2, morador);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({
      id_condominio: 1,
      OR: [{ user: 5 }, { id_apartamento: { in: [1] } }],
    });
  });

  it('findAll: síndico continua vendo tudo, ou o filtro que pediu', async () => {
    const { service, prisma } = build();
    await service.findAll(1, undefined, sindico);
    await service.findAll(1, 2, sindico);
    expect(prisma.mudancas.findMany.mock.calls[0][0].where).toEqual({ id_condominio: 1 });
    expect(prisma.mudancas.findMany.mock.calls[1][0].where).toEqual({ id_condominio: 1, id_apartamento: 2 });
  });

  it('findOne: NEGA morador ler mudança de outra unidade criada por outro', async () => {
    const { service } = build({ id: 4, id_condominio: 1, id_apartamento: 2, user: 77, apartamento: null });
    await expect(service.findOne(4, morador)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne: PERMITE morador ler a do próprio apto', async () => {
    const { service } = build({ id: 3, id_condominio: 1, id_apartamento: 1, user: 77, apartamento: null });
    await expect(service.findOne(3, morador)).resolves.toMatchObject({ id: 3 });
  });
});
