import { MobileAuthService } from './mobile-auth.service';

/**
 * "Meus eventos" do app passou a mostrar a foto da pessoa, como as linhas de
 * eventos do console web. A foto só vai quando é um link: registros antigos
 * guardam a imagem inteira em base64, e mandar isso em cada evento do feed
 * deixaria a resposta pesada.
 */
describe('MobileAuthService.getMeusEventos — foto da pessoa', () => {
  const ID_USER = 20;
  const ID_APTO = 10;
  const agora = () => new Date();
  const flagOriginal = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (flagOriginal === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flagOriginal;
  });

  function svcCom(prisma: any) {
    return new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  }

  function legado(foto: string | null) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    return svcCom({
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: ID_APTO }]) },
      visitantes: {
        findMany: jest.fn(async () => [{
          id: 5, nome: 'Rafael Costa', id_condominio: 1, is_prestador: 0,
          data_entrada: agora(), data_saida: null, foto_pessoa: foto,
        }]),
      },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Boa Vista' }]) },
    });
  }

  it('manda o link da foto do visitante', async () => {
    const eventos = await legado('https://cdn.exemplo/f.jpg').getMeusEventos(ID_USER, 15);
    expect(eventos[0].foto).toBe('https://cdn.exemplo/f.jpg');
  });

  it('não manda foto em base64 nem vazia', async () => {
    expect((await legado('data:image/jpeg;base64,AAAA').getMeusEventos(ID_USER, 15))[0].foto).toBeNull();
    expect((await legado(null).getMeusEventos(ID_USER, 15))[0].foto).toBeNull();
  });

  it('usa a foto do morador (ou a do usuário) nos eventos "você"', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const svc = svcCom({
      isConnected: true,
      moradores: {
        findMany: jest.fn(async () => [
          { id: 7, foto_pessoa: null, user: { photo: 'https://cdn.exemplo/eu.jpg' } },
        ]),
      },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []) },
      acessos_Facial: {
        findMany: jest.fn(async (args: any) => args?.where?.tipo_pessoa === 'morador'
          ? [{
              id: 1, id_pessoa: 7, id_condominio: 1, nome_pessoa: 'Vinicius', evento: 'entrada',
              tipo_pessoa: 'morador', tipo_dispositivo: 'facial', confianca: 0.9, timestamp: agora(),
            }]
          : []),
      },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Boa Vista' }]) },
    });
    const eventos = await svc.getMeusEventos(ID_USER, 15);
    expect(eventos[0]).toEqual(expect.objectContaining({ categoria: 'voce', foto: 'https://cdn.exemplo/eu.jpg' }));
  });

  it('caminho migrado: acha a foto da Pessoa pelo id que o facial gravou', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const svc = svcCom({
      isConnected: true,
      moradores: { findMany: jest.fn(async () => []) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: ID_APTO }]) },
      visitas: {
        findMany: jest.fn(async () => [{
          // created_at é NOT NULL no schema: sem ele a visita não tem janela (o evento não é dela).
          id: 5, id_pessoa: 50, id_condominio: 1, is_prestador: 0, data_entrada: null, data_saida: null, created_at: agora(),
          pessoa: { nome: 'Rafael Costa', tipo_pessoa: 'visitante', foto_pessoa: 'https://cdn.exemplo/r.jpg' },
        }]),
      },
      acessos_Facial: {
        findMany: jest.fn(async (args: any) => args?.where?.tipo_pessoa === 'morador'
          ? []
          : [{
              id: 2, id_pessoa: 50, id_condominio: 1, nome_pessoa: 'Rafael Costa', evento: 'saida',
              tipo_pessoa: 'visitante', tipo_dispositivo: 'facial', confianca: 0.9, timestamp: agora(),
            }]),
      },
      condominios: { findMany: jest.fn(async () => [{ id: 1, nome: 'Boa Vista' }]) },
    });
    const eventos = await svc.getMeusEventos(ID_USER, 15, 'Sindico');
    expect(eventos[0].foto).toBe('https://cdn.exemplo/r.jpg');
  });
});
