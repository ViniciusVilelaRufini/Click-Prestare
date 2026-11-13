import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * Cadastro legado (Moradores.id_user nulo): o sendCredentials acha a conta pelo e-mail. Se ela é
 * de outro condomínio, a recusa saía — mas DEPOIS de gravar o vínculo Moradores.id_user com ela.
 * A recusa não pode deixar o cadastro ligado à conta de outra pessoa.
 */
describe('MoradoresService.sendCredentials — legado com conta de outro condomínio', () => {
  function build(contaEmOutroCondominio: boolean) {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 20, nome: 'Legado', email: 'pessoa@x.com', telefone: null, documento: null,
          id_condominio: 1, id_user: null, foto_pessoa: null, foto_documento: null, user: null,
        })),
        update: jest.fn(async () => ({})),
        count: jest.fn(async ({ where }: any) => (contaEmOutroCondominio && where.id_condominio?.not === 1 ? 1 : 0)),
      },
      users: {
        findFirst: jest.fn(async () => ({ id: 77, email: 'pessoa@x.com', login: 'pessoa@x.com' })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})) };
    const svc = new MoradoresService(
      prisma, mail, {} as any, {} as any, { registrar: jest.fn(async () => ({})) } as any, {} as any,
    );
    return { svc, prisma, mail };
  }

  it('recusa sem gravar o vínculo nem a senha', async () => {
    const { svc, prisma, mail } = build(true);
    await expect(svc.sendCredentials(20)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.moradores.update).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('conta só deste condomínio: grava o vínculo e a senha (fluxo de sempre)', async () => {
    const { svc, prisma } = build(false);
    await expect(svc.sendCredentials(20)).resolves.toEqual({ ok: true });
    expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 20 }, data: { id_user: 77 } });
    expect(prisma.users.update).toHaveBeenCalled();
  });
});
