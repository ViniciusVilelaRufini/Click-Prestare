import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';

/** Mesmo defeito no cadastro pelo app (saveMorador): sem envio, senha = CPF. */
describe('saveMorador — senha inicial nunca é o CPF', () => {
  const CPF = '52998224725';
  const sindico = { sub: 1, nome: 'Síndico', typeAccess: 'Sindico' } as any;

  function montar() {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: jest.fn(async () => 0),
      },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  it('sendCredentials=false: Users nasce com senha que não é o CPF e nada é enviado', async () => {
    const { svc, prisma, mail } = montar();
    await svc.saveMorador(
      { morador: { nome: 'QA', documento: CPF, email: 'qa@x.com', data_nascimento: '01/01/1990', id_apto: 11, sendCredentials: false } },
      false,
      sindico,
    );
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    expect(await bcrypt.compare(CPF, hash)).toBe(false);
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });
});
