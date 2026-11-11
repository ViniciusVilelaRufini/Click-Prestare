import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * `Users` é a conta (login, e-mail, CPF, senha). Quem edita o cadastro de OUTRA
 * pessoa (funcionário/síndico) atualiza o `Moradores` do condomínio, mas nunca
 * a credencial da conta: trocar o e-mail de login do morador pelo próprio e
 * pedir "esqueci a senha" tomava a conta por 365 dias.
 *
 * Quem troca a PRÓPRIA credencial prova que é o titular com a senha atual.
 */
describe('Credenciais da conta — edição por terceiros e autoedição', () => {
  const SENHA = 'senhaAtual123';
  const MSG = 'Para trocar o e-mail de acesso, informe sua senha atual.';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  function build() {
    const tx: any = {
      moradores: { update: jest.fn(async () => ({})) },
      users: { update: jest.fn(async () => ({})) },
      sindicos: { update: jest.fn(async () => ({})) },
      funcionarios: { update: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({
          id: 40, email: 'vitima@x.com', login: 'vitima@x.com', name: 'Vítima', cpf: '111', phone: '999',
          photo: null, password: hash,
          sindicos: [{ id: 5, name: 'Vítima', email: 'vitima@x.com', phone: '999', doc_identification: '111', date_birth: null }],
          moradores: [{ id: 10, nome: 'Vítima' }],
          funcionarios: [{ id: 6 }],
        })),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, id_user: 40, id_condominio: 1, email: 'vitima@x.com', nome: 'Vítima',
          data_nascimento: null, extra2: null, user: { id: 40 },
        })),
      },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 6, id_user: 40 })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const storage: any = { isDataUrl: jest.fn(() => false), uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(
      prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, storage, {} as any, tenant,
    );
    return { svc, prisma, tx };
  }

  const funcionario: JwtPayload = { sub: 99, nome: 'Func', typeAccess: 'Funcionario', user: { id: 99 } };
  const sindicoOutro: JwtPayload = { sub: 98, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 98 } };
  const titular: JwtPayload = { sub: 40, nome: 'Vítima', typeAccess: 'Morador', user: { id: 40 } };

  describe('saveMorador (edição)', () => {
    const corpo = (extra: any = {}) => ({
      morador: { id: 10, nome: 'Novo Nome', email: 'atacante@x.com', documento: '999', telefone: '111', ...extra },
    });

    it.each([['funcionário', funcionario], ['síndico', sindicoOutro]])(
      '%s troca e-mail/CPF do morador: Moradores muda, Users não recebe credencial',
      async (_n, quem) => {
        const { svc, tx } = build();
        await svc.saveMorador(corpo(), true, quem);

        const dadosMorador = tx.moradores.update.mock.calls[0][0].data;
        expect(dadosMorador.email).toBe('atacante@x.com');
        expect(dadosMorador.documento).toBe('999');

        const patch = tx.users.update.mock.calls[0]?.[0].data ?? {};
        expect(patch).not.toHaveProperty('email');
        expect(patch).not.toHaveProperty('login');
        expect(patch).not.toHaveProperty('cpf');
        expect(patch.name).toBe('Novo Nome');
        expect(patch.phone).toBe('111');
      },
    );

    it('titular troca o próprio e-mail sem senha atual -> 400', async () => {
      const { svc, tx } = build();
      await expect(svc.saveMorador(corpo(), true, titular)).rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('titular troca o próprio e-mail com senha errada -> 400', async () => {
      const { svc, tx } = build();
      await expect(svc.saveMorador(corpo({ senha_atual: 'errada' }), true, titular))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('titular troca o próprio e-mail com a senha certa -> grava', async () => {
      const { svc, tx } = build();
      await svc.saveMorador(corpo({ senha_atual: SENHA }), true, titular);
      const patch = tx.users.update.mock.calls[0][0].data;
      expect(patch.email).toBe('atacante@x.com');
      expect(patch.login).toBe('atacante@x.com');
    });

    it('titular sem trocar e-mail não precisa de senha', async () => {
      const { svc, tx } = build();
      await svc.saveMorador(corpo({ email: 'vitima@x.com' }), true, titular);
      expect(tx.users.update).toHaveBeenCalled();
    });
  });

  describe('updateSindico', () => {
    it('troca de e-mail sem senha atual -> 400', async () => {
      const { svc, tx } = build();
      await expect(svc.updateSindico(40, { email: 'novo@x.com' })).rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('troca de e-mail com a senha certa -> grava', async () => {
      const { svc, tx } = build();
      await svc.updateSindico(40, { email: 'novo@x.com', senha_atual: SENHA });
      expect(tx.users.update.mock.calls[0][0].data.email).toBe('novo@x.com');
    });

    it('sem trocar e-mail não pede senha e NÃO apaga cpf/phone ausentes', async () => {
      const { svc, tx } = build();
      await svc.updateSindico(40, { nome: 'Só o nome' });
      const userData = tx.users.update.mock.calls[0][0].data;
      const sindData = tx.sindicos.update.mock.calls[0][0].data;
      expect(userData).not.toHaveProperty('cpf');
      expect(userData).not.toHaveProperty('phone');
      expect(sindData).not.toHaveProperty('doc_identification');
      expect(sindData).not.toHaveProperty('phone');
    });

    it('cpf e phone enviados continuam sendo gravados', async () => {
      const { svc, tx } = build();
      await svc.updateSindico(40, { phone: '17999', doc_identification: '123' });
      expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ phone: '17999', cpf: '123' });
    });
  });

  describe('updateInfosFuncionario', () => {
    it('troca de e-mail sem senha atual -> 400', async () => {
      const { svc, tx } = build();
      await expect(svc.updateInfosFuncionario({ funcionario: { email: 'novo@x.com' } }, titular))
        .rejects.toThrow(MSG);
      expect(tx.users.update).not.toHaveBeenCalled();
    });

    it('troca de e-mail com a senha certa -> grava', async () => {
      const { svc, tx } = build();
      await svc.updateInfosFuncionario(
        { funcionario: { email: 'novo@x.com', senha_atual: SENHA } }, titular,
      );
      expect(tx.users.update.mock.calls[0][0].data).toMatchObject({ email: 'novo@x.com', login: 'novo@x.com' });
    });

    it('reenviar o mesmo e-mail não pede senha', async () => {
      const { svc, tx } = build();
      await svc.updateInfosFuncionario({ funcionario: { email: 'vitima@x.com', nome: 'N' } }, titular);
      expect(tx.users.update).toHaveBeenCalled();
    });
  });
});
