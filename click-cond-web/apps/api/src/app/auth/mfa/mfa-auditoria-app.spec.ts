import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';

/**
 * Varredura do Log de Auditoria (25/11): o login do síndico pelo app em aparelho não confiável termina
 * na conferência do código (POST /auth/mfa/verify) e não deixava rastro — nem o login, nem o código
 * errado. O console já grava pelo auth.service, que chama verifyChallenge direto (não passa por aqui),
 * então gravar no controller do app não duplica.
 */
describe('MfaController — auditoria do login do app com código de verificação', () => {
  const conta = { id_user: 42, nome: 'Síndico Teste', email: 's@x.com', condominios: [1, 2] };
  const req = { headers: { 'user-agent': 'Flutter' }, ip: '200.1.2.3' };

  function montar(verificar: () => Promise<any>, contaDoDesafio: any = conta) {
    const service = {
      verifyChallenge: jest.fn(verificar),
      contaDoDesafio: jest.fn(async () => contaDoDesafio),
    } as unknown as MfaService;
    const auditoria = { registrar: jest.fn(async () => undefined) };
    const c = new MfaController(service, auditoria as any);
    return { c, auditoria };
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('código certo: LOGIN (metodo mfa) em cada condomínio do síndico, com autor', async () => {
    const { c, auditoria } = montar(async () => ({ token: 't', user: { id: 42 } }));
    await c.verify({ mfa_token: 'tok', code: '123456' }, req);
    await flush();
    expect(auditoria.registrar).toHaveBeenCalledTimes(2);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        id_condominio: 1, acao: 'LOGIN', modulo: 'auth', autor_id: 42, autor_tipo: 'user',
        usuario_nome: 'Síndico Teste', detalhes: expect.objectContaining({ metodo: 'mfa', app: true }),
      }),
    );
  });

  it('código errado (401): LOGIN_FALHA e o erro segue para o app', async () => {
    const { c, auditoria } = montar(async () => { throw new UnauthorizedException('Código incorreto.'); });
    await expect(c.verify({ mfa_token: 'tok', code: '000000' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    await flush();
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ id_condominio: 2, acao: 'LOGIN_FALHA' }));
    expect(JSON.stringify((auditoria.registrar as jest.Mock).mock.calls)).not.toContain('000000');
  });

  it('desafio invalidado por excesso (429) também grava LOGIN_FALHA', async () => {
    const { c, auditoria } = montar(async () => {
      throw new HttpException('Muitas tentativas', HttpStatus.TOO_MANY_REQUESTS);
    });
    await expect(c.verify({ mfa_token: 'tok', code: '1' }, req)).rejects.toBeInstanceOf(HttpException);
    await flush();
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'LOGIN_FALHA' }));
  });

  it('desafio inexistente/expirado: não grava (não há conta conhecida)', async () => {
    const { c, auditoria } = montar(async () => { throw new UnauthorizedException('x'); }, null);
    await expect(c.verify({ mfa_token: 'tok', code: '1' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    await flush();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('falha da auditoria nunca derruba o login', async () => {
    const { c, auditoria } = montar(async () => ({ token: 't', user: { id: 42 } }));
    (auditoria.registrar as jest.Mock).mockRejectedValue(new Error('banco'));
    await expect(c.verify({ mfa_token: 'tok', code: '123456' }, req)).resolves.toMatchObject({ token: 't' });
    await flush();
  });
});

describe('MfaService.contaDoDesafio', () => {
  it('lê a conta e os condomínios do síndico antes da conferência (o desafio é apagado no sucesso)', async () => {
    const prisma: any = {
      isConnected: true,
      mfa_Challenges: {
        findFirst: jest.fn(async () => ({
          id_user: 42,
          user: { email: 's@x.com', sindicos: [{ name: 'Síndico Teste' }], sindicosCondominios: [{ id_condominio: 1 }, { id_condominio: 2 }] },
        })),
      },
    };
    const svc = new MfaService(prisma, {} as any, {} as any);
    await expect(svc.contaDoDesafio('12345678-1234-1234-1234-123456789abc')).resolves.toEqual({
      id_user: 42, nome: 'Síndico Teste', email: 's@x.com', condominios: [1, 2],
    });
  });

  it('token em formato inválido ou desafio inexistente → null', async () => {
    const prisma: any = { isConnected: true, mfa_Challenges: { findFirst: jest.fn(async () => null) } };
    const svc = new MfaService(prisma, {} as any, {} as any);
    await expect(svc.contaDoDesafio({} as any)).resolves.toBeNull();
    await expect(svc.contaDoDesafio('12345678-1234-1234-1234-123456789abc')).resolves.toBeNull();
  });
});
