import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * /sindico/login (app) exige aparelho confiável ou código por e-mail. O
 * /auth/login-portaria emitia o mesmo typeAccess 'Sindico' — aceito também
 * nas rotas do app — só com a senha: uma senha vazada pulava o 2º fator.
 */
describe('AuthService.loginPortaria — síndico passa pelo 2º fator', () => {
  const SENHA = 'senha-certa';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  const desafio = { mfa_required: true as const, mfa_token: 'mfa-1', email_masked: 'si****@demo.com', expires_in_seconds: 600 };

  function build(opts: { comRegistroPortaria: boolean; confiavel?: boolean; semSindico?: boolean }) {
    const assinados: JwtPayload[] = [];
    const usuario = {
      id: 42,
      login: 'sindico@demo.com',
      email: 'sindico@demo.com',
      password: hash,
      sindicos: [{ name: 'Sindica', email: 'sindico@demo.com' }],
      sindicosCondominios: [{ id: 1, id_condominio: 7, condominio: { nome: 'Edifício Demo' } }],
    };
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findFirst: jest.fn(async () =>
          opts.comRegistroPortaria
            ? { id: 3, nome: 'Registro', login: 'sindico@demo.com', password: hash, turno: 'Síndico', id_condominio: 7, ativo: 1 }
            : null,
        ),
        update: jest.fn(),
      },
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Demo' })) },
      users: {
        findFirst: jest.fn(async () => (opts.semSindico ? null : usuario)),
        findUnique: jest.fn(async () => usuario),
        update: jest.fn(),
      },
    };
    const jwt: any = {
      sign: jest.fn((p: JwtPayload) => {
        assinados.push(p);
        return 'token-portaria';
      }),
    };
    const mfa: any = {
      isDeviceTrusted: jest.fn(async () => !!opts.confiavel),
      createChallenge: jest.fn(async () => desafio),
      verifyChallenge: jest.fn(async () => ({ token: 'token-app-descartado', user: { id: 42 }, device_token: 'dev-1' })),
    };
    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any, undefined, mfa);
    return { svc, jwt, mfa, assinados };
  }

  it.each([[true], [false]])(
    'sem aparelho confiável devolve o desafio e nenhum token (registro de portaria: %s)',
    async (comRegistroPortaria) => {
      const { svc, jwt, mfa } = build({ comRegistroPortaria });
      const res: any = await svc.loginPortaria('sindico@demo.com', SENHA);

      expect(res).toEqual(desafio);
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(mfa.createChallenge).toHaveBeenCalledWith({ id: 42, email: 'sindico@demo.com', name: 'Sindica' });
    },
  );

  it('código certo entrega o token de console do síndico e o token do dispositivo', async () => {
    const { svc, mfa, assinados } = build({ comRegistroPortaria: false });
    await svc.loginPortaria('sindico@demo.com', SENHA);
    const res: any = await svc.verificarMfaPortaria('mfa-1', '123456', true, { ip: '1.2.3.4' });

    expect(mfa.verifyChallenge).toHaveBeenCalledWith('mfa-1', '123456', true, { ip: '1.2.3.4' });
    expect(assinados).toEqual([{ sub: 42, nome: 'Sindica', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' }]);
    expect(res).toMatchObject({
      access_token: 'token-portaria',
      id: 42,
      turno: 'Síndico',
      id_condominio: 7,
      condominios: [{ id: 7, nome: 'Edifício Demo' }],
      device_token: 'dev-1',
    });
  });

  it('desafio é de uso único e não aceita mfa_token que não saiu deste login', async () => {
    const { svc } = build({ comRegistroPortaria: false });
    await svc.loginPortaria('sindico@demo.com', SENHA);
    await svc.verificarMfaPortaria('mfa-1', '123456', false);

    await expect(svc.verificarMfaPortaria('mfa-1', '123456', false)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verificarMfaPortaria('mfa-do-app', '123456', false)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aparelho confiável entra direto, como no app', async () => {
    const { svc, mfa } = build({ comRegistroPortaria: true, confiavel: true });
    const res: any = await svc.loginPortaria('sindico@demo.com', SENHA, 'dev-1');

    expect(mfa.isDeviceTrusted).toHaveBeenCalledWith(42, 'dev-1');
    expect(res.access_token).toBe('token-portaria');
    expect(mfa.createChallenge).not.toHaveBeenCalled();
  });

  it('porteiro comum continua sem 2º fator', async () => {
    const { svc, mfa } = build({ comRegistroPortaria: true, semSindico: true });
    const res: any = await svc.loginPortaria('sindico@demo.com', SENHA);

    expect(res.access_token).toBe('token-portaria');
    expect(mfa.isDeviceTrusted).not.toHaveBeenCalled();
  });
});
