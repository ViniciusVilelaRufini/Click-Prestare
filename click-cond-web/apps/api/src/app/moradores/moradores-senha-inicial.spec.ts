import * as bcrypt from 'bcrypt';
import { MoradoresService } from './moradores.service';

/**
 * Sem "Enviar credenciais", a conta nascia com login = e-mail e senha = dígitos
 * do CPF, sem troca obrigatória. CPF não é segredo.
 */
describe('MoradoresService.create — senha inicial nunca é o CPF', () => {
  const CPF = '529.982.247-25';
  const CPF_DIGITOS = '52998224725';

  function build() {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        count: jest.fn(async () => 0),
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { findUnique: jest.fn(async () => null) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MoradoresService(prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any);
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail };
  }

  const dto = (over: any = {}) => ({
    nome: 'Morador QA', email: 'qa@x.com', documento: CPF, data_nascimento: '1990-01-01', id_condominio: 1, ...over,
  });

  it.each([[false], [undefined]])('sendCredentials=%p: a senha gravada não é o CPF e nada é enviado', async (envio) => {
    const { svc, prisma, mail } = build();
    await svc.create(dto({ sendCredentials: envio }) as any);
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    expect(hash).toMatch(/^\$2/);
    expect(await bcrypt.compare(CPF_DIGITOS, hash)).toBe(false);
    expect(await bcrypt.compare(CPF, hash)).toBe(false);
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('sendCredentials=true: a senha enviada é a gravada (comportamento mantido)', async () => {
    const { svc, prisma, mail } = build();
    await svc.create(dto({ sendCredentials: true }) as any);
    const hash = prisma.users.create.mock.calls[0][0].data.password;
    const [, , enviada] = mail.sendWelcomeMorador.mock.calls[0];
    expect(await bcrypt.compare(enviada, hash)).toBe(true);
    expect(enviada).not.toBe(CPF_DIGITOS);
  });
});
