import { VisitantesGlobalController } from './visitantes.controller';

/**
 * GET /visitantes/get-all (lista do app) filtra pelos apartamentos vinculados
 * a `payload.sub`. No token da portaria-web `sub` é Funcionarios_Portaria.id:
 * o porteiro recebia as visitas (e os PINs ativos) do morador cujo Users.id
 * coincide com o dele.
 */
describe('GET /visitantes/get-all — token da portaria', () => {
  it('não usa o sub do porteiro como Users.id', async () => {
    const service: any = { findAllMobile: jest.fn(async () => []) };
    const ctrl = new VisitantesGlobalController(service);
    await ctrl.getAll('1', undefined, undefined, undefined, { sub: 7, nome: 'QA porteiro', id_condominio: 1 } as any);
    expect(service.findAllMobile.mock.calls[0][4]).toBeUndefined();
  });

  it('morador continua listando pelo próprio Users.id', async () => {
    const service: any = { findAllMobile: jest.fn(async () => []) };
    const ctrl = new VisitantesGlobalController(service);
    await ctrl.getAll('1', undefined, undefined, undefined, { sub: 50, nome: 'QA morador', typeAccess: 'Morador' } as any);
    expect(service.findAllMobile.mock.calls[0][4]).toBe(50);
  });
});
