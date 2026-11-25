import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * A trava do login do console (8 falhas em 10 min) não deixava rastro: o síndico não via que a conta
 * dele foi alvo. Agora a tentativa que TRAVA o login grava, além da LOGIN_FALHA dela, uma linha
 * LOGIN_FALHA "Login bloqueado por excesso de tentativas" em cada condomínio da conta. Uma vez por
 * trava: as tentativas recusadas enquanto travado não consultam o banco (anti-enumeração) nem gravam.
 */
describe('AuthService.loginPortaria — trava por excesso de tentativas no log de auditoria', () => {
  const assentar = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };

  async function build() {
    const hash = await bcrypt.hash('senha-certa', 4);
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => ({
          id: 42,
          login: 'sind@demo.com',
          email: 'sind@demo.com',
          password: hash,
          sindicos: [{ name: 'Sindica' }],
          sindicosCondominios: [
            { id: 1, id_condominio: 7, condominio: { nome: 'C7' } },
            { id: 2, id_condominio: 8, condominio: { nome: 'C8' } },
          ],
        })),
      },
    };
    const registrar = jest.fn(async () => undefined);
    const svc = new AuthService(prisma, { sign: jest.fn() } as any, {} as any, undefined, undefined, { registrar } as any);
    return { svc, registrar, linhas: () => registrar.mock.calls.map((c: any[]) => c[0]) };
  }

  it('a 8ª falha grava o bloqueio em cada condomínio; travado não grava mais', async () => {
    const { svc, registrar, linhas } = await build();
    for (let i = 0; i < 7; i++) {
      await expect(svc.loginPortaria('sind@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await assentar();
    expect(linhas().filter((l: any) => l.descricao === 'Login bloqueado por excesso de tentativas')).toEqual([]);
    registrar.mockClear();

    await expect(svc.loginPortaria('sind@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
    await assentar();
    const bloqueio = linhas().filter((l: any) => l.descricao === 'Login bloqueado por excesso de tentativas');
    expect(bloqueio).toEqual([
      expect.objectContaining({ id_condominio: 7, acao: 'LOGIN_FALHA', modulo: 'auth', autor_id: 42, autor_tipo: 'user' }),
      expect.objectContaining({ id_condominio: 8, acao: 'LOGIN_FALHA', modulo: 'auth' }),
    ]);
    expect(JSON.stringify(bloqueio)).not.toContain('errada');
    registrar.mockClear();

    await expect(svc.loginPortaria('sind@demo.com', 'errada')).rejects.toThrow(/Muitas tentativas/);
    await assentar();
    expect(linhas()).toEqual([]);
  });
});
