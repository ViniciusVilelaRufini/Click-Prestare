import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Enumeração de contas / oráculos de CPF: recuperação de senha, signup público
 * e cadastro de morador não podem revelar se e-mail/CPF existem nem a
 * associação CPF-e-mail de outra conta.
 */
const MSG_SIGNUP = 'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, entre ou recupere a senha.';
const MSG_MORADOR = 'Já existe uma conta com este CPF. Use o e-mail da conta existente ou fale com o suporte.';

describe('solicitarCodigoRedefinicao — resposta idêntica com e sem conta', () => {
  function montar(conta: any) {
    const prisma: any = {
      users: { findFirst: jest.fn(async () => conta) },
      redefinicoes_Senha: {
        count: jest.fn(async () => 0),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({ id: 1 })),
      },
    };
    const mail: any = { sendResetPasswordCode: jest.fn().mockResolvedValue(undefined) };
    const svc = new MobileAuthService(prisma, {} as any, mail, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return svc;
  }

  it('mesmo corpo (exceto ticket aleatório) para conta existente e inexistente', async () => {
    const existente = await montar({ id: 5, moradores: [{ nome: 'Ana' }] }).solicitarCodigoRedefinicao('ana@x.com', 'morador');
    const inexistente = await montar(null).solicitarCodigoRedefinicao('ana@x.com', 'morador');
    const { ticket_id: t1, ...r1 } = existente;
    const { ticket_id: t2, ...r2 } = inexistente;
    expect(r1).toEqual(r2);
    expect(typeof t1).toBe(typeof t2);
    expect(t1).toHaveLength(t2.length);
  });
});

describe('signupSindico — mensagem genérica', () => {
  function montar(opts: { emailExiste?: boolean; cpfExiste?: boolean }) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async (args: any) => {
          if (opts.emailExiste && args?.where?.login) return { id: 1 };
          if (opts.cpfExiste && args?.where?.cpf) return { id: 2 };
          return null;
        }),
      },
    };
    return new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  }
  const base = { nome: 'Ana', email: 'ana@x.com', password: 'Senha@123', doc_identification: '52998224725' };

  it.each([
    ['CPF', { cpfExiste: true }],
    ['e-mail', { emailExiste: true }],
  ])('%s já existente devolve a mensagem genérica', async (_n, opts) => {
    await expect(montar(opts as any).signupSindico(base)).rejects.toThrow(MSG_SIGNUP);
    await expect(montar(opts as any).signupSindico(base)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('saveMorador — não revela CPF de outra conta', () => {
  it('conflito de CPF com outro e-mail usa a mensagem neutra', async () => {
    const CPF = '52998224725';
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      users: { findFirst: jest.fn(async () => ({ id: 70, cpf: CPF, email: 'dono@x.com', name: 'Dono' })) },
      apartamentos_Users: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, {} as any, { isDataUrl: () => false } as any, {} as any, tenant, {} as any, {} as any, {} as any, {} as any);
    const sindico = { sub: 1, nome: 'S', typeAccess: 'Sindico' } as any;
    await expect(
      svc.saveMorador({ morador: { nome: 'X', documento: CPF, email: 'outro@x.com', data_nascimento: '01/01/1990', id_apto: 11 } }, false, sindico),
    ).rejects.toThrow(MSG_MORADOR);
  });
});
