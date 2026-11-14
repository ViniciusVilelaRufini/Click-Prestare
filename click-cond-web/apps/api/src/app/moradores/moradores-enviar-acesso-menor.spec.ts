import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * Revisão da rodada 3: "Enviar Acesso" gravava senha e criava conta sem conferir a idade. Quando o
 * cadastro TEM data de nascimento e ela é de menor de 18, a credencial de app não sai (Cláusula 8.3):
 * o acesso do menor é pelo responsável. Sem data, segue como antes (decisão do dono pendente).
 */
describe('MoradoresService.sendCredentials — menor de 18 com data no cadastro', () => {
  function harness(dataNascimento: Date | null) {
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn().mockResolvedValue({ email: 'a@x.com', login: 'a@x.com' }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      moradores: { update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      sindicos_Condominios: { count: jest.fn().mockResolvedValue(0) },
      funcionarios: { count: jest.fn().mockResolvedValue(0) },
      apartamentos_Users: { count: jest.fn().mockResolvedValue(0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn().mockResolvedValue({}), sendWelcomeMoradorExisting: jest.fn() };
    const service = new MoradoresService(
      prisma,
      mail,
      {} as any,
      {} as any,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 5, nome: 'Bia', email: 'a@x.com', id_user: 50, id_condominio: 1, data_nascimento: dataNascimento,
    } as any);
    jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
    return { service, prisma, mail };
  }

  it('menor de 18 pela data do cadastro: recusa com 400 e não grava senha nem envia e-mail', async () => {
    const dez = new Date();
    dez.setFullYear(dez.getFullYear() - 10);
    const { service, prisma, mail } = harness(dez);

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toContain('menor de 18');
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('adulto pela data: envia como antes', async () => {
    const { service, prisma } = harness(new Date('1980-04-19'));
    await expect(service.sendCredentials(5)).resolves.toEqual({ ok: true });
    expect(prisma.users.update).toHaveBeenCalled();
  });

  it('sem data de nascimento: envia como antes (bloquear é decisão do dono)', async () => {
    const { service, prisma } = harness(null);
    await expect(service.sendCredentials(5)).resolves.toEqual({ ok: true });
    expect(prisma.users.update).toHaveBeenCalled();
  });
});
