import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';
import { MudancasController } from './mudancas.controller';

/**
 * No token do porteiro do console o `sub` é Funcionarios_Portaria.id. Lido como Users.id
 * (`user?.id ?? sub`), o porteiro 77 virava "dono" da mudança do morador 77 e a criação
 * gravava a mudança em nome do Users.id 77. O id sai de idUsuarioDoToken.
 */
describe('Mudanças — token de porteiro do console não é lido como Users.id', () => {
  const porteiro: any = { sub: 77, nome: 'Portaria', id_condominio: 2, turno: 'Manha', tipo_sub: 'funcionario_portaria' };

  function build(dono: number | null) {
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const prisma: any = {
      isConnected: true,
      mudancas: {
        findUnique: jest.fn(async () => ({ id_condominio: 2, user: dono, status: 'pendente', data: null, hora_inicio: null, id_apartamento: 10 })),
        update: jest.fn(async () => ({ id: 3 })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { service: new MudancasService(prisma, tenant), prisma };
  }

  it.each([[77], [null]])('update/remove da mudança do usuário %s: porteiro não é o dono e cai no assertStaff', async (dono) => {
    const { service, prisma } = build(dono);
    await expect(service.update(3, { data: '2026-11-20' }, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(3, porteiro)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
    expect(prisma.mudancas.delete).not.toHaveBeenCalled();
  });

  it('o dono pelo token do app continua editando e removendo a própria', async () => {
    const { service, prisma } = build(77);
    const morador: any = { sub: 77, typeAccess: 'Morador', user: { id: 77 } };
    await service.update(3, { data: '2026-11-20' }, morador);
    await service.remove(3, morador);
    expect(prisma.mudancas.update).toHaveBeenCalled();
    expect(prisma.mudancas.delete).toHaveBeenCalled();
  });

  it('insert: com token de porteiro a mudança não é gravada em nome de Users.id', async () => {
    const service: any = { create: jest.fn(async () => ({})) };
    const ctrl = new MudancasController(service);
    await ctrl.insert({ id_condominio: 2, mudanca: { data: '2026-11-20', hora_inicio: '08:00', id_apartamento: 10 } }, porteiro);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ user: null }), porteiro);
  });

  it('insert: com token do app grava o Users.id', async () => {
    const service: any = { create: jest.fn(async () => ({})) };
    const ctrl = new MudancasController(service);
    const morador: any = { sub: 40, typeAccess: 'Morador', user: { id: 40 } };
    await ctrl.insert({ id_condominio: 2, mudanca: { data: '2026-11-20', hora_inicio: '08:00', id_apartamento: 10 } }, morador);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ user: 40 }), morador);
  });
});
