import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * O app reenvia SEMPRE o e-mail do perfil ao salvar — vindo de outra fonte
 * (`Funcionarios.email ?? Users.email`, `Sindicos.email`, `Moradores.email`),
 * às vezes com outra caixa, e com `login ≠ email` na conta. Só é troca de
 * e-mail de acesso (e só então pede a senha atual) quando o e-mail novo,
 * normalizado (trim + minúsculas), não é nem o `Users.email` nem o
 * `Users.login` da conta. Sem troca real, `email`/`login` da conta ficam como
 * estão.
 *
 * Com troca real, a senha vem ANTES da checagem de conflito: sem a senha, um
 * e-mail em uso e um e-mail livre recebem a mesma resposta (sem oráculo de
 * enumeração de contas).
 */
describe('Perfil — e-mail reenviado sem troca real e oráculo de e-mail em uso', () => {
  const SENHA = 'senhaAtual123';
  const MSG = 'Para trocar o e-mail de acesso, informe sua senha atual.';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  function build(conta: { email: string | null; login: string | null }, extra: { emailMorador?: string; emailSindico?: string; emailFuncionario?: string } = {}) {
    const tx: any = {
      moradores: { update: jest.fn(async () => ({})) },
      users: { update: jest.fn(async () => ({})) },
      sindicos: { update: jest.fn(async () => ({})) },
      funcionarios: { update: jest.fn(async () => ({})) },
    };
    const usuario = {
      id: 40, ...conta, name: 'Titular', cpf: '111', phone: '999', photo: null, password: hash,
      sindicos: [{ id: 5, name: 'Titular', email: extra.emailSindico ?? conta.email, phone: '999', doc_identification: '111', date_birth: null }],
      moradores: [{ id: 10, nome: 'Titular' }],
      funcionarios: [{ id: 6 }],
    };
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => usuario),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, id_user: 40, id_condominio: 1, email: extra.emailMorador ?? conta.email, nome: 'Titular',
          data_nascimento: null, extra2: null, user: { id: 40, email: conta.email, login: conta.login },
        })),
      },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 6, id_user: 40, email: extra.emailFuncionario ?? null })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const tenant: any = {
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: jest.fn(() => false), uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, storage, {} as any, tenant);
    return { svc, prisma, tx };
  }

  /** Outra conta já usa o e-mail pedido. */
  function emailEmUso(prisma: any) {
    prisma.users.findFirst.mockResolvedValue({ id: 77 });
  }

  const titular: JwtPayload = { sub: 40, nome: 'Titular', typeAccess: 'Morador', user: { id: 40 } };

  describe('updateSindico', () => {
    it('mesmo e-mail com outra caixa/espaço, sem senha -> salva e não mexe em email/login', async () => {
      const { svc, tx } = build({ email: 'Conta@X.com', login: 'conta@x.com' });
      await svc.updateSindico(40, { nome: 'N', email: '  CONTA@x.com ' });
      const dados = tx.users.update.mock.calls[0][0].data;
      expect(dados.email).toBe('Conta@X.com');
      expect(dados.login).toBe('conta@x.com');
    });

    it('login ≠ email e o app reenvia o login (Sindicos.email), sem senha -> salva sem trocar o login', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'login@x.com' }, { emailSindico: 'login@x.com' });
      await svc.updateSindico(40, { nome: 'N', email: 'Login@x.com' });
      const dados = tx.users.update.mock.calls[0][0].data;
      expect(dados.email).toBe('conta@x.com');
      expect(dados.login).toBe('login@x.com');
    });

    it('e-mail realmente novo sem senha -> 400', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'login@x.com' });
      await expect(svc.updateSindico(40, { email: 'novo@x.com' })).rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('e-mail em uso por outra conta, sem senha -> mesma resposta de e-mail livre', async () => {
      const { svc, prisma } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      emailEmUso(prisma);
      await expect(svc.updateSindico(40, { email: 'ocupado@x.com' })).rejects.toThrow(MSG);
    });
  });

  describe('updateInfosFuncionario', () => {
    it('mesmo e-mail com outra caixa, sem senha -> salva e não mexe em email/login da conta', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      await svc.updateInfosFuncionario({ funcionario: { email: 'CONTA@x.com', nome: 'N' } }, titular);
      const dados = tx.users.update.mock.calls[0][0].data;
      expect(dados).not.toHaveProperty('email');
      expect(dados).not.toHaveProperty('login');
    });

    it('login ≠ email e o app reenvia um dos dois, sem senha -> salva sem trocar o login', async () => {
      for (const reenviado of ['conta@x.com', 'login@x.com']) {
        const { svc, tx } = build({ email: 'conta@x.com', login: 'login@x.com' });
        await svc.updateInfosFuncionario({ funcionario: { email: reenviado, nome: 'N' } }, titular);
        const dados = tx.users.update.mock.calls[0][0].data;
        expect(dados).not.toHaveProperty('login');
        expect(dados).not.toHaveProperty('email');
      }
    });

    it('e-mail realmente novo sem senha -> 400', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'login@x.com' });
      await expect(svc.updateInfosFuncionario({ funcionario: { email: 'novo@x.com' } }, titular)).rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('e-mail em uso por outra conta, sem senha -> mesma resposta de e-mail livre', async () => {
      const { svc, prisma } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      emailEmUso(prisma);
      await expect(svc.updateInfosFuncionario({ funcionario: { email: 'ocupado@x.com' } }, titular)).rejects.toThrow(MSG);
    });
  });

  describe('saveMorador (autoedição)', () => {
    const corpo = (email: string) => ({ morador: { id: 10, nome: 'N', email } });

    it('mesmo e-mail com outra caixa, sem senha -> salva e não mexe em email/login da conta', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      await svc.saveMorador(corpo('CONTA@x.com'), true, titular);
      const patch = tx.users.update.mock.calls[0][0].data;
      expect(patch).not.toHaveProperty('email');
      expect(patch).not.toHaveProperty('login');
    });

    it('Moradores.email diferente, mas o e-mail enviado é o login da conta -> sem senha, sem trocar login', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'login@x.com' }, { emailMorador: 'antigo@x.com' });
      await svc.saveMorador(corpo('Login@x.com'), true, titular);
      const patch = tx.users.update.mock.calls[0][0].data;
      expect(patch).not.toHaveProperty('email');
      expect(patch).not.toHaveProperty('login');
    });

    it('e-mail realmente novo sem senha -> 400', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      await expect(svc.saveMorador(corpo('novo@x.com'), true, titular)).rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('e-mail em uso por outra conta, sem senha -> mesma resposta de e-mail livre', async () => {
      const { svc, prisma } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      emailEmUso(prisma);
      await expect(svc.saveMorador(corpo('ocupado@x.com'), true, titular)).rejects.toThrow(MSG);
    });
  });

  /*
   * A conta trocou o e-mail por outro papel: Users mudou, Sindicos.email /
   * Funcionarios.email não. O app reenvia o e-mail da tabela do papel e não
   * tem campo de senha nessa tela — não é troca, salva sem mexer em Users.
   */
  describe('e-mail da tabela do papel diverge da conta', () => {
    it('síndico reenviando Sindicos.email (≠ Users.email/login), sem senha -> salva e Users inalterado', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'conta@x.com' }, { emailSindico: 'antigo@x.com' });
      await svc.updateSindico(40, { nome: 'N', email: ' Antigo@x.com' });
      const dados = tx.users.update.mock.calls[0][0].data;
      expect(dados.email).toBe('conta@x.com');
      expect(dados.login).toBe('conta@x.com');
    });

    it('funcionário reenviando Funcionarios.email (≠ Users.email/login), sem senha -> salva e Users inalterado', async () => {
      const { svc, tx } = build({ email: 'conta@x.com', login: 'conta@x.com' }, { emailFuncionario: 'antigo@x.com' });
      await svc.updateInfosFuncionario({ funcionario: { email: 'ANTIGO@x.com', nome: 'N' } }, titular);
      const dados = tx.users.update.mock.calls[0][0].data;
      expect(dados).not.toHaveProperty('email');
      expect(dados).not.toHaveProperty('login');
    });
  });

  /*
   * Sem limite por IP no moradores/update (o operador edita moradores em
   * sequência do mesmo IP), a adivinhação da senha atual com um token roubado
   * é contida POR CONTA: 10 falhas em 10 minutos travam a conta.
   */
  describe('senha atual errada repetida trava por conta', () => {
    const MSG_TRAVA = 'Muitas tentativas. Tente novamente em alguns minutos.';
    const tentar = (svc: MobileAuthService, idUser: number, senha: string) =>
      svc.updateSindico(idUser, { email: 'novo@x.com', senha_atual: senha }).catch((e: any) => e);

    it('10 erradas dão 400; a 11ª (mesmo com a senha certa) dá 429; outra conta não é afetada', async () => {
      const { svc } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      for (let i = 0; i < 10; i++) {
        const erro = await tentar(svc, 40, `errada${i}`);
        expect(erro.getStatus()).toBe(400);
        expect(erro.message).toBe(MSG);
      }
      const travada = await tentar(svc, 40, 'errada-11');
      expect(travada.getStatus()).toBe(429);
      expect(travada.message).toBe(MSG_TRAVA);
      expect((await tentar(svc, 40, SENHA)).getStatus?.()).toBe(429);

      const outra = await tentar(svc, 41, 'errada');
      expect(outra.getStatus()).toBe(400);
      expect(outra.message).toBe(MSG);
    });

    it('vale também para a autoedição do morador (mesma checagem)', async () => {
      const { svc } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      const corpo = (senha: string) => ({ morador: { id: 10, nome: 'N', email: 'novo@x.com', senha_atual: senha } });
      for (let i = 0; i < 10; i++) {
        await expect(svc.saveMorador(corpo(`errada${i}`), true, titular)).rejects.toThrow(MSG);
      }
      await expect(svc.saveMorador(corpo('errada'), true, titular)).rejects.toMatchObject({ status: 429, message: MSG_TRAVA });
    });

    it('sem senha enviada não conta como tentativa', async () => {
      const { svc } = build({ email: 'conta@x.com', login: 'conta@x.com' });
      for (let i = 0; i < 12; i++) {
        await expect(svc.updateSindico(40, { email: 'novo@x.com' })).rejects.toThrow(MSG);
      }
      expect((await tentar(svc, 40, 'errada')).getStatus()).toBe(400);
    });
  });
});
