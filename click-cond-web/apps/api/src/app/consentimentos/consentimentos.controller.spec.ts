import { ConsentimentosController, ConsentimentosCondominioController } from './consentimentos.controller';

describe('ConsentimentosController & ConsentimentosCondominioController', () => {
  let controllerUser: ConsentimentosController;
  let controllerCond: ConsentimentosCondominioController;
  let serviceMock: any;
  let terceirosServiceMock: any;

  beforeEach(() => {
    serviceMock = {
      pendentes: jest.fn().mockResolvedValue({ precisaAceitar: false }),
      registrar: jest.fn().mockResolvedValue({ ok: true }),
      revogarBiometria: jest.fn().mockResolvedValue({ ok: true, removed: true }),
    };

    terceirosServiceMock = {
      registrar: jest.fn().mockResolvedValue({ ok: true }),
      consultar: jest.fn().mockResolvedValue({ declarado: true, biometria: true, maiorIdade: true }),
    };

    controllerUser = new ConsentimentosController(serviceMock);
    controllerCond = new ConsentimentosCondominioController(serviceMock, terceirosServiceMock);
  });

  it('permite registrar declaração de terceiro com operador', async () => {
    const user: any = { role: 'sindico', user: { id: 10, name: 'Síndico João' } };
    const body: any = {
      tipoPessoa: 'visitante',
      idPessoa: 5,
      doc: '12345678900',
      biometria: true,
      maiorIdade: true,
    };

    const res = await controllerCond.registrarTerceiro(1, body, user);
    expect(res).toEqual({ ok: true });
    expect(terceirosServiceMock.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        idCondominio: 1,
        tipoPessoa: 'visitante',
        idPessoa: 5,
        biometria: true,
        maiorIdade: true,
      }),
    );
  });

  it('permite consultar status de terceiro por operador', async () => {
    const user: any = { role: 'funcionario', user: { id: 2 } };
    const res = await controllerCond.statusTerceiro(1, 'visitante', '5', '12345678900', user);
    expect(res).toEqual({ declarado: true, biometria: true, maiorIdade: true });
    expect(terceirosServiceMock.consultar).toHaveBeenCalledWith({
      idCondominio: 1,
      tipoPessoa: 'visitante',
      idPessoa: 5,
      doc: '12345678900',
    });
  });
});
