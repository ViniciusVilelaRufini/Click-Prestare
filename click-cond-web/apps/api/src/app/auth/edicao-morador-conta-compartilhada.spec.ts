import { MobileAuthService } from './mobile-auth.service';
import { MoradoresService } from '../moradores/moradores.service';

/**
 * Editar o cadastro num condomínio copiava nome/telefone/foto para Users — a linha global que o
 * outro condomínio também lê (lista de moradores, WhatsApp de visitante). Quem edita a ficha de
 * OUTRA pessoa cuja conta é também de outro condomínio grava só em Moradores.
 */
const fora = (vinculoFora: boolean) =>
  jest.fn(async ({ where }: any) =>
    vinculoFora && (where.id_condominio?.not !== undefined || where.apartamento?.id_condominio?.not !== undefined) ? 1 : 0,
  );

function app(vinculoFora: boolean) {
  const conta = fora(vinculoFora);
  const tx: any = { moradores: { update: jest.fn(async () => ({})) }, users: { update: jest.fn(async () => ({})) } };
  const prisma: any = {
    isConnected: true,
    moradores: {
      findUnique: jest.fn(async () => ({
        id: 10, id_user: 40, id_condominio: 1, email: 'v@x.com', nome: 'V', data_nascimento: null, extra2: null,
        user: { id: 40, email: 'v@x.com', login: 'v@x.com', photo: null, profile_image: null },
      })),
      count: conta,
    },
    users: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
    sindicos_Condominios: { count: conta },
    funcionarios: { count: conta },
    apartamentos_Users: { count: conta },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertPermissaoFuncionario: jest.fn(async () => undefined) };
  const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, { isDataUrl: () => false } as any, {} as any, tenant);
  return { svc, tx };
}

function web(vinculoFora: boolean) {
  const conta = fora(vinculoFora);
  const tx: any = {
    moradores: { update: jest.fn(async () => ({ id: 10 })) },
    users: { update: jest.fn(async () => ({})) },
    apartamentos_Users: { updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
  };
  const prisma: any = {
    isConnected: true,
    moradores: {
      findUnique: jest.fn(async () => ({ id: 10, id_user: 40, id_condominio: 1, email: 'v@x.com', nome: 'V', data_nascimento: new Date('1980-01-01'), extra2: null, user: { id: 40 } })),
      count: conta,
    },
    users: { findFirst: jest.fn(async () => null) },
    sindicos_Condominios: { count: conta },
    funcionarios: { count: conta },
    apartamentos_Users: { count: conta },
    facial_Devices: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const svc = new MoradoresService(
    prisma, {} as any, { isDataUrl: jest.fn(() => false) } as any,
    { syncMorador: jest.fn(async () => ({})) } as any,
    { registrar: jest.fn(async () => ({})) } as any, {} as any,
  );
  return { svc, tx };
}

const sindicoX = { sub: 9, nome: 'Síndico X', typeAccess: 'Sindico', user: { id: 9 } } as any;
const operador = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;

describe('R4 — edição de morador e a conta global', () => {
  it('app: síndico edita nome/telefone de conta que também é de outro condomínio → só Moradores', async () => {
    const { svc, tx } = app(true);
    await svc.saveMorador({ morador: { id: 10, nome: 'Novo', telefone: '17911112222' } }, true, sindicoX);
    expect(tx.moradores.update.mock.calls[0][0].data).toMatchObject({ nome: 'Novo', telefone: '17911112222' });
    expect(tx.users.update).not.toHaveBeenCalled();
  });

  it('app: conta só deste condomínio continua recebendo nome/telefone', async () => {
    const { svc, tx } = app(false);
    await svc.saveMorador({ morador: { id: 10, nome: 'Novo', telefone: '17911112222' } }, true, sindicoX);
    expect(tx.users.update).toHaveBeenCalledWith({ where: { id: 40 }, data: { name: 'Novo', phone: '17911112222' } });
  });

  it('app: o próprio titular continua atualizando o próprio perfil', async () => {
    const { svc, tx } = app(true);
    await svc.saveMorador({ morador: { id: 10, nome: 'Eu', telefone: '1' } }, true, { sub: 40, typeAccess: 'Morador', user: { id: 40 } } as any);
    expect(tx.users.update).toHaveBeenCalled();
  });

  it('web: operador edita nome/telefone de conta que também é de outro condomínio → só Moradores', async () => {
    const { svc, tx } = web(true);
    await svc.update(10, { nome: 'N', telefone: '1' } as any, operador);
    expect(tx.moradores.update).toHaveBeenCalled();
    expect(tx.users.update).not.toHaveBeenCalled();
  });

  it('web: conta só deste condomínio segue recebendo nome/telefone', async () => {
    const { svc, tx } = web(false);
    await svc.update(10, { nome: 'N', telefone: '1' } as any, operador);
    expect(tx.users.update).toHaveBeenCalledWith({ where: { id: 40 }, data: { name: 'N', phone: '1' } });
  });
});
