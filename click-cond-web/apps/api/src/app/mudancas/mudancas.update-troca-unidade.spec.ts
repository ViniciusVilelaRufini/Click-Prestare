import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * O create cobra `agendar_mudanca` do funcionário do app que agenda para uma unidade que não é
 * dele. O update tinha o atalho do dono: o funcionário sem a flag criava a mudança para a própria
 * unidade e depois trocava `id_apartamento` para a de outra pessoa sem passar pela flag.
 */
describe('MudancasService.update — dono que troca a unidade', () => {
  function build() {
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async (_id: number, flag: string, payload: any) => {
        if (payload?.typeAccess?.toLowerCase() !== 'funcionario') return;
        if (payload.permissoes?.[flag] !== 1) {
          throw new ForbiddenException('Acesso negado: seu perfil não tem permissão para esta área.');
        }
      }),
    };
    const prisma: any = {
      isConnected: true,
      // Mudança do usuário 5, na unidade 11 (onde ele mora), condomínio 2.
      mudancas: {
        findUnique: jest.fn(async () => ({
          id_condominio: 2, user: 5, status: 'pendente', data: null, hora_inicio: null, id_apartamento: 11,
        })),
        update: jest.fn(async ({ data }: any) => ({ id: 3, ...data })),
      },
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 2 })) },
      apartamentos_Users: {
        // o usuário 5 mora nos aptos 11 e 12; o 10 é de outra pessoa.
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 5 && [11, 12].includes(where.id_apto) ? { id_apto: where.id_apto } : null,
        ),
      },
    };
    return { service: new MudancasService(prisma, tenant), prisma, tenant };
  }

  const semFlag: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 0 } };
  const comFlag: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 1 } };

  it('NEGA funcionário sem a flag mover a própria mudança para unidade que não é dele', async () => {
    const { service, prisma, tenant } = build();
    await expect(service.update(3, { id_apartamento: 10 }, semFlag)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenant.assertPermissaoFuncionario).toHaveBeenCalledWith(2, 'agendar_mudanca', semFlag);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
  });

  it('PERMITE com a flag', async () => {
    const { service, prisma } = build();
    await service.update(3, { id_apartamento: 10 }, comFlag);
    expect(prisma.mudancas.update).toHaveBeenCalled();
  });

  it('PERMITE sem a flag mover para outra unidade em que ele também mora', async () => {
    const { service, prisma, tenant } = build();
    await service.update(3, { id_apartamento: 12 }, semFlag);
    expect(prisma.mudancas.update).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });

  it('PERMITE sem a flag remarcar a data mantendo a unidade', async () => {
    const { service, prisma, tenant } = build();
    await service.update(3, { data: '2026-12-01', id_apartamento: 11 }, semFlag);
    expect(prisma.mudancas.update).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });
});
