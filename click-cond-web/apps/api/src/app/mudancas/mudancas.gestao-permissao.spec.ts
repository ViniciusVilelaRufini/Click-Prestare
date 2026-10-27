import { ForbiddenException } from '@nestjs/common';
import { MudancasService } from './mudancas.service';

/**
 * Editar ou apagar a mudança de OUTRO morador é gestão de mudanças: o app
 * mostra isso só para síndico ou para quem tem `agendar_mudanca`
 * (list_mudancas.dart), e o `updateStatus` já cobrava a flag. `update` e
 * `remove` exigiam só `assertStaff`.
 */
describe('MudancasService — update/remove de mudança alheia exige agendar_mudanca', () => {
  function build() {
    const tenant = {
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
      mudancas: {
        // A mudança é do morador 77, no condomínio 2.
        findUnique: jest.fn(async () => ({ id_condominio: 2, user: 77 })),
        update: jest.fn(async () => ({ id: 3 })),
        delete: jest.fn(async () => ({})),
      },
    };
    return { service: new MudancasService(prisma, tenant as any), prisma, tenant };
  }

  const semPermissao: any = { sub: 5, typeAccess: 'Funcionario', user: { id: 5 }, permissoes: { agendar_mudanca: 0 } };
  const comPermissao: any = { sub: 6, typeAccess: 'Funcionario', user: { id: 6 }, permissoes: { agendar_mudanca: 1 } };
  const sindico: any = { sub: 9, typeAccess: 'Sindico', user: { id: 9 } };

  it('NEGA funcionário sem a flag editar ou apagar mudança de outro morador', async () => {
    const { service, prisma } = build();
    await expect(service.update(3, { data: '2026-11-02' }, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(3, semPermissao)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mudancas.update).not.toHaveBeenCalled();
    expect(prisma.mudancas.delete).not.toHaveBeenCalled();
  });

  it('PERMITE funcionário com a flag e o síndico', async () => {
    const { service, prisma } = build();
    await service.update(3, { data: '2026-11-02' }, comPermissao);
    await service.remove(3, sindico);
    expect(prisma.mudancas.update).toHaveBeenCalled();
    expect(prisma.mudancas.delete).toHaveBeenCalled();
  });

  it('a própria mudança continua livre (não consulta a flag)', async () => {
    const { service, prisma, tenant } = build();
    const dono: any = { sub: 77, typeAccess: 'Funcionario', user: { id: 77 }, permissoes: { agendar_mudanca: 0 } };
    await service.remove(3, dono);
    expect(prisma.mudancas.delete).toHaveBeenCalled();
    expect(tenant.assertPermissaoFuncionario).not.toHaveBeenCalled();
  });
});
