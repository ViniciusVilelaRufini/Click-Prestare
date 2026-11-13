import { BadRequestException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * Funcionarios_Portaria.login é único só na própria tabela. O cadastro de morador (create, e o
 * import-bulk que chama create por linha) e o "Enviar credenciais" gravavam Users.login com um
 * e-mail que já é o login de portaria de outra pessoa. Agora: recusa neutra antes de gravar.
 */
const MSG = 'Já existe outro usuário com este e-mail.';
const LOGIN_PORTEIRO = 'porteiro@x.com';

function prismaBase(opts: { contaExistente?: any } = {}) {
  return {
    isConnected: true,
    moradores: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
    },
    visitantes: { findFirst: jest.fn(async () => null) },
    users: {
      findFirst: jest.fn(async () => opts.contaExistente ?? null),
      create: jest.fn(async () => ({ id: 50 })),
      update: jest.fn(async () => ({})),
    },
    funcionarios_Portaria: {
      count: jest.fn(async ({ where }: any) => (where.login === LOGIN_PORTEIRO ? 1 : 0)),
    },
    apartamentos: { findUnique: jest.fn(async () => ({ id: 55, id_condominio: 1, bloco: 'A', apto: '101' })) },
    apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
    sindicos_Condominios: { count: jest.fn(async () => 0) },
    funcionarios: { count: jest.fn(async () => 0) },
  } as any;
}

function service(prisma: any) {
  const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
  const svc = new MoradoresService(
    prisma, mail, { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any, {} as any,
    { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any,
  );
  jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
  return { svc, mail };
}

describe('MoradoresService — login de portaria de outra pessoa', () => {
  const dto = (email: string) => ({ nome: 'V', email, data_nascimento: '1990-01-01', id_apartamento: 55, id_condominio: 1 });

  describe('create (e import-bulk)', () => {
    it('conta nova com o login de um porteiro: recusa sem criar nada', async () => {
      const prisma = prismaBase();
      const { svc } = service(prisma);
      await expect(svc.create(dto(LOGIN_PORTEIRO) as any)).rejects.toThrow(new BadRequestException(MSG));
      expect(prisma.users.create).not.toHaveBeenCalled();
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });

    it('conta existente sem login que receberia o login de um porteiro: recusa sem gravar', async () => {
      const prisma = prismaBase({ contaExistente: { id: 70, email: LOGIN_PORTEIRO, login: null, password: null } });
      const { svc } = service(prisma);
      await expect(svc.create(dto(LOGIN_PORTEIRO) as any)).rejects.toThrow(MSG);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.moradores.create).not.toHaveBeenCalled();
    });

    it('import-bulk: a linha com o login de um porteiro vai para os erros', async () => {
      const prisma = prismaBase();
      prisma.apartamentos.findFirst = jest.fn(async () => ({ id: 55 }));
      const { svc } = service(prisma);
      const r = await svc.importBulk(1, [{ nome: 'V', email: LOGIN_PORTEIRO, bloco: 'A', apartamento: '101', data_nascimento: '1990-01-01' }]);
      expect(r.total).toBe(0);
      expect(r.erros).toEqual([{ nome: 'V', erro: MSG }]);
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('e-mail livre: cria a conta como antes', async () => {
      const prisma = prismaBase();
      const { svc } = service(prisma);
      jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
      await svc.create(dto('livre@x.com') as any);
      expect(prisma.funcionarios_Portaria.count).toHaveBeenCalledWith({ where: { login: 'livre@x.com' } });
      expect(prisma.users.create).toHaveBeenCalled();
    });
  });

  describe('sendCredentials (cadastro legado sem conta)', () => {
    function legado(prisma: any) {
      prisma.moradores.findUnique = jest.fn(async () => ({
        id: 20, nome: 'L', email: LOGIN_PORTEIRO, telefone: null, documento: null,
        id_condominio: 1, id_user: null, foto_pessoa: null, foto_documento: null, user: null,
      }));
      return prisma;
    }

    it('conta nova com o login de um porteiro: recusa sem criar, vincular nem enviar', async () => {
      const prisma = legado(prismaBase());
      const { svc, mail } = service(prisma);
      await expect(svc.sendCredentials(20)).rejects.toThrow(MSG);
      expect(prisma.users.create).not.toHaveBeenCalled();
      expect(prisma.moradores.update).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    });

    it('conta existente cujo login mudaria para o de um porteiro: recusa sem gravar', async () => {
      const prisma = legado(prismaBase({ contaExistente: { id: 70, email: LOGIN_PORTEIRO, login: '12345678900' } }));
      const { svc } = service(prisma);
      await expect(svc.sendCredentials(20)).rejects.toThrow(MSG);
      expect(prisma.moradores.update).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });
});
