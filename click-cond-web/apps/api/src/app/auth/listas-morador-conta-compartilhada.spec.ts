import { MobileAuthService } from './mobile-auth.service';
import { MoradoresService } from '../moradores/moradores.service';

/**
 * As listas de morador completavam o cadastro do condomínio com Users (global): e-mail, telefone,
 * CPF e foto de uma conta que também é de outro condomínio apareciam aqui. Conta só deste
 * condomínio continua com o fallback.
 */
describe('Listas de morador — conta com vínculo em outro condomínio', () => {
  const COMPARTILHADA = 70;
  const LOCAL = 71;
  const conta = (id: number) => ({ id, name: `Conta ${id}`, email: `c${id}@x.com`, phone: `17999990${id}`, cpf: `0000000${id}`, photo: `https://s3/u${id}.jpg` });
  const cadastro = (id: number, id_user: number) => ({
    id, id_user, id_condominio: 1, nome: `Cadastro ${id}`, email: null, telefone: null, documento: null,
    foto_pessoa: null, foto_documento: null, bloco: 'A', apartamento: '101', data_nascimento: null, tipo: 'proprietario',
    extra1: null, extra2: null, extra3: null, extra4: null, face_id: null, face_sync_status: null, face_sync_error: null,
  });
  const ehFora = (where: any) =>
    where?.id_condominio?.not !== undefined || where?.apartamento?.id_condominio?.not !== undefined;
  const vinculosFora = (where: any) => ((where.id_user?.in ?? []).includes(COMPARTILHADA) ? [{ id_user: COMPARTILHADA }] : []);
  const base = (extra: any): any => ({
    isConnected: true,
    sindicos_Condominios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    funcionarios: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    ...extra,
  });
  const rels = () => [
    { id_user: COMPARTILHADA, tipo: 'proprietario', apartamento: { id_condominio: 1, bloco: 'A', apto: '101' }, user: { ...conta(COMPARTILHADA), moradores: [cadastro(500, COMPARTILHADA)] } },
    { id_user: LOCAL, tipo: 'proprietario', apartamento: { id_condominio: 1, bloco: 'A', apto: '101' }, user: { ...conta(LOCAL), moradores: [cadastro(501, LOCAL)] } },
  ];
  const sindico = { sub: 1, typeAccess: 'Sindico' } as any;

  it('app getMoradoresApto: a conta compartilhada sai só com os dados do cadastro daqui', async () => {
    const prisma = base({
      apartamentos: { findUnique: jest.fn(async () => ({ id_condominio: 1 })) },
      apartamentos_Users: { findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? [] : rels())) },
      moradores: { findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? vinculosFora(where) : [])) },
    });
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, { assertEntidade: jest.fn(async () => undefined) } as any);
    jest.spyOn(svc as any, 'assertAptoDoMorador').mockResolvedValue(undefined);
    const lista = await svc.getMoradoresApto(11, undefined, sindico);
    expect(lista.find((m: any) => m.id === 500)).toMatchObject({ email: '', telefone: '', documento: '', photo: '', foto_pessoa: '' });
    expect(lista.find((m: any) => m.id === 501)).toMatchObject({ email: 'c71@x.com', telefone: '1799999071', photo: 'https://s3/u71.jpg' });
  });

  it('app getAllMoradores: a foto da conta compartilhada não substitui a do cadastro', async () => {
    const prisma = base({
      moradores: {
        findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? vinculosFora(where) : [
          { ...cadastro(500, COMPARTILHADA), foto_pessoa: 'https://s3/m500.jpg', user: conta(COMPARTILHADA) },
          { ...cadastro(501, LOCAL), user: conta(LOCAL) },
        ])),
      },
      apartamentos_Users: { findMany: jest.fn(async () => []) },
    });
    const svc = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, { assertCondominio: jest.fn(async () => undefined) } as any);
    const lista = await svc.getAllMoradores(1, sindico);
    expect(lista[0]).toMatchObject({ photo: 'https://s3/m500.jpg', foto_pessoa: 'https://s3/m500.jpg' });
    expect(lista[1]).toMatchObject({ photo: 'https://s3/u71.jpg' });
  });

  it('web findAll por apartamento: sem CPF/e-mail/telefone/foto da conta compartilhada', async () => {
    const prisma = base({
      apartamentos_Users: { findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? [] : rels())) },
      moradores: { findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? vinculosFora(where) : [])) },
    });
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const lista = await svc.findAll(1, undefined, 11);
    expect(lista.find((m: any) => m.id === 500)).toMatchObject({ documento: null, email: null, telefone: null, photo: null, foto_pessoa: null });
    expect(lista.find((m: any) => m.id === 501)).toMatchObject({ email: 'c71@x.com', photo: 'https://s3/u71.jpg' });
  });

  it('web findAll do condomínio e findOne: a foto da conta compartilhada não entra (nem aninhada em user)', async () => {
    const linha = { ...cadastro(500, COMPARTILHADA), user: { photo: 'https://s3/u70.jpg', apartamentosUsers: [{ id_apto: 11 }] } };
    const prisma = base({
      moradores: {
        findMany: jest.fn(async ({ where }: any) => (ehFora(where) ? vinculosFora(where) : [linha])),
        findUnique: jest.fn(async () => linha),
        count: jest.fn(async ({ where }: any) => (ehFora(where) && where.id_user === COMPARTILHADA ? 1 : 0)),
      },
      apartamentos_Users: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    });
    const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    const [m] = await svc.findAll(1);
    expect(m.photo).toBeNull();
    const um: any = await svc.findOne(500);
    expect(um.photo).toBeNull();
    expect(um.foto_pessoa).toBeNull();
    expect(um.user?.photo ?? null).toBeNull();
  });
});
