import { ForbiddenException } from '@nestjs/common';
import { CrmAdminGuard } from './crm-admin.guard';

/**
 * O guard do painel que ativa condomínio na Superlógica e liga a escrita no
 * ERP. Token do CRM vale 365 dias e carrega a role dentro dele — sem conferir
 * o banco, desativar um admin não tirava o acesso.
 */
describe('CrmAdminGuard', () => {
  function contexto(user: any) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  function montar(admin: any, isConnected = true) {
    const findFirst = jest.fn(async () => admin);
    const prisma: any = { isConnected, crm_Admins: { findFirst } };
    return { guard: new CrmAdminGuard(prisma), findFirst };
  }

  it('aceita admin do CRM que continua ativo', async () => {
    const { guard, findFirst } = montar({ id: 3 });

    await expect(guard.canActivate(contexto({ sub: 3, role: 'crm_admin' }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 3, ativo: 1 }, select: { id: true } });
  });

  it('RECUSA admin desativado mesmo com token válido', async () => {
    // O ponto do guard: o token dele segue válido por até um ano.
    const { guard } = montar(null);

    await expect(
      guard.canActivate(contexto({ sub: 3, role: 'crm_admin' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa token sem a role de CRM antes de consultar o banco', async () => {
    // Token de porteiro/síndico não pode nem custar uma consulta.
    const { guard, findFirst } = montar({ id: 3 });

    await expect(
      guard.canActivate(contexto({ sub: 3, typeAccess: 'Sindico' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('recusa quando o sub do token não é um id utilizável', async () => {
    const { guard, findFirst } = montar({ id: 3 });

    await expect(
      guard.canActivate(contexto({ sub: 'admin', role: 'crm_admin' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('não bloqueia o dev local sem banco', async () => {
    // Sem banco o projeto roda em modo mock; não há admin real para desativar.
    const { guard, findFirst } = montar(null, false);

    await expect(guard.canActivate(contexto({ sub: 3, role: 'crm_admin' }))).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
