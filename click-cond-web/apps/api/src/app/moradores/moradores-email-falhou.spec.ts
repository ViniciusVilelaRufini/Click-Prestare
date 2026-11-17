import { ServiceUnavailableException } from '@nestjs/common';
import { MoradoresService } from './moradores.service';

/**
 * Bloqueador 6 do onboarding: "acesso enviado" só quando o e-mail sai de verdade.
 */
const ADULTO = new Date('1980-01-01');
const MSG_503 = 'Não conseguimos enviar o e-mail agora. O morador ainda não tem acesso; tente de novo.';
const MSG_AVISO = 'Morador cadastrado, mas o e-mail de acesso não saiu. Use "Enviar acesso" para tentar de novo.';

function prismaBase(conta: any) {
  const prisma: any = {
    isConnected: true,
    users: {
      findUnique: jest.fn().mockResolvedValue(conta),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 50 }),
    },
    moradores: {
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn(async ({ where }: any) => (where?.email ? 1 : 0)),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
    },
    visitantes: { findFirst: jest.fn().mockResolvedValue(null) },
    redefinicoes_Senha: { count: jest.fn().mockResolvedValue(0) },
    funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) },
    sindicos_Condominios: { count: jest.fn().mockResolvedValue(0) },
    funcionarios: { count: jest.fn().mockResolvedValue(0) },
    apartamentos_Users: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
    apartamentos: {
      findFirst: jest.fn().mockResolvedValue({ id: 55, bloco: 'A', apto: '101' }),
      findMany: jest.fn().mockResolvedValue([{ id: 55, id_condominio: 1, bloco: 'A', apto: '101' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 55, id_condominio: 1, bloco: 'A', apto: '101' }),
    },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

function harness(conta: any = null) {
  const prisma = prismaBase(conta);
  const mail: any = {
    sendWelcomeMorador: jest.fn().mockResolvedValue({}),
    sendWelcomeMoradorExisting: jest.fn().mockResolvedValue({}),
  };
  const auditoria: any = { registrar: jest.fn().mockResolvedValue({}) };
  const mobileAuth: any = { enviarLinkDefinirSenhaOperador: jest.fn().mockResolvedValue(undefined) };
  const service = new MoradoresService(
    prisma, mail, { isDataUrl: () => false, uploadDataUrl: jest.fn() } as any, { syncMorador: jest.fn() } as any,
    auditoria, { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any, undefined, mobileAuth,
  );
  jest.spyOn(service as any, 'carregarContextoMorador').mockResolvedValue(null);
  jest.spyOn(service, 'findOne').mockResolvedValue({
    id: 5, nome: 'Bia', email: 'bia@x.com', id_user: 50, id_condominio: 1, data_nascimento: ADULTO,
  } as any);
  return { service, prisma, mail, auditoria, mobileAuth };
}

describe('sendCredentials — e-mail que não sai', () => {
  const ANTES = new Date('2026-01-01T00:00:00Z');

  it('modo senha: 503 com a mensagem, restaura senha_alterada_em e não audita', async () => {
    const { service, prisma, mail, auditoria } = harness({
      id: 50, login: 'bia@x.com', email: 'bia@x.com', password: null, senha_alterada_em: ANTES, _count: {},
    });
    mail.sendWelcomeMorador.mockRejectedValue(new Error('smtp'));

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(ServiceUnavailableException);
    expect(erro.message).toBe(MSG_503);
    expect(prisma.users.update).toHaveBeenCalledTimes(2);
    expect(prisma.users.update).toHaveBeenLastCalledWith({ where: { id: 50 }, data: { senha_alterada_em: ANTES } });
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('modo link: envio rejeitado vira o mesmo 503', async () => {
    const { service, mobileAuth, auditoria } = harness({
      id: 50, login: 'bia@x.com', email: 'bia@x.com', password: 'hash', senha_alterada_em: ANTES, _count: {},
    });
    mobileAuth.enviarLinkDefinirSenhaOperador.mockRejectedValue(new Error('smtp'));

    const erro = await service.sendCredentials(5).catch((e) => e);

    expect(erro).toBeInstanceOf(ServiceUnavailableException);
    expect(erro.message).toBe(MSG_503);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});

describe('create — e-mail que não sai', () => {
  const dto: any = {
    nome: 'Bia', email: 'bia@x.com', id_condominio: 1, id_apartamento: 55, tipo: 'proprietario',
    data_nascimento: '1980-01-01', sendCredentials: true,
  };

  it('cadastra, mas avisa: credenciais_enviadas:false e aviso_email', async () => {
    const { service, mail } = harness();
    mail.sendWelcomeMorador.mockRejectedValue(new Error('smtp'));

    const res: any = await service.create(dto);

    expect(res.credenciais_enviadas).toBe(false);
    expect(res.aviso_email).toBe(MSG_AVISO);
  });

  it('e-mail que sai: credenciais_enviadas:true e sem aviso', async () => {
    const { service } = harness();

    const res: any = await service.create(dto);

    expect(res.credenciais_enviadas).toBe(true);
    expect(res.aviso_email).toBeUndefined();
  });
});

describe('importBulk — e-mail que não sai', () => {
  it('cadastra as 3 linhas e lista em sem_email a que falhou', async () => {
    const h = harness();
    const mail = h.mail;
    mail.sendWelcomeMorador.mockImplementation(async (email: string) => {
      if (email === 'dois@x.com') throw new Error('smtp');
      return {};
    });
    const linha = (n: string, email: string) => ({ nome: n, email, bloco: 'A', apartamento: '101', data_nascimento: '15/05/1985' });

    const res: any = await h.service.importBulk(1, [linha('Um', 'um@x.com'), linha('Dois', 'dois@x.com'), linha('Tres', 'tres@x.com')]);

    expect(res.total).toBe(3);
    expect(res.erros).toEqual([]);
    expect(res.sem_email).toEqual([{ linha: 2, nome: 'Dois' }]);
  });
});
