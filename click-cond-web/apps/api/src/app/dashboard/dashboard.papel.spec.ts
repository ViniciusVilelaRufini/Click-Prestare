import { ForbiddenException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

/**
 * GET /condominios/:id/dashboard (portaria-web) devolve visitantes recentes
 * com nome, documento e fotos, ocorrências, acessos do facial e o log de
 * auditoria. O TenantGuard só confere o vínculo com o condomínio — morador
 * tem vínculo —, então qualquer morador lia tudo isso. O app usa
 * /dashboard/summary e /dashboard/meus-eventos, já recortados por usuário.
 */
describe('Dashboard do console — exige operador', () => {
  it('morador é recusado', () => {
    const service: any = { summary: jest.fn(async () => ({})) };
    const ctrl = new DashboardController(service);
    expect(() => ctrl.get(1, { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any)).toThrow(ForbiddenException);
    expect(service.summary).not.toHaveBeenCalled();
  });

  it('porteiro continua vendo o painel', async () => {
    const service: any = { summary: jest.fn(async () => ({})) };
    const ctrl = new DashboardController(service);
    await ctrl.get(1, { sub: 3, nome: 'QA porteiro', id_condominio: 1 } as any);
    expect(service.summary).toHaveBeenCalledWith(1);
  });
});
