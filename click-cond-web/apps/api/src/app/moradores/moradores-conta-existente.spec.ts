import { ConflictException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/** Mesma regra no cadastro do console (e no import-bulk, que chama create por linha). */
describe('MoradoresService.create — conta existente com vínculo em outro condomínio', () => {
  const MSG = 'Não foi possível concluir o cadastro com este e-mail/CPF. Fale com o suporte para vincular a unidade.';
  const existente = { id: 70, email: 'v@x.com', login: null, password: '$2b$10$senhaDaVitima', photo: null };

  function build(vinculoFora: boolean) {
    const contaFora = jest.fn(async ({ where }: any) => (vinculoFora && where.id_condominio?.not !== undefined ? 1 : 0));
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        count: contaFora,
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => ({ ...existente })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { findUnique: jest.fn(async () => ({ id: 55, id_condominio: 1, bloco: 'A', apto: '101' })) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios_Portaria: { count: jest.fn(async () => 0) }, // login de portaria livre
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    prisma.$transaction ??= jest.fn((fn: any) => fn(prisma)); // create grava numa transação (B3)
    const svc = new MoradoresService(prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any);
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail };
  }

  const dto = { nome: 'V', email: 'v@x.com', data_nascimento: '1990-01-01', id_condominio: 1, sendCredentials: true };

  it('RECUSA ligar a conta de outro condomínio: nada gravado, nenhum e-mail', async () => {
    const { svc, prisma, mail } = build(true);
    await expect(svc.create(dto as any)).rejects.toThrow(MSG);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMoradorExisting).not.toHaveBeenCalled();
  });

  it('conta só deste condomínio continua recebendo login/senha', async () => {
    const { svc, prisma } = build(false);
    await svc.create(dto as any);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ login: 'v@x.com', password: expect.stringMatching(/^\$2/) }),
    });
  });

  // CRM (criar morador e importação de contatos da Superlógica): chamadores confiáveis, sem token de usuário.
  it('com permitirContaDeOutroCondominio a conta é ligada à unidade e o Users dela não é tocado', async () => {
    const { svc, prisma, mail } = build(true);
    await svc.create({ ...dto, id_apartamento: 55 } as any, undefined, {
      permitirContaDeOutroCondominio: true,
    });
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_apto: 55, id_user: 70 }),
    });
    expect(prisma.moradores.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_user: 70, id_condominio: 1 }),
    });
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
    // Sem senha nova: só o aviso de conta existente, sem credencial.
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('sem a opção a recusa continua (mesmo com unidade)', async () => {
    const { svc, prisma } = build(true);
    await expect(svc.create({ ...dto, id_apartamento: 55 } as any)).rejects.toThrow(MSG);
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
  });

  describe('colisão de login/e-mail/CPF no cadastro manual', () => {
    it('acha a conta pelo login quando nenhuma conta tem esse e-mail', async () => {
      const { svc, prisma } = build(false);
      prisma.users.findFirst = jest.fn(async ({ where }: any) => (where.login ? { ...existente, email: 'outro@x.com' } : null));
      await svc.create(dto as any);
      expect(prisma.users.findFirst).toHaveBeenNthCalledWith(1, { where: { email: 'v@x.com' } });
      expect(prisma.users.findFirst).toHaveBeenNthCalledWith(2, { where: { login: 'v@x.com' } });
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('conta A com o e-mail e conta B com o login igual: liga a A', async () => {
      const { svc, prisma } = build(false);
      const A = { ...existente, id: 71, email: 'v@x.com', login: null };
      const B = { ...existente, id: 72, email: 'b@x.com', login: 'v@x.com' };
      prisma.users.findFirst = jest.fn(async ({ where }: any) => (where.email ? A : where.login ? B : null));
      await svc.create({ ...dto, id_apartamento: 55 } as any);
      expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 71 }) });
      expect(prisma.moradores.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 71 }) });
    });

    function comP2002(target: any) {
      const b = build(false);
      b.prisma.users.findFirst = jest.fn(async () => null);
      b.prisma.users.create = jest.fn(async () => {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
      });
      return b;
    }

    it('P2002 em login/email vira mensagem clara', async () => {
      for (const target of ['user_login', 'uni_email', ['login']]) {
        const { svc } = comP2002(target);
        await expect(svc.create(dto as any)).rejects.toMatchObject({ response: { message: 'Já existe outro usuário com este e-mail.' } });
        await expect(svc.create(dto as any)).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('CPF de outra conta é recusado', async () => {
      for (const target of ['uni_cpf', ['cpf']]) {
        const { svc } = comP2002(target);
        await expect(svc.create(dto as any)).rejects.toThrow('Este CPF já pertence a outra conta.');
        await expect(svc.create(dto as any)).rejects.toBeInstanceOf(ConflictException);
      }
    });
  });
});
