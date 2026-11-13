import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * CreateMoradorDto é interface, não DTO validado: um objeto/array no e-mail chegava ao
 * `.toLowerCase()` e virava erro 500. Mesma guarda do update: 400 antes de qualquer consulta.
 */
describe('MoradoresService.create — e-mail que não é texto', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn() },
      moradores: { findFirst: jest.fn(), create: jest.fn() },
      users: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it.each([[{ contains: '@' }], [['a@x.com']], [123]])('e-mail %j → 400 sem consultar o banco', async (email) => {
    const { svc, prisma } = build();
    const dto: any = { nome: 'N', email, id_apartamento: 5, id_condominio: 1 };
    await expect(svc.create(dto)).rejects.toThrow(new BadRequestException('E-mail inválido.'));
    expect(prisma.apartamentos.findUnique).not.toHaveBeenCalled();
    expect(prisma.moradores.findFirst).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });
});
