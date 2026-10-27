import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Token de app e de CRM não carrega id_condominio, e o interceptor caía no
 * `body.id_condominio`: qualquer usuário escrevia no log de auditoria do
 * condomínio que escolhesse (POST /users/remove-fcm-token com
 * {"id_condominio": B, "nome": "..."}).
 */
describe('AuditInterceptor — condomínio do registro', () => {
  function build() {
    const prisma: any = { isConnected: true, auditLog: { create: jest.fn(async () => ({})) } };
    const reflector: any = { getAllAndOverride: () => false };
    const tenant: any = {
      // O morador 1 só tem vínculo com o condomínio 1.
      assertCondominio: jest.fn(async (id: number) => {
        if (id !== 1) throw new ForbiddenException('Acesso negado');
      }),
    };
    return { interceptor: new AuditInterceptor(prisma, reflector, tenant), prisma, tenant };
  }

  async function rodar(interceptor: AuditInterceptor, req: any) {
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/users/remove-fcm-token', params: {}, ip: '10.0.0.1', ...req }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ ok: true }) }));
    // o `tap` grava de forma assíncrona
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  }

  const morador = { sub: 1, nome: 'Morador', typeAccess: 'Morador', user: { id: 1, nome: 'Morador' } };

  it('NÃO grava no condomínio do corpo quando o usuário não tem vínculo com ele', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: morador, body: { id_condominio: 999, nome: 'texto injetado' } });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('token de CRM (sem Users.id) não escolhe o condomínio pelo corpo', async () => {
    const { interceptor, prisma, tenant } = build();
    await rodar(interceptor, { user: { sub: 1, nome: 'CRM', role: 'crm_admin' }, body: { id_condominio: 1 } });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(tenant.assertCondominio).not.toHaveBeenCalled();
  });

  it('grava no condomínio do corpo quando o vínculo do app confere', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: morador, body: { id_condominio: 1, nome: 'ok' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_condominio: 1 }) });
  });

  it('console: usa o condomínio do token e ignora o do corpo', async () => {
    const { interceptor, prisma } = build();
    await rodar(interceptor, { user: { sub: 3, nome: 'Porteiro', id_condominio: 7 }, body: { id_condominio: 999 } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_condominio: 7 }) });
  });
});
