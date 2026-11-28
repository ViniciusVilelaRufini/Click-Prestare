import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CentralAuthService } from './central-auth.service';

/**
 * Login do operador da central: senha + código por e-mail. Um token de operador enxerga vários
 * condomínios, então o 401 é genérico (não revela se o e-mail existe), o código vale 10 min e 5
 * tentativas, e o token sai com `papel: 'operador_central'` e SEM id_condominio.
 */
describe('CentralAuthService', () => {
  const SENHA = 'senha-de-teste-123';
  let HASH: string;
  const jwt = new JwtService({ secret: 'test' });

  beforeAll(async () => {
    HASH = await bcrypt.hash(SENHA, 4);
  });

  function operador(extra: Record<string, unknown> = {}) {
    return {
      id: 7,
      nome: 'Ana Central',
      email: 'ana@prestare.test',
      senha_hash: HASH,
      trocar_senha: 1,
      ativo: 1,
      cred: 'c'.repeat(32),
      ultimo_acesso: null,
      created_at: new Date(),
      ...extra,
    };
  }

  function build(op: any = operador()) {
    let linha = op ? { ...op } : null;
    const prisma: any = {
      isConnected: true,
      central_Operadores: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (!linha) return null;
          if (where.id !== undefined && where.id !== linha.id) return null;
          if (where.email !== undefined && where.email !== linha.email) return null;
          return { ...linha };
        }),
        update: jest.fn(async ({ data }: any) => {
          linha = { ...linha, ...data };
          return { ...linha };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!linha || where.id !== linha.id) return { count: 0 };
          if (where.cred !== undefined && where.cred !== linha.cred) return { count: 0 };
          linha = { ...linha, ...data };
          return { count: 1 };
        }),
      },
    };
    const mail: any = { sendCodigoCentral: jest.fn(async () => undefined) };
    const svc = new CentralAuthService(prisma, mail, jwt);
    const codigoEnviado = () => String(mail.sendCodigoCentral.mock.calls.at(-1)?.[2] ?? '');
    return { svc, prisma, mail, codigoEnviado, linha: () => linha };
  }

  const codigoErrado = (certo: string) => (certo === '000000' ? '111111' : '000000');

  describe('login', () => {
    it('login com senha certa cria desafio e manda e-mail', async () => {
      const { svc, mail, codigoEnviado } = build();
      const r = await svc.login('ana@prestare.test', SENHA);
      expect(typeof r.desafio).toBe('string');
      expect(r.desafio.length).toBeGreaterThan(20);
      expect(r.email_mascarado).not.toContain('ana@');
      expect(r.email_mascarado).toContain('@prestare.test');
      expect(mail.sendCodigoCentral).toHaveBeenCalledTimes(1);
      expect(mail.sendCodigoCentral.mock.calls[0][0]).toBe('ana@prestare.test');
      expect(codigoEnviado()).toMatch(/^\d{6}$/);
      // A resposta nunca carrega o código.
      expect(JSON.stringify(r)).not.toContain(codigoEnviado());
    });

    it('e-mail com espaços e maiúsculas acha o operador', async () => {
      const { svc, mail } = build();
      await svc.login('  ANA@Prestare.test ', SENHA);
      expect(mail.sendCodigoCentral).toHaveBeenCalledTimes(1);
    });

    it('senha errada e e-mail inexistente dão o mesmo 401', async () => {
      const a = build();
      const errA = await a.svc.login('ana@prestare.test', 'outra-senha').catch((e) => e);
      const b = build(null);
      const errB = await b.svc.login('ninguem@prestare.test', SENHA).catch((e) => e);
      expect(errA).toBeInstanceOf(UnauthorizedException);
      expect(errB).toBeInstanceOf(UnauthorizedException);
      expect(errA.message).toBe(errB.message);
      expect(a.mail.sendCodigoCentral).not.toHaveBeenCalled();
      expect(b.mail.sendCodigoCentral).not.toHaveBeenCalled();
    });

    it('operador inativo dá 401', async () => {
      const { svc, mail } = build(operador({ ativo: 0 }));
      const err = await svc.login('ana@prestare.test', SENHA).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      const ref = await build(null).svc.login('x@prestare.test', SENHA).catch((e) => e);
      expect(err.message).toBe(ref.message);
      expect(mail.sendCodigoCentral).not.toHaveBeenCalled();
    });

    it('corpo que não é texto → 401 genérico, sem consultar o banco', async () => {
      const { svc, prisma } = build();
      await expect(svc.login({ email: 'x' } as any, SENHA)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(svc.login('ana@prestare.test', ['x'] as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.central_Operadores.findUnique).not.toHaveBeenCalled();
    });

    it('muitas senhas erradas para o mesmo e-mail travam o login (429), mesmo com a senha certa', async () => {
      const { svc, mail } = build();
      for (let i = 0; i < 8; i++) {
        await expect(svc.login('ana@prestare.test', `errada-${i}`)).rejects.toBeInstanceOf(UnauthorizedException);
      }
      const err = await svc.login('ana@prestare.test', SENHA).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(mail.sendCodigoCentral).not.toHaveBeenCalled();
    });

    it('operador sem cred ganha um carimbo no login', async () => {
      const { svc, linha } = build(operador({ cred: '' }));
      await svc.login('ana@prestare.test', SENHA);
      expect(linha().cred).toMatch(/^[0-9a-f]{32}$/);
    });

    it('falha no envio do e-mail → 503 e o desafio não vale', async () => {
      const { svc, mail } = build();
      mail.sendCodigoCentral.mockRejectedValueOnce(new Error('smtp fora'));
      const err = await svc.login('ana@prestare.test', SENHA).catch((e) => e);
      expect(err?.getStatus?.()).toBe(503);
    });
  });

  describe('verificar', () => {
    it('verificar com código certo devolve token com papel operador_central e sem id_condominio', async () => {
      const { svc, codigoEnviado, linha } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const r = await svc.verificar(desafio, codigoEnviado());
      expect(r.nome).toBe('Ana Central');
      expect(r.trocar_senha).toBe(true);
      const p: any = jwt.verify(r.access_token);
      expect(p.sub).toBe(7);
      expect(p.papel).toBe('operador_central');
      expect(p.cred).toBe(linha().cred);
      expect(p.nome).toBe('Ana Central');
      expect(p.id_condominio).toBeUndefined();
      expect(p.tipo_sub).toBeUndefined();
      expect(p.typeAccess).toBeUndefined();
      expect(p.role).toBeUndefined();
      // Validade de 12 h.
      expect(p.exp - p.iat).toBe(12 * 60 * 60);
      expect(linha().ultimo_acesso).toBeInstanceOf(Date);
    });

    it('token de quem precisa trocar a senha leva trocar_senha: true; depois da troca, não', async () => {
      const { svc, codigoEnviado } = build(operador({ trocar_senha: 1 }));
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const r = await svc.verificar(desafio, codigoEnviado());
      const p: any = jwt.verify(r.access_token);
      expect(p.trocar_senha).toBe(true);
      // A rota de troca aceita o token marcado e devolve um token limpo.
      const t = await svc.trocarSenha(p, SENHA, 'nova-senha-forte-1');
      const novo: any = jwt.verify(t.access_token);
      expect(novo.trocar_senha).toBeUndefined();
      expect(novo.papel).toBe('operador_central');
    });

    it('operador sem troca pendente recebe token sem a marca', async () => {
      const { svc, codigoEnviado } = build(operador({ trocar_senha: 0 }));
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const r = await svc.verificar(desafio, codigoEnviado());
      expect(r.trocar_senha).toBe(false);
      expect((jwt.verify(r.access_token) as any).trocar_senha).toBeUndefined();
    });

    it('o código só vale uma vez', async () => {
      const { svc, codigoEnviado } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const codigo = codigoEnviado();
      await svc.verificar(desafio, codigo);
      await expect(svc.verificar(desafio, codigo)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('código errado → 401 com tentativas restantes', async () => {
      const { svc, codigoEnviado } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const err = await svc.verificar(desafio, codigoErrado(codigoEnviado())).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toContain('4');
    });

    it('6ª tentativa errada invalida o desafio', async () => {
      const { svc, codigoEnviado } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      const certo = codigoEnviado();
      const status: number[] = [];
      for (let i = 0; i < 5; i++) {
        const e: any = await svc.verificar(desafio, codigoErrado(certo)).catch((x) => x);
        status.push(e.getStatus());
      }
      // 4 erros com "restam N" e o 5º esgota (429). Daí em diante nem o código certo entra.
      expect(status).toEqual([401, 401, 401, 401, 429]);
      const sexta: any = await svc.verificar(desafio, certo).catch((x) => x);
      expect(sexta).toBeInstanceOf(HttpException);
      expect([401, 429]).toContain(sexta.getStatus());
    });

    it('novo login invalida o desafio anterior', async () => {
      const { svc, codigoEnviado } = build();
      const primeiro = await svc.login('ana@prestare.test', SENHA);
      const codigoAntigo = codigoEnviado();
      await svc.login('ana@prestare.test', SENHA);
      await expect(svc.verificar(primeiro.desafio, codigoAntigo)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('operador desativado entre a senha e o código não recebe token', async () => {
      const { svc, codigoEnviado, prisma } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      await prisma.central_Operadores.update({ where: { id: 7 }, data: { ativo: 0 } });
      await expect(svc.verificar(desafio, codigoEnviado())).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('senha trocada entre a senha e o código (cred mudou) não recebe token', async () => {
      const { svc, codigoEnviado, prisma } = build();
      const { desafio } = await svc.login('ana@prestare.test', SENHA);
      await prisma.central_Operadores.update({ where: { id: 7 }, data: { cred: 'd'.repeat(32) } });
      await expect(svc.verificar(desafio, codigoEnviado())).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('desafio inexistente ou corpo inválido → recusa', async () => {
      const { svc } = build();
      await expect(svc.verificar('00000000-0000-4000-8000-000000000000', '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(svc.verificar({} as any, '123456')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.verificar('abc', 123456 as any)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('trocarSenha', () => {
    const tokenOperador = (cred = 'c'.repeat(32)) => ({ sub: 7, nome: 'Ana Central', papel: 'operador_central', cred }) as any;

    it('troca a senha, zera trocar_senha, troca cred e devolve token novo', async () => {
      const { svc, linha } = build();
      const credAntes = linha().cred;
      const r = await svc.trocarSenha(tokenOperador(), SENHA, 'nova-senha-forte-1');
      expect(linha().trocar_senha).toBe(0);
      expect(linha().cred).not.toBe(credAntes);
      expect(linha().cred).toMatch(/^[0-9a-f]{32}$/);
      expect(await bcrypt.compare('nova-senha-forte-1', linha().senha_hash)).toBe(true);
      expect(linha().senha_hash.startsWith('$2b$12$')).toBe(true);
      const p: any = jwt.verify(r.access_token);
      expect(p.cred).toBe(linha().cred);
      expect(p.papel).toBe('operador_central');
      expect(r.trocar_senha).toBe(false);
    });

    // 400, como no change-password do console: 401 o console trata como fim de sessão.
    it('senha atual errada → 400 e nada muda', async () => {
      const { svc, linha } = build();
      const antes = { ...linha() };
      await expect(svc.trocarSenha(tokenOperador(), 'errada', 'nova-senha-forte-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(linha().senha_hash).toBe(antes.senha_hash);
      expect(linha().cred).toBe(antes.cred);
    });

    it('senha nova curta ou igual à atual → 400', async () => {
      const { svc } = build();
      await expect(svc.trocarSenha(tokenOperador(), SENHA, 'curta')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.trocarSenha(tokenOperador(), SENHA, SENHA)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('token de porteiro não troca senha de operador (403)', async () => {
      const { svc, prisma } = build();
      const porteiro: any = { sub: 7, nome: 'P', id_condominio: 1, tipo_sub: 'funcionario_portaria' };
      await expect(svc.trocarSenha(porteiro, SENHA, 'nova-senha-forte-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.central_Operadores.update).not.toHaveBeenCalled();
    });

    it('senha atual errada conta na mesma trava do login: token roubado não testa senhas à vontade', async () => {
      const { svc, mail, linha } = build();
      for (let i = 0; i < 8; i++) {
        await expect(svc.trocarSenha(tokenOperador(), `errada-${i}`, 'nova-senha-forte-1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      const credAntes = linha().cred;
      const err: any = await svc.trocarSenha(tokenOperador(), SENHA, 'nova-senha-forte-1').catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(linha().cred).toBe(credAntes);
      // O login do mesmo e-mail também fica travado.
      const login: any = await svc.login('ana@prestare.test', SENHA).catch((e) => e);
      expect(login.getStatus()).toBe(429);
      expect(mail.sendCodigoCentral).not.toHaveBeenCalled();
    });

    it('token com cred antigo não troca a senha', async () => {
      const { svc } = build();
      await expect(svc.trocarSenha(tokenOperador('e'.repeat(32)), SENHA, 'nova-senha-forte-1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
