import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * update/remove/updateStatus de mudança alheia já cobravam `agendar_mudanca`; a CRIAÇÃO não:
 * funcionário do app com a flag desligada pelo síndico abria mudança pendente para qualquer
 * unidade do condomínio — e, como o controller grava o chamador como dono, depois editava/apagava
 * pelo atalho do dono sem a flag.
 */
describe('MudancasService.create — funcionário do app precisa de agendar_mudanca', () => {
  function build() {
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
      apartamentos_Users: {
        // o usuário 5 mora no apto 11; o apto 10 é de outra pessoa.
        findFirst: jest.fn(async ({ where }: any) => (where.id_user === 5 && where.id_apto === 11 ? { id_apto: 11 } : null)),
      },
      mudancas: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })) },
    };
    return { service: new MudancasService(prisma, tenant), prisma, tenant };
  }

  const nova = (id_apartamento: number) => ({ data: null, hora_inicio: null, id_apartamento, id_condominio: 2, user: 5 });
  const semFlag: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 0 } };
  const comFlag: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 1 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  it('NEGA funcionário sem a flag criar mudança para apartamento que não é dele', async () => {
    const { service, prisma, tenant } = build();
    await expect(service.create(nova(10), semFlag)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'agendar_mudanca', semFlag);
    expect(prisma.mudancas.create).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag', async () => {
    const { service, prisma } = build();
    await service.create(nova(10), comFlag);
    expect(prisma.mudancas.create).toHaveBeenCalled();
  });

  it('PERMITE funcionário sem a flag agendar a mudança do PRÓPRIO apartamento', async () => {
    const { service, prisma, tenant } = build();
    await service.create(nova(11), semFlag);
    expect(prisma.mudancas.create).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });

  it('síndico não depende de flag nem de vínculo', async () => {
    const { service, prisma } = build();
    await service.create(nova(10), sindico);
    expect(prisma.mudancas.create).toHaveBeenCalled();
  });
});
