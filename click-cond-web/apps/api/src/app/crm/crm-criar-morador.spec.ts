import { CrmController } from './crm.controller';

/**
 * "Criar morador" do CRM é chamador confiável (CrmAdminGuard, sem vínculo com o condomínio): a recusa de ligar
 * conta que já existe em outro condomínio não vale para ele — o resto das regras do MoradoresService.create vale.
 */
describe('CrmController.criarMorador', () => {
  it('chama MoradoresService.create com permitirContaDeOutroCondominio', async () => {
    const moradores: any = { create: jest.fn(async () => ({ id: 1 })) };
    const ctrl = new CrmController({} as any, {} as any, {} as any, moradores, {} as any, {} as any);
    const admin: any = { sub: 1, nome: 'Suporte', typeAccess: 'CrmAdmin' };

    await ctrl.criarMorador(7, { nome: 'Fulano', email: 'f@x.com' }, admin);

    expect(moradores.create).toHaveBeenCalledWith(
      { nome: 'Fulano', email: 'f@x.com', id_condominio: 7 },
      admin,
      { permitirContaDeOutroCondominio: true },
    );
  });
});
