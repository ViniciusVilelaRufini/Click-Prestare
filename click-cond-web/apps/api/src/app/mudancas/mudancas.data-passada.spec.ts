import { BadRequestException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * A lista do síndico mostrava ACEITAR para uma mudança pendente de um dia que
 * já passou. O servidor agora recusa a aprovação (recusar segue permitido).
 */
describe('MudancasService.updateStatus — data passada', () => {
  function build(data: Date | null) {
    const tenant = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const prisma: any = {
      isConnected: true,
      mudancas: {
        findUnique: jest.fn(async () => ({ id: 3, id_condominio: 2, data })),
        update: jest.fn(async () => ({ id: 3 })),
      },
    };
    return { service: new MudancasService(prisma, tenant as any), prisma };
  }
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };
  const ontem = () => new Date(Date.now() - 36 * 3600 * 1000);
  const amanha = () => new Date(Date.now() + 36 * 3600 * 1000);

  it('NEGA aprovar com data passada e não grava', async () => {
    const { service, prisma } = build(ontem());
    await expect(service.updateStatus(3, true, '', sindico)).rejects.toThrow(
      new BadRequestException('Não é possível aprovar uma mudança com data passada.'),
    );
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
  });

  it('permite recusar com data passada', async () => {
    const { service, prisma } = build(ontem());
    await service.updateStatus(3, false, 'passou', sindico);
    expect(prisma.mudancas.update).toHaveBeenCalled();
  });

  it('permite aprovar data futura ou sem data', async () => {
    for (const d of [amanha(), null]) {
      const { service, prisma } = build(d);
      await service.updateStatus(3, true, '', sindico);
      expect(prisma.mudancas.update).toHaveBeenCalled();
    }
  });
});
