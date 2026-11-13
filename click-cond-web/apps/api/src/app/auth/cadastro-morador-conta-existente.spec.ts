import { MobileAuthService } from './mobile-auth.service';

/**
 * Users é global. O cadastro de morador achava a conta pelo CPF/e-mail (que não são segredo) e a
 * ligava a este apartamento mesmo sendo de OUTRO condomínio — e a lista do apto passava a mostrar
 * e-mail, telefone, CPF e foto dela. Agora recusa com mensagem neutra; só não recusa quando a conta
 * é a de quem cadastra (a sessão prova a posse).
 */
describe('saveMorador — conta existente com vínculo em outro condomínio', () => {
  const CPF = '52998224725';
  const MSG = 'Não foi possível concluir o cadastro com este e-mail/CPF. Peça para a pessoa vincular a unidade pelo próprio app ou fale com o suporte.';
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

  it.each([[true], [false]])('RECUSA ligar a conta de outro condomínio (sendCredentials=%p)', async (envio) => {
    const { svc, prisma, mail } = montar(true);
    await expect(svc.saveMorador(corpo(envio), false, sindico)).rejects.toThrow(MSG);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('RECUSA também com só o CPF (sem e-mail)', async () => {
    const { svc, prisma } = montar(true);
    await expect(
      svc.saveMorador({ morador: { nome: 'X', documento: CPF, data_nascimento: '01/01/1990', id_apto: 11, sendCredentials: false } }, false, sindico),
    ).rejects.toThrow(MSG);
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
  });

  it('a conta é a do próprio síndico (de mais de um condomínio): continua sendo ligada, sem tocar Users', async () => {
    const { svc, prisma } = montar(true, { ...vitima, id: 1 });
    await svc.saveMorador(corpo(false), false, sindico);
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_apto: 11, id_user: 1 }) });
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
