import { MobileAuthService } from './mobile-auth.service';

/**
 * Users é global. O cadastro de morador achava a conta pelo CPF em QUALQUER
 * condomínio e, faltando login/senha/e-mail, gravava o e-mail de quem
 * cadastrava e uma senha que ele conhecia — tomando a conta de um morador de
 * outro prédio. A A2 deixou o VÍNCULO para o dono decidir; aqui só se impede
 * gravar credenciais nessa conta.
 */
describe('saveMorador — conta existente com vínculo em outro condomínio', () => {
  const CPF = '52998224725';
  const sindico = { sub: 1, nome: 'Síndico A', typeAccess: 'Sindico' } as any;
  const vitima = { id: 70, cpf: CPF, email: null, login: null, password: null, name: 'Vítima', phone: '17999990000' };

  function montar(vinculoFora: boolean, conta: any = vitima) {
    // Respeita `id_condominio: { not: n }` como o util de vínculos consulta.
    const contaFora = jest.fn(async ({ where }: any) => (vinculoFora && where.id_condominio?.not !== undefined ? 1 : 0));
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: contaFora,
      },
      users: {
        findFirst: jest.fn(async () => ({ ...conta })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  const corpo = (sendCredentials: boolean) => ({
    morador: { nome: 'Outro nome', documento: CPF, email: 'atacante@x.com', data_nascimento: '01/01/1990', id_apto: 11, sendCredentials },
  });

  it.each([[true], [false]])('NÃO grava login/e-mail/senha na conta de outro condomínio (sendCredentials=%p)', async (envio) => {
    const { svc, prisma, mail } = montar(true);
    await svc.saveMorador(corpo(envio), false, sindico);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    // O vínculo ao apartamento continua (decisão de produto deferida na A2).
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_apto: 11, id_user: 70 }),
    });
  });

  it('NÃO preenche telefone/nome vazios na conta de outro condomínio', async () => {
    const { svc, prisma } = montar(true, { ...vitima, phone: null, name: null });
    const body = corpo(true);
    await svc.saveMorador({ morador: { ...body.morador, telefone: '17988887777' } }, false, sindico);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('conta sem vínculo fora deste condomínio continua recebendo login e senha', async () => {
    const { svc, prisma } = montar(false);
    await svc.saveMorador(corpo(true), false, sindico);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ login: 'atacante@x.com', email: 'atacante@x.com', password: expect.stringMatching(/^\$2/) }),
    });
  });
});
